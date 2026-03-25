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
export type JiraSyncMode = "full" | "since_last" | "since_date";

export type JiraSyncStatus = {
  source: "jira";
  state: JiraSyncState;
  phase: string;
  syncMode?: JiraSyncMode;
  requestedSyncMode?: JiraSyncMode;
  requestedSince?: string | null;
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
  requestedSince?: string | null;
  boardsSynced: number;
  sprintsSynced: number;
  issuesSynced: number;
  totalIssues?: number | null;
  status: "running" | "completed" | "failed";
  error?: string | null;
  startedAt: string;
  finishedAt?: string | null;
};

export type EpicLookupItem = {
  id: number;
  name: string;
};

export type EpicLookupConfig = {
  groups: EpicLookupItem[];
  workTypes: EpicLookupItem[];
};

export type EpicMetadataEntry = {
  epicKey: string;
  epicTitle?: string | null;
  successCriteria: string[];
  groupIds: number[];
  groups: EpicLookupItem[];
  workTypeIds: number[];
  workTypes: EpicLookupItem[];
  updatedAt?: string | null;
};

export type EpicCandidate = {
  epicKey: string;
  epicName: string;
};

export type InitiativeEpicSummary = {
  epicKey: string;
  epicName: string;
  completedCards: number;
  totalCards: number;
  completionPercent: number;
  groups: EpicLookupItem[];
  workTypes: EpicLookupItem[];
  successCriteria: string[];
  ragScore?: string | null;
  insightComment?: string | null;
  updatedAt?: string | null;
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

export async function startJiraSync(mode: JiraSyncMode = "full", sinceDate?: string): Promise<JiraSyncStatus> {
  const payload: { mode: JiraSyncMode; sinceDate?: string } = { mode };
  if (sinceDate) {
    payload.sinceDate = sinceDate;
  }
  const response = await fetch("/api/integrations/jira/sync/start", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(payload)
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

export async function fetchEpicLookupConfig(): Promise<EpicLookupConfig> {
  const response = await fetch("/api/metadata/lookup", {
    method: "GET",
    headers: { Accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error(`Epic lookup request failed (${response.status})`);
  }
  return (await response.json()) as EpicLookupConfig;
}

export async function addEpicGroup(name: string): Promise<EpicLookupItem> {
  const response = await fetch("/api/metadata/lookup/groups", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });
  if (!response.ok) {
    if (response.status === 400) {
      const payload = (await response.json()) as { detail?: string };
      throw new Error(payload.detail ?? "Invalid epic group payload.");
    }
    throw new Error(`Epic group create failed (${response.status})`);
  }
  return (await response.json()) as EpicLookupItem;
}

export async function addWorkType(name: string): Promise<EpicLookupItem> {
  const response = await fetch("/api/metadata/lookup/work-types", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });
  if (!response.ok) {
    if (response.status === 400) {
      const payload = (await response.json()) as { detail?: string };
      throw new Error(payload.detail ?? "Invalid work type payload.");
    }
    throw new Error(`Work type create failed (${response.status})`);
  }
  return (await response.json()) as EpicLookupItem;
}

export async function fetchEpicMetadata(limit = 50): Promise<EpicMetadataEntry[]> {
  const response = await fetch(`/api/metadata/epics?limit=${encodeURIComponent(String(limit))}`, {
    method: "GET",
    headers: { Accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error(`Epic metadata request failed (${response.status})`);
  }
  const payload = (await response.json()) as { epics?: EpicMetadataEntry[] };
  return payload.epics ?? [];
}

export async function fetchEpicCandidates(query: string, limit = 20): Promise<EpicCandidate[]> {
  const params = new URLSearchParams();
  if (query.trim()) {
    params.set("q", query.trim());
  }
  params.set("limit", String(limit));
  const response = await fetch(`/api/metadata/epics/candidates?${params.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error(`Epic candidate request failed (${response.status})`);
  }
  const payload = (await response.json()) as { epics?: EpicCandidate[] };
  return payload.epics ?? [];
}

export async function fetchConfiguredEpicSummary(limit = 50): Promise<InitiativeEpicSummary[]> {
  const response = await fetch(`/api/metadata/epics/summary?limit=${encodeURIComponent(String(limit))}`, {
    method: "GET",
    headers: { Accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error(`Configured epic summary request failed (${response.status})`);
  }
  const payload = (await response.json()) as { epics?: InitiativeEpicSummary[] };
  return payload.epics ?? [];
}

export async function upsertEpicMetadata(payload: {
  epicKey: string;
  successCriteria: string[];
  groupIds: number[];
  workTypeIds: number[];
}): Promise<EpicMetadataEntry> {
  const response = await fetch("/api/metadata/epics", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    if (response.status === 400) {
      const errorPayload = (await response.json()) as { detail?: string };
      throw new Error(errorPayload.detail ?? "Invalid epic metadata payload.");
    }
    throw new Error(`Epic metadata save failed (${response.status})`);
  }
  return (await response.json()) as EpicMetadataEntry;
}
