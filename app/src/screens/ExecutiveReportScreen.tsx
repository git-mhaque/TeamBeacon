import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MetricCard } from "../components/MetricCard";
import { Panel } from "../components/Panel";
import { StatusPill } from "../components/StatusPill";
import {
  fetchConfiguredEpicSummary,
  fetchJiraIntegrationStatus,
  InitiativeEpicSummary,
} from "../lib/api";

type RagLabel = "Red" | "Amber" | "Green";

type ExecutiveRow = InitiativeEpicSummary & {
  groupText: string;
  typeText: string;
  rag: RagLabel;
  ragTooltip: string;
  completedLastWeekValue: number;
  deltaPercentValue: number;
};

const INITIATIVE_SECTION_SELECTION_KEY = "teambeacon.executive.initiative.visibleEpicKeys";

function ragFromCompletion(percent: number): RagLabel {
  if (percent < 33) return "Red";
  if (percent < 66) return "Amber";
  return "Green";
}

type RagEvaluation = {
  label: RagLabel;
  reason: string;
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

function evaluateInitiativeRag(entry: InitiativeEpicSummary): RagEvaluation {
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
      reason: `Overdue by ${overdueDays} day${overdueDays === 1 ? "" : "s"} (target ${toIsoFromUtcDay(targetUtcDay)}). Completion ${completion.toFixed(1)}%.`,
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
        reason: `On track: ${completion.toFixed(1)}% vs expected ${expectedCompletion.toFixed(1)}% by now (target ${toIsoFromUtcDay(targetUtcDay)}).`,
      };
    }
    if (variance >= -25) {
      return {
        label: "Amber",
        reason: `Slightly behind: ${completion.toFixed(1)}% vs expected ${expectedCompletion.toFixed(1)}% by now (target ${toIsoFromUtcDay(targetUtcDay)}).`,
      };
    }
    return {
      label: "Red",
      reason: `Behind plan: ${completion.toFixed(1)}% vs expected ${expectedCompletion.toFixed(1)}% by now (target ${toIsoFromUtcDay(targetUtcDay)}).`,
    };
  }

  const daysRemaining = daysBetweenUtc(todayUtcDay, targetUtcDay);
  if (daysRemaining <= 7 && completion < 80) {
    return {
      label: "Red",
      reason: `${daysRemaining} day${daysRemaining === 1 ? "" : "s"} to target (${toIsoFromUtcDay(targetUtcDay)}) with completion ${completion.toFixed(1)}%.`,
    };
  }
  if (daysRemaining <= 14 && completion < 60) {
    return {
      label: "Amber",
      reason: `${daysRemaining} days to target (${toIsoFromUtcDay(targetUtcDay)}); completion ${completion.toFixed(1)}% is at risk.`,
    };
  }
  return {
    label: fallback,
    reason: `Timeline start date not set. Fallback to completion (${completion.toFixed(1)}%) with target ${toIsoFromUtcDay(targetUtcDay)}.`,
  };
}

function formatPercent(value: number): string {
  return `${value.toFixed(1).replace(/\.0$/, "")}%`;
}

export function ExecutiveReportScreen() {
  const [rows, setRows] = useState<ExecutiveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [jiraBaseUrl, setJiraBaseUrl] = useState<string | null>(null);
  const [selectedInitiativeEpicKeys, setSelectedInitiativeEpicKeys] = useState<string[]>([]);
  const [initiativeConfigOpen, setInitiativeConfigOpen] = useState(false);
  const [initiativeConfigDraftKeys, setInitiativeConfigDraftKeys] = useState<string[]>([]);
  const [initiativeConfigQuery, setInitiativeConfigQuery] = useState("");
  const [initiativeConfigDraggingKey, setInitiativeConfigDraggingKey] = useState<string | null>(null);
  const hasInitializedInitiativeSelection = useRef(false);

  const persistInitiativeSelection = useCallback((keys: string[]) => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(INITIATIVE_SECTION_SELECTION_KEY, JSON.stringify(keys));
    } catch {
      // Persisting local selection is best-effort only.
    }
  }, []);

  const loadExecutiveData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryResult, jiraStatusResult] = await Promise.allSettled([
        fetchConfiguredEpicSummary(200),
        fetchJiraIntegrationStatus(),
      ]);

      if (summaryResult.status === "rejected") {
        throw summaryResult.reason;
      }

      const mappedRows: ExecutiveRow[] = summaryResult.value.map((entry) => {
        const groupText = entry.groups.map((group) => group.name).join(", ");
        const typeText = entry.workTypes.map((type) => type.name).join(", ");
        const completedLastWeekValue = Math.max(0, entry.completedLastWeek ?? 0);
        const deltaCandidate =
          typeof entry.deltaPercent === "number"
            ? entry.deltaPercent
            : entry.totalCards > 0
              ? (completedLastWeekValue / entry.totalCards) * 100
              : 0;
        const deltaPercentValue = Math.max(0, Math.round(deltaCandidate * 10) / 10);
        const ragEvaluation = evaluateInitiativeRag(entry);
        const insightText = entry.insightComment?.trim();
        const ragTooltip = insightText
          ? `${ragEvaluation.reason}\n\nInsight: ${insightText}`
          : ragEvaluation.reason;
        return {
          ...entry,
          groupText: groupText || "Unassigned",
          typeText: typeText || "Unassigned",
          rag: ragEvaluation.label,
          ragTooltip,
          completedLastWeekValue,
          deltaPercentValue,
        };
      });

      mappedRows.sort((left, right) => {
        if (right.completedLastWeekValue !== left.completedLastWeekValue) {
          return right.completedLastWeekValue - left.completedLastWeekValue;
        }
        if (right.deltaPercentValue !== left.deltaPercentValue) {
          return right.deltaPercentValue - left.deltaPercentValue;
        }
        return left.epicName.localeCompare(right.epicName, undefined, { sensitivity: "base" });
      });

      setRows(mappedRows);
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
      const message = err instanceof Error ? err.message : "Unknown executive report load failure.";
      setError(message);
      setRows([]);
      setJiraBaseUrl(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadExecutiveData().catch(() => {
      // loadExecutiveData already updates local state.
    });
  }, [loadExecutiveData]);

  const metrics = useMemo(() => {
    const totalEpics = rows.length;
    const totalCards = rows.reduce((sum, row) => sum + row.totalCards, 0);
    const totalCompleted = rows.reduce((sum, row) => sum + row.completedCards, 0);
    const totalCompletedLastWeek = rows.reduce((sum, row) => sum + row.completedLastWeekValue, 0);
    const redCount = rows.filter((row) => row.rag === "Red").length;
    const amberCount = rows.filter((row) => row.rag === "Amber").length;
    const greenCount = rows.filter((row) => row.rag === "Green").length;
    const avgCompletion = totalCards > 0 ? (totalCompleted / totalCards) * 100 : 0;
    const avgDelta = totalCards > 0 ? (totalCompletedLastWeek / totalCards) * 100 : 0;
    return {
      totalEpics,
      totalCards,
      totalCompletedLastWeek,
      redCount,
      amberCount,
      greenCount,
      avgCompletion,
      avgDelta,
    };
  }, [rows]);

  const groupProgress = useMemo(() => {
    const map = new Map<string, { cards: number; completed: number; completedLastWeek: number }>();
    for (const row of rows) {
      const names = row.groups.length ? row.groups.map((group) => group.name) : ["Unassigned"];
      for (const name of names) {
        const current = map.get(name) ?? { cards: 0, completed: 0, completedLastWeek: 0 };
        current.cards += row.totalCards;
        current.completed += row.completedCards;
        current.completedLastWeek += row.completedLastWeekValue;
        map.set(name, current);
      }
    }
    return [...map.entries()]
      .map(([name, value]) => ({
        name,
        cards: value.cards,
        completedLastWeek: value.completedLastWeek,
        completionPercent: value.cards > 0 ? (value.completed / value.cards) * 100 : 0,
      }))
      .sort((left, right) => right.completedLastWeek - left.completedLastWeek);
  }, [rows]);

  const typeProgress = useMemo(() => {
    const map = new Map<string, { cards: number; completed: number; completedLastWeek: number }>();
    for (const row of rows) {
      const names = row.workTypes.length ? row.workTypes.map((type) => type.name) : ["Unassigned"];
      for (const name of names) {
        const current = map.get(name) ?? { cards: 0, completed: 0, completedLastWeek: 0 };
        current.cards += row.totalCards;
        current.completed += row.completedCards;
        current.completedLastWeek += row.completedLastWeekValue;
        map.set(name, current);
      }
    }
    return [...map.entries()]
      .map(([name, value]) => ({
        name,
        cards: value.cards,
        completedLastWeek: value.completedLastWeek,
        completionPercent: value.cards > 0 ? (value.completed / value.cards) * 100 : 0,
      }))
      .sort((left, right) => right.completedLastWeek - left.completedLastWeek);
  }, [rows]);

  const wins = useMemo(() => {
    const items: string[] = [];
    for (const row of rows) {
      if (row.completedLastWeekValue >= 3 || row.deltaPercentValue >= 12 || (row.rag === "Green" && row.deltaPercentValue > 0)) {
        items.push(
          `${row.epicName || row.epicKey}: +${formatPercent(row.deltaPercentValue)} weekly movement (${row.completedLastWeekValue}/${row.totalCards} cards), ${row.groupText} / ${row.typeText}.`,
        );
      }
      if (items.length >= 4) break;
    }
    if (items.length === 0 && rows.length > 0) {
      items.push("Steady delivery across configured epics with no major slippage this week.");
    }
    return items;
  }, [rows]);

  const risks = useMemo(() => {
    const items: string[] = [];
    for (const row of rows) {
      if (row.rag === "Red") {
        items.push(
          `${row.epicName || row.epicKey}: Red at ${formatPercent(row.completionPercent)} completion; prioritize scope burn-down and blocker removal.`,
        );
      } else if (row.totalCards > 0 && row.completedLastWeekValue === 0) {
        items.push(
          `${row.epicName || row.epicKey}: no completed cards in the last 7 days (${row.groupText} / ${row.typeText}).`,
        );
      } else if (row.successCriteria.length === 0) {
        items.push(`${row.epicName || row.epicKey}: success criteria not configured; outcome quality risk remains.`);
      }
      if (items.length >= 4) break;
    }
    if (items.length === 0 && rows.length > 0) {
      items.push("No major initiative risks flagged from this week's configured epic signals.");
    }
    return items;
  }, [rows]);

  const executiveSummary = useMemo(() => {
    if (rows.length === 0) {
      return "No configured epics found. Configure epic metadata to generate an executive report.";
    }
    const topEpic = rows[0];
    const topGroup = groupProgress[0];
    const topType = typeProgress[0];
    return (
      `Tracking ${metrics.totalEpics} configured epics across ${metrics.totalCards} scoped cards. ` +
      `${metrics.totalCompletedLastWeek} cards were completed in the last 7 days (${formatPercent(metrics.avgDelta)} weekly progress), ` +
      `with average completion at ${formatPercent(metrics.avgCompletion)}. ` +
      `RAG distribution is ${metrics.greenCount} Green, ${metrics.amberCount} Amber, ${metrics.redCount} Red. ` +
      `Top momentum epic: ${topEpic.epicName || topEpic.epicKey} (+${formatPercent(topEpic.deltaPercentValue)}). ` +
      `Top group/type contributors this week: ${topGroup?.name ?? "n/a"} and ${topType?.name ?? "n/a"}.`
    );
  }, [groupProgress, metrics, rows, typeProgress]);

  const reportTone = metrics.redCount > 0 ? "warn" : "good";
  const initiativeRows = useMemo(() => {
    const sorted = [...rows];
    sorted.sort((left, right) => {
      const leftGroup = left.groupText.trim();
      const rightGroup = right.groupText.trim();
      if (leftGroup !== rightGroup) {
        if (leftGroup === "Unassigned") return 1;
        if (rightGroup === "Unassigned") return -1;
        return leftGroup.localeCompare(rightGroup, undefined, { sensitivity: "base" });
      }
      if (left.typeText !== right.typeText) {
        if (left.typeText === "Unassigned") return 1;
        if (right.typeText === "Unassigned") return -1;
        return left.typeText.localeCompare(right.typeText, undefined, { sensitivity: "base" });
      }
      if (right.completedLastWeekValue !== left.completedLastWeekValue) {
        return right.completedLastWeekValue - left.completedLastWeekValue;
      }
      return (left.epicName || left.epicKey).localeCompare(right.epicName || right.epicKey, undefined, {
        sensitivity: "base",
      });
    });
    return sorted;
  }, [rows]);

  useEffect(() => {
    if (rows.length === 0) {
      setSelectedInitiativeEpicKeys([]);
      hasInitializedInitiativeSelection.current = false;
      return;
    }

    const allEpicKeys = rows.map((row) => row.epicKey);
    const available = new Set(allEpicKeys);

    if (!hasInitializedInitiativeSelection.current) {
      let storedKeys: string[] = [];
      if (typeof window !== "undefined") {
        try {
          const raw = window.localStorage.getItem(INITIATIVE_SECTION_SELECTION_KEY);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              storedKeys = parsed.filter((value): value is string => typeof value === "string");
            }
          }
        } catch {
          storedKeys = [];
        }
      }
      const initialKeys = storedKeys.filter((key) => available.has(key));
      const nextSelection = initialKeys.length > 0 ? initialKeys : allEpicKeys;
      setSelectedInitiativeEpicKeys(nextSelection);
      persistInitiativeSelection(nextSelection);
      hasInitializedInitiativeSelection.current = true;
      return;
    }

    setSelectedInitiativeEpicKeys((previous) => {
      const nextSelection = previous.filter((key) => available.has(key));
      const normalized = nextSelection.length > 0 ? nextSelection : allEpicKeys;
      if (normalized.length !== previous.length || normalized.some((key, index) => key !== previous[index])) {
        persistInitiativeSelection(normalized);
      }
      return normalized;
    });
  }, [persistInitiativeSelection, rows]);

  const visibleInitiativeRows = useMemo(() => {
    const rowByKey = new Map(initiativeRows.map((row) => [row.epicKey, row]));
    const orderedRows: ExecutiveRow[] = [];
    for (const key of selectedInitiativeEpicKeys) {
      const row = rowByKey.get(key);
      if (row) orderedRows.push(row);
    }
    return orderedRows;
  }, [initiativeRows, selectedInitiativeEpicKeys]);

  const visibleInitiativeSignals = useMemo(() => {
    const totalEpics = visibleInitiativeRows.length;
    const totalCompletedLastWeek = visibleInitiativeRows.reduce(
      (sum, row) => sum + row.completedLastWeekValue,
      0,
    );
    const redCount = visibleInitiativeRows.filter((row) => row.rag === "Red").length;
    const amberCount = visibleInitiativeRows.filter((row) => row.rag === "Amber").length;
    const greenCount = visibleInitiativeRows.filter((row) => row.rag === "Green").length;
    return {
      totalEpics,
      totalCompletedLastWeek,
      redCount,
      amberCount,
      greenCount,
    };
  }, [visibleInitiativeRows]);

  const initiativeConfigRows = useMemo(() => {
    const query = initiativeConfigQuery.trim().toLowerCase();
    if (!query) return initiativeRows;
    return initiativeRows.filter((row) => {
      return (
        row.epicKey.toLowerCase().includes(query) ||
        (row.epicName || "").toLowerCase().includes(query) ||
        row.groupText.toLowerCase().includes(query) ||
        row.typeText.toLowerCase().includes(query)
      );
    });
  }, [initiativeConfigQuery, initiativeRows]);

  const selectedInitiativeConfigRows = useMemo(() => {
    const rowByKey = new Map(initiativeRows.map((row) => [row.epicKey, row]));
    const selectedRows: ExecutiveRow[] = [];
    for (const key of initiativeConfigDraftKeys) {
      const row = rowByKey.get(key);
      if (row) selectedRows.push(row);
    }
    return selectedRows;
  }, [initiativeConfigDraftKeys, initiativeRows]);

  const availableInitiativeConfigRows = useMemo(() => {
    const selected = new Set(initiativeConfigDraftKeys);
    return initiativeConfigRows.filter((row) => !selected.has(row.epicKey));
  }, [initiativeConfigDraftKeys, initiativeConfigRows]);

  const openInitiativeConfig = useCallback(() => {
    setInitiativeConfigDraftKeys(selectedInitiativeEpicKeys);
    setInitiativeConfigQuery("");
    setInitiativeConfigDraggingKey(null);
    setInitiativeConfigOpen(true);
  }, [selectedInitiativeEpicKeys]);

  const closeInitiativeConfig = useCallback(() => {
    setInitiativeConfigOpen(false);
    setInitiativeConfigQuery("");
    setInitiativeConfigDraggingKey(null);
  }, []);

  const addInitiativeDraftKey = useCallback((epicKey: string) => {
    setInitiativeConfigDraftKeys((previous) => {
      if (previous.includes(epicKey)) return previous;
      return [...previous, epicKey];
    });
  }, []);

  const removeInitiativeDraftKey = useCallback((epicKey: string) => {
    setInitiativeConfigDraftKeys((previous) => previous.filter((key) => key !== epicKey));
  }, []);

  const moveInitiativeDraftKey = useCallback((sourceKey: string, targetKey: string) => {
    if (sourceKey === targetKey) return;
    setInitiativeConfigDraftKeys((previous) => {
      const sourceIndex = previous.indexOf(sourceKey);
      const targetIndex = previous.indexOf(targetKey);
      if (sourceIndex < 0 || targetIndex < 0) return previous;
      const reordered = [...previous];
      reordered.splice(sourceIndex, 1);
      reordered.splice(targetIndex, 0, sourceKey);
      return reordered;
    });
  }, []);

  const saveInitiativeConfig = useCallback(() => {
    const available = new Set(initiativeRows.map((row) => row.epicKey));
    const normalized = initiativeConfigDraftKeys.filter((key, index, source) => available.has(key) && source.indexOf(key) === index);
    setSelectedInitiativeEpicKeys(normalized);
    persistInitiativeSelection(normalized);
    closeInitiativeConfig();
  }, [closeInitiativeConfig, initiativeConfigDraftKeys, initiativeRows, persistInitiativeSelection]);

  const exportReportPdf = useCallback(() => {
    if (typeof window === "undefined") return;
    setIsExportingPdf(true);
    const body = document.body;
    body.classList.add("executive-print-mode");
    const previousTitle = document.title;
    const printDate = new Date().toISOString().slice(0, 10);
    document.title = `TeamBeacon-Executive-Report-${printDate}`;

    window.setTimeout(() => {
      window.print();
      window.setTimeout(() => {
        body.classList.remove("executive-print-mode");
        document.title = previousTitle;
        setIsExportingPdf(false);
      }, 250);
    }, 120);
  }, []);

  return (
    <div className="screen-grid">
      <Panel
        title="Executive Summary Draft"
        subtitle="Generated from configured epics, group/type dimensions, and last-7-day movement."
        action={(
          <div className="executive-actions no-print">
            <StatusPill tone={reportTone} text={metrics.redCount > 0 ? "Review Risks" : "Ready to Export"} />
            <button className="mini-sync-btn" type="button" onClick={exportReportPdf} disabled={isExportingPdf}>
              {isExportingPdf ? "Preparing..." : "Export PDF (A4)"}
            </button>
          </div>
        )}
      >
        <p className="summary">{loading ? "Generating executive summary..." : executiveSummary}</p>
        {error ? <p className="sync-history-error">Executive report error: {error}</p> : null}
      </Panel>

      <Panel title="Wins and Risks" subtitle="Auto-highlighted report bullets for leadership updates.">
        <div className="metrics-grid two-up">
          <div>
            <h4 className="executive-list-title">Wins</h4>
            <ul className="list">
              {wins.map((item) => (
                <li key={item}>{item}</li>
              ))}
              {!loading && wins.length === 0 ? <li>Wins will appear once configured epic data is available.</li> : null}
            </ul>
          </div>
          <div>
            <h4 className="executive-list-title">Risks</h4>
            <ul className="list">
              {risks.map((item) => (
                <li key={item}>{item}</li>
              ))}
              {!loading && risks.length === 0 ? <li>Risks will appear once configured epic data is available.</li> : null}
            </ul>
          </div>
        </div>
      </Panel>

      <Panel title="Group and Type Weekly Progress" subtitle="Momentum view across epic groups and work types.">
        <div className="metrics-grid two-up">
          <div className="executive-mini-table">
            <h4>Groups</h4>
            <table className="sync-history-table">
              <thead>
                <tr>
                  <th>Group</th>
                  <th>Weekly</th>
                  <th>Completion</th>
                </tr>
              </thead>
              <tbody>
                {groupProgress.slice(0, 6).map((row) => (
                  <tr key={row.name}>
                    <td>{row.name}</td>
                    <td>{row.completedLastWeek}/{row.cards}</td>
                    <td>{formatPercent(row.completionPercent)}</td>
                  </tr>
                ))}
                {!loading && groupProgress.length === 0 ? (
                  <tr>
                    <td colSpan={3}>No group-tagged epics yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="executive-mini-table">
            <h4>Types</h4>
            <table className="sync-history-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Weekly</th>
                  <th>Completion</th>
                </tr>
              </thead>
              <tbody>
                {typeProgress.slice(0, 6).map((row) => (
                  <tr key={row.name}>
                    <td>{row.name}</td>
                    <td>{row.completedLastWeek}/{row.cards}</td>
                    <td>{formatPercent(row.completionPercent)}</td>
                  </tr>
                ))}
                {!loading && typeProgress.length === 0 ? (
                  <tr>
                    <td colSpan={3}>No type-tagged epics yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </Panel>

      <Panel
        title="Weekly Progress by Initiative"
        subtitle="Configured epics with group/type context and weekly deltas."
        action={
          <button className="mini-sync-btn" type="button" onClick={openInitiativeConfig}>
            Configure
          </button>
        }
      >
        <p className="initiative-selection-summary">
          Showing {visibleInitiativeRows.length} of {initiativeRows.length} configured epics.
        </p>
        <div className="initiative-summary-table-wrap">
          <table className="sync-history-table">
            <thead>
              <tr>
                <th>Group</th>
                <th>Epic</th>
                <th>Type</th>
                <th>Weekly Progress</th>
                <th>Overall Progress</th>
                <th>RAG</th>
              </tr>
            </thead>
            <tbody>
              {visibleInitiativeRows.map((row) => {
                const timelineIconTitle = row.timelineEnabled
                  ? `Timeline configured: ${row.timelineStartDate ?? "?"} -> ${row.targetCompletionDate ?? "?"}`
                  : "";
                return (
                  <tr key={row.epicKey}>
                    <td className="initiative-group-cell">{row.groupText}</td>
                    <td className="initiative-name-cell">
                      <span className="initiative-summary-name-wrap">
                        {jiraBaseUrl ? (
                          <a
                            className="external-link"
                            href={`${jiraBaseUrl}/browse/${row.epicKey}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {row.epicName || row.epicKey}
                          </a>
                        ) : (
                          <span>{row.epicName || row.epicKey}</span>
                        )}
                        {row.timelineEnabled ? (
                          <span className="initiative-timeline-icon" title={timelineIconTitle} aria-label={timelineIconTitle}>
                            <svg viewBox="0 0 20 20" aria-hidden="true">
                              <circle cx="10" cy="10" r="7.2" />
                              <path d="M10 6.2v4.2l2.8 2" />
                            </svg>
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className="initiative-type-cell">{row.typeText}</td>
                    <td className="initiative-delta-cell">
                      {row.completedLastWeekValue}/{row.totalCards} cards ({formatPercent(row.deltaPercentValue)})
                    </td>
                    <td className="initiative-progress-cell">
                      <div className="initiative-progress-content">
                        <span className="initiative-progress-track">
                          <span className="initiative-progress-fill" style={{ width: `${Math.min(100, row.completionPercent)}%` }} />
                        </span>
                        <span className="initiative-progress-label">{formatPercent(row.completionPercent)}</span>
                      </div>
                    </td>
                    <td title={row.ragTooltip}>
                      <span className={`rag-indicator rag-${row.rag.toLowerCase()}`}>
                        <span className="rag-dot rag-dot-large" />
                      </span>
                    </td>
                  </tr>
                );
              })}
              {!loading && visibleInitiativeRows.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    {initiativeRows.length > 0
                      ? "No epics selected. Use Configure to include epics in this section."
                      : "No configured epic data available yet."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Report Signals" subtitle="High-level confidence snapshot for final review.">
        <div className="metrics-grid four-up">
          <MetricCard
            label="Ongoing Initiatives"
            value={loading ? "..." : visibleInitiativeSignals.totalEpics}
            hint="Selected for Weekly Progress by Initiative."
          />
          <MetricCard
            label="Weekly Progress"
            value={loading ? "..." : `${visibleInitiativeSignals.totalCompletedLastWeek} cards`}
            hint="Completed in last 7 days."
            tone={visibleInitiativeSignals.totalCompletedLastWeek > 0 ? "good" : "warn"}
          />
          <MetricCard
            label="Initiative RAG"
            value={
              loading ? "..." : (
                <span className="initiative-rag-breakdown">
                  <span className="initiative-rag-text initiative-rag-red">{visibleInitiativeSignals.redCount} Red</span>
                  <span className="initiative-rag-separator">|</span>
                  <span className="initiative-rag-text initiative-rag-amber">{visibleInitiativeSignals.amberCount} Amber</span>
                  <span className="initiative-rag-separator">|</span>
                  <span className="initiative-rag-text initiative-rag-green">{visibleInitiativeSignals.greenCount} Green</span>
                </span>
              )
            }
            hint="For selected initiatives."
            tone="neutral"
          />
          <MetricCard
            label="Export Bundle"
            value="Markdown + PDF"
            hint="Generated with weekly configured-epic deltas."
            tone="good"
          />
        </div>
      </Panel>

      {initiativeConfigOpen ? (
        <div className="sync-options-overlay" role="dialog" aria-modal="true" aria-label="Configure initiative epics">
          <div className="sync-options-backdrop" onClick={closeInitiativeConfig} />
          <div className="sync-options-dialog initiative-config-dialog">
            <div className="initiative-config-header">
              <div>
                <h3>Configure Initiative Epics</h3>
                <p>Select which configured epics appear in Weekly Progress by Initiative.</p>
              </div>
              <div className="sync-options-footer initiative-config-top-actions">
                <button className="mini-sync-btn" type="button" onClick={closeInitiativeConfig}>
                  Cancel
                </button>
                <button className="sync-btn" type="button" onClick={saveInitiativeConfig}>
                  Save
                </button>
              </div>
            </div>

            <label className="initiative-config-search">
              <input
                type="text"
                value={initiativeConfigQuery}
                onChange={(event) => setInitiativeConfigQuery(event.target.value)}
                placeholder="Search epics"
                aria-label="Search epics"
              />
            </label>

            <div className="initiative-config-columns">
              <section className="initiative-config-column">
                <div className="initiative-config-column-head">
                  <h4>Available Epics ({availableInitiativeConfigRows.length})</h4>
                  <button
                    className="mini-sync-btn"
                    type="button"
                    onClick={() => setInitiativeConfigDraftKeys(initiativeRows.map((row) => row.epicKey))}
                  >
                    Select All
                  </button>
                </div>
                <p>Double-click to select.</p>
                <div className="initiative-config-card-list">
                  {availableInitiativeConfigRows.map((row) => (
                    <button
                      key={row.epicKey}
                      className="initiative-config-card"
                      type="button"
                      onDoubleClick={() => addInitiativeDraftKey(row.epicKey)}
                    >
                      <span className="initiative-config-card-meta">
                        {row.groupText} | {row.typeText} | {row.epicKey}
                      </span>
                      <span className="initiative-config-card-title">{row.epicName || row.epicKey}</span>
                    </button>
                  ))}
                  {availableInitiativeConfigRows.length === 0 ? (
                    <p className="sync-options-note">No epics match the current search.</p>
                  ) : null}
                </div>
              </section>

              <section className="initiative-config-column">
                <div className="initiative-config-column-head">
                  <h4>Selected Epics ({selectedInitiativeConfigRows.length})</h4>
                  <button className="mini-sync-btn" type="button" onClick={() => setInitiativeConfigDraftKeys([])}>
                    Clear All
                  </button>
                </div>
                <p>Double-click to remove. Drag to reorder.</p>
                <div className="initiative-config-card-list">
                  {selectedInitiativeConfigRows.map((row) => (
                    <div
                      key={row.epicKey}
                      className={`initiative-config-order-item ${
                        initiativeConfigDraggingKey === row.epicKey ? "dragging" : ""
                      }`}
                      draggable
                      onDoubleClick={() => removeInitiativeDraftKey(row.epicKey)}
                      onDragStart={() => setInitiativeConfigDraggingKey(row.epicKey)}
                      onDragEnd={() => setInitiativeConfigDraggingKey(null)}
                      onDragOver={(event) => {
                        event.preventDefault();
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        if (!initiativeConfigDraggingKey) return;
                        moveInitiativeDraftKey(initiativeConfigDraggingKey, row.epicKey);
                        setInitiativeConfigDraggingKey(null);
                      }}
                    >
                      <span className="initiative-drag-handle" aria-hidden="true">
                        ::
                      </span>
                      <span className="initiative-config-order-label">
                        <span className="initiative-config-card-meta">
                          {row.groupText} | {row.typeText} | {row.epicKey}
                        </span>
                        <span className="initiative-config-card-title">{row.epicName || row.epicKey}</span>
                      </span>
                    </div>
                  ))}
                  {selectedInitiativeConfigRows.length === 0 ? (
                    <p className="sync-options-note">No epics selected yet.</p>
                  ) : null}
                </div>
              </section>
            </div>

          </div>
        </div>
      ) : null}
    </div>
  );
}
