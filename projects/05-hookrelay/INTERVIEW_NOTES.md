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
