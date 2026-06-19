const Redis = require('ioredis');
const { logger } = require('../utils/logger');
let redis = null;

async function initRedis() {
  if (!process.env.REDIS_URL) {
    logger.warn('REDIS_URL not set — Redis cache disabled, continuing without it');
    return null;
  }
  try {
    redis = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => times > 3 ? null : Math.min(times * 200, 2000),
    });
    redis.on('error', (err) => logger.error({ err }, 'Redis error'));
    await redis.ping();
    return redis;
  } catch (err) {
    logger.warn({ err }, 'Redis unavailable — cache disabled, continuing without it');
    redis = null;
    return null;
  }
}

function getRedis() {
  return redis; // may be null if Redis is unavailable
}

async function cacheAnswer(hash, data) {
  if (!redis) return;
  try {
    const ttl = parseInt(process.env.CACHE_TTL_SECONDS) || 86400;
    await redis.setex(`answer:${hash}`, ttl, JSON.stringify(data));
  } catch (err) {
    logger.warn({ err }, 'Cache write failed');
  }
}

async function getCachedAnswer(hash) {
  if (!redis) return null;
  try {
    const cached = await redis.get(`answer:${hash}`);
    return cached ? JSON.parse(cached) : null;
  } catch (err) {
    logger.warn({ err }, 'Cache read failed');
    return null;
  }
}

async function invalidateAnswerCache() {
  if (!redis) return;
  try {
    const keys = await redis.keys('answer:*');
    if (keys.length > 0) {
      await redis.del(...keys);
      logger.info(`Cache invalidated: ${keys.length} answers cleared`);
    }
  } catch (err) {
    logger.warn({ err }, 'Cache invalidation failed');
  }
}

module.exports = { initRedis, getRedis, cacheAnswer, getCachedAnswer, invalidateAnswerCache };
