import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, X } from "lucide-react";
import {
  fetchInitiativeDeepDive,
  type InitiativeDeepDiveActivity,
  type InitiativeDeepDiveCard,
  type InitiativeDeepDiveResponse,
  type TeamDashboardFlowWeeks,
} from "../../../lib/api";

export type TeamDashboardIssueMetric =
  | "epics"
  | "created"
  | "completed"
  | "flowGap"
  | "currentWip"
  | "deliveryProgress";

export type TeamDashboardIssueSelection = {
  metric: TeamDashboardIssueMetric;
  scopeName: string;
  groupIds: number[];
  value: number;
  completedCards?: number;
  totalCards?: number;
};

type Props = {
  selection: TeamDashboardIssueSelection;
  flowWeeks: TeamDashboardFlowWeeks;
  onClose: () => void;
};

type IssueRow = {
  issueKey: string;
  issueUrl?: string | null;
  summary: string;
  epicName: string;
  status: string;
  activity: string;
  assignee: string;
  storyPoints?: number | null;
  relevantAt?: string | null;
};

type IssueSortField = keyof Pick<
  IssueRow,
  "issueKey" | "summary" | "epicName" | "status" | "activity" | "assignee" | "storyPoints" | "relevantAt"
>;

type SortDirection = "asc" | "desc";

const ISSUE_COLUMNS: Array<{ field: IssueSortField; label: string; className?: string }> = [
  { field: "issueKey", label: "Key" },
  { field: "summary", label: "Summary" },
  { field: "epicName", label: "Epic" },
  { field: "status", label: "Status" },
  { field: "activity", label: "Activity" },
  { field: "assignee", label: "Assignee" },
  { field: "storyPoints", label: "Story points", className: "is-number" },
  { field: "relevantAt", label: "Relevant date" },
];

function metricTitle(metric: TeamDashboardIssueMetric): string {
  if (metric === "epics") return "Configured epics";
  if (metric === "created") return "Created cards";
  if (metric === "completed") return "Completed cards";
  if (metric === "flowGap") return "Flow gap cards";
  if (metric === "currentWip") return "Current WIP cards";
  return "Delivery progress cards";
}

function metricActivity(metric: TeamDashboardIssueMetric): InitiativeDeepDiveActivity {
  if (metric === "created") return "new";
  if (metric === "completed") return "completed";
  if (metric === "currentWip") return "current_wip";
  if (metric === "deliveryProgress") return "scope";
  return "all";
}

function formatActivity(activity: InitiativeDeepDiveCard["activityTypes"][number]): string {
  if (activity === "new") return "Created";
  if (activity === "in_progress") return "In progress";
  return "Completed";
}

function relevantTimestamp(card: InitiativeDeepDiveCard, metric: TeamDashboardIssueMetric): string | null | undefined {
  if (metric === "created") return card.createdAt;
  if (metric === "completed") return card.completedAt;
  if (metric === "currentWip") return card.inProgressStartedAt;
  return card.latestActivityAt;
}

function cardActivity(card: InitiativeDeepDiveCard, metric: TeamDashboardIssueMetric): string {
  if (metric === "created") return "Created";
  if (metric === "completed") return "Completed";
  if (metric === "currentWip") return "Current WIP";
  if (metric === "deliveryProgress") return "In scope";
  return card.activityTypes.map(formatActivity).join(", ") || "In scope";
}

function buildRows(payload: InitiativeDeepDiveResponse, metric: TeamDashboardIssueMetric): IssueRow[] {
  if (metric === "epics") {
    return payload.epicOptions.map((epic) => ({
      issueKey: epic.epicKey,
      issueUrl: epic.issueUrl,
      summary: epic.epicName,
      epicName: "—",
      status: "—",
      activity: "Configured epic",
      assignee: "—",
      storyPoints: null,
      relevantAt: null,
    }));
  }
  return payload.cards.map((card) => ({
    issueKey: card.issueKey,
    issueUrl: card.issueUrl,
    summary: card.summary,
    epicName: card.epicName || card.epicKey || "—",
    status: card.status || "—",
    activity: cardActivity(card, metric),
    assignee: card.assigneeDisplayName || "Unassigned",
    storyPoints: card.storyPoints,
    relevantAt: relevantTimestamp(card, metric),
  }));
}

function formatDateTime(value?: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function compareOptionalNumbers(left?: number | null, right?: number | null): number {
  const leftMissing = left === null || left === undefined;
  const rightMissing = right === null || right === undefined;
  if (leftMissing && rightMissing) return 0;
  if (leftMissing) return 1;
  if (rightMissing) return -1;
  return left - right;
}

function compareRows(left: IssueRow, right: IssueRow, field: IssueSortField, direction: SortDirection): number {
  let comparison: number;
  if (field === "storyPoints") {
    comparison = compareOptionalNumbers(left.storyPoints, right.storyPoints);
  } else if (field === "relevantAt") {
    const leftTime = left.relevantAt ? Date.parse(left.relevantAt) : null;
    const rightTime = right.relevantAt ? Date.parse(right.relevantAt) : null;
    comparison = compareOptionalNumbers(
      leftTime !== null && Number.isFinite(leftTime) ? leftTime : null,
      rightTime !== null && Number.isFinite(rightTime) ? rightTime : null,
    );
  } else {
    comparison = compareText(left[field], right[field]);
  }
  if (comparison === 0) comparison = compareText(left.issueKey, right.issueKey);
  return direction === "asc" ? comparison : -comparison;
}

function description(
  selection: TeamDashboardIssueSelection,
  payload: InitiativeDeepDiveResponse | null,
  flowWeeks: TeamDashboardFlowWeeks,
): string {
  const period = flowWeeks === 1 ? "the last week" : `the last ${flowWeeks} weeks`;
  if (selection.metric === "flowGap") {
    const sign = selection.value > 0 ? "+" : "";
    const cardCount = payload?.count ?? 0;
    return `${sign}${selection.value} net flow. ${cardCount} unique card${cardCount === 1 ? " was" : "s were"} created or completed in ${period}; a card can contribute to both.`;
  }
  if (selection.metric === "deliveryProgress") {
    return `${selection.completedCards ?? 0} of ${selection.totalCards ?? 0} scoped cards are complete.`;
  }
  if (selection.metric === "epics") {
    return `${payload?.epicOptions.length ?? selection.value} configured JIRA epic${selection.value === 1 ? "" : "s"}.`;
  }
  if (selection.metric === "currentWip") {
    return `${selection.value} card${selection.value === 1 ? " is" : "s are"} currently in progress.`;
  }
  return `${selection.value} card${selection.value === 1 ? "" : "s"} ${selection.metric === "created" ? "created" : "completed"} in ${period}.`;
}

export function TeamDashboardIssueOverlay({ selection, flowWeeks, onClose }: Props) {
  const [payload, setPayload] = useState<InitiativeDeepDiveResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [sortField, setSortField] = useState<IssueSortField>("issueKey");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setPayload(null);
    void fetchInitiativeDeepDive({
      groupIds: selection.groupIds,
      chartWeeks: flowWeeks,
      tableWindowWeeks: flowWeeks,
      activity: metricActivity(selection.metric),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
      limit: 1000,
    }).then((response) => {
      if (active) setPayload(response);
    }).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : "Unable to load JIRA cards.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [flowWeeks, retryCount, selection.groupIds, selection.metric]);

  const rows = useMemo(() => payload ? buildRows(payload, selection.metric) : [], [payload, selection.metric]);
  const sortedRows = useMemo(
    () => [...rows].sort((left, right) => compareRows(left, right, sortField, sortDirection)),
    [rows, sortDirection, sortField],
  );

  const updateSort = (field: IssueSortField) => {
    if (field === sortField) {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }
    setSortField(field);
    setSortDirection(field === "storyPoints" || field === "relevantAt" ? "desc" : "asc");
  };

  const titleId = "team-dashboard-issues-heading";
  return (
    <div className="tb-modal-layer" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="tb-modal-backdrop" onClick={onClose} />
      <div className="tb-modal tb-dashboard-issue-modal">
        <header className="tb-modal-head">
          <div>
            <p className="tb-eyebrow">{selection.scopeName}</p>
            <h3 id={titleId}>{metricTitle(selection.metric)}</h3>
            <p className="tb-dashboard-issue-summary">{description(selection, payload, flowWeeks)}</p>
          </div>
          <button ref={closeButtonRef} type="button" className="tb-icon-btn" aria-label="Close JIRA cards" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        {loading ? <p className="tb-dashboard-issue-state" role="status">Loading JIRA cards…</p> : null}
        {error ? (
          <div className="tb-dashboard-issue-state" role="alert">
            <p>{error}</p>
            <button type="button" className="tb-btn tb-btn-sm" onClick={() => setRetryCount((current) => current + 1)}>Try again</button>
          </div>
        ) : null}
        {!loading && !error && rows.length === 0 ? (
          <p className="tb-dashboard-issue-state">No matching JIRA cards were found.</p>
        ) : null}
        {!loading && !error && rows.length > 0 ? (
          <>
            {selection.metric !== "epics" && payload?.truncated ? (
              <p className="tb-dashboard-issue-limit" role="status">Showing the first {rows.length} of {payload.count} matching cards.</p>
            ) : null}
            <div className="tb-dashboard-issue-table-wrap" role="region" aria-label={`${metricTitle(selection.metric)} table`} tabIndex={0}>
              <table className="tb-data-table tb-dashboard-issue-table">
                <thead>
                  <tr>
                    {ISSUE_COLUMNS.map((column) => {
                      const activeSort = sortField === column.field;
                      return (
                        <th
                          key={column.field}
                          scope="col"
                          className={column.className}
                          aria-sort={activeSort ? sortDirection === "asc" ? "ascending" : "descending" : undefined}
                        >
                          <button
                            type="button"
                            className={`tb-table-sort${activeSort ? " is-active" : ""}`}
                            aria-label={`Sort by ${column.label} (${activeSort && sortDirection === "asc" ? "ascending" : "descending"})`}
                            onClick={() => updateSort(column.field)}
                          >
                            <span>{column.label}</span>
                            <span className="tb-table-sort-indicator" aria-hidden="true">
                              {activeSort ? sortDirection === "asc" ? "↑" : "↓" : "↕"}
                            </span>
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((row) => (
                    <tr key={row.issueKey}>
                      <td className="tb-dashboard-issue-key">
                        {row.issueUrl ? (
                          <a href={row.issueUrl} target="_blank" rel="noreferrer">
                            {row.issueKey}<ExternalLink size={13} aria-hidden="true" />
                          </a>
                        ) : row.issueKey}
                      </td>
                      <td className="tb-dashboard-issue-title">{row.summary || "—"}</td>
                      <td>{row.epicName}</td>
                      <td>{row.status}</td>
                      <td>{row.activity}</td>
                      <td>{row.assignee}</td>
                      <td className="is-number">{row.storyPoints ?? "—"}</td>
                      <td>{formatDateTime(row.relevantAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
