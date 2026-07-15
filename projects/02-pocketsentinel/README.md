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

## Why This Project Matters

This project combines product creativity with real networking and AI inference. It is intentionally more than a CRUD app, but still small enough to build as a focused prototype.
