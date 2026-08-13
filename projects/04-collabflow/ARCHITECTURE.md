# CollabFlow Architecture

CollabFlow starts as a local-first workspace with a clear separation between live document state and durable snapshots.

## Current Slice

```text
Browser
  |
  | Yjs document updates
  v
IndexedDB local snapshot
  |
  | native websocket provider shell
  v
FastAPI websocket room
  |
  | in-memory update replay + ephemeral presence fanout
  v
Connected browsers
  |
  | explicit export
  v
FastAPI snapshot API
  |
  | PostgreSQL when DATABASE_URL is set
  | JSON file fallback otherwise
  v
collabflow_snapshots / .data/snapshots.json
```

The browser owns the active collaborative document. The API does not interpret or merge CRDT fields; it accepts Yjs binary updates through a small websocket room, stores those update payloads in process memory for replay, fans them out to connected peers, and stores exported checkpoints separately.

## Runtime Components

| Component | Responsibility |
| --- | --- |
| `apps/web` | Next.js workspace UI, Yjs document initialization, IndexedDB local persistence, snapshot export controls. |
| `services/api` | Workspace metadata, websocket/presence sync contract endpoint, websocket room fanout, snapshot list/create endpoints. |
| IndexedDB | Browser-local workspace projection for offline continuity. |
| FastAPI websocket room | Development sync shell for Yjs update fanout, replay, and ephemeral presence. |
| PostgreSQL / `.data/snapshots.json` | Optional durable workspace and snapshot store, with JSON fallback for lightweight local checks. |

## API Boundary

| Endpoint | Purpose |
| --- | --- |
| `POST /api/workspaces` | Create a local-ready workspace identity. |
| `GET /api/workspaces/{workspace_id}/sync-contract` | Tell the browser which CRDT runtime, websocket endpoint, room id, message types, presence fields, reconnect rule, persistence mode, and snapshot endpoint apply. |
| `WS /ws/collabflow` | Join a workspace room, replay in-memory Yjs updates, broadcast new Yjs updates, and fan out ephemeral presence. |
| `GET /api/workspaces/{workspace_id}/snapshots` | List durable checkpoints exported for a workspace. |
| `POST /api/workspaces/{workspace_id}/snapshots` | Persist a compact checkpoint of title, notes, tasks, and Yjs state-vector length. |

## Snapshot Storage

The snapshot API chooses storage at startup. If `DATABASE_URL` is set and `psycopg` is installed, FastAPI initializes `collabflow_workspaces` and `collabflow_snapshots`, loads existing rows, and writes new workspaces/snapshots to PostgreSQL. Otherwise it keeps the original `.data/snapshots.json` fallback. This gives restart-safe exported checkpoints without making PostgreSQL the live merge engine for CRDT updates.

## Durable Update Log Direction

Durable Yjs update storage starts as an append-only log in PostgreSQL mode. The API stores opaque Yjs update bytes in `collabflow_yjs_updates`, assigns a per-workspace `update_seq`, deduplicates retries by `update_hash`, and keeps `collabflow_compaction_checkpoints` ready for the next compaction slice.

Compaction should reduce replay cost, not change document ownership. The browser and Yjs still own merge semantics; the server stores ordered update bytes, replays the current non-compacted tail on reconnect, and keeps awareness messages out of durable storage.

## WebSocket And Presence Contract

The websocket implementation is a first development shell that honors the server-discoverable contract:

| Contract Part | Current Rule |
| --- | --- |
| Room id | `workspace:{workspace_id}` |
| Document id | `collabflow:{workspace_id}:workspace-doc` |
| Update encoding | Base64url Yjs binary update bytes. |
| Message types | `sync_request`, `yjs_update`, `awareness_update`, `snapshot_offer`. |
| Presence retention | Ephemeral Yjs awareness only; never persisted into snapshots. |
| Reconnect | Load IndexedDB, reconnect, request missing updates, then resume snapshot exports. |
| Update storage | PostgreSQL append-only update log when `DATABASE_URL` is set; in-memory fallback otherwise. Compaction policy is documented in `docs/update-log-compaction.md`. |

## Future Sync Shape

```text
Browser A
  |
  | Yjs binary updates + awareness
  v
WebSocket sync server
  ^
  | Yjs binary updates + awareness
Browser B

Browsers also persist local state in IndexedDB.
PostgreSQL stores workspace metadata and exported snapshots.
```

Presence should remain ephemeral awareness state. It should not be written into durable document snapshots because it describes who is currently connected, not the workspace content.
