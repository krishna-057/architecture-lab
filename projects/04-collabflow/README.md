# CollabFlow

CollabFlow is a local-first collaborative workspace for shared tasks, notes, and lightweight diagrams.

The current slice is a local-first workspace shell with a small realtime sync path:

- a Next.js app at `apps/web`
- a Yjs document for title, notes, and task-list state
- browser IndexedDB snapshots for offline persistence
- a FastAPI API at `services/api` for workspace metadata, sync contract discovery, websocket fanout, and durable snapshot export
- optional PostgreSQL snapshot storage when `DATABASE_URL` is configured, with JSON-file fallback for dependency-light local checks
- optional PostgreSQL Yjs update-log tables for durable replay when the API is running in PostgreSQL mode
- `SYNC_CONTRACT.md` plus API discovery for the websocket room, Yjs update, and presence contract
- `docs/update-log-compaction.md` for the next durable update-log and compaction design
- `docs/membership-authorization.md` for the workspace membership roles and route authorization contract
- `docs/signed-session-identity.md` for signed cookie identity, CSRF, websocket session binding, and the remaining account-management gaps

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
- `.data/postgres` stores PostgreSQL data when `docker compose up postgres` is used

Run the optional durable snapshot store:

```powershell
docker compose up postgres
$env:DATABASE_URL="postgresql://collabflow:collabflow@localhost:5544/collabflow"
npm run dev:api
```

## First Slice Behavior

1. The browser creates a workspace through `POST /api/workspaces`.
2. The browser initializes a Yjs document for the workspace title, notes, and tasks.
3. Edits update the Yjs document first, then the current projection is saved into IndexedDB.
4. The API exposes `GET /api/workspaces/{workspace_id}/sync-contract` so the UI can discover the websocket room, Yjs update encoding, message types, reconnect rule, and ephemeral presence fields.
5. The browser opens the advertised websocket endpoint, sends a `sync_request`, broadcasts local Yjs updates, applies remote Yjs updates, and displays peer presence.
6. The browser can export a durable snapshot with `POST /api/workspaces/{workspace_id}/snapshots`.

This is intentionally a development sync shell, not a production collaboration service. The websocket endpoint keeps room membership, update replay, and presence in process memory so the portfolio can demonstrate the collaboration boundary before adding authorization, persistent update logs, or compaction.

When `DATABASE_URL` is set, exported workspace snapshots are stored in PostgreSQL tables initialized from `db/schema.sql`. This makes durable checkpoints restart-safe without changing the live collaboration rule: Yjs and IndexedDB still own active editing, while the API stores explicit checkpoints for recovery/export.

Durable websocket update persistence now has its first storage boundary. In PostgreSQL mode, incoming `yjs_update` messages are written to an append-only `collabflow_yjs_updates` table with per-workspace sequence numbers and SHA-256 deduplication before being broadcast to peers. Snapshot export sends a compact Yjs state update and state vector from the browser; the API stores that as a `collabflow_compaction_checkpoints` row and marks update rows through the checkpoint sequence as compacted. File mode keeps the lightweight in-memory replay behavior for dependency-light local checks.

Compacted update rows are retained briefly before deletion. `COMPACTED_UPDATE_RETENTION_HOURS` defaults to `72`, and the API runs a small cleanup pass on PostgreSQL-mode startup. A later worker can call the same retention rule on a schedule when the sync service moves beyond single-process development.

Workspace authorization is enforced with signed session cookies or local development identity headers. The runtime creates an `owner` membership for the workspace creator, filters workspace lists by membership, protects snapshots and sync-contract reads, blocks viewer websocket document updates, and exposes owner-only member management endpoints.

Cookie-backed requests verify `collabflow_session`, require a matching `X-CollabFlow-CSRF` / `collabflow_csrf` double-submit token for mutations, and bind websocket joins to the verified session identity. `POST /api/session` and `DELETE /api/session` provide a local session lifecycle for the portfolio shell. The session supplies `user_id` and `display_name`; workspace roles still come from the membership table so permission changes apply immediately. Owners can create time-limited invite tokens for viewer/editor access, signed-in users can redeem them into memberships, and the web shell can list members, change roles, or remove members through the owner-only membership API. Password login, OAuth, registration, and email invite delivery remain deferred.

## Sync Contract

The first realtime contract is documented in `SYNC_CONTRACT.md` and returned by the API. It defines:

- one websocket room per workspace using `workspace:{workspace_id}`
- base64url-encoded Yjs binary update messages
- ephemeral Yjs awareness presence fields
- reconnect behavior that restores IndexedDB before asking the sync server to replay in-memory updates
- snapshot offers as durable checkpoints, not live document ownership
- future durable replay from compacted checkpoints plus append-only Yjs update tails

## Why This Project Matters

This project demonstrates consistency models beyond normal CRUD. It gives strong interview material around collaboration, conflict handling, and offline-first design.
