import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { within } from "@testing-library/dom";
import { vi } from "vitest";
import {
  ExecutiveReportScreen,
  OPEN_EXEC_REPORTING_PERIOD_EVENT,
} from "../../src/components/content/screens/ExecutiveReportScreen";

function jsonResponse(payload: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("ExecutiveReportScreen", () => {
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

      if (url.includes("/api/ai/chat")) {
        const bodyText = typeof init?.body === "string" ? init.body : "";
        if (bodyText.includes("Return JSON only with this schema")) {
          return jsonResponse({
            source: "oci_genai",
            modelId: "cohere.command-r-08-2024",
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
          source: "oci_genai",
          modelId: "cohere.command-r-08-2024",
          response: {
            text: "The selected initiatives advanced during the reporting period with stronger momentum in core platform delivery while reliability work still requires focused risk mitigation.",
          },
        });
      }

      return Promise.reject(new Error(`Unhandled fetch request in test: ${url}`));
    });

    render(<ExecutiveReportScreen />);

    expect(await screen.findByRole("heading", { name: "Executive Summary" })).toBeInTheDocument();
    expect(screen.queryByText(/Drafted by OCI GenAI from selected progress data and reporting period movement\./i)).not.toBeInTheDocument();
    expect(await screen.findByText(/selected initiatives advanced during the reporting period/i)).toBeInTheDocument();

    expect(await screen.findByText(/Executive automation epic delivered five cards this period\./i)).toBeInTheDocument();
    expect(await screen.findByText(/Reliability epic completion remains below midpoint and needs focus\./i)).toBeInTheDocument();

    expect(screen.getByText("Executive reporting automation")).toBeInTheDocument();
    expect(screen.getByText("Risk reporting hardening")).toBeInTheDocument();
    expect(screen.getByLabelText("Group effort distribution chart")).toBeInTheDocument();
    expect(screen.getByLabelText("Type effort distribution chart")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Configure" }));
    const dialog = screen.getByRole("dialog", { name: "Configure Initiative Epics" });
    expect(dialog).toBeInTheDocument();

    fireEvent.dblClick(within(dialog).getByText("Executive reporting automation"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Configure Initiative Epics" })).not.toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.queryByText("Executive reporting automation")).not.toBeInTheDocument();
    });

    window.dispatchEvent(new CustomEvent(OPEN_EXEC_REPORTING_PERIOD_EVENT));
    expect(await screen.findByRole("dialog", { name: "Configure Reporting Period" })).toBeInTheDocument();

    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(4);
  });
});
