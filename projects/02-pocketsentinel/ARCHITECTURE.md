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

The first API implementation uses in-memory dictionaries only to make the boundary executable without pulling in PostgreSQL before the signaling flow is defined. PostgreSQL remains the planned durable store for device sessions and detection timelines.

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
```

The repository should keep generated dependencies, caches, model weights, and local databases under `K:\AutoPilot_Projects` when those heavier artifacts are introduced.
