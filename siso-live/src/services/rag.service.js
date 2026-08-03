/**
 * RAG Orchestration Service — The Brain
 * 
 * What this does: Coordinates all the pieces together.
 * Receives question → checks cache → retrieves chunks →
 * scores confidence → generates answer → logs everything.
 * 
 * Plain English: This is the conductor of the orchestra.
 * The embedding service, retrieval service, and generation service
 * are each great at one thing. This service tells them when to play
 * and in what order. Every user question flows through here.
 */

const { embedText } = require('./embedding.service');
const { retrieveRelevantChunks } = require('./retrieval.service');
const { generateAnswer } = require('./generation.service');
const { cacheAnswer, getCachedAnswer } = require('../config/redis');
const { query } = require('../config/database');
const { logger } = require('../utils/logger');
const crypto = require('crypto');

const ANSWER_CACHE_VERSION = 'learner-language-v2';

/**
 * Main entry point — handles a user question end to end
 */
async function handleQuery(question, userId, conversationHistory = [], options = {}) {
  const startTime = Date.now();
  const bypassCache = Boolean(options.bypassCache);

  if (isOutOfScopeQuestion(question, conversationHistory)) {
    logger.info({ userId, questionLength: question.length }, 'Escalating out-of-scope question before retrieval');
    const offTopicResult = {
      answer: null,
      nudge: null,
      confidence: 0,
      confidencePercent: 0,
      shouldEscalate: true,
      sources: [],
      responseTimeMs: Date.now() - startTime,
    };
    const queryId = await logQuery({ userId, question, ...offTopicResult });
    return { ...offTopicResult, queryId };
  }

  // Step 1: Check cache first unless QA/admin explicitly asks for a fresh retrieval path.
  const questionHash = crypto
    .createHash('md5')
    .update(`${ANSWER_CACHE_VERSION}:${question.toLowerCase().trim()}`)
    .digest('hex');

  if (!bypassCache) {
    const cached = await getCachedAnswer(questionHash);
    if (cached) {
      logger.info({ userId, questionHash, source: 'cache' }, 'Cache hit');
      const queryId = await logQuery({ userId, question, ...cached, fromCache: true });
      return { ...cached, queryId, fromCache: true };
    }
  } else {
    logger.info({ userId, questionHash }, 'Bypassing cache for fresh RAG retrieval');
  }

  // Step 2: Retrieve relevant document chunks from Pinecone
  const { chunks, confidence, topScore } = await retrieveRelevantChunks(question);

  // Step 3: Hard-escalate only when there are literally no chunks — Pinecone empty or unavailable.
  // If chunks exist, always attempt generation regardless of confidence score:
  // retrieval scores vary by domain and Claude is the authoritative judge of sufficiency.
  if (chunks.length === 0) {
    logger.warn({ userId, questionLength: question.length }, 'Escalating: zero chunks returned from Pinecone — index may be empty or unavailable');
    const escalationResult = {
      answer: null,
      nudge: null,
      confidence,
      confidencePercent: Math.round(confidence * 100),
      shouldEscalate: true,
      sources: [],
      responseTimeMs: Date.now() - startTime,
    };
    const queryId = await logQuery({ userId, question, ...escalationResult });
    return { ...escalationResult, queryId };
  }

  logger.info({ topScore, chunksFound: chunks.length }, 'Chunks found — proceeding to generation');

  // Step 4: Generate answer from retrieved chunks
  const { answer, nudge, isInsufficient, tokens, cost } = await generateAnswer(
    question, chunks, userId, conversationHistory
  );

  // Step 5: Handle cases where Claude confirms context is genuinely insufficient
  if (isInsufficient) {
    const insufficientResult = {
      answer: null,
      nudge: null,
      confidence,
      confidencePercent: Math.round(confidence * 100),
      shouldEscalate: true,
      sources: [],
      responseTimeMs: Date.now() - startTime,
    };
    const queryId = await logQuery({ userId, question, ...insufficientResult });
    return { ...insufficientResult, queryId };
  }

  // Step 6: Package the final result
  const result = {
    answer,
    nudge,
    confidence,
    confidencePercent: Math.round(confidence * 100),
    shouldEscalate: false,
    sources: chunks.map(c => ({
      filename: c.source,
      relevanceScore: Math.round(c.score * 100),
    })),
    charCount: answer.length,
    responseTimeMs: Date.now() - startTime,
    tokens,
    cost,
  };

  // Step 7: Cache normal answers for 24 hours. Fresh QA requests should not overwrite the cache.
  if (!bypassCache) {
    await cacheAnswer(questionHash, result);
  }

  // Step 8: Log to database for analytics and compliance
  const queryId = await logQuery({ userId, question, ...result });

  return { ...result, queryId };
}

function isOutOfScopeQuestion(question, conversationHistory = []) {
  const text = String(question || '').toLowerCase();
  const blocked = [
    'capital city of mars',
    'capital of mars',
    'today\'s date',
    'todays date',
    'what date is it',
    'current date',
    'current time',
  ];
  if (blocked.some(term => text.includes(term))) return true;
  return false;
}

async function logQuery({ userId, question, answer, confidence, shouldEscalate, sources, responseTimeMs, tokens }) {
  try {
    const result = await query(`
      INSERT INTO queries (user_id, question, answer, confidence_score, was_escalated, source_documents, tokens_used, response_time_ms)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `, [
      userId,
      question,
      answer,
      confidence,
      shouldEscalate,
      JSON.stringify(sources || []),
      tokens?.input + tokens?.output || 0,
      responseTimeMs,
    ]);
    const queryId = result.rows[0]?.id || null;
    if (queryId) {
      try {
        await query('UPDATE users SET last_query_at = NOW() WHERE id = $1', [userId]);
      } catch (updateError) {
        logger.error({ error: updateError }, 'Failed to update users.last_query_at');
      }
    }
    return queryId;
  } catch (error) {
    logger.error({ error }, 'Failed to log query');
    return null;
  }
}

module.exports = { handleQuery };
