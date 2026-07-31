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

## 2026-07-28: Add Producer API Keys And Endpoint Ownership

Decision:
Add producer API keys with hashed storage and bind endpoints to an `owner_id`. Require an active producer key for endpoint creation and event ingestion, and require the key owner to match the endpoint owner before accepting events.

Why:
- Endpoint-level rate limits are more meaningful once an endpoint belongs to an owner instead of being globally writable.
- Producer API keys are the smallest useful authentication boundary before adding tenant users, login sessions, teams, and RBAC.
- Hashing keys and returning only previews after creation matches the operational shape of API-key systems without bringing in a secret manager yet.
- Checking ownership before rate limiting and insertion prevents a producer from consuming another owner's endpoint quota or creating delivery attempts.

Rejected alternatives:
- Full user accounts and OAuth now: correct later, but too much identity work for this delivery-focused lab slice.
- Store plaintext API keys: easier for demos, but it teaches the wrong production habit.
- Protect only event ingestion: endpoint creation also needs ownership, otherwise local users can create unowned endpoints that do not fit the later tenant model.

Follow-up:
Add key rotation, disabled/revoked key flows, tenant users, team membership, and role-based replay authorization.

## 2026-07-30: Add Producer Key Rotation And Revocation

Decision:
Add producer API key lifecycle endpoints for rotation and revocation. Rotation marks the current key as `rotated`, creates a replacement key for the same `owner_id`, links it with `rotated_from_key_id`, and returns the new secret once. Revocation marks an active key as `revoked`.

Why:
- Producers need a low-friction way to replace exposed or aging credentials without changing endpoint ownership.
- Keeping the replacement key on the same `owner_id` preserves the existing ownership rule and avoids introducing tenant users before they are needed.
- Storing terminal statuses plus `revoked_at` makes key state explainable in the dashboard and durable schema while keeping authentication simple: only `active` keys pass.
- Returning the full key only on creation or rotation keeps the secret-handling behavior consistent.

Rejected alternatives:
- Add full tenant RBAC for key lifecycle now: correct later, but too broad for this slice.
- Physically delete revoked keys: simpler storage, but it removes audit context and makes support/debugging weaker.
- Allow rotating inactive keys: convenient in demos, but it muddies the lifecycle and can hide operational mistakes.

Follow-up:
Add tenant users, lifecycle audit actors, approval-backed revocation, scoped producer permissions, and role-based replay authorization.

## 2026-07-31: Add Role-Based Replay Authorization

Decision:
Add a minimal role field to producer API keys and require `operator` or `admin` for manual replay. Keep `producer` or `admin` for endpoint creation and event ingestion. Replay still requires the key `owner_id` to match the delivery endpoint owner and still requires a human-readable replay reason.

Why:
- Manual replay can resend customer-facing webhooks, so it should not be authorized by intent text alone.
- API-key roles reuse the existing hashed key and owner model, avoiding a premature tenant user/RBAC build.
- Separating `producer` and `operator` gives the portfolio slice a concrete least-privilege story while keeping local bootstrap simple.
- Keeping owner matching on replay prevents one tenant operator key from replaying another tenant's delivery.

Rejected alternatives:
- Full tenant users and team RBAC now: the final shape is right, but it would dominate the delivery-platform slice.
- A shared static operator token: fast to implement, but it would bypass owner scope and duplicate the API-key auth path.
- Keep replay unauthenticated with only `requested_by`: useful for a first demo, but too weak once producer keys and ownership exist.

Follow-up:
Add signed user identity to replay audit records, approval workflows for sensitive replays, scoped permissions per endpoint, and tenant-managed team membership.

## 2026-07-31: Add Receiver Failure Classification

Decision:
Classify failed delivery attempts with a stable `failure_class` field before retry scheduling or dead-letter promotion. Use a small first taxonomy: `receiver_http_4xx`, `receiver_http_5xx`, `receiver_http_other`, `receiver_timeout`, `receiver_network`, and `internal_error`.

Why:
- Operators need to know whether failures are receiver application errors, receiver outages, network path issues, timeouts, or worker/internal problems without parsing free-form error strings.
- Classification belongs in the worker because that is where HookRelay sees the receiver response or fetch error.
- Keeping the class on `delivery_attempts` makes retries, dead letters, dashboards, and future alerts query the same durable field.
- A small text taxonomy is enough for this slice and avoids premature alert routing or incident workflow modeling.

Rejected alternatives:
- Store only raw error messages: easy, but too brittle for dashboards and interview discussion.
- Add a separate failure analytics table now: useful later, but overkill before the delivery attempt lifecycle needs aggregation.
- Classify only in the dashboard: presentation-only classification would drift from worker behavior and would not help durable alerting.

Follow-up:
Add receiver failure trend charts, alert routing by failure class, endpoint-specific retry policies, and richer receiver diagnostics.

## 2026-08-01: Add Failure-Class Dashboard Filters

Decision:
Add client-side failure-class filtering to the delivery log. The dashboard exposes `all`, `none`, and every contract-published/observed `failure_class` with live counts, then filters the already-loaded delivery attempts in memory.

Why:
- Operators need to isolate receiver failures quickly once `failure_class` exists.
- The current `/api/deliveries` endpoint returns a bounded local list, so client-side filtering is simpler than adding query parameters before pagination or long-retention search exists.
- Counts beside each class make the filter useful even when the selected class has no matching attempts.
- Including `none` keeps successful, queued, and not-yet-run attempts visible as a deliberate operational state.

Rejected alternatives:
- Add server-side filtering now: useful later, but premature without pagination, saved views, or delivery history retention.
- Build charts immediately: attractive, but filtering is the smaller operator workflow that proves the classification is usable.
- Hard-code only current classes in the UI: contract-published classes keep the dashboard aligned with the API if the taxonomy grows.

Follow-up:
Add server-side delivery search, failure trend charts, saved operator views, and alert routing by failure class.
