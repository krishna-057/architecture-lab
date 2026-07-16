"use client";

import { useEffect, useRef, useState } from "react";

type CaptureStatus = "idle" | "requesting" | "ready" | "blocked" | "unsupported";
type PairingStatus = "idle" | "claiming" | "offering" | "offered" | "error";

type SessionResponse = {
  session_id: string;
  device_label: string;
  status: "waiting_for_camera" | "pairing" | "streaming" | "ended";
  pairing_code: string;
  signaling_path: string;
  created_at: string;
  expires_at: string;
};

const captureConstraints: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 1280 },
    height: { ideal: 720 }
  }
};

const apiBaseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8100").replace(/\/$/, "");

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers
    }
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(body?.detail ?? `API request failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
}

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
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const messageCounterRef = useRef(0);
  const [status, setStatus] = useState<CaptureStatus>("idle");
  const [pairingCode, setPairingCode] = useState("");
  const [pairingStatus, setPairingStatus] = useState<PairingStatus>("idle");
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [message, setMessage] = useState("Camera preview initializes after device permission.");
  const [pairingMessage, setPairingMessage] = useState("Enter the dashboard pairing code after camera preview is live.");

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      peerConnectionRef.current?.close();
    };
  }, []);

  function closePeerConnection() {
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
  }

  async function postSignal(
    sessionId: string,
    type: "offer" | "ice-candidate" | "bye",
    payload: RTCSessionDescriptionInit | RTCIceCandidateInit | Record<string, unknown>
  ) {
    messageCounterRef.current += 1;
    await requestJson(`/api/sessions/${sessionId}/signal`, {
      method: "POST",
      body: JSON.stringify({
        sender_role: "camera",
        type,
        payload,
        client_message_id: `camera-${messageCounterRef.current}`
      })
    });
  }

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
    closePeerConnection();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setStatus("idle");
    setPairingStatus("idle");
    setSession(null);
    setMessage("Camera preview initializes after device permission.");
    setPairingMessage("Enter the dashboard pairing code after camera preview is live.");
  }

  async function claimPairingAndSendOffer() {
    const stream = streamRef.current;
    const normalizedCode = pairingCode.trim().toUpperCase();

    if (!stream || status !== "ready") {
      setPairingStatus("error");
      setPairingMessage("Start the camera before pairing.");
      return;
    }

    if (!normalizedCode) {
      setPairingStatus("error");
      setPairingMessage("Enter the six-character dashboard pairing code.");
      return;
    }

    if (!window.RTCPeerConnection) {
      setPairingStatus("error");
      setPairingMessage("This browser does not support WebRTC peer connections.");
      return;
    }

    closePeerConnection();
    setPairingStatus("claiming");
    setPairingMessage("Claiming dashboard pairing code...");

    try {
      const claimed = await requestJson<SessionResponse>(`/api/pairings/${normalizedCode}/claim`, {
        method: "POST"
      });
      setSession(claimed);

      setPairingStatus("offering");
      setPairingMessage("Creating WebRTC offer from the active camera stream...");

      const peerConnection = new RTCPeerConnection();
      peerConnectionRef.current = peerConnection;

      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          void postSignal(claimed.session_id, "ice-candidate", event.candidate.toJSON()).catch((error) => {
            setPairingStatus("error");
            setPairingMessage(error instanceof Error ? error.message : "Could not send ICE candidate.");
          });
        }
      };

      for (const track of stream.getTracks()) {
        peerConnection.addTrack(track, stream);
      }

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      const localDescription = peerConnection.localDescription;

      if (!localDescription) {
        throw new Error("Browser did not create a local WebRTC description.");
      }

      await postSignal(claimed.session_id, "offer", {
        type: localDescription.type,
        sdp: localDescription.sdp
      });

      setPairingStatus("offered");
      setPairingMessage("Offer sent. Keep this page open while the dashboard answer path is added.");
    } catch (error) {
      closePeerConnection();
      setPairingStatus("error");
      setSession(null);
      setPairingMessage(error instanceof Error ? error.message : "Could not pair with the dashboard.");
    }
  }

  const streamStats = [
    { label: "Mode", value: status === "ready" ? "Live camera" : "Permission first" },
    { label: "Transport", value: "WebRTC" },
    { label: "Session", value: session ? session.status : "Unpaired" }
  ];

  const statusLabel = {
    idle: "Standby",
    requesting: "Requesting",
    ready: "Ready",
    blocked: "Blocked",
    unsupported: "Unsupported"
  }[status];
  const canPair = status === "ready" && (pairingStatus === "idle" || pairingStatus === "error");
  const pairButtonLabel = {
    idle: "Pair",
    claiming: "Claiming...",
    offering: "Offering...",
    offered: "Offer Sent",
    error: "Retry"
  }[pairingStatus];

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
        </div>
        <form
          className="pairing-panel"
          onSubmit={(event) => {
            event.preventDefault();
            void claimPairingAndSendOffer();
          }}
        >
          <label htmlFor="pairing-code">Pairing code</label>
          <div>
            <input
              id="pairing-code"
              inputMode="text"
              autoCapitalize="characters"
              maxLength={6}
              value={pairingCode}
              onChange={(event) => setPairingCode(event.target.value.toUpperCase())}
              placeholder="ABC123"
              disabled={status !== "ready" || pairingStatus === "claiming" || pairingStatus === "offering"}
            />
            <button type="submit" className="secondary" disabled={!canPair}>
              {pairButtonLabel}
            </button>
          </div>
          <p role={pairingStatus === "error" ? "alert" : "status"}>{pairingMessage}</p>
        </form>
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
