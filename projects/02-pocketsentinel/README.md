# PocketSentinel

PocketSentinel turns a phone browser into a temporary CCTV camera. A dashboard receives the stream, detects objects, and records human-readable detection events.

## Architecture Focus

- WebRTC media streaming
- Object detection pipeline
- Privacy-first handling of video
- Realtime event timeline
- Edge-vs-server inference tradeoffs

## Proposed Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Phone client | Next.js PWA | Browser camera access without native app overhead. |
| Dashboard | Next.js | Shared frontend stack and fast UI iteration. |
| Backend | FastAPI | Strong fit for Python-based AI inference. |
| Streaming | WebRTC | Designed for low-latency peer/media streaming. |
| Inference | YOLO/ONNX Runtime | Practical object detection with local or server-side execution options. |
| Database | PostgreSQL | Durable event timeline and device/session records. |

## Why This Project Matters

This project combines product creativity with real networking and AI inference. It is intentionally more than a CRUD app, but still small enough to build as a focused prototype.

