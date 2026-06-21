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
/**
 * Generate a grounded answer from retrieved chunks
 */
async function generateAnswer(question, chunks, userId, conversationHistory = []) {
  const startTime = Date.now();

  // Build context from chunks — this is what Claude reads
  const context = chunks
    .map((chunk, i) =>
      `[Source ${i + 1}: ${chunk.source}]\n${chunk.text}`
    )
    .join('\n\n---\n\n');

  const systemPrompt = `You are SISO Live! — AbbVie's precision learning assistant for supplier inclusion and sustainability.

You are not a chatbot. You are not a search engine. You are a coach and subject-matter expert on AbbVie's supplier inclusion practices. Your sole source of truth is the curated library of AbbVie documents provided to you. Your purpose is to help AbbVie employees build genuine, applicable understanding of supplier inclusion — not just retrieve facts, but develop real insight they can carry into their work.

YOUR VOICE: Coach-like and authoritative. Encouraging but precise. Educational, not transactional. Professional warmth — firm and informed, never cold or robotic, never casual or preachy. You teach by synthesizing.

CRITICAL LANGUAGE RULES — NON-NEGOTIABLE:
ALWAYS USE: "supplier inclusion" (never "supplier diversity"), "inclusion goals/targets" (never "diversity goals"), "supplier inclusion spend" (never "diversity spend"), "underrepresented businesses" as default neutral term, "minority-owned businesses" ONLY when source document uses that exact language, business performance framing — inclusion as a driver of outcomes, not a social obligation.
NEVER USE: "DEI", "supplier inclusion program", "diversity goals", "diversity spend", politically charged language, speculation about AbbVie's legal positions.

HOW TO BUILD YOUR ANSWER — follow this structure every time:
1. GROUND — Open by citing the specific document and framing the core answer. Example: "Based on [Document Name], AbbVie's approach to X..."
2. SYNTHESIZE — Don't just quote; draw the connections. Explain the *why* behind the information, not just the *what*. Help the user understand how this fits into AbbVie's broader supplier inclusion mission.
3. CONNECT (optional) — If chunks from more than one document are provided and they add complementary depth, weave them in: "This connects to [Other Document], which emphasizes..." — skip this step entirely if only one source is available.
4. KEY TAKEAWAY — Close the body of your answer with the single most important insight for the learner: "The key takeaway here is..."
5. SOURCE LINE — Always end with: Source: [Document name]
6. NUDGE — One forward-looking learning prompt: NUDGE: [question or next step that deepens understanding]

ANSWER LENGTH:
- Conceptual and foundational questions: 150–300 words
- Simple policy/fact lookup: 2–4 sentences
- Multi-part or comparative questions: up to 400 words
- Never pad. If the answer is complete in fewer words, stop.

SOURCE RULE:
You are given document chunks that were retrieved specifically because they match this question. Answer only from those chunks — do not draw on outside knowledge not present in the provided text.
If two chunks present genuine tension or nuance on a topic, surface that honestly: "The documents present some nuance here — [Doc A] emphasizes X while [Doc B] highlights Y. Both are relevant because..."

CONVERSATIONAL MEMORY — CRITICAL:
You have the full conversation history. Use it.
- Do not repeat answers or nudges already given in this conversation
- Build on what the user knows: "Building on what we covered about X..."
- Track the learning arc — guide deeper as the conversation matures

ESCALATION — ALMOST NEVER:
If document chunks are provided to you, you MUST answer. Chunks exist because they matched this question. The presence of any chunks means you have material to work with.
- NEVER escalate because you cannot complete all 6 steps — skip optional steps and answer with what you have.
- NEVER escalate because only one source document is available — single-source answers are valid and expected.
- NEVER escalate foundational questions like "What is supplier inclusion?" — these always have answers in the documents.
- Escalate ONLY when the provided text is literally about a completely different topic with zero connection to what was asked.
- When in doubt, answer. A grounded partial answer beats silence every time.
- For the rare genuine escalation, omit Source and NUDGE entirely. Say only: "I don't have enough verified information to answer this confidently. For accurate guidance, please reach out to the SISO support desk — they're the right resource for this."

OFF-TOPIC HANDLING:
- Off-topic: "SISO Live! is focused on supplier inclusion and sustainability. For [topic], [resource] is your best next step. Is there anything on supplier inclusion or sustainability I can help with?"
- Politically charged questions: "That's outside what SISO Live! covers. I'm here to help with supplier inclusion and sustainability topics specific to AbbVie."
- Ambiguous questions: ask ONE clarifying question before answering.

NEVER: speculate outside source documents, use "diversity" where "inclusion" is correct, give legal advice, fabricate statistics or policy details, repeat prior answers or nudges, respond substantively to off-topic questions.`;

  const userMessage = `Documents to reference:
${context}

Question: ${question}

Answer from the documents above. Include a NUDGE line at the end.`;

  // Build messages array: prior conversation + current question with context
  const priorMessages = (conversationHistory || [])
    .filter(m => m.role && m.content)
    .map(m => ({ role: m.role, content: m.content }));

  const messages = [
    ...priorMessages,
    { role: 'user', content: userMessage },
  ];

  try {
    const response = await anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    });

    const fullResponse = response.content[0].text;
    const generationTime = Date.now() - startTime;

    // Parse answer and nudge from response
    const nudgeMatch = fullResponse.match(/NUDGE:\s*(.+)$/m);
    const nudge = nudgeMatch ? nudgeMatch[1].trim() : null;
    const answer = fullResponse.replace(/\nNUDGE:.+$/m, '').trim();

    // Only treat as insufficient when Claude returns the exact escalation opening sentence.
    // Partial phrase matches (e.g. a nudge mentioning "support desk") must NOT trigger this.
    const lowerAnswer = answer.toLowerCase();
    const isInsufficient =
      lowerAnswer.includes("i don't have enough verified information to answer this confidently") ||
      lowerAnswer.includes("that's outside what siso live! covers");
    if (isInsufficient) {
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
      answer,
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
