# CollabFlow Sync And Presence Contract

This contract defines the first realtime boundary for CollabFlow. The browser remains local-first: it loads IndexedDB first, edits a Yjs document, syncs Yjs updates through a development websocket room, and exports snapshots explicitly through FastAPI.

## Room Identity

Each workspace maps to one sync room:

```text
workspace:{workspace_id}
```

The Yjs document identity stays stable across reconnects:

```text
collabflow:{workspace_id}:workspace-doc
```

The API exposes these values through:

```text
GET /api/workspaces/{workspace_id}/sync-contract
```

## WebSocket Endpoint

The advertised endpoint is configured by `SYNC_WEBSOCKET_URL` and defaults to:

```text
ws://localhost:8300/ws/collabflow
```

The current FastAPI app accepts this websocket endpoint. It validates the workspace room, replays in-memory Yjs updates for the workspace, broadcasts new Yjs updates to other connected browsers, and fans out ephemeral presence.

## Message Types

| Type | Sender | Encoding | Durable | Purpose |
| --- | --- | --- | --- | --- |
| `sync_request` | Browser | JSON | No | Join the workspace room and request the current server-held update log. |
| `yjs_update` | Browser | Base64url Yjs binary update bytes | Yes | Broadcast document changes to peers and append them to the in-memory development update log. |
| `awareness_update` | Browser | JSON | No | Share cursor, selection, identity, and activity state through Yjs awareness. |
| `snapshot_offer` | Sync server | JSON | Yes | Tell clients that a compacted snapshot is available through the snapshot API. |

Durable messages affect document recovery or compaction. Ephemeral messages are connection state only.

Exported snapshots are stored in PostgreSQL when `DATABASE_URL` is configured and in `.data/snapshots.json` otherwise. Yjs update replay is still in-memory in this development shell; durable update logs and compaction remain separate follow-up work.

The development server also sends operational control messages:

| Type | Sender | Purpose |
| --- | --- | --- |
| `sync_ready` | Sync server | Confirms the room join and reports peer and replay counts. |
| `sync_error` | Sync server | Reports invalid room ids, missing updates, or unsupported message types. |

## Presence Shape

Presence is Yjs awareness state, not document state.

| Field | Required | Retention | Purpose |
| --- | --- | --- | --- |
| `client_id` | Yes | Ephemeral awareness only | Stable browser connection identifier for the current room session. |
| `display_name` | Yes | Ephemeral awareness only | Human-readable collaborator label. |
| `cursor` | No | Ephemeral awareness only | Optional cursor anchor inside the active document field. |
| `selection` | No | Ephemeral awareness only | Optional selected text or task range. |
| `status` | Yes | Ephemeral awareness only | Current activity state such as editing, idle, or offline grace period. |
| `last_seen` | Yes | Ephemeral awareness only | Client timestamp used for stale-presence cleanup. |

Presence must not be written into exported snapshots because it describes who is currently connected, not workspace content.

## Reconnect Rule

Clients should:

1. Load the latest local IndexedDB projection.
2. Reconnect to the workspace room.
3. Send `sync_request`.
4. Apply missing in-memory Yjs updates from the sync server.
5. Resume local edits and export durable snapshots only after the Yjs document catches up.

## Deferred Until Later Slices

- Signed workspace membership and authorization.
- Backpressure and heartbeat handling.
- Durable update log storage and compaction.
- Multi-device conflict tests against a running sync provider.
