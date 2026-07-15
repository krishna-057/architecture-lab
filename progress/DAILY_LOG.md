# Daily Log

## 2026-07-15

Implemented the first FlashReserve reservation expiry worker slice.

Added:
- `ReservationExpiryWorker` for BullMQ `expire-reservation` jobs.
- Transactional PostgreSQL expiry that marks due pending reservations as `expired` and releases durable reserved inventory.
- Idempotent Redis stock release using `flashreserve:reservation-release:{reservationId}` markers.
- Shared Redis connection and reservation key helpers for the API and worker.
- Documentation for the worker process boundary and retry-safety decision.

Validated the work by running:
- `npm run check` from `projects/01-flashreserve`
- `npm run build -w @flashreserve/api` from `projects/01-flashreserve`

Notes:
- `git pull --ff-only` is still blocked because GitHub returned `Repository not found` for `https://github.com/krishna-057/architecture-lab.git`.

Next recommended task:
- Add tests for concurrent reservation attempts.

Implemented the first FlashReserve reservation creation API slice.

Added:
- `POST /api/reservations` in the NestJS API.
- A small PostgreSQL database service using `pg`.
- Redis atomic stock decrement logic for warmed `flashreserve:stock:{productId}` counters.
- Durable pending reservation creation with `inventory.reserved_quantity` updates.
- Redis reservation metadata TTL storage and BullMQ delayed expiry job scheduling.
- Compensation paths for Redis/PostgreSQL split failures and expiry scheduling failures.
- Documentation for the implemented endpoint, configuration, and manual validation decision.

Validated the work by running:
- `npm run check` from `projects/01-flashreserve`
- `npm run build -w @flashreserve/api` from `projects/01-flashreserve`

Notes:
- `git pull --ff-only` and pushing are blocked because GitHub returned `Repository not found` for `https://github.com/krishna-057/architecture-lab.git`.
- Created GitHub issue #2, `Human needed: Git push auth`, with the required human action.
- Sent the Telegram completion/blocker notification.
- `npm install` reported existing dependency audit findings: 3 low, 14 moderate, and 7 high.

Next recommended task:
- Add the reservation expiry worker.

## 2026-07-02

Defined the FlashReserve first-slice product flows and core entities across the project docs.

Added:
- An explicit single-product reservation flow in the FlashReserve README and architecture notes.
- A core-entity responsibility matrix plus state transitions for products, reservations, and orders.
- A recorded decision to start with single-product reservations instead of a cart-first checkout.
- Interview notes that justify the cart tradeoff in flash-sale terms.

Validated the work by running:
- `node scripts/check-workspace.mjs` from `projects/01-flashreserve`

Next recommended task:
- Implement the reservation creation API.

## 2026-07-01

Documented the concrete FlashReserve Redis reservation strategy across the project README, architecture notes, and decision log.

Added:
- The initial Redis key layout for product stock counters, reservation metadata, and BullMQ expiry jobs.
- The compensating release rule for Redis/PostgreSQL split-write failures.
- Rejected alternatives for Redis token lists, Redlock, and custom expiry schedulers.

Validated the work by running:
- `node scripts/check-workspace.mjs` from `projects/01-flashreserve`

Next recommended task:
- Implement the reservation creation API.

## 2026-06-30

Created the initial FlashReserve app scaffold under `projects/01-flashreserve`.

Added:
- `apps/api` as the NestJS modular monolith backend scaffold.
- `apps/web` as the Next.js frontend shell.
- `scripts/check-workspace.mjs` as a dependency-free scaffold sanity check.

Documented the workspace split in the FlashReserve README, architecture notes, and decision log.

Validated the work by running:
- `node scripts/check-workspace.mjs`

Next recommended task:
- Implement the reservation creation API inside `apps/api/src/reservations`.

Completed the initial FlashReserve PostgreSQL schema at `projects/01-flashreserve/db/schema.sql`.

Added durable tables for:
- users
- products
- inventory
- reservations
- orders
- order_items

Documented the schema shape and the aggregate inventory decision in the FlashReserve README, architecture notes, and decision log.

Validated the work by running:
- `docker compose -f projects/01-flashreserve/compose.yaml config`
- `docker compose -f projects/01-flashreserve/compose.yaml up -d`
- `Get-Content db/schema.sql | docker compose -f compose.yaml exec -T postgres psql -U flashreserve -d flashreserve -v ON_ERROR_STOP=1`
- `docker compose -f compose.yaml exec -T postgres psql -U flashreserve -d flashreserve -c "select table_name from information_schema.tables where table_schema = 'public' order by table_name;"`

Next recommended task:
- Implement the reservation creation API against Redis and PostgreSQL using this schema.

## 2026-06-29

Initialized the portfolio lab planning structure.

Created the first version of:
- Master 30-day plan
- Daily workflow contract
- Project briefs
- Documentation templates
- Task queue

Next recommended task:
- Start FlashReserve with product scope, data model, and local development stack.

Added `projects/01-flashreserve/compose.yaml` with a minimal PostgreSQL and Redis stack for local development.

Documented the local infra approach in FlashReserve docs, including the decision to keep bind-mounted data under `projects/01-flashreserve/.data/` so Docker-backed state stays on `K:`.

Validated the compose file with `docker compose -f projects/01-flashreserve/compose.yaml config`.

Next recommended task:
- Add the initial FlashReserve database schema for users, products, inventory, reservations, and orders.
