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
