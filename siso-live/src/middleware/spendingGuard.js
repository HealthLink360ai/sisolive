/**
 * Spending Guard Middleware
 * 
 * What this does: Checks monthly API spend before every query.
 * If we're at or near the monthly cap, queries are blocked with
 * a friendly message — not a silent failure.
 * 
 * Plain English: This is the circuit breaker for your API budget.
 * Think of it like a prepaid phone — when you're close to the limit,
 * you get a warning. When you hit it, it stops. No surprise invoices.
 * AbbVie's finance team will specifically appreciate this feature.
 */

const { query } = require('../config/database');
const { logger } = require('../utils/logger');

async function spendingGuard(req, res, next) {
  try {
    const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
    const cap = parseFloat(process.env.MONTHLY_BUDGET_CAP_USD) || 100;

    const result = await query(
      'SELECT estimated_cost_usd FROM spend_tracking WHERE month = $1',
      [currentMonth]
    );

    const currentSpend = parseFloat(result.rows[0]?.estimated_cost_usd || 0);
    const percentUsed = (currentSpend / cap) * 100;

    // Hard stop at 100% of budget
    if (currentSpend >= cap) {
      logger.error({ currentSpend, cap, month: currentMonth }, 'Monthly budget cap reached');
      return res.status(503).json({
        error: 'SISO Live! has reached its monthly query capacity. Please contact your administrator.',
        code: 'BUDGET_CAP_REACHED',
      });
    }

    // Warning at 80% — still works but logs a warning
    if (percentUsed >= 80) {
      logger.warn({ currentSpend, cap, percentUsed: percentUsed.toFixed(1) }, 'Approaching budget cap');
    }

    req.currentMonthSpend = currentSpend;
    next();
  } catch (error) {
    // Fail closed: if we can't verify we're under budget, don't let the
    // request through unchecked — that would defeat the whole cap. A
    // brief 503 during a DB blip is a better trade-off than unbounded spend.
    logger.error({ error }, 'Spending guard check failed — blocking request until service recovers');
    res.status(503).json({
      error: 'Service temporarily unavailable. Please try again shortly.',
      code: 'SPENDING_GUARD_UNAVAILABLE',
    });
  }
}

module.exports = { spendingGuard };
