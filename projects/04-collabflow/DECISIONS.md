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

## Add durable Yjs update-log tables before compaction workers

Decision:
CollabFlow now appends incoming websocket `yjs_update` payloads to PostgreSQL when `DATABASE_URL` is configured. Updates remain opaque bytes, get a per-workspace `update_seq`, and are deduplicated by SHA-256 `update_hash`. The API also initializes the future `collabflow_compaction_checkpoints` table, but does not generate checkpoints yet.

Why:
This is the smallest durable-sync step after documenting compaction. It makes API restarts safer for live update replay in PostgreSQL mode without introducing a background worker, server-side Yjs document materialization, or retention cleanup in the same slice.

Rejected alternatives:

- Implement compaction in the websocket handler. That would block live fanout on potentially expensive document merges.
- Require PostgreSQL for every local run. The in-memory fallback still keeps lightweight local checks fast.
- Store base64 text instead of bytes. Base64 is the websocket envelope, but PostgreSQL should store the actual update bytes and only re-encode for replay.

## Generate compaction checkpoints from browser-owned Yjs state

Decision:
Snapshot export now includes a browser-generated Yjs `snapshot_update` and `state_vector`. In PostgreSQL mode, the API writes those bytes to `collabflow_compaction_checkpoints`, marks update rows through the current workspace sequence as compacted, and replays the latest checkpoint before the remaining update tail on reconnect.

Why:
The browser already owns the active Yjs document. Using its compact state update keeps this slice small and avoids adding a second CRDT runtime inside FastAPI before there is a real need for server-side compaction workers.

Rejected alternatives:

- Add a Python Yjs implementation now. That would make server-side compaction possible, but it adds dependency and semantic risk before the simpler client-assisted checkpoint path is proven.
- Compact without replaying checkpoints. That would reduce stored tail rows but break reconnect recovery.
- Compact in file mode. File mode is intentionally a lightweight development fallback, not the durable-sync path.

## Add retention cleanup before a separate compaction worker

Decision:
CollabFlow now deletes PostgreSQL update rows whose `compacted_at` timestamp is older than `COMPACTED_UPDATE_RETENTION_HOURS`. The cleanup runs at API startup in PostgreSQL mode and uses the same rule a future worker should schedule.

Why:
The project needs a bounded log lifecycle before it needs a new worker process. Startup cleanup is enough for the development architecture, while the retention window preserves rollback room if a checkpoint is bad.

Rejected alternatives:

- Delete compacted rows immediately. That removes rollback space and makes checkpoint bugs harder to recover from.
- Add a scheduler now. A separate worker is useful later, but adding a runtime only to call one SQL cleanup rule would be extra machinery.
- Keep compacted rows forever. That makes compaction less meaningful because storage would still grow without bound.

## Define workspace membership authorization before enforcing it

Decision:
CollabFlow now documents workspace membership roles, development identity headers, proposed membership table, HTTP route rules, websocket join/update rules, and failure semantics in `docs/membership-authorization.md`.

Why:
Authorization touches every boundary: workspace discovery, snapshot export, websocket room joins, durable Yjs update writes, and member management. Defining the contract first keeps the next implementation from accidentally mixing authentication, membership persistence, and sync behavior in one large change.

Rejected alternatives:

- Add OAuth immediately. That would be more realistic, but it would distract from the workspace authorization model and add provider setup to the architecture lab.
- Let anyone with a workspace id join. That is convenient for demos, but it makes private workspace ids bearer secrets.
- Treat viewers as completely passive. Viewers should not write document updates, but they can still send awareness because presence is ephemeral connection state.

## Enforce development workspace membership before production auth

Decision:
CollabFlow now enforces membership with development identity headers. Workspace creators become owners, workspace lists are member-scoped, snapshots require viewer/editor role as appropriate, websocket joins require membership, and durable `yjs_update` writes require editor or owner role.

Why:
This proves the authorization boundary without adding an identity provider. The important architecture signal is role-based workspace access across HTTP and websocket paths; OAuth can replace the identity header later.

Rejected alternatives:

- Wait for production auth before enforcing roles. That would keep collaboration routes open longer than necessary.
- Enforce HTTP routes only. Websocket update writes are durable document mutations and need the same role model.
- Make viewers unable to send awareness. Awareness is ephemeral presence, so allowing it keeps read-only collaboration useful without changing document state.

## Document signed sessions before replacing development headers

Decision:
CollabFlow now documents the production identity path in `docs/signed-session-identity.md`: HTTP-only signed session cookies, membership-loaded roles, websocket session binding, CSRF protection for mutating routes, and secret rotation.

Why:
Development headers are useful for local architecture work, but they should not become the mental model for production auth. Documenting signed sessions now keeps the next implementation bounded and preserves the existing membership checks.

Rejected alternatives:

- Store roles in the session token. That makes authorization fast, but role changes would not apply until session expiry.
- Use bearer tokens for the browser app. Cookies are a better fit for same-origin browser sessions, provided CSRF is handled.
- Skip CSRF because the app is local-first. Mutating HTTP routes still use cookies in the production shape, so they need CSRF protection.

## Enforce signed sessions without adding account management yet

Decision:
CollabFlow now verifies `collabflow_session` with `COLLABFLOW_SESSION_SIGNING_SECRET`, accepts `COLLABFLOW_PREVIOUS_SESSION_SIGNING_SECRET` during rotation, checks `X-CollabFlow-CSRF` against `collabflow_csrf` on cookie-backed mutations, and binds websocket membership to the verified session identity. Development headers remain available only when `COLLABFLOW_DEV_IDENTITY_HEADERS=true`.

Why:
This replaces the risky part of the local identity model, trusting browser-sent user ids, without adding login screens, password storage, OAuth callbacks, or invitation flows in the same slice. The architecture signal stays focused on session verification plus workspace role enforcement.

Rejected alternatives:

- Add a full auth product now. That would consume the daily slice on account management instead of collaboration authorization.
- Disable development headers by default. That would be closer to production, but it would make local portfolio checks harder until a login endpoint exists.
- Require CSRF on every request. Read-only routes do not mutate cookie-authenticated state, so the double-submit rule is scoped to writes.

## Add local session issuance before full account management

Decision:
CollabFlow now exposes `POST /api/session` to issue a signed session cookie and CSRF cookie from a supplied `user_id` and `display_name`, plus `DELETE /api/session` to clear both cookies after CSRF validation. The web shell has compact controls to activate or clear that session.

Why:
The previous slice could verify signed cookies, but there was no first-class way for the browser shell to obtain one. This keeps the portfolio demo honest: users can exercise the cookie, CSRF, and websocket session-binding path without pretending a full login product exists.

Rejected alternatives:

- Add password login now. That would require storage, reset flows, and threat modeling that are outside the collaboration architecture slice.
- Keep using only manually crafted cookies. That proves verification in tests, but it leaves the browser workflow stuck on development headers.
- Make logout a client-only cookie deletion. The server should own the cookie attributes and CSRF validation so clearing the session follows the same boundary as issuing it.
