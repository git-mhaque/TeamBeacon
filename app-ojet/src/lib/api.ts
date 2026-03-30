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
  };
  checks: IntegrationCheck[];
  sampleIssueKey?: string | null;
  error?: string | null;
};

export type OciGenAiIntegrationStatus = {
  source: "oci_genai";
  connected: boolean;
  checkedAt: string;
  config: {
    endpoint?: string;
    modelId?: string;
    configProfile?: string;
  };
  checks: IntegrationCheck[];
  error?: string | null;
};

export type EpicLookupItem = {
  id: number;
  name: string;
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

export type ConfiguredEpicSummaryResponse = {
  epics: InitiativeEpicSummary[];
  reportingPeriod?: EpicSummaryReportingPeriod;
  error?: string | null;
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
    addedAfterStart: {
      count: number;
      storyPointsTotal: number;
      issueKeys: string[];
      issueCards: CurrentSprintChangeIssue[];
    };
    removedAfterStart: {
      count: number;
      storyPointsTotal: number;
      issueKeys: string[];
      issueCards: CurrentSprintChangeIssue[];
    };
    blockedCards: {
      count: number;
      storyPointsTotal: number;
      issueKeys: string[];
      issueCards: CurrentSprintChangeIssue[];
    };
  };
  error?: string | null;
};

const API_BASE = (globalThis as unknown as { TEAMBEACON_API_BASE?: string }).TEAMBEACON_API_BASE
  ?? "http://127.0.0.1:8000";

async function parseError(response: Response, fallback: string): Promise<Error> {
  try {
    const payload = (await response.json()) as { detail?: string };
    if (payload?.detail) {
      return new Error(payload.detail);
    }
  } catch {
    // Best-effort parsing; fallback below.
  }
  return new Error(fallback);
}

export async function fetchJiraIntegrationStatus(): Promise<JiraIntegrationStatus> {
  const response = await fetch(`${API_BASE}/api/integrations/jira/status`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw await parseError(response, `JIRA status request failed (${response.status})`);
  }
  return (await response.json()) as JiraIntegrationStatus;
}

export async function fetchOciGenAiIntegrationStatus(): Promise<OciGenAiIntegrationStatus> {
  const response = await fetch(`${API_BASE}/api/integrations/oci-genai/status`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw await parseError(response, `OCI GenAI status request failed (${response.status})`);
  }
  return (await response.json()) as OciGenAiIntegrationStatus;
}

export async function fetchConfiguredEpicSummary(
  limit = 50,
  options?: {
    periodStart?: string | null;
    periodEnd?: string | null;
    timezone?: string | null;
  },
): Promise<ConfiguredEpicSummaryResponse> {
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

  const response = await fetch(`${API_BASE}/api/metadata/epics/summary?${params.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw await parseError(response, `Configured epic summary request failed (${response.status})`);
  }
  return (await response.json()) as ConfiguredEpicSummaryResponse;
}

export async function fetchCurrentSprint(): Promise<CurrentSprintResponse> {
  const response = await fetch(`${API_BASE}/api/sprints/current`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw await parseError(response, `Current sprint request failed (${response.status})`);
  }
  return (await response.json()) as CurrentSprintResponse;
}

export async function fetchCurrentSprintWork(): Promise<CurrentSprintWorkResponse> {
  const response = await fetch(`${API_BASE}/api/sprints/current/work`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw await parseError(response, `Current sprint work request failed (${response.status})`);
  }
  return (await response.json()) as CurrentSprintWorkResponse;
}

export async function fetchCurrentSprintChanges(): Promise<CurrentSprintChangesResponse> {
  const response = await fetch(`${API_BASE}/api/sprints/current/changes`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw await parseError(response, `Current sprint changes request failed (${response.status})`);
  }
  return (await response.json()) as CurrentSprintChangesResponse;
}
