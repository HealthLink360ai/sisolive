const express = require('express');
const { requireAdmin } = require('../middleware/auth');
const { query } = require('../config/database');
const { logger } = require('../utils/logger');
const router = express.Router();

// All admin routes require admin role
router.use(requireAdmin);

// GET /api/admin/stats + /api/admin/dashboard — summary metrics
async function dashboardHandler(req, res) {
  const currentMonth = new Date().toISOString().slice(0, 7);
  try {
    const [users, queries, spend, escalations, avgConfResult, topQueriesResult, gapsResult] = await Promise.all([
      query('SELECT COUNT(*) FROM users WHERE last_active > NOW() - INTERVAL \'30 days\''),
      query('SELECT COUNT(*) FROM queries WHERE created_at > NOW() - INTERVAL \'30 days\''),
      query('SELECT estimated_cost_usd, query_count FROM spend_tracking WHERE month = $1', [currentMonth]),
      query('SELECT COUNT(*) FROM queries WHERE was_escalated = true AND created_at > NOW() - INTERVAL \'30 days\''),
      query('SELECT ROUND(AVG(confidence_score) * 100) AS avg_conf FROM queries WHERE created_at > NOW() - INTERVAL \'30 days\' AND confidence_score IS NOT NULL'),
      query(`
        SELECT question, COUNT(*) AS count
        FROM queries
        WHERE created_at > NOW() - INTERVAL '30 days'
          AND was_escalated = false
          AND answer IS NOT NULL
        GROUP BY question
        ORDER BY count DESC
        LIMIT 10
      `),
      query(`
        SELECT question, COUNT(*) AS count
        FROM queries
        WHERE created_at > NOW() - INTERVAL '30 days'
          AND (was_escalated = true OR confidence_score < 0.25)
        GROUP BY question
        ORDER BY count DESC
        LIMIT 10
      `),
    ]);

    const totalQueries = parseInt(queries.rows[0].count);
    const totalEscalations = parseInt(escalations.rows[0].count);
    const topQRows = topQueriesResult.rows;
    const maxCount = topQRows.length > 0 ? parseInt(topQRows[0].count) : 1;
    const topQueries = topQRows.map(r => [
      r.question,
      parseInt(r.count),
      Math.max(8, Math.round((parseInt(r.count) / maxCount) * 100)),
    ]);

    const knowledgeGaps = gapsResult.rows.map(r => [r.question, parseInt(r.count)]);

    res.json({
      activeUsers: parseInt(users.rows[0].count),
      totalQueries,
      escalationRate: totalQueries > 0 ? ((totalEscalations / totalQueries) * 100).toFixed(1) : 0,
      monthlySpend: parseFloat(spend.rows[0]?.estimated_cost_usd || 0).toFixed(2),
      monthlyBudget: process.env.MONTHLY_BUDGET_CAP_USD || 100,
      avgConfidence: avgConfResult.rows[0]?.avg_conf ?? null,
      topQueries,
      knowledgeGaps,
      insightLabels: {
        topQueries: 'Answered demand',
        knowledgeGaps: 'Needs review',
      },
    });
  } catch (error) {
    logger.error({ error }, 'Dashboard query failed');
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
}
router.get('/dashboard', dashboardHandler);
router.get('/stats', dashboardHandler);

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

// GET /api/admin/users
router.get('/users', async (req, res) => {
  try {
    const result = await query(`
      SELECT
        u.id,
        u.email,
        u.name,
        u.role,
        u.department,
        u.first_login,
        u.created_at,
        u.last_active,
        COUNT(q.id)::int AS query_count
      FROM users u
      LEFT JOIN queries q
        ON q.user_id = u.id
       AND q.created_at > NOW() - INTERVAL '30 days'
      GROUP BY u.id
      ORDER BY u.last_active DESC NULLS LAST
      LIMIT 100
    `);
    res.json(result.rows.map(user => ({
      ...user,
      queryCount: user.query_count,
      lastActive: user.last_active,
      is_admin: user.role === 'admin',
    })));
  } catch (error) {
    logger.error({ error }, 'Users fetch failed');
    res.status(500).json({ error: 'Failed to load users' });
  }
});

// GET /api/admin/documents
router.get('/documents', async (req, res) => {
  try {
    const result = await query(`
      SELECT d.id, d.filename, d.file_type, d.file_size_bytes, d.chunk_count,
             d.status, d.has_vectors, d.uploaded_at, d.processed_at, u.name as uploaded_by
      FROM documents d
      LEFT JOIN users u ON d.uploaded_by = u.id
      WHERE d.status <> 'archived'
      ORDER BY d.uploaded_at DESC
    `);
    res.json(result.rows.map(doc => ({
      ...doc,
      name: doc.filename,
      chunks: doc.chunk_count,
      size: doc.file_size_bytes
        ? `${(doc.file_size_bytes / 1024 / 1024).toFixed(1)} MB`
        : '',
    })));
  } catch (error) {
    logger.error({ error }, 'Documents fetch failed');
    res.status(500).json({ error: 'Failed to load documents' });
  }
});

// DELETE /api/admin/documents/:id
router.delete('/documents/:id', async (req, res) => {
  try {
    const result = await query(
      'DELETE FROM documents WHERE id = $1 RETURNING id, filename',
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Document not found' });
    logger.info({ documentId: req.params.id, adminId: req.user.id }, 'Document deleted');
    res.json({ success: true, deleted: result.rows[0] });
  } catch (error) {
    logger.error({ error }, 'Document delete failed');
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

// GET /api/admin/diagnostics — system health check: Pinecone + Cohere + test query
router.get('/diagnostics', async (req, res) => {
  const {
    ensurePineconeIndex,
    getPineconeEnvStatus,
    getLastPineconeInitError,
  } = require('../config/pinecone');
  const { embedText } = require('../services/embedding.service');

  const report = {
    timestamp: new Date().toISOString(),
    pinecone: {
      status: 'unknown',
      vectorCount: null,
      error: null,
      env: getPineconeEnvStatus(),
      lastInitError: getLastPineconeInitError(),
    },
    cohere: { status: 'unknown', error: null },
    testQuery: null,
  };

  try {
    const index = await ensurePineconeIndex();
    const stats = await index.describeIndexStats();
    report.pinecone.status = 'connected';
    report.pinecone.vectorCount = stats.totalRecordCount ?? stats.totalVectorCount ?? 0;
    report.pinecone.lastInitError = null;
  } catch (e) {
    report.pinecone.status = 'error';
    report.pinecone.error = e.message;
    report.pinecone.lastInitError = getLastPineconeInitError();
  }

  try {
    const testVector = await embedText('What is supplier inclusion?', 'search_query');
    report.cohere.status = 'connected';

    if (report.pinecone.status === 'connected') {
      const index = await ensurePineconeIndex();
      const result = await index.query({ vector: testVector, topK: 3, includeMetadata: true });
      report.testQuery = {
        question: 'What is supplier inclusion?',
        matches: (result.matches || []).map(m => ({
          score: parseFloat(m.score.toFixed(4)),
          source: m.metadata?.filename,
          preview: (m.metadata?.text || '').slice(0, 200),
        })),
      };
    }
  } catch (e) {
    report.cohere.status = 'error';
    report.cohere.error = e.message;
  }

  res.json({
    timestamp: new Date().toISOString(),
    config: {
      confidenceThreshold: process.env.CONFIDENCE_THRESHOLD || '(not set — using 0.40 default)',
      pineconeIndex: process.env.PINECONE_INDEX_NAME || '(not set — using siso-live-prod)',
    },
    pinecone: report.pinecone,
    cohere: report.cohere,
    testQuery: report.testQuery,
  });
});

// POST /api/admin/documents/:id/reingest — re-index from stored raw text
router.post('/documents/:id/reingest', async (req, res) => {
  const { reindexDocument } = require('../services/ingestion.service');
  try {
    const result = await reindexDocument(req.params.id);
    logger.info({ documentId: req.params.id, adminId: req.user.id }, 'Document re-indexed by admin');
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error({ error }, 'Document re-index failed');
    res.status(500).json({ error: error.message || 'Re-index failed' });
  }
});

// POST /api/admin/upload — proxies to the upload service (multer handled there)
const uploadRouter = require('./upload.routes');
router.use('/upload', uploadRouter);

module.exports = router;
