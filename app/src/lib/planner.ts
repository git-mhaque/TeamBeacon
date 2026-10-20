export type PlanStatus = "draft" | "active" | "completed" | "archived";
export type PlanTrack = { id: string; name: string };
export type PlanEpic = {
  epicKey: string; trackId: string; startDate: string | null; endDate: string | null;
  dependsOn: string[]; notes: string;
};
export type PlanDraft = {
  id?: number; version?: number; name: string; objective: string; owner: string;
  status: PlanStatus; targetDate: string | null; tracks: PlanTrack[]; epics: PlanEpic[];
};
export type PlanMetrics = {
  totalCards: number; completedCards: number; completionPercent: number | null; available: boolean;
};
export type PlannerEpic = PlanMetrics & {
  epicKey: string; title: string; status: string; isCompleted: boolean;
  startDate: string | null; endDate: string | null;
};
export type DeliveryPlan = PlanDraft & {
  id: number; version: number; createdAt: string; updatedAt: string;
  metrics: PlanMetrics; warnings: string[];
  baseline: { capturedAt: string; document: PlanDraft; issueKeys: string[] } | null;
  scopeChange: { added: number; removed: number } | null;
};
export type PlannerInventory = {
  plans: DeliveryPlan[]; epics: PlannerEpic[]; lastSyncedAt: string | null; jiraBaseUrl: string | null;
};

export function newPlan(): PlanDraft {
  return { name: "", objective: "", owner: "", status: "draft", targetDate: null,
    tracks: [{ id: "default", name: "Default" }], epics: [] };
}

export function planDraft(plan: DeliveryPlan): PlanDraft {
  const { id, version, name, objective, owner, status, targetDate, tracks, epics } = plan;
  return { id, version, name, objective, owner, status, targetDate, tracks, epics };
}

export function progressLabel(metrics: PlanMetrics): string {
  if (!metrics.available) return "Unavailable";
  return metrics.completionPercent === null ? "No cards" : `${metrics.completionPercent}%`;
}

export function jiraEpicUrl(base: string | null, key: string): string | undefined {
  if (!base || !/^https?:\/\//i.test(base)) return undefined;
  return `${base.replace(/\/+$/, "")}/browse/${encodeURIComponent(key)}`;
}
