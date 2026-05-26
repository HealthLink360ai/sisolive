/**
 * Structured Logger
 * 
 * Why structured logging matters for AbbVie:
 * Every log entry is JSON — machine-readable, searchable, filterable.
 * "Show me all queries with confidence below 80% this week" = one search.
 * For pharma compliance, you need this trail. It's non-negotiable.
 */
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'siso-live-api' },
  transports: [
    new winston.transports.Console({
      format: process.env.NODE_ENV === 'production'
        ? winston.format.json()
        : winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          ),
    }),
  ],
});

module.exports = { logger };
