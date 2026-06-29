# FlashReserve Architecture

## System Overview

FlashReserve uses a modular monolith backend, a Next.js frontend, PostgreSQL for durable records, Redis for fast reservation coordination, and BullMQ workers for asynchronous expiration and finalization jobs.

```text
Browser
  |
  | HTTP / WebSocket
  v
Next.js frontend
  |
  | HTTP API
  v
NestJS backend
  |        |
  |        +--> Redis: reservation counters, locks, queues
  |        |
  |        +--> PostgreSQL: users, products, reservations, orders
  |
  +--> WebSocket gateway: live stock updates

BullMQ worker
  |
  +--> expires stale reservations
  +--> confirms queued order work
```

## Local Development Topology

The first infrastructure slice uses Docker Compose with two stateful services only:

- PostgreSQL for durable product, reservation, and order records.
- Redis for reservation counters, BullMQ storage, and fast expiry coordination.

Both services use bind mounts under `projects/01-flashreserve/.data/` rather than Docker named volumes. That keeps large local data files inside the project workspace on `K:` and makes cleanup explicit when resetting the lab.

## Core Domain Model

Initial entities:

- User
- Product
- Inventory
- Reservation
- Order
- OrderItem

## Reservation Flow

1. User requests a reservation for a product.
2. Backend validates product and drop status.
3. Redis atomically checks and decrements available reservable stock.
4. Backend writes a reservation record in PostgreSQL.
5. Backend schedules an expiry job.
6. Frontend receives reservation ID and checkout deadline.
7. WebSocket subscribers receive updated stock count.

## Confirmation Flow

1. User confirms checkout before expiry.
2. Backend verifies reservation ownership and status.
3. Backend creates order idempotently.
4. Reservation is marked confirmed.
5. Inventory is finalized in PostgreSQL.
6. Duplicate confirmation attempts return the existing order.

## Expiry Flow

1. BullMQ expiry job runs after the reservation window.
2. Worker checks whether the reservation is still pending.
3. If pending, it marks it expired in PostgreSQL.
4. Redis reservable stock is restored.
5. WebSocket subscribers receive updated stock.

## Consistency Strategy

Redis handles fast burst protection. PostgreSQL handles durable truth.

The API must not assume that Redis alone is enough. Every order confirmation checks PostgreSQL reservation state. Expiry jobs are allowed to run late, so confirmation also checks deadline timestamps.

## Modules

Recommended backend modules:

- `products`
- `inventory`
- `reservations`
- `orders`
- `realtime`
- `workers`

## Local Infra Files

```text
projects/01-flashreserve/
  compose.yaml
  .env.example
  .data/
    postgres/
    redis/
```

## API Sketch

```text
GET    /products
GET    /products/:id
POST   /reservations
GET    /reservations/:id
POST   /orders/confirm
GET    /admin/products/:id/inventory
```

## Realtime Events

```text
stock.updated
reservation.created
reservation.expired
order.confirmed
```
