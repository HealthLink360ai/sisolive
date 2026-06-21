const express = require('express');
const { handleQuery } = require('../services/rag.service');
const { query } = require('../config/database');
const { checkDailyLimit } = require('../middleware/rateLimit');
const { logger } = require('../utils/logger');
const router = express.Router();

// POST /api/chat — main chat endpoint (also accepts /query for backwards compat)
async function chatHandler(req, res) {
  const { question, conversationHistory } = req.body;
  const userId = req.user.id;

  if (!question || question.trim().length < 3) {
    return res.status(400).json({ error: 'Please ask a complete question.' });
  }

  if (question.length > 500) {
    return res.status(400).json({ error: 'Question too long. Please keep it under 500 characters.' });
  }

  try {
    const result = await handleQuery(question.trim(), userId, conversationHistory || []);
    res.json(result);
  } catch (error) {
    logger.error({ error, userId, question: question.slice(0, 100) }, 'Chat query failed');
    // Return the real error message so failures are diagnosable
    res.status(500).json({ error: error.message || 'Failed to process your question. Please try again.' });
  }
}

router.post('/', checkDailyLimit, chatHandler);
router.post('/query', checkDailyLimit, chatHandler);

// POST /api/chat/feedback — thumbs up/down on a response
router.post('/feedback', async (req, res) => {
  const { queryId, rating, comment } = req.body;
  const userId = req.user.id;

  if (!queryId || !['up', 'down'].includes(rating)) {
    return res.status(400).json({ error: 'Valid queryId and rating (up/down) required.' });
  }

  try {
    await query(`
      INSERT INTO feedback (query_id, user_id, rating, comment)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT DO NOTHING
    `, [queryId, userId, rating, comment || null]);

    logger.info({ userId, queryId, rating }, 'Feedback recorded');
    res.json({ success: true, message: 'Thank you for your feedback.' });
  } catch (error) {
    logger.error({ error }, 'Failed to save feedback');
    res.status(500).json({ error: 'Failed to save feedback.' });
  }
});

module.exports = router;
