import { useCallback, useEffect, useMemo, useState } from "react";
import { MetricCard } from "../components/MetricCard";
import { Panel } from "../components/Panel";
import { StatusPill } from "../components/StatusPill";
import {
  fetchJiraIntegrationStatus,
  fetchJiraSyncHistory,
  fetchJiraSyncStatus,
  JiraIntegrationStatus,
  JiraSyncHistoryEntry,
  JiraSyncMode,
  JiraSyncStatus,
  startJiraSync
} from "../lib/api";

export function IntegrationsScreen() {
  const [jiraStatus, setJiraStatus] = useState<JiraIntegrationStatus | null>(null);
  const [jiraSyncStatus, setJiraSyncStatus] = useState<JiraSyncStatus | null>(null);
  const [jiraSyncHistory, setJiraSyncHistory] = useState<JiraSyncHistoryEntry[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isSyncOptionsOpen, setIsSyncOptionsOpen] = useState(false);
  const [selectedSyncMode, setSelectedSyncMode] = useState<JiraSyncMode>("since_last");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const loadJiraStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const status = await fetchJiraIntegrationStatus();
      setJiraStatus(status);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown request failure";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadJiraSyncStatus = useCallback(async () => {
    try {
      const status = await fetchJiraSyncStatus();
      setJiraSyncStatus(status);
      setSyncError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown sync status failure";
      setSyncError(message);
    }
  }, []);

  const triggerJiraSync = useCallback(async (mode: JiraSyncMode) => {
    setSyncError(null);
    try {
      const status = await startJiraSync(mode);
      setJiraSyncStatus(status);
      setIsSyncOptionsOpen(false);
      await loadJiraSyncStatus();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown sync start failure";
      setSyncError(message);
    }
  }, [loadJiraSyncStatus]);

  const loadJiraSyncHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const entries = await fetchJiraSyncHistory(30);
      setJiraSyncHistory(entries);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown sync history failure";
      setHistoryError(message);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const openHistoryOverlay = useCallback(() => {
    setIsHistoryOpen(true);
    loadJiraSyncHistory().catch(() => {
      // loadJiraSyncHistory already sets local error state.
    });
  }, [loadJiraSyncHistory]);

  const openSyncOptions = useCallback(() => {
    if (jiraSyncStatus?.state === "running") {
      return;
    }
    setSelectedSyncMode("since_last");
    setIsSyncOptionsOpen(true);
  }, [jiraSyncStatus?.state]);

  useEffect(() => {
    loadJiraStatus().catch(() => {
      // loadJiraStatus already sets local error state.
    });
    loadJiraSyncStatus().catch(() => {
      // loadJiraSyncStatus already sets local error state.
    });
  }, [loadJiraStatus, loadJiraSyncStatus]);

  useEffect(() => {
    if (jiraSyncStatus?.state !== "running") {
      return;
    }
    const intervalId = window.setInterval(() => {
      loadJiraSyncStatus().catch(() => {
        // loadJiraSyncStatus already sets local error state.
      });
    }, 1500);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [jiraSyncStatus?.state, loadJiraSyncStatus]);

  useEffect(() => {
    if (!isHistoryOpen || jiraSyncStatus?.state !== "running") {
      return;
    }
    const intervalId = window.setInterval(() => {
      loadJiraSyncHistory().catch(() => {
        // loadJiraSyncHistory already sets local error state.
      });
    }, 2000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [isHistoryOpen, jiraSyncStatus?.state, loadJiraSyncHistory]);

  const jiraTone = useMemo(() => {
    if (error) return "risk";
    if (loading) return "warn";
    return jiraStatus?.connected ? "good" : "warn";
  }, [error, jiraStatus, loading]);

  const jiraValue = useMemo(() => {
    if (error) return "Unavailable";
    if (loading) return "Checking...";
    return jiraStatus?.connected ? "Connected" : "Check Required";
  }, [error, jiraStatus, loading]);

  const jiraHint = useMemo(() => {
    if (error) return `Failed to reach local API: ${error}`;
    if (loading) return "Testing JIRA API reachability and board/project access.";
    if (!jiraStatus) return "Status not loaded.";
    if (jiraStatus.error) return jiraStatus.error;
    const checksPassed = jiraStatus.checks.filter((check) => check.ok).length;
    return `${checksPassed}/${jiraStatus.checks.length} connectivity checks passed.`;
  }, [error, jiraStatus, loading]);

  const jiraSyncTone = useMemo(() => {
    if (syncError) return "risk";
    if (!jiraSyncStatus) return "neutral";
    if (jiraSyncStatus.state === "failed") return "risk";
    if (jiraSyncStatus.state === "running") return "warn";
    if (jiraSyncStatus.state === "completed") return "good";
    return "neutral";
  }, [syncError, jiraSyncStatus]);

  const jiraSyncStateText = useMemo(() => {
    if (syncError) return "Sync Error";
    if (!jiraSyncStatus) return "Idle";
    if (jiraSyncStatus.state === "running") return "Syncing";
    if (jiraSyncStatus.state === "completed") return "Completed";
    if (jiraSyncStatus.state === "failed") return "Failed";
    return "Idle";
  }, [syncError, jiraSyncStatus]);

  const jiraSyncProgressText = useMemo(() => {
    if (syncError) return `Sync status error: ${syncError}`;
    if (!jiraSyncStatus) return "Sync not started.";
    if (jiraSyncStatus.state === "running") {
      if (jiraSyncStatus.message) {
        return jiraSyncStatus.message;
      }
      if (jiraSyncStatus.totalIssues !== undefined && jiraSyncStatus.totalIssues !== null) {
        return `${jiraSyncStatus.downloadedIssues} of ${jiraSyncStatus.totalIssues} issues downloaded`;
      }
      return `${jiraSyncStatus.downloadedIssues} issues downloaded`;
    }
    if (jiraSyncStatus.state === "failed") {
      return jiraSyncStatus.error ?? "Last sync failed.";
    }
    if (jiraSyncStatus.state === "completed") {
      const total = jiraSyncStatus.totalIssues ?? jiraSyncStatus.downloadedIssues;
      return `${jiraSyncStatus.downloadedIssues} of ${total} issues downloaded`;
    }
    if (jiraSyncStatus.state === "idle" && jiraSyncStatus.lastSyncedAt) {
      return "Not currently syncing.";
    }
    return "Sync not started.";
  }, [syncError, jiraSyncStatus]);

  const jiraLastSyncedText = useMemo(() => {
    const value = jiraSyncStatus?.lastSyncedAt;
    if (!value) return "Never";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
  }, [jiraSyncStatus?.lastSyncedAt]);

  const jiraSyncModeText = useMemo(() => {
    const mode = jiraSyncStatus?.syncMode;
    if (mode === "since_last") {
      return "Since last checkpoint (2-day overlap)";
    }
    return "Full";
  }, [jiraSyncStatus?.syncMode]);

  const jiraSyncButtonText = jiraSyncStatus?.state === "running" ? "Syncing..." : "Sync Data";
  const formatSyncMode = useCallback((mode: JiraSyncMode | null | undefined): string => {
    return mode === "since_last" ? "Since Last" : "Full";
  }, []);

  const formatTimestamp = useCallback((value: string | null | undefined): string => {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
  }, []);

  const storyPointsField = jiraStatus?.config.storyPointsField ?? "customfield_10004";
  const epicLinkField = jiraStatus?.config.epicLinkField ?? "customfield_10902";
  const sampleIssueText = jiraStatus?.sampleIssueKey ?? "none";
  const configuredBoard = jiraStatus?.configuredBoard;
  const configuredBoardUrl =
    configuredBoard?.url ??
    (jiraStatus?.config.baseUrl && jiraStatus?.config.boardId
      ? `${jiraStatus.config.baseUrl.replace(/\/$/, "")}/secure/RapidBoard.jspa?rapidView=${jiraStatus.config.boardId}`
      : null);
  const configuredProjectUrl =
    jiraStatus?.configuredProjectUrl ??
    (jiraStatus?.config.baseUrl && jiraStatus?.config.projectKey
      ? `${jiraStatus.config.baseUrl.replace(/\/$/, "")}/projects/${jiraStatus.config.projectKey}`
      : null);
  const sampleIssueUrl =
    jiraStatus?.sampleIssueUrl ??
    (jiraStatus?.config.baseUrl && jiraStatus?.sampleIssueKey
      ? `${jiraStatus.config.baseUrl.replace(/\/$/, "")}/browse/${jiraStatus.sampleIssueKey}`
      : null);
  const configuredBoardText =
    configuredBoard?.id !== undefined
      ? `${configuredBoard.name} (${configuredBoard.id})`
      : jiraStatus?.config.boardId !== undefined && jiraStatus?.config.boardId !== null
        ? `Board ${jiraStatus.config.boardId}`
        : "n/a";

  return (
    <div className="screen-grid">
      <Panel
        title="Source Connections"
        subtitle="Live connectivity checks from local API to configured systems."
        action={
          <button className="sync-btn" onClick={loadJiraStatus} type="button">
            {loading ? "Checking..." : "Check Now"}
          </button>
        }
      >
        <div className="metrics-grid three-up">
          <MetricCard
            label="JIRA Connection"
            value={jiraValue}
            hint={
              <>
                {jiraHint}
                <br />
                Sync: {jiraSyncProgressText}
                <br />
                Last synced: {jiraLastSyncedText}
                <br />
                Mode: {jiraSyncModeText}
                <div className="card-actions">
                  <button
                    className="mini-sync-btn"
                    onClick={openSyncOptions}
                    type="button"
                    disabled={jiraSyncStatus?.state === "running"}
                  >
                    {jiraSyncButtonText}
                  </button>
                  <button
                    className="mini-sync-btn"
                    onClick={openHistoryOverlay}
                    type="button"
                  >
                    Sync History
                  </button>
                  <StatusPill tone={jiraSyncTone} text={jiraSyncStateText} />
                </div>
              </>
            }
            tone={jiraTone}
          />
          <MetricCard
            label="Confluence Connection"
            value="Not Implemented"
            hint="Confluence health endpoint not wired yet."
            tone="warn"
          />
          <MetricCard
            label="SCM Connection"
            value="Not Implemented"
            hint="SCM connectivity endpoint not wired yet."
            tone="warn"
          />
        </div>
      </Panel>

      <Panel
        title="Field Mapping Readiness"
        subtitle="Track required custom fields before sync pipelines run."
        action={
          <StatusPill
            tone={jiraStatus?.connected ? "good" : "warn"}
            text={jiraStatus?.connected ? "JIRA Mapping Loaded" : "Pending Live Check"}
          />
        }
      >
        <ul className="list">
          <li>
            Story Points <StatusPill tone="good" text={storyPointsField} />
          </li>
          <li>
            Sprint <StatusPill tone="good" text="auto-detected" />
          </li>
          <li>
            Epic Link <StatusPill tone="good" text={epicLinkField} />
          </li>
          <li>
            Cycle Start Date <StatusPill tone="warn" text="pending" />
          </li>
        </ul>
      </Panel>

      <Panel title="JIRA Diagnostics" subtitle="Board and project checks from live API response.">
        <div className="metrics-grid three-up">
          <MetricCard
            label="Configured Board"
            value={
              configuredBoardUrl ? (
                <a
                  className="external-link"
                  href={configuredBoardUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {configuredBoardText}
                </a>
              ) : (
                configuredBoardText
              )
            }
            hint="JIRA_BOARD_ID from local config."
            tone={jiraStatus?.connected ? "good" : "warn"}
          />
          <MetricCard
            label="Sample Issue"
            value={
              sampleIssueUrl && jiraStatus?.sampleIssueKey ? (
                <a
                  className="external-link"
                  href={sampleIssueUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {sampleIssueText}
                </a>
              ) : (
                sampleIssueText
              )
            }
            hint="Latest issue from configured project."
            tone={jiraStatus?.sampleIssueKey ? "good" : "warn"}
          />
          <MetricCard
            label="Configured Project"
            value={
              configuredProjectUrl && jiraStatus?.config.projectKey ? (
                <a
                  className="external-link"
                  href={configuredProjectUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {jiraStatus.config.projectKey}
                </a>
              ) : (
                jiraStatus?.config.projectKey ?? "n/a"
              )
            }
            hint="JIRA_PROJECT_KEY from local config."
            tone={jiraStatus?.config.projectKey ? "neutral" : "warn"}
          />
        </div>
      </Panel>

      <Panel title="Alias Mapping" subtitle="Identity privacy mapping for individual views and executive exports.">
        <div className="chips">
          <span className="chip">SE 1 {"->"} 7cx91</span>
          <span className="chip">SE 2 {"->"} 4jb72</span>
          <span className="chip">SE 3 {"->"} 9gt15</span>
          <span className="chip">QA 1 {"->"} 3kp44</span>
          <span className="chip">SRE 1 {"->"} 8mf23</span>
        </div>
      </Panel>

      {isSyncOptionsOpen ? (
        <div className="sync-options-overlay" role="dialog" aria-modal="true" aria-label="Start JIRA Sync">
          <div className="sync-options-backdrop" onClick={() => setIsSyncOptionsOpen(false)} />
          <div className="sync-options-dialog">
            <h3>Start JIRA Sync</h3>
            <p>Choose how much data to refresh before starting the sync.</p>

            <div className="sync-options-list">
              <label className={`sync-option ${selectedSyncMode === "since_last" ? "selected" : ""}`}>
                <input
                  type="radio"
                  name="jira-sync-mode"
                  value="since_last"
                  checked={selectedSyncMode === "since_last"}
                  onChange={() => setSelectedSyncMode("since_last")}
                />
                <span>
                  <span className="sync-option-title">Sync Since Last Timestamp</span>
                  <span className="sync-option-desc">
                    Pull issues updated since the previous sync with a built-in 2-day overlap.
                  </span>
                </span>
              </label>

              <label className={`sync-option ${selectedSyncMode === "full" ? "selected" : ""}`}>
                <input
                  type="radio"
                  name="jira-sync-mode"
                  value="full"
                  checked={selectedSyncMode === "full"}
                  onChange={() => setSelectedSyncMode("full")}
                />
                <span>
                  <span className="sync-option-title">Full Sync</span>
                  <span className="sync-option-desc">Download the entire configured board dataset.</span>
                </span>
              </label>
            </div>

            <p className="sync-options-note">
              Last synced: {jiraLastSyncedText}. If no previous sync exists, incremental mode falls back to full sync.
            </p>

            <div className="sync-options-footer">
              <button className="mini-sync-btn" onClick={() => setIsSyncOptionsOpen(false)} type="button">
                Cancel
              </button>
              <button
                className="mini-sync-btn"
                onClick={() => {
                  triggerJiraSync(selectedSyncMode).catch(() => {
                    // triggerJiraSync already sets local error state.
                  });
                }}
                type="button"
              >
                Start Sync
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isHistoryOpen ? (
        <div className="sync-history-overlay" role="dialog" aria-modal="true" aria-label="JIRA Sync History">
          <div className="sync-history-backdrop" onClick={() => setIsHistoryOpen(false)} />
          <div className="sync-history-dialog">
            <div className="sync-history-header">
              <h3>JIRA Sync History</h3>
              <div className="sync-history-actions">
                <button className="mini-sync-btn" onClick={loadJiraSyncHistory} type="button">
                  Refresh
                </button>
                <button className="mini-sync-btn" onClick={() => setIsHistoryOpen(false)} type="button">
                  Close
                </button>
              </div>
            </div>

            {historyError ? <p className="sync-history-error">Failed to load history: {historyError}</p> : null}
            {historyLoading ? <p className="sync-history-loading">Loading sync history...</p> : null}

            <div className="sync-history-table-wrap">
              <table className="sync-history-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Board</th>
                    <th>Mode</th>
                    <th>Sprints</th>
                    <th>Issues</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {jiraSyncHistory.map((entry) => (
                    <tr key={entry.id}>
                      <td>{formatTimestamp(entry.finishedAt ?? entry.startedAt)}</td>
                      <td>{entry.boardName ?? (entry.boardId ? `Board ${entry.boardId}` : "-")}</td>
                      <td>{formatSyncMode(entry.syncMode)}</td>
                      <td>{entry.sprintsSynced}</td>
                      <td>{entry.issuesSynced}</td>
                      <td>{entry.status}</td>
                    </tr>
                  ))}
                  {!historyLoading && jiraSyncHistory.length === 0 ? (
                    <tr>
                      <td colSpan={6}>No sync history available yet.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
