import { fireEvent, render, screen } from "@testing-library/preact";
import { Content } from "../../src/components/content";
import { setupFetchMock } from "../utils/fetchMock";

describe("Content", () => {
  it("renders navigation with only Executive Report marked under construction", async () => {
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

    render(<Content appName="TeamBeacon" />);

    expect(await screen.findByRole("heading", { name: "Integrations & Field Mapping" })).toBeInTheDocument();
    expect(screen.getByText("Illuminating Engineering Insights")).toBeInTheDocument();
    expect(screen.getByLabelText("Executive Report is under construction")).toBeInTheDocument();
    expect(screen.queryByLabelText("Integrations is under construction")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Security is under construction")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Security/ }));
    expect(await screen.findByRole("heading", { name: "Security" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Security Posture Snapshot" })).toBeInTheDocument();
  });
});
