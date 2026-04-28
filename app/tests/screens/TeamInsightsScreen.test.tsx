import { fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { vi } from "vitest";
import { TeamInsightsScreen } from "../../src/components/content/screens/TeamInsightsScreen";
import { setupFetchMock } from "../utils/fetchMock";

describe("TeamInsightsScreen", () => {
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
          maxCycleTimeDays: 12.6,
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
          totalDays: 29.6,
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
            {
              status: "Done",
              issueCount: 13,
              avgDays: 0.2,
              medianDays: 0.1,
              p85Days: 0.3,
              maxDays: 0.6,
              totalDays: 2.4,
              percentOfCycleTime: 8.11,
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
    const trendWindowSelect = screen.getByRole("combobox", { name: "Trend Window" });
    expect(trendWindowSelect).toHaveValue("6");
    expect(screen.getByRole("option", { name: "1 sprint" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Last 2 sprints" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Last 3 sprints" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Avg Cycle Time" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Max Cycle Time" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Median Cycle Time" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Avg SP" })).toBeInTheDocument();
    expect(await screen.findByText("4.1 d")).toBeInTheDocument();
    expect(screen.getByText("12.6 d")).toBeInTheDocument();
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
    expect(screen.getAllByTitle("Active sprint").length).toBeGreaterThan(0);
    const firstCycleSprint = await screen.findByText("Sprint 1");
    const secondCycleSprint = screen.getByText("Sprint 2");
    expect(
      firstCycleSprint.compareDocumentPosition(secondCycleSprint) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(firstCycleSprint.closest(".tb-trend-column")).toHaveAttribute(
      "title",
      "From 18-Mar-2026 to 01-Apr-2026"
    );
    expect(secondCycleSprint.closest(".tb-trend-column")).toHaveAttribute(
      "title",
      "From 02-Apr-2026 to 15-Apr-2026"
    );
    expect(screen.getByText("3.9 d")).toBeInTheDocument();
    expect(screen.getByText("4.7 d")).toBeInTheDocument();
    expect(screen.queryByText("82 SP")).not.toBeInTheDocument();
    expect(screen.queryByText("80 SP")).not.toBeInTheDocument();

    fireEvent.click(completedStoryPointsTab);
    expect(cycleTimeTab).toHaveAttribute("aria-selected", "false");
    expect(completedStoryPointsTab).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("heading", { name: "Completed SP by Sprint" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Avg Cycle Time by Sprint" })).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Completed story points sprint bar chart" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Average cycle time sprint bar chart" })).not.toBeInTheDocument();
    expect(screen.getByText("Sprints (old to new)")).toBeInTheDocument();
    expect(screen.getByText("82 SP")).toBeInTheDocument();
    expect(screen.getByText("80 SP")).toBeInTheDocument();
    const firstStoryPointSprint = screen.getByText("Sprint 1");
    const secondStoryPointSprint = screen.getByText("Sprint 2");
    expect(
      firstStoryPointSprint.compareDocumentPosition(secondStoryPointSprint) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(firstStoryPointSprint.closest(".tb-trend-column")).toHaveAttribute(
      "title",
      "From 18-Mar-2026 to 01-Apr-2026"
    );
    expect(screen.queryByText("3.9 d")).not.toBeInTheDocument();
    expect(screen.queryByText("4.7 d")).not.toBeInTheDocument();

    fireEvent.click(cycleTimeTab);
    expect(cycleTimeTab).toHaveAttribute("aria-selected", "true");
    expect(completedStoryPointsTab).toHaveAttribute("aria-selected", "false");
    expect(screen.queryByRole("heading", { name: "Avg Cycle Time by Sprint" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Completed SP by Sprint" })).not.toBeInTheDocument();
    expect(screen.getByText("3.9 d")).toBeInTheDocument();

    expect(screen.queryByText("Completed story points per sprint.")).not.toBeInTheDocument();
    expect(screen.queryByText("Average cycle time per sprint.")).not.toBeInTheDocument();
    expect(screen.queryByText("Live")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sprint Trend Bars" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sprint Performance (Last 6 Sprints)" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Work Mix and Capacity Signal" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Cycle Time Breakdown (Last 6 sprints)" })).toBeInTheDocument();
    expect(screen.getByText("% Cycle Time is normalized within visible in-progress statuses.")).toBeInTheDocument();
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
          maxCycleTimeDays: 12.6,
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

    const trendWindowSelect = screen.getByRole("combobox", { name: "Trend Window" });
    expect(await screen.findByRole("heading", { name: "Cycle Time Breakdown (Last 6 sprints)" })).toBeInTheDocument();

    fireEvent.change(trendWindowSelect, { target: { value: "1" } });
    await waitFor(() => expect(trendWindowSelect).toHaveValue("1"));
    expect(await screen.findByRole("heading", { name: "Cycle Time Breakdown (1 sprint)" })).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchSpy.mock.calls.some(([input]) => String(input).includes("sprintLimit=1"))).toBe(true);
    });

    fireEvent.change(trendWindowSelect, { target: { value: "5" } });
    await waitFor(() => expect(trendWindowSelect).toHaveValue("6"));
    expect(await screen.findByRole("heading", { name: "Cycle Time Breakdown (Last 6 sprints)" })).toBeInTheDocument();
    await waitFor(() => {
      const sprintLimitSixCalls = fetchSpy.mock.calls.filter(([input]) => String(input).includes("sprintLimit=6"));
      expect(sprintLimitSixCalls.length).toBeGreaterThan(1);
    });
  });

  it("renders fallback chart labels and stable status sorting for atypical sprint data", async () => {
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
          maxCycleTimeDays: 7.2,
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

    const fallbackNamedSprint = await screen.findByText("Sprint 1");
    const fallbackUnnamedSprint = screen.getByText("Sprint 2");
    expect(fallbackNamedSprint.closest(".tb-trend-column")).toHaveAttribute("title", "From - to -");
    expect(fallbackUnnamedSprint.closest(".tb-trend-column")).toHaveAttribute("title", "From - to -");

    fireEvent.click(screen.getByRole("tab", { name: "Completed SP" }));
    expect(await screen.findByRole("img", { name: "Completed story points sprint bar chart" })).toBeInTheDocument();
    expect(screen.getAllByText("12.5 SP").length).toBeGreaterThan(0);
    expect(screen.getAllByText("0 SP").length).toBeGreaterThan(0);

    const statusCycleTable = screen.getByRole("table", { name: "Status cycle time table" });
    const rows = within(statusCycleTable).getAllByRole("row");
    expect(within(rows[1]).getByText("Testing")).toBeInTheDocument();
    expect(within(rows[2]).getByText("QA Ready")).toBeInTheDocument();
    expect(within(rows[3]).getByText("Blocked")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Status cycle time share pie chart" })).toBeInTheDocument();
  });

  it("shows empty-state fallbacks when the team insights request fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network down"));

    render(<TeamInsightsScreen />);

    expect(await screen.findByText("Team insights error: Network down")).toBeInTheDocument();
    expect(screen.getByText("No recent sprint trend data found.")).toBeInTheDocument();
    expect(screen.getByText("No in-progress status cycle-time data found for completed cards.")).toBeInTheDocument();
    expect(screen.getByText("Tracked completed cards: 0")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Average cycle time sprint bar chart" })).toBeInTheDocument();
    expect(screen.getByText("4 d")).toBeInTheDocument();
  });
});
