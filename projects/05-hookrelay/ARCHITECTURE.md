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
| Fastify API | API-key bootstrap, endpoint setup, event ingestion, idempotency handling, role-gated replay enqueueing, and contract discovery. |
| Next.js web app | Developer/operator console for creating endpoints, submitting events, filtering delivery failures, replaying deliveries, and inspecting signatures. |
| PostgreSQL | Optional durable owner for endpoints, events, idempotency uniqueness, delivery attempt state, replay audit fields, and dead-letter status. |
| BullMQ / Redis | Optional durable queue, jittered delayed retry scheduler, and endpoint rate-limit counter owner. |
| Worker process | Sends signed outbound HTTP requests, classifies receiver failures, records responses, schedules retries, and marks dead-letter failures. |
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
| `GET /api/observability/spans` | Return recent provider-neutral spans with trace ids, span ids, timing, status, and delivery attributes. |
| `GET /api/producer-api-keys` | List producer key previews, owners, and status without exposing full secrets. |
| `POST /api/producer-api-keys` | Create a local producer/operator/admin key and return the full secret once for development bootstrap. |
| `POST /api/producer-api-keys/:key_id/rotate` | Replace an active key with a new one for the same owner and mark the old key as rotated. |
| `POST /api/producer-api-keys/:key_id/revoke` | Mark an active key as revoked so it no longer authenticates. |
| `GET /api/endpoints` | List webhook endpoints without exposing full signing secrets. |
| `POST /api/endpoints` | Authenticate a producer key, then create a webhook target, signing secret, owner id, and endpoint rate-limit policy. |
| `GET /api/events` | List accepted producer events. |
| `POST /api/events` | Authenticate the producer key, require owner match, check the endpoint rate limit, accept one event per endpoint/idempotency key, and create the first delivery attempt. |
| `GET /api/deliveries` | List delivery attempts, statuses, replay audit fields, receiver failure classes, and signature previews. |
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

The receiver verification example exposes the required headers, a sample payload, a sample secret, and the HMAC expression. A five-minute timestamp tolerance is documented as the first replay-protection window before real receiver SDKs or middleware exist.

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

The dashboard filters the delivery log by `failure_class` using the contract-published class list plus any observed classes. The filter stays client-side for this slice because `/api/deliveries` already returns the bounded local delivery list; server-side filtering can be added when pagination or long-retention delivery search exists.

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
- Server-side delivery search, receiver-specific failure dashboards, and alert routing.
- OpenTelemetry exporters, trace sampling, and long-retention latency dashboards.
