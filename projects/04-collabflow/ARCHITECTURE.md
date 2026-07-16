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
  | explicit export
  v
FastAPI snapshot API
  |
  | local JSON file for first slice
  v
.data/snapshots.json
```

The browser owns the active collaborative document. The API does not try to merge CRDT updates in this slice; it stores exported checkpoints and exposes a sync contract so the future websocket layer has a documented boundary.

## Runtime Components

| Component | Responsibility |
| --- | --- |
| `apps/web` | Next.js workspace UI, Yjs document initialization, IndexedDB local persistence, snapshot export controls. |
| `services/api` | Workspace metadata, sync contract endpoint, snapshot list/create endpoints. |
| IndexedDB | Browser-local workspace projection for offline continuity. |
| `.data/snapshots.json` | Lightweight local durable snapshot store until PostgreSQL is introduced. |

## API Boundary

| Endpoint | Purpose |
| --- | --- |
| `POST /api/workspaces` | Create a local-ready workspace identity. |
| `GET /api/workspaces/{workspace_id}/sync-contract` | Tell the browser which CRDT runtime, persistence mode, snapshot endpoint, and future sync transport apply. |
| `GET /api/workspaces/{workspace_id}/snapshots` | List durable checkpoints exported for a workspace. |
| `POST /api/workspaces/{workspace_id}/snapshots` | Persist a compact checkpoint of title, notes, tasks, and Yjs state-vector length. |

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
PostgreSQL stores workspace metadata and snapshots.
```

Presence should remain ephemeral awareness state. It should not be written into durable document snapshots because it describes who is currently connected, not the workspace content.
