import { h } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import * as ChartModule from "chart.js/auto";
import type { Chart as ChartInstance, ChartConfiguration } from "chart.js";
import {
  fetchReleaseInsights,
  ReleaseInsightRow,
  ReleaseInsightsResponse,
  ReleaseRiskLevel,
} from "../../../lib/api";

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
  summary: "Release insights will appear once JIRA release data is synced.",
  error: null,
};

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

function formatGeneratedAt(value: string | null | undefined): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).replace(",", "");
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
            borderColor: "#1f67c1",
            backgroundColor: "rgba(47, 123, 216, 0.14)",
            borderWidth: 2,
            pointBackgroundColor: "#ffffff",
            pointBorderColor: "#175cae",
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
              borderColor: "#8d6b20",
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
              color: "#2a456d",
              font: {
                size: 11,
                weight: "700",
              },
              maxRotation: 0,
              minRotation: 0,
            },
            border: {
              color: "#bfd0e8",
              width: 2,
            },
          },
          y: {
            beginAtZero: true,
            min: 0,
            suggestedMax,
            ticks: {
              color: "#2a456d",
              font: {
                size: 11,
                weight: "700",
              },
              padding: 8,
              callback: (value: unknown) => `${formatNumber(Number(value))} d`,
            },
            grid: {
              color: "#e1e9f6",
              tickColor: "#bfd0e8",
            },
            border: {
              color: "#bfd0e8",
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
    <div class="tb-release-cycle-chart">
      <canvas
        ref={canvasRef}
        class="tb-release-cycle-chart-canvas"
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadInsights = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await fetchReleaseInsights(12);
      setInsights(payload);
      setError(payload.error ?? null);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Unable to load release insights.";
      setError(message);
      setInsights(EMPTY_INSIGHTS);
    } finally {
      setLoading(false);
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

  const last12ReleasedVersions = useMemo(
    () => sortedRecentReleases.slice(0, 12),
    [sortedRecentReleases],
  );

  const last12CycleTimes = useMemo(
    () => last12ReleasedVersions
      .map((release) => measuredCycleTime(release))
      .filter((value): value is number => value !== null),
    [last12ReleasedVersions],
  );

  const last12AverageCycleTime = useMemo(
    () => average(last12CycleTimes),
    [last12CycleTimes],
  );

  const maxLast12CycleTime = useMemo(
    () => Math.max(1, ...last12CycleTimes),
    [last12CycleTimes],
  );

  const chartReleases = useMemo(
    () => [...last12ReleasedVersions].reverse(),
    [last12ReleasedVersions],
  );

  const releasesWithMissingCycleTime = useMemo(
    () => last12ReleasedVersions
      .map((release) => ({ release, reason: missingCycleReason(release) }))
      .filter((entry): entry is { release: ReleaseInsightRow; reason: string } => entry.reason !== null),
    [last12ReleasedVersions],
  );

  const visibleRiskSignals = insights.riskSignals.length > 0
    ? insights.riskSignals
    : [{
      level: "green" as ReleaseRiskLevel,
      title: "Release posture",
      detail: "No overdue or readiness risks detected in synced JIRA release data.",
    }];

  return (
    <div class="tb-screen-grid">
      <section class="tb-panel">
        <header class="tb-panel-header">
          <div>
            <h3>JIRA Release Overview</h3>
            <p class="tb-muted-note">
              Versions, fixVersion scope, dates, and issue completion from the local JIRA sync.
            </p>
          </div>
          <div class="tb-panel-header-actions">
            <button type="button" class="tb-btn" onClick={() => void loadInsights()} disabled={loading}>
              {loading ? "Loading..." : "Refresh Data"}
            </button>
          </div>
        </header>

        <div class="tb-metrics-grid tb-four-up">
          <article class="tb-metric-card">
            <h4>Ongoing Releases</h4>
            <strong class={`tb-value ${insights.metrics.overdueCount > 0 ? "tb-value-risk" : "tb-value-good"}`}>
              {insights.metrics.ongoingCount}
            </strong>
            <p>{insights.metrics.overdueCount} overdue / {insights.metrics.dueSoonCount} due soon.</p>
          </article>
          <article class="tb-metric-card">
            <h4>Avg Cycle Time</h4>
            <strong class="tb-value">{formatDays(insights.metrics.avgCycleTimeDays)}</strong>
            <p>Released versions with start and release dates.</p>
          </article>
          <article class="tb-metric-card">
            <h4>Release Cadence</h4>
            <strong class="tb-value">{formatDays(insights.metrics.avgCadenceDays)}</strong>
            <p>Average days between released versions.</p>
          </article>
          <article class="tb-metric-card">
            <h4>Delivered Scope</h4>
            <strong class="tb-value">{formatStoryPoints(insights.metrics.deliveredStoryPoints)}</strong>
            <p>{insights.metrics.releasedCount} released / {insights.metrics.totalReleases} total versions.</p>
          </article>
        </div>

        {loading ? (
          <div class="tb-summary is-loading">Loading release insights from local JIRA data...</div>
        ) : (
          <div class="tb-summary">
            <p>{insights.summary}</p>
            <div class="tb-exec-summary-meta">
              <span>Project: {insights.projectKey || "Auto-detected"}</span>
              <span>Generated: {formatGeneratedAt(insights.generatedAt)}</span>
              <span>Archived versions: {insights.metrics.archivedCount}</span>
            </div>
          </div>
        )}
        {error ? <p class="tb-error-note">{error}</p> : null}
      </section>

      <section class="tb-panel">
        <header class="tb-panel-header">
          <div>
            <h3>Release Cycle Time Trend</h3>
            <p class="tb-muted-note">Last 12 released versions from version start date to release date.</p>
          </div>
          <span class="tb-chip">{last12ReleasedVersions.length} shown</span>
        </header>

        {last12ReleasedVersions.length > 0 ? (
          <div class="tb-release-cycle-view">
            <div class="tb-release-cycle-summary">
              <article>
                <span>Measured</span>
                <strong>{last12CycleTimes.length}/{last12ReleasedVersions.length}</strong>
              </article>
              <article>
                <span>Avg Cycle</span>
                <strong>{formatDays(last12AverageCycleTime)}</strong>
              </article>
              <article>
                <span>Fastest</span>
                <strong>{formatDays(last12CycleTimes.length > 0 ? Math.min(...last12CycleTimes) : null)}</strong>
              </article>
              <article>
                <span>Slowest</span>
                <strong>{formatDays(last12CycleTimes.length > 0 ? Math.max(...last12CycleTimes) : null)}</strong>
              </article>
            </div>

            <div class="tb-release-cycle-chart-frame" data-testid="release-cycle-time-trend">
              <ReleaseCycleLineChart
                releases={chartReleases}
                averageCycleTime={last12AverageCycleTime}
                maxCycleTime={maxLast12CycleTime}
              />
              <div class="tb-release-cycle-legend" aria-label="Release cycle chart legend">
                <span><i class="tb-release-cycle-line-swatch" />Cycle time</span>
                <span><i class="tb-release-cycle-average-swatch" />Average</span>
                <span><i class="tb-release-cycle-missing-swatch" />Missing end date / cycle value</span>
              </div>
              <p class="tb-trend-x-axis-label">Oldest to newest among the latest 12 releases</p>
            </div>

            {releasesWithMissingCycleTime.length > 0 ? (
              <div class="tb-release-cycle-gaps" role="list" aria-label="Release cycle missing values">
                {releasesWithMissingCycleTime.map(({ release, reason }) => (
                  <span key={release.versionId} role="listitem">
                    {release.name}: {reason}
                  </span>
                ))}
              </div>
            ) : null}

            <div class="tb-release-cycle-key" role="list" aria-label="Line chart release labels">
              {chartReleases.map((release, index) => (
                <span key={release.versionId} role="listitem">
                  <strong>{compactReleaseLabel(index)}</strong>
                  {release.name}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div class="tb-summary">
            Release cycle-time trend needs released JIRA versions from the current sync.
          </div>
        )}
      </section>

      <section class="tb-panel">
        <header class="tb-panel-header">
          <div>
            <h3>Ongoing Releases</h3>
            <p class="tb-muted-note">Readiness and delivery risk for unreleased, non-archived versions.</p>
          </div>
        </header>

        {sortedOngoingReleases.length > 0 ? (
          <div class="tb-release-table-wrap">
            <table class="tb-release-table">
              <thead>
                <tr>
                  <th>Release</th>
                  <th>Target</th>
                  <th class="is-numeric">Age</th>
                  <th class="is-readiness">Readiness</th>
                  <th class="is-numeric">Scope</th>
                  <th>Risk</th>
                </tr>
              </thead>
              <tbody>
                {sortedOngoingReleases.map((release) => (
                  <tr key={release.versionId}>
                    <td>
                      <div class="tb-release-name-cell">
                        <strong>{release.name}</strong>
                        <span>{releaseSecondaryLine(release)}</span>
                      </div>
                    </td>
                    <td>{formatDate(release.releaseDate)}</td>
                    <td class="tb-release-numeric">{formatDays(release.ageDays)}</td>
                    <td>
                      <div class="tb-release-readiness">
                        <div class="tb-release-readiness-track">
                          <span style={{ width: `${Math.max(0, Math.min(100, release.readinessPercent))}%` }} />
                        </div>
                        <span>{formatPercent(release.readinessPercent)} | {readinessLabel(release)}</span>
                      </div>
                    </td>
                    <td class="tb-release-numeric">
                      {release.issueCount} / {formatStoryPoints(release.storyPoints)}
                    </td>
                    <td>
                      <span class={`tb-release-risk ${riskToneClass(release.riskLevel)}`}>
                        {release.riskLevel}
                      </span>
                      <p class="tb-release-risk-detail">{release.riskSummary}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div class="tb-summary">No ongoing JIRA releases found in the current sync.</div>
        )}
      </section>

      <section class="tb-panel">
        <header class="tb-panel-header">
          <div>
            <h3>Release Risk Signals</h3>
            <p class="tb-muted-note">Signals derived from dates, readiness, and linked fixVersion scope.</p>
          </div>
        </header>
        <div class="tb-release-risk-grid">
          {visibleRiskSignals.map((signal) => (
            <article key={`${signal.title}-${signal.detail}`} class="tb-metric-card">
              <h4>{signal.title}</h4>
              <strong class={`tb-release-risk-heading ${riskValueClass(signal.level)}`}>{signal.level}</strong>
              <p>{signal.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section class="tb-panel">
        <header class="tb-panel-header">
          <div>
            <h3>Recent Released Versions</h3>
            <p class="tb-muted-note">Delivered scope, cycle time, and completion quality for released versions.</p>
          </div>
        </header>

        {last12ReleasedVersions.length > 0 ? (
          <div class="tb-initiative-table-wrap tb-release-recent-table-wrap">
            <table class="tb-initiative-table tb-release-recent-table" aria-label="Recent released versions">
              <thead>
                <tr>
                  <th>Release</th>
                  <th>Released</th>
                  <th class="tb-release-recent-numeric">Cycle Time</th>
                  <th class="tb-release-recent-numeric">Scope</th>
                  <th>Completion</th>
                  <th>Mix</th>
                  <th>Risk</th>
                </tr>
              </thead>
              <tbody>
                {last12ReleasedVersions.map((release) => (
                  <tr key={release.versionId}>
                    <td>
                      <div class="tb-release-name-cell">
                        <strong>{release.name}</strong>
                        <span>{formatDate(release.startDate)} to {formatDate(release.releaseDate)}</span>
                      </div>
                    </td>
                    <td>{formatDate(release.releaseDate)}</td>
                    <td class="tb-release-recent-numeric">{cycleTimeStatusLabel(release)}</td>
                    <td class="tb-release-recent-numeric">
                      {release.issueCount} cards / {formatStoryPoints(release.doneStoryPoints)}
                    </td>
                    <td>
                      <div class="tb-release-readiness">
                        <div class="tb-release-readiness-track">
                          <span style={{ width: `${Math.max(0, Math.min(100, release.readinessPercent))}%` }} />
                        </div>
                        <span>{formatPercent(release.readinessPercent)} | {readinessLabel(release)}</span>
                      </div>
                    </td>
                    <td class="tb-release-mix-cell">{releaseMixLabel(release)}</td>
                    <td>
                      <span class={`tb-release-risk ${riskToneClass(release.riskLevel)}`}>{release.riskLevel}</span>
                      <p class="tb-release-risk-detail">{release.riskSummary}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div class="tb-summary">No released JIRA versions with linked scope are available yet.</div>
        )}
      </section>
    </div>
  );
}
