/**
 * SISO Live! — Staging demo data seeder
 *
 * Populates a STAGING database with demo user accounts and sample query/
 * feedback history so the admin dashboard and per-user tracking drill-down
 * have realistic-looking data immediately, without needing real pilot usage
 * first. Intentionally does NOT touch Pinecone/vector content — upload real
 * or representative sample documents through the actual admin UI once the
 * staging environment is live, since that also exercises the real
 * upload/ingestion pipeline as part of the demo.
 *
 * SAFETY: refuses to run unless CONFIRM_STAGING=yes is set, and refuses to
 * run against any DATABASE_URL containing "prod" (case-insensitive) as a
 * best-effort guard against accidentally seeding fake data into production.
 * This is a heuristic, not a guarantee — always double-check DATABASE_URL
 * yourself before running this.
 *
 * Usage:
 *   CONFIRM_STAGING=yes DATABASE_URL=<your staging Neon branch URL> node scripts/seed-staging-data.js
 *
 * Demo account passwords are read from environment variables so no
 * real-looking credential is ever hardcoded or committed (see the
 * create-test-users.js incident this replaces). If unset, a random
 * password is generated per run and printed once — write it down, it is
 * not stored anywhere.
 */

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { Pool } = require('pg');

if (process.env.CONFIRM_STAGING !== 'yes') {
  console.error('Refusing to run: set CONFIRM_STAGING=yes to confirm this targets a staging database, not production.');
  process.exit(1);
}

const dbUrl = process.env.DATABASE_URL || '';
if (/prod/i.test(dbUrl)) {
  console.error('Refusing to run: DATABASE_URL looks like it might be production (contains "prod"). Point this at your staging Neon branch instead.');
  process.exit(1);
}
if (!dbUrl) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: true } });

function randomPassword() {
  return crypto.randomBytes(12).toString('base64url');
}

const DEMO_USERS = [
  { email: 'demo.admin@abbvie.com', name: 'Demo Admin', role: 'admin', department: 'SISO Office' },
  { email: 'demo.learner1@abbvie.com', name: 'Demo Learner One', role: 'user', department: 'Procurement' },
  { email: 'demo.learner2@abbvie.com', name: 'Demo Learner Two', role: 'user', department: 'Legal' },
];

const SAMPLE_QUERIES = [
  { question: 'What is supplier inclusion?', answer: 'Supplier inclusion means actively partnering with businesses owned by underrepresented groups. The bottom line: it broadens who AbbVie works with.', confidence: 0.92, escalated: false },
  { question: 'How does AbbVie measure supplier inclusion progress?', answer: 'AbbVie tracks supplier inclusion spend and participation against annual targets, reviewed quarterly. The bottom line: progress is measured, not assumed.', confidence: 0.88, escalated: false },
  { question: 'What are AbbVie\'s four pillars of supplier inclusion?', answer: null, confidence: 0.18, escalated: true },
  { question: 'How do I certify as a diverse supplier?', answer: 'Certification runs through a recognized third-party body such as NMSDC or WBENC, then gets logged with AbbVie procurement. The bottom line: certification is verified externally first.', confidence: 0.85, escalated: false },
];

async function seed() {
  const client = await pool.connect();
  try {
    console.log(`Seeding staging data into ${dbUrl.replace(/:[^:@]+@/, ':***@')}`);

    const userIds = [];
    for (const u of DEMO_USERS) {
      const password = process.env[`DEMO_PASSWORD_${u.role.toUpperCase()}`] || randomPassword();
      const passwordHash = await bcrypt.hash(password, 10);
      const result = await client.query(
        `INSERT INTO users (email, name, role, department, password_hash, first_login, last_active)
         VALUES ($1, $2, $3, $4, $5, false, NOW())
         ON CONFLICT (email) DO UPDATE SET
           name = EXCLUDED.name, role = EXCLUDED.role, department = EXCLUDED.department,
           password_hash = EXCLUDED.password_hash
         RETURNING id`,
        [u.email, u.name, u.role, u.department, passwordHash]
      );
      userIds.push(result.rows[0].id);
      console.log(`  user ${u.email} (${u.role}) — password: ${password}`);
    }

    const [adminId, learner1Id, learner2Id] = userIds;
    const learnerIds = [learner1Id, learner2Id];

    for (let i = 0; i < SAMPLE_QUERIES.length; i++) {
      const q = SAMPLE_QUERIES[i];
      const userId = learnerIds[i % learnerIds.length];
      const daysAgo = Math.floor(Math.random() * 25) + 1;
      const result = await client.query(
        `INSERT INTO queries (user_id, question, answer, confidence_score, was_escalated, response_time_ms, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW() - ($7 || ' days')::interval)
         RETURNING id`,
        [userId, q.question, q.answer, q.confidence, q.escalated, 1200 + Math.floor(Math.random() * 1800), daysAgo]
      );
      const queryId = result.rows[0].id;

      if (!q.escalated && Math.random() > 0.4) {
        const rating = Math.random() > 0.25 ? 'up' : 'down';
        await client.query(
          `INSERT INTO feedback (query_id, user_id, rating, comment) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [queryId, userId, rating, rating === 'down' ? 'Would like a more specific example.' : null]
        );
      }

      await client.query(`UPDATE users SET last_query_at = NOW() - ($1 || ' days')::interval WHERE id = $2`, [daysAgo, userId]);
    }

    console.log('\nDone. Demo accounts and sample query/feedback history seeded.');
    console.log('Next step: log in as demo.admin@abbvie.com and upload a few real or representative');
    console.log('AbbVie documents through the admin UI to populate the RAG knowledge base for the demo —');
    console.log('this script deliberately does not touch Pinecone/vector content.');
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
