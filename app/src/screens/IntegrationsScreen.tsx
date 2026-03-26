import { useCallback, useEffect, useMemo, useState } from "react";
import { MetricCard } from "../components/MetricCard";
import { Panel } from "../components/Panel";
import { StatusPill } from "../components/StatusPill";
import {
  addEpicGroup,
  addWorkType,
  deleteEpicGroup,
  deleteWorkType,
  EpicLookupConfig,
  fetchJiraIntegrationStatus,
  fetchEpicLookupConfig,
  fetchJiraSyncHistory,
  fetchJiraSyncStatus,
  JiraIntegrationStatus,
  JiraSyncHistoryEntry,
  JiraSyncMode,
  JiraSyncStatus,
  startJiraSync,
  updateEpicGroup,
  updateWorkType
} from "../lib/api";

export function IntegrationsScreen() {
  const todayLocalDate = useMemo(() => {
    const now = new Date();
    const shifted = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return shifted.toISOString().slice(0, 10);
  }, []);

  const [jiraStatus, setJiraStatus] = useState<JiraIntegrationStatus | null>(null);
  const [jiraSyncStatus, setJiraSyncStatus] = useState<JiraSyncStatus | null>(null);
  const [jiraSyncHistory, setJiraSyncHistory] = useState<JiraSyncHistoryEntry[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isSyncOptionsOpen, setIsSyncOptionsOpen] = useState(false);
  const [selectedSyncMode, setSelectedSyncMode] = useState<JiraSyncMode>("since_last");
  const [selectedSinceDate, setSelectedSinceDate] = useState(todayLocalDate);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [metaSuccess, setMetaSuccess] = useState<string | null>(null);
  const [epicLookup, setEpicLookup] = useState<EpicLookupConfig>({ groups: [], workTypes: [] });
  const [groupDraft, setGroupDraft] = useState("");
  const [workTypeDraft, setWorkTypeDraft] = useState("");
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null);
  const [editingGroupName, setEditingGroupName] = useState("");
  const [editingWorkTypeId, setEditingWorkTypeId] = useState<number | null>(null);
  const [editingWorkTypeName, setEditingWorkTypeName] = useState("");

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

  const triggerJiraSync = useCallback(async (mode: JiraSyncMode, sinceDate?: string) => {
    setSyncError(null);
    try {
      const status = await startJiraSync(mode, sinceDate);
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

  const loadEpicMetadataConfig = useCallback(async () => {
    setMetaError(null);
    try {
      const lookup = await fetchEpicLookupConfig();
      setEpicLookup(lookup);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown epic metadata failure";
      setMetaError(message);
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
    setSelectedSinceDate(todayLocalDate);
    setIsSyncOptionsOpen(true);
  }, [jiraSyncStatus?.state, todayLocalDate]);

  useEffect(() => {
    loadJiraStatus().catch(() => {
      // loadJiraStatus already sets local error state.
    });
    loadJiraSyncStatus().catch(() => {
      // loadJiraSyncStatus already sets local error state.
    });
    loadEpicMetadataConfig().catch(() => {
      // loadEpicMetadataConfig already sets local error state.
    });
  }, [loadJiraStatus, loadJiraSyncStatus, loadEpicMetadataConfig]);

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

  const jiraSyncPercent = useMemo(() => {
    if (!jiraSyncStatus || syncError) return null;
    if (typeof jiraSyncStatus.percent === "number" && Number.isFinite(jiraSyncStatus.percent)) {
      const bounded = Math.max(0, Math.min(100, jiraSyncStatus.percent));
      return Math.round(bounded * 10) / 10;
    }
    if (jiraSyncStatus.state === "completed") {
      return 100;
    }
    return null;
  }, [syncError, jiraSyncStatus]);

  const jiraSyncProgressSummary = useMemo(() => {
    if (syncError) return `Sync status error: ${syncError}`;
    if (!jiraSyncStatus) return "Sync not started.";
    if (jiraSyncStatus.state === "failed") {
      return jiraSyncStatus.error ?? "Last sync failed.";
    }
    if (jiraSyncStatus.state === "running") {
      return "In progress";
    }
    if (jiraSyncStatus.state === "completed") {
      return "Sync complete.";
    }
    if (jiraSyncStatus.lastSyncedAt) {
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
    if (mode === "since_date") {
      const requestedSince = jiraSyncStatus?.requestedSince;
      if (!requestedSince) return "Since specific date";
      const requestedDate = new Date(requestedSince);
      if (Number.isNaN(requestedDate.getTime())) return `Since ${requestedSince}`;
      return `Since ${requestedDate.toLocaleDateString()}`;
    }
    if (mode === "since_last") {
      return "Since last checkpoint";
    }
    return "Full";
  }, [jiraSyncStatus?.requestedSince, jiraSyncStatus?.syncMode]);

  const jiraSyncButtonText = jiraSyncStatus?.state === "running" ? "Syncing..." : "Sync Data";

  const handleAddEpicGroup = useCallback(async () => {
    const candidate = groupDraft.trim();
    if (!candidate) {
      setMetaError("Epic group name is required.");
      return;
    }
    setMetaError(null);
    setMetaSuccess(null);
    try {
      await addEpicGroup(candidate);
      setGroupDraft("");
      await loadEpicMetadataConfig();
      setMetaSuccess(`Epic group "${candidate}" saved.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save epic group.";
      setMetaError(message);
    }
  }, [groupDraft, loadEpicMetadataConfig]);

  const handleAddWorkType = useCallback(async () => {
    const candidate = workTypeDraft.trim();
    if (!candidate) {
      setMetaError("Work type name is required.");
      return;
    }
    setMetaError(null);
    setMetaSuccess(null);
    try {
      await addWorkType(candidate);
      setWorkTypeDraft("");
      await loadEpicMetadataConfig();
      setMetaSuccess(`Work type "${candidate}" saved.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save work type.";
      setMetaError(message);
    }
  }, [loadEpicMetadataConfig, workTypeDraft]);

  const beginEditGroup = useCallback((id: number, name: string) => {
    setEditingGroupId(id);
    setEditingGroupName(name);
    setMetaError(null);
    setMetaSuccess(null);
  }, []);

  const cancelEditGroup = useCallback(() => {
    setEditingGroupId(null);
    setEditingGroupName("");
  }, []);

  const handleSaveEditedGroup = useCallback(async () => {
    if (editingGroupId === null) {
      return;
    }
    const candidate = editingGroupName.trim();
    if (!candidate) {
      setMetaError("Epic group name is required.");
      return;
    }
    setMetaError(null);
    setMetaSuccess(null);
    try {
      await updateEpicGroup(editingGroupId, candidate);
      await loadEpicMetadataConfig();
      setMetaSuccess("Epic group updated.");
      setEditingGroupId(null);
      setEditingGroupName("");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update epic group.";
      setMetaError(message);
    }
  }, [editingGroupId, editingGroupName, loadEpicMetadataConfig]);

  const handleDeleteGroup = useCallback(
    async (id: number, name: string) => {
      if (!window.confirm(`Delete epic group "${name}"?`)) {
        return;
      }
      setMetaError(null);
      setMetaSuccess(null);
      try {
        await deleteEpicGroup(id);
        await loadEpicMetadataConfig();
        setMetaSuccess(`Epic group "${name}" deleted.`);
        if (editingGroupId === id) {
          setEditingGroupId(null);
          setEditingGroupName("");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to delete epic group.";
        setMetaError(message);
      }
    },
    [editingGroupId, loadEpicMetadataConfig],
  );

  const beginEditWorkType = useCallback((id: number, name: string) => {
    setEditingWorkTypeId(id);
    setEditingWorkTypeName(name);
    setMetaError(null);
    setMetaSuccess(null);
  }, []);

  const cancelEditWorkType = useCallback(() => {
    setEditingWorkTypeId(null);
    setEditingWorkTypeName("");
  }, []);

  const handleSaveEditedWorkType = useCallback(async () => {
    if (editingWorkTypeId === null) {
      return;
    }
    const candidate = editingWorkTypeName.trim();
    if (!candidate) {
      setMetaError("Work type name is required.");
      return;
    }
    setMetaError(null);
    setMetaSuccess(null);
    try {
      await updateWorkType(editingWorkTypeId, candidate);
      await loadEpicMetadataConfig();
      setMetaSuccess("Work type updated.");
      setEditingWorkTypeId(null);
      setEditingWorkTypeName("");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update work type.";
      setMetaError(message);
    }
  }, [editingWorkTypeId, editingWorkTypeName, loadEpicMetadataConfig]);

  const handleDeleteWorkType = useCallback(
    async (id: number, name: string) => {
      if (!window.confirm(`Delete work type "${name}"?`)) {
        return;
      }
      setMetaError(null);
      setMetaSuccess(null);
      try {
        await deleteWorkType(id);
        await loadEpicMetadataConfig();
        setMetaSuccess(`Work type "${name}" deleted.`);
        if (editingWorkTypeId === id) {
          setEditingWorkTypeId(null);
          setEditingWorkTypeName("");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to delete work type.";
        setMetaError(message);
      }
    },
    [editingWorkTypeId, loadEpicMetadataConfig],
  );

  const formatSyncMode = useCallback((mode: JiraSyncMode | null | undefined, requestedSince?: string | null): string => {
    if (mode === "since_date") {
      if (!requestedSince) return "Since Date";
      const requestedDate = new Date(requestedSince);
      if (Number.isNaN(requestedDate.getTime())) return `Since ${requestedSince}`;
      return `Since ${requestedDate.toLocaleDateString()}`;
    }
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
  const jiraBaseUrl = jiraStatus?.config.baseUrl ? jiraStatus.config.baseUrl.replace(/\/$/, "") : null;
  const sampleIssueText = jiraStatus?.sampleIssueKey ?? "none";
  const configuredBoard = jiraStatus?.configuredBoard;
  const configuredBoardUrl =
    configuredBoard?.url ??
    (jiraBaseUrl && jiraStatus?.config.boardId
      ? `${jiraBaseUrl}/secure/RapidBoard.jspa?rapidView=${jiraStatus.config.boardId}`
      : null);
  const configuredProjectUrl =
    jiraStatus?.configuredProjectUrl ??
    (jiraBaseUrl && jiraStatus?.config.projectKey
      ? `${jiraBaseUrl}/projects/${jiraStatus.config.projectKey}`
      : null);
  const sampleIssueUrl =
    jiraStatus?.sampleIssueUrl ??
    (jiraBaseUrl && jiraStatus?.sampleIssueKey
      ? `${jiraBaseUrl}/browse/${jiraStatus.sampleIssueKey}`
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
                <span className="sync-progress-row">
                  <span>Sync:</span>
                  {jiraSyncPercent !== null ? (
                    <>
                      <span
                        className="sync-progress-track"
                        role="progressbar"
                        aria-label="JIRA sync progress"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={jiraSyncPercent}
                      >
                        <span className="sync-progress-fill" style={{ width: `${jiraSyncPercent}%` }} />
                      </span>
                      <span className="sync-progress-percent">{jiraSyncPercent.toFixed(1).replace(/\.0$/, "")}%</span>
                    </>
                  ) : (
                    <span className="sync-progress-fallback">{jiraSyncProgressSummary}</span>
                  )}
                </span>
                {jiraSyncPercent !== null ? (
                  <>
                    <br />
                    <span className="sync-progress-note">{jiraSyncProgressSummary}</span>
                  </>
                ) : null}
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
            tone={jiraStatus?.config.projectKey ? "good" : "warn"}
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

      <Panel
        title="Epic Metadata Configuration"
        subtitle="Manage reusable epic groups and work types used by epic configuration."
      >
        {metaError ? <p className="sync-history-error">Epic metadata error: {metaError}</p> : null}
        {metaSuccess ? <p className="sync-history-loading">{metaSuccess}</p> : null}

        <div className="epic-meta-lookup-grid">
          <div className="epic-meta-lookup-card">
            <h4>Epic Groups</h4>
            <div className="epic-meta-add-row">
              <input
                type="text"
                value={groupDraft}
                onChange={(event) => setGroupDraft(event.target.value)}
                placeholder="Add epic group"
              />
              <button className="mini-sync-btn" onClick={handleAddEpicGroup} type="button">
                Add
              </button>
            </div>
            <div className="epic-meta-item-list">
              {epicLookup.groups.length === 0 ? <span className="chip">No groups</span> : null}
              {epicLookup.groups.map((group) => (
                <div key={group.id} className="epic-meta-item-row">
                  {editingGroupId === group.id ? (
                    <input
                      type="text"
                      value={editingGroupName}
                      onChange={(event) => setEditingGroupName(event.target.value)}
                      placeholder="Epic group name"
                    />
                  ) : (
                    <span className="chip">{group.name}</span>
                  )}
                  <div className="epic-meta-item-actions">
                    {editingGroupId === group.id ? (
                      <>
                        <button className="mini-sync-btn" onClick={handleSaveEditedGroup} type="button">
                          Save
                        </button>
                        <button className="mini-sync-btn" onClick={cancelEditGroup} type="button">
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="mini-sync-btn"
                          onClick={() => beginEditGroup(group.id, group.name)}
                          type="button"
                        >
                          Edit
                        </button>
                        <button
                          className="mini-sync-btn"
                          onClick={() => handleDeleteGroup(group.id, group.name)}
                          type="button"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="epic-meta-lookup-card">
            <h4>Work Types</h4>
            <div className="epic-meta-add-row">
              <input
                type="text"
                value={workTypeDraft}
                onChange={(event) => setWorkTypeDraft(event.target.value)}
                placeholder="Add work type"
              />
              <button className="mini-sync-btn" onClick={handleAddWorkType} type="button">
                Add
              </button>
            </div>
            <div className="epic-meta-item-list">
              {epicLookup.workTypes.length === 0 ? <span className="chip">No work types</span> : null}
              {epicLookup.workTypes.map((workType) => (
                <div key={workType.id} className="epic-meta-item-row">
                  {editingWorkTypeId === workType.id ? (
                    <input
                      type="text"
                      value={editingWorkTypeName}
                      onChange={(event) => setEditingWorkTypeName(event.target.value)}
                      placeholder="Work type name"
                    />
                  ) : (
                    <span className="chip">{workType.name}</span>
                  )}
                  <div className="epic-meta-item-actions">
                    {editingWorkTypeId === workType.id ? (
                      <>
                        <button className="mini-sync-btn" onClick={handleSaveEditedWorkType} type="button">
                          Save
                        </button>
                        <button className="mini-sync-btn" onClick={cancelEditWorkType} type="button">
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="mini-sync-btn"
                          onClick={() => beginEditWorkType(workType.id, workType.name)}
                          type="button"
                        >
                          Edit
                        </button>
                        <button
                          className="mini-sync-btn"
                          onClick={() => handleDeleteWorkType(workType.id, workType.name)}
                          type="button"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
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
                    Pull issues updated since the previous sync timestamp.
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

              <label className={`sync-option ${selectedSyncMode === "since_date" ? "selected" : ""}`}>
                <input
                  type="radio"
                  name="jira-sync-mode"
                  value="since_date"
                  checked={selectedSyncMode === "since_date"}
                  onChange={() => setSelectedSyncMode("since_date")}
                />
                <span>
                  <span className="sync-option-title">Sync Since Specific Date</span>
                  <span className="sync-option-desc">
                    Pull issues updated on or after a selected UTC date.
                  </span>
                </span>
              </label>
            </div>

            {selectedSyncMode === "since_date" ? (
              <label className="sync-date-field">
                <span>Start date (UTC)</span>
                <input
                  type="date"
                  value={selectedSinceDate}
                  max={todayLocalDate}
                  onChange={(event) => setSelectedSinceDate(event.target.value)}
                />
              </label>
            ) : null}

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
                  if (selectedSyncMode === "since_date" && !selectedSinceDate) {
                    setSyncError("Please select a start date for date-based sync.");
                    return;
                  }
                  triggerJiraSync(
                    selectedSyncMode,
                    selectedSyncMode === "since_date" ? selectedSinceDate : undefined,
                  ).catch(() => {
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
                      <td>{formatSyncMode(entry.syncMode, entry.requestedSince)}</td>
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
