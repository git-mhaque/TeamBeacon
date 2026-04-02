import { h } from "preact";
import { useCallback, useMemo, useState } from "preact/hooks";

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

export function ReleasesScreen() {
  const [isConfigureOpen, setIsConfigureOpen] = useState(false);
  const [savedSources, setSavedSources] = useState<ReleaseSourceConfig[]>([]);
  const [savedOverallPrompt, setSavedOverallPrompt] = useState("");

  const [draftSources, setDraftSources] = useState<ReleaseSourceConfig[]>([]);
  const [draftOverallPrompt, setDraftOverallPrompt] = useState("");
  const [nextSourceId, setNextSourceId] = useState(1);

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
      .filter((source) => source.confluenceUrl || source.prompt);
    setSavedSources(normalizedSources);
    setSavedOverallPrompt(draftOverallPrompt.trim());
    setIsConfigureOpen(false);
  }, [draftOverallPrompt, draftSources]);

  const hasSavedConfig = savedSources.length > 0 || Boolean(savedOverallPrompt.trim());
  const overallPromptPreview = useMemo(() => {
    const value = savedOverallPrompt.trim();
    if (!value) {
      return "Not configured";
    }
    return value.length > 160 ? `${value.slice(0, 160)}...` : value;
  }, [savedOverallPrompt]);

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
            <button type="button" class="tb-btn" onClick={() => {}}>
              Refresh
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
            <strong class={`tb-value ${hasSavedConfig ? "tb-value-good" : "tb-value-warn"}`}>
              {hasSavedConfig ? "Ready" : "Configuration Needed"}
            </strong>
            <p>Refresh action will be wired in a follow-up change.</p>
          </article>
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
              </article>
            ))}
          </div>
        )}
        <p class="tb-muted-note">Overall Prompt: {overallPromptPreview}</p>
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
