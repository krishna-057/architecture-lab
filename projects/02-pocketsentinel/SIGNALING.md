# PocketSentinel WebRTC Signaling

PocketSentinel uses WebRTC for browser-to-browser media and a small FastAPI signaling boundary for pairing and SDP/ICE exchange. The API does not relay video frames.

## Roles

| Role | Surface | Responsibility |
| --- | --- | --- |
| `dashboard` | `apps/dashboard` | Creates a viewing session, displays a short pairing code, receives the camera offer, and sends the answer. |
| `camera` | `apps/camera` | Claims the pairing code, asks for camera permission, creates the media offer, and sends ICE candidates. |
| `api` | `services/api` | Owns session identity, pairing-code lookup, and ordered signaling messages. |

## Pairing Flow

1. Dashboard calls `POST /api/sessions` with a device label.
2. API creates a session with status `waiting_for_camera`, a six-character `pairing_code`, a 10-minute expiry, and `signaling_path`.
3. Camera enters the pairing code and calls `POST /api/pairings/{pairing_code}/claim`.
4. API moves the session to `pairing` and returns the session details.
5. Camera captures local media, creates a WebRTC offer, and posts it to `POST /api/sessions/{session_id}/signal`.
6. Dashboard polls `GET /api/sessions/{session_id}/signal?recipient_role=dashboard&after_sequence=<last_seen>` and receives the offer plus camera ICE candidates.
7. Dashboard creates an answer and posts it to the same signaling endpoint.
8. API moves the session to `streaming` when it receives an `answer` for a pairing session.
9. Camera polls for dashboard messages and applies the answer plus dashboard ICE candidates.
10. Either side can post `bye`; the API marks the session `ended`.

## Signaling Message Contract

`POST /api/sessions/{session_id}/signal`

```json
{
  "sender_role": "camera",
  "type": "offer",
  "payload": {
    "sdp": "v=0...",
    "type": "offer"
  },
  "client_message_id": "camera-1"
}
```

Supported message types:

| Type | Sender | Payload |
| --- | --- | --- |
| `ready` | camera or dashboard | Optional metadata that a peer is ready to negotiate. |
| `offer` | camera | Browser `RTCSessionDescriptionInit` offer. |
| `answer` | dashboard | Browser `RTCSessionDescriptionInit` answer. |
| `ice-candidate` | camera or dashboard | Browser `RTCIceCandidateInit`. |
| `bye` | camera or dashboard | Optional reason for ending the session. |

The API assigns each message a monotonically increasing `sequence`. Clients poll with their last seen sequence so refreshes and reconnects can resume without replaying every message.

## First-Slice Constraints

- Signaling state is in memory, matching the current scaffold's in-memory session and detection event store.
- REST polling is deliberate for the first slice because it is easier to inspect, test, and explain than a WebSocket signaling server.
- The API stores SDP and ICE messages only long enough for local prototype pairing. Durable session history belongs in PostgreSQL when the local development stack is added.
- Media remains peer-to-peer through WebRTC. If NAT traversal fails, the documented next step is adding STUN/TURN configuration, not relaying video through FastAPI.

