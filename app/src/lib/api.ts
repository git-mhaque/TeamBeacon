export type IntegrationCheck = {
  name: string;
  ok: boolean;
  detail: string;
};

export type JiraIntegrationStatus = {
  source: "jira";
  connected: boolean;
  checkedAt: string;
  config: {
    baseUrl?: string;
    projectKey?: string | null;
    boardId?: number | null;
    storyPointsField?: string;
    authMode?: string;
  };
  checks: IntegrationCheck[];
  metrics: {
    boardCount?: number;
    projectSampleIssueCount?: number;
  };
  sampleIssueKey?: string | null;
  sampleIssueUrl?: string | null;
  configuredProjectUrl?: string | null;
  configuredBoard?: {
    id: number;
    name: string;
    url?: string | null;
    visible: boolean;
  } | null;
  error?: string | null;
};

export async function fetchJiraIntegrationStatus(): Promise<JiraIntegrationStatus> {
  const response = await fetch("/api/integrations/jira/status", {
    method: "GET",
    headers: { Accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error(`JIRA status request failed (${response.status})`);
  }
  return (await response.json()) as JiraIntegrationStatus;
}
