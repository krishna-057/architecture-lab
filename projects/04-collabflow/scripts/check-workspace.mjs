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
  "PORTFOLIO_SUMMARY.md",
  "docs/update-log-compaction.md",
  "docs/membership-authorization.md",
  "docs/signed-session-identity.md",
  "docs/scaling-notes.md"
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
  !appPage.includes("X-CollabFlow-User-Id") ||
  !appPage.includes("X-CollabFlow-CSRF") ||
  !appPage.includes('credentials: "include"') ||
  !appPage.includes("/api/session") ||
  !appPage.includes("Use Signed Session") ||
  !appPage.includes("Logout") ||
  !appPage.includes("/api/workspaces/${workspaceId}/invites") ||
  !appPage.includes("/api/workspaces/${workspaceId}/invites/${invite.invite_token}/resend-note") ||
  !appPage.includes("/api/invites/accept") ||
  !appPage.includes("Create Invite") ||
  !appPage.includes("Accept Invite") ||
  !appPage.includes("Note Resend") ||
  !appPage.includes("inviteAudit") ||
  !appPage.includes("/api/workspaces/${workspaceId}/members") ||
  !appPage.includes("updateMemberRole") ||
  !appPage.includes("removeMember") ||
  !appPage.includes("Members") ||
  !appPage.includes("NEXT_PUBLIC_COLLABFLOW_USER_ID") ||
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
  !apiFile.includes("collabflow_workspace_memberships") ||
  !apiFile.includes("MembershipResponse") ||
  !apiFile.includes("identity_from_headers") ||
  !apiFile.includes("require_membership") ||
  !apiFile.includes("/api/workspaces/{workspace_id}/members") ||
  !apiFile.includes("/api/workspaces/{workspace_id}/invites") ||
  !apiFile.includes("/api/workspaces/{workspace_id}/invites/{invite_token}/resend-note") ||
  !apiFile.includes("/api/invites/accept") ||
  !apiFile.includes("collabflow_workspace_invites") ||
  !apiFile.includes("COLLABFLOW_INVITE_TTL_HOURS") ||
  !apiFile.includes("InviteResponse") ||
  !apiFile.includes("ResendInviteRequest") ||
  !apiFile.includes("last_resend_note") ||
  !apiFile.includes("persist_invite") ||
  !apiFile.includes("collabflow_yjs_updates") ||
  !apiFile.includes("append_sync_update") ||
  !apiFile.includes("create_compaction_checkpoint") ||
  !apiFile.includes("sync_compaction_checkpoints") ||
  !apiFile.includes("compacted_through_seq") ||
  !apiFile.includes("COMPACTED_UPDATE_RETENTION_HOURS") ||
  !apiFile.includes("cleanup_compacted_updates") ||
  !apiFile.includes("update_hash") ||
  !apiFile.includes("durable_update_log") ||
  !apiFile.includes("COLLABFLOW_SESSION_SIGNING_SECRET") ||
  !apiFile.includes("COLLABFLOW_PREVIOUS_SESSION_SIGNING_SECRET") ||
  !apiFile.includes("COLLABFLOW_SESSION_TTL_DAYS") ||
  !apiFile.includes("COLLABFLOW_DEV_IDENTITY_HEADERS") ||
  !apiFile.includes('@app.post("/api/session"') ||
  !apiFile.includes('@app.delete("/api/session"') ||
  !apiFile.includes("issue_session_cookies") ||
  !apiFile.includes("clear_session_cookies") ||
  !apiFile.includes("identity_from_signed_session_token") ||
  !apiFile.includes("require_csrf_token") ||
  !apiFile.includes("identity_from_websocket_message")
) {
  throw new Error("API must expose workspace, websocket sync, sync-contract, optional PostgreSQL snapshots, and durable update-log boundaries.");
}

const schemaFile = readFileSync("db/schema.sql", "utf8");
if (
  !schemaFile.includes("collabflow_workspaces") ||
  !schemaFile.includes("collabflow_snapshots") ||
  !schemaFile.includes("collabflow_yjs_updates") ||
  !schemaFile.includes("collabflow_compaction_checkpoints") ||
  !schemaFile.includes("collabflow_workspace_memberships") ||
  !schemaFile.includes("collabflow_workspace_invites") ||
  !schemaFile.includes("resend_count") ||
  !schemaFile.includes("last_resend_note") ||
  !schemaFile.includes("idx_collabflow_workspace_invites_workspace") ||
  !schemaFile.includes("idx_collabflow_snapshots_workspace_created") ||
  !schemaFile.includes("idx_collabflow_yjs_updates_workspace_seq") ||
  !schemaFile.includes("idx_collabflow_yjs_updates_compacted_at") ||
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

const stylesFile = readFileSync("apps/web/src/app/styles.css", "utf8");
if (
  !stylesFile.includes(".member-row") ||
  !stylesFile.includes(".member-list") ||
  !stylesFile.includes(".invite-row") ||
  !stylesFile.includes(".invite-list")
) {
  throw new Error("Web styles must include stable member and invite audit rows.");
}

const syncContract = readFileSync("SYNC_CONTRACT.md", "utf8");
if (
  !syncContract.includes("workspace:{workspace_id}") ||
  !syncContract.includes("yjs_update") ||
  !syncContract.includes("awareness_update") ||
  !syncContract.includes("/ws/collabflow") ||
  !syncContract.includes("Presence is Yjs awareness state") ||
  !syncContract.includes("docs/membership-authorization.md") ||
  !syncContract.includes("docs/signed-session-identity.md") ||
  !syncContract.includes("docs/update-log-compaction.md")
) {
  throw new Error("SYNC_CONTRACT.md must define websocket rooms, Yjs updates, awareness presence, membership, and durable compaction references.");
}

const compactionNotes = readFileSync("docs/update-log-compaction.md", "utf8");
if (
  !compactionNotes.includes("collabflow_yjs_updates") ||
  !compactionNotes.includes("collabflow_compaction_checkpoints") ||
  !compactionNotes.includes("update_seq") ||
  !compactionNotes.includes("update_hash") ||
  !compactionNotes.includes("snapshot_update") ||
  !compactionNotes.includes("compacted_at") ||
  !compactionNotes.includes("retention cleanup") ||
  !compactionNotes.toLowerCase().includes("compaction checkpoint generation") ||
  !compactionNotes.includes("Awareness messages must never enter this log")
) {
  throw new Error("Update-log compaction notes must define durable Yjs replay, checkpoint, dedupe, and presence-exclusion rules.");
}

const membershipNotes = readFileSync("docs/membership-authorization.md", "utf8");
if (
  !membershipNotes.includes("X-CollabFlow-User-Id") ||
  !membershipNotes.includes("collabflow_workspace_memberships") ||
  !membershipNotes.includes("owner") ||
  !membershipNotes.includes("editor") ||
  !membershipNotes.includes("viewer") ||
  !membershipNotes.includes("Non-member workspace access: `404`") ||
  !membershipNotes.includes("POST /api/workspaces/{workspace_id}/invites") ||
  !membershipNotes.includes("GET /api/workspaces/{workspace_id}/invites") ||
  !membershipNotes.includes("POST /api/workspaces/{workspace_id}/invites/{invite_token}/resend-note") ||
  !membershipNotes.includes("POST /api/invites/accept") ||
  !membershipNotes.includes("only `editor` or `owner` may send `yjs_update`")
) {
  throw new Error("Membership authorization notes must define identity headers, roles, storage, privacy, and websocket update rules.");
}

const signedSessionNotes = readFileSync("docs/signed-session-identity.md", "utf8");
if (
  !signedSessionNotes.includes("collabflow_session") ||
  !signedSessionNotes.includes("COLLABFLOW_SESSION_SIGNING_SECRET") ||
  !signedSessionNotes.includes("collabflow_workspace_memberships") ||
  !signedSessionNotes.includes("X-CollabFlow-CSRF") ||
  !signedSessionNotes.includes("collabflow_csrf") ||
  !signedSessionNotes.includes("POST /api/session") ||
  !signedSessionNotes.includes("DELETE /api/session") ||
  !signedSessionNotes.includes("Do not trust a websocket `user_id` field") ||
  !signedSessionNotes.includes("COLLABFLOW_DEV_IDENTITY_HEADERS=true")
) {
  throw new Error("Signed session notes must define cookie identity, membership role lookup, CSRF, websocket trust, and dev-header fallback.");
}

const scalingNotes = readFileSync("docs/scaling-notes.md", "utf8");
if (
  !scalingNotes.includes("Websocket Fanout") ||
  !scalingNotes.includes("Durable Replay And Compaction") ||
  !scalingNotes.includes("Offline Conflicts") ||
  !scalingNotes.includes("Membership And Identity") ||
  !scalingNotes.includes("Production Readiness Checklist")
) {
  throw new Error("Scaling notes must define websocket, replay, offline, identity, and production-readiness tradeoffs.");
}

const portfolioSummary = readFileSync("PORTFOLIO_SUMMARY.md", "utf8");
if (
  !portfolioSummary.includes("What Is Complete") ||
  !portfolioSummary.includes("Main Interview Signals") ||
  !portfolioSummary.includes("What Is Intentionally Not Included") ||
  !portfolioSummary.includes("How To Demo") ||
  !portfolioSummary.includes("portfolio-complete")
) {
  throw new Error("Portfolio summary must describe completion, interview signals, non-goals, and demo flow.");
}

console.log("CollabFlow scaffold and sync contract check passed.");
