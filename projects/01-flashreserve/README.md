# FlashReserve

FlashReserve is a high-concurrency flash sale application where users reserve limited inventory, complete checkout within a short window, and receive live stock updates.

The project focuses on consistency under contention: preventing overselling, expiring abandoned reservations, and keeping the user interface accurate enough without pretending every screen needs strict realtime consensus.

## Problem

Flash sale systems fail when many users attempt to buy limited stock at the same time. A naive checkout flow can oversell inventory, create duplicate orders, or leave stock locked forever when users abandon checkout.

FlashReserve solves this by separating short-lived reservations from finalized orders.

## Target Users

- Customers trying to buy limited-stock products.
- Operators running product drops.
- Interviewers evaluating backend, full-stack, and system design depth.

## Core Features

- Product drop page with live stock display.
- Reservation API with checkout timer.
- Reservation expiration worker.
- Order confirmation flow.
- Admin view for inventory and reservations.
- Tests for concurrent reservation attempts.

## Initial Product Flows

The first FlashReserve slice intentionally focuses on one product reservation flow instead of a full shopping cart.

1. A shopper opens a live drop page and sees current stock plus the product's drop window.
2. The shopper requests a reservation for one product and quantity.
3. The backend atomically holds stock, returns a reservation ID, and starts a short checkout timer.
4. The shopper either confirms checkout before the timer ends or loses the hold when the reservation expires.
5. An operator can inspect product inventory and reservation state, but the initial scope does not include multi-product carts, discounting, or complex backoffice workflows.

Why this scope:

- Flash-sale contention is concentrated on one hot product at a time, so a cart would add coordination complexity before it adds useful architecture signal.
- The schema and Redis strategy already support one reservation per user and product, which keeps the first API slice small and defensible.
- Orders still keep an `order_items` table so the model can grow later without rewriting the durable order shape.

## Proposed Tech Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | Next.js | Strong full-stack ergonomics, routing, server rendering, and easy deployment later. |
| Backend | NestJS | Clear module boundaries, dependency injection, WebSocket support, and good fit for interview-friendly architecture. |
| Database | PostgreSQL | Transactional source of truth for products, orders, reservations, and auditability. |
| Cache/Coordination | Redis | Fast atomic reservation counters and expiry handling. |
| Queue/Worker | BullMQ | Redis-backed background jobs for expiry and order finalization without adding a separate broker. |
| ORM | Prisma | Fast schema iteration, typed queries, and readable data model. |
| Local Infra | Docker Compose | Enough reproducibility without Kubernetes-level overhead. |

## Local Development Infra

FlashReserve now includes a minimal local infra stack at `projects/01-flashreserve/compose.yaml`.

Included services:
- PostgreSQL 17 for durable records.
- Redis 7 with append-only persistence for reservation counters, queues, and expiry coordination.

Why this shape:
- It matches the documented architecture without forcing app scaffolding before the domain model exists.
- It keeps state local to the project with bind mounts under `projects/01-flashreserve/.data/`, which keeps heavy Docker-backed files on `K:\AutoPilot_Projects\FlashReserve`.
- It is easy to tear down and rebuild during rapid schema changes early in the lab.

Quick start:

```powershell
Copy-Item projects/01-flashreserve/.env.example projects/01-flashreserve/.env
docker compose -f projects/01-flashreserve/compose.yaml up -d
docker compose -f projects/01-flashreserve/compose.yaml ps
```

Connection defaults:
- PostgreSQL: `postgresql://flashreserve:flashreserve@localhost:5432/flashreserve`
- Redis: `redis://localhost:6379`

## Initial Database Schema

The first durable schema lives at `projects/01-flashreserve/db/schema.sql`.

It defines:
- `users` for authenticated buyers and admin operators.
- `products` for drop metadata and pricing.
- `inventory` for per-product stock totals plus reserved and sold counters.
- `reservations` for short-lived checkout holds.
- `orders` and `order_items` for confirmed purchases.

Why this shape:
- Inventory stays as one aggregate row per product so the reservation path can reconcile `total`, `reserved`, and `sold` counts quickly.
- Orders stay linked to reservations so duplicate confirmation attempts can return the same durable order instead of creating a second purchase.
- The schema stays SQL-first for now, which keeps the core model reviewable before the NestJS and Prisma scaffolds exist.

Apply it against the local PostgreSQL container:

```powershell
docker compose -f projects/01-flashreserve/compose.yaml up -d
Get-Content projects/01-flashreserve/db/schema.sql | `
  docker compose -f projects/01-flashreserve/compose.yaml exec -T postgres `
  psql -U flashreserve -d flashreserve -v ON_ERROR_STOP=1
```

## Core Entities

| Entity | Responsibility In The First Slice |
| --- | --- |
| `users` | Own reservations and confirmed orders. |
| `products` | Define the sellable drop item, price, and drop window. |
| `inventory` | Hold the durable aggregate counts for total, reserved, and sold stock per product. |
| `reservations` | Represent a time-boxed hold for exactly one product and quantity. |
| `orders` | Represent the durable checkout result for exactly one reservation. |
| `order_items` | Lock in the purchased quantity and unit price, while leaving room for future multi-line orders. |

Stateful entities and their main transitions:

- `products`: `draft -> scheduled -> live -> sold_out/closed`
- `reservations`: `pending -> confirmed/expired/cancelled`
- `orders`: `pending_payment -> confirmed/cancelled`

## App Scaffold

FlashReserve now has a minimal npm workspace scaffold at `projects/01-flashreserve`.

```text
projects/01-flashreserve/
  apps/
    api/  # NestJS modular monolith backend
    web/  # Next.js frontend shell
  scripts/
    check-workspace.mjs
```

Why this shape:
- It keeps the frontend and backend separate enough for realistic full-stack work.
- It avoids a premature microservice layout while still giving the backend clear module boundaries.
- It gives the next reservation API task a stable home under `apps/api/src/reservations`.
- It does not install dependencies yet, so the scaffold stays lightweight and avoids unnecessary disk use before the first executable slice.

Validate the scaffold:

```powershell
cd projects/01-flashreserve
node scripts/check-workspace.mjs
```

## Reservation Creation API

The first executable backend slice is `POST /api/reservations`.

Request shape:

```json
{
  "userId": "00000000-0000-4000-8000-000000000001",
  "productId": "00000000-0000-4000-8000-000000000002",
  "quantity": 1
}
```

Behavior:

- Validates UUIDs and a positive integer quantity at the controller boundary.
- Requires the product to exist, be `live`, and be inside its drop window.
- Uses the warmed Redis key `flashreserve:stock:{productId}` as the atomic reservation counter.
- Inserts the pending PostgreSQL reservation and increments durable `inventory.reserved_quantity`.
- Stores `flashreserve:reservation:{reservationId}` metadata with a checkout-window TTL.
- Enqueues one BullMQ `reservation-expiry` delayed job using the reservation ID as the job ID.
- Restores Redis stock if the durable reservation write fails.
- Cancels the durable reservation, restores inventory, deletes Redis metadata, and restores Redis stock if expiry scheduling fails.

Configuration:

```text
DATABASE_URL=postgresql://flashreserve:flashreserve@localhost:5432/flashreserve
REDIS_URL=redis://localhost:6379
RESERVATION_CHECKOUT_WINDOW_MS=300000
RESERVATION_EXPIRY_WORKER_CONCURRENCY=5
RESERVATION_REDIS_RELEASE_MARKER_TTL_MS=86400000
```

The API intentionally fails closed when the Redis stock counter is missing. Stock warmup remains a separate task so the creation endpoint does not guess from stale in-process state during a flash sale.

## Reservation Expiry Worker

The first worker slice consumes BullMQ `expire-reservation` jobs from the `reservation-expiry` queue.

Behavior:

- Ignores reservations that are missing, not due yet, confirmed, or cancelled.
- Marks due pending reservations as `expired` in PostgreSQL and decrements `inventory.reserved_quantity` in the same transaction.
- Releases the Redis stock counter with a Lua script after the durable expiry succeeds.
- Uses `flashreserve:reservation-release:{reservationId}` as a short-lived idempotency marker so BullMQ retries do not restore the same stock twice.
- Also attempts the Redis release for reservations already marked `expired`, which lets a retry recover if PostgreSQL committed but Redis was temporarily unavailable.

The worker runs in the NestJS API process for the first portfolio slice. That keeps local development simple while preserving a clean `workers` module boundary that can become a separate process later.

## Concurrency Test

The first race-condition test is a Node integration test for `POST /api/reservations`.

Run it from the FlashReserve project root:

```powershell
npm run test:reservations:concurrency
```

The test:
- Builds the NestJS API.
- Uses the documented PostgreSQL and Redis URLs.
- Applies `db/schema.sql`.
- Seeds one live product with three available units and ten unique buyers.
- Boots the real API process.
- Sends ten concurrent reservation requests.
- Asserts that exactly three requests succeed, seven receive stock conflicts, PostgreSQL records only three pending reservations, durable reserved inventory equals three, and the Redis stock counter reaches zero.

If PostgreSQL or Redis are not running locally, the test skips by default so lightweight scaffold checks can still pass. Set `FLASHRESERVE_REQUIRE_INTEGRATION=1` when CI or a local run should fail instead of skip.

## Why This Architecture

The first version should be a modular monolith plus worker, not microservices.

That gives us clear boundaries without adding distributed-system overhead too early. Inventory, reservation, order, and notification modules can be separated in code, while still sharing one deployable backend during the portfolio build.

Redis is used for fast reservation coordination, but PostgreSQL remains the durable source of truth. This avoids treating cache data as the only record of business state.

## Redis Reservation Strategy

The first Redis design stays intentionally small:

- One counter key per product for fast reservable stock checks.
- One short-lived reservation key per reservation ID for quick lookup and expiry correlation.
- One BullMQ delayed job per reservation for expiration handling.

Planned key shape:

```text
flashreserve:stock:{productId} -> integer available quantity
flashreserve:reservation:{reservationId} -> hash(productId, userId, quantity, expiresAt)
bull:reservation-expiry -> BullMQ delayed jobs keyed by reservationId
```

Why this shape:

- The product counter is the hot path during a drop, so it stays as a single integer instead of a larger document.
- Reservation metadata is kept separately with a TTL so the worker can correlate Redis state to the durable PostgreSQL row without scanning all reservations.
- BullMQ remains the only scheduler for expirations, which avoids maintaining a second custom expiry queue in Redis.

Reservation write path:

1. The API reads product/drop eligibility from PostgreSQL.
2. A Redis Lua script checks whether `flashreserve:stock:{productId}` has enough units and decrements it atomically.
3. The API writes the pending reservation row to PostgreSQL.
4. The API stores the short-lived Redis reservation hash and enqueues the BullMQ expiry job.
5. If the PostgreSQL write fails after the Redis decrement, the API immediately runs the matching Redis release script to restore the stock counter.

Operational rules:

- Redis is warmed from PostgreSQL when a product drop opens or when the reservation service starts.
- If the Redis stock key is missing unexpectedly during a drop, the API fails closed rather than guessing from stale in-process memory.
- Confirmation does not increase the Redis stock counter because the stock was already removed from the available pool at reservation time.
- Expiry is the inverse path: mark the PostgreSQL reservation expired, release durable reserved inventory, then increment the Redis stock counter once.
- The expiry worker keeps a Redis release marker per reservation so delayed job retries are safe after partial failures.
- The first version keeps each reservation tied to one product so the reserve, confirm, and expire paths do not need cart-wide distributed coordination.

## Rejected Alternatives

| Alternative | Why Not |
| --- | --- |
| Pure PostgreSQL row locking for every reservation | Correct, but can become a bottleneck under burst traffic and is less interesting for live flash-sale behavior. |
| Redis lists with one token per stock unit | Makes exact unit accounting easy, but wastes memory and complicates multi-quantity reservations for the first slice. |
| Redlock or a global mutex around reservations | Adds distributed lock lifecycle problems when a per-product atomic counter is enough for the initial contention model. |
| A custom Redis sorted-set expiry scheduler | Duplicates BullMQ's delayed-job responsibility without enough benefit in the first version. |
| Full microservices from day one | Adds network complexity, service discovery, and distributed transactions before the project needs them. |
| Kafka for all events | Powerful, but too heavy for this project. BullMQ is enough for expiry and async processing. |
| Client-only stock checks | Easy to build, but unsafe. The server must own inventory decisions. |

## Failure Modes

- Redis unavailable: reservation creation should fail closed instead of overselling.
- Redis/PostgreSQL write split fails mid-request: the API needs a compensating Redis release so available stock is not stranded.
- Worker unavailable: reservations may expire late, so confirmation must still verify reservation validity.
- User refreshes checkout page: reservation should be recoverable by reservation ID and user session.
- Duplicate confirm request: order creation must be idempotent.

## Scaling Notes

The first bottleneck is reservation contention on popular products. We can evolve by using Redis atomic scripts, per-product sharding, waiting rooms, and stricter rate limits.

The second bottleneck is live update fanout. We can evolve WebSocket broadcasting through Redis pub/sub or a dedicated realtime gateway.

## Interview Talking Points

- Why reservations are separate from orders.
- How Redis and PostgreSQL responsibilities are divided.
- Why idempotency matters in checkout.
- How expiry workers fail and how the API compensates.
- Why this starts as a modular monolith.

## What Is Intentionally Not Included

- Real payment integration.
- Kubernetes.
- Multi-region inventory.
- Complex recommendation systems.
- Marketplace seller workflows.
