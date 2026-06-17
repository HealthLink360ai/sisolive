const Redis = require('ioredis');
const { logger } = require('../utils/logger');
let redis = null;

async function initRedis() {
  redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => times > 3 ? null : Math.min(times * 200, 2000),
  });
  redis.on('error', (err) => logger.error({ err }, 'Redis error'));
  await redis.ping();
  return redis;
}

function getRedis() {
  return redis; // may be null if unavailable
}

async function cacheAnswer(hash, data) {
  if (!redis) return;
  const ttl = parseInt(process.env.CACHE_TTL_SECONDS) || 86400;
  await redis.setex(`answer:${hash}`, ttl, JSON.stringify(data));
}

async function getCachedAnswer(hash) {
  if (!redis) return null;
  const cached = await redis.get(`answer:${hash}`);
  return cached ? JSON.parse(cached) : null;
}

async function invalidateAnswerCache() {
  if (!redis) return;
  const keys = await redis.keys('answer:*');
  if (keys.length > 0) {
    await redis.del(...keys);
    logger.info(`Cache invalidated: ${keys.length} answers cleared`);
  }
}

module.exports = { initRedis, getRedis, cacheAnswer, getCachedAnswer, invalidateAnswerCache };
