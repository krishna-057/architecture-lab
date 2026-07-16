# CollabFlow

CollabFlow is a local-first collaborative workspace for shared tasks, notes, and lightweight diagrams.

The first slice is a single-user local-first workspace shell that proves the core boundaries before adding realtime sync:

- a Next.js app at `apps/web`
- a Yjs document for title, notes, and task-list state
- browser IndexedDB snapshots for offline persistence
- a FastAPI API at `services/api` for workspace metadata, sync contract discovery, and durable snapshot export
- `SYNC_CONTRACT.md` plus API discovery for the future websocket room, Yjs update, and presence contract

## Architecture Focus

- CRDT-based collaboration
- Presence
- Offline persistence
- Conflict-free sync
- Snapshot and export model

## Proposed Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | Next.js | Product UI and routing consistency across the lab. |
| Collaboration | Yjs | Mature CRDT library for shared documents and awareness. |
| Persistence | IndexedDB | Browser-local offline state. |
| Sync | y-websocket or small Node sync server | Minimal sync layer for collaboration. |
| Database | PostgreSQL | Durable workspace metadata and snapshots. |

## Local Development

```powershell
cd projects\04-collabflow
npm install
npm run dev:web
npm run dev:api
```

The web app defaults to port `3300`; the API defaults to port `8300`.

Local generated state is intentionally small and ignored:

- browser IndexedDB stores the live local projection
- `.data/snapshots.json` stores exported API snapshots when `SNAPSHOT_STORE_PATH` is not overridden

## First Slice Behavior

1. The browser creates a workspace through `POST /api/workspaces`.
2. The browser initializes a Yjs document for the workspace title, notes, and tasks.
3. Edits update the Yjs document first, then the current projection is saved into IndexedDB.
4. The API exposes `GET /api/workspaces/{workspace_id}/sync-contract` so the UI can display the websocket room, Yjs update encoding, message types, reconnect rule, and ephemeral presence fields.
5. The browser can export a durable snapshot with `POST /api/workspaces/{workspace_id}/snapshots`.

This is intentionally not a full multi-user sync server yet. The first milestone proves the local-first state shape and the export boundary without introducing websocket lifecycle complexity too early.

## Sync Contract

The first realtime contract is documented in `SYNC_CONTRACT.md` and returned by the API. It defines:

- one websocket room per workspace using `workspace:{workspace_id}`
- base64url-encoded Yjs binary update messages
- ephemeral Yjs awareness presence fields
- reconnect behavior that restores IndexedDB before asking the sync server for missing updates
- snapshot offers as durable checkpoints, not live document ownership

## Why This Project Matters

This project demonstrates consistency models beyond normal CRUD. It gives strong interview material around collaboration, conflict handling, and offline-first design.
