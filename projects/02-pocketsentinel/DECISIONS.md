# PocketSentinel Decisions

## Decision 1: Start With Separate Camera, Dashboard, And API Workspaces

PocketSentinel starts with two Next.js apps and one FastAPI service.

Why:
- The phone camera and dashboard have different UX, device permission, and viewport constraints.
- Keeping them as separate apps makes the WebRTC pairing boundary explicit instead of hiding it in one page.
- FastAPI is the right service boundary for later Python inference work, but the first slice can stay model-free and dependency-light.
- A scaffold check can validate the project shape without installing dependencies or creating large caches.

Rejected:
- One combined Next.js app for both sender and viewer: simpler at first, but weaker for explaining phone-to-dashboard pairing.
- Adding YOLO or ONNX Runtime immediately: too heavy before the WebRTC and event contracts exist.
- Persisting sessions on day one: PostgreSQL is planned, but an in-memory boundary is enough for the first scaffold.

## Decision 2: Use REST-Polling Signaling Before WebSocket Signaling

PocketSentinel starts WebRTC negotiation with REST endpoints on the FastAPI service.

Why:
- The key interview signal is understanding WebRTC media versus signaling, not building a custom realtime transport first.
- REST polling keeps the first pairing flow easy to inspect with browser devtools or curl.
- Ordered message sequences are enough for offer, answer, and ICE candidate exchange in the local prototype.
- The same message contract can move to WebSockets later if polling becomes noisy or slow.

Rejected:
- WebSocket signaling immediately: reasonable long term, but it adds connection lifecycle concerns before camera permission and peer negotiation are implemented.
- Putting signaling only in the dashboard app: weaker boundary because the API will also own sessions and detection events.
- Sending video frames through FastAPI: simpler to debug, but it avoids the actual WebRTC architecture and creates avoidable privacy and latency problems.
