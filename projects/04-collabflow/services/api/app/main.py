import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal
from uuid import UUID, uuid4

from fastapi import FastAPI, HTTPException
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


class SyncContractResponse(BaseModel):
    workspace_id: UUID
    document_id: str
    local_persistence: Literal["indexeddb_snapshot"]
    crdt_runtime: Literal["yjs"]
    sync_transport: Literal["deferred_websocket"]
    durable_snapshot_endpoint: str
    presence_scope: str
    conflict_rule: str


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

workspaces: dict[UUID, WorkspaceResponse] = {}
snapshots: dict[UUID, list[SnapshotResponse]] = {}


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def model_as_json_dict(model: BaseModel) -> dict:
    if hasattr(model, "model_dump"):
        return model.model_dump(mode="json")
    return jsonable_encoder(model)


def load_snapshots() -> None:
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


def persist_snapshots() -> None:
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


def require_workspace(workspace_id: UUID) -> WorkspaceResponse:
    workspace = workspaces.get(workspace_id)
    if workspace is None:
        raise HTTPException(status_code=404, detail="Workspace not found.")
    return workspace


def sync_contract_for(workspace_id: UUID) -> SyncContractResponse:
    return SyncContractResponse(
        workspace_id=workspace_id,
        document_id=f"collabflow:{workspace_id}:workspace-doc",
        local_persistence="indexeddb_snapshot",
        crdt_runtime="yjs",
        sync_transport="deferred_websocket",
        durable_snapshot_endpoint=f"/api/workspaces/{workspace_id}/snapshots",
        presence_scope="Presence is ephemeral client state and is not written into document snapshots.",
        conflict_rule="Concurrent field and task edits are merged by Yjs updates; durable snapshots are exported checkpoints, not the source of truth.",
    )


load_snapshots()


@app.get("/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "storage": "file",
        "crdt_runtime": "yjs",
        "sync_transport": "deferred_websocket",
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
    persist_snapshots()
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
    persist_snapshots()
    return snapshot
