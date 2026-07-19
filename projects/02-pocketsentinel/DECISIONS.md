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

## Decision 5: Build The Dashboard Pairing Shell Before WebRTC Answering

The dashboard now creates sessions and polls the API for status, camera signaling messages, and detection events before it creates `RTCPeerConnection` answers.

Why:
- The operator workflow can be validated with the existing FastAPI contract before browser peer negotiation adds more failure modes.
- Showing the pairing code, expiry, and signal log makes the REST-polling signaling boundary visible and easy to debug.
- Local CORS support is the smallest development bridge for separate app/API ports; a reverse proxy is unnecessary at this stage.
- Reserving the video frame keeps the UI shape stable for the next slice without pretending that media is already connected.

Rejected:
- Implementing dashboard answer creation in the same task: useful next, but it would mix operator pairing, polling, ICE handling, and media rendering in one oversized slice.
- Proxying API requests through Next.js: convenient, but it hides the API boundary that the project is meant to demonstrate.
- Persisting sessions now: reconnect and multi-viewer behavior are still undefined, so memory-backed sessions remain enough.

## Decision 6: Create Camera Offers Before Dashboard Answering

The camera app now claims a pairing code and creates a WebRTC offer from the active local `MediaStream`.

Why:
- The camera is the only peer that can prove tracks exist before negotiation, so it should create the first offer in the prototype.
- Keeping offer creation in the sender slice validates the permission-to-signaling path without adding remote rendering and answer handling at the same time.
- Posting SDP and ICE candidates through the existing REST-polling API reuses the documented signaling boundary and keeps video out of FastAPI.
- Starting without STUN/TURN keeps the local contract small; traversal configuration becomes useful after both peers can complete an answer flow.

Rejected:
- Letting the dashboard create the offer first: possible with transceivers, but less intuitive for a phone-as-camera prototype where the sender owns the media tracks.
- Adding a WebRTC helper library now: browser APIs are enough for one peer connection and would keep the interview signal clearer.
- Combining camera offer creation with dashboard answering: it would finish more of the happy path, but it hides which side owns each failure mode.

## Decision 7: Complete Local WebRTC With Browser-Native Answering

The dashboard now creates the WebRTC answer and renders the remote camera stream without adding a signaling library, WebSocket server, or media relay.

Why:
- The existing REST-polling signaling contract already carries ordered SDP and ICE messages, so answer creation does not need a new transport.
- Browser-native `RTCPeerConnection` keeps the architecture signal clear: FastAPI coordinates negotiation, while media remains peer-to-peer.
- Rendering remote tracks directly in the dashboard proves the core CCTV loop before object detection or frame sampling adds more moving parts.
- Applying the dashboard answer and ICE candidates in the camera app is necessary for the receiver slice to be truly end-to-end.

Rejected:
- Adding SimplePeer or another wrapper now: useful for ergonomics, but it hides the WebRTC offer/answer mechanics this project is meant to demonstrate.
- Adding STUN/TURN servers immediately: needed for broader network traversal, but local and same-LAN negotiation should work before external credentials are introduced.
- Relaying media through FastAPI: easier to reason about from one backend process, but it violates the privacy and latency boundary established for the project.

## Decision 8: Add Dashboard-Side Detection Ingestion Before Model Runtime

The dashboard now samples the connected remote video and posts detection events through the existing FastAPI endpoint.

Why:
- The dashboard already receives the WebRTC stream, so it can sample frames without sending raw video through the API.
- The important next contract is event ingestion: detector output should become durable timeline data with label, confidence, and timestamp fields.
- A lightweight frame-delta adapter proves the ingestion loop and rate limiting without adding model downloads, GPU assumptions, or large npm/Python dependencies.
- The adapter boundary leaves room for YOLO or ONNX Runtime to replace the current `moving object` detector while preserving the same API contract.

Rejected:
- Adding YOLO/ONNX Runtime immediately: useful soon, but too heavy before the browser stream lifecycle and ingestion API are exercised end to end.
- Sending frames to FastAPI for detection now: this would weaken the privacy boundary and require server-side image handling before the first event pipeline needs it.
- Manually creating fake timeline rows: easier visually, but it would not validate the dashboard-to-API ingestion path.
