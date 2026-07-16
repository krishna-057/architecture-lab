# Daily Log

## 2026-07-16

Started CollabFlow as the active project and implemented its first local-first workspace scaffold.

Added:
- `projects/04-collabflow/apps/web` as a Next.js workspace editor for title, notes, tasks, local persistence, and snapshot export.
- Browser-owned Yjs document state for the first CRDT-backed workspace slice.
- Native IndexedDB projection saves so the scaffold proves offline-first behavior before server sync.
- `projects/04-collabflow/services/api` as the FastAPI boundary for workspaces, sync-contract discovery, and exported snapshots.
- Local JSON snapshot storage at `projects/04-collabflow/.data/snapshots.json` by default, configurable with `SNAPSHOT_STORE_PATH`.
- Workspace validation markers for Yjs, IndexedDB, sync contract, and snapshot export.
- README, architecture, decisions, and interview-note updates explaining why websocket sync, awareness/presence, and PostgreSQL snapshots remain deferred.

Validated the work by running:
- `npm run check` from `projects/04-collabflow`
- `npm run build -w @collabflow/web` from `projects/04-collabflow`
- `python -m compileall services\api\app` from `projects/04-collabflow`
- `git diff --check`

Notes:
- `WORKFLOW.md` still appears to contain binary/corrupted content in the current checkout, so it could not be meaningfully read as Markdown.
- The first CollabFlow slice intentionally stores live document state in the browser and exports durable snapshots explicitly; it does not run a websocket sync provider yet.

Next recommended task:
- Define the CollabFlow websocket sync and presence contract.

Implemented PersonaBridge durable memory candidate APIs and deletion controls.

Added:
- Consent-gated memory candidate creation from allowed final user text in the FastAPI message flow.
- Local durable JSON candidate storage at `projects/03-personabridge/.data/memory-candidates.json` by default, configurable with `MEMORY_STORE_PATH`.
- `GET /api/sessions/{session_id}/memory-candidates` for active candidate review.
- `DELETE /api/memory-candidates/{candidate_id}` to tombstone a candidate and remove the visible summary.
- Web console memory candidate counts, active candidate rows, and delete controls.
- Workspace validation markers for candidate listing/deletion and the memory candidate contract.
- README, architecture, contract, decision, and interview-note updates explaining why local candidate durability comes before PostgreSQL/pgvector recall.

Validated the work by running:
- `npm run check` from `projects/03-personabridge`
- `npm run build -w @personabridge/web` from `projects/03-personabridge`
- `python -m compileall services\api\app` from `projects/03-personabridge`
- `git diff --check`

Notes:
- A direct FastAPI `TestClient` smoke test for candidate creation and deletion could not run because the current Python environment does not have `fastapi` installed. No global dependency install was performed.
- `WORKFLOW.md` still appears to contain binary/corrupted content in the current checkout, so it could not be meaningfully read as Markdown.
- PersonaBridge's Ready queue is complete, so the active project queue moved to CollabFlow per the 30-day plan.

Next recommended task:
- Start CollabFlow with the first local-first workspace scaffold.

Implemented the PersonaBridge realtime room token and browser voice shell.

Added:
- `POST /api/sessions/{session_id}/realtime-token` in the FastAPI API with a five-minute opaque browser join token.
- Session promotion from `chat_ready` to `voice_ready` after room token minting.
- Browser microphone capture in the PersonaBridge console through a user-triggered Join Voice action.
- Voice shell UI for join/leave state, token expiry, room identity, and local device label.
- Workspace validation markers for the token endpoint, microphone capture path, and room token contract.
- README, architecture, contract, decision, and interview-note updates explaining why the provider SDK remains deferred behind the room token boundary.

Validated the work by running:
- `npm run check` from `projects/03-personabridge`
- `npm run build -w @personabridge/web` from `projects/03-personabridge`
- `python -m compileall services\api\app` from `projects/03-personabridge`
- `git diff --check`

Notes:
- A direct FastAPI `TestClient` smoke test for the token endpoint could not run because the current Python environment does not have `fastapi` installed. No global dependency install was performed.
- The room token is intentionally an in-memory local development token, not production authentication. A future provider adapter should replace it with a signed or provider-issued short-lived credential.
- `WORKFLOW.md` still appears to contain binary/corrupted content in the current checkout, so it could not be meaningfully read as Markdown.

Next recommended task:
- Add PersonaBridge durable memory candidate APIs and deletion controls.

Defined the PersonaBridge realtime session and memory contracts.

Added:
- `projects/03-personabridge/CONTRACTS.md` with the provider-neutral room, event, token, transcript, approval, and memory-candidate rules.
- `GET /api/sessions/{session_id}/realtime-contract` and `GET /api/sessions/{session_id}/memory-contract` in the FastAPI API.
- Web console contract panels that show realtime room status, event counts, token deferral, memory capture mode, excluded source count, and storage target.
- Workspace validation that requires the new contract document and API/UI contract markers.
- Architecture, decision, README, and interview-note updates explaining why provider integration, durable memory rows, and embeddings remain deferred behind the contract.

Validated the work by running:
- `npm run check` from `projects/03-personabridge`
- `npm run build -w @personabridge/web` from `projects/03-personabridge`
- `python -m compileall services\api\app` from `projects/03-personabridge`
- `git diff --check`

Notes:
- A direct FastAPI `TestClient` smoke test for the new contract endpoints could not run because the current Python environment does not have `fastapi` installed. No global dependency install was performed.
- `WORKFLOW.md` still appears to contain binary/corrupted content in the current checkout, so it could not be meaningfully read as Markdown.

Next recommended task:
- Implement PersonaBridge realtime room token and browser voice shell.

Started PersonaBridge as the active project and implemented its first full-stack scaffold.

Added:
- `projects/03-personabridge/apps/web` as the Next.js personal assistant console for sessions, chat, memory consent, and approvals.
- `projects/03-personabridge/services/api` as the FastAPI boundary for session state, message flow, and approval decisions.
- `projects/03-personabridge/scripts/check-workspace.mjs` for dependency-light scaffold validation.
- Project package metadata, `.env.example`, local API requirements, and Dockerfile.
- Documentation for why realtime voice, durable memory, model credentials, and actual tool execution remain deferred behind explicit contracts.

Validated the work by running:
- `npm run check` from `projects/03-personabridge`
- `npm run build -w @personabridge/web` from `projects/03-personabridge`
- `python -m compileall services\api\app` from `projects/03-personabridge`

Notes:
- `npm install` reported 2 moderate severity vulnerabilities in the current Next/React dependency tree; no dependency upgrade was performed because that is a separate task.
- `WORKFLOW.md` still appears to contain binary/corrupted content in the current checkout, so it could not be meaningfully read as Markdown.

Next recommended task:
- Define PersonaBridge realtime session and memory contracts.

Implemented the PocketSentinel dashboard object detection event ingestion pipeline.

Added:
- Dashboard-side hidden canvas frame sampling from the connected remote WebRTC video.
- A lightweight detector adapter that emits rate-limited `moving object` events from meaningful frame changes.
- Posting of detection events to the existing FastAPI `POST /api/sessions/{session_id}/detections` endpoint.
- Immediate timeline insertion after successful event ingestion, while retaining the existing polling refresh path.
- Pipeline status UI in the dashboard detection panel.
- Workspace validation that checks for the dashboard detection ingestion path.
- Documentation for why YOLO/ONNX model runtime remains deferred behind the detector adapter boundary.

Validated the work by running:
- `node scripts/check-workspace.mjs` from `projects/02-pocketsentinel`
- `npm run build -w @pocketsentinel/dashboard` from `projects/02-pocketsentinel`
- `python -m compileall services\api\app` from `projects/02-pocketsentinel`

Notes:
- The first detector is intentionally lightweight and browser-local; it proves event ingestion without adding large model downloads or server-side frame handling.
- Raw video frames still stay in the dashboard browser and are not posted to FastAPI.
- `WORKFLOW.md` still appears to contain binary/corrupted content in the current checkout, so it could not be meaningfully read as Markdown.

Next recommended task:
- Start PersonaBridge with the first app scaffold.

Implemented the PocketSentinel dashboard WebRTC answer and remote rendering slice.

Added:
- Dashboard-side `RTCPeerConnection` creation when a camera offer arrives through the existing signaling API.
- SDP answer posting and dashboard ICE candidate posting through FastAPI REST polling.
- Remote track rendering in the dashboard live video surface.
- Camera-side polling for dashboard answers and ICE candidates so the offer/answer path can complete.
- Documentation for why STUN/TURN and media relays remain deferred until local peer-to-peer negotiation is proven.

Validated the work by running:
- `node scripts/check-workspace.mjs` from `projects/02-pocketsentinel`
- `npm run build -w @pocketsentinel/dashboard` from `projects/02-pocketsentinel`
- `npm run build -w @pocketsentinel/camera` from `projects/02-pocketsentinel`

Notes:
- `WORKFLOW.md` still appears to contain binary/corrupted content in the current checkout, so it could not be meaningfully read as Markdown.

Next recommended task:
- Add dashboard object detection event ingestion pipeline.

Implemented the PocketSentinel camera pairing claim and WebRTC offer creation slice.

Added:
- Pairing-code entry in the camera PWA after local capture succeeds.
- Camera-side claim against `POST /api/pairings/{pairing_code}/claim`.
- Browser `RTCPeerConnection` creation from the active `MediaStream`.
- Sender-side SDP offer posting and ICE candidate posting through the existing signaling API.
- Documentation for why dashboard answering, remote rendering, and STUN/TURN configuration remain separate next steps.

Validated the work by running:
- `node scripts/check-workspace.mjs` from `projects/02-pocketsentinel`
- `npm run build -w @pocketsentinel/camera` from `projects/02-pocketsentinel`

Notes:
- `WORKFLOW.md` still appears to contain binary/corrupted content in the current checkout, so it could not be meaningfully read as Markdown.

Next recommended task:
- Implement dashboard WebRTC answer creation and remote video rendering.

Implemented the PocketSentinel dashboard stream pairing shell.

Added:
- Dashboard session creation against `POST /api/sessions`.
- Pairing-code, expiry, session status, and signal-log UI in `apps/dashboard`.
- Polling for dashboard-addressed signaling messages and session status.
- Detection timeline polling for the active session.
- Local FastAPI CORS configuration for the camera and dashboard development origins.
- Documentation for why dashboard answering and real media rendering stay in the next WebRTC slice.

Validated the work by running:
- `node scripts/check-workspace.mjs` from `projects/02-pocketsentinel`
- `npm run build -w @pocketsentinel/dashboard` from `projects/02-pocketsentinel`
- `python -m compileall services\api\app` from `projects/02-pocketsentinel`

Notes:
- `WORKFLOW.md` still appears to contain binary/corrupted content in the current checkout, so it could not be meaningfully read as Markdown.

Next recommended task:
- Implement camera pairing claim and WebRTC offer creation from the active media stream.

Implemented the PocketSentinel camera capture permission flow.

Added:
- Browser-native `getUserMedia` capture in `apps/camera` with a user-initiated Start action.
- Rear-camera preference, live muted inline preview, explicit Stop track cleanup, and permission/device error states.
- Pairing control gating so the next WebRTC slice starts only after a local media stream exists.
- `package-lock.json` for the PocketSentinel npm workspace after installing the declared Next/React dependencies.
- Documentation for the camera permission boundary and why pairing remains behind local capture success.

Validated the work by running:
- `node scripts/check-workspace.mjs` from `projects/02-pocketsentinel`
- `npm run build -w @pocketsentinel/camera` from `projects/02-pocketsentinel`

Notes:
- `npm install` reported 2 moderate severity vulnerabilities in the current Next/React dependency tree; no dependency upgrade was performed because that is a separate task.
- `WORKFLOW.md` still appears to contain binary/corrupted content in the current checkout, so it could not be meaningfully read as Markdown.

Next recommended task:
- Implement the dashboard stream pairing shell.

Added the PocketSentinel local development stack for API and event storage.

Added:
- `projects/02-pocketsentinel/compose.yaml` with PostgreSQL and FastAPI services.
- `projects/02-pocketsentinel/db/schema.sql` for the first durable `detection_events` table.
- `projects/02-pocketsentinel/services/api/Dockerfile` for the API container.
- Optional PostgreSQL-backed detection event writes and reads when `DATABASE_URL` is configured, with memory fallback for lightweight checks.
- Workspace validation that requires the Compose stack, schema, API Dockerfile, and K:-scoped PostgreSQL bind mount.
- `.gitignore` coverage for PocketSentinel local database state and Python cache folders.
- Documentation for why detection events are persisted before short-lived session/signaling state.

Validated the work by running:
- `node scripts/check-workspace.mjs` from `projects/02-pocketsentinel`
- `docker compose -f projects/02-pocketsentinel/compose.yaml config`
- `python -m compileall services\api\app` from `projects/02-pocketsentinel`

Notes:
- The Compose config resolves PostgreSQL data to `K:\AutoPilot_Projects\FlashReserve\projects\02-pocketsentinel\.data\postgres`.
- `WORKFLOW.md` still appears to contain binary/corrupted content in the current checkout, so it could not be meaningfully read as Markdown.

Next recommended task:
- Implement the camera capture permission flow.

Defined the first PocketSentinel WebRTC signaling and pairing flow.

Added:
- `projects/02-pocketsentinel/SIGNALING.md` with the dashboard-created pairing flow, role responsibilities, message types, and first-slice constraints.
- In-memory FastAPI pairing support with six-character pairing codes and `POST /api/pairings/{pairing_code}/claim`.
- In-memory ordered signaling messages through `POST /api/sessions/{session_id}/signal` and `GET /api/sessions/{session_id}/signal`.
- Session status transitions from `waiting_for_camera` to `pairing`, `streaming`, and `ended`.
- Architecture, decision, README, and interview-note updates explaining REST-polling signaling and why video stays peer-to-peer.

Validated the work by running:
- `node scripts/check-workspace.mjs` from `projects/02-pocketsentinel`
- `python -c "import ast, pathlib; ast.parse(pathlib.Path('services/api/app/main.py').read_text()) ; print('PocketSentinel API syntax check passed.')"` from `projects/02-pocketsentinel`

Notes:
- A deeper FastAPI `TestClient` smoke test could not run because the current Python environment does not have `fastapi` installed. No global dependency install was performed.
- `WORKFLOW.md` still appears to contain binary/corrupted content in the current checkout, so it could not be meaningfully read as Markdown.

Next recommended task:
- Add the PocketSentinel local development stack for API and event storage.

Started PocketSentinel as the active project and implemented its first full-stack scaffold.

Added:
- `apps/camera` as the phone-facing Next.js PWA shell.
- `apps/dashboard` as the viewer and detection timeline Next.js shell.
- `services/api` as the FastAPI boundary for sessions and detection events.
- `scripts/check-workspace.mjs` for dependency-free scaffold validation.
- Documentation for why model downloads, PostgreSQL persistence, and heavier runtime setup are deferred until the WebRTC and event contracts are defined.

Validated the work by running:
- `node scripts/check-workspace.mjs` from `projects/02-pocketsentinel`

Notes:
- FlashReserve's Ready queue was complete, so the active project queue moved to PocketSentinel per the 30-day plan.
- `WORKFLOW.md` still appears to contain binary/corrupted content in the current checkout, so it could not be meaningfully read as Markdown.

Next recommended task:
- Define the WebRTC signaling and pairing flow.

Implemented the first FlashReserve admin inventory diagnostics API.

Added:
- `GET /api/admin/products/:productId/inventory` in the NestJS API.
- Product drop metadata, durable inventory counters, derived available stock, reservation status counts, and the 10 most recent reservations in one read-only operator response.
- Documentation for why this endpoint uses PostgreSQL as the durable admin view and defers auth/mutation workflows until an admin identity model exists.

Validated the work by running:
- `npm run check` from `projects/01-flashreserve`
- `npm run build -w @flashreserve/api` from `projects/01-flashreserve`
- `npm run test:reservations:concurrency` from `projects/01-flashreserve` (passed with 2 skipped tests because local PostgreSQL rejected the documented `flashreserve` password)

Notes:
- The Ready queue was fully checked, but the active project docs still listed an admin inventory/reservation view as a core FlashReserve feature. Added that missing task to the Ready list and completed it as today's single task.
- `WORKFLOW.md` still appears to contain binary/corrupted content in the current checkout, so it could not be meaningfully read as Markdown.

Next recommended task:
- Move the active queue to PocketSentinel or add FlashReserve frontend wiring for the completed APIs.

Implemented the first FlashReserve order confirmation API slice.

Added:
- `POST /api/orders/confirm` in the NestJS API.
- Manual request parsing for `userId` and `reservationId`.
- Transactional reservation confirmation that locks the reservation, creates one confirmed order, inserts the order item, and moves inventory from reserved to sold.
- Idempotent duplicate confirmation behavior that returns the existing order for an already confirmed reservation.
- Integration coverage in the existing API test command for the confirm path and duplicate confirm request.

Validated the work by running:
- `npm run check` from `projects/01-flashreserve`
- `npm run build -w @flashreserve/api` from `projects/01-flashreserve`
- `npm run test:reservations:concurrency` from `projects/01-flashreserve` (passed with 2 skipped tests because local PostgreSQL rejected the documented `flashreserve` password)

Notes:
- The Ready queue had all original FlashReserve items checked, but the active project docs still listed order confirmation as a core deliverable. Added that missing task to the Ready list and completed it as today's single task.
- `WORKFLOW.md` still appears to contain binary/corrupted content in the current checkout, so it could not be meaningfully read as Markdown.

Next recommended task:
- Add a product stock warmup/admin inventory view or move the active queue to PocketSentinel.

Implemented the first FlashReserve live stock update channel.

Added:
- Socket.IO WebSocket support for the NestJS API.
- A `/stock` namespace with `stock.subscribe` and `stock.unsubscribe` product-room messages.
- `stock.updated` broadcasts after successful reservation creation and after idempotent reservation expiry stock release.
- Realtime docs covering the event contract, product room shape, and why Redis pub/sub is deferred until multiple API or worker processes exist.

Validated the work by running:
- `npm run check` from `projects/01-flashreserve`
- `npm run build -w @flashreserve/api` from `projects/01-flashreserve`
- `npm run test:reservations:concurrency` from `projects/01-flashreserve` (passed with 1 skipped test because local PostgreSQL rejected the documented `flashreserve` password)

Notes:
- `WORKFLOW.md` still appears to contain binary/corrupted content in the current checkout, so it could not be meaningfully read as Markdown.
- `npm install` reported existing dependency audit findings: 3 low, 14 moderate, and 7 high.

Next recommended task:
- Move to the next project queue item or add FlashReserve order confirmation tasks before starting PocketSentinel.

## 2026-07-15

Added the first FlashReserve concurrent reservation integration test.

Added:
- `npm run test:reservations:concurrency` from `projects/01-flashreserve`.
- A Node test that builds and boots the compiled NestJS API, seeds one live product with three units, sends ten concurrent reservation requests, and verifies HTTP, PostgreSQL, and Redis state.
- Documentation for why the test goes through the real API and how to require infra-backed execution.

Validated the work by running:
- `npm run test:reservations:concurrency` from `projects/01-flashreserve` (passed with 1 skipped test because local PostgreSQL/Redis were not available with the documented credentials)
- `npm run check` from `projects/01-flashreserve`
- `npm run build -w @flashreserve/api` from `projects/01-flashreserve`

Notes:
- Docker Compose could not start because Docker Desktop's Linux engine pipe was unavailable.
- The integration test now skips by default when PostgreSQL/Redis are unavailable; set `FLASHRESERVE_REQUIRE_INTEGRATION=1` to make missing infra fail the run.
- `WORKFLOW.md` appears to contain binary/corrupted content in the current checkout, so it could not be meaningfully read as Markdown.

Next recommended task:
- Add live stock update channel.

Implemented the first FlashReserve reservation expiry worker slice.

Added:
- `ReservationExpiryWorker` for BullMQ `expire-reservation` jobs.
- Transactional PostgreSQL expiry that marks due pending reservations as `expired` and releases durable reserved inventory.
- Idempotent Redis stock release using `flashreserve:reservation-release:{reservationId}` markers.
- Shared Redis connection and reservation key helpers for the API and worker.
- Documentation for the worker process boundary and retry-safety decision.

Validated the work by running:
- `npm run check` from `projects/01-flashreserve`
- `npm run build -w @flashreserve/api` from `projects/01-flashreserve`

Notes:
- `git pull --ff-only` is still blocked because GitHub returned `Repository not found` for `https://github.com/krishna-057/architecture-lab.git`.

Next recommended task:
- Add tests for concurrent reservation attempts.

Implemented the first FlashReserve reservation creation API slice.

Added:
- `POST /api/reservations` in the NestJS API.
- A small PostgreSQL database service using `pg`.
- Redis atomic stock decrement logic for warmed `flashreserve:stock:{productId}` counters.
- Durable pending reservation creation with `inventory.reserved_quantity` updates.
- Redis reservation metadata TTL storage and BullMQ delayed expiry job scheduling.
- Compensation paths for Redis/PostgreSQL split failures and expiry scheduling failures.
- Documentation for the implemented endpoint, configuration, and manual validation decision.

Validated the work by running:
- `npm run check` from `projects/01-flashreserve`
- `npm run build -w @flashreserve/api` from `projects/01-flashreserve`

Notes:
- `git pull --ff-only` and pushing are blocked because GitHub returned `Repository not found` for `https://github.com/krishna-057/architecture-lab.git`.
- Created GitHub issue #2, `Human needed: Git push auth`, with the required human action.
- Sent the Telegram completion/blocker notification.
- `npm install` reported existing dependency audit findings: 3 low, 14 moderate, and 7 high.

Next recommended task:
- Add the reservation expiry worker.

## 2026-07-02

Defined the FlashReserve first-slice product flows and core entities across the project docs.

Added:
- An explicit single-product reservation flow in the FlashReserve README and architecture notes.
- A core-entity responsibility matrix plus state transitions for products, reservations, and orders.
- A recorded decision to start with single-product reservations instead of a cart-first checkout.
- Interview notes that justify the cart tradeoff in flash-sale terms.

Validated the work by running:
- `node scripts/check-workspace.mjs` from `projects/01-flashreserve`

Next recommended task:
- Implement the reservation creation API.

## 2026-07-01

Documented the concrete FlashReserve Redis reservation strategy across the project README, architecture notes, and decision log.

Added:
- The initial Redis key layout for product stock counters, reservation metadata, and BullMQ expiry jobs.
- The compensating release rule for Redis/PostgreSQL split-write failures.
- Rejected alternatives for Redis token lists, Redlock, and custom expiry schedulers.

Validated the work by running:
- `node scripts/check-workspace.mjs` from `projects/01-flashreserve`

Next recommended task:
- Implement the reservation creation API.

## 2026-06-30

Created the initial FlashReserve app scaffold under `projects/01-flashreserve`.

Added:
- `apps/api` as the NestJS modular monolith backend scaffold.
- `apps/web` as the Next.js frontend shell.
- `scripts/check-workspace.mjs` as a dependency-free scaffold sanity check.

Documented the workspace split in the FlashReserve README, architecture notes, and decision log.

Validated the work by running:
- `node scripts/check-workspace.mjs`

Next recommended task:
- Implement the reservation creation API inside `apps/api/src/reservations`.

Completed the initial FlashReserve PostgreSQL schema at `projects/01-flashreserve/db/schema.sql`.

Added durable tables for:
- users
- products
- inventory
- reservations
- orders
- order_items

Documented the schema shape and the aggregate inventory decision in the FlashReserve README, architecture notes, and decision log.

Validated the work by running:
- `docker compose -f projects/01-flashreserve/compose.yaml config`
- `docker compose -f projects/01-flashreserve/compose.yaml up -d`
- `Get-Content db/schema.sql | docker compose -f compose.yaml exec -T postgres psql -U flashreserve -d flashreserve -v ON_ERROR_STOP=1`
- `docker compose -f compose.yaml exec -T postgres psql -U flashreserve -d flashreserve -c "select table_name from information_schema.tables where table_schema = 'public' order by table_name;"`

Next recommended task:
- Implement the reservation creation API against Redis and PostgreSQL using this schema.

## 2026-06-29

Initialized the portfolio lab planning structure.

Created the first version of:
- Master 30-day plan
- Daily workflow contract
- Project briefs
- Documentation templates
- Task queue

Next recommended task:
- Start FlashReserve with product scope, data model, and local development stack.

Added `projects/01-flashreserve/compose.yaml` with a minimal PostgreSQL and Redis stack for local development.

Documented the local infra approach in FlashReserve docs, including the decision to keep bind-mounted data under `projects/01-flashreserve/.data/` so Docker-backed state stays on `K:`.

Validated the compose file with `docker compose -f projects/01-flashreserve/compose.yaml config`.

Next recommended task:
- Add the initial FlashReserve database schema for users, products, inventory, reservations, and orders.
