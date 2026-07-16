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
  "services/api/app/main.py"
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
  !appPage.includes("/sync-contract") ||
  !appPage.includes("/snapshots") ||
  !appPage.includes("Export Snapshot")
) {
  throw new Error("Web app must exercise Yjs, IndexedDB, sync contract, and snapshot boundaries.");
}

const apiFile = readFileSync("services/api/app/main.py", "utf8");
if (
  !apiFile.includes("/api/workspaces") ||
  !apiFile.includes("/api/workspaces/{workspace_id}/sync-contract") ||
  !apiFile.includes("/api/workspaces/{workspace_id}/snapshots") ||
  !apiFile.includes("deferred_websocket") ||
  !apiFile.includes("SNAPSHOT_STORE_PATH")
) {
  throw new Error("API must expose workspace, sync-contract, and snapshot boundaries.");
}

console.log("CollabFlow scaffold check passed.");
