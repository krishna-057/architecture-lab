# HookRelay Delivery Contract

HookRelay defines the HTTP contract for endpoint setup, event ingestion, delivery logging, HMAC signing, replay intent, and the first durable delivery worker boundary.

## Resource Boundaries

| Resource | API path | First-slice storage | Later durable owner |
| --- | --- | --- | --- |
| Producer API key | `/api/producer-api-keys` | In-memory by default, PostgreSQL when configured | Tenant identity and secret manager |
| Endpoint | `/api/endpoints` | In-memory by default, PostgreSQL when configured | PostgreSQL `webhook_endpoints` |
| Endpoint rate limit | `POST /api/events` | In-memory by default, Redis when configured | Redis counters plus tenant quota policy |
| Event | `/api/events` | In-memory by default, PostgreSQL when configured | PostgreSQL `webhook_events` |
| Delivery attempt | `/api/deliveries` | In-memory by default, PostgreSQL plus BullMQ when configured | PostgreSQL `delivery_attempts` plus BullMQ jobs |
| Failure classification | `failure_class` on delivery attempts | In-memory by default, PostgreSQL when configured | Delivery analytics and alert policy |
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

The API accepts one event per `(endpoint_id, idempotency_key)` pair after producer authentication and owner matching. Duplicate submissions return the existing event and do not enqueue a second delivery attempt.

## Producer API Key Authentication

Producer requests authenticate with either header:

```text
Authorization: Bearer <api_key>
X-HookRelay-API-Key: <api_key>
```

Endpoint creation and event ingestion require an active API key with the `producer` or `admin` role. `POST /api/endpoints` stores the authenticated key's `owner_id` on the endpoint. `POST /api/events` requires the key owner to match the endpoint owner before rate limiting, idempotency, insertion, or enqueueing.

The local bootstrap endpoint is:

```text
POST /api/producer-api-keys
```

It accepts `owner_id`, `name`, and `role`, stores only a key hash and preview, and returns the full generated API key once. Valid roles are:

```text
producer
operator
admin
```

`GET /api/producer-api-keys` lists key previews, owners, roles, and statuses only.

Active keys can be rotated or revoked through the local admin lifecycle endpoints:

```text
POST /api/producer-api-keys/:key_id/rotate
POST /api/producer-api-keys/:key_id/revoke
```

Rotation marks the old key as `rotated`, creates a replacement key for the same `owner_id` and role, records `rotated_from_key_id` on the replacement, and returns the new full API key once. Revocation marks an active key as `revoked`. Authentication only accepts `active` keys, so `disabled`, `rotated`, and `revoked` keys are rejected before ownership matching, role checks, rate limiting, idempotency insertion, or enqueueing.

Authentication failures:

```text
401 Producer API key is required.
403 Producer API key is invalid or disabled.
403 Producer API key role is not authorized.
403 Producer API key does not own this endpoint.
404 producer API key was not found
409 producer API key is not active
```

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

## Failure Classification

Failed receiver attempts set `failure_class` before retry scheduling or dead-letter promotion. The current classes are:

```text
receiver_http_4xx
receiver_http_5xx
receiver_http_other
receiver_timeout
receiver_network
internal_error
```

HTTP classes are derived from the receiver response status. Timeout and network classes are derived from fetch/abort errors when no response status exists. The raw `error` string remains on the attempt for diagnostics, but `failure_class` is the stable field dashboards and alerts should group by.

Contract discovery exposes this as:

```json
{
  "receiver_failure_classification": {
    "field": "failure_class",
    "classes": ["receiver_http_4xx", "receiver_http_5xx", "receiver_http_other", "receiver_timeout", "receiver_network", "internal_error"],
    "stored_on": "delivery_attempts"
  }
}
```

## Replay Rule

Manual replay creates a new queued delivery attempt for an existing event. The event payload and idempotency key remain unchanged; the replay attempt receives a new delivery id, timestamp, and signature.

## Replay Authorization

Manual replay is an operator action, not an automatic retry. The replay endpoint requires an active API key with the `operator` or `admin` role:

```text
Authorization: Bearer <api_key>
X-HookRelay-API-Key: <api_key>
```

The key's `owner_id` must match the delivery endpoint owner. The request body must also include a human-readable `reason` before it queues a new delivery attempt:

```json
{
  "reason": "Operator requested replay after receiver recovery",
  "requested_by": "local-dashboard"
}
```

Contract discovery exposes replay authorization as:

```json
{
  "mode": "owner_scoped_operator_api_key",
  "required_roles": ["operator", "admin"],
  "owner_rule": "Replay API key owner_id must match the delivery endpoint owner_id."
}
```

The reason and requester are stored on the replay delivery attempt as `replay_reason` and `replay_requested_by`. This keeps the first role boundary simple while preserving the audit trail needed before adding tenant users, signed user identity, or approval workflows.

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
