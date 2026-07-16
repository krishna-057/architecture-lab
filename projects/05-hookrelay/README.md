# HookRelay

HookRelay is a webhook delivery platform for developers. Users create endpoints, send events, verify signatures, retry failures, inspect delivery logs, and replay dead-lettered events.

## Current Slice

The current implementation keeps the local in-memory scaffold as the dependency-light default and adds the first durable boundary for PostgreSQL-backed state plus BullMQ delivery jobs when infrastructure URLs are configured.

Added:

- `services/api` Fastify API for endpoint creation, event ingestion, delivery attempt records, signature previews, and replay enqueueing.
- `apps/web` Next.js dashboard for creating endpoints, submitting events, inspecting queued deliveries, replaying attempts, and viewing the delivery contract.
- `db/schema.sql` for durable endpoints, events, idempotency keys, and delivery attempts.
- `compose.yaml` with PostgreSQL, Redis, API, and worker services. Local data is bind-mounted under `projects/05-hookrelay/.data/`.
- `services/api/src/worker.js` as the BullMQ worker boundary for outbound HTTP delivery attempts, retry creation, and dead-letter promotion.
- `DELIVERY_CONTRACT.md` for the first idempotency, HMAC header, retry, and replay rules.
- `scripts/check-workspace.mjs` for dependency-light validation of the scaffold markers.

Run locally:

```powershell
npm install
npm run dev:api
npm run dev:web
```

Run the durable local stack:

```powershell
docker compose -f projects/05-hookrelay/compose.yaml up --build
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

When `DATABASE_URL` is set, endpoints, events, and delivery attempts are stored in PostgreSQL. When `REDIS_URL` is set, new delivery attempts are also enqueued into BullMQ with the documented delay ladder. Without those variables, the API still runs in in-memory mode for fast local checks.

## Why This Project Matters

This is a strong backend/system design project because it focuses on real production concerns: unreliable networks, retries, duplicate delivery, signatures, replay, and observability.

## What Is Intentionally Deferred

- Tenant/user ownership and endpoint authentication.
- Exponential backoff with jitter beyond the fixed first ladder.
- OpenTelemetry traces and delivery latency dashboards.
