# CollabFlow Portfolio Summary

CollabFlow is a local-first collaborative workspace for shared notes and tasks. It demonstrates CRDT document ownership, offline-first persistence, websocket sync, durable replay checkpoints, and workspace authorization without pretending to be a full enterprise collaboration suite.

## What Is Complete

- Next.js workspace shell with title, notes, and task-list editing.
- Browser-owned Yjs document state.
- IndexedDB local persistence for offline continuity.
- FastAPI workspace metadata and sync-contract discovery.
- Native websocket room for Yjs update fanout and awareness presence.
- Explicit snapshot export path.
- Optional PostgreSQL storage for workspaces, snapshots, memberships, invites, Yjs update logs, and compaction checkpoints.
- Browser-assisted compaction checkpoints and retention cleanup for compacted updates.
- Signed cookie sessions with CSRF protection for mutating cookie-backed requests.
- Workspace membership roles: `owner`, `editor`, and `viewer`.
- Role enforcement across HTTP routes and websocket document updates.
- Invite token creation, acceptance, audit listing, and resend-note recording.
- Member listing, role changes, removal, and last-owner protection.
- Architecture, decision, sync contract, membership, signed-session, compaction, scaling, and interview notes.

## Main Interview Signals

### Local-First Collaboration

The browser owns the Yjs document and can keep working from IndexedDB before network sync catches up. This is the core distinction from a CRUD workspace that saves whole documents with last-write-wins behavior.

### Durable Boundaries

Snapshots and Yjs updates are separate. Snapshots are explicit durable checkpoints. Yjs update logs are replay tails. Presence is ephemeral and never belongs in durable document history.

### Authorization Across Protocols

Workspace roles are checked on both HTTP and websocket paths. Viewers can read and send awareness, but only editors and owners can append durable document updates or export snapshots.

### Pragmatic Scope Control

The project uses signed local sessions to prove cookie verification, CSRF, and websocket session binding without adding account recovery, OAuth providers, billing, or email infrastructure.

## What Is Intentionally Not Included

- Password registration or OAuth.
- Email invite delivery.
- Multi-region deployment.
- Dedicated websocket cluster.
- Rich text editor.
- Organization-wide directory and billing.
- Full append-only product audit stream.

These are real production concerns, but adding them during the portfolio lab would dilute the collaboration architecture signal.

## How To Demo

1. Start the API and web app.
2. Issue a signed session from the browser shell.
3. Create a workspace and edit the local document.
4. Open another browser profile or tab with a second session.
5. Create and redeem an invite token.
6. Show member role changes and viewer write blocking.
7. Export a snapshot and explain the checkpoint boundary.
8. Point to `docs/scaling-notes.md` for the next production steps.

## Final State

CollabFlow is portfolio-complete for the 30-day architecture lab. The remaining work is production hardening, not missing architecture proof. The project can now be presented as a focused local-first collaboration system with clear tradeoffs and documented next steps.
