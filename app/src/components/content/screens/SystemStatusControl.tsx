import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CircleAlert, CircleCheck, DatabaseZap, RefreshCw, X } from "lucide-react";
import {
  fetchAiIntegrationStatus,
  fetchConfluenceIntegrationStatus,
  fetchJiraIntegrationStatus,
  fetchJiraSyncHistory,
  fetchJiraSyncStatus,
  startJiraSync,
  type AiIntegrationStatus,
  type ConfluenceIntegrationStatus,
  type JiraIntegrationStatus,
  type JiraSyncHistoryEntry,
  type JiraSyncMode,
  type JiraSyncStatus,
} from "../../../lib/api";

const SHORT_MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

type SystemStatusView = "overview" | "sync" | "history" | "diagnostics";

function formatDateOnlyLabel(value: string): string | null {
  const trimmed = value.trim();
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    const monthIndex = Number.parseInt(month, 10) - 1;
    if (monthIndex < 0 || monthIndex >= SHORT_MONTH_NAMES.length) return null;
    return `${day}-${SHORT_MONTH_NAMES[monthIndex]}-${year}`;
  }
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  return `${String(date.getDate()).padStart(2, "0")}-${SHORT_MONTH_NAMES[date.getMonth()]}-${date.getFullYear()}`;
}

function formatDateTimeLabel(value: string): string | null {
  const dateLabel = formatDateOnlyLabel(value);
  if (!dateLabel) return null;
  if (/^(\d{4})-(\d{2})-(\d{2})$/.test(value.trim())) return dateLabel;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return `${dateLabel}, ${parsed.toLocaleTimeString()}`;
}

function formatCheckedAt(value: string | null | undefined): string {
  if (!value) return "n/a";
  return formatDateTimeLabel(value) ?? value;
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "-";
  return formatDateTimeLabel(value) ?? value;
}

function formatSyncMode(mode: JiraSyncMode | null | undefined, requestedSince?: string | null): string {
  if (mode === "since_date") {
    if (!requestedSince) return "Since Date";
    return `Since ${formatDateOnlyLabel(requestedSince) ?? requestedSince}`;
  }
  return mode === "since_last" ? "Since Last" : "Full";
}

function checksSummary(checks: { ok: boolean }[] | undefined): string {
  if (!checks || checks.length === 0) return "No connectivity checks returned.";
  return `${checks.filter((check) => check.ok).length}/${checks.length} connectivity checks passed.`;
}

function formatAiProviderName(value: string | null | undefined): string {
  const normalized = (value ?? "").trim().toLowerCase();
  if (["oci", "oci-genai", "oci_genai"].includes(normalized)) return "OCI";
  if (normalized === "ollama") return "Ollama";
  if (normalized === "openai") return "OpenAI";
  return "AI";
}

function normalizeSyncStepLabel(value: string | null | undefined, phase: string | null | undefined): string {
  const normalizedPhase = (phase ?? "").trim().toLowerCase();
  if (normalizedPhase === "board") return "Board metadata";
  if (normalizedPhase === "releases") return "Releases";
  if (normalizedPhase === "issues") return "Issues and changelog";
  if (normalizedPhase === "sprints") return "Sprints";
  if (normalizedPhase === "active_sprint") return "Active sprint";
  if (normalizedPhase === "done") return "Finalize";
  const cleaned = (value ?? "").replace(/^syncing\s+/i, "").replace(/^reconciling\s+/i, "").trim();
  return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : "Preparing sync";
}

function localizeUtcTimestamps(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.replace(/\b(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+UTC\b/g, (match, datePart, timePart) => (
    formatDateTimeLabel(`${datePart}T${timePart}:00Z`) ?? match
  ));
}

function extractCount(message: string | null | undefined, pattern: RegExp): number | null {
  const match = pattern.exec(message ?? "");
  if (!match) return null;
  const capturedCount = match.slice(1).find((value) => value !== undefined);
  if (!capturedCount) return null;
  const count = Number.parseInt(capturedCount, 10);
  return Number.isFinite(count) ? count : null;
}

function viewTitle(view: SystemStatusView): string {
  if (view === "sync") return "Start JIRA sync";
  if (view === "history") return "JIRA sync history";
  if (view === "diagnostics") return "JIRA diagnostics";
  return "System status";
}

export function SystemStatusControl() {
  const todayLocalDate = useMemo(() => {
    const now = new Date();
    const shifted = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return shifted.toISOString().slice(0, 10);
  }, []);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<SystemStatusView>("overview");
  const [jiraStatus, setJiraStatus] = useState<JiraIntegrationStatus | null>(null);
  const [aiStatus, setAiStatus] = useState<AiIntegrationStatus | null>(null);
  const [confluenceStatus, setConfluenceStatus] = useState<ConfluenceIntegrationStatus | null>(null);
  const [jiraSyncStatus, setJiraSyncStatus] = useState<JiraSyncStatus | null>(null);
  const [jiraSyncHistory, setJiraSyncHistory] = useState<JiraSyncHistoryEntry[]>([]);
  const [jiraError, setJiraError] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [confluenceError, setConfluenceError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [jiraLoading, setJiraLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(true);
  const [confluenceLoading, setConfluenceLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedSyncMode, setSelectedSyncMode] = useState<JiraSyncMode>("since_last");
  const [selectedSinceDate, setSelectedSinceDate] = useState(todayLocalDate);

  const closeOverlay = useCallback(() => {
    setIsOpen(false);
    setView("overview");
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);

  const loadJiraStatus = useCallback(async () => {
    setJiraLoading(true);
    setJiraError(null);
    try {
      setJiraStatus(await fetchJiraIntegrationStatus());
    } catch (err) {
      setJiraError(err instanceof Error ? err.message : "Unknown JIRA status failure.");
      setJiraStatus(null);
    } finally {
      setJiraLoading(false);
    }
  }, []);

  const loadAiStatus = useCallback(async () => {
    setAiLoading(true);
    setAiError(null);
    try {
      setAiStatus(await fetchAiIntegrationStatus());
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "Unknown AI status failure.");
      setAiStatus(null);
    } finally {
      setAiLoading(false);
    }
  }, []);

  const loadConfluenceStatus = useCallback(async () => {
    setConfluenceLoading(true);
    setConfluenceError(null);
    try {
      setConfluenceStatus(await fetchConfluenceIntegrationStatus());
    } catch (err) {
      setConfluenceError(err instanceof Error ? err.message : "Unknown Confluence status failure.");
      setConfluenceStatus(null);
    } finally {
      setConfluenceLoading(false);
    }
  }, []);

  const loadJiraSyncStatus = useCallback(async () => {
    try {
      setJiraSyncStatus(await fetchJiraSyncStatus());
      setSyncError(null);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Unknown sync status failure.");
      setJiraSyncStatus(null);
    }
  }, []);

  const loadJiraSyncHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      setJiraSyncHistory(await fetchJiraSyncHistory(30));
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : "Unknown sync history failure.");
      setJiraSyncHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const checkSourceConnections = useCallback(() => {
    void loadJiraStatus();
    void loadAiStatus();
    void loadConfluenceStatus();
  }, [loadAiStatus, loadConfluenceStatus, loadJiraStatus]);

  useEffect(() => {
    checkSourceConnections();
    void loadJiraSyncStatus();
  }, [checkSourceConnections, loadJiraSyncStatus]);

  const isJiraSyncRunning = jiraSyncStatus?.state === "running";

  useEffect(() => {
    if (!isJiraSyncRunning) return undefined;
    const intervalId = window.setInterval(loadJiraSyncStatus, 1500);
    return () => window.clearInterval(intervalId);
  }, [isJiraSyncRunning, loadJiraSyncStatus]);

  useEffect(() => {
    if (!isOpen || view !== "history" || !isJiraSyncRunning) return undefined;
    const intervalId = window.setInterval(loadJiraSyncHistory, 2000);
    return () => window.clearInterval(intervalId);
  }, [isJiraSyncRunning, isOpen, loadJiraSyncHistory, view]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    headingRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeOverlay();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(sheetRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []);
      if (focusable.length === 0) {
        event.preventDefault();
        headingRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeOverlay, isOpen, view]);

  const connectionIssueCount = [
    Boolean(jiraError || (!jiraLoading && !jiraStatus?.connected)),
    Boolean(confluenceError || (!confluenceLoading && !confluenceStatus?.connected)),
    Boolean(aiError || (!aiLoading && !aiStatus?.connected)),
  ].filter(Boolean).length;
  const isChecking = jiraLoading || aiLoading || confluenceLoading;
  const syncPercent = typeof jiraSyncStatus?.percent === "number"
    ? Math.round(Math.max(0, Math.min(100, jiraSyncStatus.percent)) * 10) / 10
    : jiraSyncStatus?.state === "completed" ? 100 : null;
  const headerStatus = isJiraSyncRunning
    ? `JIRA syncing${syncPercent !== null ? ` · ${syncPercent}%` : ""}`
    : connectionIssueCount > 0
      ? `${connectionIssueCount} system${connectionIssueCount === 1 ? "" : "s"} need attention`
      : isChecking
        ? "Checking systems…"
        : "All systems connected";
  const headerTone = isJiraSyncRunning ? "is-syncing" : connectionIssueCount > 0 ? "is-risk" : isChecking ? "is-checking" : "is-good";
  const triggerLabel = `System status: ${headerStatus}`;

  const jiraValue = jiraError ? "Unavailable" : jiraLoading ? "Checking…" : jiraStatus?.connected ? "Connected" : "Check required";
  const confluenceValue = confluenceError ? "Unavailable" : confluenceLoading ? "Checking…" : confluenceStatus?.connected ? "Connected" : "Check required";
  const aiValue = aiError ? "Unavailable" : aiLoading ? "Checking…" : aiStatus?.connected ? "Connected" : "Check required";
  const jiraHint = jiraError ?? (jiraLoading ? "Testing JIRA API reachability and board access." : jiraStatus?.error ?? checksSummary(jiraStatus?.checks));
  const confluenceHint = confluenceError ?? (confluenceLoading ? "Testing Confluence REST API and PAT access." : confluenceStatus?.error ?? checksSummary(confluenceStatus?.checks));
  const aiProviderName = formatAiProviderName(aiStatus?.provider ?? aiStatus?.configuredProvider ?? aiStatus?.source);
  const aiModelName = typeof aiStatus?.config?.modelId === "string" && aiStatus.config.modelId.trim() ? aiStatus.config.modelId.trim() : "n/a";
  const aiHint = aiError ?? (aiLoading ? `Testing ${aiProviderName} connectivity.` : aiStatus?.error ?? checksSummary(aiStatus?.checks));
  const syncStepLabel = isJiraSyncRunning ? normalizeSyncStepLabel(jiraSyncStatus?.stepLabel, jiraSyncStatus?.phase) : null;
  const syncStepCounter = isJiraSyncRunning
    && typeof jiraSyncStatus?.currentStep === "number"
    && typeof jiraSyncStatus.totalSteps === "number"
    ? `Step ${jiraSyncStatus.currentStep} of ${jiraSyncStatus.totalSteps}`
    : null;
  const syncMessage = syncError
    ? `Sync status error: ${syncError}`
    : localizeUtcTimestamps(jiraSyncStatus?.error ?? jiraSyncStatus?.message)
      ?? (isJiraSyncRunning ? "Sync in progress." : jiraSyncStatus?.lastSyncedAt ? "Not currently syncing." : "Sync not started.");
  const changelogCount = extractCount(jiraSyncStatus?.message, /(\d+)\s+changelog events synced/i);
  const skippedChangelogCount = extractCount(
    jiraSyncStatus?.message,
    /(\d+)\s+changelog fetches skipped|Skipped changelog for (\d+) issue\(s\)/i,
  );
  const downloadedIssues = jiraSyncStatus?.downloadedIssues ?? 0;
  const issueProgressText = typeof jiraSyncStatus?.totalIssues === "number" && jiraSyncStatus.totalIssues > 0
    ? `${downloadedIssues} of ${jiraSyncStatus.totalIssues} issues downloaded`
    : downloadedIssues > 0 ? `${downloadedIssues} issues downloaded` : null;
  const candidateProgressText = typeof jiraSyncStatus?.candidateIssues === "number"
    && typeof jiraSyncStatus.candidateTotalIssues === "number"
    && jiraSyncStatus.candidateTotalIssues > 0
    ? `${jiraSyncStatus.candidateIssues} of ${jiraSyncStatus.candidateTotalIssues} candidates checked`
    : null;
  const hasStructuredSyncDetail = Boolean(issueProgressText || changelogCount !== null || candidateProgressText);
  const completedResult = jiraSyncStatus?.state === "completed"
    ? `${downloadedIssues} issue${downloadedIssues === 1 ? "" : "s"} synced`
    : null;

  const jiraBaseUrl = jiraStatus?.config.baseUrl?.replace(/\/$/, "") ?? null;
  const configuredBoard = jiraStatus?.configuredBoard;
  const configuredBoardText = configuredBoard?.id !== undefined
    ? `${configuredBoard.name} (${configuredBoard.id})`
    : jiraStatus?.config.boardId !== undefined && jiraStatus.config.boardId !== null
      ? `Board ${jiraStatus.config.boardId}`
      : "n/a";
  const configuredBoardUrl = configuredBoard?.url
    ?? (jiraBaseUrl && jiraStatus?.config.boardId ? `${jiraBaseUrl}/secure/RapidBoard.jspa?rapidView=${jiraStatus.config.boardId}` : null);
  const configuredProjectUrl = jiraStatus?.configuredProjectUrl
    ?? (jiraBaseUrl && jiraStatus?.config.projectKey ? `${jiraBaseUrl}/projects/${jiraStatus.config.projectKey}` : null);
  const sampleIssueUrl = jiraStatus?.sampleIssueUrl
    ?? (jiraBaseUrl && jiraStatus?.sampleIssueKey ? `${jiraBaseUrl}/browse/${jiraStatus.sampleIssueKey}` : null);
  const storyPointsField = jiraStatus?.config.storyPointsField ?? "customfield_10004";
  const epicLinkField = jiraStatus?.config.epicLinkField ?? "customfield_10902";
  const sprintFields = jiraStatus?.config.sprintFields?.length ? jiraStatus.config.sprintFields.join(", ") : "auto-detected";

  const openSyncView = () => {
    if (isJiraSyncRunning) return;
    setSelectedSyncMode("since_last");
    setSelectedSinceDate(todayLocalDate);
    setView("sync");
  };

  const openHistoryView = () => {
    setView("history");
    void loadJiraSyncHistory();
  };

  const triggerJiraSync = async () => {
    if (selectedSyncMode === "since_date" && !selectedSinceDate) {
      setSyncError("Please select a start date for date-based sync.");
      return;
    }
    setSyncError(null);
    try {
      setJiraSyncStatus(await startJiraSync(
        selectedSyncMode,
        selectedSyncMode === "since_date" ? selectedSinceDate : undefined,
      ));
      setView("overview");
      await loadJiraSyncStatus();
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Unknown sync start failure.");
    }
  };

  return (
    <div className="tb-system-status-control">
      <button
        ref={triggerRef}
        type="button"
        className={`tb-system-status-trigger ${headerTone}`}
        aria-label={triggerLabel}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls="tb-system-status-sheet"
        title={triggerLabel}
        onClick={() => setIsOpen(true)}
      >
        {connectionIssueCount > 0 ? <CircleAlert aria-hidden="true" /> : <DatabaseZap aria-hidden="true" />}
        <span className="tb-system-status-dot" aria-hidden="true" />
        <span className="tb-system-status-trigger-label">{headerStatus}</span>
      </button>
      <span className="tb-visually-hidden" role="status" aria-live="polite" aria-atomic="true">{headerStatus}</span>

      {isOpen ? (
        <div className="tb-system-status-layer">
          <div className="tb-system-status-backdrop" onClick={closeOverlay} />
          <div
            id="tb-system-status-sheet"
            ref={sheetRef}
            className="tb-system-status-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tb-system-status-heading"
          >
            <header className="tb-system-status-sheet-head">
              <div className="tb-system-status-sheet-title">
                {view !== "overview" ? (
                  <button type="button" className="tb-icon-btn" aria-label="Back to system status" onClick={() => setView("overview")}>
                    <ArrowLeft aria-hidden="true" />
                  </button>
                ) : null}
                <div>
                  <p>TeamBeacon operations</p>
                  <h2 id="tb-system-status-heading" ref={headingRef} tabIndex={-1}>{viewTitle(view)}</h2>
                </div>
              </div>
              <button type="button" className="tb-icon-btn" aria-label="Close system status" onClick={closeOverlay}>
                <X aria-hidden="true" />
              </button>
            </header>

            <div className="tb-system-status-sheet-body">
              {view === "overview" ? (
                <>
                  <div className="tb-system-status-summary">
                    <div className={`tb-system-status-summary-copy ${headerTone}`}>
                      {connectionIssueCount > 0 ? <CircleAlert aria-hidden="true" /> : <CircleCheck aria-hidden="true" />}
                      <div>
                        <strong>{headerStatus}</strong>
                        <span>Live connection health and JIRA data freshness.</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="tb-btn tb-btn-sm"
                      onClick={checkSourceConnections}
                      disabled={isChecking}
                    >
                      <RefreshCw aria-hidden="true" />
                      {isChecking ? "Checking…" : "Check now"}
                    </button>
                  </div>

                  <section className="tb-system-connection-card" aria-labelledby="tb-jira-connection-title">
                    <div className="tb-system-connection-head">
                      <div>
                        <span className={`tb-system-connection-indicator ${jiraError || (!jiraLoading && !jiraStatus?.connected) ? "is-risk" : jiraLoading ? "is-checking" : "is-good"}`} aria-hidden="true" />
                        <h3 id="tb-jira-connection-title">JIRA</h3>
                      </div>
                      <span className={`tb-status-pill ${jiraStatus?.connected && !jiraError ? "is-good" : jiraLoading ? "is-neutral" : "is-risk"}`}>{jiraValue}</span>
                    </div>
                    <p>{jiraHint}</p>
                    <small>Last checked: {formatCheckedAt(jiraStatus?.checkedAt)}</small>

                    <section className="tb-system-sync-card" aria-label="JIRA data sync">
                      <div className="tb-system-sync-head">
                        <div>
                          <span>Data sync</span>
                          <h4 id="tb-jira-sync-title">{isJiraSyncRunning ? "Sync in progress" : "JIRA data freshness"}</h4>
                        </div>
                        <span className={`tb-status-pill ${syncError || jiraSyncStatus?.state === "failed" ? "is-risk" : isJiraSyncRunning ? "is-warn" : jiraSyncStatus?.lastSyncedAt ? "is-good" : "is-neutral"}`}>
                          {syncError ? "Unavailable" : isJiraSyncRunning ? "Syncing" : jiraSyncStatus?.state === "failed" ? "Failed" : jiraSyncStatus?.lastSyncedAt ? "Success" : "Never synced"}
                        </span>
                      </div>
                      <dl className="tb-system-sync-facts">
                        <div><dt>Last sync</dt><dd>{formatCheckedAt(jiraSyncStatus?.lastSyncedAt)}</dd></div>
                        {jiraSyncStatus?.syncMode ? <div><dt>Mode</dt><dd>{formatSyncMode(jiraSyncStatus.syncMode, jiraSyncStatus.requestedSince)}</dd></div> : null}
                        {completedResult ? <div><dt>Result</dt><dd>{completedResult}</dd></div> : null}
                      </dl>

                      {isJiraSyncRunning ? (
                        <div className="tb-system-sync-progress">
                          <div className="tb-system-sync-progress-label">
                            <span>{syncStepCounter ? `${syncStepCounter}: ` : ""}{syncStepLabel}</span>
                            {syncPercent !== null ? <strong>{syncPercent}%</strong> : null}
                          </div>
                          <span
                            className={`tb-sync-progress-track${syncPercent === null ? " is-indeterminate" : ""}`}
                            role="progressbar"
                            aria-label="JIRA issue sync progress"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={syncPercent ?? undefined}
                            aria-valuetext={syncPercent === null ? "In progress" : undefined}
                          >
                            <span className="tb-sync-progress-fill" style={syncPercent !== null ? { width: `${syncPercent}%` } : undefined} />
                          </span>
                          <div className="tb-system-sync-detail-list">
                            {issueProgressText ? <span>{issueProgressText}</span> : null}
                            {changelogCount !== null ? <span>{changelogCount} changelog events captured</span> : null}
                            {candidateProgressText ? <span>{candidateProgressText}</span> : null}
                          </div>
                        </div>
                      ) : null}

                      {skippedChangelogCount !== null ? (
                        <p className="tb-system-sync-warning">{skippedChangelogCount} issue changelogs skipped after transient JIRA errors.</p>
                      ) : null}
                      {(syncError || jiraSyncStatus?.state === "failed" || (isJiraSyncRunning && !hasStructuredSyncDetail)) ? (
                        <p className="tb-system-sync-message">{syncMessage}</p>
                      ) : null}

                      <div className="tb-card-actions tb-system-sync-actions">
                        <button type="button" className="tb-btn tb-btn-sm" onClick={openSyncView} disabled={isJiraSyncRunning}>Sync data</button>
                        <button type="button" className="tb-btn tb-btn-sm" onClick={openHistoryView}>History</button>
                        <button type="button" className="tb-btn tb-btn-sm" onClick={() => setView("diagnostics")}>Diagnostics</button>
                      </div>
                    </section>
                  </section>

                  <section className="tb-system-connection-card" aria-labelledby="tb-confluence-connection-title">
                    <div className="tb-system-connection-head">
                      <div>
                        <span className={`tb-system-connection-indicator ${confluenceError || (!confluenceLoading && !confluenceStatus?.connected) ? "is-risk" : confluenceLoading ? "is-checking" : "is-good"}`} aria-hidden="true" />
                        <h3 id="tb-confluence-connection-title">Confluence</h3>
                      </div>
                      <span className={`tb-status-pill ${confluenceStatus?.connected && !confluenceError ? "is-good" : confluenceLoading ? "is-neutral" : "is-risk"}`}>{confluenceValue}</span>
                    </div>
                    <p>{confluenceHint}</p>
                    <small>Last checked: {formatCheckedAt(confluenceStatus?.checkedAt)}</small>
                  </section>

                  <section className="tb-system-connection-card" aria-labelledby="tb-ai-connection-title">
                    <div className="tb-system-connection-head">
                      <div>
                        <span className={`tb-system-connection-indicator ${aiError || (!aiLoading && !aiStatus?.connected) ? "is-risk" : aiLoading ? "is-checking" : "is-good"}`} aria-hidden="true" />
                        <h3 id="tb-ai-connection-title">AI model</h3>
                      </div>
                      <span className={`tb-status-pill ${aiStatus?.connected && !aiError ? "is-good" : aiLoading ? "is-neutral" : "is-risk"}`}>{aiValue}</span>
                    </div>
                    <p>{aiHint}</p>
                    <small>Last checked: {formatCheckedAt(aiStatus?.checkedAt)}</small>
                    <dl className="tb-system-inline-facts">
                      <div><dt>Provider</dt><dd>{aiProviderName}</dd></div>
                      <div><dt>Model</dt><dd>{aiModelName}</dd></div>
                    </dl>
                  </section>
                </>
              ) : null}

              {view === "sync" ? (
                <div className="tb-system-status-subview">
                  <p className="tb-muted-note">Choose how much JIRA data to refresh before starting the sync.</p>
                  <div className="tb-sync-option-list">
                    {([
                      ["since_last", "Sync since last timestamp", "Pull issues updated since the previous sync."],
                      ["full", "Full sync", "Download the entire configured board dataset."],
                      ["since_date", "Sync since specific date", "Pull issues updated on or after a selected UTC date."],
                    ] as const).map(([mode, label, note]) => (
                      <label key={mode} className={`tb-sync-option ${selectedSyncMode === mode ? "is-selected" : ""}`}>
                        <input type="radio" name="jira-sync-mode" value={mode} checked={selectedSyncMode === mode} onChange={() => setSelectedSyncMode(mode)} />
                        <span><strong>{label}</strong><small>{note}</small></span>
                      </label>
                    ))}
                  </div>
                  {selectedSyncMode === "since_date" ? (
                    <label className="tb-sync-date-field">
                      <span>Start date (UTC)</span>
                      <input type="date" value={selectedSinceDate} max={todayLocalDate} onInput={(event) => setSelectedSinceDate((event.currentTarget as HTMLInputElement).value)} />
                    </label>
                  ) : null}
                  {syncError ? <p className="tb-error-note">{syncError}</p> : null}
                  <p className="tb-muted-note">Last synced: {formatCheckedAt(jiraSyncStatus?.lastSyncedAt)}.</p>
                  <footer className="tb-system-status-subview-actions">
                    <button type="button" className="tb-btn tb-btn-primary" onClick={() => triggerJiraSync()}>Start sync</button>
                  </footer>
                </div>
              ) : null}

              {view === "history" ? (
                <div className="tb-system-status-subview">
                  <div className="tb-system-status-subview-toolbar">
                    <p className="tb-muted-note">The 30 most recent JIRA data sync runs.</p>
                    <button type="button" className="tb-btn tb-btn-sm" onClick={() => loadJiraSyncHistory()}><RefreshCw aria-hidden="true" />Refresh</button>
                  </div>
                  {historyError ? <p className="tb-error-note">Failed to load history: {historyError}</p> : null}
                  {historyLoading ? <p className="tb-muted-note">Loading sync history…</p> : null}
                  <div className="tb-sync-history-wrap">
                    <table className="tb-sync-history-table">
                      <thead><tr><th>Date</th><th>Board</th><th>Mode</th><th>Sprints</th><th>Issues</th><th>Status</th></tr></thead>
                      <tbody>
                        {jiraSyncHistory.map((entry) => (
                          <tr key={entry.id}>
                            <td>{formatTimestamp(entry.finishedAt ?? entry.startedAt)}</td>
                            <td>{entry.boardName ?? (entry.boardId ? `Board ${entry.boardId}` : "-")}</td>
                            <td>{formatSyncMode(entry.syncMode, entry.requestedSince)}</td>
                            <td>{entry.sprintsSynced}</td><td>{entry.issuesSynced}</td><td>{entry.status}</td>
                          </tr>
                        ))}
                        {!historyLoading && jiraSyncHistory.length === 0 ? <tr><td colSpan={6}>No sync history available yet.</td></tr> : null}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}

              {view === "diagnostics" ? (
                <div className="tb-system-status-subview">
                  <p className="tb-muted-note">Board, project, and field-mapping checks from the live JIRA response.</p>
                  <div className="tb-system-diagnostics-grid">
                    <article><h3>Configured board</h3><strong>{configuredBoardUrl ? <a href={configuredBoardUrl} target="_blank" rel="noopener noreferrer">{configuredBoardText}</a> : configuredBoardText}</strong></article>
                    <article><h3>Sample issue</h3><strong>{sampleIssueUrl && jiraStatus?.sampleIssueKey ? <a href={sampleIssueUrl} target="_blank" rel="noopener noreferrer">{jiraStatus.sampleIssueKey}</a> : jiraStatus?.sampleIssueKey ?? "none"}</strong></article>
                    <article><h3>Configured project</h3><strong>{configuredProjectUrl && jiraStatus?.config.projectKey ? <a href={configuredProjectUrl} target="_blank" rel="noopener noreferrer">{jiraStatus.config.projectKey}</a> : jiraStatus?.config.projectKey ?? "n/a"}</strong></article>
                  </div>
                  <section className="tb-system-field-mapping" aria-labelledby="tb-field-mapping-heading">
                    <div><h3 id="tb-field-mapping-heading">Field mapping readiness</h3><span className={`tb-status-pill ${jiraStatus?.connected ? "is-good" : "is-warn"}`}>{jiraStatus?.connected ? "JIRA mapping loaded" : "Pending live check"}</span></div>
                    <dl>
                      <div><dt>Story points</dt><dd>{storyPointsField}</dd></div>
                      <div><dt>Sprint fields</dt><dd>{sprintFields}</dd></div>
                      <div><dt>Epic link</dt><dd>{epicLinkField}</dd></div>
                    </dl>
                  </section>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
