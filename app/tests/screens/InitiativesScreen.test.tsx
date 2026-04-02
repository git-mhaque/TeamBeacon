import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { InitiativesScreen } from "../../src/components/content/screens/InitiativesScreen";
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
      source: "oci_genai",
      modelId: "cohere.command-r-08-2024",
      response: {
        text: "Completed cards concentrated on resilience hardening and latency closure, indicating delivery momentum with clear operational stabilization in the reporting period.",
      },
    },
    "/api/metadata/epics": {},
  });
}

describe("InitiativesScreen", () => {
  it("renders configured initiative summary and progress table", async () => {
    mockInitiativesEndpoints();

    render(<InitiativesScreen />);

    expect(await screen.findByText("CEG-101")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Configured Initiative Summary" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Initiative Progress Matrix" })).toBeInTheDocument();
    expect(screen.getByText(/Reporting period:/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Initiative RAG" })).toBeInTheDocument();
    expect(screen.getByText(/\d+\s+Red/)).toBeInTheDocument();
    expect(screen.getByText(/\d+\s+Amber/)).toBeInTheDocument();
    expect(screen.getByText(/\d+\s+Green/)).toBeInTheDocument();
    expect(screen.getByText("Payment Orchestration")).toBeInTheDocument();
    expect(screen.getAllByText("Core Platform").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Feature").length).toBeGreaterThan(0);
    expect(screen.getByText("1 criteria configured")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("shows epic candidates only when configure search input is focused", async () => {
    mockInitiativesEndpoints();

    render(<InitiativesScreen />);

    expect(await screen.findByText("CEG-101")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Configure Epic" }));

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
        deltaPercentInPeriod: 2,
        groups: [{ id: 3, name: "Customer Experience" }],
        workTypes: [{ id: 4, name: "Tech Debt" }],
        successCriteria: ["Failover exercised in staging"],
        timelineEnabled: true,
        timelineStartDate: "2026-02-20",
        targetCompletionDate: "2026-05-01",
        insightComment: "Workstream was paused for incident load.",
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

    expect(screen.getByRole("columnheader", { name: "Delta" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    expect(screen.getByRole("dialog", { name: "Select Initiative Columns" })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Delta"));
    expect(screen.queryByRole("columnheader", { name: "Delta" })).not.toBeInTheDocument();
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
    expect(screen.getByText(/Generated with OCI GenAI/i)).toBeInTheDocument();
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
});
