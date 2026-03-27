type InitiativeSummaryProgressProps = {
  completionPercent: number;
  completedCards: number;
  totalCards: number;
  title?: string;
};

export function InitiativeSummaryProgress({
  completionPercent,
  completedCards,
  totalCards,
  title,
}: InitiativeSummaryProgressProps) {
  const safePercent = Math.max(0, Math.min(100, completionPercent));
  return (
    <div className="initiative-summary-progress-content" title={title}>
      <span
        className="initiative-summary-progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={completionPercent}
      >
        <span className="initiative-summary-progress-fill" style={{ width: `${safePercent}%` }} />
      </span>
      <span className="initiative-summary-progress-label">
        {completionPercent.toFixed(1).replace(/\.0$/, "")}% ({completedCards}/{totalCards})
      </span>
    </div>
  );
}
