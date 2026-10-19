import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { within } from "@testing-library/dom";
import { beforeEach, vi } from "vitest";
import * as persistence from "../../src/lib/persistence";
import {
  EXPORT_TEAM_REPORT_HTML_EVENT,
  OPEN_TEAM_REPORT_INITIATIVE_CONFIG_EVENT,
  OPEN_TEAM_REPORT_REPORTING_PERIOD_EVENT,
  TeamReportScreen,
} from "../../src/components/content/screens/TeamReportScreen";

const INITIATIVE_SELECTION_KEY = "teambeacon.executive.initiative.visibleEpicKeys";

// Each test represents a fresh browser profile; preserve preferences within a test only.
beforeEach(() => {
  const store = new Map<string, string>();
  vi.spyOn(persistence, "getPreferenceSync").mockImplementation((key) => store.get(key) ?? null);
  vi.spyOn(persistence, "getPreference").mockImplementation(async (key) => store.get(key) ?? null);
  vi.spyOn(persistence, "setPreference").mockImplementation(async (key, value) => { store.set(key, value); });
});

function jsonResponse(payload: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("TeamReportScreen", () => {
  it("builds completed work from synced issues and supports initiative selection", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url.includes("/api/metadata/epics/summary")) {
        return jsonResponse({
          epics: [
            {
              epicKey: "CEG-EPIC-12",
              epicName: "Executive reporting automation",
              completedCards: 18,
              totalCards: 30,
              completionPercent: 60,
              completedInPeriod: 5,
              deltaPercentInPeriod: 16.7,
              groups: [{ id: 1, name: "Core Platform" }],
              workTypes: [{ id: 2, name: "Feature" }],
              successCriteria: ["Automated summary generation"],
              timelineEnabled: true,
              timelineStartDate: "2026-03-01",
              targetCompletionDate: "2026-05-15",
            },
            {
              epicKey: "CEG-EPIC-34",
              epicName: "Risk reporting hardening",
              completedCards: 9,
              totalCards: 20,
              completionPercent: 45,
              completedInPeriod: 2,
              deltaPercentInPeriod: 10,
              groups: [{ id: 3, name: "Operations" }],
              workTypes: [{ id: 4, name: "Reliability" }],
              successCriteria: ["Reduce late risk discovery"],
              timelineEnabled: false,
              timelineStartDate: null,
              targetCompletionDate: null,
            },
          ],
          reportingPeriod: {
            startDate: "2026-03-24",
            endDate: "2026-03-30",
            days: 7,
            timezone: "UTC",
          },
        });
      }

      if (url.includes("/api/integrations/jira/status")) {
        return jsonResponse({
          source: "jira",
          connected: true,
          checkedAt: "2026-03-30T09:15:00Z",
          config: {
            baseUrl: "https://jira.example.com",
            projectKey: "CEG",
            boardId: 42,
          },
          checks: [
            { name: "auth", ok: true, detail: "reachable" },
            { name: "project", ok: true, detail: "resolved" },
          ],
        });
      }

      if (url.includes("/api/metadata/epics/completed-cards/configured")) {
        return jsonResponse({
          source: "local",
          scope: "configured",
          count: 5,
          limit: 400,
          truncated: false,
          completedCards: [
            {
              issueKey: "CEG-1010",
              summary: "Automated executive dashboard summary workflow",
              status: "Done",
              storyPoints: 5,
              completedAt: "2026-03-26T09:00:00Z",
              epicKey: "CEG-EPIC-12",
              epicName: "Executive reporting automation",
            },
            {
              issueKey: "CEG-1011",
              summary: "Published leadership-ready report export template",
              status: "Closed",
              storyPoints: 3,
              completedAt: "2026-03-28T09:00:00Z",
              epicKey: "CEG-EPIC-12",
              epicName: "Executive reporting automation",
            },
            {
              issueKey: "CEG-2012",
              summary: "Improved risk signal validation against release cadence",
              status: "Done",
              storyPoints: 2,
              completedAt: "2026-03-29T09:00:00Z",
              epicKey: "CEG-EPIC-34",
              epicName: "Risk reporting hardening",
            },
          ],
          perEpicCounts: {
            "CEG-EPIC-12": 2,
            "CEG-EPIC-34": 1,
          },
          reportingPeriod: {
            startDate: "2026-03-24",
            endDate: "2026-03-30",
            days: 7,
            timezone: "UTC",
          },
        });
      }


      return Promise.reject(new Error(`Unhandled fetch request in test: ${url}`));
    });

    render(<TeamReportScreen />);

    expect(await screen.findByRole("heading", { name: "Completed Work Summary" })).toBeInTheDocument();
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes("/epics/summary?limit=all"))).toBe(true);
    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual([
      "Report Signals",
      "Work Mix by Work Stream and Type",
      "Progress for Key Initiatives",
      "Completed Work Summary",
    ]);
    expect(screen.queryByRole("heading", { name: "Executive Summary" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Wins and Risks" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refresh Summary" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refresh Wins and Risks" })).not.toBeInTheDocument();
    await screen.findByText("Automated executive dashboard summary workflow");
    const selectedInitiativesCard = screen.getByRole("heading", { name: "Selected Initiatives" }).closest("article")!;
    expect(within(selectedInitiativesCard).getByText("Initiatives included in this report.")).toBeInTheDocument();
    expect(within(selectedInitiativesCard).getByText("2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh Completed Work Summary" })).toBeInTheDocument();

    const completedWorkPanel = screen.getByRole("heading", { name: "Completed Work Summary" }).closest("section");
    expect(completedWorkPanel).not.toBeNull();
    if (!completedWorkPanel) {
      throw new Error("Completed Work Summary section not found.");
    }
    const scopedCompletedWork = within(completedWorkPanel);
    expect(await scopedCompletedWork.findByText("Core Platform")).toBeInTheDocument();
    expect(await scopedCompletedWork.findByText("Operations")).toBeInTheDocument();
    expect(await scopedCompletedWork.findByText("Automated executive dashboard summary workflow")).toBeInTheDocument();
    expect(await scopedCompletedWork.findByText("Improved risk signal validation against release cadence")).toBeInTheDocument();
    expect(scopedCompletedWork.getAllByRole("listitem")).toHaveLength(3);
    const completedBullet = scopedCompletedWork.getAllByRole("listitem")[0];
    expect(within(completedBullet).getByText("Automated executive dashboard summary workflow")).toBeInTheDocument();
    const epicHeading = scopedCompletedWork.getByRole("heading", { level: 5, name: "Executive reporting automation (CEG-EPIC-12)" });
    expect(within(epicHeading).getByRole("link")).toHaveAttribute("href", "https://jira.example.com/browse/CEG-EPIC-12");
    expect(within(epicHeading).getByRole("link")).toHaveAttribute("target", "_blank");
    expect(scopedCompletedWork.getAllByRole("link", { name: "CEG-EPIC-12" })).toHaveLength(1);
    expect(within(epicHeading.parentElement!).getAllByRole("listitem")).toHaveLength(2);
    expect(within(completedBullet).queryByRole("link", { name: "Executive reporting automation" })).not.toBeInTheDocument();
    const issueLink = within(completedBullet).getByRole("link", { name: "CEG-1010" });
    expect(issueLink).toHaveAttribute("href", "https://jira.example.com/browse/CEG-1010");
    expect(issueLink).toHaveAttribute("target", "_blank");
    expect(issueLink).toHaveAttribute("rel", "noopener noreferrer");
    expect(issueLink.parentElement).toBe(completedBullet);
    expect(completedBullet).toHaveTextContent(/^Automated executive dashboard summary workflow \(CEG-1010\)$/);
    expect(within(scopedCompletedWork.getAllByRole("listitem")[2]).getByRole("link", { name: "CEG-2012" })).toBeInTheDocument();

    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "showSaveFilePicker", { configurable: true, value: vi.fn().mockResolvedValue({
      createWritable: async () => ({ write, close: async () => undefined }),
    }) });
    try {
      window.dispatchEvent(new CustomEvent(EXPORT_TEAM_REPORT_HTML_EVENT));
      await waitFor(() => expect(write).toHaveBeenCalledOnce());
      const html = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsText(write.mock.calls[0][0]);
      });
      const report = new DOMParser().parseFromString(html, "text/html");
      expect([...report.querySelectorAll("h2")].map((heading) => heading.textContent)).toEqual([
        "Report Signals", "Work Mix by Work Stream and Type", "Progress for Key Initiatives", "Completed Work Summary",
      ]);
      const issue = report.querySelector('a[href="https://jira.example.com/browse/CEG-1010"]')!;
      expect(issue.textContent).toBe("CEG-1010");
      expect(issue.getAttribute("target")).toBe("_blank");
      expect(issue.closest("li")?.textContent).toContain("Automated executive dashboard summary workflow");
      const epicBlock = issue.closest(".completed-epic")!;
      expect(epicBlock.querySelector('h5 a[href="https://jira.example.com/browse/CEG-EPIC-12"]')?.textContent).toBe("CEG-EPIC-12");
      expect(epicBlock.querySelector("h5")?.textContent).toBe("Executive reporting automation (CEG-EPIC-12)");
      expect(epicBlock.querySelectorAll("li")).toHaveLength(2);
      expect(epicBlock.querySelectorAll('a[href="https://jira.example.com/browse/CEG-EPIC-12"]')).toHaveLength(1);
      expect(issue.parentElement?.tagName).toBe("LI");
      expect(issue.parentElement?.textContent).toBe("Automated executive dashboard summary workflow (CEG-1010)");
      const exportedMix = [...report.querySelectorAll("h2")].find((heading) => heading.textContent === "Work Mix by Work Stream and Type")!.closest("section")!;
      expect(exportedMix.querySelector("table")).toBeNull();
      expect(exportedMix.querySelectorAll('[role="img"]')).toHaveLength(2);
      expect(exportedMix.querySelector(".workmix-centre")?.textContent).toBe("");
      expect(exportedMix.textContent).toContain("71.4%");
      expect(exportedMix.textContent).toContain("28.6%");
      const exportedProgress = [...report.querySelectorAll("h2")].find((heading) => heading.textContent === "Progress for Key Initiatives")!.closest("section")!;
      expect([...exportedProgress.querySelectorAll("thead th")].map((header) => header.textContent)).toEqual([
        "Initiative", "Period progress", "Overall completion", "Timeline health",
      ]);
      expect([...exportedProgress.querySelectorAll('th[scope="rowgroup"]')].map((header) => header.textContent)).toEqual(["Core Platform", "Operations"]);
      expect(exportedProgress.textContent).toContain("5/30 cards (16.7%)");
      expect(exportedProgress.textContent).toContain("Delivery progress for initiatives included in this report.");
      expect(exportedProgress.querySelector("table")?.classList.contains("initiative-table")).toBe(true);

    } finally {
      Reflect.deleteProperty(window, "showSaveFilePicker");
    }


    const progressPanel = screen.getByRole("heading", { name: "Progress for Key Initiatives" }).closest("section")!;
    expect(within(progressPanel).getByText("Executive reporting automation")).toBeInTheDocument();
    const unassessedRow = within(progressPanel).getByText("Risk reporting hardening").closest("tr")!;
    expect(within(unassessedRow).getByText("Not assessed")).toHaveClass("is-neutral");
    const progress = within(progressPanel);
    expect(progress.getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "Initiative", "Period progress", "Overall completion", "Timeline health",
    ]);
    expect(progress.getAllByRole("rowheader").map((header) => header.textContent)).toEqual(["Core Platform", "Operations"]);
    expect(progress.getByText("5/30 cards (16.7%)")).toBeInTheDocument();
    expect(progress.getByText("Delivery progress for initiatives included in this report.")).toBeInTheDocument();
    expect(progress.getByRole("table")).toHaveClass("tb-exec-initiative-table");
    expect(progress.queryByText("+16.7 pp")).not.toBeInTheDocument();
    const health = within(unassessedRow).getByRole("button", { name: "Not assessed" });
    fireEvent.focus(health);
    expect(progress.getByRole("tooltip")).toHaveTextContent(/timeline/i);
    expect(health).toHaveAttribute("aria-describedby", progress.getByRole("tooltip").id);
    fireEvent.keyDown(health, { key: "Escape" });
    expect(progress.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.mouseEnter(health.parentElement!);
    expect(progress.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.mouseLeave(health.parentElement!);
    expect(progress.queryByRole("tooltip")).not.toBeInTheDocument();

    expect(within(screen.getByRole("heading", { name: "Initiative RAG" }).closest("article")!).getByText(/1 not assessed/)).toBeInTheDocument();
    expect(screen.getByLabelText("Work stream effort distribution chart")).toBeInTheDocument();
    expect(screen.getByLabelText("Type effort distribution chart")).toBeInTheDocument();
    const mixPanel = screen.getByRole("heading", { name: "Work Mix by Work Stream and Type" }).closest("section")!;
    expect(within(mixPanel).queryByRole("table")).not.toBeInTheDocument();
    expect(within(mixPanel).getAllByRole("img")).toHaveLength(2);
    for (const title of ["Work Stream Mix", "Work Type Mix"]) {
      const chart = within(mixPanel).getByRole("heading", { name: title }).closest("section")!;
      expect(within(chart).queryByText("7")).not.toBeInTheDocument();
      expect(within(chart).queryByText("completed cards")).not.toBeInTheDocument();
      expect(within(chart).getByText("71.4%")).toBeInTheDocument();
      expect(within(chart).getByText("28.6%")).toBeInTheDocument();
    }

    expect(fetchSpy.mock.calls.some(([url]) => /\/api\/(ai\/chat|integrations\/ai\/status)/.test(String(url)))).toBe(false);
    const completedCalls = () => fetchSpy.mock.calls.filter(([url]) => String(url).includes("/completed-cards/configured")).length;
    const initialCompletedCallCount = completedCalls();
    fireEvent.click(screen.getByRole("button", { name: "Refresh Completed Work Summary" }));
    await waitFor(() => expect(completedCalls()).toBe(initialCompletedCallCount + 1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Refresh Completed Work Summary" })).toBeEnabled());
    const beforeSelectionChange = completedCalls();

    window.dispatchEvent(new CustomEvent(OPEN_TEAM_REPORT_INITIATIVE_CONFIG_EVENT));
    const dialog = await screen.findByRole("dialog", { name: "Configure Initiative Epics" });
    expect(dialog).toBeInTheDocument();

    fireEvent.dblClick(within(dialog).getByText("Executive reporting automation"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Configure Initiative Epics" })).not.toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.queryByText("Executive reporting automation")).not.toBeInTheDocument();
    });
    expect(completedCalls()).toBe(beforeSelectionChange);
    expect(JSON.parse(persistence.getPreferenceSync(INITIATIVE_SELECTION_KEY)!)).toEqual({ mode: "manual", keys: ["CEG-EPIC-34"] });

    window.dispatchEvent(new CustomEvent(OPEN_TEAM_REPORT_REPORTING_PERIOD_EVENT));
    expect(await screen.findByRole("dialog", { name: "Configure Reporting Period" })).toBeInTheDocument();

    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(4);
  });
});

it.each([null, "invalid"])("does not assess report RAG for an enabled timeline with target %s", async (targetCompletionDate) => {
  expect(persistence.getPreferenceSync(INITIATIVE_SELECTION_KEY)).toBeNull();
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    if (String(input).includes("/metadata/epics/summary")) return new Response(JSON.stringify({ epics: [{
      epicKey: "CEG-EPIC-12", epicName: "Incomplete timeline", groups: [], workTypes: [], successCriteria: [],
      timelineEnabled: true, timelineStartDate: null, targetCompletionDate,
      completedCards: 10, totalCards: 10, completionPercent: 100, completedInPeriod: 0,
    }] }));
    return new Response(JSON.stringify({ config: {} }));
  });
  render(<TeamReportScreen />);
  const row = (await screen.findByText("Incomplete timeline")).closest("tr")!;
  expect(within(row).getByText("Not assessed")).toHaveClass("is-neutral");
  const mix = screen.getByRole("heading", { name: "Work Mix by Work Stream and Type" }).closest("section")!;
  expect(within(mix).getAllByText("No data")).toHaveLength(2);
  expect(within(mix).queryByRole("table")).not.toBeInTheDocument();
  const summary = screen.getByRole("heading", { name: "Initiative RAG" }).closest("article")!;
  for (const label of ["0 Red", "0 Amber", "0 Green"]) expect(within(summary).getByText(label)).toBeInTheDocument();
});

it("keeps report loading failures visible without requesting removed narratives", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    if (String(input).includes("/metadata/epics/summary")) return new Response("Unavailable", { status: 500 });
    return jsonResponse({ config: {} });
  });
  render(<TeamReportScreen />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Team report error:");
  expect(screen.queryByRole("heading", { name: "Executive Summary" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Wins and Risks" })).not.toBeInTheDocument();
  expect(fetchSpy.mock.calls.some(([url]) => String(url).includes("/api/ai/chat"))).toBe(false);
});


const fastReportEpic = {
  epicKey: "PERF-1", epicName: "Fast report initiative", groups: [{ id: 1, name: "Platform" }], workTypes: [],
  successCriteria: [], completedCards: 1, totalCards: 1, completionPercent: 100, completedInPeriod: 1,
  timelineEnabled: false,
};
const completedCardPayload = (summary = "Delivered deterministic report") => ({
  count: 1, truncated: false, completedCards: [{
    issueKey: "PERF-2", epicKey: "PERF-1", summary,
  }],
});

it("starts report and card requests together and renders without waiting for JIRA health", async () => {
  let finishSummary!: (response: Response) => void;
  const summaryPromise = new Promise<Response>((resolve) => { finishSummary = resolve; });
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = String(input);
    if (url.includes("/integrations/jira/status")) return new Promise<Response>(() => undefined);
    if (url.includes("/metadata/epics/summary")) return summaryPromise;
    if (url.includes("/completed-cards/configured")) return jsonResponse(completedCardPayload());
    return Promise.reject(new Error(`Unexpected request: ${url}`));
  });
  render(<TeamReportScreen />);
  await waitFor(() => expect(fetchSpy.mock.calls.filter(([url]) => String(url).includes("/completed-cards/configured"))).toHaveLength(1));
  await act(async () => { finishSummary(await jsonResponse({ epics: [fastReportEpic] })); });
  expect(await screen.findByText("Delivered deterministic report")).toBeInTheDocument();
  expect(screen.getByText("Source: synced JIRA issues")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Refresh Completed Work Summary" })).toBeEnabled();
  expect(fetchSpy.mock.calls.some(([url]) => String(url).includes("/ai/"))).toBe(false);
  expect(fetchSpy.mock.calls.filter(([url]) => String(url).includes("/completed-cards/configured"))).toHaveLength(1);
});

it("loads truncated card results fully and lets failed refreshes recover", async () => {
  let cardCalls = 0;
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = String(input);
    if (url.includes("/metadata/epics/summary")) return jsonResponse({ epics: [fastReportEpic] });
    if (url.includes("/completed-cards/configured")) {
      cardCalls += 1;
      if (cardCalls === 1) return jsonResponse({ ...completedCardPayload(), truncated: true, count: 2001 });
      if (cardCalls === 3) return jsonResponse({ error: "Card store unavailable" }, 500);
      return jsonResponse(completedCardPayload(cardCalls > 3 ? "Recovered completed work" : "All completed work"));
    }
    return jsonResponse({ config: {} });
  });
  render(<TeamReportScreen />);
  expect(await screen.findByText("All completed work")).toBeInTheDocument();
  const requests = fetchSpy.mock.calls.filter(([url]) => String(url).includes("/completed-cards/configured"));
  expect(requests).toHaveLength(2);
  expect(String(requests[1][0])).toContain("limit=2001");
  fireEvent.click(screen.getByRole("button", { name: "Refresh Completed Work Summary" }));
  expect(await screen.findByText(/Completed work summary error:/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Refresh Completed Work Summary" }));
  expect(await screen.findByText("Recovered completed work")).toBeInTheDocument();
  expect(screen.queryByText(/Completed work summary error:/)).not.toBeInTheDocument();
});

it("ignores a late completed-card response from the previous reporting period", async () => {
  let finishOldCards!: (response: Response) => void;
  const oldCards = new Promise<Response>((resolve) => { finishOldCards = resolve; });
  let cardCalls = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = String(input);
    if (url.includes("/metadata/epics/summary")) return jsonResponse({ epics: [fastReportEpic] });
    if (url.includes("/completed-cards/configured")) {
      cardCalls += 1;
      return cardCalls === 1 ? oldCards : jsonResponse(completedCardPayload("New period delivery"));
    }
    return jsonResponse({ config: {} });
  });
  render(<TeamReportScreen />);
  await screen.findByText("Fast report initiative");
  act(() => { window.dispatchEvent(new CustomEvent(OPEN_TEAM_REPORT_REPORTING_PERIOD_EVENT)); });
  const dialog = screen.getByRole("dialog", { name: "Configure Reporting Period" });
  fireEvent.change(within(dialog).getByRole("combobox", { name: "Reporting Period" }), { target: { value: "last_14_days" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  expect(await screen.findByText("New period delivery")).toBeInTheDocument();
  await act(async () => { finishOldCards(await jsonResponse(completedCardPayload("Stale period delivery"))); });
  expect(screen.queryByText("Stale period delivery")).not.toBeInTheDocument();
  expect(screen.getByText("New period delivery")).toBeInTheDocument();
  expect(cardCalls).toBe(2);
});


it("keeps incomplete completed-card data visible as an error rather than a partial summary", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = String(input);
    if (url.includes("/metadata/epics/summary")) return jsonResponse({ epics: [fastReportEpic] });
    if (url.includes("/completed-cards/configured")) return jsonResponse({ ...completedCardPayload(), truncated: true });
    return Promise.reject(new Error("JIRA health unavailable"));
  });
  render(<TeamReportScreen />);
  expect(await screen.findByText(/Completed card data is incomplete/)).toBeInTheDocument();
  expect(screen.queryByText("Delivered deterministic report")).not.toBeInTheDocument();
});

it("preserves timeline health while rendering an empty completed-work period", async () => {
  const date = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
  const timelines = [
    { name: "Complete", completion: 100, target: 50, start: -50, rag: "Green" },
    { name: "On track", completion: 60, target: 50, start: -50, rag: "Green" },
    { name: "Slightly behind", completion: 35, target: 50, start: -50, rag: "Amber" },
    { name: "Behind plan", completion: 0, target: 50, start: -50, rag: "Red" },
    { name: "Low completion", completion: 10, target: 50, start: null, rag: "Red" },
    { name: "Mid completion", completion: 50, target: 50, start: null, rag: "Amber" },
    { name: "High completion", completion: 80, target: 50, start: null, rag: "Green" },
  ];
  vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = String(input);
    if (url.includes("/metadata/epics/summary")) return jsonResponse({ epics: timelines.map((entry, index) => ({
      ...fastReportEpic, epicKey: `RAG-${index}`, epicName: entry.name, completionPercent: entry.completion,
      timelineEnabled: true, targetCompletionDate: date(entry.target), timelineStartDate: entry.start === null ? null : date(entry.start),
    })) });
    if (url.includes("/completed-cards/configured")) return jsonResponse({ count: 0, truncated: false, completedCards: [] });
    return jsonResponse({ config: {} });
  });
  render(<TeamReportScreen />);
  expect(await screen.findByText("No completed cards were found for selected initiatives in this reporting period.")).toBeInTheDocument();
  for (const entry of timelines) {
    expect(within(screen.getByText(entry.name).closest("tr")!).getByText(entry.rag)).toBeInTheDocument();
  }
});
