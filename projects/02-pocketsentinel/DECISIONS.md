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

## Decision 3: Persist Detection Events Before Persisting Signaling

PocketSentinel adds PostgreSQL through Docker Compose for the API and detection event timeline.

Why:
- Detection events are the first user-facing historical artifact; losing them on API restart would make the dashboard timeline misleading.
- Session pairing and signaling messages are short-lived negotiation state in the current one-camera prototype, so memory is still sufficient.
- A single `detection_events` table keeps the persistence slice small while proving the planned PostgreSQL boundary.
- The database bind mount lives under `projects/02-pocketsentinel/.data/postgres` so local development state stays inside the project workspace on `K:`.

Rejected:
- Persisting all sessions and signaling immediately: useful later, but it adds schema and lifecycle rules before the camera and dashboard clients use the contract.
- Adding Redis for signaling or queues now: unnecessary until polling, reconnects, or inference jobs create real pressure.
- Running PostgreSQL only as a documented external prerequisite: weaker reproducibility than a local Compose stack.

## Decision 4: Gate Pairing Behind Local Camera Permission

The camera app starts with an explicit permission and local-preview flow before implementing WebRTC offer creation.

Why:
- Browser camera permission can fail for user, device, browser, or HTTPS-context reasons, and those errors should be visible before signaling starts.
- A real local `MediaStream` is the right prerequisite for pairing because the camera role cannot create a useful WebRTC offer without tracks.
- Keeping preview local preserves the privacy claim that raw video is not sent to FastAPI.
- The browser-native MediaDevices API is enough for the first slice, so a React camera dependency would add surface area without solving a hard problem yet.

Rejected:
- Asking for permission automatically on page load: more surprising on mobile and easier for browsers to block.
- Enabling pairing before capture succeeds: mixes permission failures with signaling failures and makes the next slice harder to test.
- Uploading preview frames to the API for validation: contradicts the initial WebRTC/privacy boundary.
