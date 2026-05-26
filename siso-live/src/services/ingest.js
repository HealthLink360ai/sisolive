/**
 * SISO Live! — Document Ingestion Service
 *
 * This is the pipeline that turns AbbVie's documents into
 * searchable knowledge. Run by admins when uploading content.
 *
 * Supports: PDF, CSV, DOCX, MP4 (transcript extraction)
 *
 * Flow per document:
 *   1. Parse raw text from the file
 *   2. Split into overlapping chunks (~500 words each)
 *   3. Embed each chunk via Cohere
 *   4. Store vectors + metadata in Pinecone
 *   5. Record ingestion in PostgreSQL for admin visibility
 */

import fs from 'fs/promises';
import path from 'path';
import pdfParse from 'pdf-parse';
import { CohereClient } from 'cohere-ai';
import { getPineconeIndex } from '../lib/pinecone.js';
import { db } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { v4 as uuidv4 } from 'uuid';

const cohere = new CohereClient({ token: process.env.COHERE_API_KEY });

// Chunk configuration
// Why 500 words with 50-word overlap?
// - 500 words = enough context for Claude to understand the topic
// - 50-word overlap = prevents losing meaning at chunk boundaries
// - Too large = wastes tokens and costs more per query
// - Too small = misses context, lower accuracy
const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 50;

/**
 * ingestDocument
 *
 * Main entry point for document ingestion.
 * Called by the admin upload API.
 */
export async function ingestDocument({ filePath, fileName, fileType, uploadedBy, documentId }) {
  const startTime = Date.now();
  logger.info(`Starting ingestion: ${fileName}`, { documentId, fileType });

  try {
    // ── Step 1: Extract text ──────────────────────────────────
    const rawText = await extractText({ filePath, fileType, fileName });
    logger.info(`Text extracted: ${rawText.length} characters`, { documentId });

    // ── Step 2: Chunk the text ────────────────────────────────
    const chunks = chunkText(rawText, fileName);
    logger.info(`Created ${chunks.length} chunks`, { documentId });

    // ── Step 3: Embed all chunks ──────────────────────────────
    // Batch embed for efficiency — Cohere handles up to 96 texts per call
    const embeddings = await embedChunks(chunks.map(c => c.text));
    logger.info(`Embedded ${embeddings.length} chunks`, { documentId });

    // ── Step 4: Store in Pinecone ─────────────────────────────
    const vectors = chunks.map((chunk, i) => ({
      id: `${documentId}_chunk_${i}`,
      values: embeddings[i],
      metadata: {
        documentId,
        source: fileName,
        text: chunk.text,           // Stored for retrieval
        chunkIndex: i,
        page: chunk.page || null,
        topics: detectTopics(chunk.text),
        uploadedBy,
        ingestedAt: new Date().toISOString(),
      },
    }));

    const index = await getPineconeIndex();

    // Upsert in batches of 100 (Pinecone limit per call)
    for (let i = 0; i < vectors.length; i += 100) {
      const batch = vectors.slice(i, i + 100);
      await index.upsert(batch);
    }

    logger.info(`Stored ${vectors.length} vectors in Pinecone`, { documentId });

    // ── Step 5: Record in PostgreSQL ──────────────────────────
    await db.query(`
      UPDATE documents
      SET
        status = 'active',
        chunk_count = $1,
        ingested_at = NOW(),
        char_count = $2
      WHERE id = $3
    `, [chunks.length, rawText.length, documentId]);

    const durationMs = Date.now() - startTime;
    logger.info(`Ingestion complete: ${fileName}`, { documentId, durationMs, chunks: chunks.length });

    return {
      success: true,
      documentId,
      fileName,
      chunkCount: chunks.length,
      charCount: rawText.length,
      durationMs,
    };

  } catch (error) {
    logger.error(`Ingestion failed: ${fileName}`, { documentId, error: error.message });

    await db.query(`
      UPDATE documents SET status = 'error', error_message = $1 WHERE id = $2
    `, [error.message, documentId]);

    throw error;
  } finally {
    // Always clean up the temp file after processing
    try { await fs.unlink(filePath); } catch {}
  }
}

/**
 * extractText
 *
 * Routes to the right parser based on file type.
 * Each format needs different handling.
 */
async function extractText({ filePath, fileType, fileName }) {
  switch (fileType) {
    case 'application/pdf':
      return extractFromPDF(filePath);

    case 'text/csv':
      return extractFromCSV(filePath);

    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return extractFromDOCX(filePath);

    case 'video/mp4':
    case 'video/quicktime':
      // For video: in production, send to a transcription service (Whisper/AssemblyAI)
      // For MVP: require a companion transcript text file
      return extractFromVideoTranscript(filePath, fileName);

    default:
      throw new Error(`Unsupported file type: ${fileType}`);
  }
}

async function extractFromPDF(filePath) {
  const buffer = await fs.readFile(filePath);
  const data = await pdfParse(buffer);
  return data.text;
}

async function extractFromCSV(filePath) {
  const content = await fs.readFile(filePath, 'utf-8');
  // Convert CSV rows to readable text paragraphs
  const lines = content.split('\n');
  const headers = lines[0].split(',');
  return lines.slice(1).map(line => {
    const values = line.split(',');
    return headers.map((h, i) => `${h.trim()}: ${(values[i] || '').trim()}`).join('. ');
  }).join('\n');
}

async function extractFromDOCX(filePath) {
  // In production: use mammoth or docx2txt
  // For now: placeholder that reads raw text
  const content = await fs.readFile(filePath, 'utf-8');
  return content;
}

async function extractFromVideoTranscript(filePath, fileName) {
  // Look for a companion .txt transcript file
  const transcriptPath = filePath.replace(path.extname(filePath), '.txt');
  try {
    return await fs.readFile(transcriptPath, 'utf-8');
  } catch {
    throw new Error(`No transcript found for ${fileName}. Please upload a .txt transcript alongside the video.`);
  }
}

/**
 * chunkText
 *
 * Splits a long document into overlapping chunks.
 * The overlap ensures we never cut a concept in half.
 */
function chunkText(text, source) {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const chunks = [];

  for (let i = 0; i < words.length; i += (CHUNK_SIZE - CHUNK_OVERLAP)) {
    const chunkWords = words.slice(i, i + CHUNK_SIZE);
    if (chunkWords.length < 20) break; // Skip tiny trailing chunks

    chunks.push({
      text: chunkWords.join(' '),
      wordStart: i,
      wordEnd: i + chunkWords.length,
    });
  }

  return chunks;
}

/**
 * embedChunks
 *
 * Batch-embeds all chunks efficiently.
 * Cohere handles up to 96 texts per API call.
 */
async function embedChunks(texts) {
  const batchSize = 96;
  const allEmbeddings = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const response = await cohere.embed({
      texts: batch,
      model: process.env.COHERE_EMBED_MODEL || 'embed-english-v3.0',
      inputType: 'search_document',
    });
    allEmbeddings.push(...response.embeddings);
  }

  return allEmbeddings;
}

/**
 * detectTopics
 *
 * Simple keyword-based topic detection.
 * Used to power the admin dashboard topic breakdown
 * and the "gentle nudge" suggestions in chat.
 */
function detectTopics(text) {
  const lower = text.toLowerCase();
  const topicKeywords = {
    'supplier-diversity': ['diversity', 'minority', 'women-owned', 'mwbe', 'wbe', 'mbe', 'inclusion'],
    'esg-reporting': ['esg', 'reporting', 'scorecard', 'disclosure', 'framework'],
    'sustainability': ['sustainability', 'sustainable', 'environment', 'green', 'renewable'],
    'carbon': ['carbon', 'emissions', 'scope 1', 'scope 2', 'scope 3', 'ghg', 'co2'],
    'compliance': ['compliance', 'regulation', 'policy', 'requirement', 'standard', 'certification'],
  };

  return Object.entries(topicKeywords)
    .filter(([, keywords]) => keywords.some(kw => lower.includes(kw)))
    .map(([topic]) => topic);
}
