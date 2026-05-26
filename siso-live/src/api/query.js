/**
 * SISO Live! — Query API
 *
 * The endpoint users hit when they ask a question.
 * Connects the frontend chat to the RAG pipeline.
 */

import express from 'express';
import { processQuery } from '../services/rag.js';
import { requireAuth } from './auth.js';
import { db } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { auditLog } from '../lib/auditLog.js';
import { v4 as uuidv4 } from 'uuid';

export const queryRouter = express.Router();

// All query routes require authentication
queryRouter.use(requireAuth);

/**
 * POST /api/query
 *
 * The core endpoint. Takes a question, runs it through
 * the full RAG pipeline, returns a grounded answer.
 */
queryRouter.post('/', async (req, res, next) => {
  try {
    const { question, sessionId } = req.body;
    const userId = req.user.userId;

    // Basic input validation
    if (!question || typeof question !== 'string') {
      return res.status(400).json({
        error: 'A question is required.',
        code: 'MISSING_QUESTION',
      });
    }

    const trimmedQuestion = question.trim();

    if (trimmedQuestion.length < 3) {
      return res.status(400).json({
        error: 'Please ask a complete question.',
        code: 'QUESTION_TOO_SHORT',
      });
    }

    if (trimmedQuestion.length > 500) {
      return res.status(400).json({
        error: 'Question is too long. Please keep it under 500 characters.',
        code: 'QUESTION_TOO_LONG',
      });
    }

    // Generate a query ID for tracking this specific interaction
    const queryId = uuidv4();
    const activeSessionId = sessionId || uuidv4();

    logger.info(`Query received`, { queryId, userId, questionLength: trimmedQuestion.length });

    // Run the RAG pipeline
    const result = await processQuery({
      question: trimmedQuestion,
      userId,
      sessionId: activeSessionId,
    });

    // Store query record in PostgreSQL for analytics and feedback linking
    await db.query(`
      INSERT INTO queries (
        id, user_id, session_id, question, answer,
        confidence, escalated, sources, tokens_used,
        duration_ms, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
    `, [
      queryId,
      userId,
      activeSessionId,
      trimmedQuestion,
      result.answer || null,
      result.confidence,
      result.escalated,
      JSON.stringify(result.sources || []),
      JSON.stringify(result.tokensUsed || {}),
      result.durationMs,
    ]);

    // Return the result to the frontend
    res.json({
      queryId,
      sessionId: activeSessionId,
      answered: result.answered,
      confidence: Math.round(result.confidence * 100), // Convert to percentage
      escalated: result.escalated,
      answer: result.answer || null,
      message: result.escalated ? result.message : null,
      charCount: result.charCount,
      sources: result.sources,
      nudge: result.nudge || null,
      durationMs: result.durationMs,
    });

  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/query/:queryId/feedback
 *
 * Captures thumbs up / thumbs down on a specific response.
 * This data feeds directly into the admin feedback dashboard
 * and powers the training loop over time.
 */
queryRouter.post('/:queryId/feedback', async (req, res, next) => {
  try {
    const { queryId } = req.params;
    const { rating, comment } = req.body;
    const userId = req.user.userId;

    // Validate rating
    if (!['up', 'down'].includes(rating)) {
      return res.status(400).json({
        error: 'Rating must be "up" or "down".',
        code: 'INVALID_RATING',
      });
    }

    // Verify query belongs to this user
    const queryCheck = await db.query(
      'SELECT id FROM queries WHERE id = $1 AND user_id = $2',
      [queryId, userId]
    );

    if (queryCheck.rows.length === 0) {
      return res.status(404).json({
        error: 'Query not found.',
        code: 'QUERY_NOT_FOUND',
      });
    }

    // Upsert feedback (allow updating if user changes their mind)
    await db.query(`
      INSERT INTO feedback (query_id, user_id, rating, comment, created_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (query_id, user_id)
      DO UPDATE SET rating = $3, comment = $4, updated_at = NOW()
    `, [queryId, userId, rating, comment?.trim() || null]);

    await auditLog({
      type: 'FEEDBACK_SUBMITTED',
      userId,
      queryId,
      rating,
      hasComment: !!comment,
    });

    logger.info(`Feedback received: ${rating}`, { queryId, userId });

    res.json({ success: true, message: 'Feedback recorded. Thank you.' });

  } catch (error) {
    next(error);
  }
});
