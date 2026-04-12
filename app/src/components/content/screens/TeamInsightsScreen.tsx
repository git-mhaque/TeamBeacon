import { h } from "preact";
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { TeamInsightsResponse, fetchTeamInsights } from "../../../lib/api";

const TREND_WINDOW_OPTIONS = [1, 2, 3, 4, 6, 8, 10, 12] as const;

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

function formatTrendWindowLabel(value: number): string {
  if (value === 1) return "1 sprint";
  return `Last ${value} sprints`;
}

type StatusCycleSortField = "status" | "issueCount" | "avgDays" | "percentOfCycleTime";
type StatusCycleSortDirection = "asc" | "desc";

const STATUS_CYCLE_PIE_COLORS = [
  "#2e79d8",
  "#1f8f63",
  "#b77700",
  "#c2372e",
  "#6c4ba6",
  "#1c6f9a",
  "#8a4f00",
  "#4a6b2d",
];

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

function compareNumber(left: number, right: number): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function roundMetric(value: number): number {
  return Math.round(value * 100) / 100;
}

function defaultSortDirectionForStatusCycleField(field: StatusCycleSortField): StatusCycleSortDirection {
  return field === "status" ? "asc" : "desc";
}

export function TeamInsightsScreen() {
  const [insights, setInsights] = useState<TeamInsightsResponse>(EMPTY_INSIGHTS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trendWindowSelection, setTrendWindowSelection] = useState<number>(6);
  const [statusCycleSortField, setStatusCycleSortField] = useState<StatusCycleSortField>("percentOfCycleTime");
  const [statusCycleSortDirection, setStatusCycleSortDirection] = useState<StatusCycleSortDirection>("desc");

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
  const inProgressStatusCycleRows = useMemo(() => {
    const filteredRows = insights.statusCycleTime.rows.filter((row) => isInProgressRelatedStatus(row.status));
    const filteredTotalDays = filteredRows.reduce((sum, row) => sum + row.totalDays, 0);
    return filteredRows.map((row) => ({
      ...row,
      percentOfCycleTime: filteredTotalDays > 0 ? roundMetric((row.totalDays / filteredTotalDays) * 100.0) : 0,
    }));
  }, [insights.statusCycleTime.rows]);
  const statusCyclePieSlices = useMemo(() => {
    const rows = [...inProgressStatusCycleRows].sort((left, right) => right.percentOfCycleTime - left.percentOfCycleTime);
    return rows.map((row, index) => ({
      ...row,
      color: STATUS_CYCLE_PIE_COLORS[index % STATUS_CYCLE_PIE_COLORS.length],
    }));
  }, [inProgressStatusCycleRows]);
  const statusCyclePieGradient = useMemo(() => {
    if (statusCyclePieSlices.length === 0) {
      return "conic-gradient(#dfe8f8 0% 100%)";
    }
    let cursor = 0;
    const segments: string[] = [];
    for (const slice of statusCyclePieSlices) {
      const start = cursor;
      const end = Math.min(start + slice.percentOfCycleTime, 100);
      segments.push(`${slice.color} ${start}% ${end}%`);
      cursor = end;
    }
    if (cursor < 100) {
      segments.push(`#dfe8f8 ${cursor}% 100%`);
    }
    return `conic-gradient(${segments.join(", ")})`;
  }, [statusCyclePieSlices]);
  const sortedStatusCycleRows = useMemo(() => {
    const nextRows = [...inProgressStatusCycleRows];
    nextRows.sort((left, right) => {
      let comparison = 0;
      switch (statusCycleSortField) {
        case "status":
          comparison = compareText(left.status, right.status);
          break;
        case "issueCount":
          comparison = compareNumber(left.issueCount, right.issueCount);
          break;
        case "avgDays":
          comparison = compareNumber(left.avgDays, right.avgDays);
          break;
        case "percentOfCycleTime":
          comparison = compareNumber(left.percentOfCycleTime, right.percentOfCycleTime);
          break;
      }

      if (comparison === 0) {
        comparison = compareText(left.status, right.status);
      }
      return statusCycleSortDirection === "asc" ? comparison : -comparison;
    });
    return nextRows;
  }, [inProgressStatusCycleRows, statusCycleSortDirection, statusCycleSortField]);

  const handleStatusCycleSortHeaderClick = useCallback((field: StatusCycleSortField) => {
    setStatusCycleSortField((current) => {
      if (current === field) {
        setStatusCycleSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
        return current;
      }
      setStatusCycleSortDirection(defaultSortDirectionForStatusCycleField(field));
      return field;
    });
  }, []);

  const resolveSortIndicator = useCallback((field: StatusCycleSortField): string => {
    if (statusCycleSortField !== field) return "↕";
    return statusCycleSortDirection === "asc" ? "↑" : "↓";
  }, [statusCycleSortDirection, statusCycleSortField]);

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
                {formatTrendWindowLabel(value)}
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
        <p class="tb-trend-order-pill">
          Recent sprint is shown at the top of each chart. The green dot marks the active sprint.
        </p>
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
            <h3>Cycle Time Breakdown ({formatTrendWindowLabel(trendWindowSelection)})</h3>
          </div>
        </header>
        <div class="tb-trend-order-pill tb-status-cycle-info-pill">
          <p>Time spent in in-progress workflow statuses across completed cards in the selected trend window.</p>
          <p>% Cycle Time is normalized within visible in-progress statuses.</p>
          <p>Tracked completed cards: {insights.statusCycleTime.trackedIssues}</p>
        </div>
        {loading ? <p class="tb-muted-note">Loading status-level cycle time...</p> : null}
        {!loading && inProgressStatusCycleRows.length === 0 ? (
          <p class="tb-muted-note">No in-progress status cycle-time data found for completed cards.</p>
        ) : null}
        {sortedStatusCycleRows.length > 0 ? (
          <div class="tb-status-cycle-layout">
            <div class="tb-status-cycle-table-wrap">
              <table class="tb-status-cycle-table" aria-label="Status cycle time table">
                <thead>
                  <tr>
                    <th>
                      <button
                        type="button"
                        class={`tb-table-sort${statusCycleSortField === "status" ? " is-active" : ""}`}
                        onClick={() => handleStatusCycleSortHeaderClick("status")}
                        aria-label={`Sort by Status (${statusCycleSortField === "status" && statusCycleSortDirection === "asc" ? "ascending" : "descending"})`}
                      >
                        <span>Status</span>
                        <span class="tb-table-sort-indicator" aria-hidden="true">{resolveSortIndicator("status")}</span>
                      </button>
                    </th>
                    <th class="is-numeric">
                      <button
                        type="button"
                        class={`tb-table-sort${statusCycleSortField === "issueCount" ? " is-active" : ""}`}
                        onClick={() => handleStatusCycleSortHeaderClick("issueCount")}
                        aria-label={`Sort by Issue Count (${statusCycleSortField === "issueCount" && statusCycleSortDirection === "asc" ? "ascending" : "descending"})`}
                      >
                        <span>Cards</span>
                        <span class="tb-table-sort-indicator" aria-hidden="true">{resolveSortIndicator("issueCount")}</span>
                      </button>
                    </th>
                    <th class="is-numeric">
                      <button
                        type="button"
                        class={`tb-table-sort${statusCycleSortField === "avgDays" ? " is-active" : ""}`}
                        onClick={() => handleStatusCycleSortHeaderClick("avgDays")}
                        aria-label={`Sort by Avg Days (${statusCycleSortField === "avgDays" && statusCycleSortDirection === "asc" ? "ascending" : "descending"})`}
                      >
                        <span>Avg Days</span>
                        <span class="tb-table-sort-indicator" aria-hidden="true">{resolveSortIndicator("avgDays")}</span>
                      </button>
                    </th>
                    <th class="is-numeric">
                      <button
                        type="button"
                        class={`tb-table-sort${statusCycleSortField === "percentOfCycleTime" ? " is-active" : ""}`}
                        onClick={() => handleStatusCycleSortHeaderClick("percentOfCycleTime")}
                        aria-label={`Sort by Percent Of Cycle Time (${statusCycleSortField === "percentOfCycleTime" && statusCycleSortDirection === "asc" ? "ascending" : "descending"})`}
                      >
                        <span>% Cycle Time</span>
                        <span class="tb-table-sort-indicator" aria-hidden="true">{resolveSortIndicator("percentOfCycleTime")}</span>
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedStatusCycleRows.map((row) => (
                    <tr key={`status-cycle-${row.status}`}>
                      <td class="tb-status-cycle-name">{row.status}</td>
                      <td class="tb-status-cycle-cell-numeric">{row.issueCount}</td>
                      <td class="tb-status-cycle-cell-numeric">{formatDays(row.avgDays)}</td>
                      <td class="tb-status-cycle-cell-numeric">{formatPercent(row.percentOfCycleTime)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <aside class="tb-status-cycle-pie-card">
              <h4>% Cycle Time Breakdown</h4>
              <div class="tb-status-cycle-pie-wrap">
                <div
                  class="tb-status-cycle-pie"
                  role="img"
                  aria-label="Status cycle time share pie chart"
                  style={{ background: statusCyclePieGradient }}
                />
                <ul class="tb-status-cycle-pie-legend">
                  {statusCyclePieSlices.map((slice) => (
                    <li key={`pie-${slice.status}`}>
                      <span class="tb-status-cycle-pie-legend-dot" style={{ background: slice.color }} aria-hidden="true" />
                      <span class="tb-status-cycle-pie-legend-label">{slice.status}</span>
                      <span class="tb-status-cycle-pie-legend-value">{formatPercent(slice.percentOfCycleTime)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </aside>
          </div>
        ) : null}
      </section>
    </div>
  );
}
