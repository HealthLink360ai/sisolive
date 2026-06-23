# SISO Live Client Demo Runbook

Use this as the final pre-demo script for the controlled client walkthrough.

## Demo Login

- URL: https://sisolive.lspdedge.com
- Demo admin: `admin@abbvie.com`
- Password: use the current approved demo password from the project owner.

Do not present password login as the enterprise final state. SSO is intentionally deferred until the security-review phase.

## Demo Flow

1. Open the homepage and sign in.
2. Start in the learner chat experience.
3. Ask two approved supplier inclusion questions.
4. Point out source-grounded answers, confidence, and feedback.
5. Ask one unsupported control question and show escalation.
6. Open Admin.
7. Show Dashboard: active users, total queries, confidence, escalation rate.
8. Show Answered demand vs Needs review.
9. Open Documents and Diagnostics.
10. Run Diagnostics and confirm search index, language model, and indexed document sections.

## Approved Demo Questions

- What is supplier inclusion?
- What is supplier inclusion and how is it different from supplier diversity?
- What are AbbVie's four pillars of supplier inclusion?
- How does AbbVie measure and track supplier inclusion progress?
- How does AbbVie define a diverse supplier?

## Unsupported Control Question

- What is the capital city of Mars?

Expected behavior: the tool should escalate instead of inventing an answer.

## What To Say About Learning

SISO Live does not silently train itself on user questions. It improves through an auditable loop:

- users ask questions and give feedback;
- repeated escalations and downvotes become review signals;
- content owners update approved source documents;
- admins re-index documents;
- QA reruns RAG evaluation to prove retrieval improved.

## Pre-Demo Production Checks

Run both checks before the client demo:

```bash
SISO_ADMIN_PASSWORD='...' python3 qa/production-smoke.py
SISO_ADMIN_PASSWORD='...' python3 qa/rag-eval.py
```

Passing result means:

- frontend is reachable;
- backend is healthy;
- login works;
- admin panels respond;
- chat and feedback work;
- Pinecone has indexed vectors;
- known questions answer with sources;
- unsupported questions escalate.

## Known Boundaries

- This is ready for a controlled demo/pilot, not broad enterprise release.
- SSO is intentionally off until the final auth integration phase.
- Full enterprise readiness still needs audit logs, retention policy, formal migrations, security packet, monitoring, test coverage, and vendor/data-flow review.
