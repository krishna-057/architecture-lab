# HookRelay Interview Notes

Key topics:

- Retry with exponential backoff.
- Idempotency keys and duplicate delivery.
- HMAC signature verification.
- Dead-letter queues.
- Observability for delivery attempts.

## First Slice Talking Points

- The API accepts events by `(endpoint_id, idempotency_key)` so producer retries do not create duplicate delivery attempts.
- Delivery attempts are separate records from events. That allows one immutable event payload to have multiple attempts, including manual replay attempts.
- HMAC signing uses `timestamp.rawPayload` so receivers can reject tampered payloads and later enforce timestamp replay windows.
- The scaffold returns a delivery contract from the API because clients and the dashboard need one source of truth for retry delays, signature headers, and replay rules.
- The worker is intentionally deferred. A queued delivery record proves the boundary where BullMQ will later pick up durable jobs and perform outbound HTTP.

## Scaling Discussion

Endpoint, event, and delivery attempt state can now move into PostgreSQL, and delivery jobs can be enqueued through BullMQ backed by Redis. At that point, API instances stay stateless while workers own network retries, backoff, and dead-letter promotion.

Observability should attach one trace across event ingestion, job enqueue, each delivery attempt, and final dead-letter/replay state. That is more useful than only logging HTTP status codes because webhook failures often involve DNS, TLS, timeouts, and receiver-side 5xx responses.

## Durable Boundary Talking Points

- The API still supports in-memory mode so contributors can run checks without Docker, but production-like mode is selected by environment variables.
- PostgreSQL enforces idempotency with a unique `(endpoint_id, idempotency_key)` constraint, which is stronger than only checking an application map.
- BullMQ jobs contain only the delivery id. The worker reloads the delivery, event, and endpoint from storage so Redis is not the source of truth.
- Failed attempts are immutable enough for operator history: the worker marks the failed attempt and creates a new queued attempt for the retry.
- Dead-letter is a delivery status, not a separate service yet. That keeps replay simple while still proving the failure state.

## Receiver Verification And Replay Talking Points

- Receivers verify `HookRelay-Signature` by computing HMAC-SHA256 over `HookRelay-Timestamp.rawBody`, not a parsed JSON object. That avoids signature mismatches caused by JSON formatting changes.
- A timestamp tolerance is part of the verification contract because signatures alone prove integrity, not freshness.
- `GET /api/receiver-verification-example` exists so receiver developers can see the required headers, signed payload shape, sample payload, and digest expression from the API itself.
- Manual replay requires a reason before creating a new delivery attempt. That is the smallest useful authorization boundary before tenant users, roles, and approvals exist.
- Replay audit fields live on the delivery attempt, not the event, because the original event remains unchanged while each replay is a separate operator action.

## Jittered Retry Talking Points

- Fixed retry ladders are easy to explain, but they can synchronize failures. If a receiver outage affects many deliveries at once, exact retries can hammer the receiver again at 10s, 30s, and 120s.
- HookRelay keeps the documented ladder but adds bounded jitter around each base delay. That preserves predictability while spreading retry load.
- The computed schedule is stored on the delivery attempt, so operators see `base_delay_seconds`, `jitter_seconds`, `scheduled_delay_seconds`, and `next_attempt_at`.
- BullMQ jobs use the persisted `next_attempt_at`; Redis is scheduling work, not inventing retry policy.
- This is a stepping stone before tenant-specific retry profiles, endpoint rate limits, and tracing.

## Observability Talking Points

- Delivery observability is modeled as spans instead of only status logs because each webhook attempt crosses several boundaries: API ingestion, queue enqueue, worker processing, receiver HTTP, retry creation, and dead-letter state.
- The first implementation stores a provider-neutral span envelope with `trace_id`, `span_id`, optional parent id, timing, status, delivery identifiers, attributes, and error.
- In-memory mode keeps local checks fast. PostgreSQL mode persists spans so separate API and worker processes can contribute to the same recent trace feed.
- The span names are intentionally domain-specific (`hookrelay.delivery.process`, `hookrelay.delivery.http_request`) so an interview discussion can move from product behavior to OpenTelemetry mapping naturally.
- Full OpenTelemetry export is deferred until there is a clear collector, sampling, retention, and dashboard choice.

## Receiver Failure Classification Talking Points

- Delivery attempts now store `failure_class` in addition to raw `error`, so operators can group failures without parsing unstable messages.
- HTTP 4xx and 5xx are separated because they usually mean different ownership: producer/receiver contract mistakes versus receiver outage or overload.
- Timeout and network failures are separate from HTTP failures because there may be no receiver response at all.
- Classification happens inside the worker before retry scheduling and dead-letter promotion, so every retry attempt keeps the reason HookRelay observed at that boundary.
- The dashboard searches the delivery log through server-side query parameters, including `failure_class=none` for queued/succeeded attempts that do not have a failure.
- Delivery search deliberately uses exact filters, cursor pagination, and a bounded text query before saved views or a full-text index.
- Cursor pagination uses `(created_at, delivery_id)` instead of offsets so append-heavy delivery logs do not skip or duplicate attempts when new worker records arrive.
- Saved delivery views reuse the delivery search filters, require `operator` or `admin`, and are scoped by API-key `owner_id`.
- Saved views intentionally do not store cursors because operators expect a preset to start at the newest matching attempts, not a stale page position.
- Delivery export reuses the same filters, returns a bounded CSV snapshot, and joins attempts back to endpoint ownership before returning rows.
- Export is synchronous and capped first; background jobs, durable files, scheduled reports, and JSONL belong after delivery retention is real.
- Receiver failure alert routes match worker-recorded failed/dead-letter attempts by owner, status, and optional `failure_class`.
- Alert dispatch is deliberately a local alert record first, which proves policy and audit behavior before adding external notification retries and escalation schedules.
- Alert acknowledgement is owner-scoped and operator/admin-only. It writes `acknowledged_at`, `acknowledged_by`, and `acknowledgement_note` once on the alert record.
- Acknowledgement does not rewrite the delivery attempt or route, which keeps failure evidence immutable while still giving operators a triage audit trail.
- Alert suppression windows live on the route. A route emits one alert, records `last_alert_at`, then suppresses repeated matches until the window expires.
- Suppression skips duplicate alert records only; delivery attempts still retain their status and `failure_class`, so debugging evidence remains available.
- Webhook alert notifications are best-effort after local alert creation. The alert record stores `notification_status`, response status, error, and attempted timestamp.
- Notification delivery is intentionally separate from receiver delivery retry state; a failed operator notification should not rewrite the receiver attempt status.
- Notification retry tracking stays on the alert record with attempt count, next retry timestamp, and exhaustion state. Manual retry reuses the same alert id so the operator timeline stays compact.
- Automatic notification retry jobs are deferred until there is enough signal to justify a second queue and per-target delivery history.
- Alert notifications are signed with `HookRelay-Alert-Timestamp` and `HookRelay-Alert-Signature` over `timestamp.rawBody`, using a separate alert notification secret instead of receiver endpoint secrets.
- Separate alert signing keeps notification targets from depending on receiver credentials and mirrors the delivery signature model without coupling the two side effects.
- This is intentionally not a full alerting system yet; it creates the durable field that later dashboards, alerts, and endpoint-specific retry policy can use.

## Endpoint Rate Limit Talking Points

- Rate limiting runs before event insertion and queue creation, which protects the request path and the worker backlog from a noisy endpoint.
- The first scope is `endpoint_id` because HookRelay does not have tenants or producer API keys yet. That is a deliberate intermediate boundary, not the final quota model.
- In-memory counters keep the scaffold runnable without Redis. Redis fixed-window counters become active when `REDIS_URL` is configured, so multiple API instances share the same window.
- The API returns `429`, `Retry-After`, and `X-RateLimit-*` headers so producers have a clear backoff contract.
- Token buckets, tenant quotas, and producer-specific limits are deferred until identity and ownership exist.

## Producer API Key Talking Points

- Producer API keys are the first authentication boundary because HookRelay needs to stop treating event ingestion as globally writable before adding tenant UI.
- Endpoints store `owner_id`, and event ingestion requires the API key owner to match that endpoint owner. That prevents cross-owner event injection and quota consumption.
- API keys carry a minimal role. `producer` keys can create endpoints and ingest events, `operator` keys can replay deliveries, and `admin` keys can do both.
- API keys are stored as hashes with previews. The full secret is returned only once at creation, which matches common API-key operational behavior.
- Rotation creates a replacement key for the same owner and marks the old key as `rotated`. Revocation marks an active key as `revoked`. Authentication only accepts `active` keys, which keeps lifecycle enforcement in one place.
- The key lifecycle endpoints are intentionally local bootstrap/admin paths for the portfolio slice. A production version would sit behind tenant users, roles, audit actors, approval policy, and scoped key permissions.
- Ownership is checked before rate limiting and idempotency insertion, so unauthorized producers do not consume endpoint quota or create delivery records.

## Role-Based Replay Talking Points

- Manual replay is now protected by the same API-key system as producer traffic, but it requires `operator` or `admin`.
- Replay authorization checks role and endpoint owner before it creates a new delivery attempt, so a valid operator key cannot replay another owner's webhook.
- The replay reason remains required because role answers "who is allowed" while reason answers "why this operational action happened."
- This is deliberately smaller than full tenant RBAC. It proves least privilege at the delivery boundary before adding users, teams, approval flows, and signed audit actors.
