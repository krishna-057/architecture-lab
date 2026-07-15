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
