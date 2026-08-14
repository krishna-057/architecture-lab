import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const requiredFiles = [
  "package.json",
  ".env.example",
  "compose.yaml",
  "db/schema.sql",
  "apps/web/package.json",
  "apps/web/src/app/page.tsx",
  "apps/web/src/app/layout.tsx",
  "services/api/Dockerfile",
  "services/api/requirements.txt",
  "services/api/app/main.py",
  "SYNC_CONTRACT.md",
  "docs/update-log-compaction.md"
];

const rootPackage = JSON.parse(readFileSync("package.json", "utf8"));
if (!Array.isArray(rootPackage.workspaces) || !rootPackage.workspaces.includes("apps/*")) {
  throw new Error("Root package.json must declare apps/* workspaces.");
}

for (const file of requiredFiles) {
  if (!existsSync(join(process.cwd(), file))) {
    throw new Error(`Missing scaffold file: ${file}`);
  }
}

const webPackage = JSON.parse(readFileSync("apps/web/package.json", "utf8"));
if (!webPackage.dependencies?.yjs) {
  throw new Error("Web app must depend on Yjs for the first CRDT slice.");
}

const appPage = readFileSync("apps/web/src/app/page.tsx", "utf8");
if (
  !appPage.includes("new Y.Doc") ||
  !appPage.includes("indexedDB.open") ||
  !appPage.includes("new WebSocket") ||
  !appPage.includes("Y.applyUpdate") ||
  !appPage.includes("Y.encodeStateAsUpdate") ||
  !appPage.includes("state_vector") ||
  !appPage.includes("snapshot_update") ||
  !appPage.includes("/sync-contract") ||
  !appPage.includes("WebSocket Messages") ||
  !appPage.includes("Live Sync") ||
  !appPage.includes("Presence Fields") ||
  !appPage.includes("/snapshots") ||
  !appPage.includes("Export Snapshot")
) {
  throw new Error("Web app must exercise Yjs, IndexedDB, websocket sync, presence, and snapshot boundaries.");
}

const apiFile = readFileSync("services/api/app/main.py", "utf8");
if (
  !apiFile.includes("/api/workspaces") ||
  !apiFile.includes("/api/workspaces/{workspace_id}/sync-contract") ||
  !apiFile.includes("/api/workspaces/{workspace_id}/snapshots") ||
  !apiFile.includes('@app.websocket("/ws/collabflow")') ||
  !apiFile.includes("websocket_sync") ||
  !apiFile.includes("SYNC_WEBSOCKET_URL") ||
  !apiFile.includes("sync_update_log") ||
  !apiFile.includes("awareness_update") ||
  !apiFile.includes("presence_fields") ||
  !apiFile.includes("SNAPSHOT_STORE_PATH") ||
  !apiFile.includes("DATABASE_URL") ||
  !apiFile.includes("SNAPSHOT_STORAGE_MODE") ||
  !apiFile.includes("collabflow_snapshots") ||
  !apiFile.includes("collabflow_yjs_updates") ||
  !apiFile.includes("append_sync_update") ||
  !apiFile.includes("create_compaction_checkpoint") ||
  !apiFile.includes("sync_compaction_checkpoints") ||
  !apiFile.includes("compacted_through_seq") ||
  !apiFile.includes("update_hash") ||
  !apiFile.includes("durable_update_log")
) {
  throw new Error("API must expose workspace, websocket sync, sync-contract, optional PostgreSQL snapshots, and durable update-log boundaries.");
}

const schemaFile = readFileSync("db/schema.sql", "utf8");
if (
  !schemaFile.includes("collabflow_workspaces") ||
  !schemaFile.includes("collabflow_snapshots") ||
  !schemaFile.includes("collabflow_yjs_updates") ||
  !schemaFile.includes("collabflow_compaction_checkpoints") ||
  !schemaFile.includes("idx_collabflow_snapshots_workspace_created") ||
  !schemaFile.includes("idx_collabflow_yjs_updates_workspace_seq") ||
  !schemaFile.includes("update_hash") ||
  !schemaFile.includes("jsonb")
) {
  throw new Error("PostgreSQL schema must define workspace, snapshot, Yjs update, and compaction checkpoint tables.");
}

const composeFile = readFileSync("compose.yaml", "utf8");
if (
  !composeFile.includes("postgres:16-alpine") ||
  !composeFile.includes("./.data/postgres") ||
  !composeFile.includes("./db/schema.sql")
) {
  throw new Error("Compose stack must keep PostgreSQL state under the project .data folder.");
}

const syncContract = readFileSync("SYNC_CONTRACT.md", "utf8");
if (
  !syncContract.includes("workspace:{workspace_id}") ||
  !syncContract.includes("yjs_update") ||
  !syncContract.includes("awareness_update") ||
  !syncContract.includes("/ws/collabflow") ||
  !syncContract.includes("Presence is Yjs awareness state") ||
  !syncContract.includes("docs/update-log-compaction.md")
) {
  throw new Error("SYNC_CONTRACT.md must define websocket rooms, Yjs updates, awareness presence, and the durable compaction reference.");
}

const compactionNotes = readFileSync("docs/update-log-compaction.md", "utf8");
if (
  !compactionNotes.includes("collabflow_yjs_updates") ||
  !compactionNotes.includes("collabflow_compaction_checkpoints") ||
  !compactionNotes.includes("update_seq") ||
  !compactionNotes.includes("update_hash") ||
  !compactionNotes.includes("snapshot_update") ||
  !compactionNotes.includes("compacted_at") ||
  !compactionNotes.toLowerCase().includes("compaction checkpoint generation") ||
  !compactionNotes.includes("Awareness messages must never enter this log")
) {
  throw new Error("Update-log compaction notes must define durable Yjs replay, checkpoint, dedupe, and presence-exclusion rules.");
}

console.log("CollabFlow scaffold and sync contract check passed.");
