import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, RefreshCw } from "lucide-react";
import {
  fetchEpicLookupConfig,
  fetchInitiativeDeepDive,
  type EpicLookupItem,
  type InitiativeDeepDiveActivity,
  type InitiativeDeepDiveCard,
  type InitiativeDeepDiveResponse,
} from "../../../lib/api";
import { InitiativeFlowChart } from "./InitiativeFlowChart";

type TableWindowWeeks = 1 | 2 | 4 | 12;

const WINDOW_OPTIONS: TableWindowWeeks[] = [1, 2, 4, 12];

const ACTIVITY_FILTERS: Array<{ id: InitiativeDeepDiveActivity; label: string }> = [
  { id: "all", label: "All activity" },
  { id: "new", label: "New" },
  { id: "in_progress", label: "In progress" },
  { id: "completed", label: "Completed" },
  { id: "current_wip", label: "Current WIP" },
];

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDateRange(startDate: string, endDate: string): string {
  const formatter = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });
  return `${formatter.format(parseLocalDate(startDate))} – ${formatter.format(parseLocalDate(endDate))}`;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

function formatStoryPoints(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function statusTone(statusCategory: string): string {
  const normalized = statusCategory.trim().toLowerCase();
  if (normalized === "done") return "is-completed";
  if (normalized === "in progress") return "is-in-progress";
  return "is-new";
}

function activityLabel(activity: InitiativeDeepDiveCard["activityTypes"][number]): string {
  if (activity === "in_progress") return "In progress";
  if (activity === "completed") return "Completed";
  return "New";
}

function countForActivity(payload: InitiativeDeepDiveResponse, activity: InitiativeDeepDiveActivity): number {
  if (activity === "new") return payload.tableCounts.new;
  if (activity === "in_progress") return payload.tableCounts.inProgress;
  if (activity === "completed") return payload.tableCounts.completed;
  if (activity === "current_wip") return payload.currentWipCount;
  return payload.tableCounts.all;
}

export function InitiativeDeepDiveScreen() {
  const [groups, setGroups] = useState<EpicLookupItem[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [selectedEpicKeys, setSelectedEpicKeys] = useState<string[]>([]);
  const [tableWindowWeeks, setTableWindowWeeks] = useState<TableWindowWeeks>(12);
  const [activity, setActivity] = useState<InitiativeDeepDiveActivity>("all");
  const [payload, setPayload] = useState<InitiativeDeepDiveResponse | null>(null);
  const [isLookupLoading, setIsLookupLoading] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEpicMenuOpen, setIsEpicMenuOpen] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const epicMenuRef = useRef<HTMLDivElement | null>(null);
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);

  useEffect(() => {
    let active = true;
    setIsLookupLoading(true);
    fetchEpicLookupConfig()
      .then((lookup) => {
        if (!active) return;
        setGroups(lookup.groups);
      })
      .catch((requestError: unknown) => {
        if (!active) return;
        setError(requestError instanceof Error ? requestError.message : "Unable to load initiative groups.");
      })
      .finally(() => {
        if (active) setIsLookupLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (selectedGroupId === null) return undefined;
    let activeRequest = true;
    setIsLoading(true);
    setError(null);
    fetchInitiativeDeepDive({
      groupId: selectedGroupId,
      epicKeys: selectedEpicKeys,
      chartWeeks: 12,
      tableWindowWeeks,
      activity,
      timezone,
      limit: 500,
    })
      .then((nextPayload) => {
        if (!activeRequest) return;
        setPayload(nextPayload);
      })
      .catch((requestError: unknown) => {
        if (!activeRequest) return;
        setError(requestError instanceof Error ? requestError.message : "Unable to load initiative deep dive.");
      })
      .finally(() => {
        if (activeRequest) setIsLoading(false);
      });
    return () => {
      activeRequest = false;
    };
  }, [activity, refreshVersion, selectedEpicKeys, selectedGroupId, tableWindowWeeks, timezone]);

  useEffect(() => {
    if (!isEpicMenuOpen) return undefined;
    const handlePointerDown = (event: MouseEvent) => {
      if (!epicMenuRef.current?.contains(event.target as Node)) {
        setIsEpicMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsEpicMenuOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isEpicMenuOpen]);

  const epicOptions = payload?.epicOptions ?? [];
  const allEpicsSelected = selectedEpicKeys.length === 0;
  const epicSelectionLabel = allEpicsSelected
    ? `All epics${epicOptions.length > 0 ? ` (${epicOptions.length})` : ""}`
    : `${selectedEpicKeys.length} of ${epicOptions.length} epics`;

  const handleGroupChange = (value: string) => {
    const nextGroupId = value ? Number.parseInt(value, 10) : null;
    setSelectedGroupId(Number.isFinite(nextGroupId) ? nextGroupId : null);
    setSelectedEpicKeys([]);
    setTableWindowWeeks(12);
    setActivity("all");
    setPayload(null);
    setIsEpicMenuOpen(false);
    setError(null);
  };

  const toggleEpic = (epicKey: string) => {
    setSelectedEpicKeys((current) => {
      const next = current.includes(epicKey)
        ? current.filter((key) => key !== epicKey)
        : [...current, epicKey];
      if (next.length === 0 || next.length === epicOptions.length) return [];
      return next;
    });
  };

  const handleWindowSelection = (weeks: TableWindowWeeks) => {
    setTableWindowWeeks(weeks);
    if (activity === "current_wip") setActivity("all");
  };

  if (isLookupLoading) {
    return <section className="tb-panel tb-deep-dive-state">Loading initiative groups…</section>;
  }

  return (
    <div className="tb-initiative-deep-dive" aria-busy={isLoading}>
      <section className="tb-panel tb-deep-dive-filter-panel" aria-labelledby="initiative-deep-dive-filters">
        <div className="tb-deep-dive-section-heading">
          <div>
            <p className="tb-eyebrow">Scope</p>
            <h3 id="initiative-deep-dive-filters">Choose a group and its epics</h3>
          </div>
          {payload ? <p className="tb-deep-dive-timezone">Weeks start Monday · {payload.timezone}</p> : null}
        </div>

        <div className="tb-deep-dive-filters">
          <label className="tb-field">
            <span>Group</span>
            <select
              value={selectedGroupId ?? ""}
              onChange={(event) => handleGroupChange(event.target.value)}
              aria-label="Initiative group"
            >
              <option value="">Select a group</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>{group.name}</option>
              ))}
            </select>
          </label>

          <div className="tb-field tb-deep-dive-epic-field" ref={epicMenuRef}>
            <span id="initiative-epic-filter-label">Epic</span>
            <button
              type="button"
              className="tb-deep-dive-epic-trigger"
              aria-labelledby="initiative-epic-filter-label"
              aria-haspopup="true"
              aria-expanded={isEpicMenuOpen}
              disabled={selectedGroupId === null || !payload || epicOptions.length === 0}
              onClick={() => setIsEpicMenuOpen((current) => !current)}
            >
              <span>{selectedGroupId === null ? "Select a group first" : epicSelectionLabel}</span>
              <ChevronDown aria-hidden="true" size={16} />
            </button>
            {isEpicMenuOpen ? (
              <div className="tb-deep-dive-epic-menu" role="group" aria-label="Epic options">
                <label className="tb-deep-dive-check-option is-all">
                  <input
                    type="checkbox"
                    checked={allEpicsSelected}
                    onChange={() => setSelectedEpicKeys([])}
                  />
                  <span className="tb-deep-dive-checkbox" aria-hidden="true">
                    {allEpicsSelected ? <Check size={13} /> : null}
                  </span>
                  <span>All epics</span>
                </label>
                <div className="tb-deep-dive-epic-options">
                  {epicOptions.map((epic) => {
                    const checked = selectedEpicKeys.includes(epic.epicKey);
                    return (
                      <label className="tb-deep-dive-check-option" key={epic.epicKey}>
                        <input type="checkbox" checked={checked} onChange={() => toggleEpic(epic.epicKey)} />
                        <span className="tb-deep-dive-checkbox" aria-hidden="true">
                          {checked ? <Check size={13} /> : null}
                        </span>
                        <span>
                          <strong>{epic.epicKey}</strong>
                          <small>{epic.epicName}</small>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {error ? (
        <section className="tb-panel tb-deep-dive-error" role="alert">
          <div>
            <strong>Initiative Deep Dive could not be loaded.</strong>
            <p>{error}</p>
          </div>
          <button type="button" className="tb-btn tb-btn-sm" onClick={() => setRefreshVersion((value) => value + 1)}>
            <RefreshCw size={15} aria-hidden="true" /> Retry
          </button>
        </section>
      ) : null}

      {selectedGroupId === null ? (
        <section className="tb-panel tb-deep-dive-state">
          <h3>Select an initiative group to begin</h3>
          <p>The epic selector, weekly flow, period tiles, and work-item activity will follow that group.</p>
        </section>
      ) : null}

      {payload ? (
        <>
          <section className="tb-panel tb-deep-dive-chart-panel" aria-labelledby="initiative-flow-heading">
            <div className="tb-deep-dive-section-heading">
              <div>
                <p className="tb-eyebrow">12-week trend</p>
                <h3 id="initiative-flow-heading">New and completed cards by week</h3>
                <p>Cards can contribute to both series when they are created and completed in the same week.</p>
              </div>
              <button
                type="button"
                className={`tb-deep-dive-wip-summary${activity === "current_wip" ? " is-active" : ""}`}
                aria-pressed={activity === "current_wip"}
                onClick={() => setActivity("current_wip")}
              >
                <span>Current WIP</span>
                <strong>{formatCount(payload.currentWipCount)}</strong>
                <small>View all active cards</small>
              </button>
            </div>
            <InitiativeFlowChart buckets={payload.weekly} />
          </section>

          <section aria-labelledby="initiative-period-heading">
            <div className="tb-deep-dive-period-heading">
              <div>
                <p className="tb-eyebrow">Table period</p>
                <h3 id="initiative-period-heading">Select a weekly window</h3>
              </div>
              <p>{formatDateRange(payload.selectedPeriod.startDate, payload.selectedPeriod.endDate)}</p>
            </div>
            <div className="tb-deep-dive-period-grid">
              {WINDOW_OPTIONS.map((weeks) => {
                const period = payload.periods.find((entry) => entry.weeks === weeks);
                const selected = tableWindowWeeks === weeks && activity !== "current_wip";
                const netFlow = period?.netFlow ?? 0;
                return (
                  <button
                    key={weeks}
                    type="button"
                    className={`tb-deep-dive-period-card${selected ? " is-active" : ""}`}
                    aria-pressed={selected}
                    onClick={() => handleWindowSelection(weeks)}
                  >
                    <span>Last {weeks} week{weeks === 1 ? "" : "s"}</span>
                    <dl>
                      <div><dt>New</dt><dd>{formatCount(period?.newCount ?? 0)}</dd></div>
                      <div><dt>Completed</dt><dd>{formatCount(period?.completedCount ?? 0)}</dd></div>
                      <div><dt>Net flow</dt><dd className={netFlow > 0 ? "is-positive" : netFlow < 0 ? "is-negative" : ""}>{netFlow > 0 ? "+" : ""}{netFlow}</dd></div>
                    </dl>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="tb-panel tb-deep-dive-table-panel" aria-labelledby="initiative-activity-heading">
            <div className="tb-deep-dive-table-heading">
              <div>
                <p className="tb-eyebrow">Work item activity</p>
                <h3 id="initiative-activity-heading">
                  {activity === "current_wip" ? "Current work in progress" : `Activity in the last ${tableWindowWeeks} week${tableWindowWeeks === 1 ? "" : "s"}`}
                </h3>
              </div>
              <span>{formatCount(payload.count)} card{payload.count === 1 ? "" : "s"}</span>
            </div>

            <div className="tb-deep-dive-activity-filters" role="toolbar" aria-label="Work item activity filter">
              {ACTIVITY_FILTERS.map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  className={activity === filter.id ? "is-active" : ""}
                  aria-pressed={activity === filter.id}
                  aria-label={`${filter.label}, ${formatCount(countForActivity(payload, filter.id))} cards`}
                  onClick={() => setActivity(filter.id)}
                >
                  {filter.label}
                  <span>{formatCount(countForActivity(payload, filter.id))}</span>
                </button>
              ))}
            </div>

            <div className="tb-deep-dive-table-scroll">
              <table className="tb-data-table tb-deep-dive-table">
                <thead>
                  <tr>
                    <th scope="col">Activity</th>
                    <th scope="col">Key</th>
                    <th scope="col">Title</th>
                    <th scope="col">Epic</th>
                    <th scope="col">Current status</th>
                    <th scope="col">Type</th>
                    <th scope="col">Assignee</th>
                    <th scope="col" className="is-numeric">SP</th>
                    <th scope="col">Created</th>
                    <th scope="col">In progress since</th>
                    <th scope="col">Completed</th>
                  </tr>
                </thead>
                <tbody>
                  {payload.cards.map((card) => (
                    <tr key={card.issueKey}>
                      <td>
                        <div className="tb-deep-dive-activity-badges">
                          {card.activityTypes.map((entry) => (
                            <span key={entry} className={`is-${entry.replace("_", "-")}`}>{activityLabel(entry)}</span>
                          ))}
                        </div>
                      </td>
                      <td><strong>{card.issueKey}</strong></td>
                      <td className="tb-deep-dive-title-cell">{card.summary}</td>
                      <td><span title={card.epicName}>{card.epicKey}</span></td>
                      <td><span className={`tb-deep-dive-status ${statusTone(card.statusCategory)}`}>{card.status}</span></td>
                      <td>{card.issueType || "—"}</td>
                      <td>{card.assigneeDisplayName || card.assigneeAccountId || "Unassigned"}</td>
                      <td className="is-numeric">{formatStoryPoints(card.storyPoints)}</td>
                      <td>{formatDateTime(card.createdAt)}</td>
                      <td>{formatDateTime(card.inProgressStartedAt)}</td>
                      <td>{formatDateTime(card.completedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {payload.cards.length === 0 ? (
                <div className="tb-deep-dive-table-empty">
                  No cards match this scope, period, and activity filter.
                </div>
              ) : null}
            </div>
            {payload.truncated ? (
              <p className="tb-deep-dive-truncated">Showing the first {formatCount(payload.limit)} cards, newest activity first.</p>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}
