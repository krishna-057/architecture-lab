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

## 2026-07-16: Add Optional PostgreSQL Storage And BullMQ Worker Boundary

Decision:
Keep in-memory mode as the default local scaffold, and activate PostgreSQL plus BullMQ when `DATABASE_URL` and `REDIS_URL` are configured.

Why:
- The project now has stable endpoint, event, idempotency, delivery attempt, replay, and signature shapes, so a durable schema can be introduced without guessing at table boundaries.
- PostgreSQL owns restart-safe endpoints, event payloads, idempotency uniqueness, delivery statuses, and dead-letter state.
- BullMQ is the right next boundary because webhook delivery is network-bound, retry-heavy work that should not run inside the request path.
- Optional durable mode keeps quick checks usable without Docker while still proving the real architecture with Compose.

Rejected alternatives:
- Force Docker for all local development: more production-like, but it slows lightweight API and dashboard iteration.
- Add a custom SQL-backed scheduler: unnecessary when BullMQ already provides delayed jobs and worker concurrency.
- Split the worker into a separate package now: premature for this lab; sharing signing, retry, and storage modules keeps behavior consistent.

Follow-up:
Add receiver verification examples, replay authorization, jittered retry policy, and OpenTelemetry spans.

## 2026-07-26: Add Receiver Verification Example And Replay Intent

Decision:
Expose `GET /api/receiver-verification-example` and require a replay `reason` before `POST /api/deliveries/:delivery_id/replay` queues a new attempt. Store `replay_reason` and `replay_requested_by` on replay delivery attempts.

Why:
- Receivers need an exact, copyable HMAC verification shape before HookRelay grows SDKs or framework middleware.
- Manual replay is an operator action with business impact, so the first contract should require intent even before tenant auth and roles exist.
- Keeping replay authorization as a request-body contract is enough for this slice and avoids inventing a user model too early.
- Persisting replay reason/requester on the delivery attempt gives operators an audit trail without changing event idempotency semantics.

Rejected alternatives:
- Add full tenant RBAC now: important later, but too much identity work before the replay behavior itself is settled.
- Build receiver SDK packages now: useful polish, but the verification contract should be stable first.
- Let replay stay a bare button: fast for demos, but it hides the operational accountability that webhook platforms need.

Follow-up:
Add signed operator identity, role-based replay permissions, receiver SDK helpers, and timestamp-window enforcement in a sample receiver.
