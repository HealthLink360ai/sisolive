const { Pinecone } = require('@pinecone-database/pinecone');
const { logger } = require('../utils/logger');
let pineconeIndex = null;
let lastPineconeInitError = null;

function getPineconeEnvStatus() {
  return {
    apiKeyPresent: Boolean(process.env.PINECONE_API_KEY),
    indexName: process.env.PINECONE_INDEX_NAME || 'siso-live-prod',
    environmentPresent: Boolean(process.env.PINECONE_ENVIRONMENT),
  };
}

async function initPinecone() {
  if (pineconeIndex) return pineconeIndex; // already initialized — safe to call repeatedly
  if (!process.env.PINECONE_API_KEY) {
    lastPineconeInitError = 'PINECONE_API_KEY is not configured';
    throw new Error(lastPineconeInitError);
  }

  const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  const indexName = process.env.PINECONE_INDEX_NAME || 'siso-live-prod';
  try {
    const existingIndexes = await pc.listIndexes();
    const indexes = Array.isArray(existingIndexes) ? existingIndexes : (existingIndexes.indexes || []);
    const indexExists = indexes.some(i => (typeof i === 'string' ? i : i.name) === indexName);

    if (!indexExists) {
      logger.info(`Creating Pinecone index: ${indexName}`);
      await pc.createIndex({
        name: indexName,
        dimension: 1024,
        metric: 'cosine',
        spec: { serverless: { cloud: 'aws', region: 'us-east-1' } },
      });
    }
    pineconeIndex = pc.Index(indexName);
    lastPineconeInitError = null;
    return pineconeIndex;
  } catch (error) {
    lastPineconeInitError = error.message;
    logger.warn({ error, indexName }, 'Pinecone initialization failed');
    throw error;
  }
}

async function ensurePineconeIndex() {
  if (pineconeIndex) return pineconeIndex;
  return initPinecone();
}

function getPineconeIndex() {
  return pineconeIndex; // may be null if unavailable
}

function getLastPineconeInitError() {
  return lastPineconeInitError;
}

module.exports = { initPinecone, ensurePineconeIndex, getPineconeIndex, getPineconeEnvStatus, getLastPineconeInitError };
