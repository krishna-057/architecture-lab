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

## 2026-07-27: Add Bounded Retry Jitter

Decision:
Add bounded symmetric jitter to the existing retry ladder and store the computed schedule on each delivery attempt as `base_delay_seconds`, `jitter_seconds`, and `scheduled_delay_seconds`.

Why:
- Webhook receivers often fail in bursts, so exact retry timestamps can recreate a thundering herd when many events fail at once.
- A bounded jitter ratio keeps the retry policy explainable while still spreading load around the nominal delay.
- Storing the computed values makes operator logs auditable; `next_attempt_at` is no longer a mysterious timestamp.
- Keeping the helper in `retry-policy.js` gives the API, worker, contract, and tests one shared scheduling rule.

Rejected alternatives:
- Full exponential backoff rewrite: useful later, but the current ladder is already documented and good enough for this lab slice.
- Unbounded random jitter: spreads load, but makes retry timing hard to reason about and hard to explain in interviews.
- Queue-only jitter inside BullMQ: would hide timing from the database and dashboard, which weakens delivery-log observability.

Follow-up:
Add tenant-specific retry policies, endpoint-level rate limits, and OpenTelemetry timing spans.

## 2026-07-27: Add Local Delivery Observability Spans

Decision:
Record provider-neutral spans for event ingestion, delivery enqueue, manual replay, worker processing, and outbound receiver HTTP. Keep the default span log in-process, and persist spans to PostgreSQL when `DATABASE_URL` is configured.

Why:
- Webhook delivery failures need lifecycle timing, not just final statuses. Operators need to see whether time was spent accepting an event, queueing, processing a worker job, or waiting on the receiver.
- A plain JSON span envelope keeps the implementation easy to inspect while matching the concepts used by OpenTelemetry: trace id, span id, parent span, timing, status, attributes, and error.
- PostgreSQL persistence gives the API and worker a shared local trace log in durable mode without introducing a collector service before the delivery lifecycle is stable.
- The dashboard can now show observability signal directly beside delivery logs, which makes the portfolio demo easier to explain.

Rejected alternatives:
- Add a full OpenTelemetry collector now: useful later, but too much infrastructure before deciding sampling, exporter, and retention rules.
- Only use application logs: logs are helpful, but they do not give a structured parent/child lifecycle around a delivery attempt.
- Store spans only in memory: fine for the dependency-light scaffold, but durable mode needs worker and API spans to meet in one query surface.

Follow-up:
Add OpenTelemetry exporters, trace sampling, endpoint-level latency charts, and receiver failure classification.

## 2026-07-27: Add Endpoint-Level Event Rate Limits

Decision:
Add endpoint-scoped fixed-window rate limits to `POST /api/events`. Store the policy on each endpoint, use in-process counters by default, and use Redis counters when `REDIS_URL` is configured.

Why:
- Webhook platforms need a pressure valve before a noisy endpoint or producer can flood ingestion and queue creation.
- Endpoint scope is the smallest useful boundary because HookRelay does not have tenant users or producer API keys yet.
- A fixed window is easy to explain, cheap to implement with Redis `INCR` plus expiry, and good enough before per-tenant quota products exist.
- Returning standard `429`, `Retry-After`, and `X-RateLimit-*` headers gives producers a concrete retry contract.

Rejected alternatives:
- Token bucket now: smoother under bursty traffic, but more moving parts than needed for the first quota slice.
- Global API-only limit: protects the service, but does not prove endpoint-specific isolation.
- Full tenant quota service: important later, but premature before tenant ownership and auth are implemented.

Follow-up:
Add tenant identity, producer API keys, token-bucket smoothing, and separate read/write/admin quotas.
