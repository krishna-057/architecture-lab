"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";

type Workspace = {
  workspace_id: string;
  name: string;
  status: "local_ready" | "sync_ready";
  created_at: string;
};

type SyncContract = {
  workspace_id: string;
  document_id: string;
  local_persistence: "indexeddb_snapshot";
  crdt_runtime: "yjs";
  sync_transport: "websocket_contract";
  websocket_endpoint: string;
  room_id: string;
  auth_mode: string;
  yjs_update_encoding: string;
  messages: {
    message_type: "sync_request" | "yjs_update" | "awareness_update" | "snapshot_offer";
    sender: "browser" | "sync_server";
    payload_encoding: string;
    durable: boolean;
    purpose: string;
  }[];
  presence_fields: {
    field: "client_id" | "display_name" | "cursor" | "selection" | "status" | "last_seen";
    required: boolean;
    retention: "ephemeral_awareness_only";
    purpose: string;
  }[];
  durable_snapshot_endpoint: string;
  presence_scope: string;
  conflict_rule: string;
  reconnect_rule: string;
};

type Snapshot = {
  snapshot_id: string;
  workspace_id: string;
  title: string;
  notes: string;
  tasks: string[];
  version_vector: number;
  created_at: string;
};

type LocalState = {
  title: string;
  notes: string;
  tasks: string[];
  versionVector: number;
};

const apiBaseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8300").replace(/\/$/, "");
const indexedDbName = "collabflow-local-first";
const indexedDbStore = "workspace-snapshots";

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers
    }
  });

  if (!response.ok) {
    throw new Error(`API request failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
}

function openWorkspaceDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(indexedDbName, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(indexedDbStore);
    };
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed."));
    request.onsuccess = () => resolve(request.result);
  });
}

async function readLocalSnapshot(workspaceId: string): Promise<LocalState | null> {
  const db = await openWorkspaceDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(indexedDbStore, "readonly");
    const request = transaction.objectStore(indexedDbStore).get(workspaceId);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB read failed."));
    request.onsuccess = () => resolve((request.result as LocalState | undefined) ?? null);
    transaction.oncomplete = () => db.close();
  });
}

async function writeLocalSnapshot(workspaceId: string, state: LocalState): Promise<void> {
  const db = await openWorkspaceDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(indexedDbStore, "readwrite");
    const request = transaction.objectStore(indexedDbStore).put(state, workspaceId);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB write failed."));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
  });
}

function formatClock(value: string) {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

export default function CollabFlowHome() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [contract, setContract] = useState<SyncContract | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [workspaceName, setWorkspaceName] = useState("Architecture Lab Board");
  const [title, setTitle] = useState("Local-first collaboration slice");
  const [notes, setNotes] = useState("Draft notes locally first. Export snapshots only when the boundary is explicit.");
  const [tasks, setTasks] = useState<string[]>([
    "Define shared document shape",
    "Persist local state before server sync",
    "Document CRDT tradeoffs"
  ]);
  const [taskDraft, setTaskDraft] = useState("Add presence contract");
  const [versionVector, setVersionVector] = useState(0);
  const [statusMessage, setStatusMessage] = useState("Create a workspace to initialize a local Yjs document.");
  const ydocRef = useRef<Y.Doc | null>(null);

  const workspaceId = workspace?.workspace_id;
  const taskCount = tasks.length;
  const latestSnapshot = snapshots.at(-1);

  const localState = useMemo<LocalState>(
    () => ({ title, notes, tasks, versionVector }),
    [notes, tasks, title, versionVector]
  );

  const syncFromYDoc = useCallback(() => {
    const doc = ydocRef.current;
    if (!doc) {
      return;
    }

    setTitle(doc.getText("title").toString());
    setNotes(doc.getText("notes").toString());
    setTasks(doc.getArray<string>("tasks").toArray());
    setVersionVector(Y.encodeStateVector(doc).length);
  }, []);

  const replaceYText = useCallback((field: "title" | "notes", value: string) => {
    const doc = ydocRef.current;
    if (!doc) {
      return;
    }

    doc.transact(() => {
      const text = doc.getText(field);
      text.delete(0, text.length);
      text.insert(0, value);
    });
    syncFromYDoc();
  }, [syncFromYDoc]);

  async function refreshSnapshots(targetWorkspaceId: string) {
    const nextSnapshots = await requestJson<Snapshot[]>(`/api/workspaces/${targetWorkspaceId}/snapshots`);
    setSnapshots(nextSnapshots);
  }

  async function createWorkspace() {
    setStatusMessage("Creating workspace boundary...");
    setSnapshots([]);

    try {
      const created = await requestJson<Workspace>("/api/workspaces", {
        method: "POST",
        body: JSON.stringify({ name: workspaceName })
      });
      const nextContract = await requestJson<SyncContract>(`/api/workspaces/${created.workspace_id}/sync-contract`);
      const doc = new Y.Doc();
      const saved = await readLocalSnapshot(created.workspace_id);
      const seed = saved ?? localState;

      doc.getText("title").insert(0, seed.title);
      doc.getText("notes").insert(0, seed.notes);
      doc.getArray<string>("tasks").push(seed.tasks);
      ydocRef.current = doc;
      setWorkspace(created);
      setContract(nextContract);
      setTitle(seed.title);
      setNotes(seed.notes);
      setTasks(seed.tasks);
      setVersionVector(Y.encodeStateVector(doc).length);
      await writeLocalSnapshot(created.workspace_id, seed);
      await refreshSnapshots(created.workspace_id);
      setStatusMessage(saved ? "Workspace restored from IndexedDB." : "Workspace ready with a new local Yjs document.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not create the workspace.");
    }
  }

  function addTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const task = taskDraft.trim();
    const doc = ydocRef.current;
    if (!doc || task.length === 0) {
      return;
    }

    doc.getArray<string>("tasks").push([task]);
    setTaskDraft("");
    syncFromYDoc();
  }

  function removeTask(index: number) {
    const doc = ydocRef.current;
    if (!doc) {
      return;
    }

    doc.getArray<string>("tasks").delete(index, 1);
    syncFromYDoc();
  }

  async function saveLocal() {
    if (!workspaceId) {
      return;
    }

    await writeLocalSnapshot(workspaceId, localState);
    setStatusMessage("Saved current Yjs projection into IndexedDB.");
  }

  async function exportSnapshot() {
    if (!workspaceId) {
      return;
    }

    setStatusMessage("Exporting durable snapshot...");
    try {
      const snapshot = await requestJson<Snapshot>(`/api/workspaces/${workspaceId}/snapshots`, {
        method: "POST",
        body: JSON.stringify({
          title,
          notes,
          tasks,
          version_vector: versionVector
        })
      });
      setSnapshots((current) => [...current, snapshot]);
      setStatusMessage("Snapshot exported through the API boundary.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not export the snapshot.");
    }
  }

  useEffect(() => {
    if (!workspaceId) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void writeLocalSnapshot(workspaceId, localState).catch(() => {
        setStatusMessage("Local IndexedDB save failed.");
      });
    }, 400);

    return () => window.clearTimeout(timeout);
  }, [localState, workspaceId]);

  return (
    <main className="workspace-shell">
      <section className="document-panel" aria-label="CollabFlow workspace document">
        <div className="topbar">
          <div>
            <span>CollabFlow</span>
            <strong>{workspace?.name ?? "New workspace"}</strong>
          </div>
          <button type="button" onClick={createWorkspace}>
            {workspace ? "New Workspace" : "Start"}
          </button>
        </div>

        <div className="workspace-strip" aria-label="Workspace status">
          <label>
            <span>Name</span>
            <input
              value={workspaceName}
              onChange={(event) => setWorkspaceName(event.target.value)}
              disabled={Boolean(workspace)}
              maxLength={80}
            />
          </label>
          <div>
            <span>CRDT</span>
            <strong>Yjs</strong>
          </div>
          <div>
            <span>Local store</span>
            <strong>IndexedDB</strong>
          </div>
          <div>
            <span>Tasks</span>
            <strong>{taskCount}</strong>
          </div>
          <div>
            <span>Vector bytes</span>
            <strong>{versionVector}</strong>
          </div>
        </div>

        <label className="field-block">
          <span>Document title</span>
          <input
            value={title}
            onChange={(event) => replaceYText("title", event.target.value)}
            disabled={!workspaceId}
          />
        </label>

        <label className="field-block">
          <span>Notes</span>
          <textarea
            value={notes}
            onChange={(event) => replaceYText("notes", event.target.value)}
            disabled={!workspaceId}
            rows={8}
          />
        </label>

        <section className="task-editor" aria-label="Shared tasks">
          <div className="section-header">
            <span>Shared task list</span>
            <strong>{taskCount} open</strong>
          </div>
          <form className="task-form" onSubmit={addTask}>
            <input
              value={taskDraft}
              onChange={(event) => setTaskDraft(event.target.value)}
              disabled={!workspaceId}
              placeholder="Add a task"
            />
            <button type="submit" disabled={!workspaceId || taskDraft.trim().length === 0}>
              Add
            </button>
          </form>
          <div className="task-list">
            {tasks.map((task, index) => (
              <article className="task-row" key={`${task}-${index}`}>
                <span>{task}</span>
                <button type="button" onClick={() => removeTask(index)} disabled={!workspaceId}>
                  Done
                </button>
              </article>
            ))}
          </div>
        </section>
      </section>

      <aside className="control-panel" aria-label="Sync and snapshot controls">
        <section className="panel-block">
          <div className="panel-header">
            <span>Sync Contract</span>
            <strong>{contract?.sync_transport.replace("_", " ") ?? "Not started"}</strong>
          </div>
          <p>
            {contract?.conflict_rule ??
              "The first slice proves local CRDT state and explicit snapshot export before adding a websocket provider."}
          </p>
          {contract ? (
            <dl className="contract-list">
              <div>
                <dt>Document</dt>
                <dd>{contract.document_id}</dd>
              </div>
              <div>
                <dt>Room</dt>
                <dd>{contract.room_id}</dd>
              </div>
              <div>
                <dt>WebSocket</dt>
                <dd>{contract.websocket_endpoint}</dd>
              </div>
              <div>
                <dt>Persistence</dt>
                <dd>{contract.local_persistence}</dd>
              </div>
              <div>
                <dt>Update encoding</dt>
                <dd>{contract.yjs_update_encoding}</dd>
              </div>
              <div>
                <dt>Presence</dt>
                <dd>{contract.presence_scope}</dd>
              </div>
            </dl>
          ) : null}
        </section>

        <section className="panel-block">
          <div className="panel-header">
            <span>WebSocket Messages</span>
            <strong>{contract?.messages.length ?? 0}</strong>
          </div>
          <div className="contract-card-list">
            {contract?.messages.map((message) => (
              <article className="contract-card" key={message.message_type}>
                <div>
                  <strong>{message.message_type}</strong>
                  <span>{message.sender}</span>
                </div>
                <p>
                  {message.payload_encoding} / {message.durable ? "durable" : "ephemeral"}
                </p>
              </article>
            )) ?? <p className="empty-state">Create a workspace to inspect message types.</p>}
          </div>
        </section>

        <section className="panel-block">
          <div className="panel-header">
            <span>Presence Fields</span>
            <strong>{contract?.presence_fields.length ?? 0}</strong>
          </div>
          <div className="presence-grid">
            {contract?.presence_fields.map((field) => (
              <div className="presence-pill" key={field.field}>
                <strong>{field.field}</strong>
                <span>{field.required ? "required" : "optional"}</span>
              </div>
            )) ?? <p className="empty-state">Presence is discovered from the sync contract.</p>}
          </div>
          {contract ? <p>{contract.reconnect_rule}</p> : null}
        </section>

        <section className="panel-block">
          <div className="panel-header">
            <span>Snapshot Boundary</span>
            <strong>{snapshots.length}</strong>
          </div>
          <div className="action-stack">
            <button type="button" onClick={saveLocal} disabled={!workspaceId}>
              Save Local
            </button>
            <button type="button" onClick={exportSnapshot} disabled={!workspaceId}>
              Export Snapshot
            </button>
          </div>
          {latestSnapshot ? (
            <p>
              Latest durable snapshot was exported at {formatClock(latestSnapshot.created_at)} with{" "}
              {latestSnapshot.tasks.length} tasks.
            </p>
          ) : (
            <p>No durable snapshots yet. Local IndexedDB saves happen automatically after edits.</p>
          )}
        </section>

        <section className="panel-block">
          <div className="panel-header">
            <span>History</span>
            <strong>{snapshots.length}</strong>
          </div>
          <div className="snapshot-list">
            {snapshots.length === 0 ? <p className="empty-state">No exported snapshots.</p> : null}
            {snapshots.map((snapshot) => (
              <article className="snapshot-row" key={snapshot.snapshot_id}>
                <div>
                  <strong>{snapshot.title}</strong>
                  <time>{formatClock(snapshot.created_at)}</time>
                </div>
                <span>
                  {snapshot.tasks.length} tasks / vector {snapshot.version_vector}
                </span>
              </article>
            ))}
          </div>
        </section>

        <section className="panel-block">
          <div className="panel-header">
            <span>Runtime</span>
            <strong>{apiBaseUrl}</strong>
          </div>
          <p>{statusMessage}</p>
        </section>
      </aside>
    </main>
  );
}
