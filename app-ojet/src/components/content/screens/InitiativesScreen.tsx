import { h } from "preact";
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import {
  ConfiguredEpicSummaryResponse,
  InitiativeEpicSummary,
  fetchConfiguredEpicSummary,
  fetchJiraIntegrationStatus,
} from "../../../lib/api";

type RagLabel = "Red" | "Amber" | "Green";

type SummaryRow = InitiativeEpicSummary & {
  groupText: string;
  typeText: string;
  completedInPeriodValue: number;
  deltaPercentValue: number;
  ragLabel: RagLabel;
  ragReason: string;
  successCriteriaTooltip: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function parseIsoDateToUtcDay(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const candidate = value.trim().slice(0, 10);
  const parts = candidate.split("-");
  if (parts.length !== 3) {
    return null;
  }
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }
  return Date.UTC(year, month - 1, day);
}

function toIsoFromUtcDay(utcDay: number): string {
  return new Date(utcDay).toISOString().slice(0, 10);
}

function daysBetweenUtc(startUtcDay: number, endUtcDay: number): number {
  return Math.floor((endUtcDay - startUtcDay) / DAY_MS);
}

function ragFromCompletion(percent: number): RagLabel {
  if (percent < 33) return "Red";
  if (percent < 66) return "Amber";
  return "Green";
}

function evaluateInitiativeRag(entry: InitiativeEpicSummary): { label: RagLabel; reason: string } {
  const completion = Math.max(0, Math.min(100, entry.completionPercent));
  const fallback = ragFromCompletion(completion);
  if (!entry.timelineEnabled) {
    return {
      label: fallback,
      reason: `Timeline not enabled. RAG from completion (${completion.toFixed(1)}%).`,
    };
  }

  const todayUtcDay = parseIsoDateToUtcDay(new Date().toISOString());
  const targetUtcDay = parseIsoDateToUtcDay(entry.targetCompletionDate);
  const startUtcDay = parseIsoDateToUtcDay(entry.timelineStartDate);
  if (todayUtcDay === null || targetUtcDay === null) {
    return {
      label: fallback,
      reason: `Timeline metadata incomplete. Fallback to completion (${completion.toFixed(1)}%).`,
    };
  }

  if (completion >= 100) {
    return {
      label: "Green",
      reason: `Complete (${completion.toFixed(1)}%). Target date ${toIsoFromUtcDay(targetUtcDay)}.`,
    };
  }

  if (todayUtcDay > targetUtcDay) {
    const overdueDays = daysBetweenUtc(targetUtcDay, todayUtcDay);
    return {
      label: "Red",
      reason: `Overdue by ${overdueDays} day${overdueDays === 1 ? "" : "s"} (target ${toIsoFromUtcDay(targetUtcDay)}).`,
    };
  }

  if (startUtcDay !== null && startUtcDay <= targetUtcDay) {
    const totalDays = Math.max(1, daysBetweenUtc(startUtcDay, targetUtcDay) + 1);
    const elapsedDays = Math.min(totalDays, Math.max(0, daysBetweenUtc(startUtcDay, todayUtcDay) + 1));
    const expectedCompletion = (elapsedDays / totalDays) * 100;
    const variance = completion - expectedCompletion;
    if (variance >= -10) {
      return {
        label: "Green",
        reason: `On track: ${completion.toFixed(1)}% vs expected ${expectedCompletion.toFixed(1)}%.`,
      };
    }
    if (variance >= -25) {
      return {
        label: "Amber",
        reason: `Slightly behind: ${completion.toFixed(1)}% vs expected ${expectedCompletion.toFixed(1)}%.`,
      };
    }
    return {
      label: "Red",
      reason: `Behind plan: ${completion.toFixed(1)}% vs expected ${expectedCompletion.toFixed(1)}%.`,
    };
  }

  const daysRemaining = daysBetweenUtc(todayUtcDay, targetUtcDay);
  if (daysRemaining <= 7 && completion < 80) {
    return {
      label: "Red",
      reason: `${daysRemaining} day${daysRemaining === 1 ? "" : "s"} remaining with completion ${completion.toFixed(1)}%.`,
    };
  }
  if (daysRemaining <= 14 && completion < 60) {
    return {
      label: "Amber",
      reason: `${daysRemaining} days remaining with completion ${completion.toFixed(1)}%.`,
    };
  }

  return {
    label: fallback,
    reason: `Timeline start date not set. Fallback to completion (${completion.toFixed(1)}%).`,
  };
}

function ragToneClass(label: RagLabel): string {
  if (label === "Red") return "is-red";
  if (label === "Amber") return "is-amber";
  return "is-green";
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  return `${(Math.round(value * 10) / 10).toFixed(1).replace(/\.0$/, "")}%`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString();
}

function periodLabel(period: ConfiguredEpicSummaryResponse["reportingPeriod"]): string {
  if (!period) {
    return "Reporting period not returned by API.";
  }
  const start = formatDate(period.startDate);
  const end = formatDate(period.endDate);
  return `${start} - ${end} (${period.days} day${period.days === 1 ? "" : "s"}, ${period.timezone})`;
}

export function InitiativesScreen() {
  const [epicSummary, setEpicSummary] = useState<InitiativeEpicSummary[]>([]);
  const [reportingPeriod, setReportingPeriod] = useState<ConfiguredEpicSummaryResponse["reportingPeriod"]>(undefined);
  const [jiraBaseUrl, setJiraBaseUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [ragFilter, setRagFilter] = useState<"all" | RagLabel>("all");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
      const [summaryResult, jiraResult] = await Promise.allSettled([
        fetchConfiguredEpicSummary(100, { timezone }),
        fetchJiraIntegrationStatus(),
      ]);

      if (summaryResult.status === "rejected") {
        throw summaryResult.reason;
      }

      setEpicSummary(summaryResult.value.epics ?? []);
      setReportingPeriod(summaryResult.value.reportingPeriod);

      if (jiraResult.status === "fulfilled") {
        setJiraBaseUrl(
          jiraResult.value.config.baseUrl
            ? jiraResult.value.config.baseUrl.replace(/\/$/, "")
            : null,
        );
      } else {
        setJiraBaseUrl(null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown initiative summary request failure.";
      setError(message);
      setEpicSummary([]);
      setReportingPeriod(undefined);
      setJiraBaseUrl(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => {
      // refresh already updates local state.
    });
  }, [refresh]);

  const rows = useMemo<SummaryRow[]>(() => {
    return epicSummary.map((entry) => {
      const completedInPeriodValue = Math.max(0, entry.completedInPeriod ?? entry.completedLastWeek ?? 0);
      const deltaPercentValue = Math.max(0, entry.deltaPercentInPeriod ?? entry.deltaPercent ?? 0);
      const ragEvaluation = evaluateInitiativeRag(entry);
      return {
        ...entry,
        groupText: entry.groups.length > 0 ? entry.groups.map((group) => group.name).join(", ") : "-",
        typeText: entry.workTypes.length > 0 ? entry.workTypes.map((type) => type.name).join(", ") : "-",
        completedInPeriodValue,
        deltaPercentValue,
        ragLabel: ragEvaluation.label,
        ragReason: ragEvaluation.reason,
        successCriteriaTooltip: entry.successCriteria.length > 0
          ? entry.successCriteria.map((criterion, index) => `${index + 1}. ${criterion}`).join("\n")
          : "No success criteria configured.",
      };
    });
  }, [epicSummary]);

  const groupOptions = useMemo(() => {
    const unique = new Set<string>();
    for (const row of rows) {
      for (const group of row.groups) {
        if (group.name.trim()) {
          unique.add(group.name.trim());
        }
      }
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const typeOptions = useMemo(() => {
    const unique = new Set<string>();
    for (const row of rows) {
      for (const type of row.workTypes) {
        if (type.name.trim()) {
          unique.add(type.name.trim());
        }
      }
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return rows.filter((row) => {
      if (groupFilter !== "all" && !row.groups.some((group) => group.name === groupFilter)) {
        return false;
      }
      if (typeFilter !== "all" && !row.workTypes.some((type) => type.name === typeFilter)) {
        return false;
      }
      if (ragFilter !== "all" && row.ragLabel !== ragFilter) {
        return false;
      }
      if (!query) {
        return true;
      }
      const criteriaText = row.successCriteria.join(" ").toLowerCase();
      return (
        row.epicKey.toLowerCase().includes(query)
        || row.epicName.toLowerCase().includes(query)
        || row.groupText.toLowerCase().includes(query)
        || row.typeText.toLowerCase().includes(query)
        || criteriaText.includes(query)
      );
    });
  }, [groupFilter, ragFilter, rows, searchQuery, typeFilter]);

  const totalConfigured = rows.length;
  const averageCompletion = useMemo(() => {
    if (rows.length === 0) return 0;
    const total = rows.reduce((sum, row) => sum + Math.max(0, Math.min(100, row.completionPercent)), 0);
    return total / rows.length;
  }, [rows]);
  const atRiskCount = useMemo(
    () => rows.filter((row) => row.ragLabel === "Red" || row.ragLabel === "Amber").length,
    [rows],
  );
  const completedInPeriodTotal = useMemo(
    () => rows.reduce((sum, row) => sum + row.completedInPeriodValue, 0),
    [rows],
  );

  return (
    <div class="tb-screen-grid">
      <section class="tb-panel">
        <header class="tb-panel-header">
          <div>
            <h3>Configured Initiative Summary</h3>
            <p>Progress for configured epics sourced from local synced JIRA data.</p>
          </div>
          <button type="button" class="tb-btn tb-btn-primary" onClick={() => refresh()}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </header>

        <div class="tb-metrics-grid tb-four-up">
          <article class="tb-metric-card">
            <h4>Configured Epics</h4>
            <strong class="tb-value">{totalConfigured}</strong>
            <p>Epics with metadata configured in TeamBeacon.</p>
          </article>
          <article class="tb-metric-card">
            <h4>Avg Completion</h4>
            <strong class="tb-value tb-value-good">{formatPercent(averageCompletion)}</strong>
            <p>Average completion percentage across configured epics.</p>
          </article>
          <article class="tb-metric-card">
            <h4>At Risk</h4>
            <strong class={`tb-value ${atRiskCount > 0 ? "tb-value-warn" : "tb-value-good"}`}>{atRiskCount}</strong>
            <p>RAG status currently Red or Amber.</p>
          </article>
          <article class="tb-metric-card">
            <h4>Completed In Period</h4>
            <strong class="tb-value">{completedInPeriodTotal}</strong>
            <p>Total issues completed in current reporting period.</p>
          </article>
        </div>

        <p class="tb-muted-note tb-initiative-period">Reporting period: {periodLabel(reportingPeriod)}</p>
        {error && !loading ? <p class="tb-error-note">Initiative summary: {error}</p> : null}
      </section>

      <section class="tb-panel">
        <header class="tb-panel-header">
          <div>
            <h3>Initiative Progress Matrix</h3>
            <p>Filter by group, type, and RAG to inspect initiative health.</p>
          </div>
          <span class="tb-chip">{filteredRows.length} visible</span>
        </header>

        <div class="tb-initiative-toolbar">
          <label class="tb-initiative-filter">
            <span>Search</span>
            <input
              type="text"
              placeholder="Epic key, name, group, type..."
              value={searchQuery}
              onInput={(event) => setSearchQuery((event.currentTarget as HTMLInputElement).value)}
            />
          </label>

          <label class="tb-initiative-filter">
            <span>Group</span>
            <select
              value={groupFilter}
              onChange={(event) => setGroupFilter((event.currentTarget as HTMLSelectElement).value)}
            >
              <option value="all">All groups</option>
              {groupOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>

          <label class="tb-initiative-filter">
            <span>Work Type</span>
            <select
              value={typeFilter}
              onChange={(event) => setTypeFilter((event.currentTarget as HTMLSelectElement).value)}
            >
              <option value="all">All types</option>
              {typeOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>

          <label class="tb-initiative-filter">
            <span>RAG</span>
            <select
              value={ragFilter}
              onChange={(event) => setRagFilter((event.currentTarget as HTMLSelectElement).value as "all" | RagLabel)}
            >
              <option value="all">All</option>
              <option value="Red">Red</option>
              <option value="Amber">Amber</option>
              <option value="Green">Green</option>
            </select>
          </label>
        </div>

        <div class="tb-initiative-table-wrap">
          <table class="tb-initiative-table">
            <thead>
              <tr>
                <th>Epic</th>
                <th>Group</th>
                <th>Type</th>
                <th>Progress</th>
                <th>Completed</th>
                <th>Delta</th>
                <th>RAG</th>
                <th>Criteria / Insight</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} class="tb-initiative-empty">Loading configured initiatives...</td>
                </tr>
              ) : null}

              {!loading && filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={8} class="tb-initiative-empty">No initiative rows match the active filters.</td>
                </tr>
              ) : null}

              {!loading
                ? filteredRows.map((row) => {
                    const progressPercent = Math.max(0, Math.min(100, row.completionPercent));
                    const epicHref = jiraBaseUrl ? `${jiraBaseUrl}/browse/${encodeURIComponent(row.epicKey)}` : null;
                    return (
                      <tr key={row.epicKey}>
                        <td>
                          <div class="tb-initiative-epic">
                            {epicHref ? (
                              <a href={epicHref} target="_blank" rel="noopener noreferrer" class="tb-initiative-epic-key">
                                {row.epicKey}
                              </a>
                            ) : (
                              <strong class="tb-initiative-epic-key">{row.epicKey}</strong>
                            )}
                            <p class="tb-initiative-epic-name">{row.epicName || "(Untitled epic)"}</p>
                          </div>
                        </td>
                        <td>{row.groupText}</td>
                        <td>{row.typeText}</td>
                        <td>
                          <div class="tb-initiative-progress">
                            <div class="tb-initiative-progress-track">
                              <span style={{ width: `${progressPercent}%` }} />
                            </div>
                            <span>{formatPercent(progressPercent)}</span>
                          </div>
                        </td>
                        <td>
                          <div>
                            <strong>{row.completedCards} / {row.totalCards}</strong>
                            <p class="tb-muted-note">Period: {row.completedInPeriodValue}</p>
                          </div>
                        </td>
                        <td>{formatPercent(row.deltaPercentValue)}</td>
                        <td>
                          <span class={`tb-rag-pill ${ragToneClass(row.ragLabel)}`} title={row.ragReason}>
                            {row.ragLabel}
                          </span>
                        </td>
                        <td>
                          <p class="tb-initiative-criteria" title={row.successCriteriaTooltip}>
                            {row.successCriteria.length > 0
                              ? `${row.successCriteria.length} criteria configured`
                              : "No criteria configured"}
                          </p>
                          <p class="tb-initiative-insight" title={row.ragReason}>
                            {row.insightComment?.trim() || row.ragReason}
                          </p>
                        </td>
                      </tr>
                    );
                  })
                : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
