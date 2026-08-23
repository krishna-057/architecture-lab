# CollabFlow Scaling Notes

CollabFlow is intentionally built as a local-first portfolio project, not as a production Google Docs clone. The current architecture proves the collaboration boundaries that matter in interviews: CRDT ownership, offline persistence, websocket fanout, durable checkpoints, membership authorization, and invite lifecycle.

## Current Scale Envelope

The current implementation is suitable for local demos, multi-tab testing, and small single-process workspaces:

- The browser owns the active Yjs document and persists the latest projection in IndexedDB.
- FastAPI owns workspace metadata, membership, session verification, invite tokens, websocket room joins, and snapshot export.
- File mode keeps checks lightweight by storing snapshots, memberships, and invites in `.data/snapshots.json`.
- PostgreSQL mode stores workspaces, snapshots, memberships, invites, append-only Yjs updates, and compaction checkpoints.
- Websocket room membership and awareness fanout are in process memory.

That envelope is deliberate. It keeps the project explainable while still surfacing the real scaling pressure points.

## Scaling Pressure Points

### Websocket Fanout

The first bottleneck is websocket room fanout. A single FastAPI process can broadcast to connected clients in one process, but multiple API replicas would not share room state. Horizontal scaling needs either sticky sessions per workspace room or a shared pub/sub layer.

Recommended next step:

- Keep one websocket runtime per room shard.
- Use Redis pub/sub or NATS for cross-process awareness and update fanout.
- Keep persisted Yjs updates in PostgreSQL or a dedicated log so reconnect does not depend on process memory.

Rejected for this lab:

- Kubernetes-first deployment. The problem is room coordination, not container orchestration.
- Broadcasting every message through PostgreSQL notifications. PostgreSQL is useful for durability, but it should not become the realtime fanout bus.

### Durable Replay And Compaction

PostgreSQL-mode update persistence gives a restart-safe tail, but replay cost grows with un-compacted updates. The current browser-assisted checkpoint flow bounds replay after snapshot export; production would need scheduled compaction for inactive workspaces too.

Recommended next step:

- Add a small compaction worker that loads the latest checkpoint plus tail updates, materializes a Yjs document, writes a new checkpoint, then marks old rows compacted.
- Keep compacted rows for a retention window before deletion.
- Alert on workspaces whose un-compacted update count crosses a threshold.

Rejected for this lab:

- Decoding Yjs updates into relational task rows for every edit. That creates a second merge model and weakens the CRDT boundary.
- Deleting compacted rows immediately. Retention gives recovery room after a bad checkpoint.

### Offline Conflicts

Offline edits merge through Yjs, but user experience still matters. Conflicts are conflict-free at the data structure level, not always semantically obvious to users.

Recommended next step:

- Keep task identity stable with object ids instead of plain strings.
- Show a lightweight activity feed sourced from durable updates or snapshots.
- Add per-field conflict explanation only where the product needs it.

Rejected for this lab:

- Last-write-wins saves. They are easier to reason about in CRUD apps but fail the collaboration goal.
- Locking the whole workspace while offline. That breaks the local-first requirement.

### Membership And Identity

Signed sessions prove the browser identity boundary, and workspace membership remains authoritative for roles. Production still needs real account management.

Recommended next step:

- Replace local session issuance with OAuth or password login.
- Keep roles out of session tokens so permission changes apply on the next request.
- Add invite email delivery, resend events, and abuse controls after account identity exists.

Rejected for this lab:

- Storing roles inside cookies. It is fast, but demotion and removal would lag until session expiry.
- Adding a full organization directory before workspace collaboration semantics are complete.

### Storage Growth

The durable paths that can grow are snapshots, Yjs updates, compaction checkpoints, invite audit rows, and membership history.

Recommended next step:

- Keep only explicit snapshots that users export.
- Compact update tails regularly and retain compacted rows briefly.
- Archive or delete expired invite tokens after an audit window.
- Add indexes around workspace id plus creation time for user-facing history views.

Rejected for this lab:

- Event sourcing every product action. The project needs CRDT replay and audit notes, not a full event-sourced domain model.

## Production Readiness Checklist

Before treating CollabFlow as production-ready, add:

- Real user registration or OAuth.
- Hosted database migrations instead of startup `create table if not exists`.
- A shared websocket fanout layer or room-sharding strategy.
- Background compaction worker with metrics.
- Rate limits on session, invite, and websocket join endpoints.
- End-to-end browser tests for two-client editing and role changes.
- Deployment secrets, backup policy, and observability.

Those are intentionally outside the 30-day portfolio scope. The implemented system is meant to make these next steps obvious, not to hide them behind a fake production claim.
