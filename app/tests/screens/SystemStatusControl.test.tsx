import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { within } from "@testing-library/dom";
import { afterEach, vi } from "vitest";
import { SystemStatusControl } from "../../src/components/content/screens/SystemStatusControl";
import { setupFetchMock } from "../utils/fetchMock";

function renderSystemStatusControl(): HTMLButtonElement {
  render(<SystemStatusControl />);
  const trigger = screen.getByRole("button", { name: /System status:/ });
  fireEvent.click(trigger);
  return trigger;
}

function connectedHandlers() {
  return {
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
      source: "openai",
      provider: "openai",
      configuredProvider: "openai",
      connected: true,
      checkedAt: "2026-03-30T09:15:00Z",
      config: { modelId: "gpt-test" },
      checks: [{ name: "model", ok: true, detail: "reachable" }],
    },
    "/api/integrations/confluence/status": {
      source: "confluence",
      connected: true,
      checkedAt: "2026-03-30T09:15:00Z",
      config: { baseUrl: "https://confluence.example.com" },
      checks: [{ name: "auth", ok: true, detail: "reachable" }],
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
  };
}

describe("SystemStatusControl", () => {
  afterEach(() => {
    document.body.style.overflow = "";
    vi.restoreAllMocks();
  });

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

    renderSystemStatusControl();

    expect(screen.getByRole("dialog", { name: "System status" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "JIRA" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "AI model" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Confluence" })).toBeInTheDocument();
    expect(await screen.findByText("Ollama")).toBeInTheDocument();
    expect(await screen.findByText("gemma4:e2b")).toBeInTheDocument();

    await waitFor(() => {
      expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(4);
    });

    await waitFor(() => {
      expect(screen.getAllByText("Connected")).toHaveLength(3);
      expect(screen.getAllByText("2/2 connectivity checks passed.")).toHaveLength(3);
      expect(screen.getByRole("button", { name: "Check now" })).toBeInTheDocument();
    });

    expect(screen.getAllByText(/Last checked:/i)).toHaveLength(3);
    const jiraSyncRegion = screen.getByRole("region", { name: "JIRA data sync" });
    expect(within(jiraSyncRegion).getByText("Data sync")).toBeInTheDocument();
    expect(within(jiraSyncRegion).getByText("Success")).toBeInTheDocument();
    expect(within(jiraSyncRegion).getByText("Last sync")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Diagnostics" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Diagnostics" }));
    expect(screen.getByRole("dialog", { name: "JIRA diagnostics" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Field mapping readiness" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to system status" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Board 42" })).toHaveAttribute("href", "https://jira.example.com/secure/RapidBoard.jspa?rapidView=42");
    expect(screen.getByRole("link", { name: "CEG-100" })).toHaveAttribute("href", "https://jira.example.com/browse/CEG-100");
    expect(screen.getByRole("link", { name: "CEG" })).toHaveAttribute("href", "https://jira.example.com/projects/CEG");
    fireEvent.click(screen.getByRole("button", { name: "Back to system status" }));
    expect(screen.getByRole("dialog", { name: "System status" })).toBeInTheDocument();
  });

  it("opens sync overlays and loads history", async () => {
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
          {
            id: 2,
            scopeKey: "board:43",
            boardId: 43,
            syncMode: "since_date",
            requestedSince: "2026-03-01",
            boardsSynced: 1,
            sprintsSynced: 0,
            issuesSynced: 2,
            totalIssues: 2,
            status: "completed",
            startedAt: "not-a-timestamp",
            finishedAt: null,
          },
          {
            id: 3,
            scopeKey: "board:unknown",
            boardId: null,
            syncMode: "since_date",
            requestedSince: null,
            boardsSynced: 0,
            sprintsSynced: 0,
            issuesSynced: 0,
            totalIssues: 0,
            status: "failed",
            startedAt: null,
            finishedAt: null,
          },
        ],
      },
      "/api/metadata/lookup": {
        groups: [{ id: 1, name: "Core Platform" }],
        workTypes: [{ id: 2, name: "Feature" }],
      },
    });

    renderSystemStatusControl();
    expect(await screen.findByRole("region", { name: "JIRA data sync" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync data" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Sync data" }));
    expect(screen.getByRole("dialog", { name: "Start JIRA sync" })).toBeInTheDocument();
    const deletionCheckbox = screen.getByRole("checkbox", {
      name: /Remove cards deleted from JIRA/,
    });
    expect(deletionCheckbox).not.toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: /Full sync/ }));
    fireEvent.click(deletionCheckbox);
    fireEvent.click(screen.getByRole("button", { name: "Start sync" }));

    await waitFor(() => {
      expect(fetchSpy.mock.calls.some(([input, init]) => (
        String(input).includes("/api/integrations/jira/sync/start")
        && init?.method === "POST"
        && JSON.parse(String(init.body)).mode === "full"
        && JSON.parse(String(init.body)).reconcileDeletedIssues === true
      ))).toBe(true);
    });

    fireEvent.click(await screen.findByRole("button", { name: "History" }));
    expect(screen.getByRole("dialog", { name: "JIRA sync history" })).toBeInTheDocument();
    expect(await screen.findByText("CEGBU Polaris")).toBeInTheDocument();
    expect(screen.getByText("Board 43")).toBeInTheDocument();
    expect(screen.getByText("Since 01-Mar-2026")).toBeInTheDocument();
    expect(screen.getByText("Since Date")).toBeInTheDocument();
    expect(screen.getByText("not-a-timestamp")).toBeInTheDocument();
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

    renderSystemStatusControl();

    expect(await screen.findByText("Sync in progress")).toBeInTheDocument();
    const jiraSyncRegion = screen.getByRole("region", { name: "JIRA data sync" });
    expect(within(jiraSyncRegion).getByText("Syncing")).toBeInTheDocument();
    expect(screen.getByText("Step 4 of 6: Issues and changelog")).toBeInTheDocument();
    expect(screen.getByText("10 of 39 issues downloaded")).toBeInTheDocument();
    expect(screen.getByText("155 changelog events captured")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "JIRA issue sync progress" })).toHaveAttribute("aria-valuenow", "25.6");
    expect(screen.getByRole("button", { name: "Sync data" })).toBeDisabled();
    expect(screen.queryByText("Syncing...")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(screen.getByRole("dialog", { name: "JIRA sync history" })).toBeInTheDocument();
    expect(await screen.findByText("No sync history available yet.")).toBeInTheDocument();
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

    renderSystemStatusControl();

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

    renderSystemStatusControl();

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
        deletedIssuesRemoved: 1,
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

    renderSystemStatusControl();

    const jiraSyncRegion = await screen.findByRole("region", { name: "JIRA data sync" });
    expect(await within(jiraSyncRegion).findByText(
      "4549 issues synced · 1 deleted issue removed",
    )).toBeInTheDocument();
    expect(within(jiraSyncRegion).queryByText("4549 issues changed")).not.toBeInTheDocument();
  });

  it("traps focus, closes with Escape, and restores focus to the trigger", async () => {
    setupFetchMock(connectedHandlers());
    const trigger = renderSystemStatusControl();
    const dialog = screen.getByRole("dialog", { name: "System status" });
    const heading = screen.getByRole("heading", { name: "System status" });

    expect(heading).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");

    const buttons = within(dialog).getAllByRole("button");
    const firstButton = buttons[0];
    const lastButton = buttons[buttons.length - 1];
    lastButton.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(firstButton).toHaveFocus();
    firstButton.focus();
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(lastButton).toHaveFocus();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(document.body.style.overflow).toBe("");
  });

  it("closes from the close button and the backdrop", async () => {
    setupFetchMock(connectedHandlers());
    const { container } = render(<SystemStatusControl />);
    const trigger = screen.getByRole("button", { name: /System status:/ });

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Close system status" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(trigger);
    const backdrop = container.querySelector(".tb-system-status-backdrop");
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop as HTMLElement);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows unavailable systems and failed sync or history requests without leaving the header", async () => {
    const response = (payload: Record<string, unknown>, status = 200) => Promise.resolve(new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    }));
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.includes("/api/integrations/jira/sync/history")) return response({ detail: "History unavailable" }, 503);
      if (url.includes("/api/integrations/jira/sync/status")) return response({ detail: "Sync status unavailable" }, 503);
      if (url.includes("/api/integrations/jira/status")) return Promise.reject(new Error("JIRA is offline"));
      if (url.includes("/api/integrations/confluence/status")) return Promise.reject(new Error("Confluence is offline"));
      if (url.includes("/api/integrations/ai/status")) return Promise.reject("AI is offline");
      return Promise.reject(new Error(`Unhandled request: ${url}`));
    });

    renderSystemStatusControl();
    await waitFor(() => expect(screen.getByRole("button", { name: "System status: 3 systems need attention" })).toBeInTheDocument());
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText("JIRA is offline")).toBeInTheDocument();
    expect(screen.getByText("Unknown AI status failure.")).toBeInTheDocument();
    expect(screen.getByText(/Sync status error: Sync status unavailable/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Check now" }));
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(await screen.findByText(/Failed to load history: History unavailable/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  });

  it("validates date-based sync and reports start failures", async () => {
    const handlers = {
      ...connectedHandlers(),
      "/api/integrations/jira/sync/start": { detail: "Sync start failed" },
    };
    const orderedHandlers = Object.entries(handlers).sort(([left], [right]) => right.length - left.length);
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      const match = orderedHandlers.find(([path]) => url.includes(path));
      if (!match) return Promise.reject(new Error(`Unhandled request: ${url}`));
      const isStart = url.includes("/api/integrations/jira/sync/start");
      return Promise.resolve(new Response(JSON.stringify(match[1]), {
        status: isStart ? 500 : 200,
        headers: { "Content-Type": "application/json" },
      }));
    });

    renderSystemStatusControl();
    await screen.findByRole("button", { name: "Sync data" });
    fireEvent.click(screen.getByRole("button", { name: "Sync data" }));
    fireEvent.click(screen.getByRole("radio", { name: /Sync since specific date/ }));
    const startDate = screen.getByLabelText("Start date (UTC)");
    fireEvent.input(startDate, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Start sync" }));
    expect(screen.getByText("Please select a start date for date-based sync.")).toBeInTheDocument();

    fireEvent.input(startDate, { target: { value: "2026-03-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Start sync" }));
    expect(await screen.findByText("Sync start failed")).toBeInTheDocument();
  });

  it("surfaces skipped changelog warnings from either supported JIRA message format", async () => {
    setupFetchMock({
      ...connectedHandlers(),
      "/api/integrations/jira/sync/status": {
        source: "jira",
        state: "running",
        phase: "board",
        syncMode: "since_last",
        downloadedIssues: 0,
        percent: null,
        message: "Skipped changelog for 7 issue(s)",
      },
    });

    renderSystemStatusControl();
    expect(await screen.findByText("7 issue changelogs skipped after transient JIRA errors.")).toBeInTheDocument();
    expect(screen.getByText("Board metadata")).toBeInTheDocument();
    const progress = screen.getByRole("progressbar", { name: "JIRA issue sync progress" });
    expect(progress).toHaveAttribute("aria-valuetext", "In progress");
    expect(progress).not.toHaveAttribute("aria-valuenow");
  });

  it("uses clear fallback labels for disconnected systems and failed syncs", async () => {
    setupFetchMock({
      ...connectedHandlers(),
      "/api/integrations/jira/status": {
        source: "jira",
        connected: false,
        checkedAt: "not-a-date",
        config: {},
        checks: [],
        error: "JIRA permission denied",
      },
      "/api/integrations/confluence/status": {
        source: "confluence",
        connected: false,
        checkedAt: null,
        config: {},
        checks: [],
      },
      "/api/integrations/ai/status": {
        source: "oci_genai",
        provider: "oci_genai",
        connected: false,
        checkedAt: null,
        config: { modelId: " " },
        checks: [],
      },
      "/api/integrations/jira/sync/status": {
        source: "jira",
        state: "failed",
        phase: "done",
        syncMode: "since_date",
        requestedSince: "not-a-date",
        downloadedIssues: 1,
        percent: null,
        error: "JIRA sync failed",
      },
    });

    renderSystemStatusControl();
    await waitFor(() => expect(screen.getByRole("button", { name: "System status: 3 systems need attention" })).toBeInTheDocument());
    expect(screen.getAllByText("Check required")).toHaveLength(3);
    expect(screen.getByText("JIRA permission denied")).toBeInTheDocument();
    expect(screen.getAllByText("No connectivity checks returned.")).toHaveLength(2);
    expect(screen.getByText("OCI")).toBeInTheDocument();
    expect(screen.getAllByText("n/a").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Since not-a-date")).toBeInTheDocument();
    expect(screen.getByText("JIRA sync failed")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Diagnostics" }));
    expect(screen.getAllByText("n/a").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("none")).toBeInTheDocument();
    expect(screen.getByText("Pending live check")).toBeInTheDocument();
    expect(screen.getByText("auto-detected")).toBeInTheDocument();
  });

  it.each([
    ["releases", "Releases"],
    ["sprints", "Sprints"],
    ["active_sprint", "Active sprint"],
    ["done", "Finalize"],
    ["other", "Custom phase"],
  ])("labels the %s JIRA sync phase", async (phase, expectedLabel) => {
    setupFetchMock({
      ...connectedHandlers(),
      "/api/integrations/jira/sync/status": {
        source: "jira",
        state: "running",
        phase,
        syncMode: "since_last",
        downloadedIssues: 0,
        percent: 101,
        stepLabel: "reconciling custom phase",
      },
    });

    renderSystemStatusControl();
    expect(await screen.findByText(expectedLabel)).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

});
