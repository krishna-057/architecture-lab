"use client";

import { useEffect, useRef, useState } from "react";

type CaptureStatus = "idle" | "requesting" | "ready" | "blocked" | "unsupported";

const captureConstraints: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 1280 },
    height: { ideal: 720 }
  }
};

function permissionMessage(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "Camera access was blocked. Allow camera permission in the browser to start the stream.";
    }

    if (error.name === "NotFoundError" || error.name === "OverconstrainedError") {
      return "No usable camera was found on this device.";
    }
  }

  return "The camera could not start. Check browser permissions and try again.";
}

export default function CameraHome() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CaptureStatus>("idle");
  const [message, setMessage] = useState("Camera preview initializes after device permission.");

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function startCapture() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("unsupported");
      setMessage("This browser does not support camera capture.");
      return;
    }

    setStatus("requesting");
    setMessage("Waiting for camera permission...");

    try {
      const stream = await navigator.mediaDevices.getUserMedia(captureConstraints);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setStatus("ready");
      setMessage("Camera is ready for pairing.");
    } catch (error) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setStatus("blocked");
      setMessage(permissionMessage(error));
    }
  }

  function stopCapture() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setStatus("idle");
    setMessage("Camera preview initializes after device permission.");
  }

  const streamStats = [
    { label: "Mode", value: status === "ready" ? "Live camera" : "Permission first" },
    { label: "Transport", value: "WebRTC" },
    { label: "Retention", value: "Events only" }
  ];

  const statusLabel = {
    idle: "Standby",
    requesting: "Requesting",
    ready: "Ready",
    blocked: "Blocked",
    unsupported: "Unsupported"
  }[status];

  return (
    <main className="phone-shell">
      <section className="capture-surface" aria-label="Camera capture setup">
        <div className="top-bar">
          <span>SentinelCam</span>
          <strong data-status={status}>{statusLabel}</strong>
        </div>
        <div className="lens-frame" data-active={status === "ready"}>
          <video ref={videoRef} aria-label="Local camera preview" muted playsInline />
          <div className="focus-mark focus-mark-a" />
          <div className="focus-mark focus-mark-b" />
          {status !== "ready" ? <p>{message}</p> : null}
        </div>
        <p className="capture-message" role={status === "blocked" ? "alert" : "status"}>
          {message}
        </p>
        <div className="control-row">
          {status === "ready" ? (
            <button type="button" className="danger" onClick={stopCapture}>
              Stop
            </button>
          ) : (
            <button type="button" onClick={startCapture} disabled={status === "requesting"}>
              {status === "requesting" ? "Starting..." : "Start"}
            </button>
          )}
          <button type="button" className="secondary" disabled={status !== "ready"}>
            Pair
          </button>
        </div>
      </section>
      <section className="stat-strip" aria-label="Stream setup">
        {streamStats.map((stat) => (
          <div key={stat.label}>
            <span>{stat.label}</span>
            <strong>{stat.value}</strong>
          </div>
        ))}
      </section>
    </main>
  );
}
