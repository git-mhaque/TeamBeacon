import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { vi } from "vitest";

type MockChartCall = {
  canvas: HTMLCanvasElement;
  config: any;
  destroy: ReturnType<typeof vi.fn>;
};

const { chartCalls, preferenceStore } = vi.hoisted(() => ({
  chartCalls: [] as MockChartCall[],
  preferenceStore: new Map<string, string>(),
}));

vi.mock("chart.js/auto", () => {
  const Chart = vi.fn(function MockChart(this: unknown, canvas: HTMLCanvasElement, config: any) {
    const chartCall: MockChartCall = {
      canvas,
      config,
      destroy: vi.fn(),
    };
    chartCalls.push(chartCall);
    return chartCall;
  });

  return {
    default: Chart,
  };
});

vi.mock("../../src/lib/persistence", () => ({
  getPreferenceSync: vi.fn(),
  getPreference: vi.fn(),
  setPreference: vi.fn(),
  removePreference: vi.fn(),
}));

import * as persistence from "../../src/lib/persistence";
import { ReleasesScreen } from "../../src/components/content/screens/ReleasesScreen";

const RELEASE_TREND_SELECTION_KEY = "teambeacon.releaseInsights.selectedReleaseIds";

function jsonResponse(payload: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function releaseInsightsPayload() {
  return {
    source: "local",
    generatedAt: "2026-05-20T00:00:00+00:00",
    projectKey: "CEGBUPOL",
    metrics: {
      totalReleases: 3,
      releasedCount: 2,
      ongoingCount: 1,
      archivedCount: 0,
      overdueCount: 1,
      dueSoonCount: 0,
      avgCycleTimeDays: 25,
      medianCycleTimeDays: 25,
      p85CycleTimeDays: 30,
      avgCadenceDays: 21,
      deliveredStoryPoints: 16,
    },
    cycleTimeTrend: [
      {
        versionId: "26000",
        name: "Search 26.3",
        releaseDate: "2026-03-31T00:00:00+00:00",
        cycleTimeDays: 30,
        storyPoints: 13,
        issueCount: 2,
      },
      {
        versionId: "26001",
        name: "Search 26.4",
        releaseDate: "2026-04-21T00:00:00+00:00",
        cycleTimeDays: 20,
        storyPoints: 3,
        issueCount: 1,
      },
    ],
    ongoingReleases: [
      {
        versionId: "26002",
        projectKey: "CEGBUPOL",
        name: "Q4 FY26 - Tech",
        description: "Tech release",
        archived: false,
        released: false,
        startDate: "2019-01-01T00:00:00+00:00",
        releaseDate: "2019-01-31T00:00:00+00:00",
        cycleTimeDays: null,
        ageDays: 2600,
        dueInDays: null,
        overdueDays: 2500,
        issueCount: 2,
        doneIssueCount: 0,
        inProgressIssueCount: 1,
        todoIssueCount: 1,
        storyPoints: 13,
        doneStoryPoints: 0,
        readinessPercent: 0,
        criticalOpenIssueCount: 1,
        issueTypeMix: [
          { label: "Story", count: 1, percent: 50 },
          { label: "Task", count: 1, percent: 50 },
        ],
        sampleOpenIssues: [],
        riskLevel: "red",
        riskSummary: "Overdue by 2500 days with 100% remaining.",
      },
      {
        versionId: "26003",
        projectKey: "CEGBUPOL",
        name: "Q4 FY26 - Feature",
        description: "Feature release",
        archived: false,
        released: false,
        startDate: "2019-01-15T00:00:00+00:00",
        releaseDate: "2019-02-15T00:00:00+00:00",
        cycleTimeDays: null,
        ageDays: 2580,
        dueInDays: null,
        overdueDays: 2480,
        issueCount: 1,
        doneIssueCount: 0,
        inProgressIssueCount: 1,
        todoIssueCount: 0,
        storyPoints: 5,
        doneStoryPoints: 0,
        readinessPercent: 0,
        criticalOpenIssueCount: 0,
        issueTypeMix: [{ label: "Story", count: 1, percent: 100 }],
        sampleOpenIssues: [],
        riskLevel: "red",
        riskSummary: "Overdue by 2480 days with 100% remaining.",
      },
      {
        versionId: "26004",
        projectKey: "CEGBUPOL",
        name: "Search Platform 26.5",
        description: "Upcoming platform release",
        archived: false,
        released: false,
        startDate: "2026-05-01T00:00:00+00:00",
        releaseDate: null,
        cycleTimeDays: null,
        ageDays: 19,
        dueInDays: null,
        overdueDays: null,
        issueCount: 1,
        doneIssueCount: 0,
        inProgressIssueCount: 1,
        todoIssueCount: 0,
        storyPoints: 3,
        doneStoryPoints: 0,
        readinessPercent: 0,
        criticalOpenIssueCount: 0,
        issueTypeMix: [{ label: "Task", count: 1, percent: 100 }],
        sampleOpenIssues: [],
        riskLevel: "amber",
        riskSummary: "Missing start or target release date.",
      },
    ],
    recentReleases: [
      {
        versionId: "26000",
        projectKey: "CEGBUPOL",
        name: "Search 26.3",
        description: null,
        archived: false,
        released: true,
        startDate: "2026-03-01T00:00:00+00:00",
        releaseDate: "2026-03-31T00:00:00+00:00",
        cycleTimeDays: 30,
        ageDays: 30,
        dueInDays: null,
        overdueDays: null,
        issueCount: 2,
        doneIssueCount: 2,
        inProgressIssueCount: 0,
        todoIssueCount: 0,
        storyPoints: 13,
        doneStoryPoints: 13,
        readinessPercent: 100,
        criticalOpenIssueCount: 0,
        issueTypeMix: [{ label: "Story", count: 2, percent: 100 }],
        sampleOpenIssues: [],
        riskLevel: "green",
        riskSummary: "Released with linked scope complete.",
      },
      {
        versionId: "26001",
        projectKey: "CEGBUPOL",
        name: "Search 26.4",
        description: null,
        archived: false,
        released: true,
        startDate: "2026-04-01T00:00:00+00:00",
        releaseDate: "2026-04-21T00:00:00+00:00",
        cycleTimeDays: 20,
        ageDays: 20,
        dueInDays: null,
        overdueDays: null,
        issueCount: 1,
        doneIssueCount: 1,
        inProgressIssueCount: 0,
        todoIssueCount: 0,
        storyPoints: 3,
        doneStoryPoints: 3,
        readinessPercent: 100,
        criticalOpenIssueCount: 0,
        issueTypeMix: [{ label: "Bug", count: 1, percent: 100 }],
        sampleOpenIssues: [],
        riskLevel: "green",
        riskSummary: "Released with linked scope complete.",
      },
    ],
    riskSignals: [
      {
        level: "red",
        title: "Q4 FY26 - Tech",
        detail: "Overdue by 2500 days with 100% remaining.",
      },
      {
        level: "amber",
        title: "Release date hygiene",
        detail: "1 active release is missing a target date.",
      },
    ],
    summary: "1 ongoing release(s), 1 overdue, and 0 due within 14 days.",
    error: null,
  };
}

function releasedVersionFixture(index: number) {
  const day = String(index).padStart(2, "0");
  return {
    versionId: `release-${day}`,
    projectKey: "CEGBUPOL",
    name: `Release ${day}`,
    description: null,
    archived: false,
    released: true,
    startDate: `2026-04-${day}T00:00:00+00:00`,
    releaseDate: `2026-05-${day}T00:00:00+00:00`,
    cycleTimeDays: index,
    ageDays: index,
    dueInDays: null,
    overdueDays: null,
    issueCount: index,
    doneIssueCount: index,
    inProgressIssueCount: 0,
    todoIssueCount: 0,
    storyPoints: index * 2,
    doneStoryPoints: index * 2,
    readinessPercent: 100,
    criticalOpenIssueCount: 0,
    issueTypeMix: [{ label: "Story", count: index, percent: 100 }],
    sampleOpenIssues: [],
    riskLevel: "green" as const,
    riskSummary: "Released with linked scope complete.",
  };
}

function getLatestChartCall(ariaLabel: string): MockChartCall {
  const matchingCalls = chartCalls.filter((chartCall) => chartCall.canvas.getAttribute("aria-label") === ariaLabel);
  expect(matchingCalls.length).toBeGreaterThan(0);
  return matchingCalls[matchingCalls.length - 1];
}

async function findLatestChartCall(ariaLabel: string): Promise<MockChartCall> {
  await waitFor(() => {
    const matchingCalls = chartCalls.filter((chartCall) => chartCall.canvas.getAttribute("aria-label") === ariaLabel);
    expect(matchingCalls.length).toBeGreaterThan(0);
  });
  return getLatestChartCall(ariaLabel);
}

describe("ReleasesScreen", () => {
  beforeEach(() => {
    chartCalls.length = 0;
    preferenceStore.clear();
    vi.mocked(persistence.getPreferenceSync).mockImplementation((key) => preferenceStore.get(key) ?? null);
    vi.mocked(persistence.getPreference).mockImplementation(async (key) => preferenceStore.get(key) ?? null);
    vi.mocked(persistence.setPreference).mockImplementation(async (key, value) => {
      preferenceStore.set(key, value);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders release analytics from the local insights endpoint", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url.includes("/api/releases/insights")) {
        return jsonResponse(releaseInsightsPayload());
      }
      return Promise.reject(new Error(`Unhandled fetch request in test: ${url}`));
    });

    render(<ReleasesScreen />);

    const overviewHeading = screen.getByRole("heading", { name: "Release Overview" });
    expect(overviewHeading).toBeInTheDocument();
    expect((await screen.findAllByText("Q4 FY26 - Tech")).length).toBeGreaterThan(0);
    const overviewPanel = overviewHeading.closest("section");
    if (!overviewPanel) {
      throw new Error("Release Overview panel not found.");
    }
    const scopedOverview = within(overviewPanel);
    const ongoingHeading = scopedOverview.getByRole("heading", { name: "Ongoing Releases" });
    const overdueHeading = scopedOverview.getByRole("heading", { name: "Overdue Releases" });
    expect(ongoingHeading.compareDocumentPosition(overdueHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(overdueHeading.closest("article")).toHaveTextContent("1");
    expect(overdueHeading.closest("article")).toHaveTextContent("0 due soon.");
    expect(screen.getAllByText("Search 26.4").length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { name: "Delivered Scope" })).not.toBeInTheDocument();
    const cycleTrend = screen.getByTestId("release-cycle-time-trend");
    expect(cycleTrend).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select Releases" })).toBeInTheDocument();
    expect(screen.getByText("2 shown")).toBeInTheDocument();
    expect(screen.getByTestId("release-cycle-time-chart")).toHaveAttribute("aria-label", "Release cycle time line chart");
    const releaseKey = screen.getByRole("list", { name: "Line chart release labels" });
    const releaseKeyItems = within(releaseKey).getAllByRole("listitem");
    expect(releaseKeyItems).toHaveLength(2);
    expect(releaseKeyItems[0]).toHaveTextContent("R1");
    expect(releaseKeyItems[0]).toHaveTextContent("Search 26.3");
    expect(releaseKeyItems[1]).toHaveTextContent("R2");
    expect(releaseKeyItems[1]).toHaveTextContent("Search 26.4");
    const chartCall = await findLatestChartCall("Release cycle time line chart");
    expect(chartCall.config.data.labels).toEqual(["R1", "R2"]);
    expect(chartCall.config.data.datasets[0].data).toEqual([30, 20]);
    expect(chartCall.config.data.datasets[1].data).toEqual([null, null]);
    expect(chartCall.config.data.datasets[2].data).toEqual([25, 25]);
    expect(chartCall.config.options.plugins.tooltip.callbacks.title([{ dataIndex: 1 }])).toBe("Search 26.4");
    expect(chartCall.config.options.plugins.tooltip.callbacks.label({ dataIndex: 1, datasetIndex: 0 })).toBe(
      "20 d | 01-Apr-2026 to 21-Apr-2026"
    );
    expect(chartCall.config.options.plugins.tooltip.callbacks.label({ dataIndex: 0, datasetIndex: 2 })).toBe(
      "Average: 25 d"
    );
    expect(chartCall.config.options.plugins.tooltip.callbacks.label({ dataIndex: 99, datasetIndex: 0 })).toBe("");
    expect(chartCall.config.options.scales.y.ticks.callback(20)).toBe("20 d");

    const recentTable = screen.getByRole("table", { name: "Recent completed releases" });
    const recentRows = within(recentTable).getAllByRole("row");
    expect(recentRows[1]).toHaveTextContent("Search 26.4");
    expect(recentRows[1]).toHaveTextContent("21-Apr-2026");
    expect(recentRows[1]).toHaveTextContent("1 cards / 3 SP");
    expect(recentRows[2]).toHaveTextContent("Search 26.3");
  });

  it("defaults the trend and table to the latest 12 completed releases", async () => {
    const payload = releaseInsightsPayload();
    payload.recentReleases = Array.from({ length: 14 }, (_, index) => releasedVersionFixture(index + 1));
    payload.metrics.totalReleases = 14;
    payload.metrics.releasedCount = 14;
    payload.metrics.deliveredStoryPoints = 210;

    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url.includes("/api/releases/insights")) {
        return jsonResponse(payload);
      }
      return Promise.reject(new Error(`Unhandled fetch request in test: ${url}`));
    });

    render(<ReleasesScreen />);

    const releaseKey = await screen.findByRole("list", { name: "Line chart release labels" });
    const releaseKeyItems = within(releaseKey).getAllByRole("listitem");
    expect(releaseKeyItems).toHaveLength(12);
    expect(releaseKeyItems[0]).toHaveTextContent("Release 03");
    expect(releaseKeyItems[11]).toHaveTextContent("Release 14");
    expect(within(releaseKey).queryByText("Release 02")).not.toBeInTheDocument();
    const chartCall = await findLatestChartCall("Release cycle time line chart");
    expect(chartCall.config.data.datasets[0].data).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);

    const recentTable = screen.getByRole("table", { name: "Recent completed releases" });
    const recentRows = within(recentTable).getAllByRole("row");
    expect(recentRows).toHaveLength(13);
    expect(recentRows[1]).toHaveTextContent("Release 14");
    expect(recentRows[12]).toHaveTextContent("Release 03");
    expect(within(recentTable).queryByText("Release 02")).not.toBeInTheDocument();
  });

  it("lets users select releases for the cycle-time chart in oldest-to-newest order", async () => {
    const payload = releaseInsightsPayload();
    payload.recentReleases = Array.from({ length: 5 }, (_, index) => releasedVersionFixture(index + 1));
    payload.metrics.totalReleases = 5;
    payload.metrics.releasedCount = 5;

    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url.includes("/api/releases/insights")) {
        return jsonResponse(payload);
      }
      return Promise.reject(new Error(`Unhandled fetch request in test: ${url}`));
    });

    render(<ReleasesScreen />);

    await screen.findByText("5 shown");
    fireEvent.click(screen.getByRole("button", { name: "Select Releases" }));
    const dialog = await screen.findByRole("dialog", { name: "Select Releases" });
    const dialogScope = within(dialog);
    expect(dialogScope.getByText("5 selected")).toBeInTheDocument();
    const searchBox = dialogScope.getByRole("searchbox", { name: "Search releases" });
    expect(searchBox).toBeInTheDocument();
    fireEvent.input(searchBox, { target: { value: "Release 02" } });
    expect(dialogScope.getByLabelText(/Release 02/)).toBeInTheDocument();
    expect(dialogScope.queryByLabelText(/Release 05/)).not.toBeInTheDocument();
    fireEvent.input(searchBox, { target: { value: "No matching release" } });
    expect(dialogScope.getByText("No releases match this search.")).toBeInTheDocument();
    fireEvent.input(searchBox, { target: { value: "" } });

    fireEvent.click(dialogScope.getByLabelText(/Release 05/));
    expect(dialogScope.getByText("4 selected")).toBeInTheDocument();
    fireEvent.click(dialogScope.getByRole("button", { name: "Select all" }));
    expect(dialogScope.getByText("5 selected")).toBeInTheDocument();
    fireEvent.click(dialogScope.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Select Releases" })).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Select Releases" }));
    const reopenedDialog = await screen.findByRole("dialog", { name: "Select Releases" });
    const reopenedDialogScope = within(reopenedDialog);
    expect(reopenedDialogScope.getByText("5 selected")).toBeInTheDocument();

    fireEvent.click(reopenedDialogScope.getByRole("button", { name: "Clear" }));
    expect(reopenedDialogScope.getByText("0 selected")).toBeInTheDocument();
    expect(reopenedDialogScope.getByRole("button", { name: "Apply" })).toBeDisabled();

    fireEvent.click(reopenedDialogScope.getByLabelText(/Release 02/));
    fireEvent.click(reopenedDialogScope.getByLabelText(/Release 05/));
    expect(reopenedDialogScope.getByText("2 selected")).toBeInTheDocument();
    fireEvent.click(reopenedDialogScope.getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Select Releases" })).not.toBeInTheDocument();
    });
    expect(screen.getByText("2 shown")).toBeInTheDocument();

    const releaseKey = screen.getByRole("list", { name: "Line chart release labels" });
    const releaseKeyItems = within(releaseKey).getAllByRole("listitem");
    expect(releaseKeyItems).toHaveLength(2);
    expect(releaseKeyItems[0]).toHaveTextContent("R1");
    expect(releaseKeyItems[0]).toHaveTextContent("Release 02");
    expect(releaseKeyItems[1]).toHaveTextContent("R2");
    expect(releaseKeyItems[1]).toHaveTextContent("Release 05");

    await waitFor(() => {
      const chartCall = getLatestChartCall("Release cycle time line chart");
      expect(chartCall.config.data.labels).toEqual(["R1", "R2"]);
      expect(chartCall.config.data.datasets[0].data).toEqual([2, 5]);
      expect(chartCall.config.data.datasets[2].data).toEqual([3.5, 3.5]);
    });
    expect(JSON.parse(preferenceStore.get(RELEASE_TREND_SELECTION_KEY) ?? "[]")).toEqual([
      "release-05",
      "release-02",
    ]);
  });

  it("hydrates selected releases from persisted preferences", async () => {
    const payload = releaseInsightsPayload();
    payload.recentReleases = Array.from({ length: 5 }, (_, index) => releasedVersionFixture(index + 1));
    payload.metrics.totalReleases = 5;
    payload.metrics.releasedCount = 5;
    preferenceStore.set(RELEASE_TREND_SELECTION_KEY, JSON.stringify(["release-02", "release-05"]));

    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url.includes("/api/releases/insights")) {
        return jsonResponse(payload);
      }
      return Promise.reject(new Error(`Unhandled fetch request in test: ${url}`));
    });

    render(<ReleasesScreen />);

    expect(await screen.findByText("2 shown")).toBeInTheDocument();
    const releaseKey = screen.getByRole("list", { name: "Line chart release labels" });
    const releaseKeyItems = within(releaseKey).getAllByRole("listitem");
    expect(releaseKeyItems).toHaveLength(2);
    expect(releaseKeyItems[0]).toHaveTextContent("Release 02");
    expect(releaseKeyItems[1]).toHaveTextContent("Release 05");

    await waitFor(() => {
      const chartCall = getLatestChartCall("Release cycle time line chart");
      expect(chartCall.config.data.datasets[0].data).toEqual([2, 5]);
    });

    fireEvent.click(screen.getByRole("button", { name: "Select Releases" }));
    const dialog = await screen.findByRole("dialog", { name: "Select Releases" });
    expect(within(dialog).getByText("2 selected")).toBeInTheDocument();
  });

  it("marks completed releases with missing end dates in the chart and table", async () => {
    const payload = releaseInsightsPayload();
    payload.recentReleases = [
      releasedVersionFixture(2),
      {
        ...releasedVersionFixture(1),
        versionId: "release-missing-end",
        name: "Release Missing End",
        releaseDate: null,
        cycleTimeDays: null,
      } as any,
    ];
    payload.metrics.totalReleases = 2;
    payload.metrics.releasedCount = 2;

    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url.includes("/api/releases/insights")) {
        return jsonResponse(payload);
      }
      return Promise.reject(new Error(`Unhandled fetch request in test: ${url}`));
    });

    render(<ReleasesScreen />);

    const missingValues = await screen.findByRole("list", { name: "Release cycle missing values" });
    expect(within(missingValues).getByText("Release Missing End: Missing end date")).toBeInTheDocument();
    const chartCall = await findLatestChartCall("Release cycle time line chart");
    expect(chartCall.config.data.datasets[0].data).toEqual([null, 2]);
    expect(chartCall.config.data.datasets[1].data).toEqual([0, null]);
    expect(chartCall.config.options.plugins.tooltip.callbacks.label({ dataIndex: 0, datasetIndex: 1 })).toBe(
      "Missing end date | 01-Apr-2026 to -"
    );

    const recentTable = screen.getByRole("table", { name: "Recent completed releases" });
    expect(within(recentTable).getByText("Missing end date")).toBeInTheDocument();
    expect(within(recentTable).getByText("01-Apr-2026 to -")).toBeInTheDocument();
  });

  it("shows empty-state guidance when no releases are synced", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url.includes("/api/releases/insights")) {
        return jsonResponse({
          source: "local",
          generatedAt: "2026-05-20T00:00:00+00:00",
          projectKey: "CEGBUPOL",
          metrics: {
            totalReleases: 0,
            releasedCount: 0,
            ongoingCount: 0,
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
          summary: "Release insights will appear once release data is synced.",
          error: "No releases found in local data. Run Sync Data after configuring release sync.",
        });
      }
      return Promise.reject(new Error(`Unhandled fetch request in test: ${url}`));
    });

    render(<ReleasesScreen />);

    expect(await screen.findByText(/No releases found in local data/i)).toBeInTheDocument();
    expect(screen.getByText("No ongoing releases found in the current sync.")).toBeInTheDocument();
  });

  it("surfaces endpoint failures without keeping stale release rows", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Release endpoint unavailable"));

    render(<ReleasesScreen />);

    expect(await screen.findByText("Release endpoint unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Q4 FY26 - Tech")).not.toBeInTheDocument();
  });
});
