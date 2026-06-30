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

## Why This Architecture

The first version should be a modular monolith plus worker, not microservices.

That gives us clear boundaries without adding distributed-system overhead too early. Inventory, reservation, order, and notification modules can be separated in code, while still sharing one deployable backend during the portfolio build.

Redis is used for fast reservation coordination, but PostgreSQL remains the durable source of truth. This avoids treating cache data as the only record of business state.

## Rejected Alternatives

| Alternative | Why Not |
| --- | --- |
| Pure PostgreSQL row locking for every reservation | Correct, but can become a bottleneck under burst traffic and is less interesting for live flash-sale behavior. |
| Full microservices from day one | Adds network complexity, service discovery, and distributed transactions before the project needs them. |
| Kafka for all events | Powerful, but too heavy for this project. BullMQ is enough for expiry and async processing. |
| Client-only stock checks | Easy to build, but unsafe. The server must own inventory decisions. |

## Failure Modes

- Redis unavailable: reservation creation should fail closed instead of overselling.
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
