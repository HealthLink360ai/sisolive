/**
 * SISO Live! — Backend Entry Point
 * 
 * What this file does: Starts the server, wires up all the middleware
 * and routes, and connects to all external services on startup.
 * 
 * Think of this as the front door of the building — everything passes
 * through here, but the actual work happens in the rooms behind it.
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { logger } = require('./utils/logger');
const { connectDatabase } = require('./config/database');
const { initPinecone } = require('./config/pinecone');
const { initRedis } = require('./config/redis');

// Routes
const authRoutes = require('./routes/auth.routes');
const chatRoutes = require('./routes/chat.routes');
const uploadRoutes = require('./routes/upload.routes');
const adminRoutes = require('./routes/admin.routes');

// Middleware
const { authenticateToken } = require('./middleware/auth');
const { rateLimiter } = require('./middleware/rateLimit');
const { requestLogger } = require('./middleware/logging');
const { spendingGuard } = require('./middleware/spendingGuard');

const app = express();
const PORT = process.env.PORT || 3001;

// Safety net for any promise rejection that isn't caught locally.
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
});

// We run behind exactly one reverse proxy hop (Vercel's edge). Without this,
// express-rate-limit can't trust X-Forwarded-For to reflect the real client,
// either throwing or silently keying every request off one shared IP.
app.set('trust proxy', 1);

// ============================================
// SECURITY MIDDLEWARE
// Decision: Helmet adds 14 security headers automatically.
// For a pharma client, this is non-negotiable baseline.
// Cost: Zero. Just code.
// ============================================
app.use(helmet());

// Fail closed in production: the localhost fallback exists only for local
// dev. If ALLOWED_ORIGINS isn't set in production, refuse to start rather
// than silently trusting localhost with credentials.
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

if (process.env.NODE_ENV === 'production' && (!allowedOrigins || allowedOrigins.length === 0)) {
  throw new Error(
    'ALLOWED_ORIGINS must be set in production (comma-separated list of trusted origins). ' +
    'Refusing to start with an open/localhost CORS fallback.'
  );
}

app.use(cors({
  origin: allowedOrigins || ['http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ============================================
// LOGGING MIDDLEWARE
// Decision: Every request logged with structured JSON.
// For pharma compliance, you need a full audit trail.
// Logs include: timestamp, user, endpoint, status, duration.
// ============================================
app.use(requestLogger);

// ============================================
// RATE LIMITING
// Decision: 50 queries/day per user, 10/minute global.
// Prevents runaway costs and ensures fair usage.
// If one person hammers the API, others aren't affected.
//
// Mounted AFTER authenticateToken (see ROUTES section below) so req.user
// is populated before the limiter's keyGenerator runs — otherwise every
// request keys on req.ip and the whole org shares one bucket.
// ============================================

// ============================================
// SPENDING GUARD
// Decision: Hard monthly cap at $100.
// If we approach the limit, queries return a friendly
// "capacity reached" message instead of failing silently.
// AbbVie's CFO will love this when you explain it.
//
// Also mounted after authenticateToken, alongside the rate limiter, below.
// ============================================

// ============================================
// ROUTES
// Public routes (no auth needed): /api/auth
// Protected routes (JWT required): everything else
// Admin routes (admin role required): /api/admin
// ============================================
app.use('/api/auth', authRoutes);
app.use('/api/chat', authenticateToken, rateLimiter, spendingGuard, chatRoutes);
app.use('/api/upload', authenticateToken, uploadRoutes);
app.use('/api/admin', authenticateToken, adminRoutes);

// Health check — used by Vercel and monitoring tools
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'SISO Live! API',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

// Global error handler — catches anything that slips through.
// Always return a generic message to the client; the full error is logged
// server-side via the existing logger. This avoids leaking DB/driver
// internals if NODE_ENV is ever misconfigured in production.
app.use((err, req, res, next) => {
  logger.error({ err, url: req.url, method: req.method }, 'Unhandled error');
  res.status(err.status || 500).json({
    error: 'An unexpected error occurred',
  });
});

// ============================================
// STARTUP — Connect to all services before
// accepting any traffic. If Pinecone or Postgres
// is down, we fail loudly rather than serving
// broken responses silently.
// ============================================
async function startServer() {
  try {
    logger.info('Starting SISO Live! backend...');

    await connectDatabase();
    logger.info('✓ PostgreSQL connected');

    try {
      await initPinecone();
      logger.info('✓ Pinecone vector database connected');
      // Auto re-index any documents that were uploaded while Pinecone was unavailable
      autoReindexPending().catch(err => logger.warn({ err }, 'Auto re-index check failed'));
    } catch (err) {
      logger.warn({ err }, '⚠ Pinecone unavailable — RAG search disabled, continuing');
    }

    try {
      await initRedis();
      logger.info('✓ Redis cache connected');
    } catch (err) {
      logger.warn({ err }, '⚠ Redis unavailable — answer caching disabled, continuing');
    }

    app.listen(PORT, () => {
      logger.info(`✓ SISO Live! API running on port ${PORT}`);
      logger.info(`  Environment: ${process.env.NODE_ENV}`);
      logger.info(`  Confidence threshold: ${process.env.CONFIDENCE_THRESHOLD}`);
      logger.info(`  Monthly budget cap: $${process.env.MONTHLY_BUDGET_CAP_USD}`);
    });
  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  }
}

async function autoReindexPending() {
  const { query } = require('./config/database');
  const { reindexDocument } = require('./services/ingestion.service');
  const pending = await query(
    "SELECT id, filename FROM documents WHERE has_vectors = false AND raw_text IS NOT NULL AND status = 'active'"
  );
  if (pending.rows.length === 0) return;
  logger.info({ count: pending.rows.length }, 'Auto re-indexing documents that were pending vector storage');
  for (const doc of pending.rows) {
    try {
      await reindexDocument(doc.id);
      logger.info({ documentId: doc.id, filename: doc.filename }, 'Auto re-index complete');
    } catch (err) {
      logger.warn({ err, documentId: doc.id }, 'Auto re-index failed for document');
    }
  }
}

startServer();

module.exports = app;
