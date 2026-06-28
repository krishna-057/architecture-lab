# CollabFlow Architecture

To be expanded during Days 19-24.

Initial idea:

```text
Browser A
  |
  | CRDT updates
  v
Sync server
  ^
  | CRDT updates
Browser B

Browsers also persist local state in IndexedDB.
PostgreSQL stores workspace metadata and snapshots.
```

