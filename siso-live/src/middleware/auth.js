/**
 * Authentication Middleware
 * 
 * What this does: Checks every protected request for a valid JWT token.
 * Extracts the user identity and role from that token.
 * 
 * Plain English: This is the bouncer at the door. Every request to
 * a protected endpoint must show a valid badge (JWT token). The badge
 * proves who you are and what you're allowed to do. Admins get a
 * different badge than regular users — and the system checks that
 * badge on every single request, not just at login.
 * 
 * Why JWT over sessions: This backend is serverless — each request
 * may hit a different server instance. Sessions would require a shared
 * session store. JWTs are self-contained — the token itself proves
 * identity without any database lookup.
 */

const jwt = require('jsonwebtoken');
const { logger } = require('../utils/logger');

// Refuse to boot with a missing, too-short, or still-placeholder JWT secret —
// any of those means anyone can forge admin tokens, so this must fail loudly
// at startup rather than accepting bad tokens later.
const JWT_SECRET_PLACEHOLDER = 'change_this_to_a_random_32_char_string_minimum';
const MIN_JWT_SECRET_LENGTH = 32;

function assertValidJwtSecret(secret) {
  if (!secret) {
    throw new Error(
      'JWT_SECRET is not set. Set a random string of at least 32 characters in your environment (see .env.example).'
    );
  }
  if (secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET is too short (${secret.length} chars). It must be at least ${MIN_JWT_SECRET_LENGTH} characters.`
    );
  }
  if (secret === JWT_SECRET_PLACEHOLDER) {
    throw new Error(
      'JWT_SECRET is still set to the placeholder value from .env.example. Replace it with a real random secret before starting the server.'
    );
  }
}

assertValidJwtSecret(process.env.JWT_SECRET);

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // "Bearer <token>"

  if (!token) {
    return res.status(401).json({
      error: 'Access denied. Please sign in to SISO Live!',
      code: 'NO_TOKEN',
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { id, email, name, role, department }
    
    // Log every authenticated request for audit trail
    logger.info({
      userId: decoded.id,
      email: decoded.email,
      role: decoded.role,
      endpoint: req.path,
      method: req.method,
    }, 'Authenticated request');

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Your session has expired. Please sign in again.',
        code: 'TOKEN_EXPIRED',
      });
    }
    logger.warn({ error: error.message, endpoint: req.path }, 'Invalid token');
    return res.status(403).json({
      error: 'Invalid credentials.',
      code: 'INVALID_TOKEN',
    });
  }
}

// Admin-only middleware — checks role after authentication
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    logger.warn({
      userId: req.user?.id,
      email: req.user?.email,
      endpoint: req.path,
    }, 'Unauthorized admin access attempt');
    return res.status(403).json({
      error: 'Admin access required.',
      code: 'INSUFFICIENT_PERMISSIONS',
    });
  }
  next();
}

module.exports = { authenticateToken, requireAdmin };
