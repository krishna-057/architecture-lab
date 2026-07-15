const streamStats = [
  { label: "Mode", value: "Camera" },
  { label: "Transport", value: "WebRTC" },
  { label: "Retention", value: "Events only" }
];

export default function CameraHome() {
  return (
    <main className="phone-shell">
      <section className="capture-surface" aria-label="Camera preview placeholder">
        <div className="top-bar">
          <span>SentinelCam</span>
          <strong>Standby</strong>
        </div>
        <div className="lens-frame">
          <div className="focus-mark focus-mark-a" />
          <div className="focus-mark focus-mark-b" />
          <p>Camera preview initializes after device permission.</p>
        </div>
        <div className="control-row">
          <button type="button">Start</button>
          <button type="button" className="secondary">
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
