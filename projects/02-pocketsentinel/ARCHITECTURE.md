# PocketSentinel Architecture

PocketSentinel starts as a small full-stack system with two browser apps and one Python service boundary.

Initial topology:

```text
Phone browser PWA
  |
  | WebRTC media + signaling messages
  v
Viewer dashboard
  |
  | selected frames or metadata
  v
Inference service
  |
  v
Detection events stored in PostgreSQL
```

## Scaffold Boundaries

- `apps/camera` is the phone-facing Next.js PWA shell. Its first responsibility is camera permission, pairing, and stream start/stop UX.
- `apps/dashboard` is the viewer shell. Its first responsibility is pairing a phone stream, rendering the WebRTC video element, and showing detection events.
- `services/api` is the FastAPI service. Its first responsibility is session creation, signaling contract ownership, and detection event ingestion.

The API still keeps session identity and signaling messages in memory because that state is short-lived and tied to the local WebRTC pairing flow. Detection events now have an optional PostgreSQL path so the dashboard timeline can survive API restarts once object detection is wired.

## WebRTC Signaling Boundary

The dashboard is the session owner for the first slice. It creates a session, shows a short pairing code, and waits for camera-originated WebRTC negotiation messages. The phone camera claims the code, asks the browser for media permission, creates the offer, and sends SDP plus ICE candidates through FastAPI.

The API stores ordered signaling messages with a per-session sequence number. Each browser polls for messages addressed to its role by passing `recipient_role` and `after_sequence`. This avoids adding a separate WebSocket signaling server before the stream contract is stable, while still preserving the important architecture boundary: video moves over WebRTC, not through the API.

Detailed flow and payload shapes live in `SIGNALING.md`.

## Local Development

The scaffold uses separate ports so all three surfaces can run together:

```text
camera app:    3100
dashboard app: 3101
api service:   8100
postgres:      5433
```

The local Compose stack runs PostgreSQL plus the FastAPI service:

```powershell
cd projects/02-pocketsentinel
docker compose up --build
```

PostgreSQL initializes from `db/schema.sql` and stores local data under `projects/02-pocketsentinel/.data/postgres`, keeping durable development state on `K:\AutoPilot_Projects`. The API checks `DATABASE_URL` at startup; if PostgreSQL is available, detection events are persisted in `detection_events`, otherwise the API keeps the existing memory-backed behavior for lightweight checks.

Session and signaling persistence are intentionally deferred. They are useful once pairing reconnects, multi-dashboard views, or audit trails matter, but they are not required for the next camera-capture and dashboard-pairing slices.
