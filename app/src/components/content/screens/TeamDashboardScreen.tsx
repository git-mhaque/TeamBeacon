import { DateRangeFields, validateDateRange, type DateRange } from "../DateRangeFields";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
import { formatDisplayTimestamp } from "../../../lib/dateTime";
import { getPreferenceSync, setPreference } from "../../../lib/persistence";
import { readTeamInsightsCycleTimeStatusKeys } from "../../../lib/teamInsightsSettings";
import {
  TeamDashboardIssueOverlay,
  type TeamDashboardIssueMetric,
  type TeamDashboardIssueSelection,
} from "./TeamDashboardIssueOverlay";

const TEAM_DASHBOARD_FLOW_WEEKS_KEY = "teambeacon.teamDashboard.flowWeeks";
const FLOW_RANGE_KEY = "teambeacon.teamDashboard.flowRange";
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
  | "completionSharePercent";

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
    : field === "completionSharePercent" ? left.completedCount - right.completedCount : left[field] - right[field];
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

function MetricDrilldownButton({
  label,
  className,
  children,
  onClick,
}: {
  label: string;
  className?: string;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`tb-dashboard-metric-link${className ? ` ${className}` : ""}`}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function CompletionShare({ count, total, name, onClick }: { count: number; total: number; name: string; onClick: () => void }) {
  if (total === 0) return <span aria-label={`${name} completion share unavailable`}>—</span>;
  const share = Math.max(0, Math.min(100, count / total * 100));
  const label = `${Number(share.toFixed(1))}%`;
  return <>
    <MetricDrilldownButton label={`View ${count} completed JIRA cards contributing to ${name} completion share`} onClick={onClick}>{label}</MetricDrilldownButton>
    <div className="tb-dashboard-progress tb-dashboard-completion-share" role="meter" aria-label={`${name} share of completions`}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number(share.toFixed(1))}>
      <span style={{ width: `${share}%` }} />
    </div>
  </>;
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

function readFlowRange(): DateRange | null {
  try {
    const range = JSON.parse(getPreferenceSync(FLOW_RANGE_KEY) ?? "null") as DateRange | null;
    return range && !validateDateRange(range) ? range : null;
  } catch {
    return null;
  }
}

function formatDate(value?: string | null): string {
  if (!value) return "Not available";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Not available";
  return new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short", year: "numeric" }).format(parsed);
}

function formatTimestamp(value?: string | null): string {
  return formatDisplayTimestamp(value);
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

function WorkStreamTableSkeleton() {
  return (
    <div className="tb-dashboard-work-stream-table-wrap tb-dashboard-loading-table" role="status" aria-live="polite">
      <span className="tb-visually-hidden">Loading work-stream insights…</span>
      <table className="tb-data-table tb-dashboard-work-stream-table" aria-hidden="true">
        <thead>
          <tr>
            <th scope="col">Work Streams</th>
            <th scope="col" className="is-number">Epics</th>
            <th scope="col" className="is-number">Created</th>
            <th scope="col" className="is-number">Completed</th>
            <th scope="col" className="is-flow-gap">Net backlog change</th>
            <th scope="col" className="is-number">Current WIP</th>
            <th scope="col" className="is-progress">Share of completions</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 6 }, (_, index) => (
            <tr key={index} className="tb-dashboard-skeleton-row">
              <td data-label="Work Streams"><span className="tb-dashboard-skeleton is-table-name" /></td>
              <td data-label="Epics" className="is-number"><span className="tb-dashboard-skeleton is-table-number" /></td>
              <td data-label="Created" className="is-number"><span className="tb-dashboard-skeleton is-table-number" /></td>
              <td data-label="Completed" className="is-number"><span className="tb-dashboard-skeleton is-table-number" /></td>
              <td data-label="Net backlog change"><span className="tb-dashboard-skeleton is-table-pill" /></td>
              <td data-label="Current WIP" className="is-number"><span className="tb-dashboard-skeleton is-table-number" /></td>
              <td data-label="Share of completions" className="tb-dashboard-delivery-cell">
                <span className="tb-dashboard-skeleton is-table-progress-copy" />
                <span className="tb-dashboard-skeleton is-table-progress" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TeamDashboardScreen({
  onOpenWorkStream,
  onOpenReleaseInsights,
  onOpenTeamInsights,
  onOpenSprintInsights,
  onOpenSettings,
}: Props) {
  const [flowWeeks, setFlowWeeks] = useState<TeamDashboardFlowWeeks>(readFlowWeeks);
  const [flowRange, setFlowRange] = useState<DateRange | null>(readFlowRange);
  const [flowDraft, setFlowDraft] = useState<DateRange>({ startDate: "", endDate: "" });
  const [isFlowConfigOpen, setIsFlowConfigOpen] = useState(false);
  const [flowValidationError, setFlowValidationError] = useState<string | null>(null);
  const [cycleTimeStatusKeys] = useState(readTeamInsightsCycleTimeStatusKeys);
  const [payload, setPayload] = useState<TeamDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [topbarActionsTarget, setTopbarActionsTarget] = useState<HTMLElement | null>(null);
  const [workStreamSortField, setWorkStreamSortField] = useState<WorkStreamSortField>("netFlow");
  const [workStreamSortDirection, setWorkStreamSortDirection] = useState<SortDirection>("desc");
  const [issueSelection, setIssueSelection] = useState<TeamDashboardIssueSelection | null>(null);
  const flowCancelRef = useRef<HTMLButtonElement>(null);
  const initialLoading = loading && payload == null;

  const loadDashboard = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchTeamDashboard(
        flowWeeks,
        5,
        Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
        cycleTimeStatusKeys,
        forceRefresh,
        flowRange,
      );
      setPayload(response);
    } catch (loadError) {
      setPayload(null);
      setError(loadError instanceof Error ? loadError.message : "Unable to load Team Dashboard.");
    } finally {
      setLoading(false);
    }
  }, [cycleTimeStatusKeys, flowWeeks, flowRange]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (isFlowConfigOpen) flowCancelRef.current?.focus();
  }, [isFlowConfigOpen]);

  useLayoutEffect(() => {
    setTopbarActionsTarget(document.querySelector<HTMLElement>(".tb-main-dashboard > .tb-topbar"));
  }, []);

  const sectionErrorCount = useMemo(() => Object.keys(payload?.errors ?? {}).length, [payload?.errors]);
  const flowPeriodText = payload?.flowPeriod.startDate && payload.flowPeriod.endDate
    ? `${formatDate(payload.flowPeriod.startDate)} – ${formatDate(payload.flowPeriod.endDate)}`
    : flowRange ? `${formatDate(flowRange.startDate)} – ${formatDate(flowRange.endDate)}` : flowRangeLabel(flowWeeks);
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
    }), {
      epicCount: 0,
      newCount: 0,
      completedCount: 0,
      netFlow: 0,
      currentWipCount: 0,
    });
    return totals;
  }, [payload?.workStreams]);

  const updateFlowWeeks = (value: TeamDashboardFlowWeeks) => {
    setFlowRange(null);
    void setPreference(FLOW_RANGE_KEY, "null");
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

  const openIssueOverlay = (
    metric: TeamDashboardIssueMetric,
    scopeName: string,
    groupIds: number[],
    value: number,
  ) => {
    setIssueSelection({ metric, scopeName, groupIds, value });
  };
  const closeIssueOverlay = useCallback(() => setIssueSelection(null), []);

  const freshnessActions = (
    <div className="tb-dashboard-freshness">
      <span className="tb-dashboard-freshness-copy">
        <span>Data as of</span>
        <strong>{loading ? payload ? "Refreshing…" : "Loading…" : formatTimestamp(payload?.dataAsOf ?? payload?.generatedAt)}</strong>
      </span>
      <button type="button" className="tb-btn tb-btn-sm" onClick={() => void loadDashboard(true)} disabled={loading}>
        <RefreshCw className={loading ? "is-spinning" : undefined} size={15} aria-hidden="true" /> Refresh
      </button>
    </div>
  );

  return (
    <div className="tb-dashboard" aria-busy={loading}>
      {topbarActionsTarget
        ? createPortal(freshnessActions, topbarActionsTarget)
        : <div className="tb-dashboard-inline-actions">{freshnessActions}</div>}

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
        <article className="tb-dashboard-kpi">
          <div className="tb-dashboard-kpi-heading"><span>Latest completed release</span></div>
          <strong className="tb-dashboard-kpi-name">
            {initialLoading
              ? <span className="tb-dashboard-skeleton is-kpi-value is-wide" aria-hidden="true" />
              : payload?.latestRelease?.name ?? "No completed release"}
          </strong>
          <p>
            {initialLoading
              ? <span className="tb-dashboard-skeleton is-kpi-detail" aria-hidden="true" />
              : payload?.latestRelease
                ? `${formatDate(payload.latestRelease.releaseDate)} · ${formatDays(payload.latestRelease.cycleTimeDays)}`
                : "Release data is not available."}
          </p>
          <button type="button" onClick={onOpenReleaseInsights}>View Release Insights</button>
        </article>

        <article className="tb-dashboard-kpi">
          <div className="tb-dashboard-kpi-heading"><span>Latest sprint cycle time</span></div>
          <strong>
            {initialLoading
              ? <span className="tb-dashboard-skeleton is-kpi-value" aria-hidden="true" />
              : formatDays(payload?.sprintCycleTime?.latestAverageDays)}
          </strong>
          <p>
            {initialLoading
              ? <span className="tb-dashboard-skeleton is-kpi-detail" aria-hidden="true" />
              : payload?.sprintCycleTime?.latestSprintName ?? "No completed sprint data"}
          </p>
          {payload?.sprintCycleTime ? <CycleDelta cycleTime={payload.sprintCycleTime} /> : null}
          <button type="button" onClick={onOpenTeamInsights}>View Team Insights</button>
        </article>

        <article className={`tb-dashboard-kpi${initialLoading ? "" : (payload?.blockedItems.count ?? 0) > 0 ? " is-attention" : " is-positive"}`}>
          <div className="tb-dashboard-kpi-heading">
            <span>Current sprint blockers</span>
            {initialLoading
              ? <span className="tb-dashboard-skeleton is-kpi-icon" aria-hidden="true" />
              : (payload?.blockedItems.count ?? 0) > 0
                ? <CircleAlert size={19} aria-hidden="true" />
                : <CircleCheckBig size={19} aria-hidden="true" />}
          </div>
          <strong>
            {initialLoading
              ? <span className="tb-dashboard-skeleton is-kpi-value is-compact" aria-hidden="true" />
              : payload?.blockedItems.count ?? 0}
          </strong>
          <p>
            {initialLoading
              ? <span className="tb-dashboard-skeleton is-kpi-detail" aria-hidden="true" />
              : (
                <>
                  {payload?.blockedItems.sprintName ?? "No active sprint"}
                  {payload?.blockedItems.storyPointsTotal ? ` · ${payload.blockedItems.storyPointsTotal} SP` : ""}
                </>
              )}
          </p>
          <button type="button" onClick={onOpenSprintInsights}>View Sprint Insights</button>
        </article>
      </section>

      <section className="tb-panel tb-dashboard-work-streams">
        <header className="tb-panel-header">
          <div>
            <p className="tb-eyebrow">Work stream insights</p>
            <h3>Intake, throughput, and work mix</h3>
            <p className="tb-muted-note">
              Created, completed, and completion share use {flowRange ? "the custom period" : flowRangeLabel(flowWeeks).toLowerCase()}. Net backlog change is created minus completed; Current WIP is a current snapshot. Each card is counted once under its primary work stream, including Unmapped.
            </p>
          </div>
          <div className="tb-dashboard-flow-controls">
          <label className="tb-dashboard-range">
            <span>Flow period</span>
            <select
              value={flowRange ? "custom" : flowWeeks}
              disabled={loading}
              onChange={(event) => {
                if (event.currentTarget.value !== "custom") {
                  updateFlowWeeks(Number(event.currentTarget.value) as TeamDashboardFlowWeeks);
                  return;
                }
                setFlowDraft(flowRange ?? { startDate: payload?.flowPeriod.startDate ?? "", endDate: payload?.flowPeriod.endDate ?? "" });
                setFlowValidationError(null);
                setIsFlowConfigOpen(true);
              }}
            >
              {FLOW_WEEK_OPTIONS.map((weeks) => <option key={weeks} value={weeks}>{flowRangeLabel(weeks)}</option>)}
              <option value="custom">Custom</option>
            </select>
            <small>{flowPeriodText}</small>
          </label>
          {flowRange ? <button type="button" className="tb-btn tb-btn-sm" disabled={loading} onClick={() => {
            setFlowDraft(flowRange);
            setFlowValidationError(null);
            setIsFlowConfigOpen(true);
          }}>Edit flow period</button> : null}
          </div>
        </header>

        {initialLoading ? <WorkStreamTableSkeleton /> : null}
        {!initialLoading && payload?.workStreams.length === 0 ? (
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
                Work streams compared by card flow and share of completions in the selected period, plus current work in progress.
              </caption>
              <thead>
                <tr>
                  <SortableHeader
                    field="name"
                    label="Work Streams"
                    activeField={workStreamSortField}
                    direction={workStreamSortDirection}
                    onSort={updateWorkStreamSort}
                  />
                  <SortableHeader
                    field="epicCount"
                    label="Epics"
                    activeField={workStreamSortField}
                    direction={workStreamSortDirection}
                    className="is-number"
                    onSort={updateWorkStreamSort}
                  />
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
                    label="Net backlog change"
                    activeField={workStreamSortField}
                    direction={workStreamSortDirection}
                    className="is-flow-gap"
                    onSort={updateWorkStreamSort}
                  />
                  <SortableHeader
                    field="currentWipCount"
                    label="Current WIP"
                    activeField={workStreamSortField}
                    direction={workStreamSortDirection}
                    className="is-number"
                    onSort={updateWorkStreamSort}
                  />
                  <SortableHeader
                    field="completionSharePercent"
                    label="Share of completions"
                    activeField={workStreamSortField}
                    direction={workStreamSortDirection}
                    className="is-progress"
                    onSort={updateWorkStreamSort}
                  />
                </tr>
              </thead>
              <tbody>
                {sortedWorkStreams.map((workStream) => {
                  return (
                    <tr key={workStream.id}>
                      <td data-label="Work Streams" className="tb-dashboard-work-stream-name">
                        <button type="button" onClick={() => workStream.id === 0 ? onOpenSettings?.() : onOpenWorkStream?.(workStream.id)}>{workStream.name}</button>
                        {workStream.error ? <small className="tb-error-note">Flow data unavailable</small> : null}
                      </td>
                      <td data-label="Epics" className="is-number">
                        <MetricDrilldownButton
                          label={`View ${workStream.epicCount} configured JIRA epics for ${workStream.name}`}
                          onClick={() => openIssueOverlay("epics", workStream.name, [workStream.id], workStream.epicCount)}
                        >
                          {workStream.epicCount}
                        </MetricDrilldownButton>
                      </td>
                      <td data-label="Created" className="is-number is-new">
                        <MetricDrilldownButton
                          label={`View ${workStream.newCount} created JIRA cards for ${workStream.name}`}
                          onClick={() => openIssueOverlay("created", workStream.name, [workStream.id], workStream.newCount)}
                        >
                          {workStream.newCount}
                        </MetricDrilldownButton>
                      </td>
                      <td data-label="Completed" className="is-number is-completed">
                        <MetricDrilldownButton
                          label={`View ${workStream.completedCount} completed JIRA cards for ${workStream.name}`}
                          onClick={() => openIssueOverlay("completed", workStream.name, [workStream.id], workStream.completedCount)}
                        >
                          {workStream.completedCount}
                        </MetricDrilldownButton>
                      </td>
                      <td data-label="Net backlog change">
                        <MetricDrilldownButton
                          className={`tb-dashboard-flow-gap ${flowGapTone(workStream.netFlow)}`}
                          label={`View JIRA cards contributing to the ${flowGapLabel(workStream.netFlow)} net backlog change for ${workStream.name}`}
                          onClick={() => openIssueOverlay("flowGap", workStream.name, [workStream.id], workStream.netFlow)}
                        >
                          {flowGapLabel(workStream.netFlow)}
                        </MetricDrilldownButton>
                      </td>
                      <td data-label="Current WIP" className="is-number">
                        <MetricDrilldownButton
                          label={`View ${workStream.currentWipCount} current WIP JIRA cards for ${workStream.name}`}
                          onClick={() => openIssueOverlay("currentWip", workStream.name, [workStream.id], workStream.currentWipCount)}
                        >
                          {workStream.currentWipCount}
                        </MetricDrilldownButton>
                      </td>
                      <td data-label="Share of completions" className="tb-dashboard-delivery-cell">
                        <CompletionShare count={workStream.completedCount} total={workStreamTotals.completedCount} name={workStream.name}
                          onClick={() => openIssueOverlay("completionShare", workStream.name, [workStream.id], workStream.completedCount)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" data-label="Work Streams">All work streams</th>
                  <td data-label="Epics" className="is-number">
                    <MetricDrilldownButton
                      label={`View ${workStreamTotals.epicCount} configured JIRA epics for all work streams`}
                      onClick={() => openIssueOverlay("epics", "All work streams", sortedWorkStreams.map(({ id }) => id), workStreamTotals.epicCount)}
                    >
                      {workStreamTotals.epicCount}
                    </MetricDrilldownButton>
                  </td>
                  <td data-label="Created" className="is-number is-new">
                    <MetricDrilldownButton
                      label={`View ${workStreamTotals.newCount} created JIRA cards for all work streams`}
                      onClick={() => openIssueOverlay("created", "All work streams", sortedWorkStreams.map(({ id }) => id), workStreamTotals.newCount)}
                    >
                      {workStreamTotals.newCount}
                    </MetricDrilldownButton>
                  </td>
                  <td data-label="Completed" className="is-number is-completed">
                    <MetricDrilldownButton
                      label={`View ${workStreamTotals.completedCount} completed JIRA cards for all work streams`}
                      onClick={() => openIssueOverlay("completed", "All work streams", sortedWorkStreams.map(({ id }) => id), workStreamTotals.completedCount)}
                    >
                      {workStreamTotals.completedCount}
                    </MetricDrilldownButton>
                  </td>
                  <td data-label="Net backlog change">
                    <MetricDrilldownButton
                      className={`tb-dashboard-flow-gap ${flowGapTone(workStreamTotals.netFlow)}`}
                      label={`View JIRA cards contributing to the ${flowGapLabel(workStreamTotals.netFlow)} net backlog change for all work streams`}
                      onClick={() => openIssueOverlay("flowGap", "All work streams", sortedWorkStreams.map(({ id }) => id), workStreamTotals.netFlow)}
                    >
                      {flowGapLabel(workStreamTotals.netFlow)}
                    </MetricDrilldownButton>
                  </td>
                  <td data-label="Current WIP" className="is-number">
                    <MetricDrilldownButton
                      label={`View ${workStreamTotals.currentWipCount} current WIP JIRA cards for all work streams`}
                      onClick={() => openIssueOverlay("currentWip", "All work streams", sortedWorkStreams.map(({ id }) => id), workStreamTotals.currentWipCount)}
                    >
                      {workStreamTotals.currentWipCount}
                    </MetricDrilldownButton>
                  </td>
                  <td data-label="Share of completions" className="tb-dashboard-delivery-cell">
                    <CompletionShare count={workStreamTotals.completedCount} total={workStreamTotals.completedCount} name="All work streams"
                      onClick={() => openIssueOverlay("completionShare", "All work streams", sortedWorkStreams.map(({ id }) => id), workStreamTotals.completedCount)} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : null}
      </section>

      {isFlowConfigOpen ? (
        <div className="tb-modal-layer" role="dialog" aria-modal="true" aria-label="Configure Flow Period"
          onKeyDown={(event) => { if (event.key === "Escape") setIsFlowConfigOpen(false); }}>
          <div className="tb-modal-backdrop" onClick={() => setIsFlowConfigOpen(false)} />
          <div className="tb-modal tb-modal-reporting">
            <header className="tb-modal-head">
              <div><h3>Configure Flow Period</h3><p className="tb-muted-note">Set the date range for work stream flow. Choose up to 366 days, ending today or earlier.</p></div>
              <div className="tb-action-row">
                <button ref={flowCancelRef} type="button" className="tb-btn tb-btn-sm" onClick={() => setIsFlowConfigOpen(false)}>Cancel</button>
                <button type="button" className="tb-btn tb-btn-sm tb-btn-primary" onClick={() => {
                  let validationError = validateDateRange(flowDraft);
                  const today = new Date().toLocaleDateString("en-CA");
                  if (!validationError && flowDraft.endDate > today) validationError = "End date cannot be after today.";
                  if (!validationError && (Date.parse(flowDraft.endDate) - Date.parse(flowDraft.startDate)) / 86400000 >= 366) validationError = "Flow period cannot exceed 366 days.";
                  setFlowValidationError(validationError);
                  if (validationError) return;
                  setFlowRange(flowDraft);
                  void setPreference(FLOW_RANGE_KEY, JSON.stringify(flowDraft));
                  setIssueSelection(null);
                  setIsFlowConfigOpen(false);
                }}>Save</button>
              </div>
            </header>
            <div className="tb-exec-period-toolbar"><div className="tb-exec-period-row is-custom">
              <DateRangeFields startDate={flowDraft.startDate} endDate={flowDraft.endDate}
                onStartChange={(startDate) => setFlowDraft((range) => ({ ...range, startDate }))}
                onEndChange={(endDate) => setFlowDraft((range) => ({ ...range, endDate }))} />
            </div></div>
            {flowValidationError ? <p className="tb-error-note" role="alert">{flowValidationError}</p> : null}
          </div>
        </div>
      ) : null}

      {issueSelection ? (
        <TeamDashboardIssueOverlay
          selection={issueSelection}
          flowWeeks={flowWeeks}
          flowRange={flowRange}
          onClose={closeIssueOverlay}
        />
      ) : null}

    </div>
  );
}
