import { afterEach, describe, expect, it, vi } from "vitest";

function jsonResponse(payload: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

const releaseInsightsPayload = {
  source: "local",
  generatedAt: "2026-05-20T00:00:00+00:00",
  projectKey: "CEGBUPOL",
  metrics: {
    totalReleases: 1,
    releasedCount: 0,
    ongoingCount: 1,
    archivedCount: 0,
    overdueCount: 0,
    dueSoonCount: 0,
    avgCycleTimeDays: null,
    medianCycleTimeDays: null,
    p85CycleTimeDays: null,
    avgCadenceDays: null,
    deliveredStoryPoints: 0,
  },
  cycleTimeTrend: [],
  ongoingReleases: [],
  recentReleases: [],
  riskSignals: [],
  summary: "1 ongoing release(s), 0 overdue, and 0 due within 14 days.",
  error: null,
};

describe("api release insights", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    delete (globalThis as unknown as { TEAMBEACON_API_BASE?: string }).TEAMBEACON_API_BASE;
  });

  it("fetches release insights with trimmed project key query params", async () => {
    (globalThis as unknown as { TEAMBEACON_API_BASE?: string }).TEAMBEACON_API_BASE = "https://teambeacon.test/";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(await jsonResponse(releaseInsightsPayload));
    const { fetchReleaseInsights } = await import("../../src/lib/api");

    const result = await fetchReleaseInsights(7, " CEGBUPOL ");

    expect(result).toEqual(releaseInsightsPayload);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://teambeacon.test/api/releases/insights?releaseLimit=7&projectKey=CEGBUPOL",
      {
        method: "GET",
        headers: { Accept: "application/json" },
      },
    );
  });

  it("omits blank project keys and surfaces backend error details", async () => {
    (globalThis as unknown as { TEAMBEACON_API_BASE?: string }).TEAMBEACON_API_BASE = "https://teambeacon.test";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(await jsonResponse({ detail: "release store unavailable" }, 503));
    const { fetchReleaseInsights } = await import("../../src/lib/api");

    await expect(fetchReleaseInsights(3, "   ")).rejects.toThrow("release store unavailable");
    expect(fetchSpy).toHaveBeenCalledWith("https://teambeacon.test/api/releases/insights?releaseLimit=3", {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  });
});

describe("api initiative views", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    delete (globalThis as unknown as { TEAMBEACON_API_BASE?: string }).TEAMBEACON_API_BASE;
  });

  it("fetches configured epic summary with view query params", async () => {
    (globalThis as unknown as { TEAMBEACON_API_BASE?: string }).TEAMBEACON_API_BASE = "https://teambeacon.test";
    const payload = {
      epics: [],
      reportingPeriod: {
        startDate: "2026-03-23",
        endDate: "2026-03-30",
        days: 8,
        timezone: "Australia/Melbourne",
      },
      view: {
        id: 7,
        name: "Q1 FY27",
        epicKeys: ["CEG-101"],
        epicCount: 1,
        isDefault: false,
      },
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(await jsonResponse(payload));
    const { fetchConfiguredEpicSummary } = await import("../../src/lib/api");

    const result = await fetchConfiguredEpicSummary(100, {
      periodStart: "2026-03-23",
      periodEnd: "2026-03-30",
      timezone: "Australia/Melbourne",
      viewId: 7,
    });

    expect(result).toEqual(payload);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://teambeacon.test/api/metadata/epics/summary?limit=100&periodStart=2026-03-23&periodEnd=2026-03-30&timezone=Australia%2FMelbourne&viewId=7",
      {
        method: "GET",
        headers: { Accept: "application/json" },
      },
    );
  });

  it("omits all-configured view id from configured completed cards request", async () => {
    (globalThis as unknown as { TEAMBEACON_API_BASE?: string }).TEAMBEACON_API_BASE = "https://teambeacon.test";
    const payload = {
      source: "local",
      scope: "configured",
      count: 0,
      limit: 300,
      truncated: false,
      completedCards: [],
      perEpicCounts: {},
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(await jsonResponse(payload));
    const { fetchConfiguredEpicsCompletedCards } = await import("../../src/lib/api");

    await fetchConfiguredEpicsCompletedCards({ viewId: "all", limit: 50 });

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://teambeacon.test/api/metadata/epics/completed-cards/configured?limit=50",
      {
        method: "GET",
        headers: { Accept: "application/json" },
      },
    );
  });

  it("creates, updates, and deletes initiative views", async () => {
    (globalThis as unknown as { TEAMBEACON_API_BASE?: string }).TEAMBEACON_API_BASE = "https://teambeacon.test";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(await jsonResponse({ id: 7, name: "Q1 FY27", epicKeys: ["CEG-101"], epicCount: 1 }))
      .mockResolvedValueOnce(await jsonResponse({ id: 7, name: "Q1 FY27 Delivery", epicKeys: ["CEG-101"], epicCount: 1 }))
      .mockResolvedValueOnce(await jsonResponse({ id: 7, deleted: true, removedMappings: 1, removedRows: 1 }));
    const { createInitiativeView, updateInitiativeView, deleteInitiativeView } = await import("../../src/lib/api");

    await createInitiativeView({ name: "Q1 FY27", description: null, epicKeys: ["CEG-101"] });
    await updateInitiativeView({ id: 7, name: "Q1 FY27 Delivery", description: "Updated", epicKeys: ["CEG-101"] });
    await deleteInitiativeView(7);

    expect(fetchSpy).toHaveBeenNthCalledWith(1, "https://teambeacon.test/api/metadata/initiative-views", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Q1 FY27", description: null, epicKeys: ["CEG-101"] }),
    });
    expect(fetchSpy).toHaveBeenNthCalledWith(2, "https://teambeacon.test/api/metadata/initiative-views/update", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ id: 7, name: "Q1 FY27 Delivery", description: "Updated", epicKeys: ["CEG-101"] }),
    });
    expect(fetchSpy).toHaveBeenNthCalledWith(3, "https://teambeacon.test/api/metadata/initiative-views/delete", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ id: 7 }),
    });
  });
});

describe("api initiative deep dive", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    delete (globalThis as unknown as { TEAMBEACON_API_BASE?: string }).TEAMBEACON_API_BASE;
  });

  it("fetches initiative flow with repeated group and epic scope parameters", async () => {
    (globalThis as unknown as { TEAMBEACON_API_BASE?: string }).TEAMBEACON_API_BASE = "https://teambeacon.test";
    const payload = {
      source: "local",
      scope: "initiative-deep-dive",
      weekly: [],
      periods: [],
      cards: [],
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(await jsonResponse(payload));
    const { fetchInitiativeDeepDive } = await import("../../src/lib/api");

    const result = await fetchInitiativeDeepDive({
      groupIds: [5, 8],
      epicKeys: ["TB-100", "TB-200"],
      chartWeeks: 12,
      tableWindowWeeks: 4,
      activity: "completed",
      timezone: "Australia/Melbourne",
      limit: 250,
    });

    expect(result).toEqual(payload);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://teambeacon.test/api/initiative-deep-dive?groupId=5&groupId=8&epicKey=TB-100&epicKey=TB-200&chartWeeks=12&tableWindowWeeks=4&activity=completed&timezone=Australia%2FMelbourne&limit=250",
      {
        method: "GET",
        headers: { Accept: "application/json" },
      },
    );
  });

  it("surfaces initiative deep-dive backend errors", async () => {
    (globalThis as unknown as { TEAMBEACON_API_BASE?: string }).TEAMBEACON_API_BASE = "https://teambeacon.test";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(await jsonResponse({ detail: "Unknown groupId: 99" }, 400));
    const { fetchInitiativeDeepDive } = await import("../../src/lib/api");

    await expect(fetchInitiativeDeepDive({ groupIds: [99], timezone: "UTC" })).rejects.toThrow("Unknown groupId: 99");
  });
});
