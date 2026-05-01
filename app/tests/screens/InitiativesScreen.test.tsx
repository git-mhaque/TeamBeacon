import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { within } from "@testing-library/dom";
import {
  InitiativesScreen,
  OPEN_INITIATIVES_CONFIGURE_EVENT,
  OPEN_INITIATIVES_REPORTING_PERIOD_EVENT,
} from "../../src/components/content/screens/InitiativesScreen";
import { setupFetchMock } from "../utils/fetchMock";

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
  beforeEach(() => {
    if (typeof window.localStorage?.removeItem === "function") {
      window.localStorage.removeItem("teambeacon.initiatives.visibleOptionalColumns");
      window.localStorage.removeItem("teambeacon.initiatives.reporting.period");
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
    expect(within(rowCells[4]).getByText("7 / 10")).toBeInTheDocument();
    expect(within(rowCells[4]).getByText("Period:")).toBeInTheDocument();
    expect(within(rowCells[4]).getByText("5%")).toBeInTheDocument();
    expect(rowCells[5]).toHaveClass("tb-initiative-delta-cell");
    expect(within(rowCells[5]).getByRole("button", { name: /Summarize completed cards for CEG-101/i })).toHaveTextContent("2");
    expect(screen.getByRole("columnheader", { name: "Delta" })).toHaveClass("tb-initiative-delta-head");
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
});
