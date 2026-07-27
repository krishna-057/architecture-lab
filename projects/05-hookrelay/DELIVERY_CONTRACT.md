# HookRelay Delivery Contract

HookRelay defines the HTTP contract for endpoint setup, event ingestion, delivery logging, HMAC signing, replay intent, and the first durable delivery worker boundary.

## Resource Boundaries

| Resource | API path | First-slice storage | Later durable owner |
| --- | --- | --- | --- |
| Endpoint | `/api/endpoints` | In-memory by default, PostgreSQL when configured | PostgreSQL `webhook_endpoints` |
| Endpoint rate limit | `POST /api/events` | In-memory by default, Redis when configured | Redis counters plus tenant quota policy |
| Event | `/api/events` | In-memory by default, PostgreSQL when configured | PostgreSQL `webhook_events` |
| Delivery attempt | `/api/deliveries` | In-memory by default, PostgreSQL plus BullMQ when configured | PostgreSQL `delivery_attempts` plus BullMQ jobs |
| Observability span | `/api/observability/spans` | In-memory by default, PostgreSQL when configured | OpenTelemetry exporter plus query store |
| Contract discovery | `/api/delivery-contract` | Static API response | Versioned API contract |

## Event Ingestion

Producers submit:

```json
{
  "endpoint_id": "endpoint_...",
  "event_type": "invoice.paid",
  "idempotency_key": "producer-event-id",
  "payload": {
    "invoice_id": "inv_123"
  }
}
```

The API accepts one event per `(endpoint_id, idempotency_key)` pair. Duplicate submissions return the existing event and do not enqueue a second delivery attempt.

## Endpoint Rate Limits

Each endpoint has a fixed-window ingestion policy:

```json
{
  "rate_limit_per_minute": 60,
  "rate_limit_window_seconds": 60
}
```

The default policy is configured with `ENDPOINT_RATE_LIMIT_PER_MINUTE` and `ENDPOINT_RATE_LIMIT_WINDOW_SECONDS`. `POST /api/endpoints` can override those values for a specific endpoint.

`POST /api/events` checks the endpoint window before accepting an event. Accepted requests include:

```text
X-RateLimit-Limit
X-RateLimit-Remaining
X-RateLimit-Reset
```

When the endpoint is over limit, the API returns:

```text
HTTP 429
Retry-After: <seconds until reset>
```

The response body includes `endpoint_id`, `limit`, `window_seconds`, `retry_after_seconds`, and `reset_at`. In memory mode, counters are process-local. When `REDIS_URL` is configured, counters use Redis fixed-window keys so multiple API processes share the same limit.

## Signature Headers

Each delivery attempt carries a signature preview using the endpoint secret:

```text
HookRelay-Timestamp: unix timestamp seconds
HookRelay-Signature: v1=<hex hmac sha256>
HookRelay-Event-Id: event id
HookRelay-Delivery-Id: delivery attempt id
```

The signed payload is:

```text
<timestamp>.<raw JSON event payload>
```

This keeps replay protection and payload verification explicit before the worker begins sending real HTTP requests.

## Receiver Verification

Receivers verify the webhook by rebuilding the signed payload from the exact raw request body:

```text
<HookRelay-Timestamp>.<raw JSON request body>
```

They then compute `HMAC-SHA256` with the endpoint signing secret and compare it to `HookRelay-Signature`. The first receiver example uses a five-minute timestamp tolerance so old captured requests can be rejected once real receivers are wired.

The API exposes a runnable example contract at:

```text
GET /api/receiver-verification-example
```

The example includes the required headers, a sample payload, a sample secret, and the Node.js digest expression a receiver would use.

## Retry Policy

The scaffold exposes the intended retry ladder:

```text
10 seconds, 30 seconds, 2 minutes, 5 minutes, 15 minutes
```

## Retry Jitter

Each retry receives bounded symmetric Jitter around its base delay. The default jitter ratio is `0.2`, so a 30 second base delay may schedule between 24 and 36 seconds. Set `DELIVERY_RETRY_JITTER_RATIO` to tune that spread in local durable mode.

Delivery attempts expose the computed schedule:

```text
base_delay_seconds
jitter_seconds
scheduled_delay_seconds
next_attempt_at
```

The API stores queued delivery records. When Redis is configured, it also creates delayed BullMQ jobs from `next_attempt_at`. The worker sends the signed event payload to the endpoint URL, records success or failure, creates the next retry attempt with a fresh jittered schedule, and promotes the final failed attempt to `dead_letter`.

## Replay Rule

Manual replay creates a new queued delivery attempt for an existing event. The event payload and idempotency key remain unchanged; the replay attempt receives a new delivery id, timestamp, and signature.

## Replay Authorization

Manual replay is an operator action, not an automatic retry. The replay endpoint requires a human-readable `reason` in the request body before it queues a new delivery attempt:

```json
{
  "reason": "Operator requested replay after receiver recovery",
  "requested_by": "local-dashboard"
}
```

The reason and requester are stored on the replay delivery attempt as `replay_reason` and `replay_requested_by`. This keeps the first authorization rule simple while preserving the audit trail needed before adding tenant users, roles, or approval workflows.

## Observability

HookRelay exposes recent delivery lifecycle spans at:

```text
GET /api/observability/spans
```

Span records use this provider-neutral envelope:

```json
{
  "span_id": "8-byte hex id",
  "trace_id": "16-byte hex id",
  "parent_span_id": null,
  "name": "hookrelay.delivery.enqueue",
  "delivery_id": "delivery_...",
  "event_id": "event_...",
  "endpoint_id": "endpoint_...",
  "status": "ok",
  "started_at": "2026-07-27T00:00:00.000Z",
  "ended_at": "2026-07-27T00:00:00.003Z",
  "duration_ms": 3,
  "attributes": {
    "queue_mode": "bullmq",
    "scheduled_delay_seconds": 24
  },
  "error": null
}
```

The current traced operations are event ingestion, delivery enqueue, manual replay, worker delivery processing, and outbound receiver HTTP. This is intentionally a local span log first; it keeps the lifecycle visible before introducing OpenTelemetry exporters, sampling, collector deployment, and long-retention query storage.

## Durable Schema Rule

PostgreSQL enforces one accepted event for each `(endpoint_id, idempotency_key)` pair. Delivery attempts remain append-friendly records, so retries and manual replays keep their own delivery ids, timestamps, signatures, and statuses.

When `DATABASE_URL` is set, observability spans can be persisted in `delivery_observability_spans`. Without PostgreSQL, the API keeps a bounded in-process span log controlled by `OBSERVABILITY_SPAN_LOG_LIMIT`.
