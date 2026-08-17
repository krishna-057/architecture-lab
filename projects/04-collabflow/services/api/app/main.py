import base64
import binascii
import hashlib
import hmac
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal
from uuid import UUID, uuid4

try:
    import psycopg
    from psycopg.rows import dict_row
except ImportError:  # pragma: no cover - optional durable mode dependency
    psycopg = None
    dict_row = None

from fastapi import FastAPI, Header, HTTPException, Request, WebSocket, WebSocketDisconnect
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
    allow_credentials=True,
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


class WorkspaceIdentity(BaseModel):
    user_id: str
    display_name: str


class MembershipResponse(BaseModel):
    workspace_id: UUID
    user_id: str
    display_name: str
    role: Literal["owner", "editor", "viewer"]
    created_at: datetime
    updated_at: datetime


class CreateMembershipRequest(BaseModel):
    user_id: str = Field(min_length=1, max_length=120)
    display_name: str = Field(min_length=1, max_length=120)
    role: Literal["owner", "editor", "viewer"] = "viewer"


class UpdateMembershipRequest(BaseModel):
    role: Literal["owner", "editor", "viewer"]


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
    state_vector: str | None = Field(default=None, max_length=100000)
    snapshot_update: str | None = Field(default=None, max_length=5000000)


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
COMPACTED_UPDATE_RETENTION_HOURS = int(os.getenv("COMPACTED_UPDATE_RETENTION_HOURS", "72"))
COLLABFLOW_SESSION_COOKIE_NAME = os.getenv("COLLABFLOW_SESSION_COOKIE_NAME", "collabflow_session")
COLLABFLOW_CSRF_COOKIE_NAME = os.getenv("COLLABFLOW_CSRF_COOKIE_NAME", "collabflow_csrf")
COLLABFLOW_SESSION_SIGNING_SECRET = os.getenv("COLLABFLOW_SESSION_SIGNING_SECRET", "")
COLLABFLOW_PREVIOUS_SESSION_SIGNING_SECRET = os.getenv("COLLABFLOW_PREVIOUS_SESSION_SIGNING_SECRET", "")
COLLABFLOW_DEV_IDENTITY_HEADERS = os.getenv("COLLABFLOW_DEV_IDENTITY_HEADERS", "true").lower() in {
    "1",
    "true",
    "yes",
    "on",
}

workspaces: dict[UUID, WorkspaceResponse] = {}
memberships: dict[UUID, dict[str, MembershipResponse]] = {}
snapshots: dict[UUID, list[SnapshotResponse]] = {}
sync_update_log: dict[UUID, list[str]] = {}
sync_update_sequences: dict[UUID, int] = {}
sync_compaction_checkpoints: dict[UUID, dict[str, Any]] = {}
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
            cursor.execute(
                """
                create index if not exists idx_collabflow_yjs_updates_compacted_at
                  on collabflow_yjs_updates(compacted_at)
                  where compacted_at is not null;
                """
            )
            cursor.execute(
                """
                create table if not exists collabflow_workspace_memberships (
                  workspace_id uuid not null references collabflow_workspaces(workspace_id) on delete cascade,
                  user_id text not null,
                  display_name text not null,
                  role text not null check (role in ('owner', 'editor', 'viewer')),
                  created_at timestamptz not null,
                  updated_at timestamptz not null,
                  primary key (workspace_id, user_id)
                );
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
                select workspace_id, user_id, display_name, role, created_at, updated_at
                from collabflow_workspace_memberships
                order by created_at
                """
            )
            for row in cursor.fetchall():
                membership = MembershipResponse(**row)
                memberships.setdefault(membership.workspace_id, {})[membership.user_id] = membership

            cursor.execute(
                """
                select distinct on (workspace_id)
                  checkpoint_id,
                  workspace_id,
                  compacted_through_seq,
                  encode(snapshot_update, 'base64') as snapshot_update
                from collabflow_compaction_checkpoints
                order by workspace_id, created_at desc
                """
            )
            for row in cursor.fetchall():
                workspace_id = row["workspace_id"]
                sync_compaction_checkpoints[workspace_id] = {
                    "checkpoint_id": str(row["checkpoint_id"]),
                    "compacted_through_seq": int(row["compacted_through_seq"]),
                    "snapshot_update": base64_to_urlsafe(row["snapshot_update"]),
                }
                sync_update_sequences[workspace_id] = max(
                    sync_update_sequences.get(workspace_id, 0),
                    int(row["compacted_through_seq"]),
                )

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

    for raw_membership in raw_payload.get("memberships", []):
        membership = MembershipResponse(**raw_membership)
        memberships.setdefault(membership.workspace_id, {})[membership.user_id] = membership


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
        "memberships": [
            model_as_json_dict(membership)
            for workspace_memberships in memberships.values()
            for membership in sorted(workspace_memberships.values(), key=lambda item: item.created_at)
        ],
    }
    tmp_path = SNAPSHOT_STORE_PATH.with_suffix(".tmp")
    tmp_path.write_text(json.dumps(payload, indent=2), encoding="utf8")
    tmp_path.replace(SNAPSHOT_STORE_PATH)


def load_snapshot_store() -> None:
    if SNAPSHOT_STORAGE_MODE == "postgres":
        init_postgres_store()
        load_postgres_snapshots()
        cleanup_compacted_updates()
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


def persist_membership(membership: MembershipResponse) -> None:
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
                insert into collabflow_workspace_memberships (
                  workspace_id, user_id, display_name, role, created_at, updated_at
                )
                values (%s, %s, %s, %s, %s, %s)
                on conflict (workspace_id, user_id) do update
                set display_name = excluded.display_name,
                    role = excluded.role,
                    updated_at = excluded.updated_at
                """,
                (
                    membership.workspace_id,
                    membership.user_id,
                    membership.display_name,
                    membership.role,
                    membership.created_at,
                    membership.updated_at,
                ),
            )


def delete_membership(workspace_id: UUID, user_id: str) -> None:
    memberships.get(workspace_id, {}).pop(user_id, None)
    if SNAPSHOT_STORAGE_MODE == "file":
        persist_file_snapshots()
        return

    connection = postgres_connection()
    if connection is None:
        return

    with connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "delete from collabflow_workspace_memberships where workspace_id = %s and user_id = %s",
                (workspace_id, user_id),
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


def create_compaction_checkpoint(
    workspace_id: UUID,
    compacted_through_seq: int,
    state_vector: str | None,
    snapshot_update: str | None,
) -> UUID | None:
    if SNAPSHOT_STORAGE_MODE != "postgres" or not state_vector or not snapshot_update or compacted_through_seq <= 0:
        return None

    connection = postgres_connection()
    if connection is None:
        raise RuntimeError("PostgreSQL is required for compaction checkpoint generation.")

    checkpoint_id = uuid4()
    state_vector_bytes = urlsafe_to_bytes(state_vector)
    snapshot_update_bytes = urlsafe_to_bytes(snapshot_update)

    with connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                insert into collabflow_compaction_checkpoints (
                  checkpoint_id, workspace_id, compacted_through_seq, state_vector, snapshot_update, created_at
                )
                values (%s, %s, %s, %s, %s, %s)
                """,
                (
                    checkpoint_id,
                    workspace_id,
                    compacted_through_seq,
                    state_vector_bytes,
                    snapshot_update_bytes,
                    now_utc(),
                ),
            )
            cursor.execute(
                """
                update collabflow_yjs_updates
                set compacted_at = coalesce(compacted_at, %s)
                where workspace_id = %s
                  and update_seq <= %s
                  and compacted_at is null
                """,
                (now_utc(), workspace_id, compacted_through_seq),
            )

    sync_compaction_checkpoints[workspace_id] = {
        "checkpoint_id": str(checkpoint_id),
        "compacted_through_seq": compacted_through_seq,
        "snapshot_update": snapshot_update,
    }
    sync_update_log[workspace_id] = []
    sync_update_sequences[workspace_id] = max(sync_update_sequences.get(workspace_id, 0), compacted_through_seq)
    return checkpoint_id


def cleanup_compacted_updates(retention_hours: int = COMPACTED_UPDATE_RETENTION_HOURS) -> int:
    if SNAPSHOT_STORAGE_MODE != "postgres":
        return 0

    connection = postgres_connection()
    if connection is None:
        return 0

    cutoff = now_utc() - timedelta(hours=retention_hours)
    with connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                delete from collabflow_yjs_updates
                where compacted_at is not null
                  and compacted_at < %s
                """,
                (cutoff,),
            )
            return int(cursor.rowcount or 0)


def require_workspace(workspace_id: UUID) -> WorkspaceResponse:
    workspace = workspaces.get(workspace_id)
    if workspace is None:
        raise HTTPException(status_code=404, detail="Workspace not found.")
    return workspace


def bytes_to_urlsafe(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def signed_session_secrets() -> list[str]:
    return [
        secret
        for secret in [COLLABFLOW_SESSION_SIGNING_SECRET, COLLABFLOW_PREVIOUS_SESSION_SIGNING_SECRET]
        if secret
    ]


def identity_from_signed_session_token(token: str | None) -> WorkspaceIdentity | None:
    if not token:
        return None

    try:
        encoded_payload, encoded_signature = token.split(".", 1)
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid workspace session.")

    secrets = signed_session_secrets()
    if not secrets:
        raise HTTPException(status_code=401, detail="Workspace sessions are not configured.")

    signed_value = encoded_payload.encode("ascii")
    valid_signature = False
    for secret in secrets:
        expected_signature = hmac.new(secret.encode("utf8"), signed_value, hashlib.sha256).digest()
        if hmac.compare_digest(bytes_to_urlsafe(expected_signature), encoded_signature):
            valid_signature = True
            break

    if not valid_signature:
        raise HTTPException(status_code=401, detail="Invalid workspace session.")

    try:
        payload = json.loads(urlsafe_to_bytes(encoded_payload).decode("utf8"))
    except (binascii.Error, json.JSONDecodeError, UnicodeDecodeError):
        raise HTTPException(status_code=401, detail="Invalid workspace session.")

    expires_at = payload.get("expires_at")
    try:
        expires_at_datetime = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid workspace session.")
    if expires_at_datetime <= now_utc():
        raise HTTPException(status_code=401, detail="Workspace session expired.")

    user_id = str(payload.get("user_id") or "").strip()
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid workspace session.")
    display_name = str(payload.get("display_name") or user_id).strip() or user_id
    return WorkspaceIdentity(user_id=user_id, display_name=display_name)


def identity_from_headers(
    x_collabflow_user_id: str | None,
    x_collabflow_display_name: str | None,
) -> WorkspaceIdentity:
    if not COLLABFLOW_DEV_IDENTITY_HEADERS:
        raise HTTPException(status_code=401, detail="Missing workspace session.")
    user_id = x_collabflow_user_id.strip() if isinstance(x_collabflow_user_id, str) else ""
    if not user_id:
        raise HTTPException(status_code=401, detail="Missing workspace identity.")
    display_name = (
        x_collabflow_display_name.strip()
        if isinstance(x_collabflow_display_name, str) and x_collabflow_display_name.strip()
        else user_id
    )
    return WorkspaceIdentity(user_id=user_id, display_name=display_name)


def identity_from_request(
    request: Request,
    x_collabflow_user_id: str | None,
    x_collabflow_display_name: str | None,
) -> WorkspaceIdentity:
    session_identity = identity_from_signed_session_token(request.cookies.get(COLLABFLOW_SESSION_COOKIE_NAME))
    if session_identity is not None:
        return session_identity
    return identity_from_headers(x_collabflow_user_id, x_collabflow_display_name)


def require_csrf_token(request: Request, x_collabflow_csrf: str | None) -> None:
    if not request.cookies.get(COLLABFLOW_SESSION_COOKIE_NAME):
        return

    cookie_token = request.cookies.get(COLLABFLOW_CSRF_COOKIE_NAME)
    header_token = x_collabflow_csrf.strip() if isinstance(x_collabflow_csrf, str) else ""
    if not cookie_token or not header_token or not hmac.compare_digest(cookie_token, header_token):
        raise HTTPException(status_code=403, detail="Missing or invalid CSRF token.")


def identity_from_websocket_message(websocket: WebSocket, message: dict[str, Any]) -> WorkspaceIdentity:
    session_identity = identity_from_signed_session_token(websocket.cookies.get(COLLABFLOW_SESSION_COOKIE_NAME))
    if session_identity is not None:
        return session_identity

    user_id = str(message.get("user_id") or "").strip()
    display_name = str(message.get("display_name") or user_id).strip()
    return identity_from_headers(user_id, display_name)


def get_membership(workspace_id: UUID, user_id: str) -> MembershipResponse | None:
    return memberships.get(workspace_id, {}).get(user_id)


def role_rank(role: str) -> int:
    return {"viewer": 1, "editor": 2, "owner": 3}[role]


def require_membership(workspace_id: UUID, identity: WorkspaceIdentity, minimum_role: str) -> MembershipResponse:
    require_workspace(workspace_id)
    membership = get_membership(workspace_id, identity.user_id)
    if membership is None:
        raise HTTPException(status_code=404, detail="Workspace not found.")
    if role_rank(membership.role) < role_rank(minimum_role):
        raise HTTPException(status_code=403, detail="Insufficient workspace role.")
    return membership


def owner_count(workspace_id: UUID) -> int:
    return sum(1 for membership in memberships.get(workspace_id, {}).values() if membership.role == "owner")


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
        auth_mode="signed session cookie with CSRF for mutating HTTP routes; development identity headers are local fallback only",
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
        "compacted_update_retention_hours": str(COMPACTED_UPDATE_RETENTION_HOURS),
        "session_auth": "signed_cookie",
        "dev_identity_headers": str(COLLABFLOW_DEV_IDENTITY_HEADERS).lower(),
    }


@app.post("/api/workspaces", response_model=WorkspaceResponse)
def create_workspace(
    request: Request,
    payload: CreateWorkspaceRequest,
    x_collabflow_user_id: str | None = Header(default=None),
    x_collabflow_display_name: str | None = Header(default=None),
    x_collabflow_csrf: str | None = Header(default=None),
) -> WorkspaceResponse:
    require_csrf_token(request, x_collabflow_csrf)
    identity = identity_from_request(request, x_collabflow_user_id, x_collabflow_display_name)
    workspace = WorkspaceResponse(
        workspace_id=uuid4(),
        name=payload.name,
        status="local_ready",
        created_at=now_utc(),
    )
    workspaces[workspace.workspace_id] = workspace
    snapshots[workspace.workspace_id] = []
    memberships[workspace.workspace_id] = {
        identity.user_id: MembershipResponse(
            workspace_id=workspace.workspace_id,
            user_id=identity.user_id,
            display_name=identity.display_name,
            role="owner",
            created_at=workspace.created_at,
            updated_at=workspace.created_at,
        )
    }
    persist_workspace(workspace)
    persist_membership(memberships[workspace.workspace_id][identity.user_id])
    return workspace


@app.get("/api/workspaces", response_model=list[WorkspaceResponse])
def list_workspaces(
    request: Request,
    x_collabflow_user_id: str | None = Header(default=None),
    x_collabflow_display_name: str | None = Header(default=None),
) -> list[WorkspaceResponse]:
    identity = identity_from_request(request, x_collabflow_user_id, x_collabflow_display_name)
    visible_workspace_ids = [
        workspace_id
        for workspace_id, workspace_memberships in memberships.items()
        if identity.user_id in workspace_memberships
    ]
    return sorted(
        [workspaces[workspace_id] for workspace_id in visible_workspace_ids if workspace_id in workspaces],
        key=lambda workspace: workspace.created_at,
    )


@app.get("/api/workspaces/{workspace_id}", response_model=WorkspaceResponse)
def get_workspace(
    request: Request,
    workspace_id: UUID,
    x_collabflow_user_id: str | None = Header(default=None),
    x_collabflow_display_name: str | None = Header(default=None),
) -> WorkspaceResponse:
    identity = identity_from_request(request, x_collabflow_user_id, x_collabflow_display_name)
    require_membership(workspace_id, identity, "viewer")
    return require_workspace(workspace_id)


@app.get("/api/workspaces/{workspace_id}/sync-contract", response_model=SyncContractResponse)
def get_sync_contract(
    request: Request,
    workspace_id: UUID,
    x_collabflow_user_id: str | None = Header(default=None),
    x_collabflow_display_name: str | None = Header(default=None),
) -> SyncContractResponse:
    identity = identity_from_request(request, x_collabflow_user_id, x_collabflow_display_name)
    require_membership(workspace_id, identity, "viewer")
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
                try:
                    identity = identity_from_websocket_message(websocket, message)
                except HTTPException as error:
                    await websocket.send_json({"type": "sync_error", "detail": error.detail})
                    continue
                membership = get_membership(workspace_id, identity.user_id)
                if membership is None:
                    await websocket.send_json({"type": "sync_error", "detail": "Workspace not found."})
                    continue
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
                display_name = membership.display_name
                sync_connections[websocket] = {
                    "workspace_id": workspace_id,
                    "room_id": room_id,
                    "client_id": client_id,
                    "user_id": identity.user_id,
                    "role": membership.role,
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
                        "role": membership.role,
                        "peer_count": len(sync_rooms.get(room_id, set())),
                        "update_count": len(sync_update_log.get(workspace_id, [])),
                        "durable_update_log": SNAPSHOT_STORAGE_MODE == "postgres",
                        "latest_update_seq": sync_update_sequences.get(workspace_id, 0),
                        "checkpoint_id": sync_compaction_checkpoints.get(workspace_id, {}).get("checkpoint_id"),
                        "compacted_through_seq": sync_compaction_checkpoints.get(workspace_id, {}).get(
                            "compacted_through_seq",
                            0,
                        ),
                    }
                )

                checkpoint = sync_compaction_checkpoints.get(workspace_id)
                if checkpoint is not None:
                    await websocket.send_json(
                        {
                            "type": "yjs_update",
                            "workspace_id": str(workspace_id),
                            "room_id": room_id,
                            "update": checkpoint["snapshot_update"],
                            "checkpoint_id": checkpoint["checkpoint_id"],
                            "compacted_through_seq": checkpoint["compacted_through_seq"],
                            "sender": "sync_server",
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
                if role_rank(str(state.get("role", "viewer"))) < role_rank("editor"):
                    await websocket.send_json({"type": "sync_error", "detail": "Insufficient workspace role."})
                    continue
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
def list_snapshots(
    request: Request,
    workspace_id: UUID,
    x_collabflow_user_id: str | None = Header(default=None),
    x_collabflow_display_name: str | None = Header(default=None),
) -> list[SnapshotResponse]:
    identity = identity_from_request(request, x_collabflow_user_id, x_collabflow_display_name)
    require_membership(workspace_id, identity, "viewer")
    return sorted(snapshots.get(workspace_id, []), key=lambda snapshot: snapshot.created_at)


@app.post("/api/workspaces/{workspace_id}/snapshots", response_model=SnapshotResponse)
def create_snapshot(
    request: Request,
    workspace_id: UUID,
    payload: CreateSnapshotRequest,
    x_collabflow_user_id: str | None = Header(default=None),
    x_collabflow_display_name: str | None = Header(default=None),
    x_collabflow_csrf: str | None = Header(default=None),
) -> SnapshotResponse:
    require_csrf_token(request, x_collabflow_csrf)
    identity = identity_from_request(request, x_collabflow_user_id, x_collabflow_display_name)
    require_membership(workspace_id, identity, "editor")
    compacted_through_seq = sync_update_sequences.get(workspace_id, 0)
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
    try:
        create_compaction_checkpoint(
            workspace_id,
            compacted_through_seq,
            payload.state_vector,
            payload.snapshot_update,
        )
    except (RuntimeError, ValueError, TypeError, binascii.Error):
        raise HTTPException(status_code=422, detail="Could not create compaction checkpoint.")
    return snapshot


@app.get("/api/workspaces/{workspace_id}/members", response_model=list[MembershipResponse])
def list_members(
    request: Request,
    workspace_id: UUID,
    x_collabflow_user_id: str | None = Header(default=None),
    x_collabflow_display_name: str | None = Header(default=None),
) -> list[MembershipResponse]:
    identity = identity_from_request(request, x_collabflow_user_id, x_collabflow_display_name)
    require_membership(workspace_id, identity, "viewer")
    return sorted(memberships.get(workspace_id, {}).values(), key=lambda membership: membership.created_at)


@app.post("/api/workspaces/{workspace_id}/members", response_model=MembershipResponse)
def create_member(
    request: Request,
    workspace_id: UUID,
    payload: CreateMembershipRequest,
    x_collabflow_user_id: str | None = Header(default=None),
    x_collabflow_display_name: str | None = Header(default=None),
    x_collabflow_csrf: str | None = Header(default=None),
) -> MembershipResponse:
    require_csrf_token(request, x_collabflow_csrf)
    identity = identity_from_request(request, x_collabflow_user_id, x_collabflow_display_name)
    require_membership(workspace_id, identity, "owner")
    now = now_utc()
    existing = get_membership(workspace_id, payload.user_id)
    membership = MembershipResponse(
        workspace_id=workspace_id,
        user_id=payload.user_id,
        display_name=payload.display_name,
        role=payload.role,
        created_at=existing.created_at if existing is not None else now,
        updated_at=now,
    )
    memberships.setdefault(workspace_id, {})[payload.user_id] = membership
    persist_membership(membership)
    return membership


@app.patch("/api/workspaces/{workspace_id}/members/{user_id}", response_model=MembershipResponse)
def update_member(
    request: Request,
    workspace_id: UUID,
    user_id: str,
    payload: UpdateMembershipRequest,
    x_collabflow_user_id: str | None = Header(default=None),
    x_collabflow_display_name: str | None = Header(default=None),
    x_collabflow_csrf: str | None = Header(default=None),
) -> MembershipResponse:
    require_csrf_token(request, x_collabflow_csrf)
    identity = identity_from_request(request, x_collabflow_user_id, x_collabflow_display_name)
    require_membership(workspace_id, identity, "owner")
    current = get_membership(workspace_id, user_id)
    if current is None:
        raise HTTPException(status_code=404, detail="Workspace member not found.")
    if current.role == "owner" and payload.role != "owner" and owner_count(workspace_id) <= 1:
        raise HTTPException(status_code=409, detail="Workspace must keep at least one owner.")

    if hasattr(current, "model_copy"):
        updated = current.model_copy(update={"role": payload.role, "updated_at": now_utc()})
    else:
        updated = current.copy(update={"role": payload.role, "updated_at": now_utc()})
    memberships[workspace_id][user_id] = updated
    persist_membership(updated)
    return updated


@app.delete("/api/workspaces/{workspace_id}/members/{user_id}")
def remove_member(
    request: Request,
    workspace_id: UUID,
    user_id: str,
    x_collabflow_user_id: str | None = Header(default=None),
    x_collabflow_display_name: str | None = Header(default=None),
    x_collabflow_csrf: str | None = Header(default=None),
) -> dict[str, str]:
    require_csrf_token(request, x_collabflow_csrf)
    identity = identity_from_request(request, x_collabflow_user_id, x_collabflow_display_name)
    require_membership(workspace_id, identity, "owner")
    current = get_membership(workspace_id, user_id)
    if current is None:
        raise HTTPException(status_code=404, detail="Workspace member not found.")
    if current.role == "owner" and owner_count(workspace_id) <= 1:
        raise HTTPException(status_code=409, detail="Workspace must keep at least one owner.")
    delete_membership(workspace_id, user_id)
    return {"status": "removed"}
