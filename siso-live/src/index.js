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

// ============================================
// SECURITY MIDDLEWARE
// Decision: Helmet adds 14 security headers automatically.
// For a pharma client, this is non-negotiable baseline.
// Cost: Zero. Just code.
// ============================================
app.use(helmet());

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
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
// ============================================
app.use('/api/chat', rateLimiter);

// ============================================
// SPENDING GUARD
// Decision: Hard monthly cap at $100.
// If we approach the limit, queries return a friendly
// "capacity reached" message instead of failing silently.
// AbbVie's CFO will love this when you explain it.
// ============================================
app.use('/api/chat', spendingGuard);

// ============================================
// ROUTES
// Public routes (no auth needed): /api/auth
// Protected routes (JWT required): everything else
// Admin routes (admin role required): /api/admin
// ============================================
app.use('/api/auth', authRoutes);
app.use('/api/chat', authenticateToken, chatRoutes);
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

// Global error handler — catches anything that slips through
app.use((err, req, res, next) => {
  logger.error({ err, url: req.url, method: req.method }, 'Unhandled error');
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'An unexpected error occurred'
      : err.message,
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

startServer();

module.exports = app;
