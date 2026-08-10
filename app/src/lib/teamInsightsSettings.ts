import { getPreferenceSync } from "./persistence";

export const TEAM_INSIGHTS_SETTINGS_KEY = "teambeacon.teamInsights.settings";

export function normalizePersistedCycleTimeStatusKeys(
  value: unknown,
  fallback: string[] | null,
): string[] | null {
  if (value === null) return null;
  if (!Array.isArray(value)) return fallback;
  return Array.from(new Set(
    value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  ));
}

export function readTeamInsightsCycleTimeStatusKeys(): string[] | null {
  try {
    const raw = getPreferenceSync(TEAM_INSIGHTS_SETTINGS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { selectedCycleTimeStatusKeys?: unknown };
    return normalizePersistedCycleTimeStatusKeys(parsed.selectedCycleTimeStatusKeys, null);
  } catch {
    return null;
  }
}
