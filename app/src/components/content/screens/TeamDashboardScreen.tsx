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

  const updateFlowWeeks = (value: TeamDashboardFlowWeeks) => {
    setFlowWeeks(value);
    void setPreference(TEAM_DASHBOARD_FLOW_WEEKS_KEY, String(value));
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
            <p className="tb-muted-note">Created and completed cards use {flowRangeLabel(flowWeeks).toLowerCase()}; progress covers all scoped cards.</p>
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

        <div className="tb-dashboard-work-stream-grid">
          {payload?.workStreams.map((workStream) => {
            const netTone = workStream.netFlow > 0 ? "is-warning" : workStream.netFlow < 0 ? "is-good" : "is-neutral";
            return (
              <article key={workStream.id} className="tb-dashboard-work-stream-card">
                <header>
                  <div>
                    <button type="button" onClick={() => onOpenWorkStream?.(workStream.id)}>{workStream.name}</button>
                    <span>{workStream.epicCount} {workStream.epicCount === 1 ? "epic" : "epics"}</span>
                  </div>
                  <span className={`tb-dashboard-net ${netTone}`}>{workStream.netFlow > 0 ? "+" : ""}{workStream.netFlow} net</span>
                </header>
                <div className="tb-dashboard-flow-values">
                  <div className="is-new"><span>Created</span><strong>{workStream.newCount}</strong></div>
                  <div className="is-completed"><span>Completed</span><strong>{workStream.completedCount}</strong></div>
                  <div><span>Current WIP</span><strong>{workStream.currentWipCount}</strong></div>
                </div>
                <div className="tb-dashboard-progress-copy">
                  <span>Delivery progress</span>
                  <strong>{workStream.completionPercent.toFixed(0)}%</strong>
                </div>
                <div
                  className="tb-dashboard-progress"
                  role="progressbar"
                  aria-label={`${workStream.name} delivery progress`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.max(0, Math.min(100, workStream.completionPercent))}
                >
                  <span style={{ width: `${Math.max(0, Math.min(100, workStream.completionPercent))}%` }} />
                </div>
                <p>{workStream.totalCompletedCards} of {workStream.totalCards} scoped cards completed</p>
                {workStream.error ? <small className="tb-error-note">Flow data unavailable.</small> : null}
              </article>
            );
          })}
        </div>
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
