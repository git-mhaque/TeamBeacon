import { render, screen } from "@testing-library/preact";
import { SprintBoardScreen } from "../../src/components/content/screens/SprintBoardScreen";
import { setupFetchMock } from "../utils/fetchMock";

describe("SprintBoardScreen", () => {
  it("renders current sprint metadata, scope changes, and work columns", async () => {
    setupFetchMock({
      "/api/sprints/current/work": {
        source: "local",
        sprint: {
          id: 501,
          boardId: 42,
          name: "Sprint 42",
          state: "active",
          startDate: "2026-03-24",
          endDate: "2026-04-06",
          remainingDays: 7,
        },
        work: {
          done: [
            {
              issueKey: "CEG-901",
              summary: "Ship executive report export",
              status: "Done",
              statusCategory: "Done",
              storyPoints: 8,
              epicKey: "CEG-100",
              epicName: "Executive Reporting",
              issueUrl: "https://jira.example.com/browse/CEG-901",
              epicUrl: "https://jira.example.com/browse/CEG-100",
            },
          ],
          inProgress: [
            {
              issueKey: "CEG-902",
              summary: "Tune OCI GenAI prompt strategy",
              status: "In Progress",
              statusCategory: "In Progress",
              storyPoints: 5,
              epicKey: "CEG-100",
              epicName: "Executive Reporting",
            },
          ],
          planned: [
            {
              issueKey: "CEG-903",
              summary: "Draft leadership release notes",
              status: "To Do",
              statusCategory: "To Do",
              storyPoints: 3,
              epicKey: "CEG-111",
              epicName: "Release Comms",
            },
          ],
          totals: {
            done: 1,
            inProgress: 1,
            planned: 1,
            total: 3,
            storyPoints: {
              done: 8,
              inProgress: 5,
              planned: 3,
              total: 16,
            },
          },
        },
      },
      "/api/sprints/current/changes": {
        source: "local",
        sprint: {
          id: 501,
          boardId: 42,
          name: "Sprint 42",
          state: "active",
          startDate: "2026-03-24",
          endDate: "2026-04-06",
          remainingDays: 7,
        },
        changes: {
          addedAfterStart: {
            count: 1,
            storyPointsTotal: 3,
            issueKeys: ["CEG-903"],
            issueCards: [
              {
                issueKey: "CEG-903",
                summary: "Draft leadership release notes",
                issueUrl: "https://jira.example.com/browse/CEG-903",
                storyPoints: 3,
                status: "To Do",
                statusCategory: "To Do",
              },
            ],
          },
          removedAfterStart: {
            count: 0,
            storyPointsTotal: 0,
            issueKeys: [],
            issueCards: [],
          },
          blockedCards: {
            count: 1,
            storyPointsTotal: 5,
            issueKeys: ["CEG-777"],
            issueCards: [
              {
                issueKey: "CEG-777",
                summary: "Resolve dependency outage",
                storyPoints: 5,
                status: "Blocked",
                statusCategory: "In Progress",
              },
            ],
          },
        },
      },
      "/api/sprints/current": {
        source: "local",
        sprint: {
          id: 501,
          boardId: 42,
          name: "Sprint 42",
          state: "active",
          startDate: "2026-03-24",
          endDate: "2026-04-06",
          remainingDays: 7,
        },
      },
    });

    render(<SprintBoardScreen />);

    expect(await screen.findByText("Sprint 42")).toBeInTheDocument();
    expect(screen.getByText("State: active")).toBeInTheDocument();
    expect(screen.getByText("Added (1 | 3 SP)")).toBeInTheDocument();
    expect(screen.getByText("Blocked (1 | 5 SP)")).toBeInTheDocument();
    expect(screen.getByText("Done (1 | 8 SP)")).toBeInTheDocument();
    expect(screen.getByText("In Progress (1 | 5 SP)")).toBeInTheDocument();
    expect(screen.getByText("Planned (1 | 3 SP)")).toBeInTheDocument();
    expect(screen.getByText("CEG-901")).toBeInTheDocument();
    expect(screen.getByText("CEG-777")).toBeInTheDocument();
  });
});
