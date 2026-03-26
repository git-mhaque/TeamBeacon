import { useCallback, useEffect, useMemo, useState } from "react";
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
  completedLastWeekValue: number;
  deltaPercentValue: number;
};

function ragFromCompletion(percent: number): RagLabel {
  if (percent < 33) return "Red";
  if (percent < 66) return "Amber";
  return "Green";
}

function toneForRag(rag: RagLabel): "risk" | "warn" | "good" {
  if (rag === "Red") return "risk";
  if (rag === "Amber") return "warn";
  return "good";
}

function formatPercent(value: number): string {
  return `${value.toFixed(1).replace(/\.0$/, "")}%`;
}

export function ExecutiveReportScreen() {
  const [rows, setRows] = useState<ExecutiveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [jiraBaseUrl, setJiraBaseUrl] = useState<string | null>(null);

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
        return {
          ...entry,
          groupText: groupText || "Unassigned",
          typeText: typeText || "Unassigned",
          rag: ragFromCompletion(entry.completionPercent),
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

  return (
    <div className="screen-grid">
      <Panel
        title="Executive Summary Draft"
        subtitle="Generated from configured epics, group/type dimensions, and last-7-day movement."
        action={<StatusPill tone={reportTone} text={metrics.redCount > 0 ? "Review Risks" : "Ready to Export"} />}
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

      <Panel title="Weekly Progress by Initiative" subtitle="Configured epics with group/type context and weekly deltas.">
        <div className="initiative-summary-table-wrap">
          <table className="sync-history-table">
            <thead>
              <tr>
                <th>Epic</th>
                <th>Group</th>
                <th>Type</th>
                <th>Weekly Progress</th>
                <th>Completion</th>
                <th>RAG</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.epicKey}>
                  <td className="initiative-name-cell">
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
                      row.epicName || row.epicKey
                    )}
                  </td>
                  <td className="initiative-group-cell">{row.groupText}</td>
                  <td className="initiative-type-cell">{row.typeText}</td>
                  <td className="initiative-delta-cell">
                    {row.completedLastWeekValue}/{row.totalCards} cards ({formatPercent(row.deltaPercentValue)})
                  </td>
                  <td className="initiative-progress-cell">
                    <span className="initiative-progress-track">
                      <span className="initiative-progress-fill" style={{ width: `${Math.min(100, row.completionPercent)}%` }} />
                    </span>
                    <span className="initiative-progress-label">{formatPercent(row.completionPercent)}</span>
                  </td>
                  <td>
                    <StatusPill tone={toneForRag(row.rag)} text={row.rag} />
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={6}>No configured epic data available yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Report Signals" subtitle="High-level confidence snapshot for final review.">
        <div className="metrics-grid four-up">
          <MetricCard
            label="Configured Epics"
            value={loading ? "..." : metrics.totalEpics}
            hint="Executive report scope."
          />
          <MetricCard
            label="Weekly Progress"
            value={loading ? "..." : `${metrics.totalCompletedLastWeek} cards`}
            hint={loading ? "..." : `${formatPercent(metrics.avgDelta)} of scoped cards`}
            tone={metrics.totalCompletedLastWeek > 0 ? "good" : "warn"}
          />
          <MetricCard
            label="Initiative RAG"
            value={loading ? "..." : `${metrics.greenCount}G / ${metrics.amberCount}A / ${metrics.redCount}R`}
            hint="Derived from epic completion."
            tone={metrics.redCount > 0 ? "warn" : "good"}
          />
          <MetricCard
            label="Export Bundle"
            value="Markdown + PDF"
            hint="Generated with weekly configured-epic deltas."
            tone="good"
          />
        </div>
      </Panel>
    </div>
  );
}
