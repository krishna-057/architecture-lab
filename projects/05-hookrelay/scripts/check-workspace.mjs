import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const requiredFiles = [
  "package.json",
  ".env.example",
  "compose.yaml",
  "DELIVERY_CONTRACT.md",
  "db/schema.sql",
  "apps/web/package.json",
  "apps/web/src/app/page.tsx",
  "apps/web/src/app/layout.tsx",
  "services/api/package.json",
  "services/api/Dockerfile",
  "services/api/src/server.js",
  "services/api/src/app.js",
  "services/api/src/storage.js",
  "services/api/src/observability.js",
  "services/api/src/producer-auth.js",
  "services/api/src/rate-limiter.js",
  "services/api/src/retry-policy.js",
  "services/api/src/delivery-queue.js",
  "services/api/src/delivery-runner.js",
  "services/api/src/worker.js"
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

for (const dependency of ["pg", "bullmq", "ioredis"]) {
  if (!apiPackage.dependencies?.[dependency]) {
    throw new Error(`HookRelay API is missing required durable boundary dependency: ${dependency}`);
  }
}

const apiFile = [
  "services/api/src/app.js",
  "services/api/src/storage.js",
  "services/api/src/observability.js",
  "services/api/src/producer-auth.js",
  "services/api/src/rate-limiter.js",
  "services/api/src/retry-policy.js",
  "services/api/src/delivery-queue.js",
  "services/api/src/delivery-runner.js",
  "services/api/src/worker.js"
].map((file) => readFileSync(file, "utf8")).join("\n");
for (const marker of [
  "/api/endpoints",
  "/api/events",
  "/api/deliveries",
  "/api/delivery-contract",
  "/api/receiver-verification-example",
  "/api/observability/spans",
  "/api/producer-api-keys",
  "/api/producer-api-keys/:key_id/rotate",
  "/api/producer-api-keys/:key_id/revoke",
  "HookRelay-Signature",
  "Producer API key is required",
  "owner_scoped_api_key",
  "owner_scoped_operator_api_key",
  "producerRoles",
  "replayRoles",
  "required_roles",
  "role must be producer, operator, or admin",
  "owner_id",
  "hashProducerApiKey",
  "rotateProducerApiKey",
  "revokeProducerApiKey",
  "rotated_from_key_id",
  "revoked_at",
  "trace_id",
  "span_id",
  "Endpoint rate limit exceeded",
  "hookrelay.endpoint.rate_limit",
  "rate_limit_per_minute",
  "Retry-After",
  "hookrelay.delivery.process",
  "buildReceiverVerificationExample",
  "idempotency_key",
  "replay_authorization",
  "Replay reason",
  "replay",
  "jitter_ratio",
  "calculateRetrySchedule",
  "retry_policy",
  "new Pool",
  "new Queue",
  "new Worker",
  "dead_letter"
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
  "/api/receiver-verification-example",
  "/api/observability/spans",
  "/api/producer-api-keys",
  "Producer Auth",
  "Rotate",
  "Revoke",
  "operator",
  "admin",
  "owner_id",
  "Rate Limit",
  "rate_limit_per_minute",
  "Idempotency Key",
  "Observability",
  "Receiver Verification",
  "Replay Auth",
  "Retry Jitter",
  "Signature Preview",
  "Replay"
]) {
  if (!webFile.includes(marker)) {
    throw new Error(`Web app is missing required marker: ${marker}`);
  }
}

const contract = readFileSync("DELIVERY_CONTRACT.md", "utf8");
for (const marker of [
  "HMAC",
  "Retry Policy",
  "Jitter",
  "Replay Rule",
  "Replay Authorization",
  "Receiver Verification",
  "Observability",
  "Rate Limit",
  "Producer API Key",
  "rotated",
  "revoked",
  "operator",
  "admin",
  "required_roles",
  "owner_id",
  "idempotency_key",
  "HookRelay-Signature"
]) {
  if (!contract.includes(marker)) {
    throw new Error(`Delivery contract is missing required marker: ${marker}`);
  }
}

const schema = readFileSync("db/schema.sql", "utf8");
for (const marker of [
  "webhook_endpoints",
  "webhook_events",
  "delivery_attempts",
  "unique (endpoint_id, idempotency_key)",
  "dead_letter",
  "replay_reason",
  "replay_requested_by",
  "base_delay_seconds",
  "jitter_seconds",
  "scheduled_delay_seconds",
  "delivery_observability_spans",
  "producer_api_keys",
  "owner_id",
  "role",
  "rotated_from_key_id",
  "revoked_at",
  "rate_limit_per_minute"
]) {
  if (!schema.includes(marker)) {
    throw new Error(`PostgreSQL schema is missing required marker: ${marker}`);
  }
}

const compose = readFileSync("compose.yaml", "utf8");
for (const marker of ["postgres:16-alpine", "redis:7-alpine", "./.data/postgres", "./.data/redis", "worker:"]) {
  if (!compose.includes(marker)) {
    throw new Error(`Compose stack is missing required marker: ${marker}`);
  }
}

console.log("HookRelay scaffold check passed.");
