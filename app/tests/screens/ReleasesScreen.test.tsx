import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { vi } from "vitest";
import { ReleasesScreen } from "../../src/components/content/screens/ReleasesScreen";

function jsonResponse(payload: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("ReleasesScreen", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders configure and refresh actions with configuration status", () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url.includes("/api/releases/refresh/status")) {
        return jsonResponse({
          source: "releases",
          state: "idle",
          phase: "idle",
          percent: null,
          message: "Idle",
          sources: [],
        });
      }
      return Promise.reject(new Error(`Unhandled fetch request in test: ${url}`));
    });

    render(<ReleasesScreen />);

    expect(screen.getByRole("heading", { name: "Release Configuration" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Configure" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Confluence Sources" })).toBeInTheDocument();
    expect(screen.getByText("Configuration Needed")).toBeInTheDocument();
  });

  it("opens configuration overlay, saves source settings, and runs refresh", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url.includes("/api/releases/refresh/status")) {
        return jsonResponse({
          source: "releases",
          state: "idle",
          phase: "idle",
          percent: null,
          message: "Idle",
          sources: [],
        });
      }

      if (url.includes("/api/releases/refresh/start")) {
        const body = typeof init?.body === "string" ? JSON.parse(init.body) as { sources: Array<{ confluenceUrl: string }>; overallPrompt?: string } : null;
        if (!body?.sources?.[0]?.confluenceUrl) {
          return Promise.reject(new Error("missing source url in refresh payload"));
        }
        return jsonResponse({
          source: "releases",
          state: "completed",
          phase: "done",
          percent: 100.0,
          message: "Release refresh complete.",
          started: true,
          sources: [
            {
              id: 1,
              confluenceUrl: body.sources[0].confluenceUrl,
              prompt: "Summarize release scope and risks.",
              state: "completed",
              percent: 100.0,
              message: "Completed.",
              error: null,
            },
          ],
        });
      }

      if (url.includes("/api/releases/refresh/result")) {
        return jsonResponse({
          source: "releases",
          state: "completed",
          generatedAt: "2026-04-02T10:30:00Z",
          html: "<h4>Summary</h4><p>Release output from LLM.</p>",
          text: "Summary:\nRelease output from LLM.",
          sources: [
            {
              id: 1,
              confluenceUrl: "https://gbuconfluence.oraclecorp.com/display/SEN/Release+Notes",
              title: "Release Notes",
              resolvedUrl: "https://gbuconfluence.oraclecorp.com/display/SEN/Release+Notes",
              summary: "Source summary",
              state: "completed",
              error: null,
            },
          ],
          error: null,
        });
      }

      return Promise.reject(new Error(`Unhandled fetch request in test: ${url}`));
    });

    render(<ReleasesScreen />);

    fireEvent.click(screen.getByRole("button", { name: "Configure" }));
    expect(screen.getByRole("dialog", { name: "Configure Release Insights" })).toBeInTheDocument();

    const sourceUrlInput = screen.getByRole("textbox", { name: "Confluence Page URL" }) as HTMLInputElement;
    const sourcePromptInput = screen.getByRole("textbox", { name: "Source Prompt" }) as HTMLTextAreaElement;
    const overallPromptInput = screen.getByRole("textbox", { name: "Overall Prompt" }) as HTMLTextAreaElement;

    fireEvent.input(sourceUrlInput, { target: { value: "https://gbuconfluence.oraclecorp.com/display/SEN/Release+Notes" } });
    fireEvent.input(sourcePromptInput, { target: { value: "Summarize release scope and risks." } });
    fireEvent.input(overallPromptInput, { target: { value: "Generate release highlights for engineering leaders." } });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.queryByRole("dialog", { name: "Configure Release Insights" })).not.toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "https://gbuconfluence.oraclecorp.com/display/SEN/Release+Notes" })).toBeInTheDocument();
    expect(screen.getByText(/Summarize release scope and risks/i)).toBeInTheDocument();
    expect(screen.getByText(/Generate release highlights for engineering leaders/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      expect(screen.getByText("Release output from LLM.")).toBeInTheDocument();
    });

    expect(fetchSpy.mock.calls.some((call) => {
      const url =
        typeof call[0] === "string"
          ? call[0]
          : call[0] instanceof URL
            ? call[0].toString()
            : call[0].url;
      return url.includes("/api/releases/refresh/start");
    })).toBe(true);
  });
});
