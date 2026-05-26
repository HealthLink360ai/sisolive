const { Pinecone } = require('@pinecone-database/pinecone');
const { logger } = require('../utils/logger');
let pineconeIndex = null;

async function initPinecone() {
  const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  const indexName = process.env.PINECONE_INDEX_NAME || 'siso-live-prod';
  const existingIndexes = await pc.listIndexes();
  const indexExists = existingIndexes.indexes?.some(i => i.name === indexName);

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
  return pineconeIndex;
}

function getPineconeIndex() {
  if (!pineconeIndex) throw new Error('Pinecone not initialized');
  return pineconeIndex;
}

module.exports = { initPinecone, getPineconeIndex };
