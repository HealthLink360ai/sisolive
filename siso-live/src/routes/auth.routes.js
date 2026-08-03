const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { query } = require('../config/database');
const { logger } = require('../utils/logger');
const { logAudit } = require('../utils/auditLog');
const router = express.Router();

// Fixed-cost dummy hash used so bcrypt.compare always runs (same bcrypt cost)
// whether or not the email exists / has a password hash — prevents timing-based
// user enumeration via the login endpoint (see fix #1 below).
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing-safety', 10);

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

    // Always pay the bcrypt cost, whether or not the user exists (or has a
    // NULL password_hash), so response timing can't be used to enumerate
    // valid accounts. Compare against DUMMY_HASH when there's no real hash.
    const passwordHash = user?.password_hash || DUMMY_HASH;
    const passwordValid = await bcrypt.compare(password, passwordHash);

    if (!user || !passwordValid) {
      logAudit({
        userId: user?.id || null,
        action: 'auth.login.failure',
        entityType: 'user',
        entityId: user?.id || null,
        metadata: { email: email.toLowerCase() },
        ipAddress: req.ip,
      }).catch(() => {});
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

    logAudit({
      userId: user.id,
      action: 'auth.login.success',
      entityType: 'user',
      entityId: user.id,
      metadata: { email: user.email },
      ipAddress: req.ip,
    }).catch(() => {});

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

  // Best-effort audit log. We use jwt.decode (not verify) so logout is
  // still logged — and always succeeds — even if the token is expired
  // or otherwise invalid; this endpoint doesn't gate on token validity.
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token) {
      const decoded = jwt.decode(token);
      logAudit({
        userId: decoded?.id || null,
        action: 'auth.logout',
        entityType: 'user',
        entityId: decoded?.id || null,
        metadata: { email: decoded?.email },
        ipAddress: req.ip,
      }).catch(() => {});
    }
  } catch (error) {
    logger.warn({ error: error.message }, 'Failed to audit-log logout');
  }

  res.json({ message: 'Logged out successfully' });
});

// GET /api/auth/validate — lightweight token check, used by frontend on load
const { authenticateToken } = require('../middleware/auth');
router.get('/validate', authenticateToken, (req, res) => {
  res.json({ valid: true, user: req.user });
});

module.exports = router;
