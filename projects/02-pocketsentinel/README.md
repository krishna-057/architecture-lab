# PocketSentinel

PocketSentinel turns a phone browser into a temporary CCTV camera. A dashboard receives the stream, detects objects, and records human-readable detection events.

## Architecture Focus

- WebRTC media streaming
- Object detection pipeline
- Privacy-first handling of video
- Realtime event timeline
- Edge-vs-server inference tradeoffs

## Proposed Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Phone client | Next.js PWA | Browser camera access without native app overhead. |
| Dashboard | Next.js | Shared frontend stack and fast UI iteration. |
| Backend | FastAPI | Strong fit for Python-based AI inference. |
| Streaming | WebRTC | Designed for low-latency peer/media streaming. |
| Inference | YOLO/ONNX Runtime | Practical object detection with local or server-side execution options. |
| Database | PostgreSQL | Durable event timeline and device/session records. |

## App Scaffold

PocketSentinel now has a minimal full-stack scaffold under `projects/02-pocketsentinel`.

```text
projects/02-pocketsentinel/
  apps/
    camera/     # Next.js PWA shell for the phone browser
    dashboard/  # Next.js operator dashboard shell
  services/
    api/        # FastAPI boundary for sessions, signaling, and detection events
  scripts/
    check-workspace.mjs
```

The first scaffold intentionally does not install npm dependencies, create a Python virtual environment, or download object-detection models. Those are heavier project artifacts and should be added only when the next slice needs them.

Validate the scaffold:

```powershell
cd projects/02-pocketsentinel
node scripts/check-workspace.mjs
```

Planned local ports:

- Camera PWA: `http://localhost:3100`
- Dashboard: `http://localhost:3101`
- FastAPI service: `http://localhost:8100`
- PostgreSQL: `localhost:5433`

## Local Development Stack

PocketSentinel now includes a minimal Docker Compose stack for the API and durable event storage:

```powershell
cd projects/02-pocketsentinel
docker compose up --build
```

The stack runs:

- `postgres`, initialized from `db/schema.sql`.
- `api`, a FastAPI container built from `services/api/Dockerfile`.

PostgreSQL data is bind-mounted to `projects/02-pocketsentinel/.data/postgres` so local database state remains under `K:\AutoPilot_Projects`. The first durable table is `detection_events`, which stores the object detection timeline by `session_id`.

When `DATABASE_URL` is configured, the API writes detection events to PostgreSQL. Without `DATABASE_URL` or the Python database dependency, it falls back to the existing in-memory event list so the scaffold can still be syntax-checked and explored without Docker.

## WebRTC Pairing Contract

The first signaling slice is now defined in `SIGNALING.md` and implemented as an in-memory FastAPI contract:

- Dashboard creates a session with `POST /api/sessions`.
- API returns a six-character `pairing_code`, 10-minute expiry, and `signaling_path`.
- Camera claims the code with `POST /api/pairings/{pairing_code}/claim`.
- Camera and dashboard exchange `offer`, `answer`, `ice-candidate`, `ready`, and `bye` messages through `/api/sessions/{session_id}/signal`.

This keeps video peer-to-peer through WebRTC while the API owns only session identity and negotiation messages.

## Why This Project Matters

This project combines product creativity with real networking and AI inference. It is intentionally more than a CRUD app, but still small enough to build as a focused prototype.
