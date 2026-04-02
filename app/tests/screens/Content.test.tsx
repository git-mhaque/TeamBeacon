import { fireEvent, render, screen } from "@testing-library/preact";
import { within } from "@testing-library/dom";
import { Content } from "../../src/components/content";
import { setupFetchMock } from "../utils/fetchMock";

describe("Content", () => {
  it("renders construction markers for static screens in sidebar", async () => {
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

    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByText("Illuminating Engineering Insights")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Integrations Settings" })).not.toBeInTheDocument();

    const nav = screen.getByRole("navigation");
    const orderedTitles = within(nav)
      .getAllByRole("button")
      .map((button) => button.querySelector(".tb-nav-title")?.textContent?.trim() ?? "");
    expect(orderedTitles).toEqual([
      "Initiative Insights",
      "Sprint Insights",
      "Team Insights",
      "Security Insights",
      "Operations Insights",
      "Release Insights",
      "Team Dashboard",
      "Settings",
    ]);

    expect(screen.getByLabelText("Team Insights is under construction")).toBeInTheDocument();
    expect(screen.getByLabelText("Security Insights is under construction")).toBeInTheDocument();
    expect(screen.getByLabelText("Operations Insights is under construction")).toBeInTheDocument();
    expect(screen.getByLabelText("Release Insights is under construction")).toBeInTheDocument();

    expect(screen.getByText("Epic Config / Progress / RAG")).toBeInTheDocument();
    expect(screen.getByText("Overview / Progress / Scope Creep / Blockers")).toBeInTheDocument();
    expect(screen.getByText("Cycle Time / Sprint Trend / Work Mix")).toBeInTheDocument();
    expect(screen.getByText("Scan / Vulnerability Posture")).toBeInTheDocument();
    expect(screen.getByText("Incidents / DR / Observability")).toBeInTheDocument();
    expect(screen.getByText("Cadence / Release Notes")).toBeInTheDocument();
    expect(screen.getByText("Summary / Wins / Risks / Progress / Work Mix")).toBeInTheDocument();
    expect(screen.getByText("Connections / Field Mapping / Epic Metadata")).toBeInTheDocument();

    expect(screen.queryByLabelText("Team Dashboard is under construction")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Settings is under construction")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Initiative Insights is under construction")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Sprint Insights is under construction")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Individual Insights/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Security Insights/ }));
    expect(await screen.findByRole("heading", { name: "Security Insights" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Security Posture Snapshot" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Settings/ }));
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
  });
});
