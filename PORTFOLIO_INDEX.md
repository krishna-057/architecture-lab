# Full-Stack Architecture Portfolio Index

This lab contains five focused projects. Each project is built to defend one architecture edge in an interview without pretending to be a production company in miniature.

## Recommended Demo Order

1. **FlashReserve** - start with the clearest backend consistency story: hot inventory, Redis reservations, PostgreSQL durability, expiry workers, idempotent order confirmation, and live stock updates.
2. **HookRelay** - move to reliability engineering: webhook ingestion, HMAC signing, idempotency, retries, failure classification, replay, delivery search, exports, alert routing, and notification audit.
3. **CollabFlow** - show collaboration depth: browser-owned Yjs state, IndexedDB offline persistence, websocket sync, presence, durable update logs, compaction checkpoints, signed sessions, invites, and member authorization.
4. **PocketSentinel** - show realtime product creativity: phone camera capture, WebRTC offer/answer, dashboard stream rendering, and detection event ingestion while keeping raw video in the browser.
5. **PersonaBridge** - close with AI product judgment: personal sessions, chat shell, realtime room-token contract, memory candidates, deletion controls, and approval-gated sensitive actions.

This order starts with the most operationally concrete backend systems, then moves into collaboration, realtime media, and AI. It gives interviewers a smooth path from transactional correctness to product-facing realtime/AI decisions.

## Project Map

| Project | Private Repo | Source Folder | Primary Signal | Portfolio State |
| --- | --- | --- | --- | --- |
| FlashReserve | `https://github.com/krishna-057/FlashReserve` | `projects/01-flashreserve` | Race conditions, reservation consistency, Redis/PostgreSQL split | Core architecture slice complete |
| PocketSentinel | `https://github.com/krishna-057/PocketSentinel` | `projects/02-pocketsentinel` | WebRTC signaling, browser camera lifecycle, detection ingestion | Prototype architecture slice complete |
| PersonaBridge | `https://github.com/krishna-057/PersonaBridge` | `projects/03-personabridge` | Realtime AI contracts, memory consent, approval gates | Contract and shell slice complete |
| CollabFlow | `https://github.com/krishna-057/CollabFlow` | `projects/04-collabflow` | CRDT collaboration, offline-first sync, websocket authorization | Portfolio-complete for lab scope |
| HookRelay | `https://github.com/krishna-057/HookRelay` | `projects/05-hookrelay` | Webhook reliability, retries, HMAC, replay, observability | Production-shaped architecture slice complete |

## Interview Positioning

### FlashReserve

Lead with:

- Why reservations are separate from orders.
- How Redis owns fast stock coordination while PostgreSQL owns durable business state.
- How the expiry worker and order confirmation path avoid stranded or oversold inventory.
- Why duplicate confirmation returns the existing order.

Avoid overclaiming:

- It does not include real payment processing, multi-region inventory, or a full admin backoffice.

### HookRelay

Lead with:

- How idempotency keys, delivery attempts, and replay records prevent duplicate ambiguity.
- Why HMAC signing and receiver verification are part of the delivery contract.
- How retry jitter, failure classification, alert routing, acknowledgement, and notification retries create an operator workflow.
- Why PostgreSQL stores durable history while BullMQ/Redis handle scheduling.

Avoid overclaiming:

- It does not include full tenant billing, long-retention analytics, or OpenTelemetry exporters.

### CollabFlow

Lead with:

- Why the browser owns Yjs state and IndexedDB restores local work before sync catches up.
- Why presence is ephemeral while snapshots and update logs are durable.
- How signed sessions and workspace roles are enforced across HTTP and websocket writes.
- Why compaction checkpoints reduce replay cost without inventing a second merge model.

Avoid overclaiming:

- It does not include OAuth, email invite delivery, a websocket cluster, or a rich text editor.

### PocketSentinel

Lead with:

- Why WebRTC keeps media peer-oriented while FastAPI owns only pairing and signaling.
- Why camera permission is user-triggered and tracks are explicitly stopped.
- Why the detection ingestion contract stores events, not raw video frames.
- How the current motion detector can be replaced by YOLO/ONNX behind the same event API.

Avoid overclaiming:

- It does not include production TURN, model downloads, GPU inference, or mobile app packaging.

### PersonaBridge

Lead with:

- Why realtime room and memory contracts came before external provider credentials.
- How memory consent controls candidate generation and deletion.
- How approval decisions are recorded before future sensitive tool execution.
- Why session, realtime token, memory, and approval boundaries are separate.

Avoid overclaiming:

- It does not include real model calls, OAuth, paid external tools, or vector retrieval productionization.

## Cross-Project Themes

- **State ownership is explicit.** Redis, PostgreSQL, IndexedDB, Yjs, BullMQ, and browser media streams each have named responsibilities.
- **Realtime is scoped.** WebSocket, WebRTC, and realtime AI room contracts are introduced only where they support the project signal.
- **Durability and ephemerality are separated.** Presence, video frames, and room status are not treated like business records.
- **Authorization is shown at boundaries.** Projects document where identity, roles, approval, and signatures are enforced.
- **Deferred work is named.** Each project lists production hardening as follow-up work instead of hiding missing scope.

## Final Demo Checklist

- Open the private project repository first, then the matching source folder in this lab if context is needed.
- Show the README and architecture/decision notes before code.
- Run the lightweight project check script where available.
- Demo one happy-path workflow per project.
- End each project with its intentional non-goals and next production step.

The portfolio is strongest when presented as five architecture proofs, not as five unfinished SaaS products.
