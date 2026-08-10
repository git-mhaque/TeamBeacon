import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { within } from "@testing-library/dom";
import { vi } from "vitest";
import {
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
              timelineEnabled: true,
              timelineStartDate: "2026-02-20",
              targetCompletionDate: "2026-04-25",
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
                groups: [
                  {
                    group: "Core Platform",
                    bullets: [
                      "Completed workflow automation now assembles leadership-ready dashboard narratives for the selected period.",
                      "Delivery strengthened reporting consistency and reduced manual summary preparation overhead.",
                    ],
                  },
                  {
                    group: "Operations",
                    bullets: [
                      "Completed validation enhancements improved reliability of risk insights used in dashboard decision reviews.",
                    ],
                  },
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
    expect(screen.queryByText(/Drafted by OCI GenAI from selected progress data and reporting period movement\./i)).not.toBeInTheDocument();
    expect(await screen.findByText(/selected initiatives advanced during the reporting period/i)).toBeInTheDocument();

    expect(await screen.findByText(/Executive automation epic delivered five cards this period\./i)).toBeInTheDocument();
    expect(await screen.findByText(/Reliability epic completion remains below midpoint and needs focus\./i)).toBeInTheDocument();
    expect(screen.queryByText(/Drafted by OCI GenAI from selected Progress for Key Initiatives data\./i)).not.toBeInTheDocument();
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

    expect(screen.getByText("Executive reporting automation")).toBeInTheDocument();
    expect(screen.getByText("Risk reporting hardening")).toBeInTheDocument();
    expect(screen.getByLabelText("Work stream effort distribution chart")).toBeInTheDocument();
    expect(screen.getByLabelText("Type effort distribution chart")).toBeInTheDocument();

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
