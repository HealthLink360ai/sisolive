/**
 * SISO Live! — RAG Service
 *
 * This is the brain of the system.
 *
 * RAG = Retrieval Augmented Generation
 *
 * Plain English: instead of letting the AI answer from its
 * general training data, we force it to answer ONLY from
 * AbbVie's verified documents. Every answer is grounded
 * in source material we control.
 *
 * Flow:
 *   1. User question → embed into a vector
 *   2. Search Pinecone for similar document chunks
 *   3. Score the match quality (confidence)
 *   4. If confident enough, send chunks + question to Claude
 *   5. Claude writes a grounded answer using only those chunks
 *   6. Return answer with source attribution
 */

import Anthropic from '@anthropic-ai/sdk';
import { CohereClient } from 'cohere-ai';
import { getPineconeIndex } from '../lib/pinecone.js';
import { logger } from '../lib/logger.js';
import { auditLog } from '../lib/auditLog.js';
import { checkBudget } from '../utils/budgetGuard.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const cohere = new CohereClient({ token: process.env.COHERE_API_KEY });

const CONFIDENCE_THRESHOLD = parseFloat(process.env.CONFIDENCE_THRESHOLD) || 0.90;
const MAX_RESPONSE_CHARS = parseInt(process.env.MAX_RESPONSE_CHARS) || 400;
const TOP_K = parseInt(process.env.RAG_TOP_K) || 5;
const SIMILARITY_THRESHOLD = parseFloat(process.env.RAG_SIMILARITY_THRESHOLD) || 0.72;

/**
 * processQuery
 *
 * The main entry point. Takes a user's question and returns
 * a grounded, confidence-scored answer.
 *
 * @param {string} question - The user's raw question
 * @param {string} userId - For audit logging
 * @param {string} sessionId - Groups questions in a session
 * @returns {QueryResult}
 */
export async function processQuery({ question, userId, sessionId }) {
  const startTime = Date.now();

  logger.info(`Processing query`, { userId, sessionId, questionLength: question.length });

  // Safety check: don't process if we've hit our monthly spend cap
  // This prevents runaway costs from unexpected usage spikes
  await checkBudget();

  // ── STEP 1: Embed the question ──────────────────────────────
  // Convert the question into a 1024-dimensional number vector
  // This is how computers understand meaning — similar concepts
  // produce similar vectors, even if the exact words differ
  const questionVector = await embedText(question);

  // ── STEP 2: Search the knowledge base ──────────────────────
  // Find the TOP_K most similar document chunks in Pinecone
  // "Similar" means semantically similar, not keyword matching
  // So "supplier diversity goals" finds "minority business targets"
  const retrievedChunks = await retrieveChunks(questionVector);

  // ── STEP 3: Score confidence ────────────────────────────────
  // How well do the retrieved chunks actually answer this question?
  // We look at:
  //   - The similarity scores from Pinecone (0 to 1)
  //   - How many chunks were retrieved above our threshold
  //   - The average quality of those matches
  const confidence = calculateConfidence(retrievedChunks);

  logger.info(`Confidence score: ${confidence.toFixed(2)}`, {
    userId,
    threshold: CONFIDENCE_THRESHOLD,
    chunksRetrieved: retrievedChunks.length,
  });

  // ── STEP 4: Decide — answer or escalate ─────────────────────
  // Below 90% confidence = we don't trust our knowledge base
  // enough to give a reliable answer. Route to support instead.
  if (confidence < CONFIDENCE_THRESHOLD || retrievedChunks.length === 0) {
    await auditLog({
      type: 'QUERY_ESCALATED',
      userId,
      sessionId,
      question,
      confidence,
      reason: retrievedChunks.length === 0 ? 'NO_CHUNKS_FOUND' : 'LOW_CONFIDENCE',
      durationMs: Date.now() - startTime,
    });

    return {
      answered: false,
      confidence,
      escalated: true,
      message: 'I don\'t have enough verified information to answer this with sufficient confidence. Please reach out to the SISO support desk for accurate guidance.',
      sources: [],
      charCount: 0,
      durationMs: Date.now() - startTime,
    };
  }

  // ── STEP 5: Generate grounded answer ────────────────────────
  // Pass the question AND the retrieved document chunks to Claude.
  // The system prompt strictly instructs Claude to answer ONLY
  // from the provided context — no hallucination allowed.
  const answer = await generateAnswer({ question, chunks: retrievedChunks, confidence });

  // ── STEP 6: Build the response ──────────────────────────────
  const sources = [...new Set(retrievedChunks.map(c => c.metadata.source))];
  const nudge = generateNudge(retrievedChunks);

  const result = {
    answered: true,
    confidence,
    escalated: false,
    answer: answer.text,
    charCount: answer.text.length,
    sources,
    nudge,
    durationMs: Date.now() - startTime,
    tokensUsed: answer.tokensUsed,
  };

  // Log everything for the admin dashboard
  await auditLog({
    type: 'QUERY_ANSWERED',
    userId,
    sessionId,
    question,
    answer: answer.text,
    confidence,
    sources,
    tokensUsed: answer.tokensUsed,
    durationMs: result.durationMs,
  });

  return result;
}

/**
 * embedText
 *
 * Converts any text string into a 1024-number vector using Cohere.
 *
 * Why Cohere over OpenAI for embeddings?
 * - Cohere's embed-english-v3.0 is purpose-built for semantic search
 * - Slightly better accuracy on enterprise/business content
 * - More cost-efficient at scale (~$0.0001 per 1000 tokens)
 * - Same API, easy to swap later if needed
 */
async function embedText(text) {
  const response = await cohere.embed({
    texts: [text],
    model: process.env.COHERE_EMBED_MODEL || 'embed-english-v3.0',
    inputType: 'search_query',
  });

  return response.embeddings[0];
}

/**
 * retrieveChunks
 *
 * Searches Pinecone for the most relevant document chunks.
 *
 * Why Pinecone?
 * - Purpose-built for vector similarity search at scale
 * - Fully managed — no database infrastructure to maintain
 * - Enterprise-grade security, HIPAA-eligible
 * - Sub-100ms query times even at millions of vectors
 * - Generous free tier covers SISO Live! for months
 */
async function retrieveChunks(vector) {
  const index = await getPineconeIndex();

  const results = await index.query({
    vector,
    topK: TOP_K,
    includeMetadata: true,
    includeValues: false, // Save bandwidth — we don't need the vectors back
  });

  // Filter out chunks below our minimum similarity threshold
  // Prevents low-quality matches from polluting the context
  return results.matches.filter(match => match.score >= SIMILARITY_THRESHOLD);
}

/**
 * calculateConfidence
 *
 * Translates raw Pinecone similarity scores into a human-readable
 * confidence percentage.
 *
 * Logic:
 * - If no chunks found → 0% confidence
 * - Average the top match scores, weighted toward the best match
 * - Penalize if fewer than 3 chunks were found (sparse coverage)
 */
function calculateConfidence(chunks) {
  if (chunks.length === 0) return 0;

  // Weight the best match more heavily
  const weights = chunks.map((_, i) => 1 / (i + 1));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const weightedScore = chunks.reduce((sum, chunk, i) => {
    return sum + (chunk.score * weights[i]);
  }, 0) / totalWeight;

  // Slight penalty for sparse coverage (fewer than 3 good chunks)
  const coveragePenalty = chunks.length < 3 ? 0.05 : 0;

  return Math.max(0, Math.min(1, weightedScore - coveragePenalty));
}

/**
 * generateAnswer
 *
 * Sends the question + retrieved context chunks to Claude.
 * The system prompt is the critical piece — it hard-constrains
 * Claude to only answer from provided context, never from
 * its general training knowledge.
 *
 * Why Claude (Anthropic) over GPT-4?
 * - Constitutional AI training makes it less likely to hallucinate
 * - Strong instruction following — respects the 400-char limit
 * - Better at saying "I don't know" when context is insufficient
 * - Anthropic's enterprise agreement meets pharma security needs
 */
async function generateAnswer({ question, chunks, confidence }) {
  // Build the context block from retrieved chunks
  const context = chunks.map((chunk, i) => (
    `[Source ${i + 1}: ${chunk.metadata.source}, Page ${chunk.metadata.page || 'N/A'}]\n${chunk.metadata.text}`
  )).join('\n\n---\n\n');

  const systemPrompt = `You are SISO Live!, AbbVie's precision learning tool for supplier inclusion and sustainability.

CRITICAL RULES — follow these exactly:
1. Answer ONLY using the provided context documents. Never use outside knowledge.
2. Your answer must be ${MAX_RESPONSE_CHARS} characters or fewer. Count carefully.
3. Write in a conversational, helpful tone. Not robotic or clinical.
4. If the context doesn't fully answer the question, say so clearly.
5. Do not invent facts, statistics, or policy details not present in the context.
6. Do not mention that you are looking at "context" or "documents" — just answer naturally.
7. Do not start with "Based on the provided context" or similar phrases.

You are a trusted knowledge assistant. Every answer must be traceable to AbbVie's verified documents.`;

  const userPrompt = `Context documents:
${context}

Question: ${question}

Answer (${MAX_RESPONSE_CHARS} characters max):`;

  const response = await anthropic.messages.create({
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5',
    max_tokens: parseInt(process.env.ANTHROPIC_MAX_TOKENS) || 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content[0].text.trim();

  // Enforce hard character limit — truncate at word boundary if needed
  const trimmed = text.length > MAX_RESPONSE_CHARS
    ? text.substring(0, MAX_RESPONSE_CHARS).replace(/\s\S+$/, '...')
    : text;

  return {
    text: trimmed,
    tokensUsed: {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
      total: response.usage.input_tokens + response.usage.output_tokens,
    },
  };
}

/**
 * generateNudge
 *
 * Creates a gentle learning suggestion based on what topics
 * appeared in the retrieved chunks. This is how SISO Live!
 * encourages exploration without being pushy.
 */
function generateNudge(chunks) {
  const topics = chunks.flatMap(c => c.metadata.topics || []);
  const topicSet = [...new Set(topics)];

  const nudgeMap = {
    'supplier-diversity': 'Want to explore how this connects to your ESG reporting obligations?',
    'esg-reporting': 'Curious how ESG metrics feed into your supplier scorecards?',
    'sustainability': 'Would you like to explore AbbVie\'s 2030 carbon reduction targets?',
    'compliance': 'Want to understand the full certification timeline for Tier 1 suppliers?',
    'carbon': 'Curious how supplier carbon data feeds into Scope 3 calculations?',
  };

  for (const topic of topicSet) {
    if (nudgeMap[topic]) return nudgeMap[topic];
  }

  return 'Want to explore a related topic in supplier inclusion or sustainability?';
}
