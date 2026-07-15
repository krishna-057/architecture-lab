# FlashReserve Decisions

## Decision 1: Start With A Modular Monolith

We will build FlashReserve as a modular monolith with a separate worker process.

Why:
- The project needs clear boundaries, not distributed deployment complexity.
- Inventory, reservation, order, and realtime modules can be separated in code.
- A single database transaction can still protect important state transitions.
- It is easier to test and explain in interviews.

Rejected:
- Full microservices: unnecessary operational cost for a 30-day portfolio build.
- Single unstructured app: too weak for architecture discussion.

## Decision 2: Use Redis For Fast Reservation Coordination

We will use Redis for atomic stock reservation during burst traffic.

Why:
- Flash sale traffic is spiky.
- Redis atomic operations or Lua scripts can protect counters quickly.
- Redis integrates naturally with BullMQ for expiry jobs.
- The initial design only needs one hot stock counter per product and one short-lived reservation key per reservation, which keeps Redis usage understandable in interviews.

Chosen shape:
- `flashreserve:stock:{productId}` stores the current available quantity for the hot reservation path.
- `flashreserve:reservation:{reservationId}` stores short-lived metadata with a TTL for expiry correlation.
- BullMQ delayed jobs remain the only expiry scheduler; we do not add a second custom Redis queue.
- Reservation creation decrements Redis first, then writes PostgreSQL, and restores Redis immediately if the durable write fails.
- Redis counters are warmed from PostgreSQL when the product drop opens or the service starts, and the API fails closed if the cache is unexpectedly missing during an active drop.

Rejected:
- Client-side reservation checks: unsafe.
- PostgreSQL-only locking at first: correct but less suited to burst-heavy reservation counters.
- Redis token lists per inventory unit: more exact in appearance, but heavier than needed for quantity-based reservations.
- Redlock around the whole reservation flow: a larger coordination surface than a per-product atomic counter requires.
- A custom sorted-set expiry scheduler: duplicates BullMQ without improving the first slice enough.

## Decision 3: Keep PostgreSQL As Durable Truth

PostgreSQL remains the durable source of truth for products, reservations, and orders.

Why:
- Orders and reservations need auditability.
- Redis data can be lost or evicted depending on configuration.
- Confirmation and recovery paths need durable state.

Rejected:
- Redis-only reservation records: too risky for business state.

## Decision 4: Avoid Real Payments In The First Version

We will simulate payment confirmation.

Why:
- The architecture goal is reservation consistency, not payment provider integration.
- Real payments add account setup and sensitive workflows.
- The checkout boundary can be designed so a payment provider can be added later.

Rejected:
- Stripe integration in the first slice: valuable later, distracting now.

## Decision 5: Keep Local Infra State Inside The Project Workspace

We will run PostgreSQL and Redis through Docker Compose with bind-mounted data directories under `projects/01-flashreserve/.data/`.

Why:
- The lab explicitly prefers keeping project-heavy files on `K:\AutoPilot_Projects`.
- Bind mounts make it obvious where local state lives during rapid iteration.
- Resetting local infrastructure for schema changes is simpler when the data path is visible in the repo layout.

Rejected:
- Docker named volumes by default: workable, but less explicit about where data accumulates on Windows.
- Installing PostgreSQL and Redis directly on the host: more machine-specific setup and harder to reproduce.

## Decision 6: Model Inventory As Aggregate Counters Per Product

We will store one `inventory` row per product with `total_quantity`, `reserved_quantity`, and `sold_quantity`, and derive available stock from those values instead of persisting a separate available counter.

Why:
- The reservation path needs a compact record that can be reconciled against Redis quickly.
- The worker and confirmation flow both need to update durable inventory without scanning many rows.
- The relationship between reserved and sold stock stays explicit, which is easier to defend in interviews than a single opaque counter.

Rejected:
- Persisting only an `available_quantity` number: simpler at first glance, but it hides how much stock is merely held versus permanently sold.
- One inventory movement row per reservation as the primary read model: more auditable, but heavier than needed for the first portfolio slice.

## Decision 7: Use A Small NPM Workspace For The App Scaffold

We will keep FlashReserve's first executable app scaffold inside `projects/01-flashreserve` as an npm workspace with `apps/api` and `apps/web`.

Why:
- The project is full-stack, so the frontend and backend need separate commands and dependencies.
- A workspace keeps them in one portfolio project without introducing a heavier monorepo tool before it is useful.
- The backend can stay a modular monolith in NestJS while the frontend stays a standard Next.js app.
- The first scaffold can be verified without installing dependencies, which respects the low-disk-space constraint on the machine.

Rejected:
- A single Next.js app with API routes for everything: simpler, but weaker for the reservation worker, Redis, and backend architecture discussion.
- Nx/Turborepo from day one: useful later, but too much tooling before there is meaningful shared build complexity.
- Separate Git repositories for API and web: unnecessary coordination overhead for a 30-day portfolio project.

## Decision 8: Start With Single-Product Reservations Instead Of Carts

The first checkout flow will reserve one product per reservation and convert one reservation into one order.

Why:
- Flash-sale contention is concentrated on a single hot product, so product-scoped reservation logic exposes the most important consistency problems first.
- The current durable schema already models one reservation with one `product_id` and one `quantity`, which keeps the first API slice direct.
- Expiry, idempotent confirmation, and Redis counter reconciliation all stay simpler when one reservation touches one stock counter.
- Keeping `order_items` in the schema now preserves a clean extension point for future multi-line orders without making the first slice cart-shaped.

Rejected:
- Multi-product cart checkout first: more user-friendly in a typical storefront, but it introduces cross-product coordination before the lab has proven the hot reservation path.
- One reservation spanning many products: possible later, but it complicates expiry, stock rollback, and idempotent order creation too early.

## Decision 9: Keep Reservation API Validation Manual For The First Slice

The first `POST /api/reservations` implementation validates request shape directly in a small parser instead of adding `class-validator` and global pipes immediately.

Why:
- The current endpoint accepts only three fields, so a local parser is easier to audit than framework-wide validation configuration.
- It keeps the reservation path focused on the architecture signal: Redis atomic stock, PostgreSQL durability, and BullMQ expiry scheduling.
- The parser can be replaced with Nest validation pipes when the public API surface grows.

Rejected:
- Adding a full validation stack now: useful later, but unnecessary for one narrow endpoint.
- Trusting raw request bodies in the service: too easy to turn bad input into misleading reservation failures.

## Decision 10: Run The First Expiry Worker Inside The API Process

The first reservation expiry worker will run as a Nest provider in the existing API process.

Why:
- The project needs the expiry behavior before it needs separate process orchestration.
- The module boundary is still explicit under `workers`, so the worker can move to a separate process later without changing queue semantics.
- Local development stays small: one API command can exercise the reservation endpoint and delayed expiry.

Rejected:
- A separate worker package immediately: cleaner operationally, but extra scripts and process management before there is more than one worker.
- PostgreSQL cron or polling-only expiry: simpler to start, but it ignores the BullMQ delayed-job strategy already chosen for reservation timers.

## Decision 11: Make Expiry Redis Release Idempotent

Expiry uses `flashreserve:reservation-release:{reservationId}` as a short-lived Redis marker before incrementing the product stock counter.

Why:
- BullMQ can retry jobs after crashes or transient Redis failures.
- PostgreSQL may already have committed the reservation as expired when Redis release fails.
- The marker lets retries finish Redis release without double-incrementing stock.

Rejected:
- Incrementing Redis stock directly on every retry: unsafe because the same reservation could restore stock more than once.
- Adding a durable outbox table immediately: stronger for production recovery, but heavier than needed for this first local worker slice.

## Decision 12: Test Reservation Concurrency Through The Real API

The first contention test runs against the compiled NestJS API with local PostgreSQL and Redis instead of mocking the reservation service internals.

Why:
- The architecture risk is cross-system behavior: Redis must reject excess reservations while PostgreSQL records only the winning holds.
- Running through HTTP catches controller parsing, service behavior, Redis Lua execution, PostgreSQL transactions, and BullMQ scheduling in one focused slice.
- Distinct users avoid the one-pending-reservation unique index becoming the tested bottleneck.
- The test stays dependency-light by using Node's built-in test runner and the app's existing `pg` and `ioredis` dependencies.

Rejected:
- Mock-only service tests for the first race path: useful later for edge cases, but they would not prove Redis/PostgreSQL coordination.
- Adding Jest or another test framework immediately: more tooling than this single integration slice needs.
- Making local infra mandatory for every `npm run check`: too heavy for quick scaffold validation, so the integration test can skip unless `FLASHRESERVE_REQUIRE_INTEGRATION=1` is set.

## Decision 13: Start Realtime Stock With Product-Scoped WebSocket Rooms

The first live stock update channel uses Socket.IO through NestJS WebSocket gateways. Clients connect to the `/stock` namespace and subscribe to one product room at a time with `stock.subscribe`.

Why:
- The first product flow is already single-product, so product-scoped rooms match the reservation model.
- The reservation service and expiry worker know the exact stock count after Redis changes, so they can publish compact `stock.updated` events without polling PostgreSQL.
- Socket.IO keeps the browser integration small while preserving a WebSocket-shaped architecture for interview discussion.
- Publishing in-process is enough while the worker runs in the API process.

Rejected:
- Polling the product endpoint for stock: simpler, but it hides the realtime architecture signal.
- Broadcasting every stock event to every connected client: easy to implement, but wasteful once multiple products exist.
- Redis pub/sub immediately: the right next step for multiple API processes, but unnecessary before there is more than one process to bridge.
