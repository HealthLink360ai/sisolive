# SISO Live! — Technical Decision Log
### AbbVie Supplier Inclusion & Sustainability Office
### Precision Learning Tool — Architecture Decisions

---

> **Purpose of this document**
> This log records every major technical decision made during the build of SISO Live!, along with the reasoning behind each choice. It is written in plain English so it can be shared directly with AbbVie stakeholders to build confidence in the approach, explain costs, and demonstrate that every decision was made intentionally — not arbitrarily.

---

## Decision 1: Why RAG instead of fine-tuning?

**What we chose:** Retrieval Augmented Generation (RAG)

**What we didn't choose:** Fine-tuning a custom AI model

**The plain English explanation:**

There are two ways to make an AI answer questions from specific documents. The first is fine-tuning — you take an existing AI model and retrain it on your documents until the knowledge bakes into the model itself. The second is RAG — you keep the AI model as-is, but every time someone asks a question, you pull the relevant document sections and hand them to the AI right then and there.

We chose RAG for four reasons:

1. **AbbVie's documents will change.** Policies get updated, new ESG targets get set, supplier requirements evolve. With fine-tuning, you'd need to retrain the entire model every time a document changes — expensive and slow. With RAG, an admin uploads a new document and it's live in minutes.

2. **RAG is auditable.** Every answer SISO Live! gives can be traced back to the exact document section it came from. In a pharmaceutical environment where compliance and accountability matter, this is critical.

3. **RAG is dramatically cheaper.** Fine-tuning a quality model costs tens of thousands of dollars and requires specialized ML engineering. RAG uses off-the-shelf cloud services at a fraction of the cost.

4. **RAG is faster to build and ship.** We can have a working system in days, not months.

**Bottom line for AbbVie:** RAG means SISO Live!'s knowledge is always current, always traceable, and always under your control.

---

## Decision 2: Why Claude (Anthropic) for the AI model?

**What we chose:** Claude (Anthropic API)

**What we evaluated:** GPT-4 (OpenAI), Gemini (Google)

**The plain English explanation:**

All three are excellent large language models. We chose Claude for SISO Live! specifically because of four factors that matter in a pharma enterprise context:

1. **Honesty and safety.** Anthropic trains Claude specifically to say "I don't know" when it doesn't have enough information, rather than making something up. For a precision learning tool where wrong answers have consequences, this matters enormously. Claude will tell a user it can't answer with confidence. GPT-4 sometimes invents plausible-sounding answers.

2. **Instruction following.** Claude respects constraints precisely. When we tell it "never answer with more than 400 characters" or "only use the provided documents," it follows those rules reliably. This is what makes the confidence threshold and the source-grounding work.

3. **Enterprise agreement.** Anthropic has data processing agreements suitable for enterprise use. Our implementation ensures AbbVie's proprietary documents never become training data.

4. **Cost efficiency.** Claude Sonnet (the model we're using) is significantly cheaper per query than GPT-4 with comparable accuracy for this use case.

**Bottom line for AbbVie:** Claude was chosen because it's honest, disciplined, and cost-appropriate for SISO Live!'s specific requirements.

---

## Decision 3: Why Pinecone for the vector database?

**What we chose:** Pinecone (managed vector database)

**What we evaluated:** Weaviate (self-hosted), Qdrant (self-hosted), pgvector (PostgreSQL extension)

**The plain English explanation:**

A vector database is a specialized database that stores meaning as numbers. When a user asks "What are our diversity targets?", we convert that question into a 1024-number representation of its meaning, then search the database for documents with similar meaning. This is called semantic search — it finds conceptually similar content even when the exact words don't match.

We chose Pinecone because:

1. **Fully managed — no servers to maintain.** Self-hosted options like Weaviate require infrastructure teams to manage, monitor, and scale. Pinecone is a service — AbbVie pays for what they use and Pinecone handles everything else.

2. **Enterprise-grade security.** Pinecone is SOC 2 Type II certified and HIPAA-eligible, which meets AbbVie's security requirements.

3. **Generous free tier covers the MVP and beyond.** Pinecone's free tier handles 1 million vectors — which is enough for a substantial knowledge base at no cost until utilization justifies the upgrade.

4. **Sub-100ms search.** Even searching millions of document chunks, Pinecone returns results in under 100 milliseconds.

**Bottom line for AbbVie:** Pinecone gives enterprise-grade vector search without any infrastructure overhead.

---

## Decision 4: Why Cohere for embeddings?

**What we chose:** Cohere `embed-english-v3.0`

**What we evaluated:** OpenAI `text-embedding-3-large`, Cohere, local models

**The plain English explanation:**

Every piece of text in SISO Live! — both the document chunks and the user questions — needs to be converted into a vector (a list of numbers that represents meaning). This conversion is done by an embedding model.

We chose Cohere because:

1. **Purpose-built for enterprise search.** Cohere's embedding model was specifically designed for retrieval tasks in business content — not general-purpose generation. For SISO Live!'s use case (searching supplier policy documents), it performs slightly better than OpenAI's embedding model.

2. **Most cost-efficient.** At approximately $0.0001 per 1,000 tokens, Cohere embedding costs are negligible — even at scale.

3. **Consistent model.** We use the same embedding model for both document ingestion and query processing. This is critical — if you use different models, the numbers they produce aren't comparable and search breaks.

**Bottom line for AbbVie:** Cohere converts text to searchable meaning cheaply and accurately.

---

## Decision 5: Why PostgreSQL for metadata?

**What we chose:** PostgreSQL relational database

**What we evaluated:** MongoDB (document database), DynamoDB (AWS managed)

**The plain English explanation:**

We use two databases in SISO Live!. Pinecone stores the vectors (the "meaning" of document chunks). PostgreSQL stores everything else — users, feedback, audit logs, document metadata, usage analytics.

We chose PostgreSQL because:

1. **Relationships matter here.** We need to connect users to their queries, queries to their feedback, feedback to source documents. Relational databases are built exactly for this kind of connected data.

2. **SQL is the universal language for reporting.** The admin dashboard needs complex analytics — "show me all downvoted responses from the last 30 days grouped by topic." SQL handles this elegantly. Document databases don't.

3. **Rock-solid reliability.** PostgreSQL has been in production use for 30 years. It's battle-tested, open source, and runs on every major cloud platform.

4. **Compliance-ready.** PostgreSQL supports row-level security, encryption at rest, and complete audit logging — all requirements for pharma-adjacent applications.

**Bottom line for AbbVie:** PostgreSQL is the reliable backbone that connects everything together and powers the analytics.

---

## Decision 6: Why a serverless backend?

**What we chose:** Serverless deployment (Vercel or AWS Lambda)

**What we evaluated:** Dedicated server (EC2, Digital Ocean), containerized (Docker/Kubernetes)

**The plain English explanation:**

A serverless backend means there is no server sitting idle waiting for users. Instead, the code only runs — and you only pay — when a user actually sends a request. The moment the request is handled, the compute shuts down.

We chose serverless because:

1. **AbbVie's usage pattern is unpredictable at launch.** If nobody uses the tool at 2am, you pay nothing. If 50 people use it at 9am, it scales automatically.

2. **Dramatic cost savings at low utilization.** A dedicated server costs $50-200/month whether you get one query or one million. Serverless costs fractions of a cent per query — so at the usage levels we're projecting, the infrastructure cost is nearly zero.

3. **No infrastructure team needed.** No server patching, no uptime monitoring, no capacity planning. The platform handles all of that.

4. **Scales automatically.** If AbbVie decides to roll out SISO Live! org-wide, the backend scales with zero configuration changes.

**Bottom line for AbbVie:** You pay only when people use the tool, and it handles growth automatically.

---

## Decision 7: How SISO Live! Decides When to Escalate

**What we chose:** Let Claude's own judgment be the primary escalation signal, with the confidence score acting only as a hard floor for the one case it's actually good at detecting: no relevant content at all.

**Why not a simple confidence cutoff:**

Our original design escalated to the support desk whenever a numeric confidence score (from vector search similarity) fell below 90%. In practice, that score turned out to be a poor proxy for whether an answer was actually trustworthy — similarity scores vary a lot by domain and phrasing, and a "low" score often still pointed at a perfectly good, on-topic passage. Relying on it as a hard cutoff meant SISO Live! would escalate questions it was fully capable of answering.

The current mechanism works differently:

1. **Zero chunks retrieved is the only hard, automatic escalation.** If document search (Pinecone) returns literally no matching passages — an empty or unavailable index — SISO Live! escalates immediately without calling Claude. In that case, the confidence threshold from `CONFIDENCE_THRESHOLD` applies, but the application code caps it at 0.35 maximum regardless of what's configured in `.env` (defaulting to 0.25 if unset). See `src/services/retrieval.service.js`.

2. **Whenever chunks exist, Claude is the judge.** SISO Live! always attempts generation and hands Claude the retrieved passages with strict instructions to answer only from them. Claude escalates on its own, in its own output, only when the source excerpts are genuinely unrelated to the question — not based on any numeric score. This is enforced through explicit system-prompt rules (see `src/services/generation.service.js`) telling Claude that a single matching source is enough to answer, that foundational questions should basically never be escalated, and that escalation should be reserved for excerpts that are literally about a different topic.

3. **Why this is more accurate.** Claude can actually read and evaluate whether a passage answers the question; a cosine-similarity score cannot. Letting Claude make the call, with the retrieval score only guarding against the "nothing came back at all" case, means SISO Live! answers far more of the questions it's genuinely capable of answering while still protecting against fabricated answers when there's truly nothing relevant in the knowledge base.

**What the data will tell us:** The admin feedback dashboard shows which topics get escalated (by either mechanism) most often. Those become the priority list for new document uploads — directly improving the tool with zero model changes.

---

## Decision 8: The 400-Character Response Limit

**What we chose:** Cap all responses at 400 characters

**The reasoning:**

This is a deliberate design choice rooted in learning science, not a technical limitation:

1. **Precision over volume.** A precision learning tool should give people exactly what they need, not overwhelm them with paragraphs. 400 characters is about 2-3 sentences — enough to answer a focused question completely.

2. **Forces source discipline.** Limiting response length forces the AI to prioritize the most important information from the retrieved documents. It can't pad answers.

3. **Mobile-friendly.** AbbVie users may access SISO Live! on mobile. Short, precise answers work on any screen size.

4. **The "gentle nudge" does the rest.** Instead of a long response, SISO Live! answers concisely and then offers a topic suggestion to explore further. This creates an active learning experience rather than passive reading.

---

## Monthly Cost Projections

| Usage Level | Queries/Month | Est. Claude Cost | Est. Cohere Cost | Est. Pinecone | Est. Total |
|---|---|---|---|---|---|
| Pilot (50 users) | ~750 | ~$8 | <$1 | Free tier | ~$10/mo |
| Launch (250 users) | ~3,750 | ~$40 | ~$2 | Free tier | ~$45/mo |
| Growth (500 users) | ~7,500 | ~$80 | ~$4 | Free tier | ~$90/mo |
| Scale (2,000 users) | ~30,000 | ~$320 | ~$15 | Starter ($70) | ~$410/mo |

*Estimates based on average query length, 5 document chunks retrieved per query, Claude Sonnet pricing as of 2025. Database (PostgreSQL via Supabase) free tier covers all levels above.*

**A monthly spend cap is hard-coded into the system.** If costs approach a set threshold, the system alerts admins before cutting off queries. No surprise bills.

---

## Security Architecture Summary

| Layer | What We Do | Why |
|---|---|---|
| Authentication | JWT tokens, 24h expiry (configurable via JWT_EXPIRY) | Secure, stateless, works serverless |
| Role separation | `user` vs `admin` roles | Regular users never see admin routes |
| Rate limiting | 10 req/min global chat limit, configurable (default 10) login attempts per 15 min | Prevents abuse and brute force |
| HTTPS | Enforced in production | All data encrypted in transit |
| Input validation | Basic presence/length checks on request bodies; no formal schema validation library — flagged as a P1 gap | Prevents obviously malformed requests; stronger validation still needed |
| Audit logging | Key actions (login, logout, document upload/delete/reingest, admin user management) are logged to a durable audit_log table | Compliance and forensics |
| Budget guard | Hard spend cap | No runaway costs |
| Data residency | Configurable by region | Can keep data in AbbVie-approved regions |

---

*Document version 1.0 — Updated as build progresses*
*Project: SISO Live! | Client: AbbVie*
