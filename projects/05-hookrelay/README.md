# HookRelay

HookRelay is a webhook delivery platform for developers. Users create endpoints, send events, verify signatures, retry failures, inspect delivery logs, and replay dead-lettered events.

## Current Slice

The current implementation keeps the local in-memory scaffold as the dependency-light default and adds the first durable boundary for PostgreSQL-backed state plus BullMQ delivery jobs when infrastructure URLs are configured.

Added:

- `services/api` Fastify API for endpoint creation, event ingestion, delivery attempt records, signature previews, and replay enqueueing.
- `apps/web` Next.js dashboard for creating endpoints, submitting events, searching paginated delivery attempts by server-side filters, saving operator delivery views, replaying attempts, and viewing the delivery contract.
- `db/schema.sql` for durable endpoints, events, idempotency keys, and delivery attempts.
- `compose.yaml` with PostgreSQL, Redis, API, and worker services. Local data is bind-mounted under `projects/05-hookrelay/.data/`.
- `services/api/src/worker.js` as the BullMQ worker boundary for outbound HTTP delivery attempts, retry creation, and dead-letter promotion.
- `DELIVERY_CONTRACT.md` for idempotency, HMAC headers, receiver verification, retry, replay authorization, and audit rules.
- `services/api/src/retry-policy.js` for bounded retry jitter shared by the API, worker, and dashboard contract.
- `services/api/src/observability.js` for bounded local delivery spans, with PostgreSQL span persistence when `DATABASE_URL` is configured.
- `services/api/src/rate-limiter.js` for endpoint-scoped fixed-window event ingestion limits, backed by Redis when `REDIS_URL` is configured.
- `services/api/src/producer-auth.js` for API-key hashing, previews, roles, lifecycle statuses, and bearer/header extraction.
- `services/api/src/receiver-failure.js` for classifying receiver HTTP, timeout, network, and internal delivery failures.
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
| `GET /api/receiver-verification-example` | Show a receiver-side HMAC verification example with sample payload and headers. |
| `GET /api/observability/spans` | List recent event ingestion, enqueue, replay, worker, and outbound HTTP spans. |
| `GET /api/producer-api-keys` | List producer API key previews and owners. |
| `POST /api/producer-api-keys` | Create a local producer/operator/admin API key and return the full secret once. |
| `POST /api/producer-api-keys/:key_id/rotate` | Mark an active key as rotated and return one replacement secret for the same owner. |
| `POST /api/producer-api-keys/:key_id/revoke` | Revoke an active producer key so it can no longer create endpoints or ingest events. |
| `GET /api/endpoints` | List webhook endpoints. |
| `POST /api/endpoints` | Create an owner-scoped webhook endpoint with a signing secret and rate limit policy. |
| `GET /api/events` | List accepted producer events. |
| `POST /api/events` | Authenticate the producer API key, enforce endpoint ownership and rate limit, accept one event per endpoint/idempotency key, and queue a delivery attempt. |
| `GET /api/deliveries` | Search paginated delivery attempts by status, failure class, endpoint, event id, text query, cursor, and limit while returning signature previews, response status, and replay audit fields. |
| `GET /api/delivery-views` | List owner-scoped saved delivery search views for the active operator/admin API key. |
| `POST /api/delivery-views` | Save validated delivery search filters, excluding cursors, as an owner-scoped operator/admin view. |
| `DELETE /api/delivery-views/:view_id` | Delete one owner-scoped saved delivery view. |
| `POST /api/deliveries/:delivery_id/replay` | Require an owner-scoped operator/admin key and replay reason, then create a new queued attempt for an existing event. |

When `DATABASE_URL` is set, producer API key hashes, endpoints, events, delivery attempts, receiver failure classes, saved delivery views, and observability spans are stored in PostgreSQL. When `REDIS_URL` is set, new delivery attempts are also enqueued into BullMQ with the documented delay ladder plus bounded jitter, and endpoint rate limits use Redis fixed-window counters. Without those variables, the API still runs in in-memory mode for fast local checks.

## Why This Project Matters

This is a strong backend/system design project because it focuses on real production concerns: unreliable networks, retries, duplicate delivery, signatures, replay, and observability.

## What Is Intentionally Deferred

- Full tenant user accounts, team membership, scoped permissions, and approval-backed key lifecycle workflows.
- Tenant-specific retry overrides and multi-dimensional producer quotas.
- Shared/team delivery views, export workflows, and long-retention delivery analytics.
- OpenTelemetry exporters, trace sampling, and long-retention latency dashboards.
