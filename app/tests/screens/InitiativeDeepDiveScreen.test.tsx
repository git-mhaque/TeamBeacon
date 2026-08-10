import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { vi } from "vitest";
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
  group: { id: 5, name: "Platform", epicCount: 2 },
  epicOptions: [
    { epicKey: "TB-100", epicName: "Platform foundations" },
    { epicKey: "TB-200", epicName: "Platform experience" },
  ],
  selectedEpicKeys: [],
  selectionMode: "all",
  chartWeeks: 12,
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
  ],
  selectedPeriod: { weeks: 12, startDate: "2026-05-25", endDate: "2026-08-10" },
  currentWipCount: 2,
  tableCounts: { all: 3, new: 2, inProgress: 1, completed: 1 },
  activity: "all",
  count: 2,
  limit: 500,
  truncated: false,
  cards: [
    {
      issueKey: "TB-1",
      summary: "Ship initiative deep dive",
      issueType: "Story",
      epicKey: "TB-100",
      epicName: "Platform foundations",
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
      summary: "Review flow metrics",
      issueType: "Task",
      epicKey: "TB-200",
      epicName: "Platform experience",
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
    chartCalls.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

    expect(await screen.findByRole("heading", { name: "Select an initiative group to begin" })).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByRole("combobox", { name: "Initiative group" }), { target: { value: "5" } });

    expect(await screen.findByRole("heading", { name: "New and completed cards by week" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "New and completed cards by week" })).toBeInTheDocument();
    expect(screen.getByText("Ship initiative deep dive")).toBeInTheDocument();
    expect(screen.getByText("Review flow metrics")).toBeInTheDocument();
    expect(screen.getByText("Asha Dev")).toBeInTheDocument();
    expect(screen.getByText("dev-2")).toBeInTheDocument();

    await waitFor(() => expect(chartCalls.length).toBeGreaterThan(0));
    const chart = chartCalls[chartCalls.length - 1];
    expect(chart.config.data.datasets[0].label).toBe("New cards");
    expect(chart.config.data.datasets[0].data).toEqual([3, 4, 1]);
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

    const twelveWeekTile = screen.getByRole("button", { name: /Last 12 weeks/ });
    expect(twelveWeekTile).toHaveAttribute("aria-pressed", "true");
    const fourWeekTile = screen.getByRole("button", { name: /Last 4 weeks/ });
    fireEvent.click(fourWeekTile);
    expect(fourWeekTile).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => {
      expect(fetchSpy.mock.calls.some(([input]) => String(input).includes("tableWindowWeeks=4"))).toBe(true);
    });

    const epicTrigger = screen.getByRole("button", { name: "Epic" });
    fireEvent.click(epicTrigger);
    const epicOptions = screen.getByRole("group", { name: "Epic options" });
    fireEvent.mouseDown(epicOptions);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(within(epicOptions).getByRole("checkbox", { name: /All epics/ })).toBeChecked();
    fireEvent.click(within(epicOptions).getByRole("checkbox", { name: /TB-100/ }));
    await waitFor(() => {
      expect(fetchSpy.mock.calls.some(([input]) => String(input).includes("epicKey=TB-100"))).toBe(true);
    });

    fireEvent.click(within(epicOptions).getByRole("checkbox", { name: /TB-200/ }));
    expect(within(epicOptions).getByRole("checkbox", { name: /All epics/ })).toBeChecked();
    fireEvent.click(within(epicOptions).getByRole("checkbox", { name: /TB-100/ }));
    fireEvent.click(within(epicOptions).getByRole("checkbox", { name: /TB-100/ }));
    expect(within(epicOptions).getByRole("checkbox", { name: /All epics/ })).toBeChecked();
    fireEvent.click(within(epicOptions).getByRole("checkbox", { name: /All epics/ }));

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Epic options" })).not.toBeInTheDocument();
    fireEvent.click(epicTrigger);
    expect(screen.getByRole("group", { name: "Epic options" })).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("group", { name: "Epic options" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Initiative group" }), { target: { value: "" } });
    expect(screen.getByRole("heading", { name: "Select an initiative group to begin" })).toBeInTheDocument();
  });

  it("filters activity and resets current WIP when a weekly tile is selected", async () => {
    const fetchSpy = setupFetchMock({
      "/api/initiative-deep-dive": deepDivePayload,
      "/api/metadata/lookup": { groups: [{ id: 5, name: "Platform" }], workTypes: [] },
    });
    render(<InitiativeDeepDiveScreen />);
    fireEvent.change(await screen.findByRole("combobox", { name: "Initiative group" }), { target: { value: "5" } });
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
    expect(screen.getByRole("heading", { name: "Activity in the last 2 weeks" })).toBeInTheDocument();
    await waitFor(() => {
      expect(
        fetchSpy.mock.calls.some(([input]) => {
          const url = String(input);
          return url.includes("tableWindowWeeks=2") && url.includes("activity=all");
        }),
      ).toBe(true);
    });
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
          storyPoints: Number.NaN,
        },
      ],
    };
    setupFetchMock({
      "/api/initiative-deep-dive": edgePayload,
      "/api/metadata/lookup": { groups: [{ id: 5, name: "Platform" }], workTypes: [] },
    });
    render(<InitiativeDeepDiveScreen />);
    fireEvent.change(await screen.findByRole("combobox", { name: "Initiative group" }), { target: { value: "5" } });

    expect(await screen.findByText("TB-EDGE")).toBeInTheDocument();
    expect(screen.getByText("1 card")).toBeInTheDocument();
    expect(screen.getByText("1.3")).toBeInTheDocument();
    expect(screen.getByText("not-a-date")).toBeInTheDocument();
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
    expect(screen.getByText("Showing the first 1 cards, newest activity first.")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /Last 1 week/ }));
    expect(screen.getByRole("heading", { name: "Activity in the last 1 week" })).toBeInTheDocument();
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
    fireEvent.change(await screen.findByRole("combobox", { name: "Initiative group" }), { target: { value: "5" } });

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load initiative deep dive.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("No cards match this scope, period, and activity filter.")).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});
