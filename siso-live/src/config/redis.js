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
  if (!redis) throw new Error('Redis not initialized');
  return redis;
}

async function cacheAnswer(hash, data) {
  const ttl = parseInt(process.env.CACHE_TTL_SECONDS) || 86400;
  await getRedis().setex(`answer:${hash}`, ttl, JSON.stringify(data));
}

async function getCachedAnswer(hash) {
  const cached = await getRedis().get(`answer:${hash}`);
  return cached ? JSON.parse(cached) : null;
}

async function invalidateAnswerCache() {
  const keys = await getRedis().keys('answer:*');
  if (keys.length > 0) {
    await getRedis().del(...keys);
    logger.info(`Cache invalidated: ${keys.length} answers cleared`);
  }
}

module.exports = { initRedis, getRedis, cacheAnswer, getCachedAnswer, invalidateAnswerCache };
