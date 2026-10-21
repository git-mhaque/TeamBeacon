import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { within } from "@testing-library/dom";
import {
  InitiativesScreen,
  OPEN_INITIATIVES_MANAGE_VIEW_EVENT,
  OPEN_INITIATIVES_CONFIGURE_EVENT,
  OPEN_INITIATIVES_REPORTING_PERIOD_EVENT,
  SET_INITIATIVES_ACTIVE_VIEW_EVENT,
} from "../../src/components/content/screens/InitiativesScreen";
import { setupFetchMock } from "../utils/fetchMock";
import * as persistence from "../../src/lib/persistence";

const DEFAULT_EPICS = [
  {
    epicKey: "CEG-101",
    epicName: "Payment Orchestration",
    completedCards: 7,
    totalCards: 10,
    completionPercent: 70,
    completedInPeriod: 2,
    deltaPercentInPeriod: 5,
    groups: [{ id: 1, name: "Core Platform" }],
    workTypes: [{ id: 2, name: "Feature" }],
    successCriteria: ["Latency under 120ms"],
    timelineEnabled: true,
    timelineStartDate: "2026-03-01",
    targetCompletionDate: "2026-04-15",
    insightComment: "Delivery is aligned with sprint capacity.",
  },
];

function mockInitiativesEndpoints(epics = DEFAULT_EPICS) {
  return setupFetchMock({
    "/api/metadata/epics/summary": {
      epics,
      reportingPeriod: {
        startDate: "2026-03-23",
        endDate: "2026-03-30",
        days: 8,
        timezone: "Australia/Melbourne",
      },
    },
    "/api/metadata/lookup": {
      groups: [
        { id: 1, name: "Core Platform" },
        { id: 3, name: "Customer Experience" },
      ],
      workTypes: [
        { id: 2, name: "Feature" },
        { id: 4, name: "Tech Debt" },
      ],
    },
    "/api/metadata/initiative-views": {
      views: [
        {
          id: "all",
          name: "All Configured",
          description: "All epics with metadata configured in TeamBeacon.",
          epicKeys: [],
          epicCount: epics.length,
          isDefault: true,
          updatedAt: null,
        },
        {
          id: 7,
          name: "Q1 FY27",
          description: "Q1 delivery scope",
          epicKeys: epics.slice(0, 1).map((epic) => epic.epicKey),
          epicCount: Math.min(epics.length, 1),
          isDefault: false,
          updatedAt: "2026-03-30T09:15:00Z",
        },
      ],
    },
    "/api/integrations/jira/status": {
      source: "jira",
      connected: true,
      checkedAt: "2026-03-30T09:15:00Z",
      config: { baseUrl: "https://jira.example.com", projectKey: "CEG" },
      checks: [{ name: "auth", ok: true, detail: "reachable" }],
    },
    "/api/integrations/ai/status": {
      source: "ollama",
      provider: "ollama",
      configuredProvider: "ollama",
      connected: true,
      checkedAt: "2026-03-30T09:15:00Z",
      config: {
        baseUrl: "http://127.0.0.1:11434",
        modelId: "gemma4:e2b",
      },
      checks: [
        { name: "ollama_api", ok: true, detail: "reachable" },
        { name: "configured_model", ok: true, detail: "loaded" },
      ],
    },
    "/api/metadata/epics/candidates": {
      epics: [
        { epicKey: "CEG-888", epicName: "Fraud signal hardening" },
        { epicKey: "CEG-889", epicName: "OAuth service rollout" },
      ],
    },
    "/api/metadata/epics/completed-cards": {
      source: "local",
      epicKey: "CEG-101",
      epicName: "Payment Orchestration",
      count: 2,
      limit: 200,
      truncated: false,
      completedCards: [
        {
          issueKey: "CEG-1001",
          summary: "Enable retry strategy for payment orchestration",
          status: "Done",
          statusCategory: "Done",
          storyPoints: 5,
          assigneeAccountId: "user-dev",
          completedAt: "2026-03-28T08:00:00Z",
        },
        {
          issueKey: "CEG-1002",
          summary: "Close latency spikes under load test",
          status: "Closed",
          statusCategory: "Done",
          storyPoints: 3,
          assigneeAccountId: "user-qa",
          completedAt: "2026-03-29T08:00:00Z",
        },
      ],
      reportingPeriod: {
        startDate: "2026-03-23",
        endDate: "2026-03-30",
        days: 8,
        timezone: "Australia/Melbourne",
      },
    },
    "/api/metadata/epics/completed-cards/configured": {
      source: "local",
      scope: "configured",
      count: 3,
      limit: 300,
      truncated: false,
      completedCards: [
        {
          issueKey: "CEG-1001",
          summary: "Enable retry strategy for payment orchestration",
          status: "Done",
          statusCategory: "Done",
          storyPoints: 5,
          assigneeAccountId: "user-dev",
          completedAt: "2026-03-28T08:00:00Z",
          epicKey: "CEG-101",
          epicName: "Payment Orchestration",
        },
        {
          issueKey: "CEG-2002",
          summary: "Improve fallback auth for dependency calls",
          status: "Closed",
          statusCategory: "Done",
          storyPoints: 3,
          assigneeAccountId: "user-qa",
          completedAt: "2026-03-29T08:00:00Z",
          epicKey: "CEG-202",
          epicName: "Risk Aggregation",
        },
        {
          issueKey: "CEG-2003",
          summary: "Close rollout checklist gaps",
          status: "Done",
          statusCategory: "Done",
          storyPoints: 2,
          assigneeAccountId: "user-dev",
          completedAt: "2026-03-29T12:00:00Z",
          epicKey: "CEG-202",
          epicName: "Risk Aggregation",
        },
      ],
      perEpicCounts: {
        "CEG-101": 1,
        "CEG-202": 2,
      },
      reportingPeriod: {
        startDate: "2026-03-23",
        endDate: "2026-03-30",
        days: 8,
        timezone: "Australia/Melbourne",
      },
    },
    "/api/ai/chat": {
      source: "ollama",
      provider: "ollama",
      configuredProvider: "ollama",
      modelId: "gemma4:e2b",
      response: {
        text: "Completed cards concentrated on resilience hardening and latency closure, indicating delivery momentum with clear operational stabilization in the reporting period.",
      },
    },
    "/api/metadata/epics": {},
  });
}

describe("InitiativesScreen", () => {
  afterEach(() => { vi.useRealTimers(); });
  beforeEach(() => {
    if (typeof window.localStorage?.removeItem === "function") {
      window.localStorage.removeItem("teambeacon.initiatives.visibleOptionalColumns");
      window.localStorage.removeItem("teambeacon.initiatives.reporting.period");
      window.localStorage.removeItem("teambeacon.initiatives.activeViewId");
    }
  });

  it("renders configured initiative summary and progress table", async () => {
    mockInitiativesEndpoints();

    render(<InitiativesScreen />);

    expect(await screen.findByText("CEG-101")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Configured Initiative Summary" })).toBeInTheDocument();
    const matrixHeading = screen.getByRole("heading", { name: "Initiative Progress Matrix" });
    expect(matrixHeading).toBeInTheDocument();
    expect(screen.getByText(/Reporting period:/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reporting Period" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Initiative RAG" })).toBeInTheDocument();
    expect(screen.getByText(/\d+\s+Red/)).toBeInTheDocument();
    expect(screen.getByText(/\d+\s+Amber/)).toBeInTheDocument();
    expect(screen.getByText(/\d+\s+Green/)).toBeInTheDocument();
    expect(screen.getByText("Payment Orchestration")).toBeInTheDocument();
    expect(screen.getAllByText("Core Platform").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Feature").length).toBeGreaterThan(0);
    expect(screen.queryByText(/criteria configured/i)).not.toBeInTheDocument();
    expect(screen.queryByText("No criteria configured")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    const matrixTitle = matrixHeading.closest(".tb-initiative-matrix-title");
    expect(matrixTitle).not.toBeNull();
    expect(within(matrixTitle as HTMLElement).getByText("1 visible")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Columns" })).toHaveClass("tb-initiative-matrix-action");

    const initiativeRow = screen.getByText("CEG-101").closest("tr");
    expect(initiativeRow).not.toBeNull();
    const rowCells = within(initiativeRow as HTMLElement).getAllByRole("cell");
    expect(within(rowCells[1]).getByText("Unknown")).toBeInTheDocument();
    expect(within(rowCells[4]).getByText("70% (7/10)")).toBeInTheDocument();
    expect(within(rowCells[5]).getByText("7 / 10")).toBeInTheDocument();
    expect(within(rowCells[5]).getByText("Period:")).toBeInTheDocument();
    expect(within(rowCells[5]).getByText("5%")).toBeInTheDocument();
    expect(rowCells[6]).toHaveClass("tb-initiative-delta-cell");
    expect(within(rowCells[6]).getByRole("button", { name: /Summarize completed cards for CEG-101/i })).toHaveTextContent("2");
    expect(screen.getByRole("columnheader", { name: "Delta" })).toHaveClass("tb-initiative-delta-head");
  });

  it("summarizes all selected-view epic statuses independently of matrix filters", async () => {
    const epics = [
      { ...DEFAULT_EPICS[0], epicKey: "CEG-1", status: "Closed" },
      { ...DEFAULT_EPICS[0], epicKey: "CEG-2", status: "Closed" },
      { ...DEFAULT_EPICS[0], epicKey: "CEG-3", status: "Open" },
      { ...DEFAULT_EPICS[0], epicKey: "CEG-4", status: "Analysis" },
      { ...DEFAULT_EPICS[0], epicKey: "CEG-5" },
    ];
    mockInitiativesEndpoints(epics);
    render(<InitiativesScreen />);
    expect(await screen.findByText("CEG-3")).toBeInTheDocument();
    const breakdown = screen.getByLabelText("Configured epic status breakdown");
    const entries = () => Array.from(breakdown.children, (entry) => entry.textContent);
    const expected = ["Closed 2", "Not Closed 3 (Analysis 1 Open 1 Unknown 1)"];
    expect(entries()).toEqual(expected);
    expect(breakdown.closest("article")).toHaveTextContent("Configured Epics5");

    fireEvent.click(screen.getByRole("combobox", { name: "Epic Status" }));
    fireEvent.click(within(screen.getByRole("listbox", { name: "Epic Status options" })).getByRole("button", { name: "Clear selection" }));
    fireEvent.click(within(screen.getByRole("listbox", { name: "Epic Status options" })).getByLabelText("Closed"));
    expect(screen.getByText("2 visible")).toBeInTheDocument();
    expect(entries()).toEqual(expected);
    fireEvent.input(screen.getByPlaceholderText("Epic key, name, work stream, type..."), { target: { value: "no match" } });
    expect(screen.getByText("0 visible")).toBeInTheDocument();
    expect(entries()).toEqual(expected);
  });

  it("omits the status breakdown for an empty configured view", async () => {
    mockInitiativesEndpoints([]);
    render(<InitiativesScreen />);
    expect(await screen.findByText("No initiative rows match the active filters.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Configured epic status breakdown")).not.toBeInTheDocument();
    const card = screen.getByRole("heading", { name: "Configured Epics" }).closest("article");
    expect(within(card!).getByText("0")).toBeInTheDocument();
  });

  it("shows zero Not Closed without parentheses when every epic is closed", async () => {
    const epics = [{ ...DEFAULT_EPICS[0], status: "Closed", completionPercent: 70 }];
    mockInitiativesEndpoints(epics);
    render(<InitiativesScreen />);
    const breakdown = await screen.findByLabelText("Configured epic status breakdown");
    expect(screen.queryByText("CEG-101")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Epic Status" })).toHaveTextContent("Not Closed");
    fireEvent.click(screen.getByRole("combobox", { name: "Epic Status" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.getByText("CEG-101")).toBeInTheDocument();
    expect(Array.from(breakdown.children, (entry) => entry.textContent)).toEqual(["Closed 1", "Not Closed 0"]);
  });

  it("shows epic candidates only when configure search input is focused", async () => {
    mockInitiativesEndpoints();

    render(<InitiativesScreen />);

    expect(await screen.findByText("CEG-101")).toBeInTheDocument();
    fireEvent(window, new CustomEvent(OPEN_INITIATIVES_CONFIGURE_EVENT));
    expect(await screen.findByRole("dialog", { name: "Configure Epic Metadata" })).toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText("Epic key or name");
    expect(screen.queryByRole("listbox", { name: "Epic candidates" })).not.toBeInTheDocument();

    fireEvent.focus(searchInput);

    await waitFor(() => {
      expect(screen.getByRole("listbox", { name: "Epic candidates" })).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /CEG-888/i })).toBeInTheDocument();
    });

    fireEvent.mouseDown(screen.getByRole("button", { name: /CEG-888/i }));

    expect(screen.getByText(/Selected epic:/i)).toHaveTextContent("Selected epic: CEG-888 (Fraud signal hardening)");

    fireEvent.click(screen.getByRole("button", { name: "Save Epic Metadata" }));

    await waitFor(() => {
      expect(screen.getByText("Epic metadata saved for CEG-888.")).toBeInTheDocument();
    });
  });

  it("supports sorting and column selection in the initiative matrix", async () => {
    mockInitiativesEndpoints([
      {
        epicKey: "CEG-101",
        epicName: "Payment Orchestration",
        completedCards: 7,
        totalCards: 10,
        completionPercent: 70,
        completedInPeriod: 2,
        deltaPercentInPeriod: 5,
        groups: [{ id: 1, name: "Core Platform" }],
        workTypes: [{ id: 2, name: "Feature" }],
        successCriteria: ["Latency under 120ms"],
        timelineEnabled: true,
        timelineStartDate: "2026-03-01",
        targetCompletionDate: "2026-04-15",
        insightComment: "Delivery is aligned with sprint capacity.",
      },
      {
        epicKey: "CEG-202",
        epicName: "Risk Aggregation",
        completedCards: 3,
        totalCards: 12,
        completionPercent: 25,
        completedInPeriod: 1,
        deltaPercentInPeriod: 22.2,
        groups: [{ id: 3, name: "Customer Experience" }],
        workTypes: [{ id: 4, name: "Tech Debt" }],
        successCriteria: ["Failover exercised in staging"],
        timelineEnabled: true,
        timelineStartDate: "2026-02-20",
        targetCompletionDate: "2026-05-01",
        insightComment: "Workstream was paused for incident load.",
      },
      {
        epicKey: "CEG-303",
        epicName: "Latency Guardrails",
        completedCards: 5,
        totalCards: 9,
        completionPercent: 60,
        completedInPeriod: 3,
        deltaPercentInPeriod: 1,
        groups: [{ id: 1, name: "Core Platform" }],
        workTypes: [{ id: 2, name: "Feature" }],
        successCriteria: ["Alerts tuned for regressions"],
        timelineEnabled: true,
        timelineStartDate: "2026-02-28",
        targetCompletionDate: "2026-05-10",
        insightComment: "Alert tuning is moving steadily.",
      },
    ]);

    const { container } = render(<InitiativesScreen />);

    expect(await screen.findByText("CEG-101")).toBeInTheDocument();
    expect(screen.getByText("CEG-202")).toBeInTheDocument();

    const getEpicOrder = () =>
      Array.from(container.querySelectorAll("tbody tr .tb-initiative-epic-key"))
        .map((node) => node.textContent?.trim() ?? "")
        .filter((value) => value.length > 0);

    await waitFor(() => {
      expect(getEpicOrder()).toEqual(["CEG-303", "CEG-101", "CEG-202"]);
    });

    fireEvent.click(screen.getByRole("button", { name: /Sort by Epic \(/i }));

    await waitFor(() => {
      expect(getEpicOrder()).toEqual(["CEG-202", "CEG-101", "CEG-303"]);
    });

    fireEvent.click(screen.getByRole("button", { name: /Sort by Epic \(/i }));

    await waitFor(() => {
      expect(getEpicOrder()).toEqual(["CEG-303", "CEG-101", "CEG-202"]);
    });

    fireEvent.click(screen.getByRole("button", { name: /Sort by Progress/i }));

    await waitFor(() => {
      expect(getEpicOrder()[0]).toBe("CEG-202");
    });

    fireEvent.click(screen.getByRole("button", { name: /Sort by Progress/i }));

    await waitFor(() => {
      expect(getEpicOrder()[0]).toBe("CEG-101");
    });

    fireEvent.click(screen.getByRole("button", { name: /Sort by Completed/i }));

    await waitFor(() => {
      expect(getEpicOrder()).toEqual(["CEG-303", "CEG-101", "CEG-202"]);
    });

    fireEvent.click(screen.getByRole("button", { name: /Sort by Completed/i }));

    await waitFor(() => {
      expect(getEpicOrder()).toEqual(["CEG-202", "CEG-101", "CEG-303"]);
    });

    fireEvent.click(screen.getByRole("button", { name: /Sort by Delta/i }));

    await waitFor(() => {
      expect(getEpicOrder()).toEqual(["CEG-202", "CEG-101", "CEG-303"]);
    });

    fireEvent.click(screen.getByRole("button", { name: /Sort by Delta/i }));

    await waitFor(() => {
      expect(getEpicOrder()).toEqual(["CEG-303", "CEG-101", "CEG-202"]);
    });

    expect(screen.getByRole("columnheader", { name: "Delta" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    expect(screen.getByRole("dialog", { name: "Select Initiative Columns" })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Delta"));
    await waitFor(() => {
      expect(screen.queryByRole("columnheader", { name: "Delta" })).not.toBeInTheDocument();
    });
  });

  it("filters initiative matrix with quick filter toggles", async () => {
    mockInitiativesEndpoints([
      {
        epicKey: "CEG-101",
        epicName: "Payment Orchestration",
        completedCards: 7,
        totalCards: 10,
        completionPercent: 70,
        completedInPeriod: 2,
        deltaPercentInPeriod: 5,
        groups: [{ id: 1, name: "Core Platform" }],
        workTypes: [{ id: 2, name: "Feature" }],
        successCriteria: ["Latency under 120ms"],
        timelineEnabled: true,
        timelineStartDate: "2026-03-01",
        targetCompletionDate: "2026-04-15",
        insightComment: "Delivery is aligned with sprint capacity.",
      },
      {
        epicKey: "CEG-202",
        epicName: "Risk Aggregation",
        completedCards: 3,
        totalCards: 12,
        completionPercent: 25,
        completedInPeriod: 0,
        deltaPercentInPeriod: 0,
        groups: [{ id: 3, name: "Customer Experience" }],
        workTypes: [{ id: 4, name: "Tech Debt" }],
        successCriteria: ["Failover exercised in staging"],
        timelineEnabled: false,
        timelineStartDate: null,
        targetCompletionDate: null,
        insightComment: "Workstream was paused for incident load.",
      },
      {
        epicKey: "CEG-303",
        epicName: "Latency Guardrails",
        completedCards: 5,
        totalCards: 9,
        completionPercent: 60,
        completedInPeriod: 3,
        deltaPercentInPeriod: 1,
        groups: [{ id: 1, name: "Core Platform" }],
        workTypes: [{ id: 2, name: "Feature" }],
        successCriteria: ["Alerts tuned for regressions"],
        timelineEnabled: false,
        timelineStartDate: null,
        targetCompletionDate: null,
        insightComment: "Alert tuning is moving steadily.",
      },
    ]);

    const { container } = render(<InitiativesScreen />);

    expect(await screen.findByText("CEG-101")).toBeInTheDocument();
    const matrixHeading = screen.getByRole("heading", { name: "Initiative Progress Matrix" });
    const matrixTitle = matrixHeading.closest(".tb-initiative-matrix-title");
    expect(matrixTitle).not.toBeNull();

    const getEpicOrder = () =>
      Array.from(container.querySelectorAll("tbody tr .tb-initiative-epic-key"))
        .map((node) => node.textContent?.trim() ?? "")
        .filter((value) => value.length > 0);

    const positiveDeltaToggle = screen.getByRole("button", { name: "Positive Delta" });
    const timeBoundToggle = screen.getByRole("button", { name: "Time-bound" });

    expect(within(matrixTitle as HTMLElement).getByText("3 visible")).toBeInTheDocument();
    expect(positiveDeltaToggle).toHaveAttribute("aria-pressed", "false");
    expect(timeBoundToggle).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(positiveDeltaToggle);

    await waitFor(() => {
      expect(getEpicOrder()).toEqual(["CEG-303", "CEG-101"]);
    });
    expect(within(matrixTitle as HTMLElement).getByText("2 visible")).toBeInTheDocument();
    expect(positiveDeltaToggle).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(timeBoundToggle);

    await waitFor(() => {
      expect(getEpicOrder()).toEqual(["CEG-101"]);
    });
    expect(within(matrixTitle as HTMLElement).getByText("1 visible")).toBeInTheDocument();
    expect(timeBoundToggle).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(positiveDeltaToggle);

    await waitFor(() => {
      expect(getEpicOrder()).toEqual(["CEG-101"]);
    });
    expect(positiveDeltaToggle).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(timeBoundToggle);

    await waitFor(() => {
      expect(getEpicOrder()).toEqual(["CEG-303", "CEG-101", "CEG-202"]);
    });
    expect(within(matrixTitle as HTMLElement).getByText("3 visible")).toBeInTheDocument();
    expect(timeBoundToggle).toHaveAttribute("aria-pressed", "false");
  });

  it("defaults to non-Closed epics and resets that default when reopened", async () => {
    const epics = [
      { ...DEFAULT_EPICS[0], epicKey: "CEG-CLOSED", status: "Closed", isCompleted: true },
      { ...DEFAULT_EPICS[0], epicKey: "CEG-OPEN", status: "Open", completionPercent: 100 },
      { ...DEFAULT_EPICS[0], epicKey: "CEG-DONE", status: "Done", isCompleted: true },
      { ...DEFAULT_EPICS[0], epicKey: "CEG-UNKNOWN" },
    ];
    mockInitiativesEndpoints(epics);
    const view = render(<InitiativesScreen />);
    expect(await screen.findByText("CEG-OPEN")).toBeInTheDocument();
    expect(screen.queryByText("CEG-CLOSED")).not.toBeInTheDocument();
    expect(screen.getByText("CEG-DONE")).toBeInTheDocument();
    expect(screen.getByText("CEG-UNKNOWN")).toBeInTheDocument();
    expect(screen.getByText("3 visible")).toBeInTheDocument();
    const filter = screen.getByRole("combobox", { name: "Epic Status" });
    expect(filter).toHaveTextContent("Not Closed");
    fireEvent.click(filter);
    const options = screen.getByRole("listbox", { name: "Epic Status options" });
    expect(within(options).getByLabelText("Closed")).not.toBeChecked();
    for (const status of ["Open", "Done", "Unknown"]) {
      expect(within(options).getByLabelText(status)).toBeChecked();
    }
    fireEvent.click(within(options).getByRole("button", { name: "Clear selection" }));
    expect(filter).toHaveTextContent("All statuses");
    expect(screen.getByText("CEG-CLOSED")).toBeInTheDocument();
    expect(screen.getByText("4 visible")).toBeInTheDocument();
    view.unmount();
    render(<InitiativesScreen />);
    expect(await screen.findByText("CEG-OPEN")).toBeInTheDocument();
    expect(screen.queryByText("CEG-CLOSED")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Epic Status" })).toHaveTextContent("Not Closed");
  });

  it("filters epic status with individual, combined and all-status selections", async () => {
    const epics = [
      { ...DEFAULT_EPICS[0], epicKey: "CEG-CLOSED", status: "Done", isCompleted: true, completionPercent: 70 },
      { ...DEFAULT_EPICS[0], epicKey: "CEG-OPEN", status: "In Progress", isCompleted: false, completionPercent: 100 },
      { ...DEFAULT_EPICS[0], epicKey: "CEG-UNKNOWN", completionPercent: 100 },
    ];
    mockInitiativesEndpoints(epics);
    render(<InitiativesScreen />);
    expect(await screen.findByText("CEG-CLOSED")).toBeInTheDocument();
    const filter = screen.getByRole("combobox", { name: "Epic Status" });
    expect(filter).toHaveTextContent("Not Closed");
    expect(screen.getByText("3 visible")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show closed epics" })).not.toBeInTheDocument();

    fireEvent.click(filter);
    const options = screen.getByRole("listbox", { name: "Epic Status options" });
    fireEvent.click(within(options).getByRole("button", { name: "Clear selection" }));
    const select = (status: string) => fireEvent.click(within(options).getByLabelText(status));
    select("In Progress");
    expect(filter).toHaveTextContent("In Progress");
    expect(screen.getByText("CEG-OPEN")).toBeInTheDocument();
    expect(screen.queryByText("CEG-CLOSED")).not.toBeInTheDocument();
    expect(screen.queryByText("CEG-UNKNOWN")).not.toBeInTheDocument();
    expect(screen.getByText("1 visible")).toBeInTheDocument();

    select("Unknown");
    expect(filter).toHaveTextContent("2 selected");
    expect(screen.getByText("CEG-UNKNOWN")).toBeInTheDocument();
    expect(screen.getByText("2 visible")).toBeInTheDocument();
    const summary = screen.getByRole("heading", { name: "Configured Initiative Summary" }).closest("section");
    expect(within(summary as HTMLElement).getByText("3", { selector: ".tb-value" })).toBeInTheDocument();

    select("In Progress");
    expect(filter).toHaveTextContent("Unknown");
    expect(screen.queryByText("CEG-OPEN")).not.toBeInTheDocument();
    expect(screen.getByText("CEG-UNKNOWN")).toBeInTheDocument();
    select("Unknown");
    expect(filter).toHaveTextContent("All statuses");
    expect(screen.getByText("3 visible")).toBeInTheDocument();

    select("Done");
    expect(screen.getByText("CEG-CLOSED")).toBeInTheDocument();
    expect(screen.queryByText("CEG-OPEN")).not.toBeInTheDocument();
    expect(screen.queryByText("CEG-UNKNOWN")).not.toBeInTheDocument();
    fireEvent.click(within(options).getByRole("button", { name: "Clear selection" }));
    expect(filter).toHaveTextContent("All statuses");
    expect(screen.getByText("3 visible")).toBeInTheDocument();
  });

  it("combines epic status with search and quick filters", async () => {
    const epics = [
      { ...DEFAULT_EPICS[0], epicKey: "CEG-CLOSED", status: "Done", isCompleted: true },
      { ...DEFAULT_EPICS[0], epicKey: "CEG-OPEN", status: "In Progress", isCompleted: false },
      { ...DEFAULT_EPICS[0], epicKey: "CEG-NO-DELTA", status: "In Progress", isCompleted: false, completedInPeriod: 0 },
      { ...DEFAULT_EPICS[0], epicKey: "CEG-NO-TIMELINE", status: "In Progress", isCompleted: false, timelineEnabled: false },
    ];
    mockInitiativesEndpoints(epics);
    render(<InitiativesScreen />);
    expect(await screen.findByText("CEG-CLOSED")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("combobox", { name: "Epic Status" }));
    const options = screen.getByRole("listbox", { name: "Epic Status options" });
    fireEvent.click(within(options).getByRole("button", { name: "Clear selection" }));
    fireEvent.click(within(options).getByLabelText("In Progress"));
    fireEvent.mouseDown(document.body);
    fireEvent.click(screen.getByRole("button", { name: "Positive Delta" }));
    fireEvent.click(screen.getByRole("button", { name: "Time-bound" }));
    expect(screen.getByText("CEG-OPEN")).toBeInTheDocument();
    expect(screen.getByText("1 visible")).toBeInTheDocument();
    expect(screen.queryByText("CEG-CLOSED")).not.toBeInTheDocument();
    expect(screen.queryByText("CEG-NO-DELTA")).not.toBeInTheDocument();
    expect(screen.queryByText("CEG-NO-TIMELINE")).not.toBeInTheDocument();

    const search = screen.getByPlaceholderText("Epic key, name, work stream, type...");
    fireEvent.input(search, { target: { value: "CEG-CLOSED" } });
    expect(screen.getByText("0 visible")).toBeInTheDocument();
    expect(screen.getByText("No initiative rows match the active filters.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("combobox", { name: "Epic Status" }));
    fireEvent.click(within(screen.getByRole("listbox", { name: "Epic Status options" })).getByLabelText("Done"));
    expect(screen.getByText("CEG-CLOSED")).toBeInTheDocument();
    expect(screen.getByText("1 visible")).toBeInTheDocument();
  });

  it("displays epic status and supports sorting and persisted column visibility", async () => {
    const preferences = new Map<string, string>();
    vi.spyOn(persistence, "getPreferenceSync").mockImplementation((key) => preferences.get(key) ?? null);
    vi.spyOn(persistence, "getPreference").mockImplementation(async (key) => preferences.get(key) ?? null);
    vi.spyOn(persistence, "setPreference").mockImplementation(async (key, value) => { preferences.set(key, value); });
    const epics = [
      { ...DEFAULT_EPICS[0], epicKey: "CEG-1", status: "In Progress", isCompleted: false, completionPercent: 100 },
      { ...DEFAULT_EPICS[0], epicKey: "CEG-2", status: "Done", isCompleted: true, completionPercent: 70 },
      { ...DEFAULT_EPICS[0], epicKey: "CEG-3" },
    ];
    mockInitiativesEndpoints(epics);
    const view = render(<InitiativesScreen />);
    expect(await screen.findByText("CEG-1")).toBeInTheDocument();
    const row = (key: string) => screen.getByText(key).closest("tr") as HTMLElement;
    expect(within(row("CEG-1")).getByText("In Progress")).toBeInTheDocument();
    expect(within(row("CEG-2")).getByText("Done")).toBeInTheDocument();
    expect(within(row("CEG-3")).getByText("Unknown")).toBeInTheDocument();
    const order = () => Array.from(view.container.querySelectorAll("tbody .tb-initiative-epic-key"), (node) => node.textContent);

    fireEvent.click(screen.getByRole("button", { name: /Sort by Epic Status/ }));
    expect(order()).toEqual(["CEG-2", "CEG-1", "CEG-3"]);
    fireEvent.click(screen.getByRole("button", { name: /Sort by Epic Status/ }));
    expect(order()).toEqual(["CEG-3", "CEG-1", "CEG-2"]);

    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    const dialog = screen.getByRole("dialog", { name: "Select Initiative Columns" });
    expect(within(dialog).getByRole("checkbox", { name: "Epic Status" })).toBeChecked();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Epic Status" }));
    expect(screen.queryByRole("button", { name: /Sort by Epic Status/ })).not.toBeInTheDocument();
    expect(within(row("CEG-2")).queryByText("Done")).not.toBeInTheDocument();
    view.unmount();

    render(<InitiativesScreen />);
    expect(await screen.findByText("CEG-1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Sort by Epic Status/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    expect(screen.getByRole("checkbox", { name: "Epic Status" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "Epic Status" }));
    expect(screen.getByRole("button", { name: /Sort by Epic Status/ })).toBeInTheDocument();
    expect(within(row("CEG-2")).getByText("Done")).toBeInTheDocument();
  });

  it("filters initiative matrix with multi-select dropdown filters", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
    mockInitiativesEndpoints([
      {
        epicKey: "CEG-101",
        epicName: "Checkout Platform",
        completedCards: 7,
        totalCards: 10,
        completionPercent: 70,
        completedInPeriod: 2,
        deltaPercentInPeriod: 5,
        groups: [{ id: 1, name: "Core Platform" }],
        workTypes: [{ id: 2, name: "Feature" }],
        successCriteria: ["Latency under 120ms"],
        timelineEnabled: true,
        timelineStartDate: "2000-01-01",
        targetCompletionDate: "2035-01-01",
        insightComment: "Delivery is aligned with sprint capacity.",
      },
      {
        epicKey: "CEG-202",
        epicName: "Risk Aggregation",
        completedCards: 3,
        totalCards: 12,
        completionPercent: 25,
        completedInPeriod: 0,
        deltaPercentInPeriod: 0,
        groups: [{ id: 3, name: "Customer Experience" }],
        workTypes: [{ id: 4, name: "Tech Debt" }],
        successCriteria: ["Failover exercised in staging"],
        timelineEnabled: true,
        timelineStartDate: "2000-01-01",
        targetCompletionDate: "2035-01-01",
        insightComment: "Workstream was paused for incident load.",
      },
      {
        epicKey: "CEG-303",
        epicName: "Automation Guardrails",
        completedCards: 5,
        totalCards: 9,
        completionPercent: 60,
        completedInPeriod: 3,
        deltaPercentInPeriod: 1,
        groups: [{ id: 1, name: "Core Platform" }],
        workTypes: [{ id: 6, name: "Automation" }],
        successCriteria: ["Alerts tuned for regressions"],
        timelineEnabled: true,
        timelineStartDate: "2000-01-01",
        targetCompletionDate: "2035-01-01",
        insightComment: "Alert tuning is moving steadily.",
      },
    ]);

    const { container } = render(<InitiativesScreen />);

    expect(await screen.findByText("CEG-101")).toBeInTheDocument();
    const matrixHeading = screen.getByRole("heading", { name: "Initiative Progress Matrix" });
    const matrixTitle = matrixHeading.closest(".tb-initiative-matrix-title");
    expect(matrixTitle).not.toBeNull();

    const getEpicOrder = () =>
      Array.from(container.querySelectorAll("tbody tr .tb-initiative-epic-key"))
        .map((node) => node.textContent?.trim() ?? "")
        .filter((value) => value.length > 0);

    const groupFilter = screen.getByRole("combobox", { name: "Work Stream" });
    fireEvent.click(groupFilter);
    const groupListbox = screen.getByRole("listbox", { name: "Work Stream options" });
    fireEvent.click(within(groupListbox).getByLabelText("Core Platform"));

    await waitFor(() => {
      expect(getEpicOrder()).toEqual(["CEG-303", "CEG-101"]);
    });
    expect(groupFilter).toHaveTextContent("Core Platform");
    expect(within(matrixTitle as HTMLElement).getByText("2 visible")).toBeInTheDocument();

    fireEvent.click(within(groupListbox).getByLabelText("Customer Experience"));

    await waitFor(() => {
      expect(getEpicOrder()).toEqual(["CEG-303", "CEG-101", "CEG-202"]);
    });
    expect(groupFilter).toHaveTextContent("2 selected");

    fireEvent.mouseDown(document.body);
    const workTypeFilter = screen.getByRole("combobox", { name: "Work Type" });
    fireEvent.click(workTypeFilter);
    const workTypeListbox = screen.getByRole("listbox", { name: "Work Type options" });
    fireEvent.click(within(workTypeListbox).getByLabelText("Feature"));

    await waitFor(() => {
      expect(getEpicOrder()).toEqual(["CEG-101"]);
    });
    expect(workTypeFilter).toHaveTextContent("Feature");

    fireEvent.click(within(workTypeListbox).getByLabelText("Automation"));

    await waitFor(() => {
      expect(getEpicOrder()).toEqual(["CEG-303", "CEG-101"]);
    });
    expect(workTypeFilter).toHaveTextContent("2 selected");

    fireEvent.mouseDown(document.body);
    const ragFilter = screen.getByRole("combobox", { name: "RAG" });
    fireEvent.click(ragFilter);
    const ragListbox = screen.getByRole("listbox", { name: "RAG options" });
    fireEvent.click(within(ragListbox).getByLabelText("Green"));

    await waitFor(() => {
      expect(getEpicOrder()).toEqual(["CEG-101"]);
    });
    expect(ragFilter).toHaveTextContent("Green");

    fireEvent.click(within(ragListbox).getByLabelText("Amber"));

    await waitFor(() => {
      expect(getEpicOrder()).toEqual(["CEG-303", "CEG-101"]);
    });
    expect(ragFilter).toHaveTextContent("2 selected");
    vi.useRealTimers();
    expect(within(matrixTitle as HTMLElement).getByText("2 visible")).toBeInTheDocument();
  });

  it("opens completed-in-period overlay and generates AI summary", async () => {
    mockInitiativesEndpoints();
    render(<InitiativesScreen />);

    expect(await screen.findByText("CEG-101")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Summarize completed cards for CEG-101/i }));

    expect(await screen.findByRole("dialog", { name: "Completed Cards Summary" })).toBeInTheDocument();
    expect(screen.getByText("AI Summary")).toBeInTheDocument();
    expect(await screen.findByText(/delivery momentum with clear operational stabilization/i)).toBeInTheDocument();
    expect(await screen.findByText(/CEG-1001.*Done.*SP 5/i)).toBeInTheDocument();
    expect(await screen.findByText(/CEG-1002.*Closed.*SP 3/i)).toBeInTheDocument();
    expect(screen.getByText(/Generated with Ollama/i)).toBeInTheDocument();
  });

  it("opens configured completed-in-period summary from top card", async () => {
    mockInitiativesEndpoints();
    render(<InitiativesScreen />);

    expect(await screen.findByText("CEG-101")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Summarize completed cards across configured initiatives" }),
    );

    expect(await screen.findByRole("dialog", { name: "Completed Cards Summary" })).toBeInTheDocument();
    expect(screen.getByText("AI Summary")).toBeInTheDocument();
    expect(screen.getByText("Scope:")).toBeInTheDocument();
    expect(screen.getByText("All configured initiatives")).toBeInTheDocument();
    expect(await screen.findByText(/CEG-2002.*Risk Aggregation/i)).toBeInTheDocument();
    expect(await screen.findByText(/delivery momentum with clear operational stabilization/i)).toBeInTheDocument();
  });

  it("opens reporting period configuration and refetches initiative data for a custom range", async () => {
    const fetchSpy = mockInitiativesEndpoints();
    render(<InitiativesScreen />);

    expect(await screen.findByText("CEG-101")).toBeInTheDocument();

    fireEvent(window, new CustomEvent(OPEN_INITIATIVES_REPORTING_PERIOD_EVENT));
    expect(await screen.findByRole("dialog", { name: "Configure Reporting Period" })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Reporting Period" }), {
      target: { value: "custom" },
    });
    fireEvent.input(screen.getByLabelText("Start"), {
      target: { value: "2026-04-01" },
    });
    fireEvent.input(screen.getByLabelText("End"), {
      target: { value: "2026-04-07" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Configure Reporting Period" })).not.toBeInTheDocument();
    });

    await waitFor(() => {
      expect(
        fetchSpy.mock.calls.some(([input]) => (
          String(input).includes("/api/metadata/epics/summary?")
          && String(input).includes("periodStart=2026-04-01")
          && String(input).includes("periodEnd=2026-04-07")
        )),
      ).toBe(true);
    });
  });

  it("selects an initiative view and refetches scoped summary", async () => {
    const fetchSpy = mockInitiativesEndpoints();
    render(<InitiativesScreen />);

    expect(await screen.findByText("CEG-101")).toBeInTheDocument();

    fireEvent(window, new CustomEvent(SET_INITIATIVES_ACTIVE_VIEW_EVENT, { detail: { viewId: 7 } }));

    await waitFor(() => {
      expect(
        fetchSpy.mock.calls.some(([input]) => (
          String(input).includes("/api/metadata/epics/summary?")
          && String(input).includes("viewId=7")
        )),
      ).toBe(true);
    });
  });

  it("opens create view editor and moves epics between available and included lists", async () => {
    mockInitiativesEndpoints();
    render(<InitiativesScreen />);

    expect(await screen.findByText("CEG-101")).toBeInTheDocument();

    fireEvent(window, new CustomEvent(OPEN_INITIATIVES_MANAGE_VIEW_EVENT));

    expect(await screen.findByRole("dialog", { name: "Create Initiative View" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Available configured epics" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Selected view epics" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Add CEG-101 to view/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Remove CEG-101 from view/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /Add CEG-101 to view/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Remove CEG-101 from view/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Add CEG-101 to view/i })).toBeInTheDocument();
    });
  });

  it("opens edit view editor and shows delete confirmation", async () => {
    const fetchSpy = mockInitiativesEndpoints();
    render(<InitiativesScreen />);

    expect(await screen.findByText("CEG-101")).toBeInTheDocument();

    fireEvent(window, new CustomEvent(SET_INITIATIVES_ACTIVE_VIEW_EVENT, { detail: { viewId: 7 } }));

    await waitFor(() => {
      expect(
        fetchSpy.mock.calls.some(([input]) => (
          String(input).includes("/api/metadata/epics/summary?")
          && String(input).includes("viewId=7")
        )),
      ).toBe(true);
    });
    expect(await screen.findByText("Epics in Q1 FY27.")).toBeInTheDocument();

    fireEvent(window, new CustomEvent(OPEN_INITIATIVES_MANAGE_VIEW_EVENT));

    expect(await screen.findByRole("dialog", { name: "Edit Initiative View" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Q1 FY27")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete View" }));

    expect(await screen.findByRole("dialog", { name: "Delete Initiative View" })).toBeInTheDocument();
    expect(screen.getByText(/Epic metadata will remain configured/i)).toBeInTheDocument();
  });
});


it("loads and summarizes all 245 configured epics", async () => {
  const epics = Array.from({ length: 245 }, (_, index) => ({
    ...DEFAULT_EPICS[0], epicKey: `CEG-${1000 + index}`, epicName: `Epic ${index}`,
    timelineEnabled: false, completedCards: index < 200 ? 1 : 0, totalCards: 1,
    completionPercent: index < 200 ? 100 : 0,
  }));
  const fetchSpy = mockInitiativesEndpoints(epics);
  render(<InitiativesScreen />);
  await screen.findByText("CEG-1244");
  const countCard = screen.getByRole("heading", { name: "Configured Epics" }).closest("article")!;
  expect(within(countCard).getByText("245", { selector: ".tb-value" })).toBeInTheDocument();
  const averageCard = screen.getByRole("heading", { name: "Avg Completion" }).closest("article")!;
  expect(within(averageCard).getByText(/81\.6/)).toBeInTheDocument();
  expect(screen.getByText("245 visible")).toBeInTheDocument();
  expect(fetchSpy.mock.calls.some(([url]) => String(url).includes("/epics/summary?limit=all"))).toBe(true);
});


it("does not assess RAG without an enabled timeline and valid target", async () => {
  const fixtures = [
    { epicKey: "CEG-910", timelineEnabled: false, targetCompletionDate: "2099-01-01", completionPercent: 0 },
    { epicKey: "CEG-911", timelineEnabled: false, targetCompletionDate: "2099-01-01", completionPercent: 100 },
    { epicKey: "CEG-912", timelineEnabled: true, targetCompletionDate: null, completionPercent: 70 },
    { epicKey: "CEG-913", timelineEnabled: true, targetCompletionDate: "invalid", completionPercent: 70 },
    { epicKey: "CEG-914", timelineEnabled: true, targetCompletionDate: "2099-01-01", completionPercent: 100 },
  ];
  mockInitiativesEndpoints(fixtures.map((fixture) => ({ ...DEFAULT_EPICS[0], ...fixture })));
  render(<InitiativesScreen />);
  await screen.findByText("CEG-914");
  const ragHeader = screen.getByRole("button", { name: /^Sort by RAG/ }).closest("th");
  const ragColumnIndex = screen.getAllByRole("columnheader").findIndex((header) => header === ragHeader);
  expect(ragColumnIndex).toBeGreaterThanOrEqual(0);
  for (const key of ["CEG-910", "CEG-911", "CEG-912", "CEG-913"]) {
    const row = screen.getByText(key).closest("tr")!;
    expect(within(row).getAllByRole("cell")[ragColumnIndex]).toBeEmptyDOMElement();
    expect(within(row).queryByText("Not assessed")).not.toBeInTheDocument();
    expect(within(row).queryByText(/^(Red|Amber|Green)$/)).not.toBeInTheDocument();
  }
  expect(within(screen.getByText("CEG-914").closest("tr")!).getByText("Green")).toBeInTheDocument();
  const summary = screen.getByRole("heading", { name: "Initiative RAG" }).closest("article")!;
  expect(within(summary).getByText("0 Red")).toBeInTheDocument();
  expect(within(summary).getByText("0 Amber")).toBeInTheDocument();
  expect(within(summary).getByText("1 Green")).toBeInTheDocument();
  expect(within(summary).getByText(/4 not assessed/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("combobox", { name: "RAG" }));
  fireEvent.click(within(screen.getByRole("listbox", { name: "RAG options" })).getByLabelText("Not assessed"));
  expect(screen.queryByText("CEG-914")).not.toBeInTheDocument();
  expect(screen.getByText("4 visible")).toBeInTheDocument();
});
