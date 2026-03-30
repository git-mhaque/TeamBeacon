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
    sprintFields?: string[];
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

export type OciGenAiIntegrationStatus = {
  source: "oci_genai";
  connected: boolean;
  checkedAt: string;
  config: {
    compartmentId?: string;
    endpoint?: string;
    modelId?: string;
    configProfile?: string;
    configFile?: string;
    timeoutSeconds?: {
      connect?: number;
      read?: number;
    };
  };
  checks: IntegrationCheck[];
  error?: string | null;
};

export type OciGenAiChatResponse = {
  source: "oci_genai";
  modelId: string;
  response: {
    text: string;
  };
  request?: {
    message?: string;
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    topK?: number;
    frequencyPenalty?: number;
  };
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
  timelineEnabled?: boolean;
  timelineStartDate?: string | null;
  targetCompletionDate?: string | null;
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
  completedLastWeek?: number;
  deltaPercent?: number;
  completedInPeriod?: number;
  deltaPercentInPeriod?: number;
  groups: EpicLookupItem[];
  workTypes: EpicLookupItem[];
  successCriteria: string[];
  timelineEnabled?: boolean;
  timelineStartDate?: string | null;
  targetCompletionDate?: string | null;
  ragScore?: string | null;
  insightComment?: string | null;
  updatedAt?: string | null;
};

export type EpicSummaryReportingPeriod = {
  startDate: string;
  endDate: string;
  days: number;
  timezone: string;
};

export type CurrentSprint = {
  id: number;
  boardId?: number | null;
  name: string;
  state: string;
  startDate?: string | null;
  endDate?: string | null;
  remainingDays?: number | null;
};

export type CurrentSprintResponse = {
  source: "local";
  sprint: CurrentSprint | null;
  error?: string | null;
};

export type CurrentSprintChangeGroup = {
  count: number;
  storyPointsTotal: number;
  issueKeys: string[];
  issueCards: CurrentSprintChangeIssue[];
};

export type CurrentSprintChangeIssue = {
  issueKey: string;
  summary: string;
  issueUrl?: string | null;
  epicName?: string | null;
  epicUrl?: string | null;
  storyPoints?: number | null;
  status?: string | null;
  statusCategory?: string | null;
};

export type CurrentSprintChangesResponse = {
  source: "local";
  sprint: CurrentSprint | null;
  changes: {
    addedAfterStart: CurrentSprintChangeGroup;
    removedAfterStart: CurrentSprintChangeGroup;
    blockedCards: CurrentSprintChangeGroup;
  };
  error?: string | null;
};

export type CurrentSprintWorkIssue = {
  issueKey: string;
  summary: string;
  status: string;
  statusCategory?: string | null;
  storyPoints?: number | null;
  epicKey?: string | null;
  epicName?: string | null;
  epicUrl?: string | null;
  issueUrl?: string | null;
};

export type CurrentSprintWorkResponse = {
  source: "local";
  sprint: CurrentSprint | null;
  work: {
    done: CurrentSprintWorkIssue[];
    inProgress: CurrentSprintWorkIssue[];
    planned: CurrentSprintWorkIssue[];
    totals: {
      done: number;
      inProgress: number;
      planned: number;
      total: number;
      storyPoints: {
        done: number;
        inProgress: number;
        planned: number;
        total: number;
      };
    };
  };
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

export async function fetchOciGenAiIntegrationStatus(): Promise<OciGenAiIntegrationStatus> {
  const response = await fetch("/api/integrations/oci-genai/status", {
    method: "GET",
    headers: { Accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error(`OCI GenAI status request failed (${response.status})`);
  }
  return (await response.json()) as OciGenAiIntegrationStatus;
}

export async function chatWithOciGenAi(payload: {
  message: string;
  modelId?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  frequencyPenalty?: number;
}): Promise<OciGenAiChatResponse> {
  const response = await fetch("/api/ai/chat", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    try {
      const errorPayload = (await response.json()) as { detail?: string };
      if (errorPayload.detail) {
        throw new Error(errorPayload.detail);
      }
    } catch (err) {
      if (err instanceof Error && err.message) {
        throw err;
      }
    }
    throw new Error(`OCI GenAI chat request failed (${response.status})`);
  }
  return (await response.json()) as OciGenAiChatResponse;
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

export async function fetchCurrentSprint(): Promise<CurrentSprintResponse> {
  const response = await fetch("/api/sprints/current", {
    method: "GET",
    headers: { Accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error(`Current sprint request failed (${response.status})`);
  }
  return (await response.json()) as CurrentSprintResponse;
}

export async function fetchCurrentSprintWork(): Promise<CurrentSprintWorkResponse> {
  const response = await fetch("/api/sprints/current/work", {
    method: "GET",
    headers: { Accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error(`Current sprint work request failed (${response.status})`);
  }
  return (await response.json()) as CurrentSprintWorkResponse;
}

export async function fetchCurrentSprintChanges(): Promise<CurrentSprintChangesResponse> {
  const response = await fetch("/api/sprints/current/changes", {
    method: "GET",
    headers: { Accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error(`Current sprint changes request failed (${response.status})`);
  }
  return (await response.json()) as CurrentSprintChangesResponse;
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

export async function updateEpicGroup(id: number, name: string): Promise<EpicLookupItem> {
  const response = await fetch("/api/metadata/lookup/groups/update", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ id, name })
  });
  if (!response.ok) {
    if (response.status === 400) {
      const payload = (await response.json()) as { detail?: string };
      throw new Error(payload.detail ?? "Invalid epic group update payload.");
    }
    throw new Error(`Epic group update failed (${response.status})`);
  }
  return (await response.json()) as EpicLookupItem;
}

export async function deleteEpicGroup(id: number): Promise<{ id: number; deleted: boolean }> {
  const response = await fetch("/api/metadata/lookup/groups/delete", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ id })
  });
  if (!response.ok) {
    if (response.status === 400) {
      const payload = (await response.json()) as { detail?: string };
      throw new Error(payload.detail ?? "Invalid epic group delete payload.");
    }
    throw new Error(`Epic group delete failed (${response.status})`);
  }
  return (await response.json()) as { id: number; deleted: boolean };
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

export async function updateWorkType(id: number, name: string): Promise<EpicLookupItem> {
  const response = await fetch("/api/metadata/lookup/work-types/update", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ id, name })
  });
  if (!response.ok) {
    if (response.status === 400) {
      const payload = (await response.json()) as { detail?: string };
      throw new Error(payload.detail ?? "Invalid work type update payload.");
    }
    throw new Error(`Work type update failed (${response.status})`);
  }
  return (await response.json()) as EpicLookupItem;
}

export async function deleteWorkType(id: number): Promise<{ id: number; deleted: boolean }> {
  const response = await fetch("/api/metadata/lookup/work-types/delete", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ id })
  });
  if (!response.ok) {
    if (response.status === 400) {
      const payload = (await response.json()) as { detail?: string };
      throw new Error(payload.detail ?? "Invalid work type delete payload.");
    }
    throw new Error(`Work type delete failed (${response.status})`);
  }
  return (await response.json()) as { id: number; deleted: boolean };
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

export async function fetchConfiguredEpicSummary(
  limit = 50,
  options?: {
    periodStart?: string | null;
    periodEnd?: string | null;
    timezone?: string | null;
  },
): Promise<InitiativeEpicSummary[]> {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  if (options?.periodStart) {
    params.set("periodStart", options.periodStart);
  }
  if (options?.periodEnd) {
    params.set("periodEnd", options.periodEnd);
  }
  if (options?.timezone) {
    params.set("timezone", options.timezone);
  }
  const response = await fetch(`/api/metadata/epics/summary?${params.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" }
  });
  if (!response.ok) {
    if (response.status === 400) {
      const payload = (await response.json()) as { detail?: string };
      throw new Error(payload.detail ?? "Invalid configured epic summary request.");
    }
    throw new Error(`Configured epic summary request failed (${response.status})`);
  }
  const payload = (await response.json()) as {
    epics?: InitiativeEpicSummary[];
    reportingPeriod?: EpicSummaryReportingPeriod;
  };
  return payload.epics ?? [];
}

export async function upsertEpicMetadata(payload: {
  epicKey: string;
  successCriteria: string[];
  groupIds: number[];
  workTypeIds: number[];
  timelineEnabled?: boolean;
  timelineStartDate?: string | null;
  targetCompletionDate?: string | null;
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

export async function deleteEpicMetadata(epicKey: string): Promise<{
  epicKey: string;
  deleted: boolean;
  removedGroupMappings: number;
  removedWorkTypeMappings: number;
  removedMetadataRows: number;
}> {
  const response = await fetch("/api/metadata/epics/delete", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ epicKey }),
  });
  if (!response.ok) {
    if (response.status === 400) {
      const payload = (await response.json()) as { detail?: string };
      throw new Error(payload.detail ?? "Invalid epic metadata delete payload.");
    }
    throw new Error(`Epic metadata delete failed (${response.status})`);
  }
  return (await response.json()) as {
    epicKey: string;
    deleted: boolean;
    removedGroupMappings: number;
    removedWorkTypeMappings: number;
    removedMetadataRows: number;
  };
}
