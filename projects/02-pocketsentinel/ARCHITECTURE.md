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

## Local Development

The scaffold uses separate ports so all three surfaces can run together:

```text
camera app:    3100
dashboard app: 3101
api service:   8100
```

The repository should keep generated dependencies, caches, model weights, and local databases under `K:\AutoPilot_Projects` when those heavier artifacts are introduced.
