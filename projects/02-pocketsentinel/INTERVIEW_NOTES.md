# PocketSentinel Interview Notes

Key topics:

- Why WebRTC instead of repeatedly uploading images.
- Browser PWA vs native mobile app.
- Server-side inference vs edge inference.
- Privacy and retention choices for video data.

## First Slice Talking Points

- The camera and dashboard are separate apps because the sender is permission-heavy and mobile-first, while the dashboard is monitoring-heavy and desktop-first.
- FastAPI is introduced as the service boundary early because Python is the practical path for object detection, but model loading is deferred until the stream and event contracts exist.
- The first API keeps sessions and events in memory so the scaffold can be verified quickly; PostgreSQL becomes necessary once detection timelines must survive restarts.
- The design avoids storing raw video by default. The planned durable artifact is a detection timeline, with video retention treated as an explicit future privacy decision.
- WebRTC still needs a signaling channel. The current contract uses FastAPI REST polling for session pairing and SDP/ICE exchange because it is inspectable and enough for a one-camera prototype.
- The API never carries video frames in the first design. That keeps the privacy story clear: browser peers negotiate through the API, then media flows peer-to-peer unless a future TURN relay is required.
