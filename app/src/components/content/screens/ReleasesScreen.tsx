import { h } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  fetchReleaseRefreshResult,
  fetchReleaseRefreshStatus,
  ReleaseRefreshSourceStatus,
  ReleaseRefreshStatus,
  startReleaseRefresh,
} from "../../../lib/api";

type ReleaseSourceConfig = {
  id: number;
  confluenceUrl: string;
  prompt: string;
};

function createEmptySource(id: number): ReleaseSourceConfig {
  return {
    id,
    confluenceUrl: "",
    prompt: "",
  };
}

function formatRefreshTimestamp(value: string | null | undefined): string {
  if (!value) return "Not generated yet";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Date(parsed).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function normalizePercent(value: number | null | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

function sourceStateTone(state: ReleaseRefreshSourceStatus["state"] | undefined): string {
  if (state === "completed") return "tb-value-good";
  if (state === "failed") return "tb-value-risk";
  if (state === "fetching" || state === "processing") return "tb-value-warn";
  return "tb-value-warn";
}

export function ReleasesScreen() {
  const [isConfigureOpen, setIsConfigureOpen] = useState(false);
  const [savedSources, setSavedSources] = useState<ReleaseSourceConfig[]>([]);
  const [savedOverallPrompt, setSavedOverallPrompt] = useState("");

  const [draftSources, setDraftSources] = useState<ReleaseSourceConfig[]>([]);
  const [draftOverallPrompt, setDraftOverallPrompt] = useState("");
  const [nextSourceId, setNextSourceId] = useState(1);
  const [refreshStatus, setRefreshStatus] = useState<ReleaseRefreshStatus | null>(null);
  const [refreshResultHtml, setRefreshResultHtml] = useState<string | null>(null);
  const [refreshResultGeneratedAt, setRefreshResultGeneratedAt] = useState<string | null>(null);
  const [refreshResultSources, setRefreshResultSources] = useState<ReleaseRefreshSourceStatus[]>([]);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [loadingRefreshResult, setLoadingRefreshResult] = useState(false);
  const [refreshSubmitting, setRefreshSubmitting] = useState(false);
  const pollTimerRef = useRef<number | null>(null);

  const openConfigure = useCallback(() => {
    if (savedSources.length > 0) {
      setDraftSources(savedSources.map((source) => ({ ...source })));
    } else {
      setDraftSources([createEmptySource(nextSourceId)]);
      setNextSourceId((value) => value + 1);
    }
    setDraftOverallPrompt(savedOverallPrompt);
    setIsConfigureOpen(true);
  }, [nextSourceId, savedOverallPrompt, savedSources]);

  const closeConfigure = useCallback(() => {
    setIsConfigureOpen(false);
  }, []);

  const addDraftSource = useCallback(() => {
    setDraftSources((sources) => [...sources, createEmptySource(nextSourceId)]);
    setNextSourceId((value) => value + 1);
  }, [nextSourceId]);

  const removeDraftSource = useCallback((id: number) => {
    setDraftSources((sources) => {
      if (sources.length <= 1) {
        return [createEmptySource(id)];
      }
      return sources.filter((source) => source.id !== id);
    });
  }, []);

  const updateDraftSource = useCallback((id: number, field: "confluenceUrl" | "prompt", value: string) => {
    setDraftSources((sources) => sources.map((source) => (
      source.id === id ? { ...source, [field]: value } : source
    )));
  }, []);

  const saveConfigure = useCallback(() => {
    const normalizedSources = draftSources
      .map((source) => ({
        ...source,
        confluenceUrl: source.confluenceUrl.trim(),
        prompt: source.prompt.trim(),
      }))
      .filter((source) => source.confluenceUrl);
    setSavedSources(normalizedSources);
    setSavedOverallPrompt(draftOverallPrompt.trim());
    setIsConfigureOpen(false);
  }, [draftOverallPrompt, draftSources]);

  const hasRunnableConfig = savedSources.some((source) => source.confluenceUrl.trim().length > 0);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const loadRefreshResult = useCallback(async () => {
    setLoadingRefreshResult(true);
    try {
      const payload = await fetchReleaseRefreshResult();
      setRefreshResultHtml(payload.html ?? null);
      setRefreshResultGeneratedAt(payload.generatedAt ?? null);
      setRefreshResultSources(payload.sources ?? []);
      if (payload.error) {
        setRefreshError(payload.error);
      } else {
        setRefreshError(null);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load release refresh result.";
      setRefreshError(message);
    } finally {
      setLoadingRefreshResult(false);
    }
  }, []);

  const pollRefreshStatus = useCallback(async () => {
    try {
      const status = await fetchReleaseRefreshStatus();
      setRefreshStatus(status);
      if (status.state === "running") {
        return;
      }

      stopPolling();
      if (status.state === "completed" || status.state === "failed") {
        await loadRefreshResult();
      }
    } catch (error) {
      stopPolling();
      const message = error instanceof Error ? error.message : "Unable to check release refresh status.";
      setRefreshError(message);
    }
  }, [loadRefreshResult, stopPolling]);

  const startPolling = useCallback(() => {
    stopPolling();
    void pollRefreshStatus();
    pollTimerRef.current = window.setInterval(() => {
      void pollRefreshStatus();
    }, 2000);
  }, [pollRefreshStatus, stopPolling]);

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      try {
        const status = await fetchReleaseRefreshStatus();
        if (cancelled) return;
        setRefreshStatus(status);

        if (status.state === "running") {
          startPolling();
          return;
        }

        if (status.state === "completed" || status.state === "failed") {
          await loadRefreshResult();
        }
      } catch {
        // Release refresh is optional; avoid surfacing initial load noise.
      }
    };

    void hydrate();

    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [loadRefreshResult, startPolling, stopPolling]);

  const runRefresh = useCallback(async () => {
    const sources = savedSources
      .map((source) => ({
        confluenceUrl: source.confluenceUrl.trim(),
        prompt: source.prompt.trim(),
      }))
      .filter((source) => source.confluenceUrl);

    if (sources.length === 0) {
      setRefreshError("Add at least one Confluence source URL before running Refresh.");
      return;
    }

    setRefreshSubmitting(true);
    setRefreshError(null);
    setRefreshResultHtml(null);
    setRefreshResultGeneratedAt(null);
    setRefreshResultSources([]);

    try {
      const status = await startReleaseRefresh({
        sources,
        overallPrompt: savedOverallPrompt.trim() || undefined,
      });
      setRefreshStatus(status);

      if (status.state === "running") {
        startPolling();
      } else if (status.state === "completed" || status.state === "failed") {
        await loadRefreshResult();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to start release refresh.";
      setRefreshError(message);
    } finally {
      setRefreshSubmitting(false);
    }
  }, [loadRefreshResult, savedOverallPrompt, savedSources, startPolling]);

  const overallPromptPreview = useMemo(() => {
    const value = savedOverallPrompt.trim();
    if (!value) {
      return "Not configured";
    }
    return value.length > 160 ? `${value.slice(0, 160)}...` : value;
  }, [savedOverallPrompt]);

  const refreshSourceMap = useMemo(() => {
    const map = new Map<string, ReleaseRefreshSourceStatus>();
    for (const row of refreshResultSources) {
      map.set(row.confluenceUrl, row);
    }
    if (refreshStatus?.sources) {
      for (const row of refreshStatus.sources) {
        map.set(row.confluenceUrl, row);
      }
    }
    return map;
  }, [refreshResultSources, refreshStatus]);

  const isRefreshRunning = refreshStatus?.state === "running";
  const refreshPercent = normalizePercent(refreshStatus?.percent);
  const refreshSummaryMessage = refreshStatus?.message || "Run Refresh to generate release insights.";
  const statusLabel = useMemo(() => {
    if (!refreshStatus) {
      return hasRunnableConfig ? "Ready" : "Configuration Needed";
    }
    if (refreshStatus.state === "running") return "Running";
    if (refreshStatus.state === "completed") return "Completed";
    if (refreshStatus.state === "failed") return "Failed";
    return hasRunnableConfig ? "Ready" : "Configuration Needed";
  }, [hasRunnableConfig, refreshStatus]);

  const statusClass = useMemo(() => {
    if (!refreshStatus) {
      return hasRunnableConfig ? "tb-value-good" : "tb-value-warn";
    }
    if (refreshStatus.state === "completed") return "tb-value-good";
    if (refreshStatus.state === "failed") return "tb-value-risk";
    if (refreshStatus.state === "running") return "tb-value-warn";
    return hasRunnableConfig ? "tb-value-good" : "tb-value-warn";
  }, [hasRunnableConfig, refreshStatus]);

  return (
    <div class="tb-screen-grid">
      <section class="tb-panel">
        <header class="tb-panel-header">
          <div>
            <h3>Release Configuration</h3>
            <p class="tb-muted-note">Configure Confluence release-note sources and prompts for Release Insights.</p>
          </div>
          <div class="tb-panel-header-actions">
            <button type="button" class="tb-btn" onClick={openConfigure}>
              Configure
            </button>
            <button
              type="button"
              class="tb-btn"
              onClick={() => void runRefresh()}
              disabled={!hasRunnableConfig || isRefreshRunning || refreshSubmitting}
            >
              {isRefreshRunning ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </header>
        <div class="tb-metrics-grid tb-three-up">
          <article class="tb-metric-card">
            <h4>Confluence Sources</h4>
            <strong class="tb-value">{savedSources.length}</strong>
            <p>Configured release-note page URLs.</p>
          </article>
          <article class="tb-metric-card">
            <h4>Overall Prompt</h4>
            <strong class={`tb-value ${savedOverallPrompt.trim() ? "tb-value-good" : "tb-value-warn"}`}>
              {savedOverallPrompt.trim() ? "Configured" : "Not Set"}
            </strong>
            <p>Global guidance applied across all sources.</p>
          </article>
          <article class="tb-metric-card">
            <h4>Status</h4>
            <strong class={`tb-value ${statusClass}`}>
              {statusLabel}
            </strong>
            <p>{isRefreshRunning ? "Release refresh is currently running." : "Release refresh state from backend."}</p>
          </article>
        </div>

        <div class="tb-release-refresh-status">
          <div class="tb-release-refresh-head">
            <strong>{refreshSummaryMessage}</strong>
            <span>{refreshStatus?.percent != null ? `${refreshPercent.toFixed(1).replace(/\.0$/, "")}%` : "n/a"}</span>
          </div>
          <div class="tb-release-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={refreshPercent}>
            <div class="tb-release-progress-fill" style={{ width: `${refreshPercent}%` }} />
          </div>
          <p class="tb-muted-note">
            Phase: {refreshStatus?.phase ?? "idle"} | Started: {formatRefreshTimestamp(refreshStatus?.startedAt)}
          </p>
          {refreshStatus?.error ? <p class="tb-error-note">Refresh status error: {refreshStatus.error}</p> : null}
          {refreshError ? <p class="tb-error-note">Refresh error: {refreshError}</p> : null}
        </div>
      </section>

      <section class="tb-panel">
        <header class="tb-panel-header">
          <div>
            <h3>Configured Sources</h3>
            <p class="tb-muted-note">Saved source-level prompts and overall release guidance.</p>
          </div>
        </header>
        {savedSources.length === 0 ? (
          <div class="tb-summary">
            No Confluence source URLs configured yet. Use Configure to add release-note pages and prompts.
          </div>
        ) : (
          <div class="tb-release-source-list">
            {savedSources.map((source, index) => (
              <article key={source.id} class="tb-release-source-card">
                <h4>Source {index + 1}</h4>
                <p>
                  URL:{" "}
                  <a class="tb-external-link" href={source.confluenceUrl} target="_blank" rel="noopener noreferrer">
                    {source.confluenceUrl}
                  </a>
                </p>
                <p>Prompt: {source.prompt || "Not provided"}</p>
                {refreshSourceMap.has(source.confluenceUrl) ? (
                  <p>
                    Latest state:{" "}
                    <strong class={sourceStateTone(refreshSourceMap.get(source.confluenceUrl)?.state)}>
                      {refreshSourceMap.get(source.confluenceUrl)?.state ?? "unknown"}
                    </strong>
                  </p>
                ) : null}
                {refreshSourceMap.get(source.confluenceUrl)?.error ? (
                  <p class="tb-error-note">Source error: {refreshSourceMap.get(source.confluenceUrl)?.error}</p>
                ) : null}
              </article>
            ))}
          </div>
        )}
        <p class="tb-muted-note">Overall Prompt: {overallPromptPreview}</p>
      </section>

      <section class="tb-panel">
        <header class="tb-panel-header">
          <div>
            <h3>Release Output</h3>
            <p class="tb-muted-note">Generated HTML output from configured Confluence sources and prompts.</p>
          </div>
        </header>

        {loadingRefreshResult ? (
          <div class="tb-summary is-loading">Loading release output...</div>
        ) : refreshResultHtml ? (
          <article class="tb-release-output" dangerouslySetInnerHTML={{ __html: refreshResultHtml }} />
        ) : (
          <div class="tb-summary">
            No generated release output yet. Run Refresh after configuring at least one Confluence source URL.
          </div>
        )}

        <p class="tb-muted-note">Generated: {formatRefreshTimestamp(refreshResultGeneratedAt)}</p>

        {refreshResultSources.some((source) => source.summary) ? (
          <div class="tb-release-output-sources">
            <h4>Source Summaries</h4>
            {refreshResultSources
              .filter((source) => source.summary)
              .map((source) => (
                <article key={source.id} class="tb-release-source-card">
                  <h4>{source.title || `Source ${source.id}`}</h4>
                  <p>
                    <a
                      class="tb-external-link"
                      href={source.resolvedUrl || source.confluenceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {source.resolvedUrl || source.confluenceUrl}
                    </a>
                  </p>
                  <p>{source.summary}</p>
                </article>
              ))}
          </div>
        ) : null}
      </section>

      {isConfigureOpen ? (
        <div class="tb-modal-layer" role="dialog" aria-modal="true" aria-label="Configure Release Insights">
          <div class="tb-modal-backdrop" onClick={closeConfigure} />
          <div class="tb-modal tb-modal-wide">
            <header class="tb-modal-head">
              <h3>Configure Release Insights</h3>
              <button type="button" class="tb-btn tb-btn-sm" onClick={closeConfigure}>
                Close
              </button>
            </header>

            <p class="tb-muted-note">
              Add one or more Confluence page URLs, each with a source-level prompt.
            </p>

            <div class="tb-release-config-list">
              {draftSources.map((source, index) => (
                <article key={source.id} class="tb-release-config-card">
                  <header class="tb-panel-header">
                    <div>
                      <h4>Source {index + 1}</h4>
                    </div>
                    <button
                      type="button"
                      class="tb-btn tb-btn-sm tb-btn-danger"
                      onClick={() => removeDraftSource(source.id)}
                    >
                      Remove
                    </button>
                  </header>

                  <label class="tb-modal-field">
                    <span>Confluence Page URL</span>
                    <input
                      type="url"
                      value={source.confluenceUrl}
                      onInput={(event) =>
                        updateDraftSource(source.id, "confluenceUrl", (event.currentTarget as HTMLInputElement).value)}
                      placeholder="https://gbuconfluence.oraclecorp.com/display/SPACE/Page+Title"
                    />
                  </label>

                  <label class="tb-modal-field">
                    <span>Source Prompt</span>
                    <textarea
                      value={source.prompt}
                      onInput={(event) =>
                        updateDraftSource(source.id, "prompt", (event.currentTarget as HTMLTextAreaElement).value)}
                      placeholder="What should TeamBeacon extract from this page for release insights?"
                    />
                  </label>
                </article>
              ))}
            </div>

            <div class="tb-action-row">
              <button type="button" class="tb-btn tb-btn-sm" onClick={addDraftSource}>
                Add Source
              </button>
            </div>

            <label class="tb-modal-field">
              <span>Overall Prompt</span>
              <textarea
                value={draftOverallPrompt}
                onInput={(event) => setDraftOverallPrompt((event.currentTarget as HTMLTextAreaElement).value)}
                placeholder="Shared release-level prompt applied alongside source prompts."
              />
            </label>

            <footer class="tb-modal-actions">
              <button type="button" class="tb-btn" onClick={closeConfigure}>
                Cancel
              </button>
              <button type="button" class="tb-btn tb-btn-primary" onClick={saveConfigure}>
                Save
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
