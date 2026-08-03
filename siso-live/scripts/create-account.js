/**
 * SISO Live! — create or update a single account
 *
 * General-purpose account creation/reset tool. Credentials are always
 * read from environment variables at runtime, never hardcoded or written
 * to disk — nothing about this script needs editing per account, so
 * there is nothing credential-shaped to accidentally commit (see the
 * create-test-users.js incident this line of tooling replaces).
 *
 * "admin" is the highest privilege role this app has — it already grants
 * full access to every component (dashboard, users, documents, uploads,
 * escalations, feedback). There is no higher tier to grant.
 *
 * Usage:
 *   ACCOUNT_EMAIL=someone@example.com \
 *   ACCOUNT_PASSWORD=<password> \
 *   ACCOUNT_NAME="Someone Name" \
 *   ACCOUNT_ROLE=admin \
 *   DATABASE_URL=<connection string> \
 *   node scripts/create-account.js
 *
 * ACCOUNT_ROLE defaults to "admin" if unset. ACCOUNT_DEPARTMENT is
 * optional (defaults to "SISO Office"). Upserts on email — running this
 * again with the same email updates name/role/department/password
 * rather than erroring.
 */

const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

// Lowercased to match auth.routes.js, which queries by email.toLowerCase() —
// storing any other case here would make login silently fail to match.
const email = process.env.ACCOUNT_EMAIL?.toLowerCase();
const password = process.env.ACCOUNT_PASSWORD;
const name = process.env.ACCOUNT_NAME || email?.split('@')[0];
const role = process.env.ACCOUNT_ROLE || 'admin';
const department = process.env.ACCOUNT_DEPARTMENT || 'SISO Office';
const dbUrl = process.env.DATABASE_URL || '';

if (!email || !password) {
  console.error('ACCOUNT_EMAIL and ACCOUNT_PASSWORD are required.');
  process.exit(1);
}
if (!dbUrl) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}
if (!['admin', 'user'].includes(role)) {
  console.error(`ACCOUNT_ROLE must be "admin" or "user", got "${role}".`);
  process.exit(1);
}

const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: true } });

async function run() {
  const client = await pool.connect();
  try {
    console.log(`Target database: ${dbUrl.replace(/:[^:@]+@/, ':***@')}`);
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await client.query(
      `INSERT INTO users (email, name, role, department, password_hash, first_login, last_active)
       VALUES ($1, $2, $3, $4, $5, false, NOW())
       ON CONFLICT (email) DO UPDATE SET
         name = EXCLUDED.name, role = EXCLUDED.role, department = EXCLUDED.department,
         password_hash = EXCLUDED.password_hash
       RETURNING id, email, role`,
      [email, name, role, department, passwordHash]
    );
    const u = result.rows[0];
    console.log(`\nDone. ${u.email} — role: ${u.role} — id: ${u.id}`);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
