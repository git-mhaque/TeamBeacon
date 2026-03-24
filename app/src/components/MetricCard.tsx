type Tone = "neutral" | "good" | "warn" | "risk";

type MetricCardProps = {
  label: string;
  value: string;
  hint: string;
  tone?: Tone;
};

export function MetricCard({ label, value, hint, tone = "neutral" }: MetricCardProps) {
  return (
    <article className="metric-card">
      <span className="metric-label">{label}</span>
      <strong className={`metric-value metric-${tone}`}>{value}</strong>
      <small className="metric-hint">{hint}</small>
    </article>
  );
}

