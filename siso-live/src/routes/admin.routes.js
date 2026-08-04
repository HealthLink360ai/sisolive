const express = require('express');
const bcrypt = require('bcryptjs');
const { requireAdmin } = require('../middleware/auth');
const { query } = require('../config/database');
const { getRedis } = require('../config/redis');
const { logger } = require('../utils/logger');
const { logAudit } = require('../utils/auditLog');
const router = express.Router();

// All admin routes require admin role
router.use(requireAdmin);

function isDomainRelevantQuestion(question) {
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
  if (blocked.some(term => text.includes(term))) return false;

  const domainTerms = [
    'abbvie',
    'siso',
    'supplier',
    'sustainability',
    'inclusion',
    'underrepresented',
    'diverse',
    'diversity',
    'procurement',
    'sourcing',
    'vendor',
    'business',
  ];
  return domainTerms.some(term => text.includes(term));
}

function questionTokens(question) {
  const stopWords = new Set(['what', 'is', 'are', 'the', 'a', 'an', 'and', 'or', 'of', 'to', 'how', 'does', 'do', 'abbvie']);
  return String(question || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(token => token && !stopWords.has(token));
}

function isSimilarQuestion(a, b) {
  const aTokens = new Set(questionTokens(a));
  const bTokens = new Set(questionTokens(b));
  if (aTokens.size === 0 || bTokens.size === 0) return false;

  const shared = [...aTokens].filter(token => bTokens.has(token)).length;
  const smaller = Math.min(aTokens.size, bTokens.size);
  return shared / smaller >= 0.67;
}

// Merges rows whose questions are near-duplicates (different phrasing of the
// same underlying question) so admin panels show one representative row with
// a combined count, rather than several fragmented low-count rows. Rows
// should already be sorted by count desc — the highest-count phrasing in
// each cluster becomes that cluster's label.
function mergeSimilarQuestions(rows) {
  const merged = [];
  for (const row of rows) {
    const count = parseInt(row.count);
    const existing = merged.find(m => isSimilarQuestion(m.question, row.question));
    if (existing) {
      existing.count += count;
    } else {
      merged.push({ question: row.question, count });
    }
  }
  return merged.sort((a, b) => b.count - a.count);
}

// GET /api/admin/stats + /api/admin/dashboard — summary metrics
async function dashboardHandler(req, res) {
  const currentMonth = new Date().toISOString().slice(0, 7);
  try {
    const [users, queries, spend, escalations, avgConfResult, topQueriesResult, gapsResult] = await Promise.all([
      query('SELECT COUNT(DISTINCT user_id) FROM queries WHERE created_at > NOW() - INTERVAL \'30 days\''),
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
        LIMIT 50
      `),
      query(`
        SELECT question, COUNT(*) AS count
        FROM queries
        WHERE created_at > NOW() - INTERVAL '30 days'
          AND (was_escalated = true OR confidence_score < 0.25)
        GROUP BY question
        ORDER BY count DESC
        LIMIT 50
      `),
    ]);

    const totalQueries = parseInt(queries.rows[0].count);
    const totalEscalations = parseInt(escalations.rows[0].count);

    // "Answered demand" stays curated to genuine domain topics — a stray
    // off-topic test question shouldn't clutter what this panel is for.
    const topQMerged = mergeSimilarQuestions(topQueriesResult.rows)
      .filter(r => isDomainRelevantQuestion(r.question))
      .slice(0, 10);
    const maxCount = topQMerged.length > 0 ? topQMerged[0].count : 1;
    const topQueries = topQMerged.map(r => [
      r.question,
      r.count,
      Math.max(8, Math.round((r.count / maxCount) * 100)),
    ]);

    // "Needs review" is deliberately NOT filtered by isDomainRelevantQuestion —
    // that filter is a crude keyword allowlist that can silently hide real
    // content gaps (a natural follow-up question rarely repeats a keyword like
    // "supplier" or "sourcing"). This is the one panel whose entire purpose is
    // surfacing what's missing, so admins should see everything that actually
    // escalated or scored low, and judge relevance themselves.
    const knowledgeGaps = mergeSimilarQuestions(gapsResult.rows)
      .filter(r => !topQMerged.some(top => isSimilarQuestion(r.question, top.question)))
      .slice(0, 10)
      .map(r => [r.question, r.count]);

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
      SELECT q.id, q.question, q.confidence_score, q.created_at,
             q.user_id, u.name AS user_name, u.email AS user_email, u.department AS user_department
      FROM queries q
      JOIN users u ON u.id = q.user_id
      WHERE q.was_escalated = true AND q.created_at > NOW() - INTERVAL '30 days'
      ORDER BY q.created_at DESC
      LIMIT 50
    `);
    // No domain-relevance filter here — this is the raw escalation list, and
    // admins should see everything that escalated, not have some silently
    // dropped by a keyword heuristic. See dashboardHandler's knowledgeGaps
    // for the same reasoning.
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
      SELECT f.rating, f.comment, f.created_at, q.question, q.id AS query_id,
             f.user_id, u.name AS user_name, u.email AS user_email, u.department AS user_department
      FROM feedback f
      JOIN queries q ON f.query_id = q.id
      JOIN users u ON u.id = f.user_id
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
        u.last_query_at,
        COUNT(q.id)::int AS query_count
      FROM users u
      LEFT JOIN queries q
        ON q.user_id = u.id
       AND q.created_at > NOW() - INTERVAL '30 days'
      GROUP BY u.id
      ORDER BY u.last_query_at DESC NULLS LAST
      LIMIT 100
    `);
    res.json(result.rows.map(user => ({
      ...user,
      queryCount: user.query_count,
      lastActive: user.last_active,
      lastQueryAt: user.last_query_at,
      is_admin: user.role === 'admin',
    })));
  } catch (error) {
    logger.error({ error }, 'Users fetch failed');
    res.status(500).json({ error: 'Failed to load users' });
  }
});

// GET /api/admin/users/:id/activity — per-user query/feedback drill-down
router.get('/users/:id/activity', async (req, res) => {
  const userId = req.params.id;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 20));
  const offset = (page - 1) * pageSize;
  try {
    const userResult = await query(
      `SELECT id, email, name, role, department, created_at, last_active, last_query_at FROM users WHERE id = $1`,
      [userId]
    );
    if (!userResult.rows[0]) return res.status(404).json({ error: 'User not found' });

    const [summaryResult, feedbackResult, historyResult] = await Promise.all([
      query(`
        SELECT
          COUNT(*)::int AS total_queries,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days')::int AS total_queries_30d,
          COUNT(*) FILTER (WHERE was_escalated = true)::int AS total_escalations,
          COUNT(*) FILTER (WHERE was_escalated = true AND created_at > NOW() - INTERVAL '30 days')::int AS escalations_30d,
          ROUND(AVG(confidence_score) * 100) AS avg_confidence,
          MAX(created_at) AS last_query_at
        FROM queries WHERE user_id = $1
      `, [userId]),
      query(`
        SELECT COUNT(*)::int AS feedback_count,
          COUNT(*) FILTER (WHERE rating = 'up')::int AS thumbs_up,
          COUNT(*) FILTER (WHERE rating = 'down')::int AS thumbs_down
        FROM feedback WHERE user_id = $1
      `, [userId]),
      query(`
        SELECT q.id, q.question, q.answer, q.confidence_score, q.was_escalated,
               q.response_time_ms, q.created_at, f.rating AS feedback_rating, f.comment AS feedback_comment
        FROM queries q
        LEFT JOIN feedback f ON f.query_id = q.id AND f.user_id = q.user_id
        WHERE q.user_id = $1
        ORDER BY q.created_at DESC
        LIMIT $2 OFFSET $3
      `, [userId, pageSize, offset]),
    ]);

    res.json({
      user: userResult.rows[0],
      summary: {
        totalQueries: summaryResult.rows[0].total_queries,
        totalQueries30d: summaryResult.rows[0].total_queries_30d,
        totalEscalations: summaryResult.rows[0].total_escalations,
        escalations30d: summaryResult.rows[0].escalations_30d,
        avgConfidence: summaryResult.rows[0].avg_confidence,
        feedbackGiven: feedbackResult.rows[0].feedback_count,
        thumbsUp: feedbackResult.rows[0].thumbs_up,
        thumbsDown: feedbackResult.rows[0].thumbs_down,
      },
      queries: {
        page, pageSize, total: summaryResult.rows[0].total_queries,
        rows: historyResult.rows.map(r => ({
          ...r,
          feedback: r.feedback_rating ? { rating: r.feedback_rating, comment: r.feedback_comment } : null,
        })),
      },
    });
  } catch (error) {
    logger.error({ error }, 'User activity fetch failed');
    res.status(500).json({ error: 'Failed to load user activity' });
  }
});

// POST /api/admin/users — create or reset a learner account for controlled demos
router.post('/users', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const name = String(req.body.name || '').trim();
  const department = String(req.body.department || 'SISO Pilot').trim();
  const password = String(req.body.password || '');
  const role = ['user', 'admin'].includes(req.body.role) ? req.body.role : 'user';

  if (!email.endsWith('@abbvie.com')) {
    return res.status(400).json({ error: 'Use an AbbVie email address for demo users.' });
  }
  if (!name) {
    return res.status(400).json({ error: 'Name is required.' });
  }
  if (password.length < 12) {
    return res.status(400).json({ error: 'Password must be at least 12 characters.' });
  }

  try {
    const existingResult = await query('SELECT id, role FROM users WHERE email = $1', [email]);
    const existingUser = existingResult.rows[0] || null;
    const confirmAdminOverwrite = req.body.confirmAdminOverwrite === true;

    if (existingUser && existingUser.role === 'admin' && !confirmAdminOverwrite) {
      return res.status(403).json({
        error: 'This email belongs to an existing admin account. Pass confirmAdminOverwrite: true to proceed.',
        code: 'ADMIN_OVERWRITE_REQUIRES_CONFIRMATION',
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await query(`
      INSERT INTO users (email, name, role, department, password_hash, first_login, last_active)
      VALUES ($1, $2, $3, $4, $5, true, NOW())
      ON CONFLICT (email) DO UPDATE SET
        name = EXCLUDED.name,
        role = EXCLUDED.role,
        department = EXCLUDED.department,
        password_hash = EXCLUDED.password_hash,
        first_login = true,
        last_active = NOW()
      RETURNING id, email, name, role, department, first_login, created_at, last_active
    `, [email, name, role, department, passwordHash]);

    logger.info({ adminId: req.user.id, demoUserId: result.rows[0].id, email }, 'Demo user created or reset');

    if (existingUser) {
      // An existing account's password was just reset — revoke any currently-valid
      // JWTs for that user so a stolen/forgotten session can't outlive the reset.
      try {
        const redis = getRedis();
        if (redis) {
          await redis.set('session_revoked:' + existingUser.id, Date.now().toString(), 'EX', 86400);
        }
      } catch (redisError) {
        logger.warn({ error: redisError, userId: existingUser.id }, 'Failed to revoke sessions after password reset');
      }
    }

    logAudit({
      userId: req.user.id,
      action: existingUser ? 'admin.user.reset' : 'admin.user.create',
      entityType: 'user',
      entityId: result.rows[0].id,
      metadata: { email, role },
      ipAddress: req.ip,
    }).catch(() => {});

    res.status(201).json({ user: result.rows[0] });
  } catch (error) {
    logger.error({ error, email }, 'Demo user create/reset failed');
    res.status(500).json({ error: 'Failed to create demo user.' });
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
    logAudit({
      userId: req.user.id,
      action: 'admin.document.delete',
      entityType: 'document',
      entityId: req.params.id,
      metadata: { filename: result.rows[0].filename },
      ipAddress: req.ip,
    }).catch(() => {});
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
      confidenceThreshold: process.env.CONFIDENCE_THRESHOLD || '(not set — using 0.25 default, capped at 0.35 max)',
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
    logAudit({
      userId: req.user.id,
      action: 'admin.document.reingest',
      entityType: 'document',
      entityId: req.params.id,
      metadata: {},
      ipAddress: req.ip,
    }).catch(() => {});
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error({ error }, 'Document re-index failed');
    res.status(500).json({ error: error.message || 'Re-index failed' });
  }
});

// Proxies to the upload service (multer handled there). Note: the frontend
// calls POST /api/upload/document directly, not through this admin mount.
const uploadRouter = require('./upload.routes');
router.use('/upload', uploadRouter);

module.exports = router;
