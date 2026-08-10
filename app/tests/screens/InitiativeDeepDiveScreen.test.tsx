import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { vi } from "vitest";
import * as persistence from "../../src/lib/persistence";
import { setupFetchMock } from "../utils/fetchMock";

const { chartCalls } = vi.hoisted(() => ({
  chartCalls: [] as Array<{ canvas: HTMLCanvasElement; config: any; destroy: ReturnType<typeof vi.fn> }>,
}));

vi.mock("chart.js/auto", () => {
  const Chart = vi.fn(function MockChart(this: unknown, canvas: HTMLCanvasElement, config: any) {
    const call = { canvas, config, destroy: vi.fn() };
    chartCalls.push(call);
    return call;
  });
  return { default: Chart };
});

import { InitiativeDeepDiveScreen } from "../../src/components/content/screens/InitiativeDeepDiveScreen";

const deepDivePayload = {
  source: "local",
  scope: "initiative-deep-dive",
  generatedAt: "2026-08-10T02:00:00+00:00",
  timezone: "Australia/Melbourne",
  group: null,
  groups: [
    { id: 5, name: "Platform", epicCount: 2 },
    { id: 8, name: "Operations", epicCount: 0 },
  ],
  selectedGroupIds: [5, 8],
  epicOptions: [
    { epicKey: "TB-100", epicName: "Platform foundations" },
    { epicKey: "TB-200", epicName: "Platform experience" },
  ],
  selectedEpicKeys: [],
  selectionMode: "all",
  chartWeeks: 12,
  chartRange: { startDate: "2026-05-25", endDate: "2026-08-10", days: 78 },
  reportingPeriod: { startDate: "2026-05-25", endDate: "2026-08-10", days: 78 },
  weekly: [
    { weekStart: "2026-07-27", weekEnd: "2026-08-02", newCount: 3, completedCount: 2, netFlow: 1 },
    { weekStart: "2026-08-03", weekEnd: "2026-08-09", newCount: 4, completedCount: 5, netFlow: -1 },
    { weekStart: "2026-08-10", weekEnd: "2026-08-10", newCount: 1, completedCount: 0, netFlow: 1 },
  ],
  periods: [
    { weeks: 1, startDate: "2026-08-10", endDate: "2026-08-10", newCount: 1, completedCount: 0, netFlow: 1 },
    { weeks: 2, startDate: "2026-08-03", endDate: "2026-08-10", newCount: 5, completedCount: 6, netFlow: -1 },
    { weeks: 4, startDate: "2026-07-20", endDate: "2026-08-10", newCount: 8, completedCount: 7, netFlow: 1 },
    { weeks: 12, startDate: "2026-05-25", endDate: "2026-08-10", newCount: 24, completedCount: 21, netFlow: 3 },
    { weeks: 26, startDate: "2026-02-16", endDate: "2026-08-10", newCount: 40, completedCount: 35, netFlow: 5 },
    { weeks: 52, startDate: "2025-08-18", endDate: "2026-08-10", newCount: 70, completedCount: 60, netFlow: 10 },
  ],
  selectedPeriod: { weeks: null, startDate: "2026-05-25", endDate: "2026-08-10", days: 78 },
  currentWipCount: 2,
  tableCounts: { all: 3, new: 2, inProgress: 1, completed: 1 },
  activity: "all",
  count: 2,
  limit: 500,
  truncated: false,
  cards: [
    {
      issueKey: "TB-1",
      issueUrl: "https://jira.example.test/browse/TB-1",
      summary: "Ship initiative deep dive",
      issueType: "Story",
      epicKey: "TB-100",
      epicName: "Platform foundations",
      epicUrl: "https://jira.example.test/browse/TB-100",
      status: "Done",
      statusCategory: "Done",
      storyPoints: 5,
      assigneeAccountId: "dev-1",
      assigneeDisplayName: "Asha Dev",
      activityTypes: ["new", "completed"],
      latestActivityAt: "2026-08-09T03:00:00+00:00",
      createdAt: "2026-08-04T02:00:00+00:00",
      inProgressStartedAt: null,
      completedAt: "2026-08-09T03:00:00+00:00",
    },
    {
      issueKey: "TB-2",
      issueUrl: "https://jira.example.test/browse/TB-2",
      summary: "Review flow metrics",
      issueType: "Task",
      epicKey: "TB-200",
      epicName: "Platform experience",
      epicUrl: "https://jira.example.test/browse/TB-200",
      status: "In Progress",
      statusCategory: "In Progress",
      storyPoints: 3,
      assigneeAccountId: "dev-2",
      assigneeDisplayName: null,
      activityTypes: ["in_progress"],
      latestActivityAt: "2026-08-05T01:00:00+00:00",
      createdAt: "2026-07-20T02:00:00+00:00",
      inProgressStartedAt: "2026-08-05T01:00:00+00:00",
      completedAt: null,
    },
  ],
  error: null,
};

describe("InitiativeDeepDiveScreen", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-10T12:00:00+10:00"));
    chartCalls.length = 0;
    vi.spyOn(persistence, "getPreferenceSync").mockReturnValue(null);
    vi.spyOn(persistence, "setPreference").mockResolvedValue();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("cascades group and epic scope into weekly flow and work-item activity", async () => {
    const fetchSpy = setupFetchMock({
      "/api/initiative-deep-dive": deepDivePayload,
      "/api/metadata/lookup": {
        groups: [
          { id: 5, name: "Platform" },
          { id: 8, name: "Operations" },
        ],
        workTypes: [],
      },
    });

    render(<InitiativeDeepDiveScreen />);

    expect(await screen.findByRole("heading", { name: "New and completed cards by week" })).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(new URL(String(fetchSpy.mock.calls[1][0])).searchParams.getAll("groupId")).toEqual(["5", "8"]);
    expect(screen.getByRole("img", { name: "New and completed cards by week" })).toBeInTheDocument();
    expect(screen.getByText("Ship initiative deep dive")).toHaveAttribute(
      "title",
      "Ship initiative deep dive",
    );
    expect(screen.getByText("Review flow metrics")).toBeInTheDocument();
    const activityTable = screen.getByRole("table");
    const columnHeaders = within(activityTable).getAllByRole("columnheader");
    expect(columnHeaders).toHaveLength(8);
    expect(columnHeaders.map((header) => header.querySelector("button span")?.textContent)).toEqual([
      "Activity",
      "Epic",
      "Key",
      "Title",
      "Current status",
      "Created",
      "In progress since",
      "Completed",
    ]);
    expect(within(activityTable).queryByRole("columnheader", { name: "Type" })).not.toBeInTheDocument();
    expect(within(activityTable).queryByRole("columnheader", { name: "Assignee" })).not.toBeInTheDocument();
    expect(within(activityTable).queryByRole("columnheader", { name: "SP" })).not.toBeInTheDocument();

    const issueLink = within(activityTable).getByRole("link", { name: "TB-1" });
    expect(issueLink).toHaveAttribute("href", "https://jira.example.test/browse/TB-1");
    expect(issueLink).toHaveAttribute("target", "_blank");
    expect(issueLink).toHaveAttribute("rel", "noopener noreferrer");
    const epicLink = within(activityTable).getByRole("link", { name: "Platform foundations" });
    expect(epicLink).toHaveAttribute("href", "https://jira.example.test/browse/TB-100");
    expect(epicLink).toHaveAttribute("target", "_blank");

    const issueOrder = () => within(activityTable).getAllByRole("row").slice(1).map((row) => (
      within(row).getByRole("link", { name: /^TB-/ }).textContent
    ));
    expect(issueOrder()).toEqual(["TB-1", "TB-2"]);
    const titleSort = within(activityTable).getByRole("button", { name: "Sort by Title (ascending)" });
    fireEvent.click(titleSort);
    expect(issueOrder()).toEqual(["TB-2", "TB-1"]);
    fireEvent.click(titleSort);
    expect(issueOrder()).toEqual(["TB-1", "TB-2"]);

    for (const label of ["Key", "Epic", "Current status", "Created", "In progress since", "Completed"]) {
      fireEvent.click(within(activityTable).getByRole("button", { name: new RegExp(`Sort by ${label}`) }));
    }
    fireEvent.click(within(activityTable).getByRole("button", { name: /Sort by Activity/ }));
    expect(within(activityTable).getByRole("columnheader", { name: /Activity/ })).toHaveAttribute("aria-sort", "descending");

    await waitFor(() => expect(chartCalls.length).toBeGreaterThan(0));
    const chart = chartCalls[chartCalls.length - 1];
    expect(chart.config.data.datasets[0].label).toBe("New cards");
    expect(chart.config.data.datasets[0].data).toEqual([3, 4, 1]);
    expect(chart.config.data.datasets[0].backgroundColor).toBe("#d97706");
    expect(chart.config.data.datasets[0].borderColor).toBe("#9a4d00");
    expect(chart.config.data.datasets[1].label).toBe("Completed cards");
    expect(chart.config.data.datasets[1].data).toEqual([2, 5, 0]);
    const tooltipCallbacks = chart.config.options.plugins.tooltip.callbacks;
    expect(tooltipCallbacks.title([{ dataIndex: 0 }])).toContain("2026");
    expect(tooltipCallbacks.title([{ dataIndex: 99 }])).toBe("");
    expect(tooltipCallbacks.title([])).toContain("2026");
    expect(tooltipCallbacks.afterBody([{ dataIndex: 0 }])).toBe("Net flow: +1");
    expect(tooltipCallbacks.afterBody([{ dataIndex: 1 }])).toBe("Net flow: -1");
    expect(tooltipCallbacks.afterBody([{ dataIndex: 99 }])).toBe("");
    expect(tooltipCallbacks.afterBody([])).toBe("Net flow: +1");

    const twelveWeekTile = screen.getByRole("button", { name: /Last 12 weeks New/ });
    expect(twelveWeekTile).toHaveAttribute("aria-pressed", "true");
    const fourWeekTile = screen.getByRole("button", { name: /Last 4 weeks/ });
    fireEvent.click(fourWeekTile);
    expect(fourWeekTile).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => {
      expect(fetchSpy.mock.calls.some(([input]) => {
        const url = new URL(String(input));
        return url.searchParams.get("chartWeeks") === "4" && !url.searchParams.has("tableWindowWeeks");
      })).toBe(true);
    });

    const selectedGroups = screen.getByLabelText("Selected groups");
    const selectedEpics = screen.getByLabelText("Selected epics");
    expect(within(selectedGroups).getByText("All groups")).toBeInTheDocument();
    expect(within(selectedEpics).getByText("All epics in selected groups (2)")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit scope" }));
    const scopeDialog = screen.getByRole("dialog", { name: "Choose groups and epics" });
    const groupOptions = within(scopeDialog).getByRole("group", { name: "Group options" });
    expect(within(groupOptions).getByRole("checkbox", { name: /All groups/ })).toBeChecked();
    expect(within(scopeDialog).getByRole("button", { name: "Apply scope" })).toBeDisabled();
    fireEvent.click(within(groupOptions).getByRole("checkbox", { name: /All groups/ }));

    const groupSearch = within(scopeDialog).getByRole("searchbox", { name: "Search groups" });
    fireEvent.change(groupSearch, { target: { value: "no matching group" } });
    expect(within(groupOptions).getByText("No matching groups.")).toBeInTheDocument();
    fireEvent.change(groupSearch, { target: { value: "oper" } });
    expect(within(groupOptions).queryByRole("checkbox", { name: "Platform" })).not.toBeInTheDocument();
    expect(within(groupOptions).getByRole("checkbox", { name: "Operations" })).toBeInTheDocument();
    fireEvent.change(groupSearch, { target: { value: "" } });
    fireEvent.click(within(groupOptions).getByRole("checkbox", { name: "Platform" }));
    fireEvent.click(within(groupOptions).getByRole("checkbox", { name: "Platform" }));
    fireEvent.click(within(groupOptions).getByRole("checkbox", { name: "Platform" }));

    expect(within(selectedGroups).getByText("All groups")).toBeInTheDocument();
    await waitFor(() => {
      const previewUrls = fetchSpy.mock.calls
        .map(([input]) => new URL(String(input)))
        .filter((url) => url.pathname.endsWith("/api/initiative-deep-dive") && url.searchParams.get("limit") === "1");
      expect(previewUrls.at(-1)?.searchParams.getAll("groupId")).toEqual(["5"]);
    });

    const epicOptions = within(scopeDialog).getByRole("group", { name: "Epic options" });
    await waitFor(() => expect(within(epicOptions).getByRole("checkbox", { name: /Platform foundations/ })).toBeInTheDocument());
    expect(within(epicOptions).getByRole("checkbox", { name: /All epics in selected groups/ })).toBeChecked();
    const epicSearch = within(scopeDialog).getByRole("searchbox", { name: "Search epics" });
    fireEvent.change(epicSearch, { target: { value: "experience" } });
    expect(within(epicOptions).queryByRole("checkbox", { name: /Platform foundations/ })).not.toBeInTheDocument();
    fireEvent.change(epicSearch, { target: { value: "" } });
    fireEvent.click(within(epicOptions).getByRole("checkbox", { name: /Platform foundations/ }));
    fireEvent.click(within(epicOptions).getByRole("checkbox", { name: /Platform foundations/ }));
    fireEvent.click(within(epicOptions).getByRole("checkbox", { name: /Platform foundations/ }));
    fireEvent.click(within(epicOptions).getByRole("checkbox", { name: /Platform experience/ }));
    fireEvent.click(within(epicOptions).getByRole("checkbox", { name: /Platform foundations/ }));
    fireEvent.click(within(scopeDialog).getByRole("button", { name: "Apply scope" }));

    await waitFor(() => {
      const appliedUrls = fetchSpy.mock.calls
        .map(([input]) => new URL(String(input)))
        .filter((url) => url.pathname.endsWith("/api/initiative-deep-dive") && url.searchParams.get("limit") === "500");
      expect(appliedUrls.at(-1)?.searchParams.getAll("groupId")).toEqual(["5"]);
      expect(appliedUrls.at(-1)?.searchParams.getAll("epicKey")).toEqual(["TB-100"]);
    });
    expect(within(selectedGroups).getByText("Platform")).toBeInTheDocument();
    expect(within(selectedEpics).getByText("Platform foundations")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit scope" }));
    const reopenedDialog = screen.getByRole("dialog", { name: "Choose groups and epics" });
    fireEvent.click(within(reopenedDialog).getByRole("checkbox", { name: /All groups/ }));
    await waitFor(() => expect(within(reopenedDialog).getByRole("checkbox", { name: /All epics in selected groups/ })).toBeInTheDocument());
    fireEvent.click(within(reopenedDialog).getByRole("checkbox", { name: /All epics in selected groups/ }));
    fireEvent.click(within(reopenedDialog).getByRole("button", { name: "Close scope picker" }));
    expect(screen.queryByRole("dialog", { name: "Choose groups and epics" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit scope" }));
    fireEvent.click(document.querySelector(".tb-modal-backdrop") as HTMLElement);
    expect(screen.queryByRole("dialog", { name: "Choose groups and epics" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit scope" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Choose groups and epics" })).not.toBeInTheDocument();
  });

  it("shows named scope pills, collapses overflow, and supports direct removal", async () => {
    const expandedEpicOptions = [
      { epicKey: "TB-100", epicName: "Platform foundations" },
      { epicKey: "TB-200", epicName: "Platform experience" },
      { epicKey: "TB-300", epicName: "Search foundations" },
      { epicKey: "TB-400", epicName: "Operations rollout" },
      { epicKey: "TB-500", epicName: "Developer experience" },
    ];
    vi.mocked(persistence.getPreferenceSync).mockReturnValue(JSON.stringify({
      groupIds: [1, 2, 3, 4],
      epicKeys: ["TB-100", "TB-200", "TB-300", "TB-400"],
    }));
    const fetchSpy = setupFetchMock({
      "/api/initiative-deep-dive": { ...deepDivePayload, epicOptions: expandedEpicOptions },
      "/api/metadata/lookup": {
        groups: [
          { id: 1, name: "Platform" },
          { id: 2, name: "Operations" },
          { id: 3, name: "Search AI" },
          { id: 4, name: "Developer Experience" },
          { id: 5, name: "Security" },
        ],
        workTypes: [],
      },
    });

    render(<InitiativeDeepDiveScreen />);

    expect(await screen.findByRole("button", { name: "Remove epic Platform foundations" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove group Platform" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "+1 more" })).toHaveLength(2);

    fireEvent.click(screen.getAllByRole("button", { name: "+1 more" })[0]);
    expect(screen.getByRole("dialog", { name: "Choose groups and epics" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    fireEvent.click(screen.getByRole("button", { name: "Remove epic Platform foundations" }));
    await waitFor(() => {
      const latestUrl = new URL(String(fetchSpy.mock.calls.at(-1)?.[0]));
      expect(latestUrl.searchParams.getAll("epicKey")).toEqual(["TB-200", "TB-300", "TB-400"]);
    });
    expect(screen.queryByRole("button", { name: "Remove epic Platform foundations" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove group Platform" }));
    await waitFor(() => {
      const latestUrl = new URL(String(fetchSpy.mock.calls.at(-1)?.[0]));
      expect(latestUrl.searchParams.getAll("groupId")).toEqual(["2", "3", "4"]);
      expect(latestUrl.searchParams.getAll("epicKey")).toEqual([]);
    });
    expect(screen.queryByRole("button", { name: "Remove group Platform" })).not.toBeInTheDocument();
  });

  it("keeps the applied scope when eligible epics cannot be previewed", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/api/metadata/lookup")) {
        return Promise.resolve(new Response(JSON.stringify({
          groups: [{ id: 5, name: "Platform" }, { id: 8, name: "Operations" }],
          workTypes: [],
        }), { status: 200, headers: { "Content-Type": "application/json" } }));
      }
      if (url.searchParams.get("limit") === "1") {
        return Promise.resolve(new Response(JSON.stringify({ detail: "Preview unavailable" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }));
      }
      return Promise.resolve(new Response(JSON.stringify(deepDivePayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    });

    render(<InitiativeDeepDiveScreen />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Edit scope" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Edit scope" }));
    const dialog = screen.getByRole("dialog", { name: "Choose groups and epics" });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Platform" }));

    expect(await within(dialog).findByText("Preview unavailable")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Apply scope" })).toBeDisabled();
    expect(within(screen.getByLabelText("Selected groups")).getByText("All groups")).toBeInTheDocument();
  });

  it("filters activity and resets current WIP when a weekly tile is selected", async () => {
    const fetchSpy = setupFetchMock({
      "/api/initiative-deep-dive": deepDivePayload,
      "/api/metadata/lookup": { groups: [{ id: 5, name: "Platform" }], workTypes: [] },
    });
    render(<InitiativeDeepDiveScreen />);
    await screen.findByRole("heading", { name: "New and completed cards by week" });

    const activityToolbar = screen.getByRole("toolbar", { name: "Work item activity filter" });
    fireEvent.click(within(activityToolbar).getByRole("button", { name: "New, 2 cards" }));
    await waitFor(() => {
      expect(fetchSpy.mock.calls.some(([input]) => String(input).includes("activity=new"))).toBe(true);
    });

    fireEvent.click(within(activityToolbar).getByRole("button", { name: "Current WIP, 2 cards" }));
    expect(screen.getByRole("heading", { name: "Current work in progress" })).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchSpy.mock.calls.some(([input]) => String(input).includes("activity=current_wip"))).toBe(true);
    });

    fireEvent.click(screen.getByRole("button", { name: /Last 2 weeks/ }));
    expect(screen.getByRole("heading", { name: /Activity · .*Aug 10, 2026/ })).toBeInTheDocument();
    await waitFor(() => {
      expect(
        fetchSpy.mock.calls.some(([input]) => {
          const url = String(input);
          return url.includes("chartWeeks=2") && !url.includes("tableWindowWeeks") && url.includes("activity=all");
        }),
      ).toBe(true);
    });
  });

  it("offers 26- and 52-week reporting-period shortcuts", async () => {
    const fetchSpy = setupFetchMock({
      "/api/initiative-deep-dive": deepDivePayload,
      "/api/metadata/lookup": { groups: [{ id: 5, name: "Platform" }], workTypes: [] },
    });
    render(<InitiativeDeepDiveScreen />);
    await screen.findByRole("heading", { name: "Compare and select a weekly range" });

    const twentySixWeekTile = screen.getByRole("button", { name: /Last 26 weeks New 40/ });
    const fiftyTwoWeekTile = screen.getByRole("button", { name: /Last 52 weeks New 70/ });
    fireEvent.click(twentySixWeekTile);
    expect(twentySixWeekTile).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(fetchSpy.mock.calls.some(([input]) => (
      new URL(String(input)).searchParams.get("chartWeeks") === "26"
    ))).toBe(true));

    fireEvent.click(fiftyTwoWeekTile);
    expect(fiftyTwoWeekTile).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(fetchSpy.mock.calls.some(([input]) => (
      new URL(String(input)).searchParams.get("chartWeeks") === "52"
    ))).toBe(true));
  });

  it("configures one reporting period for the chart, shortcuts, and activity table", async () => {
    const fetchSpy = setupFetchMock({
      "/api/initiative-deep-dive": deepDivePayload,
      "/api/metadata/lookup": { groups: [{ id: 5, name: "Platform" }], workTypes: [] },
    });
    render(<InitiativeDeepDiveScreen />);

    await screen.findByRole("heading", { name: "New and completed cards by week" });
    expect(screen.getByText("Card flow")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Configure reporting period: Last 12 weeks" }));
    let dialog = screen.getByRole("dialog", { name: "Configure Reporting Period" });
    const rangeSelect = within(dialog).getByRole("combobox", { name: "Reporting Period" });
    fireEvent.change(rangeSelect, { target: { value: "last_4_weeks" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(fetchSpy.mock.calls.some(([input]) => String(input).includes("chartWeeks=4"))).toBe(true);
    });
    expect(screen.getByRole("button", { name: "Configure reporting period: Last 4 weeks" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Last 4 weeks New/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Last 12 weeks New/ })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("heading", { name: /Activity · .*Aug 10, 2026/ })).toBeInTheDocument();

    const activityToolbar = screen.getByRole("toolbar", { name: "Work item activity filter" });
    fireEvent.click(within(activityToolbar).getByRole("button", { name: "Current WIP, 2 cards" }));
    expect(screen.getByRole("heading", { name: "Current work in progress" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Configure reporting period: Last 4 weeks" }));
    dialog = screen.getByRole("dialog", { name: "Configure Reporting Period" });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Reporting Period" }), {
      target: { value: "custom" },
    });
    fireEvent.input(within(dialog).getByLabelText("Start"), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(within(dialog).getByText("Start and end date are required.")).toBeInTheDocument();

    fireEvent.input(within(dialog).getByLabelText("Start"), { target: { value: "2026-08-01" } });
    fireEvent.input(within(dialog).getByLabelText("End"), { target: { value: "2026-08-11" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(within(dialog).getByText("End date cannot be after today.")).toBeInTheDocument();

    fireEvent.input(within(dialog).getByLabelText("Start"), { target: { value: "2025-07-01" } });
    fireEvent.input(within(dialog).getByLabelText("End"), { target: { value: "2026-07-30" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(within(dialog).getByText("Reporting period cannot exceed 366 days.")).toBeInTheDocument();

    fireEvent.input(within(dialog).getByLabelText("Start"), { target: { value: "2026-08-09" } });
    fireEvent.input(within(dialog).getByLabelText("End"), { target: { value: "2026-08-01" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(within(dialog).getByText("Start date cannot be after end date.")).toBeInTheDocument();

    fireEvent.input(within(dialog).getByLabelText("Start"), { target: { value: "2026-07-24" } });
    fireEvent.input(within(dialog).getByLabelText("End"), { target: { value: "2026-07-30" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const customUrl = fetchSpy.mock.calls
        .map(([input]) => new URL(String(input)))
        .find((url) => url.searchParams.get("chartStart") === "2026-07-24");
      expect(customUrl?.searchParams.get("chartEnd")).toBe("2026-07-30");
      expect(customUrl?.searchParams.has("chartWeeks")).toBe(false);
    });
    expect(screen.getByRole("button", { name: "Configure reporting period: Custom" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Activity · Jul 24, 2026 – Jul 30, 2026/ })).toBeInTheDocument();
    expect(within(activityToolbar).getByRole("button", { name: "All activity, 3 cards" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(persistence.setPreference).toHaveBeenCalledWith(
      "teambeacon.initiativeDeepDive.trend.period",
      JSON.stringify({ preset: "custom", startDate: "2026-07-24", endDate: "2026-07-30" }),
    ));

    fireEvent.click(screen.getByRole("button", { name: "Configure reporting period: Custom" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Configure Reporting Period" })).not.toBeInTheDocument();
  });

  it("restores a persisted custom trend range", async () => {
    vi.mocked(persistence.getPreferenceSync).mockImplementation((key) => (
      key === "teambeacon.initiativeDeepDive.trend.period"
        ? JSON.stringify({ preset: "custom", startDate: "2026-07-01", endDate: "2026-07-31" })
        : null
    ));
    const fetchSpy = setupFetchMock({
      "/api/initiative-deep-dive": deepDivePayload,
      "/api/metadata/lookup": { groups: [{ id: 5, name: "Platform" }], workTypes: [] },
    });

    render(<InitiativeDeepDiveScreen />);

    expect(await screen.findByRole("button", { name: "Configure reporting period: Custom" })).toBeInTheDocument();
    const initialDeepDiveUrl = fetchSpy.mock.calls
      .map(([input]) => new URL(String(input)))
      .find((url) => url.pathname.endsWith("/api/initiative-deep-dive"));
    expect(initialDeepDiveUrl?.searchParams.get("chartStart")).toBe("2026-07-01");
    expect(initialDeepDiveUrl?.searchParams.get("chartEnd")).toBe("2026-07-31");
  });

  it("restores a persisted trend preset", async () => {
    vi.mocked(persistence.getPreferenceSync).mockImplementation((key) => (
      key === "teambeacon.initiativeDeepDive.trend.period"
        ? JSON.stringify({ preset: "last_8_weeks", startDate: "", endDate: "" })
        : null
    ));
    const fetchSpy = setupFetchMock({
      "/api/initiative-deep-dive": deepDivePayload,
      "/api/metadata/lookup": { groups: [{ id: 5, name: "Platform" }], workTypes: [] },
    });

    render(<InitiativeDeepDiveScreen />);

    expect(await screen.findByRole("button", { name: "Configure reporting period: Last 8 weeks" })).toBeInTheDocument();
    const initialDeepDiveUrl = fetchSpy.mock.calls
      .map(([input]) => new URL(String(input)))
      .find((url) => url.pathname.endsWith("/api/initiative-deep-dive"));
    expect(initialDeepDiveUrl?.searchParams.get("chartWeeks")).toBe("8");
    expect(initialDeepDiveUrl?.searchParams.has("chartStart")).toBe(false);
  });

  it.each([
    JSON.stringify({ preset: "custom", startDate: "not-a-date", endDate: "2026-07-31" }),
    JSON.stringify({ preset: "custom", startDate: "2025-01-01", endDate: "2026-07-31" }),
  ])("falls back from an invalid persisted custom trend range", async (persistedTrend) => {
    vi.mocked(persistence.getPreferenceSync).mockImplementation((key) => (
      key === "teambeacon.initiativeDeepDive.trend.period" ? persistedTrend : null
    ));
    const fetchSpy = setupFetchMock({
      "/api/initiative-deep-dive": deepDivePayload,
      "/api/metadata/lookup": { groups: [{ id: 5, name: "Platform" }], workTypes: [] },
    });

    render(<InitiativeDeepDiveScreen />);

    expect(await screen.findByRole("button", { name: "Configure reporting period: Last 12 weeks" })).toBeInTheDocument();
    const initialDeepDiveUrl = fetchSpy.mock.calls
      .map(([input]) => new URL(String(input)))
      .find((url) => url.pathname.endsWith("/api/initiative-deep-dive"));
    expect(initialDeepDiveUrl?.searchParams.get("chartWeeks")).toBe("12");
    expect(initialDeepDiveUrl?.searchParams.has("chartStart")).toBe(false);
  });

  it("renders empty and truncated table states with resilient card formatting", async () => {
    const edgePayload = {
      ...deepDivePayload,
      periods: deepDivePayload.periods.filter((period) => period.weeks !== 1),
      count: 1,
      limit: 1,
      truncated: true,
      cards: [
        {
          ...deepDivePayload.cards[0],
          issueKey: "TB-EDGE",
          issueUrl: null,
          epicUrl: null,
          issueType: "",
          status: "Selected for development",
          statusCategory: "To Do",
          storyPoints: 1.25,
          assigneeAccountId: null,
          assigneeDisplayName: null,
          activityTypes: ["new"],
          createdAt: "not-a-date",
          completedAt: null,
        },
        {
          ...deepDivePayload.cards[1],
          issueKey: "TB-NO-SP",
          issueUrl: null,
          epicUrl: null,
          storyPoints: Number.NaN,
        },
      ],
    };
    setupFetchMock({
      "/api/initiative-deep-dive": edgePayload,
      "/api/metadata/lookup": { groups: [{ id: 5, name: "Platform" }], workTypes: [] },
    });
    render(<InitiativeDeepDiveScreen />);

    expect(await screen.findByText("TB-EDGE")).toBeInTheDocument();
    expect(screen.getByText("1 matching card")).toBeInTheDocument();
    expect(screen.getByText("not-a-date")).toBeInTheDocument();
    expect(screen.getByText("Showing the first 1 cards, newest activity first.")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /Last 1 week/ }));
    expect(screen.getByRole("heading", { name: /Activity · Aug 10, 2026 – Aug 10, 2026/ })).toBeInTheDocument();
  });

  it("shows an empty result and recovers from a failed deep-dive request", async () => {
    let deepDiveAttempts = 0;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/metadata/lookup")) {
        return Promise.resolve(new Response(JSON.stringify({ groups: [{ id: 5, name: "Platform" }], workTypes: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      }
      deepDiveAttempts += 1;
      if (deepDiveAttempts === 1) return Promise.reject("offline");
      return Promise.resolve(new Response(JSON.stringify({ ...deepDivePayload, count: 0, cards: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    });

    render(<InitiativeDeepDiveScreen />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load initiative deep dive.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("No cards match this scope, period, and activity filter.")).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("shows setup guidance when no initiative groups are configured", async () => {
    const fetchSpy = setupFetchMock({
      "/api/metadata/lookup": { groups: [], workTypes: [] },
    });

    render(<InitiativeDeepDiveScreen />);

    expect(await screen.findByRole("heading", { name: "No initiative groups configured" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit scope" })).toBeDisabled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("restores and validates persisted group and epic scope", async () => {
    vi.mocked(persistence.getPreferenceSync).mockReturnValue(JSON.stringify({
      groupIds: [8, 99, 8],
      epicKeys: ["tb-200", "MISSING", "TB-200"],
    }));
    const fetchSpy = setupFetchMock({
      "/api/initiative-deep-dive": deepDivePayload,
      "/api/metadata/lookup": {
        groups: [
          { id: 5, name: "Platform" },
          { id: 8, name: "Operations" },
        ],
        workTypes: [],
      },
    });

    render(<InitiativeDeepDiveScreen />);

    expect(await screen.findByRole("button", { name: "Remove group Operations" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove epic Platform experience" })).toBeInTheDocument());

    const deepDiveUrls = fetchSpy.mock.calls
      .map(([input]) => String(input))
      .filter((url) => url.includes("/api/initiative-deep-dive"))
      .map((url) => new URL(url));
    expect(deepDiveUrls).toHaveLength(2);
    expect(deepDiveUrls[0].searchParams.getAll("groupId")).toEqual(["8"]);
    expect(deepDiveUrls[0].searchParams.getAll("epicKey")).toEqual([]);
    expect(deepDiveUrls[1].searchParams.getAll("groupId")).toEqual(["8"]);
    expect(deepDiveUrls[1].searchParams.getAll("epicKey")).toEqual(["TB-200"]);
    await waitFor(() => expect(persistence.setPreference).toHaveBeenCalledWith(
      "teambeacon.initiativeDeepDive.scope",
      JSON.stringify({ groupIds: [8], epicKeys: ["TB-200"] }),
    ));
  });

  it("falls back to all scope when persisted selections have the wrong shape", async () => {
    vi.mocked(persistence.getPreferenceSync).mockReturnValue(JSON.stringify({
      groupIds: "5",
      epicKeys: { key: "TB-100" },
    }));
    setupFetchMock({
      "/api/initiative-deep-dive": deepDivePayload,
      "/api/metadata/lookup": {
        groups: [{ id: 5, name: "Platform" }, { id: 8, name: "Operations" }],
        workTypes: [],
      },
    });

    render(<InitiativeDeepDiveScreen />);

    const selectedGroups = await screen.findByLabelText("Selected groups");
    expect(within(selectedGroups).getByText("All groups")).toBeInTheDocument();
    expect(await within(screen.getByLabelText("Selected epics")).findByText("All epics in selected groups (2)")).toBeInTheDocument();
  });
});
