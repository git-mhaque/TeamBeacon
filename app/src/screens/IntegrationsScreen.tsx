import { useCallback, useEffect, useMemo, useState } from "react";
import { MetricCard } from "../components/MetricCard";
import { Panel } from "../components/Panel";
import { StatusPill } from "../components/StatusPill";
import { fetchJiraIntegrationStatus, JiraIntegrationStatus } from "../lib/api";

export function IntegrationsScreen() {
  const [jiraStatus, setJiraStatus] = useState<JiraIntegrationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    loadJiraStatus().catch(() => {
      // loadJiraStatus already sets local error state.
    });
  }, [loadJiraStatus]);

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

  const storyPointsField = jiraStatus?.config.storyPointsField ?? "customfield_10004";
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
            hint={jiraHint}
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
            Epic Link <StatusPill tone="good" text="customfield_10014" />
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
    </div>
  );
}
