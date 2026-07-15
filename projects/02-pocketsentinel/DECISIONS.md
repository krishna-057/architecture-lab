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
