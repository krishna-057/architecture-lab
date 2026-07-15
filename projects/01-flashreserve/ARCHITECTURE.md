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

The first executable slice uses a single-product checkout model:

- one reservation holds one product and quantity
- one order is created from one reservation
- `order_items` exists now so later expansion to multi-line orders does not require a new durable order table

Initial table responsibilities:
- `users` stores the buyer identity that owns reservations and orders.
- `products` stores the drop window, sellable metadata, and current lifecycle status.
- `inventory` stores one aggregate stock row per product with `total_quantity`, `reserved_quantity`, and `sold_quantity`.
- `reservations` stores the temporary checkout hold and expiry timestamp that the worker enforces.
- `orders` stores the durable purchase created from exactly one reservation.
- `order_items` stores the purchased quantity and locked-in unit price for each confirmed product line.

Core state transitions:

- `products`: `draft -> scheduled -> live -> sold_out/closed`
- `reservations`: `pending -> confirmed/expired/cancelled`
- `orders`: `pending_payment -> confirmed/cancelled`

## First Product Flows

### Shopper Reservation Flow

1. Shopper opens a live product drop page.
2. Frontend loads product details and the currently published stock view.
3. Shopper requests a reservation for one product and quantity.
4. Reservation module decrements Redis stock atomically, then persists the pending reservation.
5. API returns the reservation ID plus checkout expiry timestamp.

### Shopper Confirmation Flow

1. Shopper confirms checkout before the reservation deadline.
2. Backend verifies ownership, pending status, and expiry.
3. Order is created idempotently from that reservation.
4. Durable inventory moves from reserved to sold.

### Reservation Expiry Flow

1. The BullMQ delayed job wakes up after the checkout window.
2. The worker expires only still-pending reservations.
3. Durable reserved inventory is decremented in the same PostgreSQL transaction.
4. Redis stock is restored for that same product counter through an idempotent release script.
5. Realtime stock subscribers receive the updated stock event.

### Operator Monitoring Flow

1. Operators inspect product state, aggregate inventory, and reservation volume.
2. The first slice treats operator actions as read-heavy diagnostics, not a full admin inventory editor.

Implemented API slice:

- `GET /api/admin/products/:productId/inventory` returns product drop metadata, durable inventory counters, reservation status counts, and the 10 most recent reservations for one product.
- Available stock is derived from PostgreSQL as `total_quantity - reserved_quantity - sold_quantity`, which gives operators the durable view rather than the Redis hot-counter view.
- A missing inventory row is returned as `inventory: null` for an existing product so setup gaps are explicit during local development.
- The endpoint does not add admin authentication yet because the current schema has no role or permission model; the route shape preserves the boundary for a later protected admin surface.

## Reservation Flow

1. User requests a reservation for a product.
2. Backend validates product and drop status.
3. Backend ensures the Redis product counter has been warmed from PostgreSQL for the active drop.
4. A Redis Lua script atomically checks and decrements the product's available stock counter.
5. Backend writes a pending reservation record in PostgreSQL.
6. Backend stores a short-lived Redis reservation hash keyed by reservation ID.
7. Backend schedules one BullMQ delayed expiry job for that reservation.
8. If the PostgreSQL write fails after the Redis decrement, the backend immediately restores the Redis stock counter.
9. Frontend receives reservation ID and checkout deadline.
10. WebSocket subscribers receive updated stock count.

Implemented API slice:

- `POST /api/reservations` accepts `userId`, `productId`, and optional `quantity`.
- The controller performs small manual validation instead of introducing a validation library before the API surface grows.
- The service uses a Redis Lua script so a stock counter can reach exactly zero on a successful final reservation while still distinguishing insufficient stock.
- PostgreSQL records the pending reservation and increments `inventory.reserved_quantity` in one transaction.
- BullMQ receives a delayed `expire-reservation` job keyed by reservation ID.
- The endpoint fails closed if `flashreserve:stock:{productId}` is missing, because Redis warmup should be explicit and product-scoped.

## Confirmation Flow

1. User confirms checkout before expiry.
2. Backend verifies reservation ownership and status.
3. Backend creates order idempotently.
4. Reservation is marked confirmed.
5. Inventory is finalized in PostgreSQL.
6. Duplicate confirmation attempts return the existing order.

Implemented API slice:

- `POST /api/orders/confirm` accepts `userId` and `reservationId`.
- The service locks the reservation row with `FOR UPDATE` so two confirmation requests for the same hold serialize through PostgreSQL.
- The confirmation transaction marks the reservation confirmed, inserts the order and order item, and moves inventory from `reserved_quantity` to `sold_quantity`.
- Duplicate confirmation requests for an already confirmed reservation return the existing order instead of creating a second one.
- Redis stock is not changed during confirmation because the reservation path already removed those units from the available counter.

## Expiry Flow

1. BullMQ expiry job runs after the reservation window.
2. Worker checks whether the reservation is still pending.
3. If pending, it marks it expired in PostgreSQL.
4. PostgreSQL releases the durable reserved inventory count in the same transaction.
5. Redis runs the release script to restore the product's available stock counter once.
6. WebSocket subscribers receive updated stock.

Implemented worker slice:

- `ReservationExpiryWorker` consumes `expire-reservation` jobs from the `reservation-expiry` BullMQ queue.
- The worker currently runs inside the NestJS API process to keep local development simple.
- Due pending reservations are changed to `expired` and release `inventory.reserved_quantity` transactionally.
- Redis stock release uses `flashreserve:reservation-release:{reservationId}` as an idempotency marker, so retries after a crash or Redis outage do not double-increment stock.
- If Redis is unavailable after PostgreSQL commits, BullMQ retries can still release stock because the worker also handles already-expired reservations.

## Consistency Strategy

Redis handles fast burst protection. PostgreSQL handles durable truth.

The API must not assume that Redis alone is enough. Every order confirmation checks PostgreSQL reservation state. Expiry jobs are allowed to run late, so confirmation also checks deadline timestamps.

The schema mirrors that split: Redis can answer fast "can I reserve?" questions, while PostgreSQL keeps the auditable record of who reserved what, when it expires, and whether that reservation already became an order.

Chosen Redis layout:

```text
flashreserve:stock:{productId} -> integer available quantity
flashreserve:reservation:{reservationId} -> hash(productId, userId, quantity, expiresAt)
flashreserve:reservation-release:{reservationId} -> short-lived idempotency marker for expiry stock release
bull:reservation-expiry -> delayed expiry jobs
```

The first version keeps the hot key as a single integer counter per product because that is the highest-contention read/write path during a drop. Reservation metadata stays in a separate TTL-backed key so the worker can correlate fast cache state to the durable reservation row.

This is a deliberate dual-write design with a compensating action:

- Reserve stock in Redis first.
- Persist the reservation in PostgreSQL second.
- If the durable write fails, run the inverse Redis script immediately.
- For expiry, persist the durable state change first, then use an idempotent Redis marker so queue retries can safely finish cache release.

We accept that tradeoff because it keeps the hot path simple without pretending Redis is the source of truth. Recovery stays grounded in PostgreSQL: on service startup or product activation, the reservation module can rebuild Redis counters from `inventory.total_quantity - inventory.reserved_quantity - inventory.sold_quantity` plus currently pending reservations.

That recovery path is intentionally product-scoped. Because the first slice does not support carts spanning many products, the reservation and expiry logic can reconcile one hot product at a time instead of coordinating several counters in one checkout session.

## Concurrency Test Strategy

The reservation concurrency test is an integration test instead of a mocked unit test because the main risk is the contract between Redis atomic stock decrement, PostgreSQL durable reservation writes, and the HTTP API boundary.

The test runs the compiled NestJS API against local PostgreSQL and Redis, warms one product stock counter to three, then sends ten reservation requests concurrently with distinct users. The expected result is exactly three successful pending reservations and seven stock conflicts. After the requests finish, the test checks all three state surfaces that matter for the architecture:

- HTTP responses expose only three successful reservation IDs.
- PostgreSQL has three pending reservations and `inventory.reserved_quantity = 3`.
- Redis has `flashreserve:stock:{productId} = 0`.

The test skips when the local infra is unavailable by default, but `FLASHRESERVE_REQUIRE_INTEGRATION=1` turns that skip into a hard failure for CI or an intentional local verification run.

## Modules

Recommended backend modules:

- `products`
- `inventory`
- `reservations`
- `orders`
- `realtime`
- `workers`

The NestJS implementation mirrors those modules under `apps/api/src`. Reservation, order, realtime, worker, and inventory diagnostics behavior now live behind those module boundaries while the app remains one deployable backend.

## Local Infra Files

```text
projects/01-flashreserve/
  compose.yaml
  .env.example
  package.json
  apps/
    api/
    web/
  scripts/
    check-workspace.mjs
  db/
    schema.sql
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

Implemented admin diagnostics endpoint:

- `GET /api/admin/products/:productId/inventory`

## Realtime Events

```text
stock.updated
reservation.created
reservation.expired
order.confirmed
```

Implemented first realtime slice:

- Socket.IO namespace: `/stock`
- Subscription message: `stock.subscribe` with `{ productId }`
- Unsubscription message: `stock.unsubscribe` with `{ productId }`
- Broadcast message: `stock.updated`
- Room shape: `product:{productId}`

`stock.updated` is emitted from the reservation service after a successful reservation has decremented Redis stock, persisted PostgreSQL state, and scheduled expiry. It is emitted from the expiry worker only when the worker actually restores Redis stock for an expired reservation. Already-released retries are treated as idempotent no-ops for realtime fanout.

The first implementation publishes in-process because the API and worker currently run inside the same NestJS app. If API replicas or a separate worker process are added later, this boundary should move behind Redis pub/sub or a dedicated realtime gateway so every connected client sees stock events regardless of which process handled the reservation.
