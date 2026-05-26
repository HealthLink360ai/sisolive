/**
 * SISO Live! — Create test users
 * Run from the siso-live/ directory:
 *   node ../create-test-users.js
 * Or from the repo root:
 *   node create-test-users.js
 */

const bcrypt = require('./siso-live/node_modules/bcryptjs');
const { Pool } = require('./siso-live/node_modules/pg');
require('./siso-live/node_modules/dotenv').config({ path: './siso-live/.env' });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function createUsers() {
  const users = [
    {
      email: 'admin@abbvie.com',
      name: 'SISO Admin',
      role: 'admin',
      department: 'SISO Office',
      password: 'ChangeMe123!',
    },
    {
      email: 'jane.doe@abbvie.com',
      name: 'Jane Doe',
      role: 'user',
      department: 'Procurement',
      password: 'Test1234!',
    },
  ];

  for (const u of users) {
    const hash = bcrypt.hashSync(u.password, 10);
    try {
      await pool.query(
        `INSERT INTO users (email, name, role, department, password_hash)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (email) DO NOTHING`,
        [u.email, u.name, u.role, u.department, hash]
      );
      console.log(`✓ User created: ${u.email} / ${u.password}`);
    } catch (err) {
      console.error(`✗ Failed to create ${u.email}:`, err.message);
    }
  }

  await pool.end();
  console.log('\nDone. You can now log in to SISO Live!');
}

createUsers();
