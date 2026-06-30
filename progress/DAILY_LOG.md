# Daily Log

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
