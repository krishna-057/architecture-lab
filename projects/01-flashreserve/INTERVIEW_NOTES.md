# FlashReserve Interview Notes

## One-Minute Pitch

FlashReserve is a flash sale system that prevents overselling by separating temporary reservations from final orders. It uses Redis for fast atomic reservation under burst traffic and PostgreSQL as the durable source of truth. A worker expires abandoned reservations, and WebSockets keep clients updated with approximate live stock.

## Questions To Expect

### How do you prevent overselling?

The reservation API checks stock on the server and uses Redis atomic operations to reserve stock quickly. PostgreSQL records the reservation durably. Order confirmation validates the reservation state and deadline before creating an idempotent order.

### Why not just lock a PostgreSQL row?

PostgreSQL row locking is correct and simpler, but under a large flash-sale burst it can create heavy contention on the inventory row. Redis gives a faster front line for reservation counters, while PostgreSQL still owns durable state.

### What happens if the expiry worker is down?

Reservations may expire late, but confirmation still checks the reservation deadline. That means an expired reservation cannot be confirmed just because the worker has not processed it yet.

The worker is also retry-safe: PostgreSQL records the durable expired state, and Redis stock release uses a per-reservation marker so a retried BullMQ job cannot restore the same stock twice.

### Why not microservices?

The first version does not need independent deployment or scaling per domain. A modular monolith keeps boundaries clear while avoiding distributed transactions and network failure between internal modules.

### Why not start with a shopping cart?

The hard part of a flash sale is protecting the hottest inventory path, not supporting general storefront ergonomics. Starting with one product per reservation keeps expiry, rollback, and idempotent confirmation easy to explain. The schema still keeps `order_items`, so the design can grow into carts later without replacing the order model.

### How would you scale it?

Start with Redis atomic scripts and per-product counters. Add rate limits and a waiting room for extreme bursts. If WebSocket fanout grows, use Redis pub/sub or a dedicated realtime gateway. If order processing grows, split workers independently before splitting the whole backend.

### How are live stock updates delivered?

Clients join a product-scoped Socket.IO room on the `/stock` namespace. The reservation path emits `stock.updated` after the reservation is durable and the expiry job is scheduled. The expiry worker emits the same event only when it actually restores Redis stock, so retries do not duplicate updates.

### How is order confirmation idempotent?

Confirmation locks the reservation row in PostgreSQL, checks ownership, status, and deadline, then marks the reservation confirmed while creating the order and order item in the same transaction. If the client retries after success, the API sees the reservation is already confirmed and returns the existing order instead of creating a duplicate.
