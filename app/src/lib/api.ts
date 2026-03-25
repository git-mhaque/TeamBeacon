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
    epicLinkField?: string;
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

export type JiraSyncState = "idle" | "running" | "completed" | "failed";
export type JiraSyncMode = "full" | "since_last";

export type JiraSyncStatus = {
  source: "jira";
  state: JiraSyncState;
  phase: string;
  syncMode?: JiraSyncMode;
  requestedSyncMode?: JiraSyncMode;
  overlapDays?: number | null;
  boardsSynced?: number;
  sprintsSynced?: number;
  downloadedIssues: number;
  totalIssues?: number | null;
  percent?: number | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  lastSyncedAt?: string | null;
  error?: string | null;
  message?: string | null;
  started?: boolean;
};

export type JiraSyncHistoryEntry = {
  id: number;
  scopeKey: string;
  boardId?: number | null;
  boardName?: string | null;
  syncMode?: JiraSyncMode;
  boardsSynced: number;
  sprintsSynced: number;
  issuesSynced: number;
  totalIssues?: number | null;
  status: "running" | "completed" | "failed";
  error?: string | null;
  startedAt: string;
  finishedAt?: string | null;
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

export async function fetchJiraSyncStatus(): Promise<JiraSyncStatus> {
  const response = await fetch("/api/integrations/jira/sync/status", {
    method: "GET",
    headers: { Accept: "application/json" }
  });
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("JIRA sync status endpoint is unavailable. Restart local API (npm run dev).");
    }
    throw new Error(`JIRA sync status request failed (${response.status})`);
  }
  return (await response.json()) as JiraSyncStatus;
}

export async function startJiraSync(mode: JiraSyncMode = "full"): Promise<JiraSyncStatus> {
  const response = await fetch("/api/integrations/jira/sync/start", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ mode })
  });
  if (!response.ok) {
    if (response.status === 400) {
      try {
        const payload = (await response.json()) as { detail?: string };
        throw new Error(payload.detail ?? "JIRA sync request is invalid.");
      } catch {
        throw new Error("JIRA sync request is invalid.");
      }
    }
    if (response.status === 501 || response.status === 404) {
      throw new Error("JIRA sync endpoint is unavailable. Restart local API (npm run dev).");
    }
    throw new Error(`JIRA sync start request failed (${response.status})`);
  }
  return (await response.json()) as JiraSyncStatus;
}

export async function fetchJiraSyncHistory(limit = 20): Promise<JiraSyncHistoryEntry[]> {
  const response = await fetch(`/api/integrations/jira/sync/history?limit=${encodeURIComponent(String(limit))}`, {
    method: "GET",
    headers: { Accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error(`JIRA sync history request failed (${response.status})`);
  }
  const payload = (await response.json()) as { source: string; history?: JiraSyncHistoryEntry[] };
  return payload.history ?? [];
}
