import { h } from "preact";
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { TeamInsightsResponse, fetchTeamInsights } from "../../../lib/api";

const TREND_WINDOW_OPTIONS = [4, 6, 8, 10, 12] as const;

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
  statusCycleTime: {
    trackedIssues: 0,
    totalDays: 0,
    rows: [],
  },
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

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return `${value.toFixed(1).replace(/\.0$/, "")}%`;
}

function formatDate(value: string | null | undefined, monthStyle: "short" | "numeric"): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  const month = monthStyle === "short"
    ? parsed.toLocaleString("en-US", { month: "short", timeZone: "UTC" })
    : String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const year = String(parsed.getUTCFullYear());
  return `${day}-${month}-${year}`;
}

function formatSprintDateRange(startDate: string | null | undefined, endDate: string | null | undefined): string {
  return `from ${formatDate(startDate, "short")} to ${formatDate(endDate, "short")}`;
}

function isInProgressRelatedStatus(status: string | null | undefined): boolean {
  const normalized = (status ?? "").trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.includes("in progress")) return true;
  if (normalized.startsWith("qa")) return true;
  return [
    "analysis",
    "in review",
    "testing",
    "blocked",
    "awaiting cab approval",
    "kickoff",
    "release ready",
  ].includes(normalized);
}

function normalizeTrendWindow(value: number): number {
  return TREND_WINDOW_OPTIONS.includes(value as typeof TREND_WINDOW_OPTIONS[number]) ? value : 6;
}

export function TeamInsightsScreen() {
  const [insights, setInsights] = useState<TeamInsightsResponse>(EMPTY_INSIGHTS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trendWindowSelection, setTrendWindowSelection] = useState<number>(6);

  const loadInsights = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchTeamInsights(trendWindowSelection);
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
  }, [trendWindowSelection]);

  useEffect(() => {
    loadInsights().catch(() => {
      // Local state handles request failures.
    });
  }, [loadInsights]);

  const maxCompletedStoryPoints = useMemo(() => {
    if (insights.trend.length === 0) return 0;
    return Math.max(...insights.trend.map((point) => point.completedStoryPoints), 0);
  }, [insights.trend]);
  const maxSprintAvgCycleTimeDays = useMemo(() => {
    if (insights.trend.length === 0) return 0;
    return Math.max(...insights.trend.map((point) => point.avgCycleTimeDays ?? 0), 0);
  }, [insights.trend]);
  const inProgressStatusCycleRows = useMemo(
    () => insights.statusCycleTime.rows.filter((row) => isInProgressRelatedStatus(row.status)),
    [insights.statusCycleTime.rows],
  );
  const maxStatusCycleTotalDays = useMemo(() => {
    if (inProgressStatusCycleRows.length === 0) return 0;
    return Math.max(...inProgressStatusCycleRows.map((row) => row.totalDays), 0);
  }, [inProgressStatusCycleRows]);
  const trendRows = useMemo(() => [...insights.trend].reverse(), [insights.trend]);

  return (
    <div class="tb-screen-grid">
      <section class="tb-panel">
        <header class="tb-panel-header">
          <div>
            <h3>Sprint Trend</h3>
          </div>
        </header>
        <div class="tb-trend-window-inline">
          <label for="tb-trend-window-select">Trend Window</label>
          <select
            id="tb-trend-window-select"
            value={String(trendWindowSelection)}
            onChange={(event) => {
              const nextValue = Number.parseInt((event.currentTarget as HTMLSelectElement).value, 10);
              setTrendWindowSelection(normalizeTrendWindow(nextValue));
            }}
          >
            {TREND_WINDOW_OPTIONS.map((value) => (
              <option key={value} value={String(value)}>
                Last {value} sprints
              </option>
            ))}
          </select>
        </div>
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
        <p class="tb-muted-note tb-trend-order-note">Recent sprint is shown at the top of each chart.</p>
        <div class="tb-metrics-grid tb-two-up">
          <article class="tb-metric-card">
            <h4>Avg Cycle Time by Sprint</h4>
            <div class="tb-bars">
              {trendRows.map((point) => {
                const sprintAvgCycleTimeDays = point.avgCycleTimeDays ?? 0;
                return (
                  <div key={`cycle-${point.sprintId}`}>
                    <p class="tb-sprint-bar-label">
                      <span class="tb-sprint-bar-name">
                        {point.state?.toLowerCase() === "active" ? (
                          <span class="tb-sprint-active-icon" title="Active sprint" aria-hidden="true" />
                        ) : null}
                        {point.sprintName} ({formatSprintDateRange(point.startDate, point.endDate)})
                      </span>
                      <span class="tb-chip tb-sprint-bar-pill">{formatDays(point.avgCycleTimeDays)}</span>
                    </p>
                    <div class="tb-bar">
                      <span
                        style={{
                          width: `${maxSprintAvgCycleTimeDays > 0
                            ? Math.max((sprintAvgCycleTimeDays / maxSprintAvgCycleTimeDays) * 100, sprintAvgCycleTimeDays > 0 ? 2 : 0)
                            : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </article>

          <article class="tb-metric-card">
            <h4>Completed SP by Sprint</h4>
            <div class="tb-bars">
              {trendRows.map((point) => (
                <div key={`sp-${point.sprintId}`}>
                  <p class="tb-sprint-bar-label">
                    <span class="tb-sprint-bar-name">
                      {point.state?.toLowerCase() === "active" ? (
                        <span class="tb-sprint-active-icon" title="Active sprint" aria-hidden="true" />
                      ) : null}
                      {point.sprintName} ({formatSprintDateRange(point.startDate, point.endDate)})
                    </span>
                    <span class="tb-chip tb-sprint-bar-pill">{formatStoryPoints(point.completedStoryPoints)} SP</span>
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
          </article>
        </div>
        {loading ? <p class="tb-muted-note">Loading sprint trend...</p> : null}
        {error ?? insights.error ? <p class="tb-muted-note">Team insights error: {error ?? insights.error}</p> : null}
        {!loading && insights.trend.length === 0 ? <p class="tb-muted-note">No recent sprint trend data found.</p> : null}
      </section>
      <section class="tb-panel">
        <header class="tb-panel-header">
          <div>
            <h3>Status-Level Cycle Time (Last {trendWindowSelection} sprints)</h3>
          </div>
        </header>
        <p class="tb-muted-note">Time spent in in-progress workflow statuses across completed cards in the selected trend window.</p>
        <p class="tb-muted-note">Tracked completed cards: {insights.statusCycleTime.trackedIssues}</p>
        {loading ? <p class="tb-muted-note">Loading status-level cycle time...</p> : null}
        {!loading && inProgressStatusCycleRows.length === 0 ? (
          <p class="tb-muted-note">No in-progress status cycle-time data found for completed cards.</p>
        ) : null}
        {inProgressStatusCycleRows.length > 0 ? (
          <article class="tb-metric-card">
            <div class="tb-bars">
              {inProgressStatusCycleRows.map((row) => (
                <div key={`status-cycle-${row.status}`}>
                  <p class="tb-sprint-bar-label">
                    <span class="tb-sprint-bar-name tb-status-cycle-name">{row.status}</span>
                    <span class="tb-status-cycle-pill-wrap">
                      <span class="tb-chip tb-sprint-bar-pill">{formatDays(row.avgDays)} avg</span>
                      <span class="tb-chip tb-sprint-bar-pill">{formatDays(row.totalDays)} total</span>
                      <span class="tb-chip tb-sprint-bar-pill">{formatPercent(row.percentOfCycleTime)}</span>
                    </span>
                  </p>
                  <div class="tb-bar">
                    <span
                      style={{
                        width: `${maxStatusCycleTotalDays > 0
                          ? Math.max((row.totalDays / maxStatusCycleTotalDays) * 100, row.totalDays > 0 ? 2 : 0)
                          : 0}%`,
                      }}
                    />
                  </div>
                  <p class="tb-muted-note tb-status-cycle-meta">
                    {row.issueCount} card{row.issueCount === 1 ? "" : "s"} · median {formatDays(row.medianDays)} · p85{" "}
                    {formatDays(row.p85Days)}
                  </p>
                </div>
              ))}
            </div>
          </article>
        ) : null}
      </section>
    </div>
  );
}
