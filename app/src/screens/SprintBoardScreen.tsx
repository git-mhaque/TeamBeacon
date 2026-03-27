import { useCallback, useEffect, useMemo, useState } from "react";
import { MetricCard } from "../components/MetricCard";
import { Panel } from "../components/Panel";
import { StatusPill } from "../components/StatusPill";
import {
  CurrentSprintChangeIssue,
  CurrentSprint,
  CurrentSprintChangesResponse,
  CurrentSprintWorkIssue,
  CurrentSprintWorkResponse,
  fetchCurrentSprintChanges,
  fetchCurrentSprint,
  fetchCurrentSprintWork
} from "../lib/api";

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
      total: 0
    }
  }
};

const EMPTY_CHANGES: CurrentSprintChangesResponse["changes"] = {
  addedAfterStart: { count: 0, storyPointsTotal: 0, issueKeys: [], issueCards: [] },
  removedAfterStart: { count: 0, storyPointsTotal: 0, issueKeys: [], issueCards: [] },
  blockedCards: { count: 0, storyPointsTotal: 0, issueKeys: [], issueCards: [] }
};

type Tone = "neutral" | "good" | "warn" | "risk";
type StatusInfo = {
  status?: string | null;
  statusCategory?: string | null;
};

function formatStoryPoints(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1).replace(/\.0$/, "");
}

function formatEpicName(issue: CurrentSprintWorkIssue): string {
  if (issue.epicName) return issue.epicName;
  return "-";
}

function formatEpicText(epicName: string | null | undefined): string {
  if (epicName) return epicName;
  return "-";
}

function resolveStatusTone(issue: StatusInfo): Tone {
  const category = issue.statusCategory?.toLowerCase().trim() ?? "";
  const status = issue.status?.toLowerCase().trim() ?? "";
  if (category === "done" || ["done", "closed", "resolved", "complete", "completed"].includes(status)) {
    return "good";
  }
  if (category === "in progress" || ["in progress", "in review", "qa required", "testing"].includes(status)) {
    return "warn";
  }
  if (["blocked", "failed"].some((marker) => status.includes(marker))) {
    return "risk";
  }
  return "neutral";
}

function WorkColumn({
  title,
  items,
  loading
}: {
  title: string;
  items: CurrentSprintWorkIssue[];
  loading: boolean;
}) {
  return (
    <article className="work-column">
      <h4>{title}</h4>
      {loading ? <p className="ticket">Loading...</p> : null}
      {!loading && items.length === 0 ? <p className="ticket">No items.</p> : null}
      {!loading
        ? items.map((item) => (
            <div key={item.issueKey} className="ticket">
              <div className="ticket-top-row">
                <div className="ticket-key-row">
                  {item.issueUrl ? (
                    <a className="external-link ticket-link" href={item.issueUrl} target="_blank" rel="noopener noreferrer">
                      <strong>{item.issueKey}</strong>
                    </a>
                  ) : (
                    <strong>{item.issueKey}</strong>
                  )}
                </div>
                <div className="ticket-status-corner">
                  <StatusPill tone={resolveStatusTone(item)} text={item.status} />
                </div>
              </div>
              <div className="ticket-info-row">{item.summary}</div>
              <small>
                Epic:{" "}
                {item.epicName && item.epicUrl ? (
                  <a className="external-link" href={item.epicUrl} target="_blank" rel="noopener noreferrer">
                    {formatEpicName(item)}
                  </a>
                ) : (
                  formatEpicName(item)
                )}
              </small>
              <br />
              <small>Story Points: {formatStoryPoints(item.storyPoints)}</small>
            </div>
          ))
        : null}
    </article>
  );
}

function SprintChangeColumn({
  title,
  items,
  loading,
  emptyLabel
}: {
  title: string;
  items: CurrentSprintChangeIssue[];
  loading: boolean;
  emptyLabel: string;
}) {
  return (
    <article className="work-column">
      <h4>{title}</h4>
      {loading ? <p className="ticket">Loading...</p> : null}
      {!loading && items.length === 0 ? <p className="ticket">{emptyLabel}</p> : null}
      {!loading
        ? items.map((item) => (
            <div key={item.issueKey} className="ticket">
              <div className="ticket-top-row">
                <div className="ticket-key-row">
                  {item.issueUrl ? (
                    <a className="external-link ticket-link" href={item.issueUrl} target="_blank" rel="noopener noreferrer">
                      <strong>{item.issueKey}</strong>
                    </a>
                  ) : (
                    <strong>{item.issueKey}</strong>
                  )}
                </div>
                {item.status ? (
                  <div className="ticket-status-corner">
                    <StatusPill tone={resolveStatusTone(item)} text={item.status} />
                  </div>
                ) : null}
              </div>
              <div className="ticket-info-row">{item.summary}</div>
              <small>
                Epic:{" "}
                {item.epicName && item.epicUrl ? (
                  <a className="external-link" href={item.epicUrl} target="_blank" rel="noopener noreferrer">
                    {formatEpicText(item.epicName)}
                  </a>
                ) : (
                  formatEpicText(item.epicName)
                )}
              </small>
              <br />
              <small>Story Points: {formatStoryPoints(item.storyPoints)}</small>
            </div>
          ))
        : null}
    </article>
  );
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString();
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

  const refreshSprintPanels = useCallback(async () => {
    await Promise.all([loadCurrentSprint(), loadCurrentSprintChanges(), loadCurrentSprintWork()]);
  }, [loadCurrentSprint, loadCurrentSprintChanges, loadCurrentSprintWork]);

  useEffect(() => {
    refreshSprintPanels().catch(() => {
      // refreshSprintPanels already updates local state.
    });
  }, [refreshSprintPanels]);

  const remainingDays = sprint?.remainingDays;
  const remainingDaysTone = useMemo(() => {
    if (remainingDays === undefined || remainingDays === null) return "neutral";
    if (remainingDays <= 0) return "risk";
    if (remainingDays <= 2) return "warn";
    return "good";
  }, [remainingDays]);

  return (
    <div className="screen-grid">
      <Panel
        title="Current Sprint"
        subtitle="Active sprint metadata from local synced JIRA data."
        action={
          <button className="mini-sync-btn" onClick={refreshSprintPanels} type="button">
            {sprintLoading || changesLoading || workLoading ? "Loading..." : "Refresh"}
          </button>
        }
      >
        <div className="metrics-grid four-up">
          <MetricCard
            label="Sprint Name"
            value={sprintLoading ? "Loading..." : sprint?.name ?? "Not Available"}
            hint={sprint?.state ? `State: ${sprint.state}` : "No active sprint state available."}
            tone={sprint ? "good" : "warn"}
          />
          <MetricCard
            label="Start Date"
            value={sprintLoading ? "Loading..." : formatDate(sprint?.startDate)}
            hint="Sprint start date from JIRA sprint metadata."
          />
          <MetricCard
            label="End Date"
            value={sprintLoading ? "Loading..." : formatDate(sprint?.endDate)}
            hint="Sprint target end date from JIRA sprint metadata."
          />
          <MetricCard
            label="Remaining Days"
            value={sprintLoading ? "Loading..." : remainingDays ?? "-"}
            hint={sprint?.endDate ? `Until ${formatDate(sprint.endDate)}` : "End date not available."}
            tone={remainingDaysTone}
          />
        </div>
        {sprintError && !sprintLoading ? <p className="sync-history-error">Current sprint status: {sprintError}</p> : null}
      </Panel>

      <Panel
        title="Sprint Scope Changes & Blockers"
        subtitle="Scope volatility and blocked cards observed after sprint start."
      >
        <div className="kanban-grid sprint-changes-grid">
          <SprintChangeColumn
            title={`Added (${changes.addedAfterStart.count} | ${formatStoryPoints(changes.addedAfterStart.storyPointsTotal)} SP)`}
            items={changes.addedAfterStart.issueCards}
            loading={changesLoading}
            emptyLabel="No cards added after sprint start."
          />
          <SprintChangeColumn
            title={`Removed (${changes.removedAfterStart.count} | ${formatStoryPoints(changes.removedAfterStart.storyPointsTotal)} SP)`}
            items={changes.removedAfterStart.issueCards}
            loading={changesLoading}
            emptyLabel="No cards removed after sprint start."
          />
          <SprintChangeColumn
            title={`Blocked (${changes.blockedCards.count} | ${formatStoryPoints(changes.blockedCards.storyPointsTotal)} SP)`}
            items={changes.blockedCards.issueCards}
            loading={changesLoading}
            emptyLabel="No blocked cards in current sprint."
          />
        </div>
        {changesError && !changesLoading ? <p className="sync-history-error">Current sprint changes: {changesError}</p> : null}
      </Panel>

      <Panel
        title="Current Sprint Work"
        subtitle="Completed, in-progress, and planned issues from the active sprint."
      >
        {workError && !workLoading ? <p className="sync-history-error">Current sprint work: {workError}</p> : null}
        <div className="kanban-grid">
          <WorkColumn
            title={`Done (${work.totals.done} | ${formatStoryPoints(work.totals.storyPoints.done)} SP)`}
            items={work.done}
            loading={workLoading}
          />
          <WorkColumn
            title={`In Progress (${work.totals.inProgress} | ${formatStoryPoints(work.totals.storyPoints.inProgress)} SP)`}
            items={work.inProgress}
            loading={workLoading}
          />
          <WorkColumn
            title={`Planned (${work.totals.planned} | ${formatStoryPoints(work.totals.storyPoints.planned)} SP)`}
            items={work.planned}
            loading={workLoading}
          />
        </div>
      </Panel>
    </div>
  );
}
