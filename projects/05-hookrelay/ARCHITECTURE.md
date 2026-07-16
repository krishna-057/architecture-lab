# HookRelay Architecture

HookRelay starts as a modular monolith with one Fastify API process and one Next.js dashboard. This keeps the first slice focused on the webhook delivery contract instead of introducing a database and queue before the resource shape is clear.

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

## Boundaries

| Boundary | First implementation | Reason |
| --- | --- | --- |
| API | Fastify service under `services/api` | HookRelay is HTTP-heavy, and Fastify keeps the delivery API small and direct. |
| Dashboard | Next.js app under `apps/web` | Operators need a delivery log, replay action, and contract visibility. |
| Storage | In-memory maps | The first slice proves endpoint/event/delivery shapes without schema churn. |
| Queue | Queued delivery records only | BullMQ should be added once status transitions and retry rules are proven. |
| Signing | HMAC SHA-256 header preview | Signature verification can be explained and tested before outbound delivery exists. |

## Failure Modes To Address Next

- API process restart loses in-memory state.
- Delivery attempts are queued but not sent.
- No dead-letter state transition exists yet.
- Replay has no authorization guard.
- HMAC signatures are generated, but no receiver verification example exists yet.
