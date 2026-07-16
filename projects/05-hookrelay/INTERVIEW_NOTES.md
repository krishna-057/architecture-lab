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

The next architecture step is to move endpoint, event, and delivery attempt state into PostgreSQL and enqueue delivery jobs through BullMQ backed by Redis. At that point, API instances can stay stateless while workers own network retries, backoff, and dead-letter promotion.

Observability should attach one trace across event ingestion, job enqueue, each delivery attempt, and final dead-letter/replay state. That is more useful than only logging HTTP status codes because webhook failures often involve DNS, TLS, timeouts, and receiver-side 5xx responses.
