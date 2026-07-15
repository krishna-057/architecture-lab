import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const requiredFiles = [
  "package.json",
  ".env.example",
  "apps/camera/package.json",
  "apps/camera/src/app/page.tsx",
  "apps/camera/src/app/layout.tsx",
  "apps/camera/public/manifest.webmanifest",
  "apps/dashboard/package.json",
  "apps/dashboard/src/app/page.tsx",
  "apps/dashboard/src/app/layout.tsx",
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

console.log("PocketSentinel scaffold check passed.");
