# CollabFlow

CollabFlow is a local-first collaborative workspace for shared tasks, notes, and lightweight diagrams.

The current slice is a local-first workspace shell with a small realtime sync path:

- a Next.js app at `apps/web`
- a Yjs document for title, notes, and task-list state
- browser IndexedDB snapshots for offline persistence
- a FastAPI API at `services/api` for workspace metadata, sync contract discovery, websocket fanout, and durable snapshot export
- `SYNC_CONTRACT.md` plus API discovery for the websocket room, Yjs update, and presence contract

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
4. The API exposes `GET /api/workspaces/{workspace_id}/sync-contract` so the UI can discover the websocket room, Yjs update encoding, message types, reconnect rule, and ephemeral presence fields.
5. The browser opens the advertised websocket endpoint, sends a `sync_request`, broadcasts local Yjs updates, applies remote Yjs updates, and displays peer presence.
6. The browser can export a durable snapshot with `POST /api/workspaces/{workspace_id}/snapshots`.

This is intentionally a development sync shell, not a production collaboration service. The websocket endpoint keeps room membership, update replay, and presence in process memory so the portfolio can demonstrate the collaboration boundary before adding authorization, persistent update logs, or compaction.

## Sync Contract

The first realtime contract is documented in `SYNC_CONTRACT.md` and returned by the API. It defines:

- one websocket room per workspace using `workspace:{workspace_id}`
- base64url-encoded Yjs binary update messages
- ephemeral Yjs awareness presence fields
- reconnect behavior that restores IndexedDB before asking the sync server to replay in-memory updates
- snapshot offers as durable checkpoints, not live document ownership

## Why This Project Matters

This project demonstrates consistency models beyond normal CRUD. It gives strong interview material around collaboration, conflict handling, and offline-first design.
