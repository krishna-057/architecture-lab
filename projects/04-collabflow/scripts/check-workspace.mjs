import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const requiredFiles = [
  "package.json",
  ".env.example",
  "apps/web/package.json",
  "apps/web/src/app/page.tsx",
  "apps/web/src/app/layout.tsx",
  "services/api/Dockerfile",
  "services/api/requirements.txt",
  "services/api/app/main.py",
  "SYNC_CONTRACT.md"
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
  !apiFile.includes("SNAPSHOT_STORE_PATH")
) {
  throw new Error("API must expose workspace, websocket sync, sync-contract, and snapshot boundaries.");
}

const syncContract = readFileSync("SYNC_CONTRACT.md", "utf8");
if (
  !syncContract.includes("workspace:{workspace_id}") ||
  !syncContract.includes("yjs_update") ||
  !syncContract.includes("awareness_update") ||
  !syncContract.includes("/ws/collabflow") ||
  !syncContract.includes("Presence is Yjs awareness state")
) {
  throw new Error("SYNC_CONTRACT.md must define websocket rooms, Yjs updates, and awareness presence.");
}

console.log("CollabFlow scaffold and sync contract check passed.");
