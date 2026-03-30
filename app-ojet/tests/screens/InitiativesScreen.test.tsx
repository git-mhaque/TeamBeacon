import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { InitiativesScreen } from "../../src/components/content/screens/InitiativesScreen";
import { setupFetchMock } from "../utils/fetchMock";

function mockInitiativesEndpoints() {
  return setupFetchMock({
    "/api/metadata/epics/summary": {
      epics: [
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
      ],
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
  });
});
