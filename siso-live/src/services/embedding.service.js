/**
 * Embedding Service
 * 
 * What this does: Two jobs —
 * 1. Takes uploaded documents, splits them into chunks, converts to vectors
 * 2. Takes user questions, converts them to vectors for search
 * 
 * Plain English: Before the AI can search documents by meaning,
 * every piece of text needs to be converted into a list of numbers
 * (a "vector") that represents its meaning mathematically.
 * Two pieces of text that mean the same thing will have very similar
 * numbers, even if the words are completely different.
 * That's how "supplier diversity goals" finds "minority spend targets."
 */

const { CohereClient } = require('cohere-ai');
const { logger } = require('../utils/logger');

const cohere = new CohereClient({ token: process.env.COHERE_API_KEY });

/**
 * Convert text to embedding vector
 * inputType: 'search_document' for docs being stored
 *            'search_query' for user questions
 * This distinction improves retrieval accuracy by ~15%.
 */
async function embedText(text, inputType = 'search_query') {
  try {
    const response = await cohere.embed({
      texts: [text],
      model: process.env.COHERE_EMBED_MODEL || 'embed-english-v3.0',
      inputType,
    });
    return response.embeddings[0]; // Array of 1024 numbers
  } catch (error) {
    logger.error({ error, textLength: text.length }, 'Embedding failed');
    throw new Error(`Failed to generate embedding: ${error.message}`);
  }
}

/**
 * Embed multiple texts in batch (more efficient for document ingestion)
 * Cohere allows up to 96 texts per batch
 */
async function embedBatch(texts, inputType = 'search_document') {
  const BATCH_SIZE = 96;
  const allEmbeddings = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const response = await cohere.embed({
      texts: batch,
      model: process.env.COHERE_EMBED_MODEL || 'embed-english-v3.0',
      inputType,
    });
    allEmbeddings.push(...response.embeddings);
    logger.info(`Embedded batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(texts.length / BATCH_SIZE)}`);
  }

  return allEmbeddings;
}

/**
 * Split document text into overlapping chunks
 * 
 * Why 512 tokens with 50 overlap:
 * - 512 tokens ≈ 2,000 characters = a full paragraph with context
 * - 50 token overlap = concepts that span chunk boundaries aren't lost
 * - This is the empirically validated sweet spot for RAG accuracy
 */
function chunkText(text, chunkSize = 512, overlap = 50) {
  // Rough token estimate: 1 token ≈ 4 characters
  const chunkChars = chunkSize * 4;
  const overlapChars = overlap * 4;
  const chunks = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + chunkChars, text.length);
    let chunk = text.slice(start, end);

    // Try to break at sentence boundary for cleaner chunks
    if (end < text.length) {
      const lastPeriod = chunk.lastIndexOf('. ');
      const lastNewline = chunk.lastIndexOf('\n');
      const breakPoint = Math.max(lastPeriod, lastNewline);
      if (breakPoint > chunkChars * 0.7) {
        chunk = chunk.slice(0, breakPoint + 1);
      }
    }

    if (chunk.trim().length > 100) { // Skip tiny chunks
      chunks.push(chunk.trim());
    }

    start += chunkChars - overlapChars; // Slide forward with overlap
  }

  logger.debug(`Text chunked: ${text.length} chars → ${chunks.length} chunks`);
  return chunks;
}

module.exports = { embedText, embedBatch, chunkText };
