import { render, screen } from "@testing-library/preact";
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
    expect(screen.getByRole("heading", { name: "Avg Cycle Time" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Max Cycle Time" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Median Cycle Time" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Avg SP" })).toBeInTheDocument();
    expect(await screen.findByText("4.1 d")).toBeInTheDocument();
    expect(screen.getByText("12.6 d")).toBeInTheDocument();
    expect(screen.getByText("3.4 d")).toBeInTheDocument();
    expect(screen.getByText("81 SP")).toBeInTheDocument();
    expect(screen.queryByText("Trend window: last 6 sprints including active sprint.")).not.toBeInTheDocument();
    expect(screen.getByText("Recent sprint is shown at the top of each chart.")).toBeInTheDocument();
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
  });
});
