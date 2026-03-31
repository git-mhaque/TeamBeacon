import { fireEvent, render, screen, within } from "@testing-library/preact";
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
          goal: "Reduce production defects by closing top reliability stories; complete OCI GenAI rollout validation",
          sprintUrl: "https://jira.example.com/secure/RapidBoard.jspa?rapidView=42",
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
              groupName: "Core Platform",
              workTypeName: "Feature",
              assigneeAccountId: "acct-1",
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
              groupName: "Core Platform",
              workTypeName: "Reliability",
              assigneeAccountId: "acct-2",
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
              groupName: "Ops Excellence",
              workTypeName: "Feature",
              assigneeAccountId: null,
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
          goal: "Reduce production defects by closing top reliability stories; complete OCI GenAI rollout validation",
          sprintUrl: "https://jira.example.com/secure/RapidBoard.jspa?rapidView=42",
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
          goal: "Reduce production defects by closing top reliability stories; complete OCI GenAI rollout validation",
          sprintUrl: "https://jira.example.com/secure/RapidBoard.jspa?rapidView=42",
          remainingDays: 7,
        },
      },
    });

    render(<SprintBoardScreen />);

    expect(await screen.findByText("Sprint 42")).toBeInTheDocument();
    const sprintLink = screen.getByRole("link", { name: "Sprint 42" });
    expect(sprintLink).toHaveAttribute(
      "href",
      "https://jira.example.com/secure/RapidBoard.jspa?rapidView=42",
    );
    expect(screen.getByText("State: active")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sprint Goals" })).toBeInTheDocument();
    expect(screen.getByText("Reduce production defects by closing top reliability stories")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "State Breakdown" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Card breakdown:/i })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Story point breakdown:/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Work Mix by Group" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Work Mix by Type" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Work mix by group chart" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Work mix by type chart" })).toBeInTheDocument();
    expect(screen.getAllByText("Core Platform").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Ops Excellence").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Reliability").length).toBeGreaterThan(0);
    expect(screen.getByText("Added (1 | 3 SP)")).toBeInTheDocument();
    expect(screen.getByText("Blocked (1 | 5 SP)")).toBeInTheDocument();
    expect(screen.getByText("CEG-901")).toBeInTheDocument();
    expect(screen.getByText("CEG-777")).toBeInTheDocument();

    const workPanel = screen.getByRole("heading", { name: "Current Sprint Work" }).closest("section");
    expect(workPanel).not.toBeNull();
    if (!workPanel) {
      throw new Error("Current Sprint Work section not found.");
    }
    const scopedWork = within(workPanel);
    const plannedHeading = scopedWork.getByRole("heading", { name: "Planned (1 | 3 SP)" });
    const inProgressHeading = scopedWork.getByRole("heading", { name: "In Progress (1 | 5 SP)" });
    const doneHeading = scopedWork.getByRole("heading", { name: "Done (1 | 8 SP)" });
    expect(plannedHeading.compareDocumentPosition(inProgressHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(inProgressHeading.compareDocumentPosition(doneHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const groupFilter = scopedWork.getByLabelText("Group") as HTMLSelectElement;
    const typeFilter = scopedWork.getByLabelText("Type") as HTMLSelectElement;
    const epicFilter = scopedWork.getByLabelText("Epic") as HTMLSelectElement;
    const assigneeFilter = scopedWork.getByLabelText("Assignee") as HTMLSelectElement;
    expect(groupFilter).toBeInTheDocument();
    expect(typeFilter).toBeInTheDocument();
    expect(epicFilter).toBeInTheDocument();
    expect(assigneeFilter).toBeInTheDocument();

    fireEvent.change(groupFilter, { target: { value: "Ops Excellence" } });
    expect(scopedWork.getByRole("heading", { name: "Planned (1 | 3 SP)" })).toBeInTheDocument();
    expect(scopedWork.getByRole("heading", { name: "In Progress (0 | 0 SP)" })).toBeInTheDocument();
    expect(scopedWork.getByRole("heading", { name: "Done (0 | 0 SP)" })).toBeInTheDocument();
    expect(scopedWork.getByText("CEG-903")).toBeInTheDocument();
    expect(scopedWork.queryByText("CEG-901")).not.toBeInTheDocument();

    fireEvent.change(groupFilter, { target: { value: groupFilter.options[0].value } });
    const unassignedOption = [...assigneeFilter.options].find((option) => option.textContent === "Unassigned");
    expect(unassignedOption).toBeTruthy();
    fireEvent.change(assigneeFilter, { target: { value: unassignedOption?.value ?? "" } });
    expect(scopedWork.getByRole("heading", { name: "Planned (1 | 3 SP)" })).toBeInTheDocument();
    expect(scopedWork.getByRole("heading", { name: "In Progress (0 | 0 SP)" })).toBeInTheDocument();
    expect(scopedWork.getByRole("heading", { name: "Done (0 | 0 SP)" })).toBeInTheDocument();

    fireEvent.change(assigneeFilter, { target: { value: assigneeFilter.options[0].value } });
    fireEvent.change(epicFilter, { target: { value: "Executive Reporting" } });
    expect(scopedWork.getByRole("heading", { name: "Planned (0 | 0 SP)" })).toBeInTheDocument();
    expect(scopedWork.getByRole("heading", { name: "In Progress (1 | 5 SP)" })).toBeInTheDocument();
    expect(scopedWork.getByRole("heading", { name: "Done (1 | 8 SP)" })).toBeInTheDocument();
  });
});
