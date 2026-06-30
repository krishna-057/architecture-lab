import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const requiredFiles = [
  "package.json",
  "apps/api/package.json",
  "apps/api/src/main.ts",
  "apps/api/src/app.module.ts",
  "apps/api/src/reservations/reservations.module.ts",
  "apps/web/package.json",
  "apps/web/src/app/page.tsx",
  "apps/web/src/app/layout.tsx"
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

console.log("FlashReserve scaffold check passed.");
