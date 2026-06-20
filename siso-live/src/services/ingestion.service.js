/**
 * Document Ingestion Service
 * 
 * What this does: Takes an uploaded document, extracts its text,
 * splits it into chunks, converts to vectors, and stores in Pinecone.
 * 
 * Plain English: This is the process that happens every time an admin
 * uploads a new document. Think of it like a new book arriving at
 * the library — before anyone can search it, a librarian needs to
 * read it, create index cards for every section, and file them.
 * This service is that librarian. It runs in the background so
 * the admin doesn't have to wait.
 * 
 * Supported formats: PDF, CSV, DOCX (text extraction varies by type)
 */

const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const { embedBatch, chunkText } = require('./embedding.service');
const { getPineconeIndex } = require('../config/pinecone');
const { invalidateAnswerCache } = require('../config/redis');
const { query } = require('../config/database');
const { logger } = require('../utils/logger');

/**
 * Main ingestion pipeline — called by the upload route
 */
async function ingestDocument(filePath, documentId, filename, uploadedBy) {
  const startTime = Date.now();
  logger.info({ documentId, filename }, 'Starting document ingestion');

  try {
    // Step 1: Extract text based on file type
    const fileType = path.extname(filename).toLowerCase().slice(1);
    let rawText = '';
    logger.info({ documentId, fileType, filePath }, 'Step 1: extracting text');

    if (fileType === 'pdf') {
      rawText = await extractPdfText(filePath);
    } else if (fileType === 'csv') {
      rawText = await extractCsvText(filePath);
    } else if (fileType === 'txt') {
      rawText = fs.readFileSync(filePath, 'utf8');
    } else {
      throw new Error(`Unsupported file type: ${fileType}`);
    }

    if (!rawText || rawText.trim().length < 20) {
      throw new Error('No text could be extracted from this file. It may be password-protected or corrupted. Please check the file and try again.');
    }

    logger.info({ documentId, textLength: rawText.length }, 'Step 1 complete: text extracted');

    // Store raw text so the document can be re-indexed later without re-uploading
    await query(`UPDATE documents SET raw_text = $1 WHERE id = $2`, [rawText.slice(0, 500000), documentId]);

    // Step 2: Split into chunks
    const chunks = chunkText(rawText);
    logger.info({ documentId, chunkCount: chunks.length }, 'Step 2 complete: document chunked');

    // Step 3: Embed all chunks (batch for efficiency)
    logger.info({ documentId, chunkCount: chunks.length }, 'Step 3: embedding with Cohere');
    const embeddings = await embedBatch(chunks, 'search_document');
    logger.info({ documentId }, 'Step 3 complete: embeddings generated');

    // Step 4: Store in Pinecone with metadata
    const index = getPineconeIndex();
    if (!index) {
      logger.warn({ documentId }, 'Pinecone unavailable — raw text saved, no vectors stored. Re-index from admin panel.');
      await query(`UPDATE documents SET status = 'active', chunk_count = $1, processed_at = NOW(), has_vectors = false WHERE id = $2`, [chunks.length, documentId]);
      return { success: true, chunkCount: chunks.length, processingTimeMs: Date.now() - startTime, vectorsStored: false };
    }
    const vectors = chunks.map((chunk, i) => ({
      id: `${documentId}#chunk-${i}`,
      values: embeddings[i],
      metadata: {
        documentId,
        filename,
        text: chunk.slice(0, 1000), // Store first 1000 chars for display
        chunkIndex: i,
        totalChunks: chunks.length,
        uploadedBy,
        ingestedAt: new Date().toISOString(),
      },
    }));

    // Upsert in batches of 100 (Pinecone limit)
    const BATCH_SIZE = 100;
    for (let i = 0; i < vectors.length; i += BATCH_SIZE) {
      await index.upsert(vectors.slice(i, i + BATCH_SIZE));
    }

    // Step 5: Update document status in database
    const processingTime = Date.now() - startTime;
    await query(`
      UPDATE documents
      SET status = 'active', chunk_count = $1, processed_at = NOW(), has_vectors = true
      WHERE id = $2
    `, [chunks.length, documentId]);

    // Step 6: Invalidate answer cache — new docs may change answers
    await invalidateAnswerCache();

    logger.info({
      documentId,
      filename,
      chunkCount: chunks.length,
      processingTimeMs: processingTime,
    }, 'Document ingestion complete');

    return { success: true, chunkCount: chunks.length, processingTimeMs: processingTime };
  } catch (error) {
    logger.error({ errorMessage: error.message, errorStack: error.stack, documentId, filename }, 'Document ingestion failed');

    await query(`
      UPDATE documents SET status = 'error', error_message = $1 WHERE id = $2
    `, [error.message, documentId]);

    throw error;
  } finally {
    // Clean up temp file
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

async function extractPdfText(filePath) {
  const dataBuffer = fs.readFileSync(filePath);

  // Try standard text extraction first — fast and free
  try {
    const data = await pdfParse(dataBuffer);
    const text = data.text || '';
    // If we got meaningful text (at least ~4 chars per page), use it
    const pageCount = data.numpages || 1;
    if (text.trim().length >= pageCount * 4) {
      logger.info({ filePath, chars: text.length, pages: pageCount }, 'PDF text extracted via pdf-parse');
      return text;
    }
    logger.info({ chars: text.length, pages: pageCount }, 'PDF has little embedded text — using AI extraction');
  } catch (e) {
    logger.warn({ error: e.message }, 'pdf-parse failed — falling back to AI extraction');
  }

  // Fall back to Claude for image-based or complex PDFs
  return extractPdfTextWithClaude(dataBuffer, filePath);
}

async function extractPdfTextWithClaude(dataBuffer, filePath) {
  const fileSizeMB = dataBuffer.length / (1024 * 1024);
  if (fileSizeMB > 30) {
    throw new Error(
      `This PDF is ${fileSizeMB.toFixed(1)}MB. Maximum supported size is 30MB. ` +
      `Please reduce the file size or split it into smaller documents.`
    );
  }

  logger.info({ fileSizeMB: fileSizeMB.toFixed(2), filePath }, 'Extracting PDF text via Claude AI');
  const Anthropic = require('@anthropic-ai/sdk');
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await anthropic.messages.create({
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
    max_tokens: 8096,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: dataBuffer.toString('base64'),
          },
        },
        {
          type: 'text',
          text: 'Extract all text content from this document exactly as written, preserving the structure and paragraphs. Return only the extracted text, no commentary.',
        },
      ],
    }],
  });

  const text = response.content[0]?.text || '';
  if (!text.trim()) {
    throw new Error('Could not extract any text from this PDF. The file may be password-protected or corrupted.');
  }
  logger.info({ chars: text.length }, 'PDF text extracted via Claude AI');
  return text;
}

async function extractCsvText(filePath) {
  // Convert CSV rows to readable sentences for better embedding
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n').filter(l => l.trim());
  const headers = lines[0].split(',').map(h => h.trim());

  return lines.slice(1).map(line => {
    const values = line.split(',').map(v => v.trim());
    return headers.map((h, i) => `${h}: ${values[i] || ''}`).join('. ');
  }).join('\n');
}

/**
 * Re-index a document from its stored raw text without re-uploading the file.
 * Used when Pinecone was unavailable during original upload.
 */
async function reindexDocument(documentId) {
  const startTime = Date.now();
  const docResult = await query(
    'SELECT id, filename, raw_text, uploaded_by, chunk_count FROM documents WHERE id = $1',
    [documentId]
  );
  const doc = docResult.rows[0];
  if (!doc) throw new Error('Document not found');
  if (!doc.raw_text) throw new Error('No raw text stored for this document — please delete and re-upload it');

  await query(`UPDATE documents SET status = 'processing' WHERE id = $1`, [documentId]);

  try {
    const chunks = chunkText(doc.raw_text);
    const embeddings = await embedBatch(chunks, 'search_document');

    const index = getPineconeIndex();
    if (!index) throw new Error('Pinecone is not connected — check PINECONE_API_KEY in Vercel settings');

    // Delete old vectors for this document
    const oldCount = doc.chunk_count || 0;
    if (oldCount > 0) {
      const oldIds = Array.from({ length: oldCount }, (_, i) => `${documentId}#chunk-${i}`);
      try { await index.deleteMany(oldIds); } catch (e) { /* ignore — vectors may not exist */ }
    }

    const vectors = chunks.map((chunk, i) => ({
      id: `${documentId}#chunk-${i}`,
      values: embeddings[i],
      metadata: {
        documentId,
        filename: doc.filename,
        text: chunk.slice(0, 1000),
        chunkIndex: i,
        totalChunks: chunks.length,
        uploadedBy: doc.uploaded_by,
        ingestedAt: new Date().toISOString(),
      },
    }));

    const BATCH_SIZE = 100;
    for (let i = 0; i < vectors.length; i += BATCH_SIZE) {
      await index.upsert(vectors.slice(i, i + BATCH_SIZE));
    }

    await query(
      `UPDATE documents SET status = 'active', chunk_count = $1, processed_at = NOW(), has_vectors = true WHERE id = $2`,
      [chunks.length, documentId]
    );

    await invalidateAnswerCache();

    logger.info({ documentId, filename: doc.filename, chunkCount: chunks.length }, 'Document re-indexed');
    return { success: true, chunkCount: chunks.length, processingTimeMs: Date.now() - startTime };
  } catch (error) {
    await query(`UPDATE documents SET status = 'error', error_message = $1 WHERE id = $2`, [error.message, documentId]);
    throw error;
  }
}

module.exports = { ingestDocument, reindexDocument };
