import { h } from "preact";
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { TeamInsightsResponse, fetchTeamInsights } from "../../../lib/api";

const EMPTY_INSIGHTS: TeamInsightsResponse = {
  source: "local",
  metrics: {
    avgCommittedStoryPoints: 0,
    avgCompletedStoryPoints: 0,
    completionRatioPercent: 0,
    carryoverPercent: 0,
    avgCycleTimeDays: null,
    maxCycleTimeDays: null,
    medianCycleTimeDays: null,
  },
  trend: [],
  workMix: {
    sprintId: null,
    sprintName: null,
    totalIssues: 0,
    slices: [],
  },
  summary: "Work mix will appear once sprint data is synced.",
  error: null,
};

function formatStoryPoints(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "0";
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1).replace(/\.0$/, "");
}

function formatDays(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return `${value.toFixed(1).replace(/\.0$/, "")} d`;
}

export function TeamInsightsScreen() {
  const [insights, setInsights] = useState<TeamInsightsResponse>(EMPTY_INSIGHTS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadInsights = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchTeamInsights();
      setInsights(payload);
      if (payload.error) {
        setError(payload.error);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown team insights request failure.";
      setError(message);
      setInsights(EMPTY_INSIGHTS);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInsights().catch(() => {
      // Local state handles request failures.
    });
  }, [loadInsights]);

  const maxCompletedStoryPoints = useMemo(() => {
    if (insights.trend.length === 0) return 0;
    return Math.max(...insights.trend.map((point) => point.completedStoryPoints), 0);
  }, [insights.trend]);
  const trendRows = useMemo(() => [...insights.trend].reverse(), [insights.trend]);
  const trendWindow = insights.windowSize && insights.windowSize > 0
    ? insights.windowSize
    : insights.trend.length > 0
      ? insights.trend.length
      : 6;

  return (
    <div class="tb-screen-grid">
      <section class="tb-panel">
        <header class="tb-panel-header">
          <div>
            <h3>Sprint Trend</h3>
          </div>
          <span class="tb-chip">Live</span>
        </header>
        <p class="tb-muted-note tb-trend-window-note">Trend window: last {trendWindow} sprints including active sprint.</p>
        <div class="tb-metrics-grid tb-four-up">
          <article class="tb-metric-card">
            <h4>Median Cycle Time</h4>
            <strong class="tb-value">{formatDays(insights.metrics.medianCycleTimeDays)}</strong>
            <p>Middle cycle-time value across completed cards.</p>
          </article>
          <article class="tb-metric-card">
            <h4>Avg Cycle Time</h4>
            <strong class="tb-value">{formatDays(insights.metrics.avgCycleTimeDays)}</strong>
            <p>Average across completed cards in trend window.</p>
          </article>
          <article class="tb-metric-card">
            <h4>Max Cycle Time</h4>
            <strong class="tb-value">{formatDays(insights.metrics.maxCycleTimeDays)}</strong>
            <p>Longest completed-card cycle time in trend window.</p>
          </article>
          <article class="tb-metric-card">
            <h4>Avg SP</h4>
            <strong class="tb-value tb-value-good">{formatStoryPoints(insights.metrics.avgCompletedStoryPoints)} SP</strong>
            <p>Average completed story points per sprint.</p>
          </article>
        </div>
        <hr class="tb-section-divider" />
        <p class="tb-muted-note">Completed story points per sprint.</p>
        <div class="tb-bars">
          {trendRows.map((point) => (
            <div key={point.sprintId}>
              <p class="tb-muted-note">
                {point.sprintName}: {formatStoryPoints(point.completedStoryPoints)} SP
                {" | "}
                Avg cycle: {formatDays(point.avgCycleTimeDays)}
              </p>
              <div class="tb-bar">
                <span
                  style={{
                    width: `${maxCompletedStoryPoints > 0 ? Math.max((point.completedStoryPoints / maxCompletedStoryPoints) * 100, 2) : 0}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
        {loading ? <p class="tb-muted-note">Loading sprint trend...</p> : null}
        {error ?? insights.error ? <p class="tb-muted-note">Team insights error: {error ?? insights.error}</p> : null}
        {!loading && insights.trend.length === 0 ? <p class="tb-muted-note">No recent sprint trend data found.</p> : null}
      </section>
    </div>
  );
}
