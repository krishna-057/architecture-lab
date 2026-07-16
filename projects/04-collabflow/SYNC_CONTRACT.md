# CollabFlow Sync And Presence Contract

This contract defines the first realtime boundary for CollabFlow without implementing the websocket server yet. The browser remains local-first: it loads IndexedDB first, edits a Yjs document, and exports snapshots explicitly through FastAPI.

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

This is a contract endpoint for the next implementation slice. The current FastAPI app does not accept websocket connections yet.

## Message Types

| Type | Sender | Encoding | Durable | Purpose |
| --- | --- | --- | --- | --- |
| `sync_request` | Browser | JSON | No | Join the workspace room and request the current server-held update clock. |
| `yjs_update` | Browser | Base64url Yjs binary update bytes | Yes | Broadcast document changes to peers; a future server may append or compact updates. |
| `awareness_update` | Browser | JSON | No | Share cursor, selection, identity, and activity state through Yjs awareness. |
| `snapshot_offer` | Sync server | JSON | Yes | Tell clients that a compacted snapshot is available through the snapshot API. |

Durable messages affect document recovery or compaction. Ephemeral messages are connection state only.

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
4. Apply missing Yjs updates from the sync server.
5. Resume local edits and export durable snapshots only after the Yjs document catches up.

## Deferred Until Implementation

- Signed workspace membership and authorization.
- Websocket fanout, backpressure, and heartbeat handling.
- Update log storage and compaction.
- Multi-device conflict tests against a running sync provider.
