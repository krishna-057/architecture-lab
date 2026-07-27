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
| Fastify API | Endpoint setup, event ingestion, idempotency handling, delivery attempt creation, replay enqueueing, and contract discovery. |
| Next.js web app | Developer/operator console for creating endpoints, submitting events, replaying deliveries, and inspecting signatures. |
| PostgreSQL | Optional durable owner for endpoints, events, idempotency uniqueness, delivery attempt state, replay audit fields, and dead-letter status. |
| BullMQ / Redis | Optional durable queue, jittered delayed retry scheduler, and endpoint rate-limit counter owner. |
| Worker process | Sends signed outbound HTTP requests, records responses, schedules retries, and marks dead-letter failures. |
| Observability span log | Captures event ingestion, enqueue, replay, worker processing, and outbound HTTP timing as local JSON spans before adding a vendor exporter. |
| Endpoint rate limiter | Enforces fixed-window event ingestion limits per endpoint before accepting new producer events. |
| Receiver verification example | Shows receivers how to rebuild `timestamp.rawBody`, compute HMAC-SHA256, and enforce a timestamp tolerance. |
| Replay authorization contract | Requires operator replay reasons before manual replay creates a new delivery attempt. |

## API Boundary

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Report API, storage, queue, and worker mode. |
| `GET /api/delivery-contract` | Discover idempotency, signature, receiver verification, retry, replay authorization, queue, and storage rules. |
| `GET /api/receiver-verification-example` | Return sample receiver verification inputs, required headers, and Node.js digest expression. |
| `GET /api/observability/spans` | Return recent provider-neutral spans with trace ids, span ids, timing, status, and delivery attributes. |
| `GET /api/endpoints` | List webhook endpoints without exposing full signing secrets. |
| `POST /api/endpoints` | Create a webhook target, signing secret, and endpoint rate-limit policy. |
| `GET /api/events` | List accepted producer events. |
| `POST /api/events` | Check the endpoint rate limit, accept one event per endpoint/idempotency key, and create the first delivery attempt. |
| `GET /api/deliveries` | List delivery attempts, statuses, replay audit fields, and signature previews. |
| `POST /api/deliveries/:delivery_id/replay` | Require replay intent, create a new queued attempt for an existing event, and enqueue it when BullMQ is configured. |

## Idempotency

Producer retries are keyed by `(endpoint_id, idempotency_key)`. PostgreSQL enforces that pair with a unique constraint, and in-memory mode mirrors the same rule with a map.

Duplicate ingestion returns the existing event and its delivery attempts. It does not create another attempt.

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

Manual replay attempts store `replay_reason` and `replay_requested_by`. That gives the operator action an audit trail before HookRelay has tenant users, roles, or approval policies.

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

- Tenant and endpoint ownership.
- Role-based replay authorization.
- Tenant-specific retry overrides and multi-dimensional producer quotas.
- Receiver SDKs.
- OpenTelemetry exporters, trace sampling, and long-retention latency dashboards.
