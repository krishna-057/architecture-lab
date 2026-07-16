"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type SessionStatus = "waiting_for_camera" | "pairing" | "streaming" | "ended";
type ShellStatus = "idle" | "creating" | "waiting" | "pairing" | "streaming" | "ended" | "error";

type SessionResponse = {
  session_id: string;
  device_label: string;
  status: SessionStatus;
  pairing_code: string;
  signaling_path: string;
  created_at: string;
  expires_at: string;
};

type SignalMessage = {
  message_id: string;
  sequence: number;
  sender_role: "camera" | "dashboard";
  recipient_role: "camera" | "dashboard";
  type: "offer" | "answer" | "ice-candidate" | "ready" | "bye";
  payload: unknown;
  created_at: string;
};

type DetectionEvent = {
  event_id: string;
  label: string;
  confidence: number;
  occurred_at: string;
};

type StreamState = "empty" | "waiting_offer" | "answering" | "connecting" | "streaming" | "error";

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
    throw new Error(`API request failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
}

function formatClock(value: string) {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

function statusFromSession(session: SessionResponse | null): ShellStatus {
  if (!session) {
    return "idle";
  }

  if (session.status === "waiting_for_camera") {
    return "waiting";
  }

  return session.status;
}

function isSessionDescription(payload: unknown): payload is RTCSessionDescriptionInit {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "type" in payload &&
    "sdp" in payload &&
    typeof payload.type === "string" &&
    typeof payload.sdp === "string"
  );
}

function isIceCandidate(payload: unknown): payload is RTCIceCandidateInit {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "candidate" in payload &&
    typeof payload.candidate === "string"
  );
}

export default function DashboardHome() {
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const processedSignalIdsRef = useRef<Set<string>>(new Set());
  const queuedIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const messageCounterRef = useRef(0);
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [signals, setSignals] = useState<SignalMessage[]>([]);
  const [detections, setDetections] = useState<DetectionEvent[]>([]);
  const [status, setStatus] = useState<ShellStatus>("idle");
  const [streamState, setStreamState] = useState<StreamState>("empty");
  const [message, setMessage] = useState("Create a viewing session to receive a camera pairing code.");

  const lastSignalSequence = useMemo(
    () => signals.reduce((latest, signal) => Math.max(latest, signal.sequence), 0),
    [signals]
  );
  const sessionId = session?.session_id;
  const hasOffer = signals.some((signal) => signal.type === "offer");

  const closePeerConnection = useCallback(() => {
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
    queuedIceCandidatesRef.current = [];
    remoteStreamRef.current = null;

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
  }, []);

  const postSignal = useCallback(
    async (
      targetSessionId: string,
      type: "answer" | "ice-candidate" | "bye",
      payload: RTCSessionDescriptionInit | RTCIceCandidateInit | Record<string, unknown>
    ) => {
      messageCounterRef.current += 1;
      await requestJson<SignalMessage>(`/api/sessions/${targetSessionId}/signal`, {
        method: "POST",
        body: JSON.stringify({
          sender_role: "dashboard",
          type,
          payload,
          client_message_id: `dashboard-${messageCounterRef.current}`
        })
      });
    },
    []
  );

  const ensurePeerConnection = useCallback(
    (targetSessionId: string) => {
      if (peerConnectionRef.current) {
        return peerConnectionRef.current;
      }

      if (!window.RTCPeerConnection) {
        throw new Error("This browser does not support WebRTC peer connections.");
      }

      const peerConnection = new RTCPeerConnection();
      peerConnectionRef.current = peerConnection;

      peerConnection.ontrack = (event) => {
        if (!remoteStreamRef.current) {
          remoteStreamRef.current = new MediaStream();
        }

        remoteStreamRef.current.addTrack(event.track);

        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStreamRef.current;
          void remoteVideoRef.current.play().catch(() => {
            setMessage("Remote video is connected. Tap the video if the browser pauses playback.");
          });
        }

        setStreamState("streaming");
        setMessage("Live camera stream connected.");
      };

      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          void postSignal(targetSessionId, "ice-candidate", event.candidate.toJSON()).catch((error) => {
            setStreamState("error");
            setMessage(error instanceof Error ? error.message : "Could not send dashboard ICE candidate.");
          });
        }
      };

      peerConnection.onconnectionstatechange = () => {
        if (peerConnection.connectionState === "connected") {
          setStreamState("streaming");
          setMessage("Live camera stream connected.");
        }

        if (peerConnection.connectionState === "failed") {
          setStreamState("error");
          setMessage("WebRTC connection failed. Create a new session and pair again.");
        }
      };

      return peerConnection;
    },
    [postSignal]
  );

  const applyQueuedIceCandidates = useCallback(async (peerConnection: RTCPeerConnection) => {
    const queuedCandidates = queuedIceCandidatesRef.current;
    queuedIceCandidatesRef.current = [];

    for (const candidate of queuedCandidates) {
      await peerConnection.addIceCandidate(candidate);
    }
  }, []);

  const handleDashboardSignal = useCallback(
    async (signal: SignalMessage, targetSessionId: string) => {
      if (processedSignalIdsRef.current.has(signal.message_id)) {
        return;
      }
      processedSignalIdsRef.current.add(signal.message_id);

      if (signal.type === "offer") {
        if (!isSessionDescription(signal.payload) || signal.payload.type !== "offer") {
          throw new Error("Camera sent an invalid WebRTC offer.");
        }

        setStreamState("answering");
        setMessage("Camera offer received. Creating dashboard answer...");

        const peerConnection = ensurePeerConnection(targetSessionId);
        await peerConnection.setRemoteDescription(signal.payload);
        await applyQueuedIceCandidates(peerConnection);

        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        if (!peerConnection.localDescription) {
          throw new Error("Browser did not create a dashboard WebRTC answer.");
        }

        await postSignal(targetSessionId, "answer", {
          type: peerConnection.localDescription.type,
          sdp: peerConnection.localDescription.sdp
        });

        setStreamState("connecting");
        setMessage("Dashboard answer sent. Waiting for the camera stream...");
        return;
      }

      if (signal.type === "ice-candidate") {
        if (!isIceCandidate(signal.payload)) {
          return;
        }

        const peerConnection = peerConnectionRef.current;
        if (!peerConnection?.remoteDescription) {
          queuedIceCandidatesRef.current.push(signal.payload);
          return;
        }

        await peerConnection.addIceCandidate(signal.payload);
        return;
      }

      if (signal.type === "bye") {
        closePeerConnection();
        setStreamState("empty");
        setMessage("Camera ended the stream.");
      }
    },
    [applyQueuedIceCandidates, closePeerConnection, ensurePeerConnection, postSignal]
  );

  useEffect(() => {
    return () => closePeerConnection();
  }, [closePeerConnection]);

  useEffect(() => {
    if (!sessionId || status === "ended" || status === "error") {
      return;
    }

    const interval = window.setInterval(async () => {
      try {
        const latest = await requestJson<SessionResponse>(`/api/sessions/${sessionId}`);
        setSession(latest);
        setStatus(statusFromSession(latest));

        const nextSignals = await requestJson<SignalMessage[]>(
          `/api/sessions/${sessionId}/signal?recipient_role=dashboard&after_sequence=${lastSignalSequence}`
        );

        if (nextSignals.length > 0) {
          setSignals((current) => [...current, ...nextSignals]);
          for (const signal of nextSignals) {
            await handleDashboardSignal(signal, sessionId);
          }
        }
      } catch (error) {
        setStatus("error");
        setStreamState("error");
        setMessage(error instanceof Error ? error.message : "Could not poll the pairing session.");
      }
    }, 1600);

    return () => window.clearInterval(interval);
  }, [handleDashboardSignal, lastSignalSequence, sessionId, status]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    const interval = window.setInterval(async () => {
      try {
        const nextDetections = await requestJson<DetectionEvent[]>(
          `/api/sessions/${sessionId}/detections`
        );
        setDetections(nextDetections);
      } catch {
        // Detection polling should not interrupt the pairing workflow.
      }
    }, 5000);

    return () => window.clearInterval(interval);
  }, [sessionId]);

  async function createSession() {
    setStatus("creating");
    setMessage("Creating dashboard session...");
    setSession(null);
    setSignals([]);
    setDetections([]);
    processedSignalIdsRef.current = new Set();
    messageCounterRef.current = 0;
    closePeerConnection();
    setStreamState("waiting_offer");

    try {
      const created = await requestJson<SessionResponse>("/api/sessions", {
        method: "POST",
        body: JSON.stringify({ device_label: "Front Door Watch" })
      });

      setSession(created);
      setStatus(statusFromSession(created));
      setMessage("Share the pairing code with the camera phone.");
    } catch (error) {
      setStatus("error");
      setStreamState("error");
      setMessage(error instanceof Error ? error.message : "Could not create a dashboard session.");
    }
  }

  const statusLabel = {
    idle: "No session",
    creating: "Creating",
    waiting: "Waiting",
    pairing: "Pairing",
    streaming: "Streaming",
    ended: "Ended",
    error: "Needs API"
  }[status];

  const pairingExpiresAt = session ? formatClock(session.expires_at) : "--";
  const streamLabel = {
    empty: session ? "Waiting for offer" : "Not started",
    waiting_offer: "Waiting for offer",
    answering: "Answering",
    connecting: "Connecting",
    streaming: "Streaming",
    error: "Connection error"
  }[streamState];

  return (
    <main className="dashboard-shell">
      <section className="viewer" aria-label="Live camera viewer">
        <div className="viewer-header">
          <div>
            <span>Live room</span>
            <strong>{session?.device_label ?? "Front Door Watch"}</strong>
          </div>
          <button type="button" onClick={createSession} disabled={status === "creating"}>
            {session ? "New Session" : status === "creating" ? "Creating..." : "Pair Camera"}
          </button>
        </div>
        <div className="session-panel" aria-label="Pairing session">
          <div>
            <span>Status</span>
            <strong data-status={status}>{statusLabel}</strong>
          </div>
          <div>
            <span>Pairing code</span>
            <strong className="pairing-code">{session?.pairing_code ?? "------"}</strong>
          </div>
          <div>
            <span>Expires</span>
            <strong>{pairingExpiresAt}</strong>
          </div>
          <div>
            <span>Signaling</span>
            <strong>{streamLabel}</strong>
          </div>
        </div>
        <div className="video-frame" data-active={hasOffer || status === "streaming"}>
          <video ref={remoteVideoRef} aria-label="Remote camera stream" autoPlay playsInline />
          {streamState !== "streaming" ? <p>{message}</p> : null}
        </div>
        <div className="signal-log" aria-label="Signaling messages">
          <span>Signal log</span>
          {signals.length === 0 ? (
            <p>No camera messages yet.</p>
          ) : (
            signals.slice(-5).map((signal) => (
              <div className="signal-row" key={signal.message_id}>
                <time>{formatClock(signal.created_at)}</time>
                <strong>{signal.type}</strong>
                <span>#{signal.sequence}</span>
              </div>
            ))
          )}
        </div>
      </section>
      <aside className="timeline" aria-label="Detection timeline">
        <div className="timeline-header">
          <span>Detections</span>
          <strong>{detections.length} events</strong>
        </div>
        {detections.length === 0 ? <p className="empty-state">No detection events yet.</p> : null}
        {detections.map((event) => (
          <article className="event-row" key={event.event_id}>
            <time>{formatClock(event.occurred_at)}</time>
            <div>
              <strong>{event.label}</strong>
              <span>{Math.round(event.confidence * 100)}%</span>
            </div>
          </article>
        ))}
      </aside>
    </main>
  );
}
