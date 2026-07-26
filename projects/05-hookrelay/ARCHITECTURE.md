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

## Components

| Component | Responsibility |
| --- | --- |
| Fastify API | Endpoint setup, event ingestion, idempotency handling, delivery attempt creation, replay enqueueing, and contract discovery. |
| Next.js web app | Developer/operator console for creating endpoints, submitting events, replaying deliveries, and inspecting signatures. |
| PostgreSQL | Optional durable owner for endpoints, events, idempotency uniqueness, delivery attempt state, replay audit fields, and dead-letter status. |
| BullMQ / Redis | Optional durable queue and jittered delayed retry scheduler for outbound delivery jobs. |
| Worker process | Sends signed outbound HTTP requests, records responses, schedules retries, and marks dead-letter failures. |
| Receiver verification example | Shows receivers how to rebuild `timestamp.rawBody`, compute HMAC-SHA256, and enforce a timestamp tolerance. |
| Replay authorization contract | Requires operator replay reasons before manual replay creates a new delivery attempt. |

## API Boundary

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Report API, storage, queue, and worker mode. |
| `GET /api/delivery-contract` | Discover idempotency, signature, receiver verification, retry, replay authorization, queue, and storage rules. |
| `GET /api/receiver-verification-example` | Return sample receiver verification inputs, required headers, and Node.js digest expression. |
| `GET /api/endpoints` | List webhook endpoints without exposing full signing secrets. |
| `POST /api/endpoints` | Create a webhook target and signing secret. |
| `GET /api/events` | List accepted producer events. |
| `POST /api/events` | Accept one event per endpoint/idempotency key and create the first delivery attempt. |
| `GET /api/deliveries` | List delivery attempts, statuses, replay audit fields, and signature previews. |
| `POST /api/deliveries/:delivery_id/replay` | Require replay intent, create a new queued attempt for an existing event, and enqueue it when BullMQ is configured. |

## Idempotency

Producer retries are keyed by `(endpoint_id, idempotency_key)`. PostgreSQL enforces that pair with a unique constraint, and in-memory mode mirrors the same rule with a map.

Duplicate ingestion returns the existing event and its delivery attempts. It does not create another attempt.

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

## Deferred Work

- Tenant and endpoint ownership.
- Role-based replay authorization.
- Tenant-specific retry overrides and rate limits.
- Receiver SDKs.
- OpenTelemetry traces and latency dashboards.
