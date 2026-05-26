/**
 * Generation Service
 * 
 * What this does: Takes retrieved document chunks and a user question,
 * sends them to Claude, and gets back a precise, grounded answer.
 * 
 * Plain English: This is the writer. It takes the 5 best document
 * passages found by the librarian and hands them to Claude along
 * with strict instructions: answer only from these passages,
 * stay under 400 characters, cite your source, be conversational.
 * Claude reads the passages like an open-book exam and writes the answer.
 * It cannot go outside of what it's given — this is what prevents
 * hallucinations and keeps answers grounded in AbbVie's actual content.
 */

const Anthropic = require('@anthropic-ai/sdk');
const { estimateTokens, calculateCost } = require('../utils/tokenCounter');
const { query } = require('../config/database');
const { logger } = require('../utils/logger');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MAX_ANSWER_CHARS = parseInt(process.env.MAX_ANSWER_CHARS) || 400;

/**
 * Generate a grounded answer from retrieved chunks
 */
async function generateAnswer(question, chunks, userId) {
  const startTime = Date.now();

  // Build context from chunks — this is what Claude reads
  const context = chunks
    .map((chunk, i) =>
      `[Source ${i + 1}: ${chunk.source}]\n${chunk.text}`
    )
    .join('\n\n---\n\n');

  // The system prompt is the "exam rules" — what Claude must follow
  const systemPrompt = `You are SISO Live!, AbbVie's precision learning tool for supplier inclusion and sustainability.

STRICT RULES:
1. Answer ONLY using the provided source documents. Never use outside knowledge.
2. Keep answers under ${MAX_ANSWER_CHARS} characters. Be concise and clear.
3. Use conversational, natural language — not corporate jargon.
4. End with a gentle learning nudge as a separate line starting with "NUDGE:"
5. If the documents don't contain enough information, respond only with: "INSUFFICIENT_CONTEXT"
6. Never make up statistics, policies, or facts not explicitly in the documents.

You are helping AbbVie employees learn about supplier inclusion and sustainability practices.
Be warm, precise, and educational.`;

  const userMessage = `Documents to reference:
${context}

Question: ${question}

Remember: Answer in under ${MAX_ANSWER_CHARS} characters. Include a NUDGE line at the end.`;

  try {
    const response = await anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const fullResponse = response.content[0].text;
    const generationTime = Date.now() - startTime;

    // Parse answer and nudge from response
    const nudgeMatch = fullResponse.match(/NUDGE:\s*(.+)$/m);
    const nudge = nudgeMatch ? nudgeMatch[1].trim() : null;
    const answer = fullResponse.replace(/\nNUDGE:.+$/m, '').trim();

    // Handle insufficient context
    if (answer === 'INSUFFICIENT_CONTEXT') {
      return { answer: null, nudge: null, isInsufficient: true };
    }

    // Track token usage for cost management
    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    const cost = calculateCost(inputTokens, outputTokens);

    // Update monthly spend in database
    await updateSpendTracking(inputTokens, outputTokens, cost.totalCost);

    logger.info({
      userId,
      question: question.slice(0, 100),
      answerLength: answer.length,
      inputTokens,
      outputTokens,
      estimatedCost: `$${cost.totalCost.toFixed(5)}`,
      generationTimeMs: generationTime,
    }, 'Answer generated');

    return {
      answer: answer.slice(0, MAX_ANSWER_CHARS), // Hard cap on length
      nudge,
      isInsufficient: false,
      tokens: { input: inputTokens, output: outputTokens },
      cost: cost.totalCost,
    };
  } catch (error) {
    logger.error({ error, question: question.slice(0, 100) }, 'Generation failed');
    throw new Error(`Failed to generate answer: ${error.message}`);
  }
}

async function updateSpendTracking(inputTokens, outputTokens, cost) {
  const currentMonth = new Date().toISOString().slice(0, 7);
  try {
    await query(`
      INSERT INTO spend_tracking (month, total_tokens_input, total_tokens_output, estimated_cost_usd, query_count)
      VALUES ($1, $2, $3, $4, 1)
      ON CONFLICT (month) DO UPDATE SET
        total_tokens_input = spend_tracking.total_tokens_input + $2,
        total_tokens_output = spend_tracking.total_tokens_output + $3,
        estimated_cost_usd = spend_tracking.estimated_cost_usd + $4,
        query_count = spend_tracking.query_count + 1,
        updated_at = NOW()
    `, [currentMonth, inputTokens, outputTokens, cost]);
  } catch (error) {
    logger.error({ error }, 'Failed to update spend tracking');
  }
}

module.exports = { generateAnswer };
