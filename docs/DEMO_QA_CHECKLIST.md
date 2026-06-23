# SISO Live Demo QA Checklist

Complete this checklist immediately before handoff.

## Production Smoke

- [ ] Frontend loads at https://sisolive.lspdedge.com.
- [ ] Backend health is OK.
- [ ] Demo admin login succeeds.
- [ ] Dashboard loads real metrics or a visible error state.
- [ ] Users, Documents, and Diagnostics panels load.
- [ ] Chat returns a response with a saved query ID.
- [ ] Feedback records successfully.

## RAG Quality

- [ ] Pinecone status is connected.
- [ ] Vector count is greater than zero.
- [ ] Cohere status is connected.
- [ ] Known supplier inclusion questions answer with source filenames.
- [ ] Unsupported control question escalates.
- [ ] Answers do not cite unsupported facts.
- [ ] Repeated questions are faster through cache.
- [ ] Cache-bypassed RAG eval still passes.

## Demo Experience

- [ ] Homepage image and AbbVie logo display correctly.
- [ ] Sign-in box has no excessive whitespace.
- [ ] Robot image has transparent background and consistent sizing.
- [ ] No visible fake SSO action.
- [ ] Chat loading state is clear while answer is generated.
- [ ] Dashboard panels are not redundant.
- [ ] "Answered demand" and "Needs review" tell different stories.

## Handoff Notes

- [ ] Explain that user behavior creates review signals, not automatic retraining.
- [ ] Explain how admins identify gaps and update approved content.
- [ ] Call out SSO as intentionally deferred.
- [ ] Call out remaining enterprise-readiness work.
