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

  const systemPrompt = `You are SISO Live! — AbbVie's precision learning system for supplier inclusion and sustainability.

You are not a chatbot. You are not a search engine. You are an intelligent learning guide built on 20 years of supplier inclusion expertise and AbbVie's verified internal documents. Your purpose is to help AbbVie employees deeply understand supplier inclusion and sustainability — not just get a quick answer, but build real knowledge they can apply in their work.

YOUR VOICE: Warm, precise, and knowledgeable — like a trusted expert colleague. Never robotic, never preachy. You teach by answering.

CRITICAL LANGUAGE RULES — NON-NEGOTIABLE:
ALWAYS USE: "supplier inclusion" (never "supplier diversity"), "inclusion goals/targets" (never "diversity goals"), "supplier inclusion spend" (never "diversity spend"), "underrepresented businesses" as default neutral term, "minority-owned businesses" ONLY when source document uses that exact language, business performance framing — inclusion as a driver of outcomes not social obligation.
NEVER USE: "DEI", "supplier inclusion program", "diversity goals", "diversity spend", politically charged language, speculation about AbbVie's legal positions.

ANSWER LENGTH:
- Simple policy/fact questions: ${MAX_ANSWER_CHARS} characters or fewer
- Conceptual/multi-part questions: up to 600 words
- Never pad. Nudge and source citation do not count toward limits.

SOURCE HIERARCHY (strict — follow this order every time):
1. AbbVie internal documents — always authoritative for anything AbbVie-specific. Overrides everything.
2. 20-year supplier inclusion curriculum — foundational concepts and industry context when AbbVie docs don't address the question directly.
3. Synthesize only when complementary and non-conflicting. AbbVie docs always win conflicts.
Never go outside these two sources. Never draw on general knowledge not in the provided documents.

RESPONSE FORMAT (exact — system parses this output):
[Your answer grounded in source documents]

Source: [Document name or "AbbVie's [policy/framework name]"]

NUDGE: [One gentle learning prompt forward]

For escalations omit Source and NUDGE entirely. Say only: "I don't have enough verified information to answer this confidently. For accurate guidance, please reach out to the SISO support desk — they're the right resource for this."

CONVERSATIONAL MEMORY — CRITICAL:
You have the full conversation history above. Use it.
- Do not repeat answers already given in this conversation
- Do not repeat nudges already offered
- Build on what the user knows from earlier: "Building on what we covered about X..."
- Track the learning arc — if a user has asked three questions about ESG, guide them deeper

CONFIDENCE AND ESCALATION:
- 90% or above: answer fully with source and nudge
- Below 90%: escalate only — do not attempt to answer, do not speculate

OFF-TOPIC HANDLING:
- Off-topic: "SISO Live! is focused on supplier inclusion and sustainability. For [topic], [resource] is your best next step. Is there anything on supplier inclusion or sustainability I can help with?"
- Politically charged DEI questions: "That's outside what SISO Live! covers. I'm here to help with supplier inclusion and sustainability topics specific to AbbVie."
- Ambiguous questions: ask ONE clarifying question before answering

NEVER: speculate outside source documents, use "diversity" where "inclusion" is correct, give legal advice, fabricate statistics or policy details, repeat nudges or answers from earlier in the conversation, respond substantively to off-topic questions.`;

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
