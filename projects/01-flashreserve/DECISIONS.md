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

Rejected:
- Client-side reservation checks: unsafe.
- PostgreSQL-only locking at first: correct but less suited to burst-heavy reservation counters.

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
