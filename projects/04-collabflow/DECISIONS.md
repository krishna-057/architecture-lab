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

## Define the websocket and presence contract before implementing the sync server

Decision:
CollabFlow now exposes a structured sync contract from `GET /api/workspaces/{workspace_id}/sync-contract` and mirrors it in `SYNC_CONTRACT.md`. The contract defines workspace rooms, Yjs update encoding, websocket message types, presence fields, and reconnect behavior, but does not open a websocket endpoint yet.

Why:
Realtime collaboration has several contracts that are easy to blur: durable document updates, ephemeral awareness state, reconnect ordering, and snapshot compaction. Defining those first keeps the next implementation slice small and gives the UI/API a shared vocabulary before adding provider lifecycle, fanout, and persistence concerns.

Rejected alternatives:

- Add `y-websocket` immediately. That would prove live sync faster, but it would hide important room, presence, and reconnect decisions behind a library default before the portfolio docs explain them.
- Persist presence in snapshots. That would make snapshots look more complete, but stale cursors and collaborator labels are not durable workspace content.
- Invent a custom CRDT payload. Yjs update bytes are the actual interoperability boundary; wrapping them in a small message envelope is enough.

## Implement websocket sync as a FastAPI development shell first

Decision:
CollabFlow now uses `WS /ws/collabflow` in the existing FastAPI service for the first realtime slice. Browsers join a workspace room with `sync_request`, send base64url Yjs update bytes, receive peer updates, and exchange ephemeral presence. The server keeps room membership, presence, and update replay in process memory.

Why:
This proves the websocket provider lifecycle and Yjs fanout boundary without adding a second runtime or a durable update-log schema too early. The existing API already owns workspace identity and sync-contract discovery, so a small websocket adapter keeps the implementation understandable for the architecture lab.

Rejected alternatives:

- Add the `y-websocket` server package immediately. It is mature and likely useful later, but it would introduce a separate Node service before the project demonstrates the message contract itself.
- Persist every Yjs update in PostgreSQL now. Durable update logs need compaction and retention decisions; exported snapshots are enough durability for this slice.
- Treat presence as document data. Presence remains ephemeral awareness state because stale cursors and collaborator labels should not appear in durable snapshots.

## Add optional PostgreSQL snapshot storage before durable update logs

Decision:
CollabFlow now stores exported workspaces and snapshots in PostgreSQL when `DATABASE_URL` is configured. Without PostgreSQL, the API keeps the existing `.data/snapshots.json` fallback.

Why:
Exported snapshots are the first durable server-side artifact users expect to survive an API restart. PostgreSQL fits that checkpoint boundary without asking the API to interpret or merge live CRDT updates.

Rejected alternatives:

- Persist every Yjs update now. That needs compaction, retention, and replay semantics beyond this slice.
- Remove the JSON fallback. That would make lightweight local checks depend on Docker even when the sync behavior itself does not need it.
- Store presence in PostgreSQL. Presence remains current connection state, not durable workspace content.

## Document durable update-log compaction before implementing it

Decision:
CollabFlow now documents the intended durable Yjs update log and compaction model in `docs/update-log-compaction.md`, but keeps the runtime websocket replay in memory for this slice.

Why:
Persisting every Yjs update is easy to start and surprisingly easy to get wrong. Replay order, duplicate websocket retries, checkpoint generation, retention, and failure handling all affect data recovery. Writing those rules before adding tables and websocket writes gives the next implementation a narrow contract instead of a vague "make sync durable" task.

Rejected alternatives:

- Add append-only update persistence immediately. That would create a real durability path, but without compaction and replay tests it could become an ever-growing log with unclear recovery semantics.
- Store decoded task/title fields in the update log. That would make querying easier, but it would break the server's current role as an opaque Yjs transport and risk inventing a second merge model.
- Delete compacted updates immediately. Marking them first with `compacted_at` gives rollback room if checkpoint generation or client replay has a bug.
