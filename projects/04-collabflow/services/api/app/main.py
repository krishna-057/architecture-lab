import base64
import binascii
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal
from uuid import UUID, uuid4

try:
    import psycopg
    from psycopg.rows import dict_row
except ImportError:  # pragma: no cover - optional durable mode dependency
    psycopg = None
    dict_row = None

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


CORS_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ALLOWED_ORIGINS", "http://localhost:3300").split(",")
    if origin.strip()
]

app = FastAPI(title="CollabFlow API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class CreateWorkspaceRequest(BaseModel):
    name: str = Field(default="Local-first workspace", min_length=1, max_length=80)


class WorkspaceResponse(BaseModel):
    workspace_id: UUID
    name: str
    status: Literal["local_ready", "sync_ready"]
    created_at: datetime


class SyncMessageContract(BaseModel):
    message_type: Literal["sync_request", "yjs_update", "awareness_update", "snapshot_offer"]
    sender: Literal["browser", "sync_server"]
    payload_encoding: str
    durable: bool
    purpose: str


class PresenceFieldContract(BaseModel):
    field: Literal["client_id", "display_name", "cursor", "selection", "status", "last_seen"]
    required: bool
    retention: Literal["ephemeral_awareness_only"]
    purpose: str


class SyncContractResponse(BaseModel):
    workspace_id: UUID
    document_id: str
    local_persistence: Literal["indexeddb_snapshot"]
    crdt_runtime: Literal["yjs"]
    sync_transport: Literal["websocket_sync"]
    websocket_endpoint: str
    room_id: str
    auth_mode: str
    yjs_update_encoding: str
    messages: list[SyncMessageContract]
    presence_fields: list[PresenceFieldContract]
    durable_snapshot_endpoint: str
    presence_scope: str
    conflict_rule: str
    reconnect_rule: str


class CreateSnapshotRequest(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    notes: str = Field(default="", max_length=5000)
    tasks: list[str] = Field(default_factory=list, max_length=100)
    version_vector: int = Field(ge=0)


class SnapshotResponse(BaseModel):
    snapshot_id: UUID
    workspace_id: UUID
    title: str
    notes: str
    tasks: list[str]
    version_vector: int
    created_at: datetime


PROJECT_ROOT = Path(__file__).resolve().parents[3]
snapshot_store_setting = os.getenv("SNAPSHOT_STORE_PATH", ".data/snapshots.json")
SNAPSHOT_STORE_PATH = Path(snapshot_store_setting)
if not SNAPSHOT_STORE_PATH.is_absolute():
    SNAPSHOT_STORE_PATH = PROJECT_ROOT / SNAPSHOT_STORE_PATH
SYNC_WEBSOCKET_URL = os.getenv("SYNC_WEBSOCKET_URL", "ws://localhost:8300/ws/collabflow")
DATABASE_URL = os.getenv("DATABASE_URL")
SNAPSHOT_STORAGE_MODE = "postgres" if DATABASE_URL and psycopg is not None else "file"

workspaces: dict[UUID, WorkspaceResponse] = {}
snapshots: dict[UUID, list[SnapshotResponse]] = {}
sync_update_log: dict[UUID, list[str]] = {}
sync_update_sequences: dict[UUID, int] = {}
sync_rooms: dict[str, set[WebSocket]] = {}
sync_connections: dict[WebSocket, dict[str, Any]] = {}
presence_by_room: dict[str, dict[str, dict[str, Any]]] = {}


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def model_as_json_dict(model: BaseModel) -> dict:
    if hasattr(model, "model_dump"):
        return model.model_dump(mode="json")
    return jsonable_encoder(model)


def postgres_connection():
    if not DATABASE_URL or psycopg is None:
        return None
    return psycopg.connect(DATABASE_URL, row_factory=dict_row)


def init_postgres_store() -> None:
    connection = postgres_connection()
    if connection is None:
        return

    with connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                create table if not exists collabflow_workspaces (
                  workspace_id uuid primary key,
                  name text not null,
                  status text not null check (status in ('local_ready', 'sync_ready')),
                  created_at timestamptz not null
                );
                """
            )
            cursor.execute(
                """
                create table if not exists collabflow_snapshots (
                  snapshot_id uuid primary key,
                  workspace_id uuid not null references collabflow_workspaces(workspace_id) on delete cascade,
                  title text not null,
                  notes text not null default '',
                  tasks jsonb not null default '[]'::jsonb,
                  version_vector integer not null check (version_vector >= 0),
                  created_at timestamptz not null
                );
                """
            )
            cursor.execute(
                """
                create index if not exists idx_collabflow_snapshots_workspace_created
                  on collabflow_snapshots(workspace_id, created_at);
                """
            )
            cursor.execute(
                """
                create table if not exists collabflow_yjs_updates (
                  update_id bigserial primary key,
                  workspace_id uuid not null references collabflow_workspaces(workspace_id) on delete cascade,
                  update_seq bigint not null,
                  update_bytes bytea not null,
                  update_hash text not null,
                  client_id text not null,
                  created_at timestamptz not null,
                  compacted_at timestamptz,
                  unique (workspace_id, update_seq),
                  unique (workspace_id, update_hash)
                );
                """
            )
            cursor.execute(
                """
                create table if not exists collabflow_compaction_checkpoints (
                  checkpoint_id uuid primary key,
                  workspace_id uuid not null references collabflow_workspaces(workspace_id) on delete cascade,
                  compacted_through_seq bigint not null,
                  state_vector bytea not null,
                  snapshot_update bytea not null,
                  created_at timestamptz not null
                );
                """
            )
            cursor.execute(
                """
                create index if not exists idx_collabflow_yjs_updates_workspace_seq
                  on collabflow_yjs_updates(workspace_id, update_seq);
                """
            )


def load_postgres_snapshots() -> None:
    connection = postgres_connection()
    if connection is None:
        return

    with connection:
        with connection.cursor() as cursor:
            cursor.execute("select workspace_id, name, status, created_at from collabflow_workspaces order by created_at")
            for row in cursor.fetchall():
                workspace = WorkspaceResponse(**row)
                workspaces[workspace.workspace_id] = workspace
                snapshots.setdefault(workspace.workspace_id, [])

            cursor.execute(
                """
                select snapshot_id, workspace_id, title, notes, tasks, version_vector, created_at
                from collabflow_snapshots
                order by created_at
                """
            )
            for row in cursor.fetchall():
                snapshot = SnapshotResponse(**row)
                snapshots.setdefault(snapshot.workspace_id, []).append(snapshot)

            cursor.execute(
                """
                select workspace_id, update_seq, encode(update_bytes, 'base64') as update_payload
                from collabflow_yjs_updates
                where compacted_at is null
                order by workspace_id, update_seq
                """
            )
            for row in cursor.fetchall():
                workspace_id = row["workspace_id"]
                sync_update_log.setdefault(workspace_id, []).append(base64_to_urlsafe(row["update_payload"]))
                sync_update_sequences[workspace_id] = max(
                    sync_update_sequences.get(workspace_id, 0),
                    int(row["update_seq"]),
                )


def load_file_snapshots() -> None:
    if not SNAPSHOT_STORE_PATH.exists():
        return

    try:
        raw_payload = json.loads(SNAPSHOT_STORE_PATH.read_text(encoding="utf8"))
    except (json.JSONDecodeError, OSError):
        return

    for raw_workspace in raw_payload.get("workspaces", []):
        workspace = WorkspaceResponse(**raw_workspace)
        workspaces[workspace.workspace_id] = workspace
        snapshots.setdefault(workspace.workspace_id, [])

    for raw_snapshot in raw_payload.get("snapshots", []):
        snapshot = SnapshotResponse(**raw_snapshot)
        snapshots.setdefault(snapshot.workspace_id, []).append(snapshot)


def persist_file_snapshots() -> None:
    SNAPSHOT_STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "workspaces": [
            model_as_json_dict(workspace)
            for workspace in sorted(workspaces.values(), key=lambda item: item.created_at)
        ],
        "snapshots": [
            model_as_json_dict(snapshot)
            for workspace_snapshots in snapshots.values()
            for snapshot in sorted(workspace_snapshots, key=lambda item: item.created_at)
        ],
    }
    tmp_path = SNAPSHOT_STORE_PATH.with_suffix(".tmp")
    tmp_path.write_text(json.dumps(payload, indent=2), encoding="utf8")
    tmp_path.replace(SNAPSHOT_STORE_PATH)


def load_snapshot_store() -> None:
    if SNAPSHOT_STORAGE_MODE == "postgres":
        init_postgres_store()
        load_postgres_snapshots()
        return

    load_file_snapshots()


def persist_workspace(workspace: WorkspaceResponse) -> None:
    if SNAPSHOT_STORAGE_MODE == "file":
        persist_file_snapshots()
        return

    connection = postgres_connection()
    if connection is None:
        return

    with connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                insert into collabflow_workspaces (workspace_id, name, status, created_at)
                values (%s, %s, %s, %s)
                on conflict (workspace_id) do update
                set name = excluded.name,
                    status = excluded.status
                """,
                (workspace.workspace_id, workspace.name, workspace.status, workspace.created_at),
            )


def persist_snapshot(snapshot: SnapshotResponse) -> None:
    if SNAPSHOT_STORAGE_MODE == "file":
        persist_file_snapshots()
        return

    connection = postgres_connection()
    if connection is None:
        return

    with connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                insert into collabflow_snapshots (
                  snapshot_id, workspace_id, title, notes, tasks, version_vector, created_at
                )
                values (%s, %s, %s, %s, %s::jsonb, %s, %s)
                on conflict (snapshot_id) do nothing
                """,
                (
                    snapshot.snapshot_id,
                    snapshot.workspace_id,
                    snapshot.title,
                    snapshot.notes,
                    json.dumps(snapshot.tasks),
                    snapshot.version_vector,
                    snapshot.created_at,
                ),
            )


def base64_to_urlsafe(value: str) -> str:
    return value.rstrip("=").replace("+", "-").replace("/", "_")


def urlsafe_to_bytes(value: str) -> bytes:
    padded_value = value + ("=" * ((4 - len(value) % 4) % 4))
    return base64.urlsafe_b64decode(padded_value.encode("ascii"))


def append_sync_update(workspace_id: UUID, client_id: str, encoded_update: str) -> int:
    if SNAPSHOT_STORAGE_MODE == "file":
        next_sequence = sync_update_sequences.get(workspace_id, 0) + 1
        sync_update_sequences[workspace_id] = next_sequence
        sync_update_log.setdefault(workspace_id, []).append(encoded_update)
        return next_sequence

    update_bytes = urlsafe_to_bytes(encoded_update)
    update_hash = hashlib.sha256(update_bytes).hexdigest()
    connection = postgres_connection()
    if connection is None:
        raise RuntimeError("PostgreSQL is required for durable sync update storage.")

    with connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                select update_seq from collabflow_yjs_updates
                where workspace_id = %s and update_hash = %s
                """,
                (workspace_id, update_hash),
            )
            existing = cursor.fetchone()
            if existing is not None:
                return int(existing["update_seq"])

            cursor.execute(
                "select coalesce(max(update_seq), 0) + 1 as next_sequence from collabflow_yjs_updates where workspace_id = %s",
                (workspace_id,),
            )
            next_sequence = int(cursor.fetchone()["next_sequence"])
            cursor.execute(
                """
                insert into collabflow_yjs_updates (
                  workspace_id, update_seq, update_bytes, update_hash, client_id, created_at
                )
                values (%s, %s, %s, %s, %s, %s)
                """,
                (workspace_id, next_sequence, update_bytes, update_hash, client_id, now_utc()),
            )

    sync_update_sequences[workspace_id] = max(sync_update_sequences.get(workspace_id, 0), next_sequence)
    current_updates = sync_update_log.setdefault(workspace_id, [])
    if encoded_update not in current_updates:
        current_updates.append(encoded_update)
    return next_sequence


def require_workspace(workspace_id: UUID) -> WorkspaceResponse:
    workspace = workspaces.get(workspace_id)
    if workspace is None:
        raise HTTPException(status_code=404, detail="Workspace not found.")
    return workspace


def mark_workspace_sync_ready(workspace_id: UUID) -> None:
    workspace = require_workspace(workspace_id)
    if workspace.status == "sync_ready":
        return

    if hasattr(workspace, "model_copy"):
        updated = workspace.model_copy(update={"status": "sync_ready"})
    else:
        updated = workspace.copy(update={"status": "sync_ready"})
    workspaces[workspace_id] = updated
    persist_workspace(updated)


def sync_contract_for(workspace_id: UUID) -> SyncContractResponse:
    room_id = f"workspace:{workspace_id}"
    return SyncContractResponse(
        workspace_id=workspace_id,
        document_id=f"collabflow:{workspace_id}:workspace-doc",
        local_persistence="indexeddb_snapshot",
        crdt_runtime="yjs",
        sync_transport="websocket_sync",
        websocket_endpoint=SYNC_WEBSOCKET_URL,
        room_id=room_id,
        auth_mode="development client identity header; signed workspace membership is deferred",
        yjs_update_encoding="base64url encoded Yjs binary update bytes",
        messages=[
            SyncMessageContract(
                message_type="sync_request",
                sender="browser",
                payload_encoding="json",
                durable=False,
                purpose="Join the workspace room and replay the server-held update log.",
            ),
            SyncMessageContract(
                message_type="yjs_update",
                sender="browser",
                payload_encoding="base64url",
                durable=True,
                purpose="Broadcast a Yjs document update to peers and append it to the in-memory development update log.",
            ),
            SyncMessageContract(
                message_type="awareness_update",
                sender="browser",
                payload_encoding="json",
                durable=False,
                purpose="Share cursor, selection, identity, and activity state through Yjs awareness.",
            ),
            SyncMessageContract(
                message_type="snapshot_offer",
                sender="sync_server",
                payload_encoding="json",
                durable=True,
                purpose="Tell clients that a compacted snapshot is available through the snapshot API.",
            ),
        ],
        presence_fields=[
            PresenceFieldContract(
                field="client_id",
                required=True,
                retention="ephemeral_awareness_only",
                purpose="Stable browser connection identifier for the current room session.",
            ),
            PresenceFieldContract(
                field="display_name",
                required=True,
                retention="ephemeral_awareness_only",
                purpose="Human-readable label shown in collaborator chips.",
            ),
            PresenceFieldContract(
                field="cursor",
                required=False,
                retention="ephemeral_awareness_only",
                purpose="Optional text cursor anchor inside the active document field.",
            ),
            PresenceFieldContract(
                field="selection",
                required=False,
                retention="ephemeral_awareness_only",
                purpose="Optional selected text or task range for live collaboration hints.",
            ),
            PresenceFieldContract(
                field="status",
                required=True,
                retention="ephemeral_awareness_only",
                purpose="Current activity state such as editing, idle, or offline grace period.",
            ),
            PresenceFieldContract(
                field="last_seen",
                required=True,
                retention="ephemeral_awareness_only",
                purpose="Client-sent timestamp used only for stale-presence cleanup.",
            ),
        ],
        durable_snapshot_endpoint=f"/api/workspaces/{workspace_id}/snapshots",
        presence_scope="Presence is ephemeral client state and is not written into document snapshots.",
        conflict_rule="Concurrent field and task edits are merged by Yjs updates; the development websocket server fans out updates, while durable snapshots remain exported checkpoints.",
        reconnect_rule="Clients reload IndexedDB first, reconnect to the room, send a sync_request, then apply missing Yjs updates before exporting new snapshots.",
    )


async def broadcast_to_room(room_id: str, payload: dict[str, Any], exclude: WebSocket | None = None) -> None:
    stale_connections: list[WebSocket] = []
    for connection in sync_rooms.get(room_id, set()).copy():
        if connection is exclude:
            continue
        try:
            await connection.send_json(payload)
        except RuntimeError:
            stale_connections.append(connection)

    for connection in stale_connections:
        remove_sync_connection(connection)


def remove_sync_connection(websocket: WebSocket) -> None:
    state = sync_connections.pop(websocket, None)
    if not state:
        return

    room_id = state["room_id"]
    client_id = state["client_id"]
    room_connections = sync_rooms.get(room_id)
    if room_connections is not None:
        room_connections.discard(websocket)
        if not room_connections:
            sync_rooms.pop(room_id, None)

    room_presence = presence_by_room.get(room_id)
    if room_presence is not None:
        room_presence.pop(client_id, None)
        if not room_presence:
            presence_by_room.pop(room_id, None)


def require_sync_connection(websocket: WebSocket) -> dict[str, Any]:
    state = sync_connections.get(websocket)
    if not state:
        raise ValueError("Send sync_request before other sync messages.")
    return state


load_snapshot_store()


@app.get("/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "storage": SNAPSHOT_STORAGE_MODE,
        "crdt_runtime": "yjs",
        "sync_transport": "websocket_sync",
    }


@app.post("/api/workspaces", response_model=WorkspaceResponse)
def create_workspace(payload: CreateWorkspaceRequest) -> WorkspaceResponse:
    workspace = WorkspaceResponse(
        workspace_id=uuid4(),
        name=payload.name,
        status="local_ready",
        created_at=now_utc(),
    )
    workspaces[workspace.workspace_id] = workspace
    snapshots[workspace.workspace_id] = []
    persist_workspace(workspace)
    return workspace


@app.get("/api/workspaces", response_model=list[WorkspaceResponse])
def list_workspaces() -> list[WorkspaceResponse]:
    return sorted(workspaces.values(), key=lambda workspace: workspace.created_at)


@app.get("/api/workspaces/{workspace_id}", response_model=WorkspaceResponse)
def get_workspace(workspace_id: UUID) -> WorkspaceResponse:
    return require_workspace(workspace_id)


@app.get("/api/workspaces/{workspace_id}/sync-contract", response_model=SyncContractResponse)
def get_sync_contract(workspace_id: UUID) -> SyncContractResponse:
    require_workspace(workspace_id)
    return sync_contract_for(workspace_id)


@app.websocket("/ws/collabflow")
async def collabflow_sync(websocket: WebSocket) -> None:
    await websocket.accept()

    try:
        while True:
            message = await websocket.receive_json()
            message_type = message.get("type")

            if message_type == "sync_request":
                workspace_id = UUID(str(message.get("workspace_id")))
                require_workspace(workspace_id)
                room_id = str(message.get("room_id"))
                expected_room_id = f"workspace:{workspace_id}"
                if room_id != expected_room_id:
                    await websocket.send_json(
                        {
                            "type": "sync_error",
                            "detail": "Room id does not match the workspace.",
                            "expected_room_id": expected_room_id,
                        }
                    )
                    continue

                client_id = str(message.get("client_id") or uuid4())
                display_name = str(message.get("display_name") or "Collaborator")
                sync_connections[websocket] = {
                    "workspace_id": workspace_id,
                    "room_id": room_id,
                    "client_id": client_id,
                }
                sync_rooms.setdefault(room_id, set()).add(websocket)
                mark_workspace_sync_ready(workspace_id)

                presence = {
                    "client_id": client_id,
                    "display_name": display_name,
                    "status": "editing",
                    "last_seen": now_utc().isoformat(),
                }
                presence_by_room.setdefault(room_id, {})[client_id] = presence

                await websocket.send_json(
                    {
                        "type": "sync_ready",
                        "workspace_id": str(workspace_id),
                        "room_id": room_id,
                        "client_id": client_id,
                        "peer_count": len(sync_rooms.get(room_id, set())),
                        "update_count": len(sync_update_log.get(workspace_id, [])),
                        "durable_update_log": SNAPSHOT_STORAGE_MODE == "postgres",
                        "latest_update_seq": sync_update_sequences.get(workspace_id, 0),
                    }
                )

                for update in sync_update_log.get(workspace_id, []):
                    await websocket.send_json(
                        {
                            "type": "yjs_update",
                            "workspace_id": str(workspace_id),
                            "room_id": room_id,
                            "update": update,
                            "sender": "sync_server",
                        }
                    )

                for peer_presence in presence_by_room.get(room_id, {}).values():
                    await websocket.send_json(
                        {
                            "type": "awareness_update",
                            "workspace_id": str(workspace_id),
                            "room_id": room_id,
                            "presence": peer_presence,
                            "sender": "sync_server",
                        }
                    )

                await broadcast_to_room(
                    room_id,
                    {
                        "type": "awareness_update",
                        "workspace_id": str(workspace_id),
                        "room_id": room_id,
                        "presence": presence,
                        "sender": "sync_server",
                    },
                    exclude=websocket,
                )
                continue

            state = require_sync_connection(websocket)
            workspace_id = state["workspace_id"]
            room_id = state["room_id"]
            client_id = state["client_id"]

            if message_type == "yjs_update":
                update = str(message.get("update") or "")
                if not update:
                    await websocket.send_json({"type": "sync_error", "detail": "Missing Yjs update."})
                    continue

                try:
                    update_seq = append_sync_update(workspace_id, client_id, update)
                except (RuntimeError, ValueError, TypeError, binascii.Error):
                    await websocket.send_json({"type": "sync_error", "detail": "Could not persist Yjs update."})
                    continue

                await broadcast_to_room(
                    room_id,
                    {
                        "type": "yjs_update",
                        "workspace_id": str(workspace_id),
                        "room_id": room_id,
                        "client_id": client_id,
                        "update": update,
                        "update_seq": update_seq,
                        "sender": "browser",
                        "received_at": now_utc().isoformat(),
                    },
                    exclude=websocket,
                )
                continue

            if message_type == "awareness_update":
                presence = dict(message.get("presence") or {})
                presence["client_id"] = client_id
                presence.setdefault("display_name", "Collaborator")
                presence.setdefault("status", "editing")
                presence["last_seen"] = now_utc().isoformat()
                presence_by_room.setdefault(room_id, {})[client_id] = presence
                await broadcast_to_room(
                    room_id,
                    {
                        "type": "awareness_update",
                        "workspace_id": str(workspace_id),
                        "room_id": room_id,
                        "presence": presence,
                        "sender": "sync_server",
                    },
                    exclude=websocket,
                )
                continue

            await websocket.send_json({"type": "sync_error", "detail": f"Unsupported sync message: {message_type}"})
    except (WebSocketDisconnect, ValueError):
        pass
    finally:
        state = sync_connections.get(websocket)
        remove_sync_connection(websocket)
        if state:
            await broadcast_to_room(
                state["room_id"],
                {
                    "type": "awareness_update",
                    "workspace_id": str(state["workspace_id"]),
                    "room_id": state["room_id"],
                    "presence": {
                        "client_id": state["client_id"],
                        "display_name": "Disconnected collaborator",
                        "status": "offline",
                        "last_seen": now_utc().isoformat(),
                    },
                    "sender": "sync_server",
                },
            )


@app.get("/api/workspaces/{workspace_id}/snapshots", response_model=list[SnapshotResponse])
def list_snapshots(workspace_id: UUID) -> list[SnapshotResponse]:
    require_workspace(workspace_id)
    return sorted(snapshots.get(workspace_id, []), key=lambda snapshot: snapshot.created_at)


@app.post("/api/workspaces/{workspace_id}/snapshots", response_model=SnapshotResponse)
def create_snapshot(workspace_id: UUID, payload: CreateSnapshotRequest) -> SnapshotResponse:
    require_workspace(workspace_id)
    snapshot = SnapshotResponse(
        snapshot_id=uuid4(),
        workspace_id=workspace_id,
        title=payload.title,
        notes=payload.notes,
        tasks=payload.tasks,
        version_vector=payload.version_vector,
        created_at=now_utc(),
    )
    snapshots.setdefault(workspace_id, []).append(snapshot)
    persist_snapshot(snapshot)
    return snapshot
