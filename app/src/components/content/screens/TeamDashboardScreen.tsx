import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  CircleAlert,
  CircleCheckBig,
  Minus,
  RefreshCw,
} from "lucide-react";
import {
  fetchTeamDashboard,
  type TeamDashboardFlowWeeks,
  type TeamDashboardResponse,
  type TeamDashboardSprintCycleTime,
  type TeamDashboardWorkStream,
} from "../../../lib/api";
import { getPreferenceSync, setPreference } from "../../../lib/persistence";

const TEAM_DASHBOARD_FLOW_WEEKS_KEY = "teambeacon.teamDashboard.flowWeeks";
const FLOW_WEEK_OPTIONS: TeamDashboardFlowWeeks[] = [1, 4, 12];

type Props = {
  onOpenWorkStream?: (workStreamId: number) => void;
  onOpenReleaseInsights?: () => void;
  onOpenTeamInsights?: () => void;
  onOpenSprintInsights?: () => void;
  onOpenDeepDive?: () => void;
  onOpenSettings?: () => void;
};

type WorkStreamSortField =
  | "name"
  | "epicCount"
  | "newCount"
  | "completedCount"
  | "netFlow"
  | "currentWipCount"
  | "completionPercent";

type SortDirection = "asc" | "desc";

type SortableHeaderProps = {
  field: WorkStreamSortField;
  label: string;
  activeField: WorkStreamSortField;
  direction: SortDirection;
  rowSpan?: number;
  className?: string;
  onSort: (field: WorkStreamSortField) => void;
};

function defaultSortDirection(field: WorkStreamSortField): SortDirection {
  return field === "name" ? "asc" : "desc";
}

function compareWorkStreams(
  left: TeamDashboardWorkStream,
  right: TeamDashboardWorkStream,
  field: WorkStreamSortField,
  direction: SortDirection,
): number {
  const comparison = field === "name"
    ? left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" })
    : left[field] - right[field];
  if (comparison === 0 && field !== "name") {
    return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
  }
  return direction === "asc" ? comparison : -comparison;
}

function SortableHeader({
  field,
  label,
  activeField,
  direction,
  rowSpan,
  className,
  onSort,
}: SortableHeaderProps) {
  const isActive = field === activeField;
  const announcedDirection = isActive ? direction : defaultSortDirection(field);
  const indicator = isActive ? direction === "asc" ? "↑" : "↓" : "↕";
  return (
    <th
      scope="col"
      rowSpan={rowSpan}
      className={className}
      aria-sort={isActive ? direction === "asc" ? "ascending" : "descending" : undefined}
    >
      <button
        type="button"
        className={`tb-table-sort${isActive ? " is-active" : ""}`}
        aria-label={`Sort by ${label} (${announcedDirection === "asc" ? "ascending" : "descending"})`}
        onClick={() => onSort(field)}
      >
        <span>{label}</span>
        <span className="tb-table-sort-indicator" aria-hidden="true">{indicator}</span>
      </button>
    </th>
  );
}

function clampPercentage(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function flowGapLabel(value: number): string {
  if (value > 0) return `+${value} growing`;
  if (value < 0) return `${Math.abs(value)} reduced`;
  return "Balanced";
}

function flowGapTone(value: number): string {
  if (value > 0) return "is-warning";
  if (value < 0) return "is-good";
  return "is-neutral";
}

function readFlowWeeks(): TeamDashboardFlowWeeks {
  const value = Number.parseInt(getPreferenceSync(TEAM_DASHBOARD_FLOW_WEEKS_KEY) ?? "", 10);
  return FLOW_WEEK_OPTIONS.includes(value as TeamDashboardFlowWeeks) ? value as TeamDashboardFlowWeeks : 4;
}

function formatDate(value?: string | null): string {
  if (!value) return "Not available";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Not available";
  return new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short", year: "numeric" }).format(parsed);
}

function formatTimestamp(value?: string | null): string {
  if (!value) return "Not available";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Not available";
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function formatDays(value?: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Not available";
  return `${value.toFixed(value % 1 === 0 ? 0 : 1)} days`;
}

function flowRangeLabel(weeks: TeamDashboardFlowWeeks): string {
  return weeks === 1 ? "Last week" : `Last ${weeks} weeks`;
}

function CycleDelta({ cycleTime }: { cycleTime: TeamDashboardSprintCycleTime }) {
  const delta = cycleTime.deltaDays;
  if (typeof delta !== "number") {
    return <span className="tb-dashboard-delta is-neutral"><Minus size={15} aria-hidden="true" />No previous sprint</span>;
  }
  if (cycleTime.direction === "down") {
    return (
      <span className="tb-dashboard-delta is-good">
        <ArrowDownRight size={16} aria-hidden="true" />{Math.abs(delta).toFixed(1)} days faster
      </span>
    );
  }
  if (cycleTime.direction === "up") {
    return (
      <span className="tb-dashboard-delta is-warning">
        <ArrowUpRight size={16} aria-hidden="true" />{Math.abs(delta).toFixed(1)} days slower
      </span>
    );
  }
  return <span className="tb-dashboard-delta is-neutral"><Minus size={15} aria-hidden="true" />No change</span>;
}

export function TeamDashboardScreen({
  onOpenWorkStream,
  onOpenReleaseInsights,
  onOpenTeamInsights,
  onOpenSprintInsights,
  onOpenDeepDive,
  onOpenSettings,
}: Props) {
  const [flowWeeks, setFlowWeeks] = useState<TeamDashboardFlowWeeks>(readFlowWeeks);
  const [payload, setPayload] = useState<TeamDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workStreamSortField, setWorkStreamSortField] = useState<WorkStreamSortField>("netFlow");
  const [workStreamSortDirection, setWorkStreamSortDirection] = useState<SortDirection>("desc");

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchTeamDashboard(flowWeeks, 5);
      setPayload(response);
    } catch (loadError) {
      setPayload(null);
      setError(loadError instanceof Error ? loadError.message : "Unable to load Team Dashboard.");
    } finally {
      setLoading(false);
    }
  }, [flowWeeks]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const sectionErrorCount = useMemo(() => Object.keys(payload?.errors ?? {}).length, [payload?.errors]);
  const flowPeriodText = payload?.flowPeriod.startDate && payload.flowPeriod.endDate
    ? `${formatDate(payload.flowPeriod.startDate)} – ${formatDate(payload.flowPeriod.endDate)}`
    : flowRangeLabel(flowWeeks);
  const sortedWorkStreams = useMemo(() => (
    [...(payload?.workStreams ?? [])].sort((left, right) => compareWorkStreams(
      left,
      right,
      workStreamSortField,
      workStreamSortDirection,
    ))
  ), [payload?.workStreams, workStreamSortDirection, workStreamSortField]);
  const workStreamTotals = useMemo(() => {
    const totals = (payload?.workStreams ?? []).reduce((current, workStream) => ({
      epicCount: current.epicCount + workStream.epicCount,
      newCount: current.newCount + workStream.newCount,
      completedCount: current.completedCount + workStream.completedCount,
      netFlow: current.netFlow + workStream.netFlow,
      currentWipCount: current.currentWipCount + workStream.currentWipCount,
      totalCards: current.totalCards + workStream.totalCards,
      totalCompletedCards: current.totalCompletedCards + workStream.totalCompletedCards,
    }), {
      epicCount: 0,
      newCount: 0,
      completedCount: 0,
      netFlow: 0,
      currentWipCount: 0,
      totalCards: 0,
      totalCompletedCards: 0,
    });
    return {
      ...totals,
      completionPercent: totals.totalCards > 0
        ? (totals.totalCompletedCards / totals.totalCards) * 100
        : 0,
    };
  }, [payload?.workStreams]);

  const updateFlowWeeks = (value: TeamDashboardFlowWeeks) => {
    setFlowWeeks(value);
    void setPreference(TEAM_DASHBOARD_FLOW_WEEKS_KEY, String(value));
  };

  const updateWorkStreamSort = (field: WorkStreamSortField) => {
    if (field === workStreamSortField) {
      setWorkStreamSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }
    setWorkStreamSortField(field);
    setWorkStreamSortDirection(defaultSortDirection(field));
  };

  return (
    <div className="tb-dashboard" aria-busy={loading}>
      <section className="tb-panel tb-dashboard-intro">
        <div>
          <p className="tb-eyebrow">Operational snapshot</p>
          <h3>What needs attention today</h3>
          <p>Delivery flow, release movement, sprint speed, blockers, and recent outcomes in one place.</p>
        </div>
        <div className="tb-dashboard-freshness">
          <span>Data as of</span>
          <strong>{loading ? "Refreshing…" : formatTimestamp(payload?.generatedAt)}</strong>
          <button type="button" className="tb-btn tb-btn-sm" onClick={() => void loadDashboard()} disabled={loading}>
            <RefreshCw size={15} aria-hidden="true" /> Refresh
          </button>
        </div>
      </section>

      {error ? (
        <section className="tb-panel tb-dashboard-error" role="alert">
          <CircleAlert size={20} aria-hidden="true" />
          <div><strong>Dashboard unavailable</strong><p>{error}</p></div>
          <button type="button" className="tb-btn tb-btn-sm" onClick={() => void loadDashboard()}>Try again</button>
        </section>
      ) : null}

      {sectionErrorCount > 0 && !error ? (
        <p className="tb-dashboard-partial-note" role="status">
          <CircleAlert size={16} aria-hidden="true" /> Some dashboard sections could not be refreshed.
        </p>
      ) : null}

      <section className="tb-dashboard-kpi-grid" aria-label="Team delivery highlights">
        <article className={`tb-dashboard-kpi${(payload?.blockedItems.count ?? 0) > 0 ? " is-attention" : " is-positive"}`}>
          <div className="tb-dashboard-kpi-heading">
            <span>Current sprint blockers</span>
            {(payload?.blockedItems.count ?? 0) > 0
              ? <CircleAlert size={19} aria-hidden="true" />
              : <CircleCheckBig size={19} aria-hidden="true" />}
          </div>
          <strong>{loading ? "—" : payload?.blockedItems.count ?? 0}</strong>
          <p>
            {payload?.blockedItems.sprintName ?? "No active sprint"}
            {payload?.blockedItems.storyPointsTotal ? ` · ${payload.blockedItems.storyPointsTotal} SP` : ""}
          </p>
          <button type="button" onClick={onOpenSprintInsights}>View Sprint Insights</button>
        </article>

        <article className="tb-dashboard-kpi">
          <div className="tb-dashboard-kpi-heading"><span>Latest completed release</span></div>
          <strong className="tb-dashboard-kpi-name">{loading ? "—" : payload?.latestRelease?.name ?? "No completed release"}</strong>
          <p>{payload?.latestRelease ? `${formatDate(payload.latestRelease.releaseDate)} · ${formatDays(payload.latestRelease.cycleTimeDays)}` : "Release data is not available."}</p>
          <button type="button" onClick={onOpenReleaseInsights}>View Release Insights</button>
        </article>

        <article className="tb-dashboard-kpi">
          <div className="tb-dashboard-kpi-heading"><span>Latest sprint cycle time</span></div>
          <strong>{loading ? "—" : formatDays(payload?.sprintCycleTime?.latestAverageDays)}</strong>
          <p>{payload?.sprintCycleTime?.latestSprintName ?? "No completed sprint data"}</p>
          {payload?.sprintCycleTime ? <CycleDelta cycleTime={payload.sprintCycleTime} /> : null}
          <button type="button" onClick={onOpenTeamInsights}>View Team Insights</button>
        </article>
      </section>

      <section className="tb-panel tb-dashboard-work-streams">
        <header className="tb-panel-header">
          <div>
            <p className="tb-eyebrow">Work stream insights</p>
            <h3>Intake, completion, and delivery progress</h3>
            <p className="tb-muted-note">
              Created and completed cards use {flowRangeLabel(flowWeeks).toLowerCase()}. Flow gap is created minus completed; progress covers all scoped cards.
            </p>
          </div>
          <label className="tb-dashboard-range">
            <span>Flow period</span>
            <select
              value={flowWeeks}
              onChange={(event) => updateFlowWeeks(Number(event.currentTarget.value) as TeamDashboardFlowWeeks)}
            >
              {FLOW_WEEK_OPTIONS.map((weeks) => <option key={weeks} value={weeks}>{flowRangeLabel(weeks)}</option>)}
            </select>
            <small>{flowPeriodText}</small>
          </label>
        </header>

        {loading && !payload ? <p className="tb-muted-note">Loading work-stream flow…</p> : null}
        {!loading && payload?.workStreams.length === 0 ? (
          <div className="tb-dashboard-empty">
            <strong>No work streams configured</strong>
            <p>Add work streams and assign configured epics before using this overview.</p>
            <button type="button" className="tb-btn tb-btn-sm" onClick={onOpenSettings}>Open Settings</button>
          </div>
        ) : null}

        {sortedWorkStreams.length > 0 ? (
          <div className="tb-dashboard-work-stream-table-wrap" role="region" aria-label="Work stream comparison" tabIndex={0}>
            <table className="tb-data-table tb-dashboard-work-stream-table">
              <caption className="tb-visually-hidden">
                Work streams compared by recent card flow, current work in progress, and overall delivery progress.
              </caption>
              <thead>
                <tr className="tb-dashboard-table-groups">
                  <SortableHeader
                    field="name"
                    label="Work stream"
                    activeField={workStreamSortField}
                    direction={workStreamSortDirection}
                    rowSpan={2}
                    onSort={updateWorkStreamSort}
                  />
                  <SortableHeader
                    field="epicCount"
                    label="Epics"
                    activeField={workStreamSortField}
                    direction={workStreamSortDirection}
                    rowSpan={2}
                    className="is-number"
                    onSort={updateWorkStreamSort}
                  />
                  <th scope="colgroup" colSpan={3}>Recent flow · {flowRangeLabel(flowWeeks)}</th>
                  <SortableHeader
                    field="currentWipCount"
                    label="Current WIP"
                    activeField={workStreamSortField}
                    direction={workStreamSortDirection}
                    rowSpan={2}
                    className="is-number"
                    onSort={updateWorkStreamSort}
                  />
                  <SortableHeader
                    field="completionPercent"
                    label="Overall delivery"
                    activeField={workStreamSortField}
                    direction={workStreamSortDirection}
                    rowSpan={2}
                    className="is-progress"
                    onSort={updateWorkStreamSort}
                  />
                </tr>
                <tr>
                  <SortableHeader
                    field="newCount"
                    label="Created"
                    activeField={workStreamSortField}
                    direction={workStreamSortDirection}
                    className="is-number is-new"
                    onSort={updateWorkStreamSort}
                  />
                  <SortableHeader
                    field="completedCount"
                    label="Completed"
                    activeField={workStreamSortField}
                    direction={workStreamSortDirection}
                    className="is-number is-completed"
                    onSort={updateWorkStreamSort}
                  />
                  <SortableHeader
                    field="netFlow"
                    label="Flow gap"
                    activeField={workStreamSortField}
                    direction={workStreamSortDirection}
                    className="is-flow-gap"
                    onSort={updateWorkStreamSort}
                  />
                </tr>
              </thead>
              <tbody>
                {sortedWorkStreams.map((workStream) => {
                  const progress = clampPercentage(workStream.completionPercent);
                  return (
                    <tr key={workStream.id}>
                      <td data-label="Work stream" className="tb-dashboard-work-stream-name">
                        <button type="button" onClick={() => onOpenWorkStream?.(workStream.id)}>{workStream.name}</button>
                        {workStream.error ? <small className="tb-error-note">Flow data unavailable</small> : null}
                      </td>
                      <td data-label="Epics" className="is-number">{workStream.epicCount}</td>
                      <td data-label="Created" className="is-number is-new">{workStream.newCount}</td>
                      <td data-label="Completed" className="is-number is-completed">{workStream.completedCount}</td>
                      <td data-label="Flow gap">
                        <span className={`tb-dashboard-flow-gap ${flowGapTone(workStream.netFlow)}`}>
                          {flowGapLabel(workStream.netFlow)}
                        </span>
                      </td>
                      <td data-label="Current WIP" className="is-number">{workStream.currentWipCount}</td>
                      <td data-label="Overall delivery" className="tb-dashboard-delivery-cell">
                        <div className="tb-dashboard-progress-copy">
                          <strong>{workStream.completionPercent.toFixed(0)}%</strong>
                          <span>{workStream.totalCompletedCards}/{workStream.totalCards} completed</span>
                        </div>
                        <div
                          className="tb-dashboard-progress"
                          role="progressbar"
                          aria-label={`${workStream.name} delivery progress`}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={progress}
                        >
                          <span style={{ width: `${progress}%` }} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" data-label="Work stream">All work streams</th>
                  <td data-label="Epics" className="is-number">{workStreamTotals.epicCount}</td>
                  <td data-label="Created" className="is-number is-new">{workStreamTotals.newCount}</td>
                  <td data-label="Completed" className="is-number is-completed">{workStreamTotals.completedCount}</td>
                  <td data-label="Flow gap">
                    <span className={`tb-dashboard-flow-gap ${flowGapTone(workStreamTotals.netFlow)}`}>
                      {flowGapLabel(workStreamTotals.netFlow)}
                    </span>
                  </td>
                  <td data-label="Current WIP" className="is-number">{workStreamTotals.currentWipCount}</td>
                  <td data-label="Overall delivery" className="tb-dashboard-delivery-cell">
                    <div className="tb-dashboard-progress-copy">
                      <strong>{workStreamTotals.completionPercent.toFixed(0)}%</strong>
                      <span>{workStreamTotals.totalCompletedCards}/{workStreamTotals.totalCards} completed</span>
                    </div>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : null}
      </section>

      <section className="tb-dashboard-activity-grid">
        <article className="tb-panel">
          <header className="tb-panel-header">
            <div><p className="tb-eyebrow">Attention</p><h3>Blocked items</h3></div>
            <span className="tb-dashboard-count">{payload?.blockedItems.count ?? 0}</span>
          </header>
          <div className="tb-dashboard-item-list">
            {payload?.blockedItems.items.map((item) => (
              <div key={item.issueKey} className="tb-dashboard-item">
                <div>
                  {item.issueUrl ? <a href={item.issueUrl} target="_blank" rel="noopener noreferrer">{item.issueKey}</a> : <strong>{item.issueKey}</strong>}
                  <p title={item.summary}>{item.summary}</p>
                </div>
                <span>{item.status ?? "Blocked"}{item.storyPoints != null ? ` · ${item.storyPoints} SP` : ""}</span>
              </div>
            ))}
            {!loading && (payload?.blockedItems.items.length ?? 0) === 0 ? <p className="tb-dashboard-list-empty">No blocked cards in the current sprint.</p> : null}
          </div>
          <button type="button" className="tb-dashboard-view-all" onClick={onOpenSprintInsights}>View all in Sprint Insights</button>
        </article>

        <article className="tb-panel">
          <header className="tb-panel-header">
            <div><p className="tb-eyebrow">Outcomes</p><h3>Recently completed</h3></div>
            <span className="tb-dashboard-count">{payload?.recentlyCompleted.count ?? 0}</span>
          </header>
          <div className="tb-dashboard-item-list">
            {payload?.recentlyCompleted.items.map((item) => (
              <div key={item.issueKey} className="tb-dashboard-item">
                <div>
                  {item.issueUrl ? <a href={item.issueUrl} target="_blank" rel="noopener noreferrer">{item.issueKey}</a> : <strong>{item.issueKey}</strong>}
                  <p title={item.summary}>{item.summary}</p>
                </div>
                <span>{item.workStreamName} · {formatDate(item.completedAt)}</span>
              </div>
            ))}
            {!loading && (payload?.recentlyCompleted.items.length ?? 0) === 0 ? <p className="tb-dashboard-list-empty">No cards completed in the last seven days.</p> : null}
          </div>
          <button type="button" className="tb-dashboard-view-all" onClick={onOpenDeepDive}>View completion flow</button>
        </article>
      </section>
    </div>
  );
}
