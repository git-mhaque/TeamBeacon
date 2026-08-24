import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { vi } from "vitest";
import * as persistence from "../../src/lib/persistence";
import { TeamDashboardScreen } from "../../src/components/content/screens/TeamDashboardScreen";
import {
  TeamDashboardIssueOverlay,
  type TeamDashboardIssueSelection,
} from "../../src/components/content/screens/TeamDashboardIssueOverlay";
import { setupFetchMock } from "../utils/fetchMock";

const dashboardPayload = {
  source: "local",
  generatedAt: "2026-08-11T02:05:00+00:00",
  timezone: "Australia/Melbourne",
  flowPeriod: {
    weeks: 4,
    startDate: "2026-07-20",
    endDate: "2026-08-16",
  },
  workStreams: [
    {
      id: 5,
      name: "Platform Delivery",
      epicCount: 3,
      newCount: 12,
      completedCount: 15,
      netFlow: -3,
      currentWipCount: 4,
      totalCards: 20,
      totalCompletedCards: 13,
      completionPercent: 65,
      error: null,
    },
    {
      id: 8,
      name: "Customer Operations",
      epicCount: 1,
      newCount: 7,
      completedCount: 4,
      netFlow: 3,
      currentWipCount: 2,
      totalCards: 10,
      totalCompletedCards: 4,
      completionPercent: 40,
      error: "Flow service unavailable",
    },
  ],
  latestRelease: {
    versionId: "81",
    name: "TeamBeacon 2.4",
    releaseDate: "2026-08-08",
    cycleTimeDays: 18.5,
  },
  sprintCycleTime: {
    latestSprintId: 42,
    latestSprintName: "Sprint 42",
    latestAverageDays: 3.4,
    previousSprintId: 41,
    previousSprintName: "Sprint 41",
    previousAverageDays: 4.2,
    deltaDays: -0.8,
    deltaPercent: -19,
    direction: "down",
  },
  blockedItems: {
    sprintId: 43,
    sprintName: "Sprint 43",
    count: 1,
    storyPointsTotal: 5,
    items: [
      {
        issueKey: "TB-421",
        issueUrl: "https://jira.example.test/browse/TB-421",
        summary: "Unblock release automation",
        status: "Blocked",
        storyPoints: 5,
      },
    ],
  },
  recentlyCompleted: {
    windowDays: 7,
    count: 1,
    items: [
      {
        issueKey: "TB-419",
        issueUrl: "https://jira.example.test/browse/TB-419",
        summary: "Publish delivery dashboard",
        epicKey: "TB-100",
        epicName: "Team reporting",
        workStreamId: 5,
        workStreamName: "Platform Delivery",
        completedAt: "2026-08-10T04:00:00+00:00",
      },
    ],
  },
  errors: {},
};

describe("TeamDashboardScreen", () => {
  beforeEach(() => {
    vi.spyOn(persistence, "getPreferenceSync").mockReturnValue(null);
    vi.spyOn(persistence, "setPreference").mockResolvedValue();
  });

  it("uses layout-preserving skeletons during the initial load", () => {
    vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise(() => undefined));

    render(<TeamDashboardScreen />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading work-stream insights");
    expect(document.querySelectorAll(".tb-dashboard-skeleton-row")).toHaveLength(6);
    expect(document.querySelectorAll(".tb-dashboard-kpi .tb-dashboard-skeleton").length).toBeGreaterThan(0);
    expect(screen.queryByText("Loading work-stream flow…")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /Flow period/ })).toBeDisabled();
  });

  it("keeps the current dashboard visible while refreshing", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(dashboardPayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
      .mockReturnValueOnce(new Promise(() => undefined));

    render(<TeamDashboardScreen />);

    expect(await screen.findByText("TeamBeacon 2.4")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    expect(screen.getByText("Refreshing…")).toBeInTheDocument();
    expect(screen.getByText("TeamBeacon 2.4")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Platform Delivery delivery progress" })).toBeInTheDocument();
  });

  it("summarizes delivery health and supports dashboard drill-downs", async () => {
    const callbacks = {
      onOpenWorkStream: vi.fn(),
      onOpenReleaseInsights: vi.fn(),
      onOpenTeamInsights: vi.fn(),
      onOpenSprintInsights: vi.fn(),
      onOpenSettings: vi.fn(),
    };
    const fetchSpy = setupFetchMock({ "/api/team/dashboard": dashboardPayload });

    render(<TeamDashboardScreen {...callbacks} />);

    expect(await screen.findByText("TeamBeacon 2.4")).toBeInTheDocument();
    expect(screen.getByText("3.4 days")).toBeInTheDocument();
    expect(screen.getByText("0.8 days faster")).toBeInTheDocument();
    expect(screen.getByText("Sprint 43 · 5 SP")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Blocked items" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Recently completed" })).not.toBeInTheDocument();

    const highlights = screen.getByRole("region", { name: "Team delivery highlights" });
    expect(Array.from(highlights.querySelectorAll(".tb-dashboard-kpi-heading span")).map((title) => title.textContent)).toEqual([
      "Latest completed release",
      "Latest sprint cycle time",
      "Current sprint blockers",
    ]);

    const progress = screen.getByRole("progressbar", { name: "Platform Delivery delivery progress" });
    expect(progress).toHaveAttribute("aria-valuenow", "65");
    const comparisonRegion = screen.getByRole("region", { name: "Work stream comparison" });
    const comparisonTable = within(comparisonRegion).getByRole("table");
    const streamOrder = () => Array.from(comparisonTable.querySelectorAll("tbody tr")).map((row) => (
      within(row as HTMLElement).getByRole("button", { name: /^(Customer Operations|Platform Delivery)$/ }).textContent
    ));
    expect(streamOrder()).toEqual(["Customer Operations", "Platform Delivery"]);
    expect(within(comparisonTable).getByRole("columnheader", { name: /Flow gap/ })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    expect(within(comparisonTable).getAllByRole("columnheader")).toHaveLength(7);
    expect(within(comparisonTable).queryByRole("columnheader", { name: "Recent flow · Last 4 weeks" })).not.toBeInTheDocument();

    const platformRow = screen.getByRole("button", { name: "Platform Delivery" }).closest("tr");
    expect(platformRow).not.toBeNull();
    expect(within(platformRow as HTMLElement).getByText("3 reduced")).toHaveClass("is-good");
    expect(within(platformRow as HTMLElement).getByText("13/20 completed")).toBeInTheDocument();
    expect(screen.getByText("Flow data unavailable")).toBeInTheDocument();

    fireEvent.click(within(comparisonTable).getByRole("button", { name: "Sort by Completed (descending)" }));
    expect(streamOrder()).toEqual(["Platform Delivery", "Customer Operations"]);
    fireEvent.click(within(comparisonTable).getByRole("button", { name: "Sort by Completed (descending)" }));
    expect(streamOrder()).toEqual(["Customer Operations", "Platform Delivery"]);

    const totalsRow = within(comparisonTable).getByRole("rowheader", { name: "All work streams" }).closest("tr");
    expect(totalsRow).not.toBeNull();
    expect(within(totalsRow as HTMLElement).getByText("Balanced")).toBeInTheDocument();
    expect(within(totalsRow as HTMLElement).getByText("17/30 completed")).toBeInTheDocument();
    expect(within(totalsRow as HTMLElement).getByText("57%")).toBeInTheDocument();
    for (const label of ["Work Streams", "Epics", "Created", "Flow gap", "Current WIP", "Delivery progress"]) {
      fireEvent.click(within(comparisonTable).getByRole("button", { name: new RegExp(`Sort by ${label}`) }));
    }

    fireEvent.click(screen.getByRole("button", { name: "Platform Delivery" }));
    expect(callbacks.onOpenWorkStream).toHaveBeenCalledWith(5);
    fireEvent.click(screen.getByRole("button", { name: "View Release Insights" }));
    fireEvent.click(screen.getByRole("button", { name: "View Team Insights" }));
    fireEvent.click(screen.getAllByRole("button", { name: /View.*Sprint Insights/ })[0]);
    expect(callbacks.onOpenReleaseInsights).toHaveBeenCalledOnce();
    expect(callbacks.onOpenTeamInsights).toHaveBeenCalledOnce();
    expect(callbacks.onOpenSprintInsights).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));

  });

  it("opens a sortable, scrollable JIRA-card overlay from dashboard metrics", async () => {
    const deepDivePayload = {
      source: "local",
      scope: "initiative-deep-dive",
      generatedAt: "2026-08-11T02:05:00+00:00",
      timezone: "Australia/Melbourne",
      group: { id: 5, name: "Platform Delivery", epicCount: 3 },
      groups: [{ id: 5, name: "Platform Delivery", epicCount: 3 }],
      selectedGroupIds: [5],
      epicOptions: [
        { epicKey: "TB-100", epicName: "Team reporting", issueUrl: "https://jira.example.test/browse/TB-100" },
      ],
      selectedEpicKeys: [],
      selectionMode: "all",
      chartWeeks: 4,
      chartRange: { startDate: "2026-07-20", endDate: "2026-08-16", days: 28 },
      reportingPeriod: { startDate: "2026-07-20", endDate: "2026-08-16", days: 28 },
      weekly: [],
      periods: [],
      selectedPeriod: { weeks: 4, startDate: "2026-07-20", endDate: "2026-08-16", days: 28 },
      currentWipCount: 2,
      tableCounts: { all: 2, new: 2, inProgress: 1, completed: 0 },
      activity: "new",
      count: 2,
      limit: 1000,
      truncated: false,
      cards: [
        {
          issueKey: "TB-12",
          issueUrl: "https://jira.example.test/browse/TB-12",
          summary: "Build dashboard overlay",
          issueType: "Story",
          epicKey: "TB-100",
          epicName: "Team reporting",
          epicUrl: "https://jira.example.test/browse/TB-100",
          status: "In Progress",
          statusCategory: "In Progress",
          storyPoints: 5,
          assigneeDisplayName: "Avery Chen",
          activityTypes: ["new"],
          latestActivityAt: "2026-08-10T03:00:00+00:00",
          createdAt: "2026-08-10T03:00:00+00:00",
        },
        {
          issueKey: "TB-2",
          issueUrl: "https://jira.example.test/browse/TB-2",
          summary: "Add issue links",
          issueType: "Task",
          epicKey: "TB-100",
          epicName: "Team reporting",
          epicUrl: "https://jira.example.test/browse/TB-100",
          status: "To Do",
          statusCategory: "To Do",
          storyPoints: 3,
          assigneeDisplayName: null,
          activityTypes: ["new"],
          latestActivityAt: "2026-08-09T03:00:00+00:00",
          createdAt: "2026-08-09T03:00:00+00:00",
        },
      ],
      error: null,
    };
    const fetchSpy = setupFetchMock({
      "/api/team/dashboard": dashboardPayload,
      "/api/initiative-deep-dive": deepDivePayload,
    });

    render(<TeamDashboardScreen />);

    const createdButton = await screen.findByRole("button", {
      name: "View 12 created JIRA cards for Platform Delivery",
    });
    fireEvent.click(createdButton);

    const dialog = await screen.findByRole("dialog", { name: "Created cards" });
    expect(within(dialog).getByText("12 cards created in the last 4 weeks.")).toBeInTheDocument();
    const tableRegion = within(dialog).getByRole("region", { name: "Created cards table" });
    expect(tableRegion).toHaveClass("tb-dashboard-issue-table-wrap");
    expect(within(tableRegion).getAllByRole("columnheader")).toHaveLength(8);
    expect(within(tableRegion).getByRole("link", { name: "TB-12" })).toHaveAttribute(
      "href",
      "https://jira.example.test/browse/TB-12",
    );

    const issueOrder = () => Array.from(tableRegion.querySelectorAll("tbody tr a")).map((link) => link.textContent);
    expect(issueOrder()).toEqual(["TB-2", "TB-12"]);
    fireEvent.click(within(tableRegion).getByRole("button", { name: "Sort by Summary (descending)" }));
    expect(issueOrder()).toEqual(["TB-2", "TB-12"]);
    fireEvent.click(within(tableRegion).getByRole("button", { name: "Sort by Summary (ascending)" }));
    expect(issueOrder()).toEqual(["TB-12", "TB-2"]);

    const drilldownRequest = fetchSpy.mock.calls.find(([input]) => String(input).includes("/api/initiative-deep-dive"));
    expect(drilldownRequest).toBeDefined();
    const drilldownUrl = new URL(String(drilldownRequest?.[0]));
    expect(drilldownUrl.searchParams.getAll("groupId")).toEqual(["5"]);
    expect(drilldownUrl.searchParams.get("activity")).toBe("new");
    expect(drilldownUrl.searchParams.get("tableWindowWeeks")).toBe("4");
    expect(drilldownUrl.searchParams.get("limit")).toBe("1000");

    fireEvent.click(within(dialog).getByRole("button", { name: "Close JIRA cards" }));
    expect(screen.queryByRole("dialog", { name: "Created cards" })).not.toBeInTheDocument();
  });

  it("makes every work-stream and total metric available as a drill-down", async () => {
    const emptyDeepDivePayload = {
      source: "local",
      scope: "initiative-deep-dive",
      generatedAt: "2026-08-11T02:05:00+00:00",
      timezone: "Australia/Melbourne",
      group: null,
      groups: [],
      selectedGroupIds: [],
      epicOptions: [],
      selectedEpicKeys: [],
      selectionMode: "all",
      chartWeeks: 4,
      chartRange: { startDate: "2026-07-20", endDate: "2026-08-16", days: 28 },
      reportingPeriod: { startDate: "2026-07-20", endDate: "2026-08-16", days: 28 },
      weekly: [],
      periods: [],
      selectedPeriod: { weeks: 4, startDate: "2026-07-20", endDate: "2026-08-16", days: 28 },
      currentWipCount: 0,
      tableCounts: { all: 0, new: 0, inProgress: 0, completed: 0 },
      activity: "all",
      count: 0,
      limit: 1000,
      truncated: false,
      cards: [],
      error: null,
    };
    setupFetchMock({
      "/api/team/dashboard": dashboardPayload,
      "/api/initiative-deep-dive": emptyDeepDivePayload,
    });
    render(<TeamDashboardScreen />);

    await screen.findByRole("button", { name: "View 3 configured JIRA epics for Platform Delivery" });
    const drilldowns = [
      ["View 3 configured JIRA epics for Platform Delivery", "Configured epics"],
      ["View 15 completed JIRA cards for Platform Delivery", "Completed cards"],
      ["View JIRA cards contributing to the 3 reduced flow gap for Platform Delivery", "Flow gap cards"],
      ["View 4 current WIP JIRA cards for Platform Delivery", "Current WIP cards"],
      ["View 20 delivery progress JIRA cards for Platform Delivery", "Delivery progress cards"],
      ["View 4 configured JIRA epics for all work streams", "Configured epics"],
      ["View 19 created JIRA cards for all work streams", "Created cards"],
      ["View 19 completed JIRA cards for all work streams", "Completed cards"],
      ["View JIRA cards contributing to the Balanced flow gap for all work streams", "Flow gap cards"],
      ["View 6 current WIP JIRA cards for all work streams", "Current WIP cards"],
      ["View 30 delivery progress JIRA cards for all work streams", "Delivery progress cards"],
    ] as const;

    for (const [buttonName, dialogName] of drilldowns) {
      fireEvent.click(screen.getByRole("button", { name: buttonName }));
      const dialog = await screen.findByRole("dialog", { name: dialogName });
      fireEvent.click(within(dialog).getByRole("button", { name: "Close JIRA cards" }));
    }
  });

  it("renders metric-specific issue details, epic links, and keyboard dismissal", async () => {
    const overlayPayload = {
      source: "local",
      scope: "initiative-deep-dive",
      generatedAt: "2026-08-11T02:05:00+00:00",
      timezone: "Australia/Melbourne",
      group: { id: 5, name: "Platform Delivery", epicCount: 2 },
      groups: [{ id: 5, name: "Platform Delivery", epicCount: 2 }],
      selectedGroupIds: [5],
      epicOptions: [
        { epicKey: "TB-100", epicName: "Team reporting", issueUrl: "https://jira.example.test/browse/TB-100" },
        { epicKey: "TB-200", epicName: "Internal tooling", issueUrl: null },
      ],
      selectedEpicKeys: [],
      selectionMode: "all",
      chartWeeks: 4,
      chartRange: { startDate: "2026-07-20", endDate: "2026-08-16", days: 28 },
      reportingPeriod: { startDate: "2026-07-20", endDate: "2026-08-16", days: 28 },
      weekly: [],
      periods: [],
      selectedPeriod: { weeks: 4, startDate: "2026-07-20", endDate: "2026-08-16", days: 28 },
      currentWipCount: 1,
      tableCounts: { all: 1, new: 1, inProgress: 1, completed: 1 },
      activity: "all",
      count: 1,
      limit: 1000,
      truncated: true,
      cards: [
        {
          issueKey: "TB-12",
          issueUrl: "https://jira.example.test/browse/TB-12",
          summary: "Build dashboard overlay",
          issueType: "Story",
          epicKey: "TB-100",
          epicName: "Team reporting",
          status: "In Progress",
          statusCategory: "In Progress",
          storyPoints: 5,
          assigneeDisplayName: "Avery Chen",
          activityTypes: ["new", "in_progress", "completed"],
          latestActivityAt: "2026-08-10T03:00:00+00:00",
          createdAt: "2026-08-08T03:00:00+00:00",
          inProgressStartedAt: "2026-08-09T03:00:00+00:00",
          completedAt: "2026-08-10T03:00:00+00:00",
        },
      ],
      error: null,
    };
    setupFetchMock({ "/api/initiative-deep-dive": overlayPayload });

    const metrics: Array<{
      selection: TeamDashboardIssueSelection;
      title: string;
      description: string;
      activity?: string;
    }> = [
      {
        selection: { metric: "completed", scopeName: "Platform Delivery", groupIds: [5], value: 1 },
        title: "Completed cards",
        description: "1 card completed in the last week.",
        activity: "Completed",
      },
      {
        selection: { metric: "currentWip", scopeName: "Platform Delivery", groupIds: [5], value: 1 },
        title: "Current WIP cards",
        description: "1 card is currently in progress.",
        activity: "Current WIP",
      },
      {
        selection: { metric: "flowGap", scopeName: "Platform Delivery", groupIds: [5], value: 2 },
        title: "Flow gap cards",
        description: "+2 net flow. 1 unique card was created or completed in the last week; a card can contribute to both.",
        activity: "Created, In progress, Completed",
      },
      {
        selection: {
          metric: "deliveryProgress",
          scopeName: "Platform Delivery",
          groupIds: [5],
          value: 50,
          completedCards: 1,
          totalCards: 2,
        },
        title: "Delivery progress cards",
        description: "1 of 2 scoped cards are complete.",
        activity: "In scope",
      },
    ];

    for (const entry of metrics) {
      const { unmount } = render(
        <TeamDashboardIssueOverlay selection={entry.selection} flowWeeks={1} onClose={vi.fn()} />,
      );
      const dialog = await screen.findByRole("dialog", { name: entry.title });
      expect(within(dialog).getByText(entry.description)).toBeInTheDocument();
      expect(within(dialog).getByText(entry.activity as string)).toBeInTheDocument();
      unmount();
    }

    const onClose = vi.fn();
    render(
      <TeamDashboardIssueOverlay
        selection={{ metric: "epics", scopeName: "Platform Delivery", groupIds: [5], value: 2 }}
        flowWeeks={4}
        onClose={onClose}
      />,
    );
    const epicDialog = await screen.findByRole("dialog", { name: "Configured epics" });
    expect(within(epicDialog).getByText("2 configured JIRA epics.")).toBeInTheDocument();
    expect(within(epicDialog).getByRole("link", { name: "TB-100" })).toHaveAttribute(
      "href",
      "https://jira.example.test/browse/TB-100",
    );
    expect(within(epicDialog).getByText("TB-200")).not.toHaveRole("link");
    expect(within(epicDialog).queryByText(/Showing the first/)).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("handles issue-overlay errors, retry, truncation, sorting, and empty results", async () => {
    const responsePayload = {
      source: "local",
      scope: "initiative-deep-dive",
      generatedAt: "2026-08-11T02:05:00+00:00",
      timezone: "Australia/Melbourne",
      group: null,
      groups: [],
      selectedGroupIds: [5],
      epicOptions: [],
      selectedEpicKeys: [],
      selectionMode: "all",
      chartWeeks: 4,
      chartRange: { startDate: "2026-07-20", endDate: "2026-08-16", days: 28 },
      reportingPeriod: { startDate: "2026-07-20", endDate: "2026-08-16", days: 28 },
      weekly: [],
      periods: [],
      selectedPeriod: { weeks: 4, startDate: "2026-07-20", endDate: "2026-08-16", days: 28 },
      currentWipCount: 0,
      tableCounts: { all: 2, new: 2, inProgress: 0, completed: 0 },
      activity: "new",
      count: 12,
      limit: 2,
      truncated: true,
      cards: [
        {
          issueKey: "TB-9",
          issueUrl: null,
          summary: "Zebra task",
          issueType: "Task",
          epicKey: "TB-100",
          epicName: "",
          status: "",
          statusCategory: "To Do",
          storyPoints: null,
          assigneeDisplayName: null,
          activityTypes: [],
          latestActivityAt: "invalid",
          createdAt: "invalid",
        },
        {
          issueKey: "TB-2",
          issueUrl: "https://jira.example.test/browse/TB-2",
          summary: "Alpha task",
          issueType: "Story",
          epicKey: "TB-200",
          epicName: "Delivery",
          status: "To Do",
          statusCategory: "To Do",
          storyPoints: 3,
          assigneeDisplayName: "Morgan Lee",
          activityTypes: ["new"],
          latestActivityAt: "2026-08-09T03:00:00+00:00",
          createdAt: "2026-08-09T03:00:00+00:00",
        },
      ],
      error: null,
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("JIRA details offline"))
      .mockResolvedValue(new Response(JSON.stringify(responsePayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    const onClose = vi.fn();
    const { unmount } = render(
      <TeamDashboardIssueOverlay
        selection={{ metric: "created", scopeName: "All work streams", groupIds: [5, 8], value: 12 }}
        flowWeeks={4}
        onClose={onClose}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("JIRA details offline");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    const tableRegion = await screen.findByRole("region", { name: "Created cards table" });
    expect(screen.getByText("Showing the first 2 of 12 matching cards.")).toBeInTheDocument();
    expect(within(tableRegion).getByText("TB-9")).not.toHaveRole("link");
    expect(within(tableRegion).getAllByText("—").length).toBeGreaterThan(0);
    fireEvent.click(within(tableRegion).getByRole("button", { name: "Sort by Story points (descending)" }));
    fireEvent.click(within(tableRegion).getByRole("button", { name: "Sort by Relevant date (descending)" }));
    fireEvent.click(document.querySelector(".tb-modal-backdrop") as HTMLElement);
    expect(onClose).toHaveBeenCalledOnce();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    unmount();

    setupFetchMock({
      "/api/initiative-deep-dive": { ...responsePayload, count: 0, truncated: false, cards: [] },
    });
    render(
      <TeamDashboardIssueOverlay
        selection={{ metric: "created", scopeName: "Platform Delivery", groupIds: [5], value: 0 }}
        flowWeeks={4}
        onClose={vi.fn()}
      />,
    );
    expect(await screen.findByText("No matching JIRA cards were found.")).toBeInTheDocument();
  });

  it("persists and refreshes the selected work-stream flow period", async () => {
    const fetchSpy = setupFetchMock({ "/api/team/dashboard": dashboardPayload });
    render(<TeamDashboardScreen />);

    expect(await screen.findByRole("combobox", { name: /Flow period/ })).toHaveValue("4");
    fireEvent.change(screen.getByRole("combobox", { name: /Flow period/ }), { target: { value: "12" } });

    await waitFor(() => {
      expect(fetchSpy.mock.calls.some(([input]) => new URL(String(input)).searchParams.get("flowWeeks") === "12")).toBe(true);
    });
    expect(persistence.setPreference).toHaveBeenCalledWith("teambeacon.teamDashboard.flowWeeks", "12");
  });

  it("uses the saved Team Insights statuses for sprint cycle time", async () => {
    vi.mocked(persistence.getPreferenceSync).mockImplementation((key) => (
      key === "teambeacon.teamInsights.settings"
        ? JSON.stringify({
          selectedCycleTimeStatusKeys: ["In Progress", " Code Review ", "in progress"],
        })
        : null
    ));
    const fetchSpy = setupFetchMock({ "/api/team/dashboard": dashboardPayload });

    render(<TeamDashboardScreen />);

    await screen.findByText("3.4 days");
    const requestUrl = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(requestUrl.searchParams.get("cycleTimeStatusMode")).toBe("custom");
    expect(requestUrl.searchParams.getAll("cycleTimeStatus")).toEqual(["in progress", "code review"]);
  });

  it("calls out a slower sprint cycle-time trend", async () => {
    setupFetchMock({
      "/api/team/dashboard": {
        ...dashboardPayload,
        sprintCycleTime: {
          ...dashboardPayload.sprintCycleTime,
          latestAverageDays: 5.1,
          deltaDays: 0.9,
          direction: "up",
        },
      },
    });

    render(<TeamDashboardScreen />);

    expect(await screen.findByText("0.9 days slower")).toHaveClass("is-warning");
  });

  it("shows recoverable full and partial failure states", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Backend offline" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ...dashboardPayload,
        latestRelease: null,
        sprintCycleTime: null,
        blockedItems: { sprintId: null, sprintName: null, count: 0, storyPointsTotal: 0, items: [] },
        recentlyCompleted: { windowDays: 7, count: 0, items: [] },
        workStreams: [],
        errors: { releases: "Release insights unavailable" },
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const onOpenSettings = vi.fn();

    render(<TeamDashboardScreen onOpenSettings={onOpenSettings} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Team dashboard request failed (503)");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Some dashboard sections could not be refreshed.")).toBeInTheDocument();
    expect(screen.getByText("No work streams configured")).toBeInTheDocument();
    expect(screen.getByText("No completed release")).toBeInTheDocument();
    expect(screen.getByText("No completed sprint data")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open Settings" }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
