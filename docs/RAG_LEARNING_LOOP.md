# SISO Live RAG Learning Loop

SISO Live should get better through an auditable content and feedback loop, not by silently training itself on user questions. That matters for a pharmaceutical environment because every answer needs traceable source material, review, and a clear path to correction.

## What Must Be True For RAG To Work

- Pinecone must be connected in production.
- The Pinecone index must contain document vectors.
- Cohere embeddings must be connected.
- Chat QA must be able to bypass Redis cache so tests prove live retrieval is working.
- Answers should cite source filenames from retrieved chunks.
- Unsupported questions should escalate instead of inventing answers.

The admin diagnostics endpoint reports Pinecone status, vector count, Cohere status, and a test query. The RAG eval script uses the same production API and bypasses cache.

## What "Getting Smarter" Should Mean

The system gets smarter when the approved knowledge base improves and retrieval quality is measured. User behavior should create review signals, not uncontrolled model training data.

Recommended loop:

1. Capture query, escalation, confidence, source, latency, and feedback metadata.
2. Group repeated escalations and downvotes into knowledge gaps.
3. Have a content owner decide whether the gap is valid.
4. Add or update approved source documents.
5. Re-index the changed documents.
6. Run RAG eval before demo or release.
7. Track whether the same gap decreases over time.

## Demo Readiness Metrics

- Pinecone status: connected.
- Vector count: greater than zero.
- Retrieval hit rate: known domain questions return at least one source.
- Escalation behavior: intentionally unsupported control questions escalate.
- Source coverage: answered domain questions include source filenames.
- Latency: common questions should usually answer within 8-12 seconds in production.
- Feedback capture: thumbs up/down writes to the feedback table.

## Enterprise Readiness Metrics

- P50/P95 latency by endpoint and model provider.
- Retrieval top-score distribution by topic.
- No-answer/escalation rate by topic.
- Downvote rate and repeated-question clusters.
- Source citation coverage.
- Document freshness and re-index status.
- Per-user and tenant-level usage limits.
- Audit trail for document upload, delete, re-index, and content approval.

## Operational Rules

- Do not use user questions as trusted facts.
- Do not add answer text back into the source corpus without human review.
- Do not hide broken retrieval behind cache during QA.
- Keep admin diagnostics authenticated.
- Keep SSO as a final switch after core auth, logging, and RAG behavior are stable.

## How To Run RAG QA

```bash
SISO_ADMIN_PASSWORD='...' python3 qa/rag-eval.py
```

The script prints safe metadata only: status, latency, confidence, escalation state, query ID, and source filenames. It intentionally does not print answer text.
