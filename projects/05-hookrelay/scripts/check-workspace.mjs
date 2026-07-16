import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const requiredFiles = [
  "package.json",
  ".env.example",
  "DELIVERY_CONTRACT.md",
  "apps/web/package.json",
  "apps/web/src/app/page.tsx",
  "apps/web/src/app/layout.tsx",
  "services/api/package.json",
  "services/api/Dockerfile",
  "services/api/src/server.js"
];

for (const file of requiredFiles) {
  if (!existsSync(join(process.cwd(), file))) {
    throw new Error(`Missing scaffold file: ${file}`);
  }
}

const rootPackage = JSON.parse(readFileSync("package.json", "utf8"));
if (
  !Array.isArray(rootPackage.workspaces) ||
  !rootPackage.workspaces.includes("apps/*") ||
  !rootPackage.workspaces.includes("services/*")
) {
  throw new Error("Root package.json must declare apps/* and services/* workspaces.");
}

const apiPackage = JSON.parse(readFileSync("services/api/package.json", "utf8"));
if (!apiPackage.dependencies?.fastify) {
  throw new Error("HookRelay API must use Fastify for the first HTTP delivery boundary.");
}

const apiFile = readFileSync("services/api/src/server.js", "utf8");
for (const marker of [
  "/api/endpoints",
  "/api/events",
  "/api/deliveries",
  "/api/delivery-contract",
  "HookRelay-Signature",
  "idempotency_key",
  "replay",
  "retry_policy"
]) {
  if (!apiFile.includes(marker)) {
    throw new Error(`API is missing required marker: ${marker}`);
  }
}

const webFile = readFileSync("apps/web/src/app/page.tsx", "utf8");
for (const marker of [
  "/api/endpoints",
  "/api/events",
  "/api/deliveries",
  "/api/delivery-contract",
  "Idempotency Key",
  "Signature Preview",
  "Replay"
]) {
  if (!webFile.includes(marker)) {
    throw new Error(`Web app is missing required marker: ${marker}`);
  }
}

const contract = readFileSync("DELIVERY_CONTRACT.md", "utf8");
for (const marker of ["HMAC", "Retry Policy", "Replay Rule", "idempotency_key", "HookRelay-Signature"]) {
  if (!contract.includes(marker)) {
    throw new Error(`Delivery contract is missing required marker: ${marker}`);
  }
}

console.log("HookRelay scaffold check passed.");
