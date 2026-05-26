/**
 * Token Counter + Cost Tracker
 * 
 * What this does: Estimates token usage and cost for every Claude call.
 * This feeds into the spending cap system.
 * 
 * Plain English: Every word sent to and received from Claude costs
 * a fraction of a cent. This utility counts those words (tokens)
 * and keeps a running total so we never exceed the monthly budget.
 */

// Claude Sonnet pricing (as of 2025)
const COST_PER_INPUT_TOKEN = 0.000003;   // $0.003 per 1k tokens
const COST_PER_OUTPUT_TOKEN = 0.000015;  // $0.015 per 1k tokens

function estimateTokens(text) {
  // Rough estimate: 1 token ≈ 4 characters
  // Claude's tokenizer is more precise but this is close enough for budgeting
  return Math.ceil(text.length / 4);
}

function calculateCost(inputTokens, outputTokens) {
  const inputCost = inputTokens * COST_PER_INPUT_TOKEN;
  const outputCost = outputTokens * COST_PER_OUTPUT_TOKEN;
  return {
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
    totalTokens: inputTokens + outputTokens,
  };
}

function formatCost(usd) {
  if (usd < 0.01) return `$${(usd * 100).toFixed(3)}¢`;
  return `$${usd.toFixed(4)}`;
}

module.exports = { estimateTokens, calculateCost, formatCost };
