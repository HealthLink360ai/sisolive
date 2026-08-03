// Ported verbatim from index.html (~lines 2830-2838)
export default function ConfidenceArc({ value }) {
  const color = value >= 75 ? 'var(--teal)' : 'var(--warn)';
  const bg = `conic-gradient(${color} ${value * 3.6}deg, var(--paper-2) 0deg)`;
  return (
    <div className="conf-arc" style={{ background: bg }}>
      <div className="conf-arc-inner">{value}</div>
    </div>
  );
}
