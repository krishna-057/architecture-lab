import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const requiredFiles = [
  "package.json",
  ".env.example",
  "compose.yaml",
  "apps/camera/package.json",
  "apps/camera/src/app/page.tsx",
  "apps/camera/src/app/layout.tsx",
  "apps/camera/public/manifest.webmanifest",
  "apps/dashboard/package.json",
  "apps/dashboard/src/app/page.tsx",
  "apps/dashboard/src/app/layout.tsx",
  "db/schema.sql",
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

const composeFile = readFileSync("compose.yaml", "utf8");
if (!composeFile.includes("./.data/postgres:/var/lib/postgresql/data")) {
  throw new Error("compose.yaml must keep PostgreSQL data under ./.data/postgres.");
}

const schemaFile = readFileSync("db/schema.sql", "utf8");
if (!schemaFile.includes("detection_events")) {
  throw new Error("db/schema.sql must define detection_events.");
}

console.log("PocketSentinel scaffold check passed.");
