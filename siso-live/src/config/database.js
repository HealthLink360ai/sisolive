const { Pool } = require('pg');
const { logger } = require('../utils/logger');
let pool = null;

async function connectDatabase() {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: parseInt(process.env.DATABASE_POOL_SIZE) || 5,
    // rejectUnauthorized: true — verifies the DB server's cert against Node's default
    // CA store. This assumes the DB host presents a certificate trusted by that store
    // (true for most managed Postgres providers like RDS/Neon/Supabase). If this breaks
    // connectivity against a specific self-signed setup, supply the provider's CA cert
    // explicitly (ssl: { ca: ... }) rather than reverting to rejectUnauthorized: false.
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 60000, // 60s — Neon free tier cold-starts can take ~30s
    idleTimeoutMillis: 30000,
  });
  // Retry up to 3 times to handle Neon cold-start
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const client = await pool.connect();
      await client.query('SELECT NOW()');
      client.release();
      await runMigrations();
      return pool;
    } catch (err) {
      lastErr = err;
      logger.warn({ attempt: i + 1, err }, 'Database connection attempt failed, retrying...');
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  throw lastErr;
}

async function runMigrations() {
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      role VARCHAR(50) DEFAULT 'user',
      department VARCHAR(255),
      password_hash VARCHAR(255),
      first_login BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW(),
      last_active TIMESTAMP DEFAULT NOW()
    )`);
    // Add password_hash to any existing tables that were created before this column was added
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255)`);

    await client.query(`CREATE TABLE IF NOT EXISTS documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      filename VARCHAR(500) NOT NULL,
      file_type VARCHAR(50) NOT NULL,
      file_size_bytes INTEGER,
      chunk_count INTEGER,
      status VARCHAR(50) DEFAULT 'processing',
      uploaded_by UUID REFERENCES users(id),
      uploaded_at TIMESTAMP DEFAULT NOW(),
      processed_at TIMESTAMP,
      error_message TEXT
    )`);
    await client.query(`ALTER TABLE documents ADD COLUMN IF NOT EXISTS raw_text TEXT`);
    await client.query(`ALTER TABLE documents ADD COLUMN IF NOT EXISTS has_vectors BOOLEAN DEFAULT false`);

    await client.query(`CREATE TABLE IF NOT EXISTS queries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id),
      question TEXT NOT NULL,
      answer TEXT,
      confidence_score DECIMAL(5,4),
      was_escalated BOOLEAN DEFAULT false,
      source_documents JSONB,
      tokens_used INTEGER,
      response_time_ms INTEGER,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS feedback (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      query_id UUID REFERENCES queries(id),
      user_id UUID REFERENCES users(id),
      rating VARCHAR(10) NOT NULL,
      comment TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(query_id, user_id)
    )`);
    // Add unique constraint to existing feedback tables created without it
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'feedback_query_id_user_id_key'
        ) THEN
          ALTER TABLE feedback ADD CONSTRAINT feedback_query_id_user_id_key UNIQUE (query_id, user_id);
        END IF;
      END $$;
    `);

    await client.query(`CREATE TABLE IF NOT EXISTS spend_tracking (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      month VARCHAR(7) NOT NULL,
      total_tokens_input INTEGER DEFAULT 0,
      total_tokens_output INTEGER DEFAULT 0,
      estimated_cost_usd DECIMAL(10,4) DEFAULT 0,
      query_count INTEGER DEFAULT 0,
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(month)
    )`);

    // Real audit trail for pharma-compliance logging (previously promised in
    // docs but never actually created — see docs/TECHNICAL_DECISIONS.md).
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        action VARCHAR(100) NOT NULL,
        entity_type VARCHAR(50),
        entity_id VARCHAR(255),
        metadata JSONB,
        ip_address VARCHAR(64),
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action)`);

    // Enables session revocation on password reset (JWTs are stateless by
    // design, but a reset should still be able to invalidate prior tokens).
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP`);

    // Tracks real query activity separately from login activity, so "active
    // users" reflects actual engagement instead of just authentication events.
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_query_at TIMESTAMP`);
    await client.query(`
      UPDATE users u SET last_query_at = sub.max_created
      FROM (SELECT user_id, MAX(created_at) AS max_created FROM queries GROUP BY user_id) sub
      WHERE u.id = sub.user_id AND u.last_query_at IS NULL
    `);

    // Indexes needed by per-user and time-windowed admin queries (none existed
    // before — every filtered/grouped query on these columns was doing a full
    // table scan).
    await client.query(`CREATE INDEX IF NOT EXISTS idx_queries_user_id ON queries(user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_queries_created_at ON queries(created_at)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_queries_user_created ON queries(user_id, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_queries_escalated_true ON queries(created_at) WHERE was_escalated = true`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_feedback_user_id ON feedback(user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_feedback_query_id ON feedback(query_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_last_query_at ON users(last_query_at)`);

    logger.info('Database schema ready');
  } finally {
    client.release();
  }
}

function getPool() {
  if (!pool) throw new Error('Database not initialized');
  return pool;
}

async function query(sql, params) {
  return getPool().query(sql, params);
}

module.exports = { connectDatabase, getPool, query };
