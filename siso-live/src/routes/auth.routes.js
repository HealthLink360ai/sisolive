const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { query } = require('../config/database');
const { logger } = require('../utils/logger');
const router = express.Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  try {
    const result = await query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, role: user.role, department: user.department },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRY || '24h' }
    );

    // Update last active
    await query('UPDATE users SET last_active = NOW(), first_login = false WHERE id = $1', [user.id]);

    logger.info({ userId: user.id, email: user.email }, 'User logged in');

    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role, firstLogin: user.first_login },
    });
  } catch (error) {
    logger.error({ error }, 'Login failed');
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  // JWTs are stateless — client deletes the token
  // For enhanced security, maintain a token blacklist in Redis
  res.json({ message: 'Logged out successfully' });
});

module.exports = router;
