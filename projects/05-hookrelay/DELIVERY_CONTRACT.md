# HookRelay Delivery Contract

HookRelay defines the HTTP contract for endpoint setup, event ingestion, delivery logging, HMAC signing, replay intent, and the first durable delivery worker boundary.

## Resource Boundaries

| Resource | API path | First-slice storage | Later durable owner |
| --- | --- | --- | --- |
| Endpoint | `/api/endpoints` | In-memory by default, PostgreSQL when configured | PostgreSQL `webhook_endpoints` |
| Event | `/api/events` | In-memory by default, PostgreSQL when configured | PostgreSQL `webhook_events` |
| Delivery attempt | `/api/deliveries` | In-memory by default, PostgreSQL plus BullMQ when configured | PostgreSQL `delivery_attempts` plus BullMQ jobs |
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

## Retry Policy

The scaffold exposes the intended retry ladder:

```text
10 seconds, 30 seconds, 2 minutes, 5 minutes, 15 minutes
```

The API stores queued delivery records. When Redis is configured, it also creates delayed BullMQ jobs. The worker sends the signed event payload to the endpoint URL, records success or failure, creates the next retry attempt, and promotes the final failed attempt to `dead_letter`.

## Replay Rule

Manual replay creates a new queued delivery attempt for an existing event. The event payload and idempotency key remain unchanged; the replay attempt receives a new delivery id, timestamp, and signature.

## Durable Schema Rule

PostgreSQL enforces one accepted event for each `(endpoint_id, idempotency_key)` pair. Delivery attempts remain append-friendly records, so retries and manual replays keep their own delivery ids, timestamps, signatures, and statuses.
