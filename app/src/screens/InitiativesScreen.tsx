import { useCallback, useEffect, useMemo, useState } from "react";
import { MetricCard } from "../components/MetricCard";
import { Panel } from "../components/Panel";
import { StatusPill } from "../components/StatusPill";
import {
  fetchConfiguredEpicSummary,
  fetchJiraIntegrationStatus,
  InitiativeEpicSummary,
} from "../lib/api";

export function InitiativesScreen() {
  const [epicSummary, setEpicSummary] = useState<InitiativeEpicSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [jiraBaseUrl, setJiraBaseUrl] = useState<string | null>(null);

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

  return (
    <div className="screen-grid">
      <Panel
        title="Configured Epics Summary"
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

        <div className="initiative-summary-table-wrap">
          <table className="sync-history-table">
            <thead>
              <tr>
                <th>Epic Key</th>
                <th>Epic Name</th>
                <th>Completion</th>
                <th>RAG Score</th>
                <th>Insight Comment</th>
              </tr>
            </thead>
            <tbody>
              {epicSummary.map((entry) => (
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
                  <td className="initiative-name-cell">{entry.epicName || "-"}</td>
                  <td>
                    <div className="initiative-progress-cell">
                      <span className="initiative-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={entry.completionPercent}>
                        <span className="initiative-progress-fill" style={{ width: `${Math.max(0, Math.min(100, entry.completionPercent))}%` }} />
                      </span>
                      <span className="initiative-progress-label">
                        {entry.completionPercent.toFixed(1).replace(/\.0$/, "")}% ({entry.completedCards}/{entry.totalCards})
                      </span>
                    </div>
                  </td>
                  <td className="initiative-empty-cell">{entry.ragScore ?? ""}</td>
                  <td className="initiative-comment-cell">{entry.insightComment ?? ""}</td>
                </tr>
              ))}
              {!loading && epicSummary.length === 0 ? (
                <tr>
                  <td colSpan={5}>No configured epics found yet.</td>
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
