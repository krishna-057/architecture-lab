"use client";

import { useEffect, useMemo, useState } from "react";

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
  created_at: string;
};

type DetectionEvent = {
  event_id: string;
  label: string;
  confidence: number;
  occurred_at: string;
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

export default function DashboardHome() {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [signals, setSignals] = useState<SignalMessage[]>([]);
  const [detections, setDetections] = useState<DetectionEvent[]>([]);
  const [status, setStatus] = useState<ShellStatus>("idle");
  const [message, setMessage] = useState("Create a viewing session to receive a camera pairing code.");

  const lastSignalSequence = useMemo(
    () => signals.reduce((latest, signal) => Math.max(latest, signal.sequence), 0),
    [signals]
  );
  const sessionId = session?.session_id;
  const hasOffer = signals.some((signal) => signal.type === "offer");

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
          setMessage(
            nextSignals.some((signal) => signal.type === "offer")
              ? "Camera offer received. The WebRTC answer path is ready for the next slice."
              : "Camera signaling activity received."
          );
        }
      } catch (error) {
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "Could not poll the pairing session.");
      }
    }, 1600);

    return () => window.clearInterval(interval);
  }, [lastSignalSequence, sessionId, status]);

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
  const streamLabel = hasOffer ? "Offer received" : session ? "Waiting for offer" : "Not started";

  return (
    <main className="dashboard-shell">
      <section className="viewer" aria-label="Live camera viewer placeholder">
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
          <p>{message}</p>
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
