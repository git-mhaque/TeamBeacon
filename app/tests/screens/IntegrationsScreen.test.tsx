import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { within } from "@testing-library/dom";
import { vi } from "vitest";
import { IntegrationsScreen } from "../../src/components/content/screens/IntegrationsScreen";
import { setupFetchMock } from "../utils/fetchMock";

describe("IntegrationsScreen", () => {
  it("renders JIRA and active AI provider connectivity status from the backend", async () => {
    const fetchSpy = setupFetchMock({
      "/api/integrations/jira/status": {
        source: "jira",
        connected: true,
        checkedAt: "2026-03-30T09:15:00Z",
        config: {
          baseUrl: "https://jira.example.com",
          projectKey: "CEG",
          boardId: 42,
          storyPointsField: "customfield_10016",
          epicLinkField: "customfield_10014",
          sprintFields: ["customfield_10020"],
        },
        checks: [
          { name: "auth", ok: true, detail: "reachable" },
          { name: "project", ok: true, detail: "resolved" },
        ],
        sampleIssueKey: "CEG-100",
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
      "/api/integrations/confluence/status": {
        source: "confluence",
        connected: true,
        checkedAt: "2026-03-30T09:15:00Z",
        config: {
          baseUrl: "https://gbuconfluence.oraclecorp.com",
          authMode: "pat_bearer",
          timeoutSeconds: 30,
        },
        checks: [
          { name: "auth", ok: true, detail: "reachable" },
          { name: "space_query", ok: true, detail: "responding" },
        ],
        metrics: {
          spaceCount: 1,
        },
      },
      "/api/integrations/jira/sync/status": {
        source: "jira",
        state: "idle",
        phase: "idle",
        syncMode: "since_last",
        downloadedIssues: 0,
        percent: null,
        lastSyncedAt: "2026-03-30T09:15:00Z",
      },
      "/api/integrations/jira/sync/history": {
        source: "jira",
        history: [],
      },
      "/api/metadata/lookup": {
        groups: [{ id: 1, name: "Core Platform" }],
        workTypes: [{ id: 2, name: "Feature" }],
      },
    });

    render(<IntegrationsScreen />);

    expect(screen.getByRole("heading", { name: "Source Connections" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "JIRA Connection" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "AI Model Connection" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Confluence Connection" })).toBeInTheDocument();
    expect(await screen.findByText("Provider: Ollama")).toBeInTheDocument();
    expect(await screen.findByText("Model: gemma4:e2b")).toBeInTheDocument();

    await waitFor(() => {
      expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(5);
    });

    await waitFor(() => {
      expect(screen.getAllByText("Connected")).toHaveLength(3);
      expect(screen.getAllByText("2/2 connectivity checks passed.")).toHaveLength(3);
      expect(screen.getByRole("button", { name: "Check Now" })).toBeInTheDocument();
    });

    expect(screen.getAllByText(/Last checked:/i)).toHaveLength(3);
    const lastSyncRegion = screen.getByRole("region", { name: "JIRA last sync" });
    expect(within(lastSyncRegion).getByText("Last Sync")).toBeInTheDocument();
    expect(within(lastSyncRegion).queryByText("Previous run")).not.toBeInTheDocument();
    expect(within(lastSyncRegion).getByText("Success")).toBeInTheDocument();
    expect(within(lastSyncRegion).getByText("Completed")).toBeInTheDocument();
    const syncActionRegion = screen.getByRole("region", { name: "JIRA sync action" });
    expect(within(syncActionRegion).getByText("Sync Now")).toBeInTheDocument();
    expect(within(syncActionRegion).queryByText("Ready to sync")).not.toBeInTheDocument();
    expect(within(syncActionRegion).getByText("Ready")).toBeInTheDocument();
    expect(within(syncActionRegion).queryByText("Success")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Diagnostics" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Diagnostics" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Field Mapping Readiness" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Diagnostics" }));
    expect(screen.getByRole("dialog", { name: "Diagnostics" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Diagnostics" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Field Mapping Readiness" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Epic Metadata Configuration" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync Data" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync History" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Delete" }).length).toBeGreaterThan(0);
  });

  it("opens sync overlays and loads history", async () => {
    setupFetchMock({
      "/api/integrations/jira/status": {
        source: "jira",
        connected: true,
        checkedAt: "2026-03-30T09:15:00Z",
        config: {
          baseUrl: "https://jira.example.com",
          projectKey: "CEG",
          boardId: 42,
          storyPointsField: "customfield_10016",
          epicLinkField: "customfield_10014",
          sprintFields: ["customfield_10020"],
        },
        checks: [
          { name: "auth", ok: true, detail: "reachable" },
          { name: "project", ok: true, detail: "resolved" },
        ],
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
      "/api/integrations/confluence/status": {
        source: "confluence",
        connected: true,
        checkedAt: "2026-03-30T09:15:00Z",
        config: {
          baseUrl: "https://gbuconfluence.oraclecorp.com",
          authMode: "pat_bearer",
        },
        checks: [
          { name: "auth", ok: true, detail: "reachable" },
          { name: "space_query", ok: true, detail: "responding" },
        ],
      },
      "/api/integrations/jira/sync/status": {
        source: "jira",
        state: "idle",
        phase: "idle",
        syncMode: "since_last",
        downloadedIssues: 0,
        percent: null,
        lastSyncedAt: "2026-03-30T09:15:00Z",
      },
      "/api/integrations/jira/sync/start": {
        source: "jira",
        state: "running",
        phase: "issues",
        syncMode: "full",
        downloadedIssues: 12,
        percent: 24.0,
        lastSyncedAt: "2026-03-30T09:15:00Z",
      },
      "/api/integrations/jira/sync/history": {
        source: "jira",
        history: [
          {
            id: 1,
            scopeKey: "board:42",
            boardId: 42,
            boardName: "CEGBU Polaris",
        syncMode: "since_last",
        boardsSynced: 1,
        sprintsSynced: 4,
        issuesSynced: 120,
        totalIssues: 200,
        status: "completed",
        startedAt: "2026-03-29T09:00:00Z",
        finishedAt: "2026-03-29T09:10:00Z",
      },
        ],
      },
      "/api/metadata/lookup": {
        groups: [{ id: 1, name: "Core Platform" }],
        workTypes: [{ id: 2, name: "Feature" }],
      },
    });

    render(<IntegrationsScreen />);
    expect(await screen.findByRole("button", { name: "Sync Data" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Sync Data" }));
    expect(screen.getByRole("dialog", { name: "Start JIRA Sync" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start Sync" }));

    fireEvent.click(await screen.findByRole("button", { name: "Sync History" }));
    expect(screen.getByRole("dialog", { name: "JIRA Sync History" })).toBeInTheDocument();
    expect(await screen.findByText("CEGBU Polaris")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Progress" })).not.toBeInTheDocument();
  });

  it("shows running JIRA sync as a dedicated step panel", async () => {
    setupFetchMock({
      "/api/integrations/jira/status": {
        source: "jira",
        connected: true,
        checkedAt: "2026-06-02T00:10:20Z",
        config: {
          baseUrl: "https://jira.example.com",
          projectKey: "CEG",
          boardId: 42,
        },
        checks: [
          { name: "auth", ok: true, detail: "reachable" },
          { name: "project", ok: true, detail: "resolved" },
        ],
      },
      "/api/integrations/ai/status": {
        source: "ollama",
        provider: "ollama",
        configuredProvider: "ollama",
        connected: true,
        checkedAt: "2026-06-02T00:10:20Z",
        config: {
          baseUrl: "http://127.0.0.1:11434",
          modelId: "gemma4:e2b",
        },
        checks: [
          { name: "ollama_api", ok: true, detail: "reachable" },
          { name: "configured_model", ok: true, detail: "loaded" },
        ],
      },
      "/api/integrations/confluence/status": {
        source: "confluence",
        connected: true,
        checkedAt: "2026-06-02T00:10:20Z",
        config: { baseUrl: "https://gbuconfluence.oraclecorp.com" },
        checks: [
          { name: "auth", ok: true, detail: "reachable" },
          { name: "space_query", ok: true, detail: "responding" },
        ],
      },
      "/api/integrations/jira/sync/status": {
        source: "jira",
        state: "running",
        phase: "issues",
        syncMode: "since_last",
        downloadedIssues: 10,
        totalIssues: 39,
        percent: 25.6,
        currentStep: 4,
        totalSteps: 6,
        stepLabel: "Syncing issues and changelog",
        message: "10 of 39 issues downloaded; 155 changelog events synced",
        lastSyncedAt: "2026-06-02T00:30:25Z",
      },
      "/api/integrations/jira/sync/history": {
        source: "jira",
        history: [],
      },
      "/api/metadata/lookup": {
        groups: [],
        workTypes: [],
      },
    });

    render(<IntegrationsScreen />);

    expect(await screen.findByText("Sync in progress")).toBeInTheDocument();
    const lastSyncRegion = screen.getByRole("region", { name: "JIRA last sync" });
    expect(within(lastSyncRegion).getByText("Success")).toBeInTheDocument();
    expect(within(lastSyncRegion).queryByText("Syncing")).not.toBeInTheDocument();
    const syncActionRegion = screen.getByRole("region", { name: "JIRA sync action" });
    expect(within(syncActionRegion).queryByText("Ready to sync")).not.toBeInTheDocument();
    expect(within(syncActionRegion).getByText("Syncing")).toBeInTheDocument();
    expect(screen.getByText("Step 4 of 6: Issues and changelog")).toBeInTheDocument();
    expect(screen.getByText("10 of 39 issues downloaded")).toBeInTheDocument();
    expect(screen.getByText("155 changelog events captured")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "JIRA issue sync progress" })).toHaveAttribute("aria-valuenow", "25.6");
    expect(screen.getByRole("button", { name: "Sync Data" })).toBeDisabled();
    expect(screen.queryByText("Syncing...")).not.toBeInTheDocument();
  });

  it("localizes UTC timestamps in JIRA sync status messages", async () => {
    setupFetchMock({
      "/api/integrations/jira/status": {
        source: "jira",
        connected: true,
        checkedAt: "2026-06-02T00:10:20Z",
        config: { projectKey: "CEG", boardId: 42 },
        checks: [
          { name: "auth", ok: true, detail: "reachable" },
          { name: "project", ok: true, detail: "resolved" },
        ],
      },
      "/api/integrations/ai/status": {
        source: "ollama",
        provider: "ollama",
        configuredProvider: "ollama",
        connected: true,
        checkedAt: "2026-06-02T00:10:20Z",
        config: { modelId: "gemma4:e2b", baseUrl: "http://127.0.0.1:11434" },
        checks: [
          { name: "ollama_api", ok: true, detail: "reachable" },
          { name: "configured_model", ok: true, detail: "loaded" },
        ],
      },
      "/api/integrations/confluence/status": {
        source: "confluence",
        connected: true,
        checkedAt: "2026-06-02T00:10:20Z",
        config: { baseUrl: "https://gbuconfluence.oraclecorp.com" },
        checks: [
          { name: "auth", ok: true, detail: "reachable" },
          { name: "space_query", ok: true, detail: "responding" },
        ],
      },
      "/api/integrations/jira/sync/status": {
        source: "jira",
        state: "running",
        phase: "issues",
        syncMode: "since_last",
        downloadedIssues: 0,
        totalIssues: null,
        percent: null,
        currentStep: 4,
        totalSteps: 6,
        stepLabel: "Syncing issues and changelog",
        message: "Syncing issues updated since 2026-06-02 02:33 UTC.",
        lastSyncedAt: "2026-06-02T00:30:25Z",
      },
      "/api/integrations/jira/sync/history": {
        source: "jira",
        history: [],
      },
      "/api/metadata/lookup": {
        groups: [],
        workTypes: [],
      },
    });

    render(<IntegrationsScreen />);

    const expectedDate = new Date("2026-06-02T02:33:00Z");
    const expectedDay = String(expectedDate.getDate()).padStart(2, "0");
    const expectedMonth = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][expectedDate.getMonth()];
    const expectedLabel = `${expectedDay}-${expectedMonth}-${expectedDate.getFullYear()}, ${expectedDate.toLocaleTimeString()}`;

    expect(await screen.findByText(`Syncing issues updated since ${expectedLabel}.`)).toBeInTheDocument();
    expect(screen.queryByText(/02:33 UTC/)).not.toBeInTheDocument();
  });

  it("shows candidate percentage while total issue count is unknown", async () => {
    setupFetchMock({
      "/api/integrations/jira/status": {
        source: "jira",
        connected: true,
        checkedAt: "2026-06-02T03:30:47Z",
        config: { projectKey: "CEG", boardId: 42 },
        checks: [
          { name: "auth", ok: true, detail: "reachable" },
          { name: "project", ok: true, detail: "resolved" },
        ],
      },
      "/api/integrations/ai/status": {
        source: "ollama",
        provider: "ollama",
        configuredProvider: "ollama",
        connected: true,
        checkedAt: "2026-06-02T03:30:47Z",
        config: { modelId: "gemma4:e2b", baseUrl: "http://127.0.0.1:11434" },
        checks: [
          { name: "ollama_api", ok: true, detail: "reachable" },
          { name: "configured_model", ok: true, detail: "loaded" },
        ],
      },
      "/api/integrations/confluence/status": {
        source: "confluence",
        connected: true,
        checkedAt: "2026-06-02T03:30:47Z",
        config: { baseUrl: "https://gbuconfluence.oraclecorp.com" },
        checks: [
          { name: "auth", ok: true, detail: "reachable" },
          { name: "space_query", ok: true, detail: "responding" },
        ],
      },
      "/api/integrations/jira/sync/status": {
        source: "jira",
        state: "running",
        phase: "issues",
        syncMode: "since_last",
        downloadedIssues: 50,
        totalIssues: null,
        candidateIssues: 80,
        candidateTotalIssues: 160,
        percent: 50,
        currentStep: 4,
        totalSteps: 6,
        stepLabel: "Syncing issues and changelog",
        message: "50 issues downloaded; 704 changelog events synced",
        lastSyncedAt: "2026-06-02T03:30:23Z",
      },
      "/api/integrations/jira/sync/history": {
        source: "jira",
        history: [],
      },
      "/api/metadata/lookup": {
        groups: [],
        workTypes: [],
      },
    });

    render(<IntegrationsScreen />);

    expect(await screen.findByText("50 issues downloaded")).toBeInTheDocument();
    expect(screen.getByText("704 changelog events captured")).toBeInTheDocument();
    expect(screen.getByText("80 of 160 candidates checked")).toBeInTheDocument();
    const issueProgress = screen.getByRole("progressbar", { name: "JIRA issue sync progress" });
    expect(issueProgress).toHaveAttribute("aria-valuenow", "50");
    expect(issueProgress).not.toHaveAttribute("aria-valuetext");
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.queryByText("50 issues downloaded; 704 changelog events synced")).not.toBeInTheDocument();
  });

  it("does not label completed since-last totals as changed without candidate metadata", async () => {
    setupFetchMock({
      "/api/integrations/jira/status": {
        source: "jira",
        connected: true,
        checkedAt: "2026-06-02T03:14:02Z",
        config: { projectKey: "CEG", boardId: 42 },
        checks: [
          { name: "auth", ok: true, detail: "reachable" },
          { name: "project", ok: true, detail: "resolved" },
        ],
      },
      "/api/integrations/ai/status": {
        source: "ollama",
        provider: "ollama",
        configuredProvider: "ollama",
        connected: true,
        checkedAt: "2026-06-02T03:14:02Z",
        config: { modelId: "gemma4:e2b", baseUrl: "http://127.0.0.1:11434" },
        checks: [
          { name: "ollama_api", ok: true, detail: "reachable" },
          { name: "configured_model", ok: true, detail: "loaded" },
        ],
      },
      "/api/integrations/confluence/status": {
        source: "confluence",
        connected: true,
        checkedAt: "2026-06-02T03:14:02Z",
        config: { baseUrl: "https://gbuconfluence.oraclecorp.com" },
        checks: [
          { name: "auth", ok: true, detail: "reachable" },
          { name: "space_query", ok: true, detail: "responding" },
        ],
      },
      "/api/integrations/jira/sync/status": {
        source: "jira",
        state: "completed",
        phase: "done",
        syncMode: "since_last",
        downloadedIssues: 4549,
        totalIssues: 4549,
        percent: 100,
        lastSyncedAt: "2026-06-02T03:15:57Z",
      },
      "/api/integrations/jira/sync/history": {
        source: "jira",
        history: [],
      },
      "/api/metadata/lookup": {
        groups: [],
        workTypes: [],
      },
    });

    render(<IntegrationsScreen />);

    expect(await screen.findByText("4549 issues synced")).toBeInTheDocument();
    const lastSyncRegion = screen.getByRole("region", { name: "JIRA last sync" });
    expect(within(lastSyncRegion).queryByText("4549 issues changed")).not.toBeInTheDocument();
  });

  it("uses overlay confirmation before deleting epic metadata lookup values", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    confirmSpy.mockReturnValue(true);

    setupFetchMock({
      "/api/integrations/jira/status": {
        source: "jira",
        connected: true,
        checkedAt: "2026-03-30T09:15:00Z",
        config: { projectKey: "CEG", boardId: 42 },
        checks: [
          { name: "auth", ok: true, detail: "reachable" },
          { name: "project", ok: true, detail: "resolved" },
        ],
      },
      "/api/integrations/ai/status": {
        source: "ollama",
        provider: "ollama",
        configuredProvider: "ollama",
        connected: true,
        checkedAt: "2026-03-30T09:15:00Z",
        config: { modelId: "gemma4:e2b", baseUrl: "http://127.0.0.1:11434" },
        checks: [
          { name: "ollama_api", ok: true, detail: "reachable" },
          { name: "configured_model", ok: true, detail: "loaded" },
        ],
      },
      "/api/integrations/confluence/status": {
        source: "confluence",
        connected: true,
        checkedAt: "2026-03-30T09:15:00Z",
        config: { baseUrl: "https://gbuconfluence.oraclecorp.com" },
        checks: [
          { name: "auth", ok: true, detail: "reachable" },
          { name: "space_query", ok: true, detail: "responding" },
        ],
      },
      "/api/integrations/jira/sync/status": {
        source: "jira",
        state: "idle",
        phase: "idle",
        syncMode: "since_last",
        downloadedIssues: 0,
        percent: null,
      },
      "/api/metadata/lookup/groups/delete": {
        id: 1,
        deleted: true,
      },
      "/api/metadata/lookup": {
        groups: [{ id: 1, name: "Core Platform" }],
        workTypes: [{ id: 2, name: "Feature" }],
      },
    });

    render(<IntegrationsScreen />);
    expect(await screen.findByText("Core Platform")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
    const dialog = screen.getByRole("dialog", { name: "Confirm Metadata Delete" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText(/Are you sure you want to delete/i)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Confirm Metadata Delete" })).not.toBeInTheDocument();
    });
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
