# HookRelay Architecture

To be expanded during Days 25-30.

Initial idea:

```text
Producer API
  |
  v
Event ingestion service
  |
  +--> PostgreSQL event log
  +--> BullMQ delivery jobs
          |
          v
      Delivery worker
          |
          v
      Consumer webhook endpoint
```

