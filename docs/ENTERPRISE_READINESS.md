# SISO Live Enterprise Readiness Plan

Last updated: 2026-06-22

## Current Position

SISO Live is suitable for a controlled pilot/demo once the P0 list is clear. It is not yet ready for enterprise security review or broad pharmaceutical production use.

SSO/OIDC/SAML is intentionally deferred until the final enterprise rollout step. All work below should preserve the current password login while keeping the auth boundary clean enough to swap in SSO later.

## P0: Demo Trust And Functional Correctness

These items block a confident client/partner demo.

- Live dashboard must show real metrics or a clear visible error state.
- Stored session restore must require both a user and a token; no "ghost admin" state.
- SSO button must not perform fake password login. It should be disabled or clearly marked as a future enterprise rollout item.
- Chat must return a stable `queryId`.
- Feedback must submit against the real saved `queryId`.
- Admin dashboard/users/documents/diagnostics must return 200 for admin.
- Upload UI must only advertise file types supported by the backend.
- Browser console must have no app errors on login, chat, and admin navigation.
- Production smoke script must pass before a demo.

## P1: Pilot Hardening

These items are needed before expanding beyond a tightly controlled pilot.

### Frontend

- Replace single-file runtime-Babel React with a built React app (Vite is sufficient).
- Use production React bundles and precompiled JSX.
- Add a typed/shared API contract so route mismatches fail in tests.
- Add visible error states for every admin panel and upload state.
- Add loading/progress indicators for first-time RAG responses.
- Add e2e smoke coverage for login, chat, feedback, dashboard, documents, upload.

### Backend

- Replace runtime schema creation with formal migrations.
- Reconcile `schema.sql` and `src/config/database.js` schema drift.
- Add request validation schemas for auth, chat, feedback, upload, admin routes.
- Add auth-specific audit logs for login success/failure, logout, upload, delete, reindex.
- Enforce active-user checks server-side on protected requests.
- Add role refresh/versioning or token invalidation so admin changes take effect quickly.
- Move document ingestion to a durable worker/queue before large-file use.
- Add structured error codes and correlation/request IDs.

### Data And Privacy

- Define retention periods for questions, answers, feedback, uploaded raw text, vectors, and logs.
- Decide whether full questions/answers should be stored, redacted, summarized, or encrypted.
- Classify all data sent to Anthropic, Cohere, Pinecone, Neon, Vercel, and Netlify.
- Remove sensitive content from routine application logs.
- Add deletion/archival behavior for documents and vectors.

## P2: Enterprise Security Review Package

These artifacts are expected for a large pharmaceutical security review.

- Architecture diagram.
- Data-flow diagram.
- Vendor/data-processing matrix.
- Threat model.
- Authentication/session design, with SSO integration plan.
- Authorization role matrix.
- Logging and audit design.
- Data retention and deletion policy.
- RAG safety policy, including prompt-injection and source-grounding controls.
- Incident response/runbook.
- Deployment and rollback runbook.
- Test evidence: unit, integration, e2e, and production smoke.
- Dependency and vulnerability scan evidence.

## Acceptance Gates

### Demo Ready

- `qa/production-smoke.py` passes against production.
- Browser login works with the approved demo admin account.
- Dashboard metrics or clear error state displays.
- Chat answers a known seeded question.
- Feedback submit succeeds.
- Admin documents and diagnostics are visible.
- No misleading fake SSO action.

### Pilot Ready

- Frontend build pipeline exists.
- Core smoke tests run in CI or before deploy.
- Admin/upload/chat happy paths and common failures are covered by tests.
- Data retention decisions are documented.
- Secrets are rotated and confirmed not committed.
- Runtime migrations are replaced or frozen behind proper migration process.

### Enterprise Review Ready

- SSO integration complete.
- Vendor/data flow approved.
- Retention and audit controls implemented.
- Worker-based ingestion implemented.
- Security review packet complete.
- Evidence generated from repeatable tests and scans.
