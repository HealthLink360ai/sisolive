/**
 * SISO Live! — Authentication API
 *
 * Handles login, token management, and role-based access control.
 *
 * Two user roles:
 *   - user: Can access the SISO Live! chatbot
 *   - admin: Can also access the admin dashboard, upload docs,
 *            view analytics, manage content
 *
 * These roles are COMPLETELY SEPARATE by design.
 * A regular user never sees admin routes, admin links,
 * or any indication the admin panel exists.
 *
 * Security approach: JWT (JSON Web Tokens)
 * Why JWT over sessions?
 * - Stateless — no server-side session storage needed
 * - Works perfectly with serverless deployments
 * - Tokens expire automatically (8h for users, 4h for admins)
 * - Easy to verify on every request without a database lookup
 */

import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { rateLimit } from 'express-rate-limit';
import { db } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { auditLog } from '../lib/auditLog.js';

export const authRouter = express.Router();

// Stricter rate limit for auth endpoints
// 10 attempts per 15 minutes prevents brute force attacks
const authLimiter = rateLimit({
  windowMs: 900000,
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX) || 10,
  message: {
    error: 'Too many login attempts. Please wait 15 minutes.',
    code: 'AUTH_RATE_LIMIT',
  },
});

/**
 * POST /api/auth/login
 *
 * Standard email + password login.
 * Returns a JWT token the client stores and sends with every request.
 */
authRouter.post('/login', authLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: 'Email and password are required.',
        code: 'MISSING_CREDENTIALS',
      });
    }

    // Look up user in database
    const result = await db.query(
      'SELECT id, email, password_hash, role, first_name, last_name, is_active FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );

    const user = result.rows[0];

    // Use constant-time comparison to prevent timing attacks
    // (comparing against a dummy hash even if user doesn't exist)
    const dummyHash = '$2a$12$dummyhashfortimingnormalization';
    const passwordMatch = user
      ? await bcrypt.compare(password, user.password_hash)
      : await bcrypt.compare(password, dummyHash);

    if (!user || !passwordMatch || !user.is_active) {
      await auditLog({
        type: 'LOGIN_FAILED',
        email,
        ip: req.ip,
        reason: !user ? 'USER_NOT_FOUND' : !passwordMatch ? 'WRONG_PASSWORD' : 'ACCOUNT_INACTIVE',
      });

      // Generic error message — never reveal whether email exists
      return res.status(401).json({
        error: 'Invalid credentials. Please check your email and password.',
        code: 'AUTH_FAILED',
      });
    }

    // Generate JWT token
    const expiresIn = user.role === 'admin'
      ? process.env.ADMIN_JWT_EXPIRES_IN || '4h'
      : process.env.JWT_EXPIRES_IN || '8h';

    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
        firstName: user.first_name,
      },
      process.env.JWT_SECRET,
      { expiresIn }
    );

    // Track login for analytics
    await db.query(
      'UPDATE users SET last_login = NOW(), login_count = login_count + 1 WHERE id = $1',
      [user.id]
    );

    await auditLog({
      type: 'LOGIN_SUCCESS',
      userId: user.id,
      email: user.email,
      role: user.role,
      ip: req.ip,
    });

    logger.info(`Login successful: ${user.email} (${user.role})`);

    // Check if this is the user's first login (triggers onboarding video)
    const isFirstLogin = user.login_count === 1;

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        isFirstLogin,
      },
      expiresIn,
    });

  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/auth/logout
 *
 * Logs the logout event for audit compliance.
 * The client is responsible for discarding the token.
 */
authRouter.post('/logout', async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        await auditLog({
          type: 'LOGOUT',
          userId: decoded.userId,
          email: decoded.email,
        });
      } catch {}
    }

    res.json({ message: 'Logged out successfully.' });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/auth/me
 *
 * Returns the current user's profile from their token.
 * Used by the frontend to restore session on page refresh.
 */
authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const result = await db.query(
      'SELECT id, email, first_name, last_name, role, login_count FROM users WHERE id = $1',
      [req.user.userId]
    );

    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found.' });

    res.json({
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      role: user.role,
      isFirstLogin: user.login_count === 1,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * requireAuth middleware
 *
 * Verifies JWT token on protected routes.
 * Attach to any route that needs authentication.
 */
export function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Authentication required.',
      code: 'NO_TOKEN',
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Your session has expired. Please sign in again.',
        code: 'TOKEN_EXPIRED',
      });
    }
    return res.status(401).json({
      error: 'Invalid authentication token.',
      code: 'INVALID_TOKEN',
    });
  }
}

/**
 * requireAdmin middleware
 *
 * Extends requireAuth — additionally checks the user has admin role.
 * Applied to ALL admin dashboard routes.
 *
 * This is the gate that keeps regular users completely out
 * of the admin panel. Even if someone guesses an admin URL,
 * they need a valid admin-role JWT to get past this.
 */
export function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') {
      logger.warn(`Unauthorized admin access attempt`, {
        userId: req.user.userId,
        email: req.user.email,
        path: req.path,
        ip: req.ip,
      });

      return res.status(403).json({
        error: 'Access denied. Admin privileges required.',
        code: 'INSUFFICIENT_PERMISSIONS',
      });
    }
    next();
  });
}
