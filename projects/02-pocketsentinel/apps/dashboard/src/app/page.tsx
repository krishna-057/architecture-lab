const detections = [
  { time: "12:04:18", label: "person", confidence: "91%" },
  { time: "12:04:41", label: "backpack", confidence: "78%" },
  { time: "12:05:03", label: "person", confidence: "88%" }
];

export default function DashboardHome() {
  return (
    <main className="dashboard-shell">
      <section className="viewer" aria-label="Live camera viewer placeholder">
        <div className="viewer-header">
          <div>
            <span>Live room</span>
            <strong>Front Door Watch</strong>
          </div>
          <button type="button">Pair Camera</button>
        </div>
        <div className="video-frame">
          <p>Incoming WebRTC stream will render here.</p>
        </div>
      </section>
      <aside className="timeline" aria-label="Detection timeline">
        <div className="timeline-header">
          <span>Detections</span>
          <strong>3 events</strong>
        </div>
        {detections.map((event) => (
          <article className="event-row" key={`${event.time}-${event.label}`}>
            <time>{event.time}</time>
            <div>
              <strong>{event.label}</strong>
              <span>{event.confidence}</span>
            </div>
          </article>
        ))}
      </aside>
    </main>
  );
}
