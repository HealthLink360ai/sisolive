/**
 * Retrieval Service
 * 
 * What this does: Takes a question vector and finds the most
 * semantically similar document chunks stored in Pinecone.
 * Also calculates the confidence score.
 * 
 * Plain English: This is the librarian. You give it a question,
 * it searches the entire library of document chunks by meaning,
 * and returns the 5 most relevant passages. Then it tells you
 * how confident it is that those passages actually answer the question.
 */

const { getPineconeIndex } = require('../config/pinecone');
const { embedText } = require('./embedding.service');
const { logger } = require('../utils/logger');

const CONFIDENCE_THRESHOLD = parseFloat(process.env.CONFIDENCE_THRESHOLD) || 0.90;
const MAX_CHUNKS = parseInt(process.env.MAX_CHUNKS_TO_RETRIEVE) || 5;

/**
 * Search for relevant document chunks given a user question
 * Returns chunks + confidence score
 */
async function retrieveRelevantChunks(question) {
  const startTime = Date.now();

  // Step 1: Convert question to vector
  const questionVector = await embedText(question, 'search_query');

  // Step 2: Search Pinecone for similar vectors
  const index = getPineconeIndex();
  if (!index) {
    logger.warn('Pinecone unavailable — returning empty retrieval result');
    return { chunks: [], confidence: 0, shouldEscalate: true, topScore: 0 };
  }
  const searchResults = await index.query({
    vector: questionVector,
    topK: MAX_CHUNKS,
    includeMetadata: true,
  });

  const matches = searchResults.matches || [];

  if (matches.length === 0) {
    logger.info({ question: question.slice(0, 100) }, 'No matching chunks found');
    return {
      chunks: [],
      confidence: 0,
      shouldEscalate: true,
      topScore: 0,
    };
  }

  // Step 3: Calculate confidence from top match score
  // Pinecone cosine similarity: 0 = no match, 1 = identical
  // We convert to a 0-100 percentage for display
  const topScore = matches[0].score;
  const confidence = topScore; // Already 0-1 from cosine similarity

  const shouldEscalate = confidence < CONFIDENCE_THRESHOLD;

  // Step 4: Format chunks for the generation service
  const chunks = matches.map(match => ({
    text: match.metadata.text,
    source: match.metadata.filename,
    chunkIndex: match.metadata.chunkIndex,
    score: match.score,
    documentId: match.metadata.documentId,
  }));

  const retrievalTime = Date.now() - startTime;

  logger.info({
    question: question.slice(0, 100),
    topScore: topScore.toFixed(4),
    confidence: `${(confidence * 100).toFixed(1)}%`,
    shouldEscalate,
    chunksFound: chunks.length,
    retrievalTimeMs: retrievalTime,
  }, 'Retrieval complete');

  return {
    chunks,
    confidence,
    shouldEscalate,
    topScore,
  };
}

module.exports = { retrieveRelevantChunks };
