# 30-Day Full-Stack Architecture Portfolio Lab

This repository is a 30-day build plan for five interview-grade full-stack projects. Each project is designed to prove practical engineering judgment: architecture choices, tradeoffs, system design depth, and the ability to ship without overengineering.

The goal is not to create five oversized production companies in miniature. The goal is to build five focused, defensible applications that a 3-5 year experienced developer could explain confidently in interviews.

## Core Principles

1. Build vertical slices before expanding features.
2. Prefer simple architecture until a real bottleneck appears.
3. Document why each major choice was made.
4. Include rejected alternatives, not just final decisions.
5. Keep local development reproducible with Docker Compose where useful.
6. Every project must have interview notes and scaling notes.
7. Avoid fake microservices unless service boundaries are the subject of the project.
8. Keep deployment optional during the first 30 days.

## The Five Projects

| Project | Theme | Main Interview Signal | Primary Architecture Edge |
| --- | --- | --- | --- |
| FlashReserve | High-concurrency flash sale and inventory reservation | Race conditions, consistency, queues | Redis reservations, transactional persistence, async workers |
| PocketSentinel | Phone-as-CCTV object detection | WebRTC, AI inference, realtime UX | Browser camera streaming, object detection events |
| PersonaBridge | Personal AI partner with chat and calls | Realtime AI, memory, permissions | WebRTC voice, tool approvals, long-term memory |
| CollabFlow | Local-first collaborative workspace | CRDTs, sync, conflict handling | Yjs collaboration, offline-first state |
| HookRelay | Webhook delivery platform | Network reliability, retries, observability | Idempotency, HMAC signatures, queues, replay |

## 30-Day Schedule

### Days 1-6: FlashReserve

Build a high-concurrency flash sale app with inventory reservation, checkout timer, queue-backed order finalization, and live stock updates.

Deliverables:
- Product and architecture README
- API and data model
- Reservation flow
- Redis-backed stock/reservation layer
- Worker for reservation expiry and order confirmation
- WebSocket stock updates
- Tests for core race-condition paths

### Days 7-12: PocketSentinel

Build a browser-based phone camera system that streams video to a dashboard and produces object detection events.

Deliverables:
- PWA camera sender
- Web dashboard viewer
- WebRTC signaling flow
- Object detection pipeline
- Event timeline
- Privacy and edge-vs-server inference tradeoff notes

### Days 13-18: PersonaBridge

Build a personal AI partner that supports chat, voice/video room interaction, memory, and permission-gated actions.

Deliverables:
- Chat interface
- Voice/video room
- Realtime AI integration plan
- Memory model
- Approval workflow for sensitive actions
- Interview notes on WebRTC vs WebSocket vs polling

### Days 19-24: CollabFlow

Build a local-first collaborative workspace with shared docs/tasks, presence, offline persistence, and conflict-free sync.

Deliverables:
- Collaborative editor or workspace canvas
- Presence indicators
- Offline persistence
- Sync server
- Snapshot/export path
- CRDT decision notes

### Days 25-30: HookRelay

Build a webhook delivery and replay platform with signed requests, retry policies, delivery logs, and dead-letter handling.

Deliverables:
- Endpoint management
- Event ingestion
- Delivery worker
- HMAC signing
- Retry/backoff system
- Replay and dead-letter queue
- Observability notes

## Daily Work Contract

Each work session should:

1. Read `MASTER_PLAN.md`, `WORKFLOW.md`, and the target project's docs.
2. Pick one small, valuable task.
3. Build a vertical slice or strengthen documentation/tests.
4. Run available checks.
5. Update progress notes.
6. Commit with a clear message.
7. Push or prepare for push, depending on credentials and branch policy.

## Documentation Standard

Every project README must answer:

- What problem are we solving?
- Who is the target user?
- Why this tech stack?
- Why this architecture?
- What alternatives did we reject?
- What are the key failure modes?
- How does the system scale?
- What would I explain in an interview?
- What is intentionally not included to avoid overengineering?

## Branching And Git Policy

The portfolio projects are independent applications. The lab repository is the planning and automation workspace, while each project also has its own private GitHub repository documented in `docs/project-repositories.md`.

Preferred branch pattern inside this lab repository:

```text
codex/project-name-short-task
```

Preferred commit format:

```text
project-name: concise change summary
```

Examples:

```text
flashreserve: add reservation data model
pocketsentinel: document webrtc signaling flow
```

For project repositories, prefer direct incremental commits on the project repo's working branch or `main` once the project is private and ready for portfolio polishing. Do not batch unrelated days into one catch-up commit, and do not rewrite dates to simulate consistency. The consistency signal should come from real daily project work pushed as it is completed.
