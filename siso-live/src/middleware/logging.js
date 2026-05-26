/**
 * Request Logging Middleware
 * Every request gets logged with timing, user identity, and outcome.
 * This is your compliance audit trail.
 */
const { logger } = require('../utils/logger');

function requestLogger(req, res, next) {
  const start = Date.now();
  const { method, url, ip } = req;

  res.on('finish', () => {
    const duration = Date.now() - start;
    const logData = {
      method,
      url,
      status: res.statusCode,
      duration: `${duration}ms`,
      userId: req.user?.id,
      email: req.user?.email,
    };

    if (res.statusCode >= 400) {
      logger.warn(logData, 'Request completed with error');
    } else {
      logger.info(logData, 'Request completed');
    }
  });

  next();
}

module.exports = { requestLogger };
