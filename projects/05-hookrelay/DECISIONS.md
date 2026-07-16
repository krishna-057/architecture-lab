# HookRelay Decisions

## 2026-07-16: Start With Fastify API, Next Dashboard, And In-Memory Delivery Records

Decision:
Use a small Fastify API and Next.js dashboard for the first HookRelay scaffold. Store endpoints, events, idempotency keys, and delivery attempts in memory for now.

Why:
- HookRelay's core interview signal is HTTP delivery behavior: idempotency, signatures, retries, logs, and replay.
- Fastify gives a direct HTTP boundary without the extra structure of NestJS before the domain model stabilizes.
- In-memory state keeps the first slice runnable without PostgreSQL and Redis while still shaping the resources that will later become durable tables and BullMQ jobs.
- The dashboard forces the API to expose useful operator state instead of only implementing hidden backend routes.

Rejected alternatives:
- NestJS first: useful later if the API grows substantially, but heavier than needed for the first delivery contract.
- PostgreSQL and BullMQ in the first scaffold: closer to production, but it would mix schema/worker setup with the more important initial API contract.
- Sending outbound HTTP in the first scaffold: tempting, but replay, signing, and retry semantics should be explicit before real network side effects are introduced.

Follow-up:
Add PostgreSQL tables and a BullMQ delivery worker after the endpoint/event/delivery attempt shapes are validated.
