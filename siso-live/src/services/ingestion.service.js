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
      throw new Error('No text could be extracted. This PDF may be image-based (scanned). Please upload a text-based PDF exported from Word or Google Docs.');
    }

    logger.info({ documentId, textLength: rawText.length }, 'Step 1 complete: text extracted');

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
      logger.warn({ documentId }, 'Pinecone unavailable — skipping vector storage');
      await query(`UPDATE documents SET status = 'active', chunk_count = $1, processed_at = NOW() WHERE id = $2`, [chunks.length, documentId]);
      return { success: true, chunkCount: chunks.length, processingTimeMs: Date.now() - startTime };
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
      SET status = 'active', chunk_count = $1, processed_at = NOW()
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
  const data = await pdfParse(dataBuffer);
  return data.text;
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

module.exports = { ingestDocument };
