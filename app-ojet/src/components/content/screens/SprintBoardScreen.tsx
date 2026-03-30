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
  return parsed.toLocaleDateString();
}

function formatStoryPoints(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1).replace(/\.0$/, "");
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

  return (
    <div class="tb-screen-grid">
      <section class="tb-panel">
        <header class="tb-panel-header">
          <div>
            <h3>Current Sprint</h3>
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

