const express = require('express');
const { handleQuery } = require('../services/rag.service');
const { query } = require('../config/database');
const { checkDailyLimit } = require('../middleware/rateLimit');
const { logger } = require('../utils/logger');
const router = express.Router();

// conversationHistory is client-supplied and otherwise unbounded — without
// caps here, a caller hitting the API directly (not through the UI, which
// only ever sends real prior turns) could pad every request with hundreds
// of KB of history, multiplying real per-query token cost against the
// MONTHLY_BUDGET_CAP_USD guarantee. Also strips any role other than
// user/assistant, since the client fully controls this array — nothing
// stops a caller from injecting a fake prior "assistant" turn otherwise.
const MAX_HISTORY_TURNS = 10;
const MAX_HISTORY_MESSAGE_CHARS = 2000;
function sanitizeConversationHistory(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_HISTORY_TURNS)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_HISTORY_MESSAGE_CHARS) }));
}

// POST /api/chat — main chat endpoint (also accepts /query for backwards compat)
async function chatHandler(req, res) {
  const { question } = req.body;
  const userId = req.user.id;

  if (!question || question.trim().length < 3) {
    return res.status(400).json({ error: 'Please ask a complete question.' });
  }

  if (question.length > 500) {
    return res.status(400).json({ error: 'Question too long. Please keep it under 500 characters.' });
  }

  const conversationHistory = sanitizeConversationHistory(req.body.conversationHistory);
  // Only admins can force a fresh (uncached) generation — bypassing the 24h
  // answer cache on every request would forfeit the cost savings it exists
  // for if any authenticated user could flip this.
  const bypassCache = Boolean(req.body.bypassCache) && req.user.role === 'admin';

  try {
    const result = await handleQuery(question.trim(), userId, conversationHistory, { bypassCache });
    res.json(result);
  } catch (error) {
    logger.error({ error, userId, questionLength: question?.length || 0 }, 'Chat query failed');
    // Log the real error server-side; never echo internals to the client
    res.status(500).json({ error: 'Failed to process your question. Please try again.' });
  }
}

router.post('/', checkDailyLimit, chatHandler);
router.post('/query', checkDailyLimit, chatHandler);

// POST /api/chat/feedback — thumbs up/down on a response
router.post('/feedback', async (req, res) => {
  const { queryId, messageId, rating, type, comment } = req.body;
  const feedbackQueryId = queryId || messageId;
  const feedbackRating = rating || type;
  const userId = req.user.id;

  if (!feedbackQueryId || !['up', 'down'].includes(feedbackRating)) {
    return res.status(400).json({ error: 'Valid queryId and rating (up/down) required.' });
  }

  try {
    const ownerCheck = await query(
      'SELECT id FROM queries WHERE id = $1 AND user_id = $2',
      [feedbackQueryId, userId]
    );

    if (ownerCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Query not found.' });
    }

    await query(`
      INSERT INTO feedback (query_id, user_id, rating, comment)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT DO NOTHING
    `, [feedbackQueryId, userId, feedbackRating, comment || null]);

    logger.info({ userId, queryId: feedbackQueryId, rating: feedbackRating }, 'Feedback recorded');
    res.json({ success: true, message: 'Thank you for your feedback.' });
  } catch (error) {
    logger.error({ error }, 'Failed to save feedback');
    res.status(500).json({ error: 'Failed to save feedback.' });
  }
});

module.exports = router;
