/**
 * Rate Limiting Middleware
 * 
 * What this does: Limits how many queries a single user can make.
 * 
 * Plain English: Imagine one overly enthusiastic employee asking
 * 500 questions in one day. Without this, they'd burn through
 * AbbVie's entire monthly API budget in an afternoon.
 * This ensures fair usage across the entire team and predictable costs.
 * 
 * Settings: 50 queries/day per user, 10 queries/minute globally.
 * Both are configurable in .env without code changes.
 */

const rateLimit = require('express-rate-limit');
const { getRedis } = require('../config/redis');
const { logger } = require('../utils/logger');

// Global rate limiter — applies to all chat requests
const rateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: parseInt(process.env.MAX_QUERIES_PER_MINUTE) || 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.user?.role === 'admin',
  keyGenerator: (req) => req.user?.id || req.ip, // Limit per user, not per IP
  handler: (req, res) => {
    logger.warn({ userId: req.user?.id }, 'Rate limit exceeded');
    res.status(429).json({
      error: 'Too many requests. Please wait a moment before asking another question.',
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter: 60,
    });
  },
});

// Daily query limit checker — uses Redis to track per-user daily usage
async function checkDailyLimit(req, res, next) {
  const userId = req.user?.id;
  if (!userId) return next();
  if (req.user?.role === 'admin') return next();

  try {
    const redis = getRedis();
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const key = `daily:${userId}:${today}`;
    const dailyLimit = parseInt(process.env.DAILY_QUERY_LIMIT_PER_USER) || 50;

    const current = await redis.incr(key);
    
    // Set expiry on first use (expires at midnight)
    if (current === 1) {
      const secondsUntilMidnight = Math.floor(
        (new Date().setHours(24, 0, 0, 0) - Date.now()) / 1000
      );
      await redis.expire(key, secondsUntilMidnight);
    }

    if (current > dailyLimit) {
      logger.warn({ userId, dailyCount: current, limit: dailyLimit }, 'Daily limit exceeded');
      return res.status(429).json({
        error: `You've reached your daily limit of ${dailyLimit} questions. Your limit resets at midnight.`,
        code: 'DAILY_LIMIT_EXCEEDED',
        queriesUsed: current - 1,
        dailyLimit,
      });
    }

    // Add usage info to request for logging
    req.dailyQueryCount = current;
    next();
  } catch (error) {
    // Fail closed: if Redis is down we can't verify the daily cap, so don't
    // let the request through unchecked — that would defeat the whole
    // limit. A brief 503 is a better trade-off than unbounded usage.
    logger.error({ error }, 'Daily limit check failed — blocking request until service recovers');
    res.status(503).json({
      error: 'Service temporarily unavailable. Please try again shortly.',
      code: 'DAILY_LIMIT_CHECK_UNAVAILABLE',
    });
  }
}

module.exports = { rateLimiter, checkDailyLimit };
