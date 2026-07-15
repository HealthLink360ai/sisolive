const { query } = require('../config/database');
const { logger } = require('./logger');

async function logAudit({ userId, action, entityType, entityId, metadata, ipAddress }) {
  try {
    await query(
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, metadata, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId || null, action, entityType || null, entityId || null, metadata ? JSON.stringify(metadata) : null, ipAddress || null]
    );
  } catch (error) {
    // Audit logging must never break the calling request — log and move on.
    logger.error({ error, action, userId }, 'Audit log write failed');
  }
}

module.exports = { logAudit };
