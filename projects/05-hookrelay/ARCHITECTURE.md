# HookRelay Architecture

HookRelay starts as a modular monolith with one Fastify API process and one Next.js dashboard. The current slice keeps the dependency-light in-memory mode for quick checks and adds an optional durable path with PostgreSQL and BullMQ once `DATABASE_URL` and `REDIS_URL` are present.

## First-Slice Runtime

```text
Producer API
  |
  v
Fastify API
  |
  +--> In-memory endpoint registry
  +--> In-memory event log
  +--> In-memory delivery attempt records
  +--> HMAC signature preview
  +--> Replay enqueue path

Next.js dashboard
  |
  v
Fastify discovery and control APIs
```

## Planned Durable Runtime

```text
Producer API
  |
  v
Event ingestion API
  |
  +--> PostgreSQL event and delivery log
  +--> BullMQ delivery jobs
          |
          v
      Delivery worker
          |
          v
      Consumer webhook endpoint
          |
          v
      Delivery attempt update + retry/dead-letter decision
```

## Current Durable Runtime

```text
Producer API
  |
  v
Fastify API
  |
  +--> PostgreSQL endpoints, events, delivery_attempts
  +--> BullMQ delivery job
          |
          v
      Worker process
          |
          v
      Customer webhook endpoint
          |
          v
      delivery_attempts status update
      retry attempt or dead_letter record
```

## Boundaries

| Boundary | First implementation | Reason |
| --- | --- | --- |
| API | Fastify service under `services/api` | HookRelay is HTTP-heavy, and Fastify keeps the delivery API small and direct. |
| Dashboard | Next.js app under `apps/web` | Operators need a delivery log, replay action, and contract visibility. |
| Storage | In-memory maps by default, PostgreSQL when configured | Fast local checks remain simple while the durable schema proves restart-safe delivery logs. |
| Queue | Delivery attempt records by default, BullMQ when configured | The API can enqueue delayed jobs without forcing Redis for every local run. |
| Signing | HMAC SHA-256 header preview | Signature verification can be explained and tested before outbound delivery exists. |

## Failure Modes To Address Next

- API process restart loses state only in the default in-memory mode.
- Worker retries currently use the fixed first ladder, not jittered exponential backoff.
- Receiver authentication, tenant ownership, and replay authorization are not implemented yet.
- HMAC signatures are generated, but no receiver verification example exists yet.
