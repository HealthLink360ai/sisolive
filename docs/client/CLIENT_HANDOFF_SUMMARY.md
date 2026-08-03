# SISO Live Client Handoff Summary

## What SISO Live Is

SISO Live is a precision learning tool for AbbVie Supplier Inclusion & Sustainability content. It lets employees ask natural-language questions and receive source-grounded answers from approved SISO materials.

The experience is designed for controlled pilot use: learners get guided answers, admins can review activity and knowledge gaps, and the team can improve the knowledge base through an auditable content review loop.

## Current Demo URL

- Frontend: https://sisolive.lspdedge.com
- Fresh first-time flow: https://sisolive.lspdedge.com/?fresh=1
- Backend health: https://sisolive.vercel.app/health

Login credentials should be shared separately through an approved secure channel.

## What Is Ready For Client Review

- Learner chat experience for Supplier Inclusion & Sustainability questions.
- Source-grounded answer cards with confidence and source attribution.
- Feedback capture for helpful/not helpful responses.
- Admin dashboard with activity, answer demand, needs-review signals, and usage metrics.
- Document management view showing searchable source sections.
- Search health check for source index, language model, and live source lookup.
- Off-topic guardrails so unrelated questions escalate rather than forcing unsupported answers.

## What The System Uses Today

- Approved SISO source content indexed into Pinecone.
- Cohere embeddings for source search.
- Anthropic Claude for answer generation.
- Neon Postgres for users, queries, feedback, and admin metrics.
- Netlify frontend and Vercel backend deployment.

## Important Framing For The Client

SISO Live does not silently train itself on user questions. User activity creates review signals:

- repeated low-confidence questions;
- escalations;
- thumbs-down feedback;
- missing or unclear content areas.

Content owners then update approved source materials, admins re-index the content, and QA checks confirm whether the tool improved.

## Known Pilot Boundaries

This version is ready for a controlled demo and pilot discussion. It is not yet the final enterprise rollout.

Remaining enterprise work includes:

- AbbVie SSO integration;
- formal role and access review;
- audit logging expansion;
- retention and deletion policy;
- security review documentation;
- formal test coverage and monitoring;
- migration from prototype single-file frontend toward a production build pipeline.

## Recommended Demo Message

"SISO Live helps AbbVie teams learn Supplier Inclusion & Sustainability guidance faster by searching approved source materials and returning a concise, source-grounded answer. The tool also captures feedback and knowledge gaps, so the SISO team can continuously improve the underlying content through a controlled review process."

## First-Time Demo Flow

Use the fresh first-time flow link when presenting the experience to a new reviewer:

https://sisolive.lspdedge.com/?fresh=1

This resets local onboarding state in the browser before login, so the reviewer sees the orientation experience instead of landing directly in a previously used session. It can be used with the approved demo account; after orientation, admin users can still open the Admin dashboard from the learner experience.
