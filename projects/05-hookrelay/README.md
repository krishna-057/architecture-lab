# HookRelay

HookRelay is a webhook delivery platform for developers. Users create endpoints, send events, verify signatures, retry failures, inspect delivery logs, and replay dead-lettered events.

## Architecture Focus

- Network reliability
- Retry and backoff
- Idempotency
- HMAC signatures
- Delivery logs
- Dead-letter queues

## Proposed Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | Next.js | Dashboard and developer experience. |
| Backend | Fastify or NestJS | Fast request handling with clear API design. |
| Database | PostgreSQL | Durable event and delivery history. |
| Queue | BullMQ | Retry scheduling and worker separation. |
| Cache/Rate limit | Redis | Rate limits, queue backend, and temporary state. |
| Observability | OpenTelemetry | Interview-friendly tracing and request lifecycle visibility. |

## Why This Project Matters

This is a strong backend/system design project because it focuses on real production concerns: unreliable networks, retries, duplicate delivery, signatures, replay, and observability.

