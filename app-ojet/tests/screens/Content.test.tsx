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
      "Current Sprint",
      "Initiative Insights",
      "Team Insights",
      "Security",
      "Incident Response",
      "Release",
      "Executive Report",
      "Settings",
    ]);

    expect(screen.getByLabelText("Team Insights is under construction")).toBeInTheDocument();
    expect(screen.getByLabelText("Security is under construction")).toBeInTheDocument();
    expect(screen.getByLabelText("Incident Response is under construction")).toBeInTheDocument();
    expect(screen.getByLabelText("Release is under construction")).toBeInTheDocument();

    expect(screen.getByText("Progress / Scope Creep / Blockers")).toBeInTheDocument();
    expect(screen.getByText("Connections, Field Mapping and Epic Metadata")).toBeInTheDocument();

    expect(screen.queryByLabelText("Executive Report is under construction")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Settings is under construction")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Initiative Insights is under construction")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Current Sprint is under construction")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Individual Insights/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Security/ }));
    expect(await screen.findByRole("heading", { name: "Security" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Security Posture Snapshot" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Settings/ }));
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
  });
});
