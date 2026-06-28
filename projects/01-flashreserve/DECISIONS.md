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

