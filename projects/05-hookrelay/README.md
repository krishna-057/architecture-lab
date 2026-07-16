# HookRelay

HookRelay is a webhook delivery platform for developers. Users create endpoints, send events, verify signatures, retry failures, inspect delivery logs, and replay dead-lettered events.

## Current Slice

The first implementation slice is a local scaffold that proves the HTTP and dashboard boundaries before adding durable storage or a real delivery worker.

Added:

- `services/api` Fastify API for endpoint creation, event ingestion, delivery attempt records, signature previews, and replay enqueueing.
- `apps/web` Next.js dashboard for creating endpoints, submitting events, inspecting queued deliveries, replaying attempts, and viewing the delivery contract.
- `DELIVERY_CONTRACT.md` for the first idempotency, HMAC header, retry, and replay rules.
- `scripts/check-workspace.mjs` for dependency-light validation of the scaffold markers.

Run locally:

```powershell
npm install
npm run dev:api
npm run dev:web
```

Default URLs:

- API: `http://localhost:8400`
- Web: `http://localhost:3400`

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

## First-Slice API

| API | Purpose |
| --- | --- |
| `GET /health` | Local service health and worker mode. |
| `GET /api/delivery-contract` | Discover retry, signature, replay, and idempotency rules. |
| `GET /api/endpoints` | List webhook endpoints. |
| `POST /api/endpoints` | Create a webhook endpoint with a signing secret. |
| `GET /api/events` | List accepted producer events. |
| `POST /api/events` | Accept one event per endpoint/idempotency key and queue a delivery attempt. |
| `GET /api/deliveries` | List queued delivery attempts and signature previews. |
| `POST /api/deliveries/:delivery_id/replay` | Create a new queued attempt for an existing event. |

## Why This Project Matters

This is a strong backend/system design project because it focuses on real production concerns: unreliable networks, retries, duplicate delivery, signatures, replay, and observability.

## What Is Intentionally Deferred

- PostgreSQL persistence for endpoints, events, and delivery attempts.
- BullMQ worker execution, exponential backoff with jitter, and dead-letter promotion.
- Actual outbound HTTP calls to customer webhook endpoints.
- Endpoint authentication and tenant/user ownership.
- OpenTelemetry traces and delivery latency dashboards.
