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

## Camera Permission Boundary

The camera app owns browser permission and local preview state before it touches signaling. Capture starts only from a user click, uses `navigator.mediaDevices.getUserMedia`, and prefers the environment-facing camera for a CCTV-style phone placement. Once permission succeeds, the local `MediaStream` is attached directly to a muted inline video element.

The stream is not sent to the API and is not persisted. Stopping capture explicitly stops every media track before resetting the preview. This keeps the first browser slice privacy-preserving and makes the later pairing step depend on a real active stream instead of mixing permission, signaling, and peer-connection failures together.

## Dashboard Pairing Boundary

The dashboard now owns the operator side of pairing. It creates a session through FastAPI, displays the six-character code and expiry, polls session state, and reads only signaling messages addressed to the `dashboard` role. The UI keeps the video frame as a reserved surface until the next slice adds `RTCPeerConnection` answer creation.

Because the browser apps and API run on different local ports, FastAPI allows CORS for `http://localhost:3100` and `http://localhost:3101` by default. The origins can be replaced with `CORS_ALLOWED_ORIGINS` for other local setups. This keeps the development topology honest without adding a reverse proxy before the WebRTC contract is usable.

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
