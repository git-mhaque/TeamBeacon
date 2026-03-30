import { h } from "preact";
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import {
  fetchJiraIntegrationStatus,
  fetchOciGenAiIntegrationStatus,
  JiraIntegrationStatus,
  OciGenAiIntegrationStatus,
} from "../../../lib/api";

function formatCheckedAt(value: string | null | undefined): string {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function checksSummary(checks: { ok: boolean }[] | undefined): string {
  if (!checks || checks.length === 0) return "No connectivity checks returned.";
  const passed = checks.filter((check) => check.ok).length;
  return `${passed}/${checks.length} connectivity checks passed.`;
}

export function IntegrationsScreen() {
  const [jiraStatus, setJiraStatus] = useState<JiraIntegrationStatus | null>(null);
  const [ociStatus, setOciStatus] = useState<OciGenAiIntegrationStatus | null>(null);
  const [jiraError, setJiraError] = useState<string | null>(null);
  const [ociError, setOciError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [jiraResult, ociResult] = await Promise.allSettled([
      fetchJiraIntegrationStatus(),
      fetchOciGenAiIntegrationStatus(),
    ]);

    if (jiraResult.status === "fulfilled") {
      setJiraStatus(jiraResult.value);
      setJiraError(null);
    } else {
      setJiraStatus(null);
      setJiraError(jiraResult.reason instanceof Error ? jiraResult.reason.message : "Unknown JIRA status failure.");
    }

    if (ociResult.status === "fulfilled") {
      setOciStatus(ociResult.value);
      setOciError(null);
    } else {
      setOciStatus(null);
      setOciError(ociResult.reason instanceof Error ? ociResult.reason.message : "Unknown OCI GenAI status failure.");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh().catch(() => {
      // refresh already updates local state.
    });
  }, [refresh]);

  const jiraValue = useMemo(() => {
    if (jiraError) return "Unavailable";
    if (loading && !jiraStatus) return "Checking...";
    return jiraStatus?.connected ? "Connected" : "Check Required";
  }, [jiraError, jiraStatus, loading]);

  const ociValue = useMemo(() => {
    if (ociError) return "Unavailable";
    if (loading && !ociStatus) return "Checking...";
    return ociStatus?.connected ? "Connected" : "Check Required";
  }, [ociError, ociStatus, loading]);

  const jiraToneClass = jiraError ? "tb-value-risk" : jiraStatus?.connected ? "tb-value-good" : "tb-value-warn";
  const ociToneClass = ociError ? "tb-value-risk" : ociStatus?.connected ? "tb-value-good" : "tb-value-warn";

  return (
    <div class="tb-screen-grid">
      <section class="tb-panel">
        <header class="tb-panel-header">
          <div>
            <h3>Source Connections</h3>
            <p>Live connectivity checks from OJET frontend to TeamBeacon backend integrations.</p>
          </div>
          <button type="button" class="tb-btn tb-btn-primary" onClick={() => refresh()}>
            {loading ? "Checking..." : "Check Now"}
          </button>
        </header>
        <div class="tb-metrics-grid tb-three-up">
          <article class="tb-metric-card">
            <h4>JIRA Connection</h4>
            <strong class={`tb-value ${jiraToneClass}`}>{jiraValue}</strong>
            <p>{jiraError ?? checksSummary(jiraStatus?.checks)}</p>
            <p>Last checked: {formatCheckedAt(jiraStatus?.checkedAt)}</p>
            <p>Project: {jiraStatus?.config.projectKey ?? "n/a"}</p>
          </article>

          <article class="tb-metric-card">
            <h4>OCI GenAI Connection</h4>
            <strong class={`tb-value ${ociToneClass}`}>{ociValue}</strong>
            <p>{ociError ?? checksSummary(ociStatus?.checks)}</p>
            <p>Last checked: {formatCheckedAt(ociStatus?.checkedAt)}</p>
            <p>Model: {ociStatus?.config.modelId ?? "n/a"}</p>
          </article>

          <article class="tb-metric-card">
            <h4>Confluence Connection</h4>
            <strong class="tb-value tb-value-warn">Pending</strong>
            <p>Confluence connectivity migration is queued for the next OJET slice.</p>
            <p>Status endpoint: not wired in this migration baseline.</p>
          </article>
        </div>
      </section>

      <section class="tb-panel">
        <header class="tb-panel-header">
          <div>
            <h3>Migration Status</h3>
            <p>Current OJET migration baseline implemented in this slice.</p>
          </div>
          <span class="tb-chip">Integrations: Live</span>
        </header>
        <ul class="tb-list">
          <li>OJET app shell created with TeamBeacon navigation and screen container.</li>
          <li>Integrations screen is wired to live JIRA and OCI GenAI status endpoints.</li>
          <li>Remaining screens are scaffolded for phased migration to OJET patterns.</li>
          <li>Backend API base uses `http://127.0.0.1:8000` by default in this baseline.</li>
        </ul>
      </section>
    </div>
  );
}

