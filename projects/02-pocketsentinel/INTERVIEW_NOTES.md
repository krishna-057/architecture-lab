# PocketSentinel Interview Notes

Key topics:

- Why WebRTC instead of repeatedly uploading images.
- Browser PWA vs native mobile app.
- Server-side inference vs edge inference.
- Privacy and retention choices for video data.

## First Slice Talking Points

- The camera and dashboard are separate apps because the sender is permission-heavy and mobile-first, while the dashboard is monitoring-heavy and desktop-first.
- FastAPI is introduced as the service boundary early because Python is the practical path for object detection, but model loading is deferred until the stream and event contracts exist.
- The API keeps pairing sessions and signaling messages in memory, but detection events can now persist to PostgreSQL because the timeline is the first state users expect to survive restarts.
- The local Compose stack proves the API/database boundary without adding object-detection model downloads or a queue before they are needed.
- The design avoids storing raw video by default. The planned durable artifact is a detection timeline, with video retention treated as an explicit future privacy decision.
- WebRTC still needs a signaling channel. The current contract uses FastAPI REST polling for session pairing and SDP/ICE exchange because it is inspectable and enough for a one-camera prototype.
- The API never carries video frames in the first design. That keeps the privacy story clear: browser peers negotiate through the API, then media flows peer-to-peer unless a future TURN relay is required.
- Camera capture is gated by a user tap and local permission success before pairing is enabled. That keeps browser/device permission errors separate from WebRTC signaling errors and makes the privacy boundary visible in the UI.
