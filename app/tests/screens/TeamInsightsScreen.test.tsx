import { fireEvent, render, screen, within } from "@testing-library/preact";
import { TeamInsightsScreen } from "../../src/components/content/screens/TeamInsightsScreen";
import { setupFetchMock } from "../utils/fetchMock";

describe("TeamInsightsScreen", () => {
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
          {
            sprintId: 4102,
            sprintName: "Sprint 42",
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
      screen.getByText("Recent sprint is shown at the top of each chart. The green dot marks the active sprint.")
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Completed SP by Sprint" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Avg Cycle Time by Sprint" })).toBeInTheDocument();
    expect(screen.getAllByTitle("Active sprint").length).toBeGreaterThan(0);
    expect((await screen.findAllByText("Sprint 42 (from 02-Apr-2026 to 15-Apr-2026)")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Sprint 41 (from 18-Mar-2026 to 01-Apr-2026)").length).toBeGreaterThan(0);
    expect(screen.getByText("82 SP")).toBeInTheDocument();
    expect(screen.getByText("80 SP")).toBeInTheDocument();
    expect(screen.getByText("3.9 d")).toBeInTheDocument();
    expect(screen.getByText("4.7 d")).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole("button", { name: /Sort by Issue Count/i }));
    const headerSortedRows = within(statusCycleTable).getAllByRole("row");
    expect(within(headerSortedRows[1]).getByText("In Progress")).toBeInTheDocument();
    expect(screen.queryByText("Done")).not.toBeInTheDocument();
  });
});
