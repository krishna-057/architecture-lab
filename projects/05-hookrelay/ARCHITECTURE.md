# HookRelay Architecture

HookRelay is a webhook delivery platform with a deliberately small request path and a separate delivery worker boundary.

## Runtime Shape

```text
Producer
  |
  | POST /api/events
  v
Fastify API
  |
  | durable event + delivery attempt
  v
PostgreSQL when DATABASE_URL is set
  |
  | delivery id job
  v
BullMQ / Redis when REDIS_URL is set
  |
  | signed HTTP request
  v
Receiver endpoint
```

Without `DATABASE_URL` and `REDIS_URL`, the API still runs in in-memory mode for fast local checks. The in-memory path keeps the same endpoint, event, delivery, signature, replay, and contract shapes as durable mode.

API and worker operations also write provider-neutral observability spans. In memory mode, spans stay in the current process for quick local checks. In durable mode, spans are written to PostgreSQL so API and worker processes share the same recent delivery trace log.

## Components

| Component | Responsibility |
| --- | --- |
| Fastify API | API-key bootstrap, endpoint setup, event ingestion, idempotency handling, role-gated saved delivery views, exports, alert routing, role-gated replay enqueueing, and contract discovery. |
| Next.js web app | Developer/operator console for creating endpoints, submitting events, searching paginated delivery attempts, saving/applying delivery views, exporting CSV snapshots, routing receiver failure alerts, replaying deliveries, and inspecting signatures. |
| PostgreSQL | Optional durable owner for endpoints, events, idempotency uniqueness, delivery attempt state, alert routes, alert records, alert notification outcomes, saved delivery views, replay audit fields, and dead-letter status. |
| BullMQ / Redis | Optional durable queue, jittered delayed retry scheduler, and endpoint rate-limit counter owner. |
| Worker process | Sends signed outbound HTTP requests, classifies receiver failures, records responses, schedules retries, marks dead-letter failures, and dispatches signed best-effort webhook alert notifications. |
| Observability span log | Captures event ingestion, enqueue, replay, worker processing, and outbound HTTP timing as local JSON spans before adding a vendor exporter. |
| Endpoint rate limiter | Enforces fixed-window event ingestion limits per endpoint before accepting new producer events. |
| Producer API keys | Authenticate producers/operators, bind actions to an `owner_id`, carry a minimal role, and support active/rotated/revoked lifecycle state before a full tenant model exists. |
| Receiver verification example | Shows receivers how to rebuild `timestamp.rawBody`, compute HMAC-SHA256, and enforce a timestamp tolerance. |
| Replay authorization contract | Requires operator replay reasons before manual replay creates a new delivery attempt. |

## API Boundary

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Report API, storage, queue, and worker mode. |
| `GET /api/delivery-contract` | Discover idempotency, signature, receiver verification, retry, replay authorization, queue, and storage rules. |
| `GET /api/receiver-verification-example` | Return sample receiver verification inputs, required headers, and Node.js digest expression. |
| `GET /api/alert-receiver-verification-example` | Return sample alert notification receiver verification inputs, required headers, timestamp tolerance, and Node.js digest expression. |
| `GET /api/observability/spans` | Return recent provider-neutral spans with trace ids, span ids, timing, status, and delivery attributes. |
| `GET /api/failure-alerts` | Return recent owner-scoped receiver failure alerts. |
| `POST /api/failure-alerts/:alert_id/acknowledge` | Add acknowledgement audit fields to one owner-scoped unacknowledged alert. |
| `POST /api/failure-alerts/:alert_id/retry-notification` | Retry a pending/failed owner-scoped webhook alert notification and update notification retry tracking. |
| `GET /api/alert-routes` | List owner-scoped receiver failure alert routing rules. |
| `POST /api/alert-routes` | Create an enabled local alert route for failed/dead-letter deliveries, optionally with a suppression window. |
| `DELETE /api/alert-routes/:route_id` | Delete one owner-scoped alert route. |
| `GET /api/producer-api-keys` | List producer key previews, owners, and status without exposing full secrets. |
| `POST /api/producer-api-keys` | Create a local producer/operator/admin key and return the full secret once for development bootstrap. |
| `POST /api/producer-api-keys/:key_id/rotate` | Replace an active key with a new one for the same owner and mark the old key as rotated. |
| `POST /api/producer-api-keys/:key_id/revoke` | Mark an active key as revoked so it no longer authenticates. |
| `GET /api/endpoints` | List webhook endpoints without exposing full signing secrets. |
| `POST /api/endpoints` | Authenticate a producer key, then create a webhook target, signing secret, owner id, and endpoint rate-limit policy. |
| `GET /api/events` | List accepted producer events. |
| `POST /api/events` | Authenticate the producer key, require owner match, check the endpoint rate limit, accept one event per endpoint/idempotency key, and create the first delivery attempt. |
| `GET /api/deliveries` | Search paginated delivery attempts by status, failure class, endpoint, event id, text query, cursor, and limit. |
| `GET /api/deliveries/export` | Export a bounded owner-scoped CSV snapshot of newest matching delivery attempts. |
| `GET /api/delivery-views` | List owner-scoped saved delivery search presets for the active operator/admin key. |
| `POST /api/delivery-views` | Validate and save delivery search filters, excluding pagination cursors. |
| `DELETE /api/delivery-views/:view_id` | Delete one owner-scoped saved delivery view. |
| `POST /api/deliveries/:delivery_id/replay` | Require an owner-scoped operator/admin key plus replay intent, create a new queued attempt for an existing event, and enqueue it when BullMQ is configured. |

## Idempotency

Producer retries are keyed by `(endpoint_id, idempotency_key)`. PostgreSQL enforces that pair with a unique constraint, and in-memory mode mirrors the same rule with a map.

Duplicate ingestion returns the existing event and its delivery attempts. It does not create another attempt.

## Producer Authentication And Ownership

Producer API keys are scoped by `owner_id`. Endpoints store the owner that created them, and event ingestion requires the producer key owner to match the endpoint owner before rate limiting or insertion runs. The API accepts either:

```text
Authorization: Bearer <api_key>
X-HookRelay-API-Key: <api_key>
```

The implementation stores only SHA-256 key hashes plus key previews. Each key has a minimal role:

```text
producer: endpoint creation and event ingestion
operator: manual replay
admin: producer and operator actions
```

The full key is returned once from creation or rotation responses. Rotation changes the old key status to `rotated`, creates a replacement key for the same `owner_id` and role, and links the replacement through `rotated_from_key_id`. Revocation changes an active key status to `revoked`. Authentication only accepts `active` keys, so rotated, revoked, and disabled keys stop at the auth boundary before endpoint creation, ownership checks, rate limiting, or event insertion.

The key creation, rotation, and revocation endpoints are local bootstrap/admin endpoints for this portfolio slice. Full tenant users, team membership, approval workflows, audit actors, and scoped permissions remain deferred.

## Endpoint Rate Limits

Each endpoint has a fixed-window event ingestion limit. The default is `60` events per `60` seconds, configurable through `ENDPOINT_RATE_LIMIT_PER_MINUTE` and `ENDPOINT_RATE_LIMIT_WINDOW_SECONDS`, and endpoint creation can override both values.

The API checks the endpoint limit before inserting a new event. In memory mode, the limiter uses process-local counters for quick checks. When `REDIS_URL` is configured, the limiter uses Redis `INCR` plus expiry keys, which lets multiple API processes share the same endpoint window. Exceeded limits return `429` with `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`.

## Signing And Receiver Verification

Each delivery signs:

```text
<HookRelay-Timestamp>.<raw JSON event payload>
```

The receiver verification example exposes the required headers, a sample payload, a sample secret, and the HMAC expression. A five-minute timestamp tolerance is documented as the first replay-protection window before real receiver SDKs or middleware exist. Alert notification receivers get the same explicit freshness window through `/api/alert-receiver-verification-example`, but with `HookRelay-Alert-Timestamp`, `HookRelay-Alert-Signature`, and the route alert notification secret instead of endpoint delivery credentials.

## Retry And Replay

Automatic retries follow the first fixed ladder with bounded per-attempt jitter:

```text
10 seconds, 30 seconds, 2 minutes, 5 minutes, 15 minutes
```

The default jitter ratio is 20%, configurable through `DELIVERY_RETRY_JITTER_RATIO`. Each delivery attempt stores `base_delay_seconds`, `jitter_seconds`, and `scheduled_delay_seconds` so operators can explain why a queued retry moved away from the nominal ladder.

`delivery_attempts` is append-friendly. Automatic retries and manual replays create new attempts rather than overwriting the original attempt. Final failures are marked `dead_letter` on the attempt, which keeps the first dead-letter model simple.

Manual replay requires an active `operator` or `admin` API key whose `owner_id` matches the delivery endpoint owner. Replay attempts store `replay_reason` and `replay_requested_by`. That gives the operator action an audit trail before HookRelay has tenant users, approval policies, or signed user identities.

## Receiver Failure Classification

Failed worker attempts store a `failure_class` on the delivery attempt before retry scheduling or dead-letter promotion. The first taxonomy is intentionally small:

```text
receiver_http_4xx
receiver_http_5xx
receiver_http_other
receiver_timeout
receiver_network
internal_error
```

The class is derived from the receiver HTTP status when one exists, otherwise from fetch/abort error signals. Operators still get the raw `error` message, but `failure_class` gives dashboards and interview explanations a stable grouping for "bad request to receiver", "receiver outage", "network path broke", and "worker/internal issue".

The dashboard searches the delivery log through `GET /api/deliveries` query parameters. It can filter by `status`, `failure_class`, `endpoint_id`, `event_id`, a small text query `q`, `cursor`, and `limit`. The special `failure_class=none` value finds queued, succeeded, or not-yet-run attempts without a failure class. This keeps the operator workflow server-owned while still avoiding a broader saved-view or analytics model.

Pagination uses an opaque base64url cursor over `(created_at, delivery_id)` and sorts by `created_at desc, delivery_id desc`. That tie-breaker makes the next page stable as new delivery attempts are appended. PostgreSQL durable mode keeps supporting indexes for endpoint and failure-class delivery searches using the same sort pair. The free-text `q` search remains a small `ILIKE` over delivery identifiers and diagnostic fields; full-text search is deferred until long-retention delivery history exists.

Saved delivery views are an operator/admin convenience on top of the same delivery search contract. `GET/POST/DELETE /api/delivery-views` require an active API key with the `operator` or `admin` role, and every view is scoped to that key's `owner_id`. The stored JSON is deliberately limited to validated search filters: `status`, `failure_class`, `endpoint_id`, `event_id`, `q`, and `limit`. Pagination cursors are request-specific and are not saved, so applying a view always starts from the newest matching delivery attempts.

Delivery export uses the same search filters but returns a synchronous `text/csv` snapshot from `GET /api/deliveries/export`. Exports require an active `operator` or `admin` key and join delivery attempts back to endpoint ownership, so the exported rows are limited to the key's `owner_id`. The first export path is capped at 1000 newest matching rows and ignores cursors; scheduled/background export jobs are deferred until delivery history has real retention and file lifecycle requirements.

Receiver failure alert routing stays local for this slice. Operators/admins define owner-scoped routes through `/api/alert-routes`, matching on `failed` or `dead_letter` status plus an optional `failure_class`. A route can set `suppression_window_seconds`; after it emits an alert, repeated matches are skipped until `last_alert_at` plus that window. Each route stores a generated or operator-supplied alert notification signing secret, and each emitted alert snapshots that secret so manual notification retry keeps the original verification contract. When the worker records a failed or dead-letter attempt outside any active suppression window, it asks storage to create local alert records for matching enabled routes. Webhook alert targets are then dispatched best-effort from the worker with `HookRelay-Alert-Timestamp` and `HookRelay-Alert-Signature` HMAC headers, and the alert record stores notification status, retry, signing-secret preview, and acknowledgement fields. Operators/admins can retry pending/failed webhook notifications through `POST /api/failure-alerts/:alert_id/retry-notification` without creating another alert record, and they acknowledge records through `POST /api/failure-alerts/:alert_id/acknowledge`. This proves where alert policy, external notification delivery, retry evidence, notification verification, and operator audit attach to the delivery lifecycle without introducing automatic notification jobs, email credentials, escalation schedules, or tenant team preferences too early.

## Observability

HookRelay records a small span envelope for the operations that explain delivery lifecycle behavior:

```text
hookrelay.event.ingest
hookrelay.delivery.enqueue
hookrelay.delivery.replay
hookrelay.delivery.process
hookrelay.delivery.http_request
```

Each span has `trace_id`, `span_id`, optional parent span, delivery/event/endpoint identifiers, timing, status, error, and JSON attributes. The envelope is intentionally close to OpenTelemetry concepts, but the first implementation remains local so the portfolio slice can prove where instrumentation belongs before choosing an exporter, collector, sampling policy, and retention store.

## Deferred Work

- Full tenant user accounts and RBAC.
- Signed user identity on replay audit records.
- Approval-backed producer key lifecycle audit.
- Tenant-specific retry overrides and multi-dimensional producer quotas.
- Receiver SDKs.
- Receiver-specific failure dashboards, shared/team delivery views, automatic notification workers, email alert integrations, scheduled exports, and escalation policies.
- OpenTelemetry exporters, trace sampling, and long-retention latency dashboards.
