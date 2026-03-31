import { h } from "preact";
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import {
  CurrentSprint,
  CurrentSprintChangeIssue,
  CurrentSprintChangesResponse,
  CurrentSprintWorkIssue,
  CurrentSprintWorkResponse,
  fetchCurrentSprint,
  fetchCurrentSprintChanges,
  fetchCurrentSprintWork,
} from "../../../lib/api";

const EMPTY_WORK: CurrentSprintWorkResponse["work"] = {
  done: [],
  inProgress: [],
  planned: [],
  totals: {
    done: 0,
    inProgress: 0,
    planned: 0,
    total: 0,
    storyPoints: {
      done: 0,
      inProgress: 0,
      planned: 0,
      total: 0,
    },
  },
};

const EMPTY_CHANGES: CurrentSprintChangesResponse["changes"] = {
  addedAfterStart: { count: 0, storyPointsTotal: 0, issueKeys: [], issueCards: [] },
  removedAfterStart: { count: 0, storyPointsTotal: 0, issueKeys: [], issueCards: [] },
  blockedCards: { count: 0, storyPointsTotal: 0, issueKeys: [], issueCards: [] },
};

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  const month = parsed.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const year = String(parsed.getUTCFullYear());
  return `${day}-${month}-${year}`;
}

function formatStoryPoints(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1).replace(/\.0$/, "");
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  return `${value.toFixed(1).replace(/\.0$/, "")}%`;
}

function resolveToneForRemainingDays(days: number | null | undefined): string {
  if (days === null || days === undefined) return "";
  if (days <= 0) return "tb-value-risk";
  if (days <= 2) return "tb-value-warn";
  return "tb-value-good";
}

function resolveStatusTone(statusCategory: string | null | undefined, statusName: string | null | undefined): string {
  const category = (statusCategory ?? "").trim().toLowerCase();
  const status = (statusName ?? "").trim().toLowerCase();
  if (category === "done" || ["done", "closed", "resolved", "complete", "completed"].includes(status)) {
    return "tb-value-good";
  }
  if (["blocked", "failed"].some((marker) => status.includes(marker))) {
    return "tb-value-risk";
  }
  if (category === "in progress" || ["in progress", "in review", "qa required", "testing"].includes(status)) {
    return "tb-value-warn";
  }
  return "";
}

function Ticket({
  issue,
}: {
  issue: CurrentSprintWorkIssue | CurrentSprintChangeIssue;
}) {
  const toneClass = resolveStatusTone(issue.statusCategory, issue.status ?? null);
  return (
    <div class="tb-ticket">
      <div class="tb-ticket-head">
        {issue.issueUrl ? (
          <a href={issue.issueUrl} target="_blank" rel="noopener noreferrer">
            <strong>{issue.issueKey}</strong>
          </a>
        ) : (
          <strong>{issue.issueKey}</strong>
        )}
        {issue.status ? (
          <span class={`tb-inline-status ${toneClass}`}>{issue.status}</span>
        ) : null}
      </div>
      <p class="tb-ticket-summary">{issue.summary}</p>
      <p class="tb-ticket-meta">
        Epic:{" "}
        {issue.epicName && issue.epicUrl ? (
          <a href={issue.epicUrl} target="_blank" rel="noopener noreferrer">
            {issue.epicName}
          </a>
        ) : (
          issue.epicName ?? "-"
        )}
      </p>
      <p class="tb-ticket-meta">Story Points: {formatStoryPoints(issue.storyPoints)}</p>
    </div>
  );
}

function Column({
  title,
  items,
  loading,
  emptyLabel,
}: {
  title: string;
  items: Array<CurrentSprintWorkIssue | CurrentSprintChangeIssue>;
  loading: boolean;
  emptyLabel: string;
}) {
  return (
    <article class="tb-column">
      <h4>{title}</h4>
      {loading ? <p class="tb-muted-note">Loading...</p> : null}
      {!loading && items.length === 0 ? <p class="tb-muted-note">{emptyLabel}</p> : null}
      {!loading ? items.map((item) => <Ticket key={item.issueKey} issue={item} />) : null}
    </article>
  );
}

type StateBreakdownRow = {
  key: "done" | "inProgress" | "planned";
  label: string;
  cards: number;
  storyPoints: number;
  cardsPercent: number;
  storyPointsPercent: number;
  toneClass: string;
};

type WorkMixSlice = {
  label: string;
  count: number;
  percent: number;
  color: string;
};

const WORK_MIX_COLORS = [
  "#1f8f63",
  "#0f5570",
  "#b77700",
  "#c2372e",
  "#6c4ba6",
  "#1c6f9a",
  "#8a4f00",
  "#4a6b2d",
];

function buildWorkMixSlices(issues: CurrentSprintWorkIssue[], field: "group" | "type"): WorkMixSlice[] {
  const counts = new Map<string, number>();
  for (const issue of issues) {
    const raw = field === "group" ? issue.groupName : issue.workTypeName;
    const name = raw?.trim() ? raw.trim() : "Unassigned";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  const total = issues.length;
  return [...counts.entries()]
    .map(([label, count], index) => ({
      label,
      count,
      percent: total > 0 ? (count / total) * 100 : 0,
      color: WORK_MIX_COLORS[index % WORK_MIX_COLORS.length],
    }))
    .sort((left, right) => right.count - left.count);
}

function buildDonutBackground(slices: WorkMixSlice[]): string {
  if (slices.length === 0) {
    return "#e1ebf0";
  }
  let cursor = 0;
  const stops = slices.map((slice) => {
    const start = cursor;
    const end = cursor + slice.percent;
    cursor = end;
    return `${slice.color} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
  });
  return `conic-gradient(${stops.join(", ")})`;
}

export function SprintBoardScreen() {
  const [sprint, setSprint] = useState<CurrentSprint | null>(null);
  const [sprintLoading, setSprintLoading] = useState(true);
  const [sprintError, setSprintError] = useState<string | null>(null);
  const [changes, setChanges] = useState<CurrentSprintChangesResponse["changes"]>(EMPTY_CHANGES);
  const [changesLoading, setChangesLoading] = useState(true);
  const [changesError, setChangesError] = useState<string | null>(null);
  const [work, setWork] = useState<CurrentSprintWorkResponse["work"]>(EMPTY_WORK);
  const [workLoading, setWorkLoading] = useState(true);
  const [workError, setWorkError] = useState<string | null>(null);

  const loadCurrentSprint = useCallback(async () => {
    setSprintLoading(true);
    setSprintError(null);
    try {
      const payload = await fetchCurrentSprint();
      setSprint(payload.sprint);
      if (payload.error) {
        setSprintError(payload.error);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown current sprint request failure.";
      setSprintError(message);
      setSprint(null);
    } finally {
      setSprintLoading(false);
    }
  }, []);

  const loadCurrentSprintChanges = useCallback(async () => {
    setChangesLoading(true);
    setChangesError(null);
    try {
      const payload = await fetchCurrentSprintChanges();
      setChanges(payload.changes);
      if (payload.error) {
        setChangesError(payload.error);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown current sprint changes request failure.";
      setChangesError(message);
      setChanges(EMPTY_CHANGES);
    } finally {
      setChangesLoading(false);
    }
  }, []);

  const loadCurrentSprintWork = useCallback(async () => {
    setWorkLoading(true);
    setWorkError(null);
    try {
      const payload = await fetchCurrentSprintWork();
      setWork(payload.work);
      if (payload.error) {
        setWorkError(payload.error);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown current sprint work request failure.";
      setWorkError(message);
      setWork(EMPTY_WORK);
    } finally {
      setWorkLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    await Promise.all([loadCurrentSprint(), loadCurrentSprintChanges(), loadCurrentSprintWork()]);
  }, [loadCurrentSprint, loadCurrentSprintChanges, loadCurrentSprintWork]);

  useEffect(() => {
    refresh().catch(() => {
      // refresh already updates local state.
    });
  }, [refresh]);

  const remainingDaysToneClass = useMemo(
    () => resolveToneForRemainingDays(sprint?.remainingDays),
    [sprint?.remainingDays],
  );

  const sprintGoals = useMemo(() => {
    const rawGoal = sprint?.goal?.trim();
    if (!rawGoal) return [];
    return rawGoal
      .split(/\r?\n|;\s*/)
      .map((line) => line.replace(/^[-*]\s+/, "").replace(/^\d+[.)]\s+/, "").trim())
      .filter((line) => line.length > 0);
  }, [sprint?.goal]);

  const stateBreakdownRows = useMemo<StateBreakdownRow[]>(() => {
    const cardTotal = work.totals.total;
    const storyPointsTotal = work.totals.storyPoints.total;
    const rows: StateBreakdownRow[] = [
      {
        key: "done",
        label: "Done",
        cards: work.totals.done,
        storyPoints: work.totals.storyPoints.done,
        cardsPercent: cardTotal > 0 ? (work.totals.done / cardTotal) * 100 : 0,
        storyPointsPercent: storyPointsTotal > 0 ? (work.totals.storyPoints.done / storyPointsTotal) * 100 : 0,
        toneClass: "done",
      },
      {
        key: "inProgress",
        label: "In Progress",
        cards: work.totals.inProgress,
        storyPoints: work.totals.storyPoints.inProgress,
        cardsPercent: cardTotal > 0 ? (work.totals.inProgress / cardTotal) * 100 : 0,
        storyPointsPercent: storyPointsTotal > 0 ? (work.totals.storyPoints.inProgress / storyPointsTotal) * 100 : 0,
        toneClass: "in-progress",
      },
      {
        key: "planned",
        label: "Planned",
        cards: work.totals.planned,
        storyPoints: work.totals.storyPoints.planned,
        cardsPercent: cardTotal > 0 ? (work.totals.planned / cardTotal) * 100 : 0,
        storyPointsPercent: storyPointsTotal > 0 ? (work.totals.storyPoints.planned / storyPointsTotal) * 100 : 0,
        toneClass: "planned",
      },
    ];
    return rows;
  }, [
    work.totals.done,
    work.totals.inProgress,
    work.totals.planned,
    work.totals.storyPoints.done,
    work.totals.storyPoints.inProgress,
    work.totals.storyPoints.planned,
    work.totals.storyPoints.total,
    work.totals.total,
  ]);

  const allWorkItems = useMemo(
    () => [...work.done, ...work.inProgress, ...work.planned],
    [work.done, work.inProgress, work.planned],
  );

  const groupMixSlices = useMemo(() => buildWorkMixSlices(allWorkItems, "group"), [allWorkItems]);
  const typeMixSlices = useMemo(() => buildWorkMixSlices(allWorkItems, "type"), [allWorkItems]);

  return (
    <div class="tb-screen-grid">
      <section class="tb-panel">
        <header class="tb-panel-header">
          <div>
            <h3>Sprint Overview</h3>
            <p>Active sprint metadata from local synced JIRA data.</p>
          </div>
          <button type="button" class="tb-btn" onClick={() => refresh()}>
            {sprintLoading || changesLoading || workLoading ? "Loading..." : "Refresh"}
          </button>
        </header>
        <div class="tb-metrics-grid tb-four-up">
          <article class="tb-metric-card">
            <h4>Sprint Name</h4>
            <strong class="tb-value">{sprintLoading ? "Loading..." : sprint?.name ?? "Not Available"}</strong>
            <p>{sprint?.state ? `State: ${sprint.state}` : "No active sprint state available."}</p>
          </article>
          <article class="tb-metric-card">
            <h4>Start Date</h4>
            <strong class="tb-value">{sprintLoading ? "Loading..." : formatDate(sprint?.startDate)}</strong>
            <p>Sprint start date from JIRA sprint metadata.</p>
          </article>
          <article class="tb-metric-card">
            <h4>End Date</h4>
            <strong class="tb-value">{sprintLoading ? "Loading..." : formatDate(sprint?.endDate)}</strong>
            <p>Sprint target end date from JIRA sprint metadata.</p>
          </article>
          <article class="tb-metric-card">
            <h4>Remaining Days</h4>
            <strong class={`tb-value ${remainingDaysToneClass}`}>
              {sprintLoading ? "Loading..." : sprint?.remainingDays ?? "-"}
            </strong>
            <p>{sprint?.endDate ? `Until ${formatDate(sprint.endDate)}` : "End date not available."}</p>
          </article>
        </div>
        <div class="tb-sprint-summary-grid">
          <article class="tb-sprint-summary-card">
            <h4>Sprint Goals</h4>
            {sprintLoading ? <p class="tb-muted-note">Loading sprint goals...</p> : null}
            {!sprintLoading && sprintGoals.length === 0 ? (
              <p class="tb-muted-note">No sprint goals available in active sprint metadata.</p>
            ) : null}
            {!sprintLoading && sprintGoals.length === 1 ? <p class="tb-sprint-goal-text">{sprintGoals[0]}</p> : null}
            {!sprintLoading && sprintGoals.length > 1 ? (
              <ul class="tb-sprint-goal-list">
                {sprintGoals.map((goal) => (
                  <li key={goal}>{goal}</li>
                ))}
              </ul>
            ) : null}
          </article>

          <article class="tb-sprint-summary-card">
            <h4>State Breakdown</h4>
            <p class="tb-muted-note">In Progress, Planned, and Done split by card count and story points.</p>

            <div class="tb-sprint-stack-group">
              <div class="tb-sprint-stack-row">
                <div class="tb-sprint-stack-label">
                  <span>Cards</span>
                  <strong>{workLoading ? "-" : work.totals.total}</strong>
                </div>
                <div
                  class="tb-sprint-stack-bar"
                  role="img"
                  aria-label={`Card breakdown: ${stateBreakdownRows
                    .map((row) => `${row.label} ${row.cards}`)
                    .join(", ")}`}
                >
                  {stateBreakdownRows.map((row) => (
                    <span
                      key={`cards-${row.key}`}
                      class={`tb-sprint-stack-segment tb-sprint-segment-${row.toneClass}`}
                      style={{ width: `${row.cardsPercent}%` }}
                      title={`${row.label}: ${row.cards} cards (${formatPercent(row.cardsPercent)})`}
                    />
                  ))}
                </div>
              </div>

              <div class="tb-sprint-stack-row">
                <div class="tb-sprint-stack-label">
                  <span>Story Points</span>
                  <strong>{workLoading ? "-" : formatStoryPoints(work.totals.storyPoints.total)}</strong>
                </div>
                <div
                  class="tb-sprint-stack-bar"
                  role="img"
                  aria-label={`Story point breakdown: ${stateBreakdownRows
                    .map((row) => `${row.label} ${formatStoryPoints(row.storyPoints)} SP`)
                    .join(", ")}`}
                >
                  {stateBreakdownRows.map((row) => (
                    <span
                      key={`sp-${row.key}`}
                      class={`tb-sprint-stack-segment tb-sprint-segment-${row.toneClass}`}
                      style={{ width: `${row.storyPointsPercent}%` }}
                      title={`${row.label}: ${formatStoryPoints(row.storyPoints)} SP (${formatPercent(row.storyPointsPercent)})`}
                    />
                  ))}
                </div>
              </div>
            </div>

            <ul class="tb-sprint-breakdown-list">
              {stateBreakdownRows.map((row) => (
                <li key={`legend-${row.key}`}>
                  <span class={`tb-sprint-swatch tb-sprint-segment-${row.toneClass}`} aria-hidden="true" />
                  <strong>{row.label}</strong>
                  <span>{row.cards} cards</span>
                  <span>{formatStoryPoints(row.storyPoints)} SP</span>
                </li>
              ))}
            </ul>
          </article>
        </div>
        <div class="tb-sprint-mix-grid">
          <article class="tb-sprint-summary-card">
            <h4>Work Mix by Group</h4>
            {workLoading ? <p class="tb-muted-note">Loading work mix...</p> : null}
            {!workLoading ? (
              <div class="tb-exec-donut-wrap">
                <div
                  class="tb-exec-donut"
                  style={{ background: buildDonutBackground(groupMixSlices) }}
                  role="img"
                  aria-label="Work mix by group chart"
                >
                  {groupMixSlices.length === 0 ? <span>No data</span> : null}
                </div>
                <ul class="tb-exec-donut-legend">
                  {groupMixSlices.map((slice) => (
                    <li key={`group-${slice.label}`}>
                      <span class="tb-exec-donut-swatch" style={{ backgroundColor: slice.color }} aria-hidden="true" />
                      <span>{slice.label}</span>
                      <span>{slice.count} ({formatPercent(slice.percent)})</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </article>

          <article class="tb-sprint-summary-card">
            <h4>Work Mix by Type</h4>
            {workLoading ? <p class="tb-muted-note">Loading work mix...</p> : null}
            {!workLoading ? (
              <div class="tb-exec-donut-wrap">
                <div
                  class="tb-exec-donut"
                  style={{ background: buildDonutBackground(typeMixSlices) }}
                  role="img"
                  aria-label="Work mix by type chart"
                >
                  {typeMixSlices.length === 0 ? <span>No data</span> : null}
                </div>
                <ul class="tb-exec-donut-legend">
                  {typeMixSlices.map((slice) => (
                    <li key={`type-${slice.label}`}>
                      <span class="tb-exec-donut-swatch" style={{ backgroundColor: slice.color }} aria-hidden="true" />
                      <span>{slice.label}</span>
                      <span>{slice.count} ({formatPercent(slice.percent)})</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </article>
        </div>
        {sprintError && !sprintLoading ? <p class="tb-error-note">Current sprint status: {sprintError}</p> : null}
      </section>

      <section class="tb-panel">
        <header class="tb-panel-header">
          <div>
            <h3>Sprint Scope Changes & Blockers</h3>
            <p>Scope volatility and blocked cards observed after sprint start.</p>
          </div>
        </header>
        <div class="tb-kanban">
          <Column
            title={`Added (${changes.addedAfterStart.count} | ${formatStoryPoints(changes.addedAfterStart.storyPointsTotal)} SP)`}
            items={changes.addedAfterStart.issueCards}
            loading={changesLoading}
            emptyLabel="No cards added after sprint start."
          />
          <Column
            title={`Removed (${changes.removedAfterStart.count} | ${formatStoryPoints(changes.removedAfterStart.storyPointsTotal)} SP)`}
            items={changes.removedAfterStart.issueCards}
            loading={changesLoading}
            emptyLabel="No cards removed after sprint start."
          />
          <Column
            title={`Blocked (${changes.blockedCards.count} | ${formatStoryPoints(changes.blockedCards.storyPointsTotal)} SP)`}
            items={changes.blockedCards.issueCards}
            loading={changesLoading}
            emptyLabel="No blocked cards in current sprint."
          />
        </div>
        {changesError && !changesLoading ? <p class="tb-error-note">Current sprint changes: {changesError}</p> : null}
      </section>

      <section class="tb-panel">
        <header class="tb-panel-header">
          <div>
            <h3>Current Sprint Work</h3>
            <p>Completed, in-progress, and planned issues from the active sprint.</p>
          </div>
        </header>
        <div class="tb-kanban">
          <Column
            title={`Done (${work.totals.done} | ${formatStoryPoints(work.totals.storyPoints.done)} SP)`}
            items={work.done}
            loading={workLoading}
            emptyLabel="No items in Done."
          />
          <Column
            title={`In Progress (${work.totals.inProgress} | ${formatStoryPoints(work.totals.storyPoints.inProgress)} SP)`}
            items={work.inProgress}
            loading={workLoading}
            emptyLabel="No items in In Progress."
          />
          <Column
            title={`Planned (${work.totals.planned} | ${formatStoryPoints(work.totals.storyPoints.planned)} SP)`}
            items={work.planned}
            loading={workLoading}
            emptyLabel="No items in Planned."
          />
        </div>
        {workError && !workLoading ? <p class="tb-error-note">Current sprint work: {workError}</p> : null}
      </section>
    </div>
  );
}
