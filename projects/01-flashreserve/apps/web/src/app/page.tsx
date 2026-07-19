const stockRows = [
  { label: "Total", value: 250 },
  { label: "Reserved", value: 61 },
  { label: "Sold", value: 124 },
  { label: "Available", value: 65 }
];

export default function Home() {
  return (
    <main className="shell">
      <section className="drop-panel">
        <div>
          <p className="eyebrow">FlashReserve drop</p>
          <h1>Limited stock, honest reservations.</h1>
          <p className="summary">
            A portfolio flash-sale system focused on preventing oversells, expiring abandoned checkout holds, and keeping stock updates explainable.
          </p>
        </div>
        <div className="stock-grid" aria-label="Inventory summary">
          {stockRows.map((row) => (
            <div className="stock-cell" key={row.label}>
              <span>{row.label}</span>
              <strong>{row.value}</strong>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
