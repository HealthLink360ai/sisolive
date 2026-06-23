const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { query } = require('../config/database');
const { logger } = require('../utils/logger');
const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX) || 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please wait 15 minutes before trying again.' },
});

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
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

// GET /api/auth/validate — lightweight token check, used by frontend on load
const { authenticateToken } = require('../middleware/auth');
router.get('/validate', authenticateToken, (req, res) => {
  res.json({ valid: true, user: req.user });
});

module.exports = router;
