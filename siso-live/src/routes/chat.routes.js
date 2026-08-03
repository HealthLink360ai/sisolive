const express = require('express');
const { handleQuery } = require('../services/rag.service');
const { query } = require('../config/database');
const { checkDailyLimit } = require('../middleware/rateLimit');
const { logger } = require('../utils/logger');
const router = express.Router();

// POST /api/chat — main chat endpoint (also accepts /query for backwards compat)
async function chatHandler(req, res) {
  const { question, conversationHistory, bypassCache } = req.body;
  const userId = req.user.id;

  if (!question || question.trim().length < 3) {
    return res.status(400).json({ error: 'Please ask a complete question.' });
  }

  if (question.length > 500) {
    return res.status(400).json({ error: 'Question too long. Please keep it under 500 characters.' });
  }

  try {
    const result = await handleQuery(question.trim(), userId, conversationHistory || [], { bypassCache: Boolean(bypassCache) });
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
