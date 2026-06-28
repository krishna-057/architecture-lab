# Initial Inspiration Notes

These sources influenced the first project lineup. We are using them for design inspiration, not copying their implementations.

## System Design And Interview Depth

- System Design Primer: https://github.com/donnemartin/system-design-primer
- Awesome System Design Resources: https://github.com/ashishps1/awesome-system-design-resources

What we learned:
- Strong interview projects need tradeoff explanations, failure modes, and scaling paths.
- A portfolio project is stronger when the README explains why alternatives were rejected.

## Event-Driven Commerce And Reservation Systems

- Event-driven commerce example: https://github.com/buemura/event-driven-commerce

What we learned:
- Commerce workflows become more interesting when inventory, reservations, and order processing are separated.
- We can show event-driven ideas without turning the first version into many services.

## Phone Camera, WebRTC, And Object Detection

- WebRTC YOLO example: https://modal.com/docs/examples/webrtc_yolo
- Roboflow realtime object detection in browser: https://blog.roboflow.com/real-time-object-detection-in-the-browser/
- WebRTC home surveillance design: https://webrtchacks.com/private-home-surveillance-with-the-webrtc-datachannel/

What we learned:
- WebRTC is the right default for low-latency browser video.
- Object detection can run either client-side or server-side; this choice should be documented as a privacy/performance tradeoff.

## AI Companion And Realtime Voice

- OpenAI Realtime API docs: https://developers.openai.com/api/docs/guides/realtime-webrtc
- LiveKit Agents docs: https://docs.livekit.io/agents/
- Pipecat: https://github.com/pipecat-ai/pipecat

What we learned:
- Voice/video AI projects need explicit session, memory, and permission boundaries.
- The project should not pretend the AI can do human-only auth or sensitive actions.

## Local-First Collaboration

- Yjs documentation: https://docs.yjs.dev/
- y-websocket provider: https://docs.yjs.dev/ecosystem/connection-provider/y-websocket

What we learned:
- CRDTs are a practical way to discuss conflict-free collaboration.
- Presence should be treated separately from durable document state.

