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

The initial scaffold deferred dependency installation until the first browser slice needed it. The camera app dependencies are now locked in `package-lock.json`; Python virtual environments and object-detection model downloads are still deferred until the API or inference slices need them.

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

## Camera Capture Flow

The camera PWA now has the first permission-gated capture flow:

- The browser asks for camera access only after the user taps Start.
- The app requests the rear camera when available with `facingMode: environment`.
- A live local preview is shown after permission succeeds.
- Stop explicitly releases all media tracks so the phone camera indicator turns off.
- Pairing stays disabled until a local media stream exists.

The capture flow keeps raw video in the browser and does not upload frames to the API. Pairing and WebRTC negotiation now depend on this local `MediaStream`, so permission failures stay separate from signaling failures.

## Dashboard Pairing Shell

The dashboard now creates and monitors the first viewing session:

- `POST /api/sessions` creates a short-lived dashboard-owned session.
- The UI shows the pairing code, expiry time, session status, and the latest signaling messages addressed to the dashboard.
- The dashboard polls `/api/sessions/{session_id}` and `/api/sessions/{session_id}/signal?recipient_role=dashboard&after_sequence=...`.
- The detection timeline reads from `/api/sessions/{session_id}/detections` when a session exists.

The shell proved the browser/API boundary before receiver-side negotiation was added. The dashboard now consumes the camera offer through the same polling contract and renders the remote stream in the reserved viewer surface.

## Camera Pairing And Offer Flow

The camera PWA can now join a dashboard-created session:

- The user starts camera preview first, then enters the dashboard pairing code.
- The camera claims the pairing code through `POST /api/pairings/{pairing_code}/claim`.
- A browser `RTCPeerConnection` is created only after a live `MediaStream` exists.
- Local camera tracks are attached to the peer connection before creating the SDP offer.
- The camera posts the `offer` and gathered `ice-candidate` messages through the existing signaling API.

The camera now keeps polling after sending the offer so it can apply the dashboard answer and dashboard-originated ICE candidates without changing the signaling transport.

## Dashboard Answer And Remote Stream Flow

The dashboard completes the first local WebRTC happy path:

- It polls dashboard-addressed signaling messages and validates SDP/ICE payloads before applying them.
- It creates one browser `RTCPeerConnection` per viewing session after receiving the camera offer.
- It applies camera ICE candidates, creates the SDP answer, and posts dashboard ICE candidates through FastAPI.
- It binds remote tracks to the live video surface once the peer connection receives the camera stream.

This slice still uses no STUN/TURN servers. Local-host and same-LAN development can now validate the full offer/answer and media rendering path before NAT traversal is introduced.

## Why This Project Matters

This project combines product creativity with real networking and AI inference. It is intentionally more than a CRUD app, but still small enough to build as a focused prototype.
