import { render, screen, waitFor } from "@testing-library/preact";
import { IntegrationsScreen } from "../../src/components/content/screens/IntegrationsScreen";
import { setupFetchMock } from "../utils/fetchMock";

describe("IntegrationsScreen", () => {
  it("renders JIRA and OCI GenAI connectivity status from the backend", async () => {
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
      "/api/integrations/oci-genai/status": {
        source: "oci_genai",
        connected: true,
        checkedAt: "2026-03-30T09:15:00Z",
        config: {
          endpoint: "https://inference.generativeai.us-chicago-1.oci.oraclecloud.com",
          modelId: "cohere.command-r-08-2024",
          configProfile: "DEFAULT",
        },
        checks: [
          { name: "auth", ok: true, detail: "reachable" },
          { name: "inference", ok: true, detail: "responding" },
        ],
      },
    });

    render(<IntegrationsScreen />);

    expect(screen.getByRole("heading", { name: "Source Connections" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "JIRA Connection" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "OCI GenAI Connection" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Confluence Connection" })).toBeInTheDocument();

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    expect(screen.getAllByText("Connected")).toHaveLength(2);
    expect(screen.getAllByText("2/2 connectivity checks passed.")).toHaveLength(2);
    expect(screen.getAllByText(/Last checked:/i)).toHaveLength(2);
    expect(screen.getByText("Project: CEG")).toBeInTheDocument();
    expect(screen.getByText("Model: cohere.command-r-08-2024")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check Now" })).toBeInTheDocument();
  });
});
