import { beforeEach, describe, expect, it, vi } from "vitest";
import * as persistence from "../../src/lib/persistence";
import {
  TEAM_INSIGHTS_SETTINGS_KEY,
  normalizePersistedCycleTimeStatusKeys,
  readTeamInsightsCycleTimeStatusKeys,
} from "../../src/lib/teamInsightsSettings";

describe("Team Insights settings", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes and deduplicates persisted cycle-time statuses", () => {
    expect(normalizePersistedCycleTimeStatusKeys(
      ["In Progress", " code review ", "in progress", "", 12],
      null,
    )).toEqual(["in progress", "code review"]);
  });

  it("preserves default and explicit empty selection semantics", () => {
    expect(normalizePersistedCycleTimeStatusKeys(null, ["fallback"])).toBeNull();
    expect(normalizePersistedCycleTimeStatusKeys(undefined, ["fallback"])).toEqual(["fallback"]);
    expect(normalizePersistedCycleTimeStatusKeys([], ["fallback"])).toEqual([]);
  });

  it("reads the cycle-time selection from Team Insights settings", () => {
    vi.spyOn(persistence, "getPreferenceSync").mockImplementation((key) => (
      key === TEAM_INSIGHTS_SETTINGS_KEY
        ? JSON.stringify({ selectedCycleTimeStatusKeys: ["In Progress"] })
        : null
    ));

    expect(readTeamInsightsCycleTimeStatusKeys()).toEqual(["in progress"]);
  });

  it("falls back to default statuses for missing or malformed settings", () => {
    const preferenceSpy = vi.spyOn(persistence, "getPreferenceSync").mockReturnValue(null);
    expect(readTeamInsightsCycleTimeStatusKeys()).toBeNull();

    preferenceSpy.mockReturnValue("not json");
    expect(readTeamInsightsCycleTimeStatusKeys()).toBeNull();
  });
});
