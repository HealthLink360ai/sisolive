const express = require('express');
const { requireAdmin } = require('../middleware/auth');
const { query } = require('../config/database');
const { logger } = require('../utils/logger');
const router = express.Router();

// All admin routes require admin role
router.use(requireAdmin);

// GET /api/admin/dashboard — summary metrics
router.get('/dashboard', async (req, res) => {
  const currentMonth = new Date().toISOString().slice(0, 7);
  try {
    const [users, queries, spend, escalations] = await Promise.all([
      query('SELECT COUNT(*) FROM users WHERE last_active > NOW() - INTERVAL \'30 days\''),
      query('SELECT COUNT(*) FROM queries WHERE created_at > NOW() - INTERVAL \'30 days\''),
      query('SELECT estimated_cost_usd, query_count FROM spend_tracking WHERE month = $1', [currentMonth]),
      query('SELECT COUNT(*) FROM queries WHERE was_escalated = true AND created_at > NOW() - INTERVAL \'30 days\''),
    ]);

    const totalQueries = parseInt(queries.rows[0].count);
    const totalEscalations = parseInt(escalations.rows[0].count);

    res.json({
      activeUsers: parseInt(users.rows[0].count),
      totalQueries,
      escalationRate: totalQueries > 0 ? ((totalEscalations / totalQueries) * 100).toFixed(1) : 0,
      monthlySpend: parseFloat(spend.rows[0]?.estimated_cost_usd || 0).toFixed(2),
      monthlyBudget: process.env.MONTHLY_BUDGET_CAP_USD || 100,
    });
  } catch (error) {
    logger.error({ error }, 'Dashboard query failed');
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// GET /api/admin/analytics/top-queries
router.get('/analytics/top-queries', async (req, res) => {
  try {
    const result = await query(`
      SELECT question, COUNT(*) as count
      FROM queries
      WHERE created_at > NOW() - INTERVAL '30 days'
      GROUP BY question
      ORDER BY count DESC
      LIMIT 10
    `);
    res.json(result.rows);
  } catch (error) {
    logger.error({ error }, 'Top queries fetch failed');
    res.status(500).json({ error: 'Failed to load top queries' });
  }
});

// GET /api/admin/analytics/escalations
router.get('/analytics/escalations', async (req, res) => {
  try {
    const result = await query(`
      SELECT question, confidence_score, created_at
      FROM queries
      WHERE was_escalated = true AND created_at > NOW() - INTERVAL '30 days'
      ORDER BY created_at DESC
      LIMIT 50
    `);
    res.json(result.rows);
  } catch (error) {
    logger.error({ error }, 'Escalations fetch failed');
    res.status(500).json({ error: 'Failed to load escalations' });
  }
});

// GET /api/admin/analytics/feedback
router.get('/analytics/feedback', async (req, res) => {
  try {
    const result = await query(`
      SELECT f.rating, f.comment, q.question, f.created_at
      FROM feedback f
      JOIN queries q ON f.query_id = q.id
      WHERE f.created_at > NOW() - INTERVAL '30 days'
      ORDER BY f.created_at DESC
      LIMIT 100
    `);
    res.json(result.rows);
  } catch (error) {
    logger.error({ error }, 'Feedback fetch failed');
    res.status(500).json({ error: 'Failed to load feedback' });
  }
});

// GET /api/admin/documents
router.get('/documents', async (req, res) => {
  try {
    const result = await query(`
      SELECT d.id, d.filename, d.file_type, d.file_size_bytes, d.chunk_count,
             d.status, d.uploaded_at, d.processed_at, u.name as uploaded_by
      FROM documents d
      LEFT JOIN users u ON d.uploaded_by = u.id
      ORDER BY d.uploaded_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    logger.error({ error }, 'Documents fetch failed');
    res.status(500).json({ error: 'Failed to load documents' });
  }
});

module.exports = router;
