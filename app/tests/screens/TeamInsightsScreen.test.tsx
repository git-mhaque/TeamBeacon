import { fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { vi } from "vitest";
import * as persistence from "../../src/lib/persistence";
import { setupFetchMock } from "../utils/fetchMock";

type MockChartCall = {
  canvas: HTMLCanvasElement;
  config: any;
  destroy: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};

const { chartCalls } = vi.hoisted(() => ({
  chartCalls: [] as MockChartCall[],
}));

vi.mock("chart.js/auto", () => {
  const Chart = vi.fn(function MockChart(this: unknown, canvas: HTMLCanvasElement, config: any) {
    const chartCall: MockChartCall = {
      canvas,
      config,
      destroy: vi.fn(),
      update: vi.fn(),
    };
    chartCalls.push(chartCall);
    return chartCall;
  });

  return {
    default: Chart,
  };
});

import {
  OPEN_TEAM_INSIGHTS_SETTINGS_EVENT,
  TEAM_INSIGHTS_TREND_WINDOW_CHANGE_EVENT,
  TeamInsightsScreen,
} from "../../src/components/content/screens/TeamInsightsScreen";

function getLatestChartCall(ariaLabel: string): MockChartCall {
  const matchingCalls = chartCalls.filter((chartCall) => chartCall.canvas.getAttribute("aria-label") === ariaLabel);
  expect(matchingCalls.length).toBeGreaterThan(0);
  return matchingCalls[matchingCalls.length - 1];
}

function getBarDataset(chartCall: MockChartCall): any {
  return chartCall.config.data.datasets.find((dataset: any) => dataset.type !== "line");
}

function getTargetLinePlugin(chartCall: MockChartCall): any | undefined {
  return chartCall.config.plugins.find((plugin: { id?: string }) => plugin.id === "tbTargetLine");
}

function getTooltipLabel(chartCall: MockChartCall, dataIndex: number): string {
  return chartCall.config.options.plugins.tooltip.callbacks.label({ dataIndex });
}

function getTickLabel(chartCall: MockChartCall, index: number): string | string[] {
  return chartCall.config.options.scales.x.ticks.callback(index, index);
}

function getTickColor(chartCall: MockChartCall, index: number): string {
  return chartCall.config.options.scales.x.ticks.color({ index });
}

function hasValueLabelPlugin(chartCall: MockChartCall): boolean {
  return chartCall.config.plugins.some((plugin: { id?: string }) => plugin.id === "tbTrendValueLabels");
}

describe("TeamInsightsScreen", () => {
  beforeEach(() => {
    chartCalls.length = 0;
    vi.spyOn(persistence, "getPreferenceSync").mockReturnValue(null);
    vi.spyOn(persistence, "getPreference").mockResolvedValue(null);
    vi.spyOn(persistence, "setPreference").mockResolvedValue();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders sprint trend with cycle-time cards and completed-story-point bars", async () => {
    setupFetchMock({
      "/api/team/insights": {
        source: "local",
        generatedAt: "2026-04-10T09:00:00Z",
        windowSize: 6,
        metrics: {
          avgCommittedStoryPoints: 92,
          avgCompletedStoryPoints: 81,
          completionRatioPercent: 88.04,
          carryoverPercent: 11.96,
          avgCycleTimeDays: 4.1,
          cycleTimeStdDevDays: 2.7,
          medianCycleTimeDays: 3.4,
        },
        trend: [
          {
            sprintId: 4101,
            sprintName: "Sprint 41 (Q4 FY26)",
            state: "closed",
            startDate: "2026-03-18T00:00:00+00:00",
            endDate: "2026-04-01T00:00:00+00:00",
            committedStoryPoints: 88,
            completedStoryPoints: 80,
            avgCycleTimeDays: 4.7,
            completionRatioPercent: 90.91,
            carryoverPercent: 9.09,
          },
          {
            sprintId: 4102,
            sprintName: "Sprint 42 (Q4 FY26)",
            state: "active",
            startDate: "2026-04-02T00:00:00+00:00",
            endDate: "2026-04-15T00:00:00+00:00",
            committedStoryPoints: 96,
            completedStoryPoints: 82,
            avgCycleTimeDays: 3.9,
            completionRatioPercent: 85.42,
            carryoverPercent: 14.58,
          },
        ],
        statusCycleTime: {
          trackedIssues: 13,
          completedIssues: 13,
          excludedIssues: 0,
          totalDays: 29.6,
          appliedStatusKeys: ["in progress", "in review"],
          defaultStatusKeys: ["in progress", "in review"],
          availableStatuses: [
            {
              statusKey: "to do",
              status: "To Do",
              statusCategory: "To Do",
              defaultIncluded: false,
            },
            {
              statusKey: "in progress",
              status: "In Progress",
              statusCategory: "In Progress",
              defaultIncluded: true,
            },
            {
              statusKey: "in review",
              status: "In Review",
              statusCategory: "In Progress",
              defaultIncluded: true,
            },
          ],
          rows: [
            {
              status: "In Progress",
              issueCount: 13,
              avgDays: 1.5,
              medianDays: 1.2,
              p85Days: 2.4,
              maxDays: 4.8,
              totalDays: 19.4,
              percentOfCycleTime: 65.54,
            },
            {
              status: "In Review",
              issueCount: 9,
              avgDays: 1.1,
              medianDays: 1.0,
              p85Days: 1.8,
              maxDays: 3.1,
              totalDays: 10.2,
              percentOfCycleTime: 34.46,
            },
          ],
        },
        workMix: {
          sprintId: 4102,
          sprintName: "Sprint 42",
          totalIssues: 20,
          slices: [
            { label: "Feature", count: 12, percent: 60 },
            { label: "Ops", count: 5, percent: 25 },
            { label: "Security", count: 3, percent: 15 },
          ],
        },
        summary:
          "Work mix is currently Feature 60%, Ops 25%, Security 15%. Monitor completion and carryover together to rebalance team capacity.",
        error: null,
      },
    });

    render(<TeamInsightsScreen />);

    expect(screen.getByRole("heading", { name: "Sprint Trend" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Avg Cycle Time" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Cycle Time Std Dev" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Median Cycle Time" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Avg SP" })).toBeInTheDocument();
    expect(await screen.findByText("4.1 d")).toBeInTheDocument();
    expect(screen.getByText("2.7 d")).toBeInTheDocument();
    expect(screen.getByText("3.4 d")).toBeInTheDocument();
    expect(screen.getByText("81 SP")).toBeInTheDocument();
    expect(screen.queryByText("Trend window: last 6 sprints including active sprint.")).not.toBeInTheDocument();
    expect(
      screen.getByText("Older sprints are shown on the left and recent sprints on the right. The green dot marks the active sprint.")
    ).toBeInTheDocument();
    const cycleTimeTab = screen.getByRole("tab", { name: "Avg Cycle Time" });
    const completedStoryPointsTab = screen.getByRole("tab", { name: "Completed SP" });
    expect(cycleTimeTab).toHaveAttribute("aria-selected", "true");
    expect(completedStoryPointsTab).toHaveAttribute("aria-selected", "false");
    expect(screen.queryByRole("heading", { name: "Avg Cycle Time by Sprint" })).not.toBeInTheDocument();
    expect(screen.getByText("Sprints (old to new)")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Completed SP by Sprint" })).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Average cycle time sprint bar chart" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Completed story points sprint bar chart" })).not.toBeInTheDocument();
    await waitFor(() => {
      const cycleTimeChart = getLatestChartCall("Average cycle time sprint bar chart");
      expect(cycleTimeChart.config.data.labels).toEqual(["Sprint 41 (Q4 FY26)", "Sprint 42 (Q4 FY26)"]);
      expect(cycleTimeChart.config.options.scales.x.ticks.minRotation).toBe(38);
      expect(cycleTimeChart.config.options.scales.x.ticks.maxRotation).toBe(38);
      expect(getBarDataset(cycleTimeChart).data).toEqual([4.7, 3.9]);
      expect(getTargetLinePlugin(cycleTimeChart)?.targetValue).toBe(5);
      expect(getTooltipLabel(cycleTimeChart, 0)).toBe("From 18-Mar-2026 to 01-Apr-2026");
      expect(getTooltipLabel(cycleTimeChart, 1)).toBe("From 02-Apr-2026 to 15-Apr-2026");
      expect(getTickLabel(cycleTimeChart, 0)).toBe("Sprint 41 (Q4 FY26)");
      expect(getTickLabel(cycleTimeChart, 1)).toEqual(["Sprint 42 (Q4 FY26)", "●"]);
      expect(getTickColor(cycleTimeChart, 1)).toBe("#1f8f63");
      expect(hasValueLabelPlugin(cycleTimeChart)).toBe(true);
    });

    fireEvent.click(completedStoryPointsTab);
    expect(cycleTimeTab).toHaveAttribute("aria-selected", "false");
    expect(completedStoryPointsTab).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("heading", { name: "Completed SP by Sprint" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Avg Cycle Time by Sprint" })).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Completed story points sprint bar chart" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Average cycle time sprint bar chart" })).not.toBeInTheDocument();
    expect(screen.getByText("Sprints (old to new)")).toBeInTheDocument();
    await waitFor(() => {
      const completedStoryPointsChart = getLatestChartCall("Completed story points sprint bar chart");
      expect(completedStoryPointsChart.config.data.labels).toEqual(["Sprint 41 (Q4 FY26)", "Sprint 42 (Q4 FY26)"]);
      expect(getBarDataset(completedStoryPointsChart).data).toEqual([80, 82]);
      expect(getTargetLinePlugin(completedStoryPointsChart)).toBeUndefined();
      expect(getTooltipLabel(completedStoryPointsChart, 0)).toBe("From 18-Mar-2026 to 01-Apr-2026");
      expect(getTooltipLabel(completedStoryPointsChart, 1)).toBe("From 02-Apr-2026 to 15-Apr-2026");
      expect(getTickLabel(completedStoryPointsChart, 1)).toEqual(["Sprint 42 (Q4 FY26)", "●"]);
      expect(hasValueLabelPlugin(completedStoryPointsChart)).toBe(true);
    });

    fireEvent.click(cycleTimeTab);
    expect(cycleTimeTab).toHaveAttribute("aria-selected", "true");
    expect(completedStoryPointsTab).toHaveAttribute("aria-selected", "false");
    expect(screen.queryByRole("heading", { name: "Avg Cycle Time by Sprint" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Completed SP by Sprint" })).not.toBeInTheDocument();
    await waitFor(() => {
      const cycleTimeChartAfterReturn = getLatestChartCall("Average cycle time sprint bar chart");
      expect(getBarDataset(cycleTimeChartAfterReturn).data).toEqual([4.7, 3.9]);
      expect(getTargetLinePlugin(cycleTimeChartAfterReturn)?.targetValue).toBe(5);
    });

    expect(screen.queryByText("Completed story points per sprint.")).not.toBeInTheDocument();
    expect(screen.queryByText("Average cycle time per sprint.")).not.toBeInTheDocument();
    expect(screen.queryByText("Live")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sprint Trend Bars" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sprint Performance (Last 6 Sprints)" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Work Mix and Capacity Signal" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Cycle Time Breakdown (Last 12 sprints)" })).toBeInTheDocument();
    expect(screen.getByText("% Cycle Time is normalized within the selected statuses.")).toBeInTheDocument();
    expect(screen.getByText("Tracked completed cards: 13")).toBeInTheDocument();

    const statusCycleTable = screen.getByRole("table", { name: "Status cycle time table" });
    const initialRows = within(statusCycleTable).getAllByRole("row");
    expect(within(initialRows[1]).getByText("In Progress")).toBeInTheDocument();
    expect(within(initialRows[2]).getByText("In Review")).toBeInTheDocument();
    expect(screen.getByText("1.5 d")).toBeInTheDocument();
    expect(screen.getAllByText("65.5%").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Sort by Median Days/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Sort by P85 Days/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Sort by Max Days/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Sort by Total Days/i })).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Status cycle time share pie chart" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Sort by Avg Days/i }));
    fireEvent.click(screen.getByRole("button", { name: /Sort by Avg Days/i }));
    const avgAscRows = within(statusCycleTable).getAllByRole("row");
    expect(within(avgAscRows[1]).getByText("In Review")).toBeInTheDocument();
    expect(within(avgAscRows[2]).getByText("In Progress")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Sort by Status/i }));
    const statusSortedRows = within(statusCycleTable).getAllByRole("row");
    expect(within(statusSortedRows[1]).getByText("In Progress")).toBeInTheDocument();
    expect(within(statusSortedRows[2]).getByText("In Review")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Sort by Percent Of Cycle Time/i }));
    const percentSortedRows = within(statusCycleTable).getAllByRole("row");
    expect(within(percentSortedRows[1]).getByText("In Progress")).toBeInTheDocument();
    expect(within(percentSortedRows[2]).getByText("In Review")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Sort by Issue Count/i }));
    const headerSortedRows = within(statusCycleTable).getAllByRole("row");
    expect(within(headerSortedRows[1]).getByText("In Progress")).toBeInTheDocument();
    expect(screen.queryByText("Done")).not.toBeInTheDocument();
  });

  it("renders cards-in-window filters, sorting, and ticket status detail timeline", async () => {
    setupFetchMock({
      "/api/team/insights": {
        source: "local",
        generatedAt: "2026-04-10T09:00:00Z",
        windowSize: 3,
        metrics: {
          avgCommittedStoryPoints: 25,
          avgCompletedStoryPoints: 20,
          completionRatioPercent: 80,
          carryoverPercent: 20,
          avgCycleTimeDays: 4.2,
          cycleTimeStdDevDays: 1.1,
          medianCycleTimeDays: 4,
        },
        trend: [
          {
            sprintId: 9101,
            sprintName: "Sprint 91",
            state: "active",
            startDate: "2026-04-01T00:00:00+00:00",
            endDate: "2026-04-14T00:00:00+00:00",
            committedStoryPoints: 25,
            completedStoryPoints: 20,
            avgCycleTimeDays: 4.2,
            completionRatioPercent: 80,
            carryoverPercent: 20,
          },
        ],
        statusCycleTime: {
          trackedIssues: 2,
          completedIssues: 2,
          excludedIssues: 0,
          totalDays: 10,
          appliedStatusKeys: ["in progress"],
          defaultStatusKeys: ["in progress"],
          availableStatuses: [
            {
              statusKey: "to do",
              status: "To Do",
              statusCategory: "To Do",
              defaultIncluded: false,
            },
            {
              statusKey: "in progress",
              status: "In Progress",
              statusCategory: "In Progress",
              defaultIncluded: true,
            },
          ],
          rows: [
            {
              status: "In Progress",
              issueCount: 2,
              avgDays: 5,
              medianDays: 5,
              p85Days: 6,
              maxDays: 6,
              totalDays: 10,
              percentOfCycleTime: 100,
            },
          ],
        },
        cardsInWindow: {
          totalCards: 3,
          inProgressCards: 1,
          completedCards: 2,
          trackedCards: 3,
          appliedStatusKeys: ["in progress"],
          rows: [
            {
              issueKey: "REV-1",
              epicKey: "EPIC-1",
              epicName: "Platform Improvements",
              sprintId: 9101,
              sprintName: "Sprint 91",
              status: "Done",
              statusKey: "done",
              issueType: "Story",
              issueTypeKey: "story",
              storyPoints: 5,
              cycleTimeDays: 4,
              cycleTimeToDateDays: 4,
              summary: "Completed card",
              isCompleted: true,
              statusTimeline: [
                {
                  statusKey: "to do",
                  status: "To Do",
                  changedAt: "2026-04-02T00:00:00+00:00",
                  days: 1,
                  percentOfTicketTime: 25,
                  isCycleTimeStatus: false,
                },
                {
                  statusKey: "in progress",
                  status: "In Progress",
                  changedAt: "2026-04-03T00:00:00+00:00",
                  days: 3,
                  percentOfTicketTime: 75,
                  isCycleTimeStatus: true,
                },
              ],
            },
            {
              issueKey: "REV-2",
              issueUrl: "https://jira.example.com/browse/REV-2",
              epicKey: "EPIC-1",
              epicName: "Platform Improvements",
              sprintId: 9101,
              sprintName: "Sprint 91",
              status: "In Progress",
              statusKey: "in progress",
              issueType: "Task",
              issueTypeKey: "task",
              storyPoints: 3,
              cycleTimeDays: null,
              cycleTimeToDateDays: 3,
              summary: "In-progress card",
              isCompleted: false,
              statusTimeline: [
                {
                  statusKey: "to do",
                  status: "To Do",
                  changedAt: "2026-04-07T00:00:00+00:00",
                  days: 1,
                  percentOfTicketTime: 20,
                  isCycleTimeStatus: false,
                },
                {
                  statusKey: "in progress",
                  status: "In Progress",
                  changedAt: "2026-04-08T00:00:00+00:00",
                  days: 4,
                  percentOfTicketTime: 80,
                  isCycleTimeStatus: true,
                },
              ],
            },
            {
              issueKey: "REV-3",
              epicKey: "EPIC-2",
              epicName: "Operational Hardening",
              sprintId: 9101,
              sprintName: "Sprint 91",
              status: "Done",
              statusKey: "done",
              issueType: "Story",
              issueTypeKey: "story",
              storyPoints: 8,
              cycleTimeDays: 6,
              cycleTimeToDateDays: 6,
              summary: "Top cycle-time card",
              isCompleted: true,
              statusTimeline: [
                {
                  statusKey: "to do",
                  status: "To Do",
                  changedAt: "2026-04-01T00:00:00+00:00",
                  days: 2,
                  percentOfTicketTime: 25,
                  isCycleTimeStatus: false,
                },
                {
                  statusKey: "in progress",
                  status: "In Progress",
                  changedAt: "2026-04-03T00:00:00+00:00",
                  days: 6,
                  percentOfTicketTime: 75,
                  isCycleTimeStatus: true,
                },
              ],
            },
          ],
        },
        workMix: {
          sprintId: 9101,
          sprintName: "Sprint 91",
          totalIssues: 3,
          slices: [{ label: "Feature", count: 3, percent: 100 }],
        },
        summary: "Cards in window payload.",
        error: null,
      },
    });

    render(<TeamInsightsScreen />);

    expect(await screen.findByRole("heading", { name: "Cards in Selected Window (Last 12 sprints)" })).toBeInTheDocument();
    expect(await screen.findByText("3 cards in the current sprint-window selection.")).toBeInTheDocument();
    expect(screen.queryByText("In Progress cards: 1")).not.toBeInTheDocument();

    const cardsTable = screen.getByRole("table", { name: "Cards in selected window table" });
    const initialRows = within(cardsTable).getAllByRole("row");
    expect(within(initialRows[1]).getByRole("button", { name: /REV-3/i })).toBeInTheDocument();
    expect(within(initialRows[1]).getByText("Top cycle-time card")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Filter epic" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Sort by Story Points/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Sort by Cycle Time To Date/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Sort by Type/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sort by Summary/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Sort by Key/i }));
    const ticketSortedRows = within(cardsTable).getAllByRole("row");
    expect(within(ticketSortedRows[1]).getByRole("button", { name: /REV-1/i })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Filter epic" }), {
      target: { value: "EPIC-2" },
    });
    const epicFilteredRows = within(cardsTable).getAllByRole("row");
    expect(epicFilteredRows).toHaveLength(2);
    expect(within(epicFilteredRows[1]).getByRole("button", { name: /REV-3/i })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Filter epic" }), {
      target: { value: "all" },
    });
    fireEvent.input(screen.getByRole("textbox", { name: "Search by key or summary" }), {
      target: { value: "REV-2" },
    });
    const filteredRows = within(cardsTable).getAllByRole("row");
    expect(filteredRows).toHaveLength(2);
    expect(within(filteredRows[1]).getByRole("button", { name: /REV-2/i })).toBeInTheDocument();
    expect(within(filteredRows[1]).getByText("In-progress card")).toBeInTheDocument();

    const detailTable = screen.getByRole("table", { name: "Selected card status timeline" });
    const detailRows = within(detailTable).getAllByRole("row");
    expect(within(detailRows[1]).queryByText("To Do", { selector: "strong" })).not.toBeInTheDocument();
    expect(within(detailRows[2]).getByText("In Progress", { selector: "strong" })).toBeInTheDocument();
    expect(within(detailRows[2]).getByText("4 d", { selector: "strong" })).toBeInTheDocument();
    expect(within(detailRows[2]).getByText("80%", { selector: "strong" })).toBeInTheDocument();
    const detailCard = screen.getByRole("heading", { name: "Card Statuses" }).closest(".tb-cards-window-detail-card");
    expect(detailCard).not.toBeNull();
    const detailKeyLink = within(detailCard as HTMLElement).getByRole("link", { name: /REV-2/i });
    expect(detailKeyLink).toHaveAttribute("href", "https://jira.example.com/browse/REV-2");
    expect(within(detailCard as HTMLElement).getByText("In-progress card")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Selected card status time distribution pie chart" })).toBeInTheDocument();
  });

  it("updates the trend window and normalizes unexpected selection values", async () => {
    const fetchSpy = setupFetchMock({
      "/api/team/insights": {
        source: "local",
        generatedAt: "2026-04-10T09:00:00Z",
        windowSize: 6,
        metrics: {
          avgCommittedStoryPoints: 92,
          avgCompletedStoryPoints: 81,
          completionRatioPercent: 88.04,
          carryoverPercent: 11.96,
          avgCycleTimeDays: 4.1,
          cycleTimeStdDevDays: 2.7,
          medianCycleTimeDays: 3.4,
        },
        trend: [
          {
            sprintId: 4101,
            sprintName: "Sprint 41 (Q4 FY26)",
            state: "closed",
            startDate: "2026-03-18T00:00:00+00:00",
            endDate: "2026-04-01T00:00:00+00:00",
            committedStoryPoints: 88,
            completedStoryPoints: 80,
            avgCycleTimeDays: 4.7,
            completionRatioPercent: 90.91,
            carryoverPercent: 9.09,
          },
        ],
        statusCycleTime: {
          trackedIssues: 1,
          completedIssues: 1,
          excludedIssues: 0,
          totalDays: 1.5,
          rows: [
            {
              status: "In Progress",
              issueCount: 1,
              avgDays: 1.5,
              medianDays: 1.5,
              p85Days: 1.5,
              maxDays: 1.5,
              totalDays: 1.5,
              percentOfCycleTime: 100,
            },
          ],
        },
        workMix: {
          sprintId: 4101,
          sprintName: "Sprint 41",
          totalIssues: 1,
          slices: [{ label: "Feature", count: 1, percent: 100 }],
        },
        summary: "Trend window selection test payload.",
        error: null,
      },
    });

    render(<TeamInsightsScreen />);

    expect(await screen.findByRole("heading", { name: "Cycle Time Breakdown (Last 12 sprints)" })).toBeInTheDocument();

    window.dispatchEvent(new CustomEvent(TEAM_INSIGHTS_TREND_WINDOW_CHANGE_EVENT, {
      detail: { trendWindow: 1 },
    }));
    expect(await screen.findByRole("heading", { name: "Cycle Time Breakdown (1 sprint)" })).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchSpy.mock.calls.some(([input]) => String(input).includes("sprintLimit=1"))).toBe(true);
    });

    window.dispatchEvent(new CustomEvent(TEAM_INSIGHTS_TREND_WINDOW_CHANGE_EVENT, {
      detail: { trendWindow: 5 },
    }));
    expect(await screen.findByRole("heading", { name: "Cycle Time Breakdown (Last 12 sprints)" })).toBeInTheDocument();
    await waitFor(() => {
      const sprintLimitTwelveCalls = fetchSpy.mock.calls.filter(([input]) => String(input).includes("sprintLimit=12"));
      expect(sprintLimitTwelveCalls.length).toBeGreaterThan(1);
    });
  });

  it("opens the settings overlay from the global action and applies chart preferences", async () => {
    const fetchSpy = setupFetchMock({
      "/api/team/insights": {
        source: "local",
        generatedAt: "2026-04-10T09:00:00Z",
        windowSize: 6,
        metrics: {
          avgCommittedStoryPoints: 92,
          avgCompletedStoryPoints: 81,
          completionRatioPercent: 88.04,
          carryoverPercent: 11.96,
          avgCycleTimeDays: 4.1,
          cycleTimeStdDevDays: 2.7,
          medianCycleTimeDays: 3.4,
        },
        trend: [
          {
            sprintId: 4101,
            sprintName: "Sprint 41 (Q4 FY26)",
            state: "closed",
            startDate: "2026-03-18T00:00:00+00:00",
            endDate: "2026-04-01T00:00:00+00:00",
            committedStoryPoints: 88,
            completedStoryPoints: 80,
            avgCycleTimeDays: 4.7,
            completionRatioPercent: 90.91,
            carryoverPercent: 9.09,
          },
          {
            sprintId: 4102,
            sprintName: "Sprint 42 (Q4 FY26)",
            state: "active",
            startDate: "2026-04-02T00:00:00+00:00",
            endDate: "2026-04-15T00:00:00+00:00",
            committedStoryPoints: 96,
            completedStoryPoints: 82,
            avgCycleTimeDays: 3.9,
            completionRatioPercent: 85.42,
            carryoverPercent: 14.58,
          },
        ],
        statusCycleTime: {
          trackedIssues: 13,
          completedIssues: 13,
          excludedIssues: 0,
          totalDays: 29.6,
          appliedStatusKeys: ["in progress", "in review", "done"],
          defaultStatusKeys: ["in progress", "in review", "done"],
          availableStatuses: [
            {
              statusKey: "to do",
              status: "To Do",
              statusCategory: "To Do",
              defaultIncluded: false,
            },
            {
              statusKey: "in progress",
              status: "In Progress",
              statusCategory: "In Progress",
              defaultIncluded: true,
            },
            {
              statusKey: "in review",
              status: "In Review",
              statusCategory: "In Progress",
              defaultIncluded: true,
            },
            {
              statusKey: "done",
              status: "Done",
              statusCategory: "Done",
              defaultIncluded: true,
            },
          ],
          rows: [
            {
              status: "In Progress",
              issueCount: 13,
              avgDays: 1.5,
              medianDays: 1.2,
              p85Days: 2.4,
              maxDays: 4.8,
              totalDays: 19.4,
              percentOfCycleTime: 65.54,
            },
          ],
        },
        workMix: {
          sprintId: 4102,
          sprintName: "Sprint 42",
          totalIssues: 20,
          slices: [
            { label: "Feature", count: 12, percent: 60 },
            { label: "Ops", count: 5, percent: 25 },
            { label: "Security", count: 3, percent: 15 },
          ],
        },
        summary: "Work mix is currently Feature 60%, Ops 25%, Security 15%.",
        error: null,
      },
    });

    render(<TeamInsightsScreen />);
    expect(await screen.findByText("4.1 d")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Completed SP" }));
    expect(screen.getByRole("tab", { name: "Completed SP" })).toHaveAttribute("aria-selected", "true");
    const fetchCallCountBeforeSettings = fetchSpy.mock.calls.length;

    window.dispatchEvent(new CustomEvent(OPEN_TEAM_INSIGHTS_SETTINGS_EVENT));

    const dialog = await screen.findByRole("dialog", { name: "Team Insights Settings" });
    const dialogScope = within(dialog);

    expect(dialogScope.queryByRole("combobox", { name: "Trend Window" })).not.toBeInTheDocument();
    expect(dialogScope.queryByRole("combobox", { name: "Visible Trend Chart" })).not.toBeInTheDocument();
    expect(dialogScope.getByRole("heading", { name: "Chart Display" })).toBeInTheDocument();
    expect(dialogScope.getByRole("heading", { name: "Target Cycle Time" })).toBeInTheDocument();
    expect(dialogScope.getByLabelText("Show SP chart")).toBeChecked();
    expect(dialogScope.getByLabelText("Show sprint names on charts")).toBeChecked();
    expect(dialogScope.getByLabelText("Show target cycle time")).toBeChecked();
    expect(dialogScope.getByRole("spinbutton", { name: "Target Cycle Time" })).toBeEnabled();
    expect(dialogScope.getByRole("spinbutton", { name: "Target Cycle Time" })).toHaveValue(5);
    expect(dialogScope.getByText("Cycle Time Definition")).toBeInTheDocument();
    expect(dialogScope.getByText("3 of 4 statuses selected")).toBeInTheDocument();
    expect(dialogScope.getByLabelText("In Progress")).toBeChecked();
    expect(dialogScope.getByLabelText("Done")).toBeChecked();

    fireEvent.click(dialogScope.getByLabelText("Show target cycle time"));
    expect(dialogScope.getByLabelText("Show target cycle time")).not.toBeChecked();
    expect(dialogScope.getByRole("spinbutton", { name: "Target Cycle Time" })).toBeDisabled();

    fireEvent.click(dialogScope.getByLabelText("Show target cycle time"));
    expect(dialogScope.getByLabelText("Show target cycle time")).toBeChecked();
    expect(dialogScope.getByRole("spinbutton", { name: "Target Cycle Time" })).toBeEnabled();

    fireEvent.click(dialogScope.getByLabelText("Show SP chart"));
    fireEvent.click(dialogScope.getByLabelText("Show sprint names on charts"));
    fireEvent.input(dialogScope.getByRole("spinbutton", { name: "Target Cycle Time" }), {
      target: { value: "6.5" },
    });
    fireEvent.click(dialogScope.getByLabelText("Show bar value labels"));
    fireEvent.click(dialogScope.getByLabelText("Show active sprint marker"));
    fireEvent.click(dialogScope.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Team Insights Settings" })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: "Cycle Time Breakdown (Last 12 sprints)" })).toBeInTheDocument();
    expect(fetchSpy.mock.calls).toHaveLength(fetchCallCountBeforeSettings);
    expect(screen.getByRole("tab", { name: "Avg Cycle Time" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("tab", { name: "Completed SP" })).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Average cycle time sprint bar chart" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Completed story points sprint bar chart" })).not.toBeInTheDocument();
    await waitFor(() => {
      const updatedCycleTimeChart = getLatestChartCall("Average cycle time sprint bar chart");
      expect(getTargetLinePlugin(updatedCycleTimeChart)?.targetValue).toBe(6.5);
      expect(hasValueLabelPlugin(updatedCycleTimeChart)).toBe(false);
      expect(updatedCycleTimeChart.config.options.scales.x.ticks.minRotation).toBe(0);
      expect(updatedCycleTimeChart.config.options.scales.x.ticks.maxRotation).toBe(0);
      expect(getTickLabel(updatedCycleTimeChart, 1)).toBe("Sprint 2");
    });
    expect(screen.getByText("Older sprints are shown on the left and recent sprints on the right.")).toBeInTheDocument();

    window.dispatchEvent(new CustomEvent(OPEN_TEAM_INSIGHTS_SETTINGS_EVENT));

    const secondDialog = await screen.findByRole("dialog", { name: "Team Insights Settings" });
    const secondDialogScope = within(secondDialog);

    fireEvent.click(secondDialogScope.getByLabelText("Show target cycle time"));
    expect(secondDialogScope.getByRole("spinbutton", { name: "Target Cycle Time" })).toBeDisabled();
    fireEvent.click(secondDialogScope.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Team Insights Settings" })).not.toBeInTheDocument();
    });
    await waitFor(() => {
      const chartWithoutTarget = getLatestChartCall("Average cycle time sprint bar chart");
      expect(getTargetLinePlugin(chartWithoutTarget)).toBeUndefined();
    });
  });

  it("renders sprint-name chart labels with numbering fallback for atypical sprint data", async () => {
    setupFetchMock({
      "/api/team/insights": {
        source: "local",
        generatedAt: "2026-04-10T09:00:00Z",
        windowSize: 2,
        metrics: {
          avgCommittedStoryPoints: 6.3,
          avgCompletedStoryPoints: 12.5,
          completionRatioPercent: 66.67,
          carryoverPercent: 33.33,
          avgCycleTimeDays: 7.2,
          cycleTimeStdDevDays: 1.9,
          medianCycleTimeDays: null,
        },
        trend: [
          {
            sprintId: 501,
            sprintName: "Planning Window",
            state: "closed",
            startDate: "not-a-date",
            endDate: null,
            committedStoryPoints: 12.5,
            completedStoryPoints: 12.5,
            avgCycleTimeDays: 7.2,
            completionRatioPercent: 100,
            carryoverPercent: 0,
          },
          {
            sprintId: 502,
            sprintName: "",
            state: "closed",
            startDate: null,
            endDate: null,
            committedStoryPoints: 0,
            completedStoryPoints: 0,
            avgCycleTimeDays: 0,
            completionRatioPercent: 0,
            carryoverPercent: 0,
          },
        ],
        statusCycleTime: {
          trackedIssues: 3,
          completedIssues: 3,
          excludedIssues: 0,
          totalDays: 3,
          rows: [
            {
              status: "QA Ready",
              issueCount: 1,
              avgDays: 1,
              medianDays: 1,
              p85Days: 1,
              maxDays: 1,
              totalDays: 1,
              percentOfCycleTime: 0,
            },
            {
              status: "Testing",
              issueCount: 1,
              avgDays: 1,
              medianDays: 1,
              p85Days: 1,
              maxDays: 1,
              totalDays: 1,
              percentOfCycleTime: 0,
            },
            {
              status: "Blocked",
              issueCount: 1,
              avgDays: 1,
              medianDays: 1,
              p85Days: 1,
              maxDays: 1,
              totalDays: 1,
              percentOfCycleTime: 0,
            },
          ],
        },
        workMix: {
          sprintId: 502,
          sprintName: "Planning Window",
          totalIssues: 3,
          slices: [{ label: "Feature", count: 3, percent: 100 }],
        },
        summary: "Fallback sprint labeling test payload.",
        error: null,
      },
    });

    render(<TeamInsightsScreen />);

    await screen.findByText("7.2 d");
    await waitFor(() => {
      const fallbackCycleChart = getLatestChartCall("Average cycle time sprint bar chart");
      expect(fallbackCycleChart.config.data.labels).toEqual(["Planning Window", "Sprint 2"]);
      expect(getTooltipLabel(fallbackCycleChart, 0)).toBe("From - to -");
      expect(getTooltipLabel(fallbackCycleChart, 1)).toBe("From - to -");
    });

    fireEvent.click(screen.getByRole("tab", { name: "Completed SP" }));
    expect(await screen.findByRole("img", { name: "Completed story points sprint bar chart" })).toBeInTheDocument();
    const fallbackCompletedStoryPointsChart = getLatestChartCall("Completed story points sprint bar chart");
    expect(getBarDataset(fallbackCompletedStoryPointsChart).data).toEqual([12.5, 0]);

    const statusCycleTable = screen.getByRole("table", { name: "Status cycle time table" });
    const rows = within(statusCycleTable).getAllByRole("row");
    expect(within(rows[1]).getByText("Testing")).toBeInTheDocument();
    expect(within(rows[2]).getByText("QA Ready")).toBeInTheDocument();
    expect(within(rows[3]).getByText("Blocked")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Status cycle time share pie chart" })).toBeInTheDocument();
  });

  it("refetches team insights with a custom cycle-time status selection", async () => {
    const fetchSpy = setupFetchMock({
      "/api/team/insights": {
        source: "local",
        generatedAt: "2026-04-10T09:00:00Z",
        windowSize: 2,
        metrics: {
          avgCommittedStoryPoints: 92,
          avgCompletedStoryPoints: 81,
          completionRatioPercent: 88.04,
          carryoverPercent: 11.96,
          avgCycleTimeDays: 4.1,
          cycleTimeStdDevDays: 2.7,
          medianCycleTimeDays: 3.4,
        },
        trend: [
          {
            sprintId: 4101,
            sprintName: "Sprint 41",
            state: "closed",
            startDate: "2026-03-18T00:00:00+00:00",
            endDate: "2026-04-01T00:00:00+00:00",
            committedStoryPoints: 88,
            completedStoryPoints: 80,
            avgCycleTimeDays: 4.7,
            completionRatioPercent: 90.91,
            carryoverPercent: 9.09,
          },
        ],
        statusCycleTime: {
          trackedIssues: 13,
          completedIssues: 13,
          excludedIssues: 0,
          totalDays: 29.6,
          appliedStatusKeys: ["in progress", "in review", "done"],
          defaultStatusKeys: ["in progress", "in review", "done"],
          availableStatuses: [
            {
              statusKey: "to do",
              status: "To Do",
              statusCategory: "To Do",
              defaultIncluded: false,
            },
            {
              statusKey: "in progress",
              status: "In Progress",
              statusCategory: "In Progress",
              defaultIncluded: true,
            },
            {
              statusKey: "in review",
              status: "In Review",
              statusCategory: "In Progress",
              defaultIncluded: true,
            },
            {
              statusKey: "done",
              status: "Done",
              statusCategory: "Done",
              defaultIncluded: true,
            },
          ],
          rows: [
            {
              status: "In Progress",
              issueCount: 13,
              avgDays: 1.5,
              medianDays: 1.2,
              p85Days: 2.4,
              maxDays: 4.8,
              totalDays: 19.4,
              percentOfCycleTime: 65.54,
            },
          ],
        },
        workMix: {
          sprintId: 4102,
          sprintName: "Sprint 42",
          totalIssues: 20,
          slices: [{ label: "Feature", count: 20, percent: 100 }],
        },
        summary: "Work mix summary.",
        error: null,
      },
    });

    render(<TeamInsightsScreen />);
    expect(await screen.findByText("4.1 d")).toBeInTheDocument();

    window.dispatchEvent(new CustomEvent(OPEN_TEAM_INSIGHTS_SETTINGS_EVENT));

    const dialog = await screen.findByRole("dialog", { name: "Team Insights Settings" });
    const dialogScope = within(dialog);
    fireEvent.click(dialogScope.getByRole("button", { name: "Select all" }));
    expect(dialogScope.getByLabelText("Done")).toBeChecked();
    fireEvent.click(dialogScope.getByLabelText("Done"));
    expect(dialogScope.getByLabelText("Done")).not.toBeChecked();
    fireEvent.click(dialogScope.getByLabelText("To Do"));
    expect(dialogScope.getByLabelText("To Do")).not.toBeChecked();
    expect(dialogScope.getByText("2 of 4 statuses selected")).toBeInTheDocument();
    fireEvent.click(dialogScope.getByRole("button", { name: "Save" }));

    let customRequestUrl: URL | null = null;
    await waitFor(() => {
      const customRequest = fetchSpy.mock.calls.find(([input]) => String(input).includes("cycleTimeStatusMode=custom"));
      expect(customRequest).toBeDefined();
      customRequestUrl = new URL(String(customRequest?.[0]));
    });
    expect(customRequestUrl).not.toBeNull();
    expect(customRequestUrl?.searchParams.getAll("cycleTimeStatus")).toEqual(["in progress", "in review"]);
  });

  it("shows empty-state fallbacks when the team insights request fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network down"));

    render(<TeamInsightsScreen />);

    expect(await screen.findByText("Team insights error: Network down")).toBeInTheDocument();
    expect(screen.getByText("No recent sprint trend data found.")).toBeInTheDocument();
    expect(screen.getByText("No cycle-time data found for the selected workflow statuses.")).toBeInTheDocument();
    expect(screen.getByText("Tracked completed cards: 0")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Average cycle time sprint bar chart" })).toBeInTheDocument();
    const emptyCycleTimeChart = getLatestChartCall("Average cycle time sprint bar chart");
    expect(emptyCycleTimeChart.config.options.scales.y.max).toBe(8);
    expect(emptyCycleTimeChart.config.options.scales.y.ticks.callback(4)).toBe("4 d");
  });

  it("hydrates persisted Team Insights settings from preferences", async () => {
    const persistedSettings = JSON.stringify({
      targetCycleTimeDays: 6.5,
      showTargetCycleTime: false,
      showCompletedStoryPointsChart: false,
      showTrendValueLabels: false,
      showActiveSprintMarker: false,
      showSprintNames: false,
      selectedCycleTimeStatusKeys: ["done"],
    });
    vi.mocked(persistence.getPreferenceSync).mockReturnValue(persistedSettings);
    vi.mocked(persistence.getPreference).mockResolvedValue(persistedSettings);

    const fetchSpy = setupFetchMock({
      "/api/team/insights": {
        source: "local",
        generatedAt: "2026-04-10T09:00:00Z",
        windowSize: 2,
        metrics: {
          avgCommittedStoryPoints: 92,
          avgCompletedStoryPoints: 81,
          completionRatioPercent: 88.04,
          carryoverPercent: 11.96,
          avgCycleTimeDays: 4.1,
          cycleTimeStdDevDays: 2.7,
          medianCycleTimeDays: 3.4,
        },
        trend: [
          {
            sprintId: 4101,
            sprintName: "Sprint 41 (Q4 FY26)",
            state: "active",
            startDate: "2026-03-18T00:00:00+00:00",
            endDate: "2026-04-01T00:00:00+00:00",
            committedStoryPoints: 88,
            completedStoryPoints: 80,
            avgCycleTimeDays: 4.7,
            completionRatioPercent: 90.91,
            carryoverPercent: 9.09,
          },
        ],
        statusCycleTime: {
          trackedIssues: 13,
          completedIssues: 13,
          excludedIssues: 0,
          totalDays: 29.6,
          appliedStatusKeys: ["done"],
          defaultStatusKeys: ["in progress", "in review", "done"],
          availableStatuses: [
            {
              statusKey: "in progress",
              status: "In Progress",
              statusCategory: "In Progress",
              defaultIncluded: true,
            },
            {
              statusKey: "in review",
              status: "In Review",
              statusCategory: "In Progress",
              defaultIncluded: true,
            },
            {
              statusKey: "done",
              status: "Done",
              statusCategory: "Done",
              defaultIncluded: true,
            },
          ],
          rows: [
            {
              status: "Done",
              issueCount: 13,
              avgDays: 0.8,
              medianDays: 0.7,
              p85Days: 1.0,
              maxDays: 1.2,
              totalDays: 10.4,
              percentOfCycleTime: 100,
            },
          ],
        },
        workMix: {
          sprintId: 4102,
          sprintName: "Sprint 42",
          totalIssues: 20,
          slices: [{ label: "Feature", count: 20, percent: 100 }],
        },
        summary: "Persisted settings payload.",
        error: null,
      },
    });

    render(<TeamInsightsScreen />);

    expect(await screen.findByText("4.1 d")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Completed SP" })).not.toBeInTheDocument();
    await waitFor(() => {
      const hydratedCycleTimeChart = getLatestChartCall("Average cycle time sprint bar chart");
      expect(getTargetLinePlugin(hydratedCycleTimeChart)).toBeUndefined();
      expect(hasValueLabelPlugin(hydratedCycleTimeChart)).toBe(false);
      expect(getTickLabel(hydratedCycleTimeChart, 0)).toBe("Sprint 1");
    });
    expect(screen.getByText("Older sprints are shown on the left and recent sprints on the right.")).toBeInTheDocument();

    await waitFor(() => {
      expect(fetchSpy.mock.calls.some(([input]) => (
        String(input).includes("cycleTimeStatusMode=custom")
        && String(input).includes("cycleTimeStatus=done")
      ))).toBe(true);
    });
  });
});
