# CollabFlow Decisions

## Start with browser-owned Yjs state before websocket sync

Decision:
The first CollabFlow slice uses a browser-created Yjs document for title, notes, and task-list state, then persists the current projection into IndexedDB.

Why:
Local-first collaboration should prove offline document ownership before adding a sync server. A websocket provider is useful only after the document shape, local persistence model, and snapshot boundary are explicit.

Rejected alternatives:

- Start with CRUD rows only. This would be simpler, but it would avoid the core CRDT interview signal.
- Add y-websocket immediately. That would create networking, room lifecycle, and provider concerns before the single-browser local-first path is validated.
- Store every CRDT update in the API first. That is closer to production sync history, but it is unnecessary for the first scaffold and would require a more careful compaction strategy.

## Export snapshots instead of treating the API as the live document owner

Decision:
The FastAPI service stores exported snapshots and workspace metadata. It does not merge live edits in this slice.

Why:
The browser-local Yjs document is the source of truth while editing. Durable snapshots are checkpoints for recovery, export, and future server-side indexing. Keeping these roles separate avoids pretending that the API already solves realtime conflict handling.

Rejected alternatives:

- Last-write-wins document saves. This is easy, but it fails the conflict-free collaboration goal.
- Immediate PostgreSQL snapshot tables. PostgreSQL remains the intended durable store, but a local JSON file is enough to prove the API contract without adding database setup on day one.
