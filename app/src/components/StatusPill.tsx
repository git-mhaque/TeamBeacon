type Tone = "neutral" | "good" | "warn" | "risk";

type StatusPillProps = {
  tone?: Tone;
  text: string;
};

export function StatusPill({ tone = "neutral", text }: StatusPillProps) {
  return <span className={`status-pill pill-${tone}`}>{text}</span>;
}

