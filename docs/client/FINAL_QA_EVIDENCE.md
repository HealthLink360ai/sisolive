# SISO Live Final QA Evidence

Last QA date: 2026-06-23

## Production Smoke

Command:

```bash
SISO_ADMIN_PASSWORD='...' python3 qa/production-smoke.py
```

Result:

- Frontend reachable.
- Backend health OK.
- Admin login OK.
- Admin dashboard OK.
- Admin users OK.
- Admin documents OK.
- Admin diagnostics OK.
- Chat query OK.
- Feedback OK.

## RAG Evaluation

Command:

```bash
SISO_ADMIN_PASSWORD='...' python3 qa/rag-eval.py
```

Expected result:

- Pinecone connected.
- Cohere connected.
- Vector count greater than zero.
- Known supplier inclusion questions answer with source files.
- Unsupported control question escalates.

Most recent validated production state:

- Pinecone status: connected.
- Indexed source sections: 96.
- Cohere status: connected.
- Known domain questions returned source-grounded answers.
- Unsupported control question escalated.

## Current Demo Risk

Fresh source-grounded answers may take several seconds, commonly around 5-10 seconds depending on model latency. For demo flow, use the approved question set first and allow the loading state to complete.

## Notes

Demo/admin users are exempt from learner query limits so client QA and demos are not blocked by normal daily usage controls.
