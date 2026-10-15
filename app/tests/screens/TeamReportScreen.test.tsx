import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { within } from "@testing-library/dom";
import { vi } from "vitest";
import {
  EXPORT_TEAM_REPORT_HTML_EVENT,
  OPEN_TEAM_REPORT_INITIATIVE_CONFIG_EVENT,
  OPEN_TEAM_REPORT_REPORTING_PERIOD_EVENT,
  TeamReportScreen,
} from "../../src/components/content/screens/TeamReportScreen";

function jsonResponse(payload: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("TeamReportScreen", () => {
  it("loads executive data, drafts summary/wins-risks, and supports initiative selection", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
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

      if (url.includes("/api/integrations/ai/status")) {
        return jsonResponse({
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

      if (url.includes("/api/ai/chat")) {
        const bodyText = typeof init?.body === "string" ? init.body : "";
        if (bodyText.includes("Draft a completed-work summary grouped by work stream for engineering leaders.")) {
          return jsonResponse({
            source: "ollama",
            provider: "ollama",
            configuredProvider: "ollama",
            modelId: "gemma4:e2b",
            response: {
              text: JSON.stringify({
                items: [
                  { cardId: "card-3", bullet: "Completed validation enhancements improved reliability of risk insights used in dashboard decision reviews." },
                  { cardId: "card-1", bullet: "Completed workflow automation now assembles leadership-ready dashboard narratives for the selected period." },
                  { cardId: "card-2", bullet: "Delivery strengthened reporting consistency and reduced manual summary preparation overhead." },
                ],
              }),
            },
          });
        }

        if (bodyText.includes("Return JSON only with this schema")) {
          return jsonResponse({
            source: "ollama",
            provider: "ollama",
            configuredProvider: "ollama",
            modelId: "gemma4:e2b",
            response: {
              text: JSON.stringify({
                wins: [
                  "Executive automation epic delivered five cards this period.",
                  "Core platform progress remains on-track against timeline.",
                  "Risk hardening work continued with measurable completion movement.",
                ],
                risks: [
                  "Reliability epic completion remains below midpoint and needs focus.",
                  "Delivery risk rises if period throughput drops next week.",
                  "Timeline variance can grow without cross-team dependency closure.",
                ],
              }),
            },
          });
        }

        return jsonResponse({
          source: "ollama",
          provider: "ollama",
          configuredProvider: "ollama",
          modelId: "gemma4:e2b",
          response: {
            text: "The selected initiatives advanced during the reporting period with stronger momentum in core platform delivery while reliability work still requires focused risk mitigation.",
          },
        });
      }

      return Promise.reject(new Error(`Unhandled fetch request in test: ${url}`));
    });

    render(<TeamReportScreen />);

    expect(await screen.findByRole("heading", { name: "Executive Summary" })).toBeInTheDocument();
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes("/epics/summary?limit=all"))).toBe(true);
    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual([
      "Report Signals",
      "Completed Work Summary",
      "Work Mix by Work Stream and Type",
      "Progress for Key Initiatives",
      "Wins and Risks",
      "Executive Summary",
    ]);
    expect(screen.queryByText(/Drafted by OCI GenAI from selected progress data and reporting period movement\./i)).not.toBeInTheDocument();
    expect(await screen.findByText(/selected initiatives advanced during the reporting period/i)).toBeInTheDocument();

    expect(await screen.findByText(/Executive automation epic delivered five cards this period\./i)).toBeInTheDocument();
    expect(await screen.findByText(/Reliability epic completion remains below midpoint and needs focus\./i)).toBeInTheDocument();
    expect(screen.queryByText(/Drafted by OCI GenAI from selected Progress for Key Initiatives data\./i)).not.toBeInTheDocument();
    const selectedInitiativesCard = screen.getByRole("heading", { name: "Selected Initiatives" }).closest("article")!;
    expect(within(selectedInitiativesCard).getByText("Initiatives included in this report.")).toBeInTheDocument();
    expect(within(selectedInitiativesCard).getByText("2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh Wins and Risks" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh Completed Work Summary" })).toBeInTheDocument();

    const completedWorkPanel = screen.getByRole("heading", { name: "Completed Work Summary" }).closest("section");
    expect(completedWorkPanel).not.toBeNull();
    if (!completedWorkPanel) {
      throw new Error("Completed Work Summary section not found.");
    }
    const scopedCompletedWork = within(completedWorkPanel);
    expect(await scopedCompletedWork.findByText("Core Platform")).toBeInTheDocument();
    expect(await scopedCompletedWork.findByText("Operations")).toBeInTheDocument();
    expect(await scopedCompletedWork.findByText(/assembles leadership-ready dashboard narratives/i)).toBeInTheDocument();
    expect(await scopedCompletedWork.findByText(/improved reliability of risk insights/i)).toBeInTheDocument();
    expect(scopedCompletedWork.getAllByRole("listitem")).toHaveLength(3);
    const completedBullet = scopedCompletedWork.getAllByRole("listitem")[0];
    expect(within(completedBullet).getByText(/assembles leadership-ready dashboard narratives/)).toBeInTheDocument();
    const epicHeading = scopedCompletedWork.getByRole("heading", { level: 5, name: "Executive reporting automation" });
    expect(within(epicHeading).getByRole("link")).toHaveAttribute("href", "https://jira.example.com/browse/CEG-EPIC-12");
    expect(within(epicHeading).getByRole("link")).toHaveAttribute("target", "_blank");
    expect(scopedCompletedWork.getAllByRole("link", { name: "Executive reporting automation" })).toHaveLength(1);
    expect(within(epicHeading.parentElement!).getAllByRole("listitem")).toHaveLength(2);
    expect(within(completedBullet).queryByRole("link", { name: "Executive reporting automation" })).not.toBeInTheDocument();
    const issueLink = within(completedBullet).getByRole("link", { name: "CEG-1010" });
    expect(issueLink).toHaveAttribute("href", "https://jira.example.com/browse/CEG-1010");
    expect(issueLink).toHaveAttribute("target", "_blank");
    expect(issueLink).toHaveAttribute("rel", "noopener noreferrer");
    expect(issueLink.parentElement).toHaveClass("tb-exec-completed-source");
    expect(issueLink.parentElement).toHaveTextContent("CEG-1010 · Automated executive dashboard summary workflow");
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
      const issue = report.querySelector('a[href="https://jira.example.com/browse/CEG-1010"]')!;
      expect(issue.textContent).toBe("CEG-1010");
      expect(issue.getAttribute("target")).toBe("_blank");
      expect(issue.closest("li")?.textContent).toContain("Automated executive dashboard summary workflow");
      const epicBlock = issue.closest(".completed-epic")!;
      expect(epicBlock.querySelector('h5 a[href="https://jira.example.com/browse/CEG-EPIC-12"]')?.textContent).toBe("Executive reporting automation");
      expect(epicBlock.querySelectorAll("li")).toHaveLength(2);
      expect(epicBlock.querySelectorAll('a[href="https://jira.example.com/browse/CEG-EPIC-12"]')).toHaveLength(1);
      expect(issue.parentElement?.className).toBe("completed-source");
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

    const winsRisksPanel = screen.getByRole("heading", { name: "Wins and Risks" }).closest("section");
    expect(winsRisksPanel).not.toBeNull();
    if (!winsRisksPanel) {
      throw new Error("Wins and Risks section not found.");
    }
    const scopedWinsRisks = within(winsRisksPanel);
    expect(scopedWinsRisks.getByText("Generated with Ollama")).toBeInTheDocument();
    expect(scopedWinsRisks.getByText(/Model:/i)).toBeInTheDocument();
    expect(scopedWinsRisks.getByText(/Updated:/i)).toBeInTheDocument();
    expect(scopedWinsRisks.getByText(/words/i)).toBeInTheDocument();

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

    window.dispatchEvent(new CustomEvent(OPEN_TEAM_REPORT_REPORTING_PERIOD_EVENT));
    expect(await screen.findByRole("dialog", { name: "Configure Reporting Period" })).toBeInTheDocument();

    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(4);
  });
});

it.each([null, "invalid"])("does not assess report RAG for an enabled timeline with target %s", async (targetCompletionDate) => {
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
