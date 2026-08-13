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
