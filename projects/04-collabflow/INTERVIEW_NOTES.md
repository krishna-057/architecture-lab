# CollabFlow Interview Notes

Key topics:

- Why CRDTs instead of last-write-wins.
- Presence vs durable document state.
- Offline sync failure modes.
- Snapshot strategy.

## First Slice Talking Points

CollabFlow starts with Yjs in the browser because the core risk is collaborative state semantics, not CRUD plumbing. Even before multi-user sync exists, the app demonstrates that edits go through a CRDT document and can be projected into a local offline store.

IndexedDB is used as the first persistence target because it keeps the active workspace usable without network access. The server receives explicit snapshots only, which keeps the first API boundary simple and avoids overclaiming realtime conflict resolution before websocket sync is implemented.

Presence is intentionally documented in the sync contract but not persisted. Presence is awareness state: useful while users are connected, but misleading in durable workspace history.

The future sync server should exchange Yjs binary updates and awareness messages. PostgreSQL should store workspace metadata and compacted snapshots, not become the live merge engine for keystroke-level edits.

PostgreSQL now owns exported workspace snapshots when configured. That is deliberately narrower than a durable CRDT update log: snapshots are user-triggered checkpoints, while live updates still flow through Yjs, IndexedDB, and the development websocket room.

## Sync Contract Talking Points

The websocket contract separates durable and ephemeral data. `yjs_update` messages are durable because they can rebuild document state or feed compaction. `awareness_update` messages are ephemeral because presence only describes current collaborator activity.

The reconnect rule starts from IndexedDB before the network. That is the local-first principle: the user sees their last local projection immediately, then the sync layer catches the Yjs document up with missing updates. Snapshot export happens after catch-up so durable checkpoints do not accidentally encode stale local-only state as if it were merged truth.

The contract is provider-neutral on purpose. A later implementation can use `y-websocket`, a small Node server, or a FastAPI websocket adapter as long as it honors the room id, message types, update encoding, awareness retention, and reconnect order.

## WebSocket Shell Talking Points

The first sync implementation uses the existing FastAPI service as a development websocket room. That keeps the architecture small: the API already creates workspace ids and serves the sync contract, so the websocket can validate `workspace:{workspace_id}` rooms and fan out Yjs update bytes without introducing a separate sync runtime yet.

The server deliberately does not inspect document fields. It treats `yjs_update` as an opaque CRDT payload, appends it to an in-memory replay list, and broadcasts it to peers. That means conflict semantics still live in Yjs, while the server owns connection management and message routing.

The limitations are explicit. In-memory replay is useful for local demos and multi-tab validation, but it is not durable across API restarts and it does not solve compaction, authorization, backpressure, or horizontal scaling. Those are later architecture topics after the provider lifecycle is proven.

The optional PostgreSQL slice improves restart safety for exported checkpoints without overclaiming production sync. In an interview, that distinction is the point: durable snapshots and durable collaboration history are related, but they are not the same problem.

## Durable Update Log Talking Points

The next durable-sync step should store Yjs updates as opaque bytes in an append-only PostgreSQL log. The server should assign a per-workspace sequence and deduplicate retries with an update hash, but it should not decode the CRDT payload into task/title fields. Decoding would create a second merge model, which is exactly what Yjs is already solving.

Compaction matters because replaying every keystroke forever makes reconnect slower over time. The proposed design keeps a compacted checkpoint plus tail updates: clients apply the checkpoint first, then the remaining update log. That gives bounded replay without losing Yjs' conflict-free merge behavior.

Presence stays out of compaction. Cursor and collaborator status updates are useful in the room, but they are not document history and should not be restored as if they were durable content.

The first implementation step now exists in PostgreSQL mode: incoming Yjs updates are appended as bytes with a workspace sequence and hash dedupe before broadcast. That is intentionally short of full production sync because checkpoint generation, retention cleanup, and multi-process backpressure are still separate concerns.

Checkpoint generation is client-assisted for now. The browser sends a compact Yjs state update during snapshot export, and the API stores it as a replay checkpoint before marking earlier update rows compacted. That is a pragmatic intermediate step: it proves bounded replay without adding a server-side CRDT engine too early.

Retention cleanup is deliberately boring: compacted rows are kept for a short window, then deleted. That is the kind of operational detail interviewers like because it shows the system has a rollback story and a storage-growth story, not just a happy-path compaction diagram.

## Authorization Talking Points

The membership contract separates authentication from authorization. Development headers provide a stable local identity, while workspace membership decides what that identity can do. That makes it easy to replace headers with OAuth later without changing route-level permission rules.

The websocket path needs role checks too. Joining a room and sending durable Yjs updates are different capabilities: viewers may receive replay and send awareness, but only editors and owners should append document updates or export snapshots.

Non-member access should return `404` for private workspace routes. That avoids confirming whether a workspace id exists, which is the right default for collaborative documents.

The runtime now enforces this contract with local development headers. That is a useful stepping stone: it demonstrates the hard part, consistent authorization across HTTP and websocket document writes, before spending time on login screens.

Signed sessions are now the production-shaped identity path, but sessions do not carry workspace roles. Roles belong in `collabflow_workspace_memberships` so revoking an editor or removing a viewer takes effect immediately on the next request or websocket reconnect.

The runtime verifies cookie signatures, handles a previous signing secret for rotation, and uses CSRF double-submit tokens only on cookie-backed mutations. That is a practical middle ground: the app has a defensible auth boundary without pretending this slice also shipped registration, OAuth, or invitation lifecycle.

Session issuance is intentionally local and boring. `POST /api/session` turns a supplied development identity into the signed cookie and CSRF token the rest of the system already enforces, while `DELETE /api/session` clears both cookies through the same CSRF boundary. In an interview, the useful explanation is that this proves the browser session lifecycle without dragging in account recovery or provider-specific OAuth details.

Invite tokens complete the first collaboration onboarding loop. Owners mint a time-limited token for viewer/editor access, and the joining user redeems it from their own signed session. That demonstrates the distinction between authentication, invitation, and membership authorization without pretending email delivery or organization administration exists yet.
