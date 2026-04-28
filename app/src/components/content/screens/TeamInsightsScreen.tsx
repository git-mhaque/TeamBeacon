import { h } from "preact";
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { TeamInsightsResponse, fetchTeamInsights } from "../../../lib/api";

const TREND_WINDOW_OPTIONS = [1, 2, 3, 4, 6, 8, 10, 12] as const;
export const OPEN_TEAM_INSIGHTS_SETTINGS_EVENT = "teambeacon:team-insights-open-settings";
const DEFAULT_TARGET_CYCLE_TIME_DAYS = 5;

const EMPTY_INSIGHTS: TeamInsightsResponse = {
  source: "local",
  metrics: {
    avgCommittedStoryPoints: 0,
    avgCompletedStoryPoints: 0,
    completionRatioPercent: 0,
    carryoverPercent: 0,
    avgCycleTimeDays: null,
    cycleTimeStdDevDays: null,
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

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  const month = parsed.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const year = String(parsed.getUTCFullYear());
  return `${day}-${month}-${year}`;
}

function formatSprintDateRange(startDate: string | null | undefined, endDate: string | null | undefined): string {
  return `From ${formatDate(startDate)} to ${formatDate(endDate)}`;
}

function formatSprintSequenceLabel(position: number): string {
  return `Sprint ${position + 1}`;
}

function computeNiceAxisStep(rawStep: number): number {
  if (!Number.isFinite(rawStep) || rawStep <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  if (normalized <= 1) return magnitude;
  if (normalized <= 2) return 2 * magnitude;
  if (normalized <= 5) return 5 * magnitude;
  return 10 * magnitude;
}

function buildTrendAxis(maxValue: number): { upperBound: number; ticks: number[] } {
  if (!Number.isFinite(maxValue) || maxValue <= 0) {
    return { upperBound: 4, ticks: [0, 1, 2, 3, 4] };
  }

  const step = computeNiceAxisStep(maxValue / 4);
  const upperBound = Math.max(step * 4, Math.ceil(maxValue / step) * step);
  const tickCount = Math.max(2, Math.round(upperBound / step) + 1);
  const ticks = Array.from({ length: tickCount }, (_, index) => roundMetric(index * step));
  return { upperBound, ticks };
}

function formatTrendAxisValue(value: number, chart: TrendChartTab): string {
  if (chart === "completedStoryPoints") {
    return `${formatStoryPoints(value)} SP`;
  }
  return formatDays(value);
}

function calculateTrendBarHeight(value: number, upperBound: number): string {
  if (upperBound <= 0 || value <= 0) return "0%";
  return `${Math.min(roundMetric((value / upperBound) * 100), 100)}%`;
}

function calculateTrendAxisOffset(value: number, upperBound: number): string {
  if (upperBound <= 0 || value <= 0) return "0%";
  return `${Math.min(roundMetric((value / upperBound) * 100), 100)}%`;
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
type TrendChartTab = "cycleTime" | "completedStoryPoints";

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

function normalizeTargetCycleTime(value: number | string | null | undefined): number {
  const numericValue = typeof value === "number" ? value : Number.parseFloat(value ?? "");
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return DEFAULT_TARGET_CYCLE_TIME_DAYS;
  }
  return roundMetric(numericValue);
}

function defaultSortDirectionForStatusCycleField(field: StatusCycleSortField): StatusCycleSortDirection {
  return field === "status" ? "asc" : "desc";
}

export function TeamInsightsScreen() {
  const [insights, setInsights] = useState<TeamInsightsResponse>(EMPTY_INSIGHTS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trendWindowSelection, setTrendWindowSelection] = useState<number>(6);
  const [selectedTrendChart, setSelectedTrendChart] = useState<TrendChartTab>("cycleTime");
  const [targetCycleTimeDays, setTargetCycleTimeDays] = useState<number>(DEFAULT_TARGET_CYCLE_TIME_DAYS);
  const [showTargetCycleTime, setShowTargetCycleTime] = useState(true);
  const [showCompletedStoryPointsChart, setShowCompletedStoryPointsChart] = useState(true);
  const [showTrendValueLabels, setShowTrendValueLabels] = useState(true);
  const [showActiveSprintMarker, setShowActiveSprintMarker] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [draftTargetCycleTimeInput, setDraftTargetCycleTimeInput] = useState(String(DEFAULT_TARGET_CYCLE_TIME_DAYS));
  const [draftShowTargetCycleTime, setDraftShowTargetCycleTime] = useState(true);
  const [draftShowCompletedStoryPointsChart, setDraftShowCompletedStoryPointsChart] = useState(true);
  const [draftShowTrendValueLabels, setDraftShowTrendValueLabels] = useState(true);
  const [draftShowActiveSprintMarker, setDraftShowActiveSprintMarker] = useState(true);
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

  const openSettings = useCallback(() => {
    setDraftTargetCycleTimeInput(String(targetCycleTimeDays));
    setDraftShowTargetCycleTime(showTargetCycleTime);
    setDraftShowCompletedStoryPointsChart(showCompletedStoryPointsChart);
    setDraftShowTrendValueLabels(showTrendValueLabels);
    setDraftShowActiveSprintMarker(showActiveSprintMarker);
    setIsSettingsOpen(true);
  }, [
    showActiveSprintMarker,
    showCompletedStoryPointsChart,
    showTargetCycleTime,
    showTrendValueLabels,
    targetCycleTimeDays,
  ]);

  const closeSettings = useCallback(() => {
    setIsSettingsOpen(false);
  }, []);

  const saveSettings = useCallback(() => {
    const nextTargetCycleTimeDays = normalizeTargetCycleTime(draftTargetCycleTimeInput);
    setTargetCycleTimeDays(nextTargetCycleTimeDays);
    setDraftTargetCycleTimeInput(String(nextTargetCycleTimeDays));
    setShowTargetCycleTime(draftShowTargetCycleTime);
    setShowCompletedStoryPointsChart(draftShowCompletedStoryPointsChart);
    if (!draftShowCompletedStoryPointsChart) {
      setSelectedTrendChart("cycleTime");
    }
    setShowTrendValueLabels(draftShowTrendValueLabels);
    setShowActiveSprintMarker(draftShowActiveSprintMarker);
    setIsSettingsOpen(false);
  }, [
    draftTargetCycleTimeInput,
    draftShowCompletedStoryPointsChart,
    draftShowActiveSprintMarker,
    draftShowTargetCycleTime,
    draftShowTrendValueLabels,
  ]);

  useEffect(() => {
    const handleOpen = () => openSettings();
    window.addEventListener(OPEN_TEAM_INSIGHTS_SETTINGS_EVENT, handleOpen);
    return () => {
      window.removeEventListener(OPEN_TEAM_INSIGHTS_SETTINGS_EVENT, handleOpen);
    };
  }, [openSettings]);

  const maxCompletedStoryPoints = useMemo(() => {
    if (insights.trend.length === 0) return 0;
    return Math.max(...insights.trend.map((point) => point.completedStoryPoints), 0);
  }, [insights.trend]);
  const maxSprintAvgCycleTimeDays = useMemo(() => {
    if (insights.trend.length === 0) return 0;
    return Math.max(...insights.trend.map((point) => point.avgCycleTimeDays ?? 0), 0);
  }, [insights.trend]);
  const cycleTimeAxis = useMemo(
    () => buildTrendAxis(Math.max(maxSprintAvgCycleTimeDays, showTargetCycleTime ? targetCycleTimeDays : 0)),
    [maxSprintAvgCycleTimeDays, showTargetCycleTime, targetCycleTimeDays]
  );
  const completedStoryPointsAxis = useMemo(() => buildTrendAxis(maxCompletedStoryPoints), [maxCompletedStoryPoints]);
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

  const trendRows = insights.trend;
  const activeTrendChart = selectedTrendChart === "completedStoryPoints" && showCompletedStoryPointsChart
    ? "completedStoryPoints"
    : "cycleTime";
  const selectedTrendAxis = activeTrendChart === "cycleTime" ? cycleTimeAxis : completedStoryPointsAxis;
  const selectedTrendAxisTicks = useMemo(
    () => [...selectedTrendAxis.ticks].reverse().map((tick) => ({
      value: tick,
      offset: calculateTrendAxisOffset(tick, selectedTrendAxis.upperBound),
    })),
    [selectedTrendAxis]
  );
  const cycleTimeTargetLineOffset = useMemo(
    () => calculateTrendAxisOffset(targetCycleTimeDays, cycleTimeAxis.upperBound),
    [cycleTimeAxis.upperBound, targetCycleTimeDays]
  );
  const selectedTrendChartAriaLabel = activeTrendChart === "cycleTime"
    ? "Average cycle time sprint bar chart"
    : "Completed story points sprint bar chart";

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
            <strong class="tb-value tb-value-good">{formatDays(insights.metrics.medianCycleTimeDays)}</strong>
            <p>Middle cycle-time value across completed cards.</p>
          </article>
          <article class="tb-metric-card">
            <h4>Avg Cycle Time</h4>
            <strong class="tb-value tb-value-good">{formatDays(insights.metrics.avgCycleTimeDays)}</strong>
            <p>Average across completed cards in trend window.</p>
          </article>
          <article class="tb-metric-card">
            <h4>Cycle Time Std Dev</h4>
            <strong class="tb-value tb-value-good">{formatDays(insights.metrics.cycleTimeStdDevDays)}</strong>
            <p>Variation across completed-card cycle times in trend window.</p>
          </article>
          <article class="tb-metric-card">
            <h4>Avg SP</h4>
            <strong class="tb-value tb-value-good">{formatStoryPoints(insights.metrics.avgCompletedStoryPoints)} SP</strong>
            <p>Average completed story points per sprint.</p>
          </article>
        </div>
        <article class="tb-metric-card tb-trend-tab-card">
          <div class="tb-trend-tabs" role="tablist" aria-label="Sprint trend charts">
            <button
              id="tb-trend-tab-cycle-time"
              type="button"
              role="tab"
              class={`tb-trend-tab${activeTrendChart === "cycleTime" ? " is-active" : ""}`}
              aria-selected={activeTrendChart === "cycleTime"}
              aria-controls="tb-trend-panel-cycle-time"
              tabIndex={activeTrendChart === "cycleTime" ? 0 : -1}
              onClick={() => setSelectedTrendChart("cycleTime")}
            >
              Avg Cycle Time
            </button>
            {showCompletedStoryPointsChart ? (
              <button
                id="tb-trend-tab-completed-sp"
                type="button"
                role="tab"
                class={`tb-trend-tab${activeTrendChart === "completedStoryPoints" ? " is-active" : ""}`}
                aria-selected={activeTrendChart === "completedStoryPoints"}
                aria-controls="tb-trend-panel-completed-sp"
                tabIndex={activeTrendChart === "completedStoryPoints" ? 0 : -1}
                onClick={() => setSelectedTrendChart("completedStoryPoints")}
              >
                Completed SP
              </button>
            ) : null}
          </div>
          {activeTrendChart === "cycleTime" ? (
            <section
              id="tb-trend-panel-cycle-time"
              class="tb-trend-tab-panel"
              role="tabpanel"
              aria-labelledby="tb-trend-tab-cycle-time"
            >
              <div class="tb-trend-chart-frame">
                <div class="tb-trend-chart" role="img" aria-label={selectedTrendChartAriaLabel}>
                  <div class="tb-trend-y-axis" aria-hidden="true">
                    <div class="tb-trend-y-axis-scale">
                      {selectedTrendAxisTicks.map(({ value, offset }) => (
                        <div
                          key={`cycle-axis-${value}`}
                          class="tb-trend-y-axis-tick"
                          style={{ bottom: offset }}
                        >
                          <span class="tb-trend-y-axis-label">{formatTrendAxisValue(value, "cycleTime")}</span>
                          <span class="tb-trend-y-axis-marker" />
                        </div>
                      ))}
                    </div>
                    <div class="tb-trend-y-axis-spacer" />
                  </div>
                  <div class="tb-trend-plot">
                    <div class="tb-trend-plot-scale" aria-hidden="true">
                      {showTargetCycleTime ? (
                        <div
                          class="tb-trend-target-line"
                          data-testid="cycle-time-target-line"
                          style={{ bottom: cycleTimeTargetLineOffset }}
                        />
                      ) : null}
                    </div>
                    <div class="tb-trend-columns-wrap">
                      <div class="tb-trend-columns">
                        {trendRows.map((point, index) => {
                          const sprintAvgCycleTimeDays = point.avgCycleTimeDays ?? 0;
                          const isActiveSprint = point.state?.toLowerCase() === "active";
                          const fullSprintRange = formatSprintDateRange(point.startDate, point.endDate);
                          const displaySprintName = formatSprintSequenceLabel(index);
                          const barHeight = calculateTrendBarHeight(sprintAvgCycleTimeDays, selectedTrendAxis.upperBound);
                          return (
                            <div
                              key={`cycle-${point.sprintId}`}
                              class="tb-trend-column"
                              title={fullSprintRange}
                            >
                              <div class="tb-trend-column-stage">
                                {showTrendValueLabels ? (
                                  <span class="tb-trend-column-value" style={{ bottom: `calc(${barHeight} + 0.38rem)` }}>
                                    {formatDays(point.avgCycleTimeDays)}
                                  </span>
                                ) : null}
                                <span
                                  class={`tb-trend-column-bar${isActiveSprint ? " is-active" : ""}`}
                                  style={{ height: barHeight }}
                                />
                              </div>
                              <div class="tb-trend-column-meta">
                                <span class="tb-trend-column-name">
                                  {showActiveSprintMarker && isActiveSprint ? (
                                    <span class="tb-sprint-active-icon" title="Active sprint" aria-hidden="true" />
                                  ) : null}
                                  {displaySprintName}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
                <p class="tb-trend-x-axis-label">Sprints (old to new)</p>
              </div>
            </section>
          ) : (
            <section
              id="tb-trend-panel-completed-sp"
              class="tb-trend-tab-panel"
              role="tabpanel"
              aria-labelledby="tb-trend-tab-completed-sp"
            >
              <div class="tb-trend-chart-frame">
                <div class="tb-trend-chart" role="img" aria-label={selectedTrendChartAriaLabel}>
                  <div class="tb-trend-y-axis" aria-hidden="true">
                    <div class="tb-trend-y-axis-scale">
                      {selectedTrendAxisTicks.map(({ value, offset }) => (
                        <div
                          key={`sp-axis-${value}`}
                          class="tb-trend-y-axis-tick"
                          style={{ bottom: offset }}
                        >
                          <span class="tb-trend-y-axis-label">{formatTrendAxisValue(value, "completedStoryPoints")}</span>
                          <span class="tb-trend-y-axis-marker" />
                        </div>
                      ))}
                    </div>
                    <div class="tb-trend-y-axis-spacer" />
                  </div>
                  <div class="tb-trend-plot">
                    <div class="tb-trend-plot-scale" aria-hidden="true" />
                    <div class="tb-trend-columns-wrap">
                      <div class="tb-trend-columns">
                        {trendRows.map((point, index) => {
                          const isActiveSprint = point.state?.toLowerCase() === "active";
                          const fullSprintRange = formatSprintDateRange(point.startDate, point.endDate);
                          const displaySprintName = formatSprintSequenceLabel(index);
                          const barHeight = calculateTrendBarHeight(point.completedStoryPoints, selectedTrendAxis.upperBound);
                          return (
                            <div
                              key={`sp-${point.sprintId}`}
                              class="tb-trend-column"
                              title={fullSprintRange}
                            >
                              <div class="tb-trend-column-stage">
                                {showTrendValueLabels ? (
                                  <span class="tb-trend-column-value" style={{ bottom: `calc(${barHeight} + 0.38rem)` }}>
                                    {formatStoryPoints(point.completedStoryPoints)} SP
                                  </span>
                                ) : null}
                                <span
                                  class={`tb-trend-column-bar${isActiveSprint ? " is-active" : ""}`}
                                  style={{ height: barHeight }}
                                />
                              </div>
                              <div class="tb-trend-column-meta">
                                <span class="tb-trend-column-name">
                                  {showActiveSprintMarker && isActiveSprint ? (
                                    <span class="tb-sprint-active-icon" title="Active sprint" aria-hidden="true" />
                                  ) : null}
                                  {displaySprintName}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
                <p class="tb-trend-x-axis-label">Sprints (old to new)</p>
              </div>
            </section>
          )}
        </article>
        <p class="tb-trend-order-pill tb-trend-chart-note">
          Older sprints are shown on the left and recent sprints on the right. The green dot marks the active sprint.
        </p>
        {loading ? <p class="tb-muted-note">Loading sprint trend...</p> : null}
        {error ?? insights.error ? <p class="tb-muted-note">Team insights error: {error ?? insights.error}</p> : null}
        {!loading && insights.trend.length === 0 ? <p class="tb-muted-note">No recent sprint trend data found.</p> : null}
        {isSettingsOpen ? (
          <div class="tb-modal-layer" role="dialog" aria-modal="true" aria-label="Team Insights Settings">
            <div class="tb-modal-backdrop" onClick={closeSettings} />
            <div class="tb-modal tb-modal-team-settings">
              <header class="tb-modal-head">
                <h3>Team Insights Settings</h3>
                <button type="button" class="tb-btn tb-btn-sm" onClick={closeSettings}>
                  Close
                </button>
              </header>

              <p class="tb-muted-note">Tune the sprint trend chart display and markers shown on this screen.</p>

              <div class="tb-modal-two-up">
                <div class="tb-modal-field">
                  <span>Visible Trend Charts</span>
                  <p class="tb-muted-note tb-modal-field-note">Avg Cycle Time is always shown.</p>
                  <label class="tb-modal-check">
                    <input
                      type="checkbox"
                      checked={draftShowCompletedStoryPointsChart}
                      onChange={(event) => setDraftShowCompletedStoryPointsChart((event.currentTarget as HTMLInputElement).checked)}
                    />
                    <span>Show SP chart</span>
                  </label>
                </div>

                <div class="tb-modal-field">
                  <span>Target Cycle Time</span>
                  <label class="tb-modal-check">
                    <input
                      type="checkbox"
                      checked={draftShowTargetCycleTime}
                      onChange={(event) => setDraftShowTargetCycleTime((event.currentTarget as HTMLInputElement).checked)}
                    />
                    <span>Show target cycle time</span>
                  </label>
                  <input
                    aria-label="Target Cycle Time"
                    type="number"
                    min="0"
                    step="0.1"
                    disabled={!draftShowTargetCycleTime}
                    value={draftTargetCycleTimeInput}
                    onInput={(event) => setDraftTargetCycleTimeInput((event.currentTarget as HTMLInputElement).value)}
                  />
                </div>
              </div>

              <label class="tb-modal-check">
                <input
                  type="checkbox"
                  checked={draftShowTrendValueLabels}
                  onChange={(event) => setDraftShowTrendValueLabels((event.currentTarget as HTMLInputElement).checked)}
                />
                <span>Show bar value labels</span>
              </label>

              <label class="tb-modal-check">
                <input
                  type="checkbox"
                  checked={draftShowActiveSprintMarker}
                  onChange={(event) => setDraftShowActiveSprintMarker((event.currentTarget as HTMLInputElement).checked)}
                />
                <span>Show active sprint marker</span>
              </label>

              <footer class="tb-modal-actions">
                <button type="button" class="tb-btn" onClick={closeSettings}>
                  Cancel
                </button>
                <button type="button" class="tb-btn tb-btn-primary" onClick={saveSettings}>
                  Save
                </button>
              </footer>
            </div>
          </div>
        ) : null}
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
