import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as ChartModule from "chart.js/auto";
import type { Chart as ChartInstance, ChartConfiguration } from "chart.js";
import {
  fetchReleaseInsights,
  ReleaseInsightRow,
  ReleaseInsightsResponse,
  ReleaseRiskLevel,
} from "../../../lib/api";
import { getPreference, getPreferenceSync, setPreference } from "../../../lib/persistence";

type ChartConstructor = new (
  item: HTMLCanvasElement,
  config: ChartConfiguration<"line">,
) => ChartInstance<"line">;

const EMPTY_INSIGHTS: ReleaseInsightsResponse = {
  source: "local",
  projectKey: null,
  metrics: {
    totalReleases: 0,
    releasedCount: 0,
    ongoingCount: 0,
    archivedCount: 0,
    overdueCount: 0,
    dueSoonCount: 0,
    avgCycleTimeDays: null,
    medianCycleTimeDays: null,
    p85CycleTimeDays: null,
    avgCadenceDays: null,
    deliveredStoryPoints: 0,
  },
  cycleTimeTrend: [],
  ongoingReleases: [],
  recentReleases: [],
  riskSignals: [],
  summary: "Release insights will appear once release data is synced.",
  error: null,
};

const DEFAULT_RELEASE_SELECTION_COUNT = 12;
const RELEASE_SELECTOR_FETCH_LIMIT = 100;
const RELEASE_TREND_SELECTION_KEY = "teambeacon.releaseInsights.selectedReleaseIds";

const Chart =
  ((ChartModule as unknown as { default?: ChartConstructor }).default ??
    (ChartModule as unknown as ChartConstructor));

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1).replace(/\.0$/, "");
}

function formatDays(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return `${formatNumber(value)} d`;
}

function formatStoryPoints(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "0 SP";
  return `${formatNumber(value)} SP`;
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return `${formatNumber(value)}%`;
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

function riskToneClass(level: ReleaseRiskLevel | null | undefined): string {
  if (level === "green") return "is-green";
  if (level === "red") return "is-red";
  if (level === "neutral") return "is-neutral";
  return "is-amber";
}

function riskValueClass(level: ReleaseRiskLevel | null | undefined): string {
  if (level === "green") return "tb-value-good";
  if (level === "red") return "tb-value-risk";
  return "tb-value-warn";
}

function releaseSecondaryLine(release: ReleaseInsightRow): string {
  const scope = `${release.issueCount} cards / ${formatStoryPoints(release.storyPoints)}`;
  const dateRange = `${formatDate(release.startDate)} to ${formatDate(release.releaseDate)}`;
  return `${dateRange} | ${scope}`;
}

function readinessLabel(release: ReleaseInsightRow): string {
  return `${release.doneIssueCount}/${release.issueCount} done`;
}

function releaseSortTimestamp(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
}

function releaseMixLabel(release: ReleaseInsightRow): string {
  if (release.issueTypeMix.length === 0) return "-";
  return release.issueTypeMix.slice(0, 3).map((slice) => `${slice.label} ${formatPercent(slice.percent)}`).join(", ");
}

function compactReleaseLabel(index: number): string {
  return `R${index + 1}`;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function selectionsMatch(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function measuredCycleTime(release: ReleaseInsightRow): number | null {
  return typeof release.cycleTimeDays === "number" && Number.isFinite(release.cycleTimeDays)
    ? release.cycleTimeDays
    : null;
}

function cycleTimeStatusLabel(release: ReleaseInsightRow): string {
  const cycleTime = measuredCycleTime(release);
  if (cycleTime !== null) return formatDays(cycleTime);
  if (!release.releaseDate) return "Missing end date";
  if (!release.startDate) return "Missing start date";
  return "Not measured";
}

function missingCycleReason(release: ReleaseInsightRow): string | null {
  if (measuredCycleTime(release) !== null) return null;
  if (!release.releaseDate) return "Missing end date";
  if (!release.startDate) return "Missing start date";
  return "Cycle time unavailable";
}

function sortReleaseRowsByRisk(rows: ReleaseInsightRow[]): ReleaseInsightRow[] {
  const riskOrder: Record<string, number> = { red: 0, amber: 1, green: 2, neutral: 3 };
  return [...rows].sort((left, right) => {
    const riskDelta = (riskOrder[left.riskLevel] ?? 9) - (riskOrder[right.riskLevel] ?? 9);
    if (riskDelta !== 0) return riskDelta;
    return (left.releaseDate ?? "").localeCompare(right.releaseDate ?? "");
  });
}

function parsePersistedReleaseSelection(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const selected = new Set<string>();
    for (const entry of parsed) {
      if (typeof entry !== "string") continue;
      const releaseId = entry.trim();
      if (releaseId) {
        selected.add(releaseId);
      }
    }
    return [...selected];
  } catch {
    return [];
  }
}

function readPersistedReleaseSelection(): string[] {
  return parsePersistedReleaseSelection(getPreferenceSync(RELEASE_TREND_SELECTION_KEY));
}

type ReleaseCycleLineChartProps = {
  releases: ReleaseInsightRow[];
  averageCycleTime: number | null;
  maxCycleTime: number;
};

function ReleaseCycleLineChart({
  releases,
  averageCycleTime,
  maxCycleTime,
}: ReleaseCycleLineChartProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const config = useMemo(() => {
    const labels = releases.map((_release, index) => compactReleaseLabel(index));
    const measuredValues = releases.map((release) => measuredCycleTime(release));
    const missingValues = releases.map((release) => (missingCycleReason(release) ? 0 : null));
    const suggestedMax = Math.max(4, Math.ceil(maxCycleTime * 1.2));

    return {
      type: "line" as const,
      data: {
        labels,
        datasets: [
          {
            label: "Cycle time",
            data: measuredValues,
            borderColor: "#287491",
            backgroundColor: "rgba(40, 116, 145, 0.12)",
            borderWidth: 2,
            pointBackgroundColor: "#ffffff",
            pointBorderColor: "#1c607a",
            pointBorderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 5,
            tension: 0.28,
            spanGaps: false,
          },
          {
            label: "Missing value",
            data: missingValues,
            borderColor: "transparent",
            backgroundColor: "#b46508",
            pointBackgroundColor: "#fff7e8",
            pointBorderColor: "#b46508",
            pointBorderWidth: 2,
            pointRadius: 5,
            pointHoverRadius: 6,
            pointStyle: "triangle",
            showLine: false,
          },
          ...(averageCycleTime !== null
            ? [{
              label: "Average",
              data: releases.map(() => averageCycleTime),
              borderColor: "#9a6a18",
              borderDash: [6, 4],
              borderWidth: 1.4,
              pointRadius: 0,
              pointHoverRadius: 0,
              tension: 0,
            }]
            : []),
        ] as any[],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        normalized: true,
        layout: {
          padding: {
            top: 10,
            right: 12,
            bottom: 4,
            left: 4,
          },
        },
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            displayColors: false,
            callbacks: {
              title: (items: any[]) => {
                const index = items[0]?.dataIndex ?? 0;
                return releases[index]?.name ?? labels[index] ?? "";
              },
              label: (item: any) => {
                const release = releases[item.dataIndex];
                if (!release) return "";
                if (item.datasetIndex === 1) {
                  return `${missingCycleReason(release) ?? "Missing value"} | ${formatDate(release.startDate)} to ${formatDate(release.releaseDate)}`;
                }
                if (item.datasetIndex === 2) {
                  return `Average: ${formatDays(averageCycleTime)}`;
                }
                return `${formatDays(measuredCycleTime(release))} | ${formatDate(release.startDate)} to ${formatDate(release.releaseDate)}`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: {
              display: false,
              drawTicks: false,
            },
            ticks: {
              autoSkip: false,
              color: "#5a514a",
              font: {
                size: 11,
                weight: "700",
              },
              maxRotation: 0,
              minRotation: 0,
            },
            border: {
              color: "#d2cac3",
              width: 2,
            },
          },
          y: {
            beginAtZero: true,
            min: 0,
            suggestedMax,
            ticks: {
              color: "#5a514a",
              font: {
                size: 11,
                weight: "700",
              },
              padding: 8,
              callback: (value: unknown) => `${formatNumber(Number(value))} d`,
            },
            grid: {
              color: "#e7e1dc",
              tickColor: "#d2cac3",
            },
            border: {
              color: "#d2cac3",
              width: 2,
            },
          },
        },
      },
    };
  }, [averageCycleTime, maxCycleTime, releases]);

  useEffect(() => {
    if (!canvasRef.current) return undefined;
    const chart = new Chart(canvasRef.current, config as any);
    return () => {
      chart.destroy();
    };
  }, [config]);

  return (
    <div className="tb-release-cycle-chart">
      <canvas
        ref={canvasRef}
        className="tb-release-cycle-chart-canvas"
        role="img"
        aria-label="Release cycle time line chart"
        data-testid="release-cycle-time-chart"
      >
        Release cycle time line chart
      </canvas>
    </div>
  );
}

export function ReleasesScreen() {
  const [insights, setInsights] = useState<ReleaseInsightsResponse>(EMPTY_INSIGHTS);
  const [error, setError] = useState<string | null>(null);
  const [selectedReleaseIds, setSelectedReleaseIds] = useState<string[]>(readPersistedReleaseSelection);
  const [draftSelectedReleaseIds, setDraftSelectedReleaseIds] = useState<string[]>([]);
  const [isReleaseSelectorOpen, setIsReleaseSelectorOpen] = useState(false);
  const [releaseSelectorSearch, setReleaseSelectorSearch] = useState("");
  const hasInitializedReleaseSelection = useRef(false);
  const hasHydratedReleaseSelectionFromStore = useRef(false);

  const persistReleaseSelection = useCallback((releaseIds: string[]) => {
    void setPreference(RELEASE_TREND_SELECTION_KEY, JSON.stringify(releaseIds));
  }, []);

  const loadInsights = useCallback(async () => {
    try {
      const payload = await fetchReleaseInsights(RELEASE_SELECTOR_FETCH_LIMIT);
      setInsights(payload);
      setError(payload.error ?? null);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Unable to load release insights.";
      setError(message);
      setInsights(EMPTY_INSIGHTS);
    }
  }, []);

  useEffect(() => {
    void loadInsights();
  }, [loadInsights]);

  const sortedOngoingReleases = useMemo(
    () => sortReleaseRowsByRisk(insights.ongoingReleases),
    [insights.ongoingReleases],
  );

  const sortedRecentReleases = useMemo(
    () => [...insights.recentReleases].sort((left, right) => {
      const dateDelta = releaseSortTimestamp(right.releaseDate) - releaseSortTimestamp(left.releaseDate);
      if (dateDelta !== 0) return dateDelta;
      return left.name.localeCompare(right.name);
    }),
    [insights.recentReleases],
  );

  useEffect(() => {
    const availableReleaseIds = sortedRecentReleases.map((release) => release.versionId);
    if (availableReleaseIds.length === 0) {
      setSelectedReleaseIds([]);
      hasInitializedReleaseSelection.current = false;
      hasHydratedReleaseSelectionFromStore.current = false;
      return;
    }

    const defaultReleaseIds = availableReleaseIds.slice(0, DEFAULT_RELEASE_SELECTION_COUNT);
    const normalizeAvailableSelection = (releaseIds: string[]) => {
      const requestedIds = new Set(releaseIds);
      const availableSelection = availableReleaseIds.filter((versionId) => requestedIds.has(versionId));
      return availableSelection.length > 0 ? availableSelection : defaultReleaseIds;
    };

    if (!hasInitializedReleaseSelection.current) {
      const initialSelection = normalizeAvailableSelection(readPersistedReleaseSelection());
      setSelectedReleaseIds(initialSelection);
      persistReleaseSelection(initialSelection);
      hasInitializedReleaseSelection.current = true;
      return;
    }

    setSelectedReleaseIds((currentIds) => {
      const nextSelection = normalizeAvailableSelection(currentIds);
      if (selectionsMatch(nextSelection, currentIds)) return currentIds;
      persistReleaseSelection(nextSelection);
      return nextSelection;
    });
  }, [persistReleaseSelection, sortedRecentReleases]);

  useEffect(() => {
    if (sortedRecentReleases.length === 0 || !hasInitializedReleaseSelection.current) return;
    if (hasHydratedReleaseSelectionFromStore.current) return;
    hasHydratedReleaseSelectionFromStore.current = true;

    const availableReleaseIds = sortedRecentReleases.map((release) => release.versionId);
    const availableReleaseIdSet = new Set(availableReleaseIds);
    let cancelled = false;

    void (async () => {
      const raw = await getPreference(RELEASE_TREND_SELECTION_KEY);
      if (cancelled || !raw) return;

      const persistedIds = parsePersistedReleaseSelection(raw).filter((versionId) => (
        availableReleaseIdSet.has(versionId)
      ));
      if (persistedIds.length === 0) return;

      const orderedSelection = availableReleaseIds.filter((versionId) => persistedIds.includes(versionId));
      setSelectedReleaseIds((currentIds) => (
        selectionsMatch(currentIds, orderedSelection) ? currentIds : orderedSelection
      ));
    })();

    return () => {
      cancelled = true;
    };
  }, [sortedRecentReleases]);

  const recentCompletedReleases = useMemo(
    () => sortedRecentReleases.slice(0, DEFAULT_RELEASE_SELECTION_COUNT),
    [sortedRecentReleases],
  );

  const effectiveSelectedReleaseIds = useMemo(
    () => selectedReleaseIds.length > 0
      ? selectedReleaseIds
      : sortedRecentReleases.slice(0, DEFAULT_RELEASE_SELECTION_COUNT).map((release) => release.versionId),
    [selectedReleaseIds, sortedRecentReleases],
  );

  const selectedReleaseIdSet = useMemo(
    () => new Set(effectiveSelectedReleaseIds),
    [effectiveSelectedReleaseIds],
  );

  const selectedTrendReleases = useMemo(
    () => sortedRecentReleases.filter((release) => selectedReleaseIdSet.has(release.versionId)),
    [selectedReleaseIdSet, sortedRecentReleases],
  );

  const selectedCycleTimes = useMemo(
    () => selectedTrendReleases
      .map((release) => measuredCycleTime(release))
      .filter((value): value is number => value !== null),
    [selectedTrendReleases],
  );

  const selectedAverageCycleTime = useMemo(
    () => average(selectedCycleTimes),
    [selectedCycleTimes],
  );

  const maxSelectedCycleTime = useMemo(
    () => Math.max(1, ...selectedCycleTimes),
    [selectedCycleTimes],
  );

  const chartReleases = useMemo(
    () => [...selectedTrendReleases].reverse(),
    [selectedTrendReleases],
  );

  const releasesWithMissingCycleTime = useMemo(
    () => selectedTrendReleases
      .map((release) => ({ release, reason: missingCycleReason(release) }))
      .filter((entry): entry is { release: ReleaseInsightRow; reason: string } => entry.reason !== null),
    [selectedTrendReleases],
  );

  const draftSelectedReleaseIdSet = useMemo(
    () => new Set(draftSelectedReleaseIds),
    [draftSelectedReleaseIds],
  );

  const filteredSelectorReleases = useMemo(() => {
    const query = releaseSelectorSearch.trim().toLowerCase();
    if (!query) return sortedRecentReleases;

    return sortedRecentReleases.filter((release) => [
      release.name,
      formatDate(release.startDate),
      formatDate(release.releaseDate),
      cycleTimeStatusLabel(release),
    ].some((value) => value.toLowerCase().includes(query)));
  }, [releaseSelectorSearch, sortedRecentReleases]);

  const openReleaseSelector = useCallback(() => {
    setDraftSelectedReleaseIds(effectiveSelectedReleaseIds);
    setReleaseSelectorSearch("");
    setIsReleaseSelectorOpen(true);
  }, [effectiveSelectedReleaseIds]);

  const closeReleaseSelector = useCallback(() => {
    setIsReleaseSelectorOpen(false);
  }, []);

  const toggleDraftRelease = useCallback((versionId: string) => {
    setDraftSelectedReleaseIds((currentIds) => (
      currentIds.includes(versionId)
        ? currentIds.filter((currentId) => currentId !== versionId)
        : [...currentIds, versionId]
    ));
  }, []);

  const selectAllDraftReleases = useCallback(() => {
    setDraftSelectedReleaseIds(sortedRecentReleases.map((release) => release.versionId));
  }, [sortedRecentReleases]);

  const clearDraftReleases = useCallback(() => {
    setDraftSelectedReleaseIds([]);
  }, []);

  const applyReleaseSelection = useCallback(() => {
    const selectedIds = new Set(draftSelectedReleaseIds);
    const orderedSelection = sortedRecentReleases
      .filter((release) => selectedIds.has(release.versionId))
      .map((release) => release.versionId);
    if (orderedSelection.length === 0) return;
    setSelectedReleaseIds(orderedSelection);
    persistReleaseSelection(orderedSelection);
    setIsReleaseSelectorOpen(false);
  }, [draftSelectedReleaseIds, persistReleaseSelection, sortedRecentReleases]);

  const visibleRiskSignals = insights.riskSignals.length > 0
    ? insights.riskSignals
    : [{
      level: "green" as ReleaseRiskLevel,
      title: "Release posture",
      detail: "No overdue or readiness risks detected in synced release data.",
    }];

  return (
    <div className="tb-screen-grid">
      <section className="tb-panel">
        <header className="tb-panel-header">
          <div>
            <h3>Release Overview</h3>
          </div>
        </header>

        <div className="tb-metrics-grid tb-four-up">
          <article className="tb-metric-card">
            <h4>Ongoing Releases</h4>
            <strong className="tb-value">
              {insights.metrics.ongoingCount}
            </strong>
            <p>Active releases currently tracked.</p>
          </article>
          <article className="tb-metric-card">
            <h4>Overdue Releases</h4>
            <strong className={`tb-value ${insights.metrics.overdueCount > 0 ? "tb-value-risk" : "tb-value-good"}`}>
              {insights.metrics.overdueCount}
            </strong>
            <p>{insights.metrics.dueSoonCount} due soon.</p>
          </article>
          <article className="tb-metric-card">
            <h4>Avg Cycle Time</h4>
            <strong className="tb-value">{formatDays(insights.metrics.avgCycleTimeDays)}</strong>
            <p>Completed releases with start and release dates.</p>
          </article>
          <article className="tb-metric-card">
            <h4>Release Cadence</h4>
            <strong className="tb-value">{formatDays(insights.metrics.avgCadenceDays)}</strong>
            <p>Average days between releases.</p>
          </article>
        </div>

        {error ? <p className="tb-error-note">{error}</p> : null}
      </section>

      <section className="tb-panel">
        <header className="tb-panel-header">
          <div>
            <h3>Release Cycle Time Trend</h3>
            <p className="tb-muted-note">Selected completed releases from start date to release date.</p>
          </div>
          <div className="tb-panel-header-actions tb-release-cycle-actions">
            <span className="tb-chip">{selectedTrendReleases.length} shown</span>
            <button
              type="button"
              className="tb-btn tb-btn-sm"
              disabled={sortedRecentReleases.length === 0}
              onClick={openReleaseSelector}
            >
              Select Releases
            </button>
          </div>
        </header>

        {selectedTrendReleases.length > 0 ? (
          <div className="tb-release-cycle-view">
            <div className="tb-release-cycle-summary">
              <article>
                <span>Measured</span>
                <strong>{selectedCycleTimes.length}/{selectedTrendReleases.length}</strong>
              </article>
              <article>
                <span>Avg Cycle</span>
                <strong>{formatDays(selectedAverageCycleTime)}</strong>
              </article>
              <article>
                <span>Fastest</span>
                <strong>{formatDays(selectedCycleTimes.length > 0 ? Math.min(...selectedCycleTimes) : null)}</strong>
              </article>
              <article>
                <span>Slowest</span>
                <strong>{formatDays(selectedCycleTimes.length > 0 ? Math.max(...selectedCycleTimes) : null)}</strong>
              </article>
            </div>

            <div className="tb-release-cycle-chart-frame" data-testid="release-cycle-time-trend">
              <ReleaseCycleLineChart
                releases={chartReleases}
                averageCycleTime={selectedAverageCycleTime}
                maxCycleTime={maxSelectedCycleTime}
              />
              <div className="tb-release-cycle-legend" aria-label="Release cycle chart legend">
                <span><i className="tb-release-cycle-line-swatch" />Cycle time</span>
                <span><i className="tb-release-cycle-average-swatch" />Average</span>
                <span><i className="tb-release-cycle-missing-swatch" />Missing end date / cycle value</span>
              </div>
              <p className="tb-trend-x-axis-label">Oldest to newest among selected releases</p>
            </div>

            {releasesWithMissingCycleTime.length > 0 ? (
              <div className="tb-release-cycle-gaps" role="list" aria-label="Release cycle missing values">
                {releasesWithMissingCycleTime.map(({ release, reason }) => (
                  <span key={release.versionId} role="listitem">
                    {release.name}: {reason}
                  </span>
                ))}
              </div>
            ) : null}

            <div className="tb-release-cycle-key" role="list" aria-label="Line chart release labels">
              {chartReleases.map((release, index) => (
                <span key={release.versionId} role="listitem">
                  <strong>{compactReleaseLabel(index)}</strong>
                  {release.name}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="tb-summary">
            Select completed releases to show the cycle-time trend.
          </div>
        )}
      </section>

      <section className="tb-panel">
        <header className="tb-panel-header">
          <div>
            <h3>Ongoing Releases</h3>
            <p className="tb-muted-note">Readiness and delivery risk for active, non-archived releases.</p>
          </div>
        </header>

        {sortedOngoingReleases.length > 0 ? (
          <div className="tb-release-table-wrap">
            <table className="tb-release-table">
              <thead>
                <tr>
                  <th>Release</th>
                  <th>Target</th>
                  <th className="is-numeric">Age</th>
                  <th className="is-readiness">Readiness</th>
                  <th className="is-numeric">Scope</th>
                  <th>Risk</th>
                </tr>
              </thead>
              <tbody>
                {sortedOngoingReleases.map((release) => (
                  <tr key={release.versionId}>
                    <td>
                      <div className="tb-release-name-cell">
                        <strong>{release.name}</strong>
                        <span>{releaseSecondaryLine(release)}</span>
                      </div>
                    </td>
                    <td>{formatDate(release.releaseDate)}</td>
                    <td className="tb-release-numeric">{formatDays(release.ageDays)}</td>
                    <td>
                      <div className="tb-release-readiness">
                        <div className="tb-release-readiness-track">
                          <span style={{ width: `${Math.max(0, Math.min(100, release.readinessPercent))}%` }} />
                        </div>
                        <span>{formatPercent(release.readinessPercent)} | {readinessLabel(release)}</span>
                      </div>
                    </td>
                    <td className="tb-release-numeric">
                      {release.issueCount} / {formatStoryPoints(release.storyPoints)}
                    </td>
                    <td>
                      <span className={`tb-release-risk ${riskToneClass(release.riskLevel)}`}>
                        {release.riskLevel}
                      </span>
                      <p className="tb-release-risk-detail">{release.riskSummary}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="tb-summary">No ongoing releases found in the current sync.</div>
        )}
      </section>

      <section className="tb-panel">
        <header className="tb-panel-header">
          <div>
            <h3>Release Risk Signals</h3>
            <p className="tb-muted-note">Signals derived from dates, readiness, and linked release scope.</p>
          </div>
        </header>
        <div className="tb-release-risk-grid">
          {visibleRiskSignals.map((signal) => (
            <article key={`${signal.title}-${signal.detail}`} className="tb-metric-card">
              <h4>{signal.title}</h4>
              <strong className={`tb-release-risk-heading ${riskValueClass(signal.level)}`}>{signal.level}</strong>
              <p>{signal.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="tb-panel">
        <header className="tb-panel-header">
          <div>
            <h3>Recent Completed Releases</h3>
            <p className="tb-muted-note">Delivered scope, cycle time, and completion quality for completed releases.</p>
          </div>
        </header>

        {recentCompletedReleases.length > 0 ? (
          <div className="tb-initiative-table-wrap tb-release-recent-table-wrap">
            <table className="tb-initiative-table tb-release-recent-table" aria-label="Recent completed releases">
              <thead>
                <tr>
                  <th>Release</th>
                  <th>Released</th>
                  <th className="tb-release-recent-numeric">Cycle Time</th>
                  <th className="tb-release-recent-numeric">Scope</th>
                  <th>Completion</th>
                  <th>Mix</th>
                  <th>Risk</th>
                </tr>
              </thead>
              <tbody>
                {recentCompletedReleases.map((release) => (
                  <tr key={release.versionId}>
                    <td>
                      <div className="tb-release-name-cell">
                        <strong>{release.name}</strong>
                        <span>{formatDate(release.startDate)} to {formatDate(release.releaseDate)}</span>
                      </div>
                    </td>
                    <td>{formatDate(release.releaseDate)}</td>
                    <td className="tb-release-recent-numeric">{cycleTimeStatusLabel(release)}</td>
                    <td className="tb-release-recent-numeric">
                      {release.issueCount} cards / {formatStoryPoints(release.doneStoryPoints)}
                    </td>
                    <td>
                      <div className="tb-release-readiness">
                        <div className="tb-release-readiness-track">
                          <span style={{ width: `${Math.max(0, Math.min(100, release.readinessPercent))}%` }} />
                        </div>
                        <span>{formatPercent(release.readinessPercent)} | {readinessLabel(release)}</span>
                      </div>
                    </td>
                    <td className="tb-release-mix-cell">{releaseMixLabel(release)}</td>
                    <td>
                      <span className={`tb-release-risk ${riskToneClass(release.riskLevel)}`}>{release.riskLevel}</span>
                      <p className="tb-release-risk-detail">{release.riskSummary}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="tb-summary">No completed releases with linked scope are available yet.</div>
        )}
      </section>

      {isReleaseSelectorOpen ? (
        <div className="tb-modal-layer" role="dialog" aria-modal="true" aria-label="Select Releases">
          <div className="tb-modal-backdrop" onClick={closeReleaseSelector} />
          <div className="tb-modal tb-modal-wide tb-release-selector-modal">
            <header className="tb-modal-head">
              <div>
                <h3>Select Releases</h3>
                <p className="tb-muted-note">Completed releases available from the local sync.</p>
              </div>
              <span className="tb-chip">{draftSelectedReleaseIds.length} selected</span>
            </header>

            <div className="tb-release-selector-toolbar">
              <input
                className="tb-release-selector-search"
                type="search"
                aria-label="Search releases"
                placeholder="Search releases"
                value={releaseSelectorSearch}
                onInput={(event) => setReleaseSelectorSearch((event.currentTarget as HTMLInputElement).value)}
              />
              <div className="tb-release-selector-actions">
                <button type="button" className="tb-btn tb-btn-sm" onClick={selectAllDraftReleases}>
                  Select all
                </button>
                <button type="button" className="tb-btn tb-btn-sm" onClick={clearDraftReleases}>
                  Clear
                </button>
              </div>
            </div>

            <div className="tb-release-selector-list" role="group" aria-label="Completed release selection">
              {filteredSelectorReleases.length > 0 ? (
                filteredSelectorReleases.map((release) => (
                  <label key={release.versionId} className="tb-release-selector-option">
                    <input
                      type="checkbox"
                      checked={draftSelectedReleaseIdSet.has(release.versionId)}
                      onChange={() => toggleDraftRelease(release.versionId)}
                    />
                    <span className="tb-release-selector-option-copy">
                      <strong>{release.name}</strong>
                      <span>{formatDate(release.releaseDate)} | {cycleTimeStatusLabel(release)}</span>
                    </span>
                  </label>
                ))
              ) : (
                <div className="tb-summary tb-release-selector-empty">
                  No releases match this search.
                </div>
              )}
            </div>

            <footer className="tb-modal-actions">
              <button type="button" className="tb-btn" onClick={closeReleaseSelector}>
                Cancel
              </button>
              <button
                type="button"
                className="tb-btn tb-btn-primary"
                disabled={draftSelectedReleaseIds.length === 0}
                onClick={applyReleaseSelection}
              >
                Apply
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
