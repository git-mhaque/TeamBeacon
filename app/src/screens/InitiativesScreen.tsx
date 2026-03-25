import { useCallback, useEffect, useMemo, useState } from "react";
import { MetricCard } from "../components/MetricCard";
import { Panel } from "../components/Panel";
import { StatusPill } from "../components/StatusPill";
import {
  fetchConfiguredEpicSummary,
  fetchJiraIntegrationStatus,
  InitiativeEpicSummary,
} from "../lib/api";

type SummarySortKey = "epicKey" | "group" | "type" | "epicName" | "completion" | "rag";
type SortDirection = "asc" | "desc";

type SummaryRow = InitiativeEpicSummary & {
  groupNames: string[];
  typeNames: string[];
  groupText: string;
  typeText: string;
  ragLabel: "Red" | "Amber" | "Green";
  successCriteriaTooltip: string;
  insightTooltip: string;
};

function ragFromCompletion(percent: number): "Red" | "Amber" | "Green" {
  if (percent < 33) return "Red";
  if (percent < 66) return "Amber";
  return "Green";
}

function ragRank(label: "Red" | "Amber" | "Green"): number {
  if (label === "Red") return 1;
  if (label === "Amber") return 2;
  return 3;
}

export function InitiativesScreen() {
  const [epicSummary, setEpicSummary] = useState<InitiativeEpicSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [jiraBaseUrl, setJiraBaseUrl] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SummarySortKey>("epicKey");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [showGroupColumn, setShowGroupColumn] = useState(true);
  const [showTypeColumn, setShowTypeColumn] = useState(true);
  const [groupFilter, setGroupFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");

  const loadEpicSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryResult, jiraStatusResult] = await Promise.allSettled([
        fetchConfiguredEpicSummary(100),
        fetchJiraIntegrationStatus(),
      ]);
      if (summaryResult.status === "rejected") {
        throw summaryResult.reason;
      }
      setEpicSummary(summaryResult.value);

      if (jiraStatusResult.status === "fulfilled") {
        setJiraBaseUrl(
          jiraStatusResult.value.config.baseUrl
            ? jiraStatusResult.value.config.baseUrl.replace(/\/$/, "")
            : null,
        );
      } else {
        setJiraBaseUrl(null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown initiative summary failure";
      setError(message);
      setEpicSummary([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEpicSummary().catch(() => {
      // loadEpicSummary already sets local error state.
    });
  }, [loadEpicSummary]);

  const configuredEpicSummaryText = useMemo(() => {
    if (loading) return "Loading...";
    if (error) return "Needs attention";
    return `${epicSummary.length} configured epics`;
  }, [epicSummary.length, error, loading]);

  const summaryRows = useMemo(() => {
    const rows: SummaryRow[] = epicSummary.map((entry) => {
      const groupNames = entry.groups.map((group) => group.name);
      const typeNames = entry.workTypes.map((workType) => workType.name);
      const groupText = groupNames.join(", ");
      const typeText = typeNames.join(", ");
      const ragLabel = ragFromCompletion(entry.completionPercent);
      const successCriteriaTooltip = entry.successCriteria.length
        ? entry.successCriteria.map((item, index) => `${index + 1}. ${item}`).join("\n")
        : "No success criteria configured.";
      const insightTooltip = entry.insightComment?.trim() || "Insight pending LLM output.";
      return {
        ...entry,
        groupNames,
        typeNames,
        groupText,
        typeText,
        ragLabel,
        successCriteriaTooltip,
        insightTooltip,
      };
    });
    return rows;
  }, [epicSummary]);

  const groupFilterOptions = useMemo(() => {
    const unique = new Set<string>();
    for (const row of summaryRows) {
      for (const groupName of row.groupNames) {
        if (groupName.trim()) {
          unique.add(groupName.trim());
        }
      }
    }
    return Array.from(unique).sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: "base" }),
    );
  }, [summaryRows]);

  const typeFilterOptions = useMemo(() => {
    const unique = new Set<string>();
    for (const row of summaryRows) {
      for (const typeName of row.typeNames) {
        if (typeName.trim()) {
          unique.add(typeName.trim());
        }
      }
    }
    return Array.from(unique).sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: "base" }),
    );
  }, [summaryRows]);

  const filteredEpicSummary = useMemo(() => {
    return summaryRows.filter((row) => {
      const groupMatch = groupFilter === "all" || row.groupNames.includes(groupFilter);
      const typeMatch = typeFilter === "all" || row.typeNames.includes(typeFilter);
      return groupMatch && typeMatch;
    });
  }, [groupFilter, summaryRows, typeFilter]);

  const sortedEpicSummary = useMemo(() => {
    const sorted = [...filteredEpicSummary].sort((left, right) => {
      if (sortKey === "completion") {
        return left.completionPercent - right.completionPercent;
      }
      if (sortKey === "rag") {
        return ragRank(left.ragLabel) - ragRank(right.ragLabel);
      }
      const leftText =
        sortKey === "epicKey"
          ? left.epicKey
          : sortKey === "group"
            ? left.groupText
            : sortKey === "type"
              ? left.typeText
              : left.epicName;
      const rightText =
        sortKey === "epicKey"
          ? right.epicKey
          : sortKey === "group"
            ? right.groupText
            : sortKey === "type"
              ? right.typeText
              : right.epicName;
      return leftText.localeCompare(rightText, undefined, { sensitivity: "base" });
    });

    if (sortDirection === "desc") {
      sorted.reverse();
    }
    return sorted;
  }, [filteredEpicSummary, sortDirection, sortKey]);

  const handleSort = useCallback(
    (key: SummarySortKey) => {
      if (sortKey === key) {
        setSortDirection((currentDirection) => (currentDirection === "asc" ? "desc" : "asc"));
        return;
      }
      setSortKey(key);
      setSortDirection("asc");
    },
    [sortKey],
  );

  const sortIndicator = useCallback(
    (key: SummarySortKey) => {
      if (sortKey !== key) return "";
      return sortDirection === "asc" ? " ▲" : " ▼";
    },
    [sortDirection, sortKey],
  );

  return (
    <div className="screen-grid">
      <Panel
        title="Initiative Epics Summary"
        subtitle="Configured epics with completion progress derived from synced cards."
        action={
          <StatusPill
            tone={error ? "risk" : loading ? "warn" : "good"}
            text={configuredEpicSummaryText}
          />
        }
      >
        {error ? <p className="sync-history-error">Initiative summary error: {error}</p> : null}
        {loading ? <p className="sync-history-loading">Loading configured epics...</p> : null}

        <div className="initiative-summary-toolbar">
          <div className="initiative-column-toggles">
            <span>Columns:</span>
            <label>
              <input
                type="checkbox"
                checked={showGroupColumn}
                onChange={(event) => setShowGroupColumn(event.target.checked)}
              />
              Group
            </label>
            <label>
              <input
                type="checkbox"
                checked={showTypeColumn}
                onChange={(event) => setShowTypeColumn(event.target.checked)}
              />
              Type
            </label>
          </div>
          <div className="initiative-filter-controls">
            <label>
              <span>Group:</span>
              <select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}>
                <option value="all">All</option>
                {groupFilterOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Type:</span>
              <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
                <option value="all">All</option>
                {typeFilterOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="initiative-summary-table-wrap">
          <table className="sync-history-table">
            <thead>
              <tr>
                <th>
                  <button className="table-sort-btn" type="button" onClick={() => handleSort("epicKey")}>
                    Epic Key{sortIndicator("epicKey")}
                  </button>
                </th>
                {showGroupColumn ? (
                  <th>
                    <button className="table-sort-btn" type="button" onClick={() => handleSort("group")}>
                      Group{sortIndicator("group")}
                    </button>
                  </th>
                ) : null}
                {showTypeColumn ? (
                  <th>
                    <button className="table-sort-btn" type="button" onClick={() => handleSort("type")}>
                      Type{sortIndicator("type")}
                    </button>
                  </th>
                ) : null}
                <th>
                  <button className="table-sort-btn" type="button" onClick={() => handleSort("epicName")}>
                    Epic Name{sortIndicator("epicName")}
                  </button>
                </th>
                <th>
                  <button className="table-sort-btn" type="button" onClick={() => handleSort("completion")}>
                    Completion{sortIndicator("completion")}
                  </button>
                </th>
                <th>
                  <button className="table-sort-btn" type="button" onClick={() => handleSort("rag")}>
                    RAG{sortIndicator("rag")}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedEpicSummary.map((entry) => (
                <tr key={entry.epicKey}>
                  <td>
                    {jiraBaseUrl ? (
                      <a
                        className="external-link"
                        href={`${jiraBaseUrl}/browse/${entry.epicKey}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {entry.epicKey}
                      </a>
                    ) : (
                      entry.epicKey
                    )}
                  </td>
                  {showGroupColumn ? <td className="initiative-group-cell">{entry.groupText || "-"}</td> : null}
                  {showTypeColumn ? <td className="initiative-type-cell">{entry.typeText || "-"}</td> : null}
                  <td className="initiative-name-cell">{entry.epicName || "-"}</td>
                  <td>
                    <div className="initiative-progress-cell" title={entry.successCriteriaTooltip}>
                      <span className="initiative-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={entry.completionPercent}>
                        <span className="initiative-progress-fill" style={{ width: `${Math.max(0, Math.min(100, entry.completionPercent))}%` }} />
                      </span>
                      <span className="initiative-progress-label">
                        {entry.completionPercent.toFixed(1).replace(/\.0$/, "")}% ({entry.completedCards}/{entry.totalCards})
                      </span>
                    </div>
                  </td>
                  <td title={entry.insightTooltip}>
                    <span className={`rag-indicator rag-${entry.ragLabel.toLowerCase()}`}>
                      <span className="rag-dot rag-dot-large" />
                    </span>
                  </td>
                </tr>
              ))}
              {!loading && sortedEpicSummary.length === 0 ? (
                <tr>
                  <td colSpan={4 + (showGroupColumn ? 1 : 0) + (showTypeColumn ? 1 : 0)}>
                    {epicSummary.length === 0
                      ? "No configured epics found yet."
                      : "No epics match the selected filters."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title="Initiative Health"
        subtitle="RAG and velocity indicators based on epic progress and risk signals."
        action={<StatusPill tone="warn" text="Amber: Payments Hardening" />}
      >
        <div className="metrics-grid four-up">
          <MetricCard label="RAG Score" value="72/100" hint="Scope volatility increased this week." tone="warn" />
          <MetricCard label="Epic Completion" value="64%" hint="+9% since previous report." tone="neutral" />
          <MetricCard label="Blockers > 5d" value="3" hint="Threshold is <= 2." tone="risk" />
          <MetricCard label="Cycle Trend" value="-18%" hint="Median cycle time is improving." tone="good" />
        </div>
      </Panel>

      <Panel title="Success Criteria Checklist" subtitle="Configurable criteria per initiative with weighted scoring.">
        <ul className="list">
          <li>
            Delivery trajectory above target velocity <StatusPill tone="good" text="Pass" />
          </li>
          <li>
            Due date confidence {"\u2265"} 80% <StatusPill tone="warn" text="At Risk" />
          </li>
          <li>
            Blocker SLA breaches {"\u2264"} 2 <StatusPill tone="risk" text="Fail" />
          </li>
          <li>
            Scope growth {"\u2264"} 12% <StatusPill tone="risk" text="Fail (18%)" />
          </li>
        </ul>
      </Panel>

      <Panel title="Generated Insight" subtitle="Narrative generated from configured rules and latest JIRA state.">
        <p className="summary">
          Progress is steady and throughput is improving, but open blockers and scope growth are reducing due-date confidence.
          Restrict additional scope intake this sprint and prioritize cross-team dependency clearance.
        </p>
      </Panel>
    </div>
  );
}
