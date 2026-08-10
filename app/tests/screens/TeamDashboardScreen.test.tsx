import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { vi } from "vitest";
import * as persistence from "../../src/lib/persistence";
import { TeamDashboardScreen } from "../../src/components/content/screens/TeamDashboardScreen";
import { setupFetchMock } from "../utils/fetchMock";

const dashboardPayload = {
  source: "local",
  generatedAt: "2026-08-11T02:05:00+00:00",
  timezone: "Australia/Melbourne",
  flowPeriod: {
    weeks: 4,
    startDate: "2026-07-20",
    endDate: "2026-08-16",
  },
  workStreams: [
    {
      id: 5,
      name: "Platform Delivery",
      epicCount: 3,
      newCount: 12,
      completedCount: 15,
      netFlow: -3,
      currentWipCount: 4,
      totalCards: 20,
      totalCompletedCards: 13,
      completionPercent: 65,
      error: null,
    },
    {
      id: 8,
      name: "Customer Operations",
      epicCount: 1,
      newCount: 7,
      completedCount: 4,
      netFlow: 3,
      currentWipCount: 2,
      totalCards: 10,
      totalCompletedCards: 4,
      completionPercent: 40,
      error: "Flow service unavailable",
    },
  ],
  latestRelease: {
    versionId: "81",
    name: "TeamBeacon 2.4",
    releaseDate: "2026-08-08",
    cycleTimeDays: 18.5,
  },
  sprintCycleTime: {
    latestSprintId: 42,
    latestSprintName: "Sprint 42",
    latestAverageDays: 3.4,
    previousSprintId: 41,
    previousSprintName: "Sprint 41",
    previousAverageDays: 4.2,
    deltaDays: -0.8,
    deltaPercent: -19,
    direction: "down",
  },
  blockedItems: {
    sprintId: 43,
    sprintName: "Sprint 43",
    count: 1,
    storyPointsTotal: 5,
    items: [
      {
        issueKey: "TB-421",
        issueUrl: "https://jira.example.test/browse/TB-421",
        summary: "Unblock release automation",
        status: "Blocked",
        storyPoints: 5,
      },
    ],
  },
  recentlyCompleted: {
    windowDays: 7,
    count: 1,
    items: [
      {
        issueKey: "TB-419",
        issueUrl: "https://jira.example.test/browse/TB-419",
        summary: "Publish delivery dashboard",
        epicKey: "TB-100",
        epicName: "Team reporting",
        workStreamId: 5,
        workStreamName: "Platform Delivery",
        completedAt: "2026-08-10T04:00:00+00:00",
      },
    ],
  },
  errors: {},
};

describe("TeamDashboardScreen", () => {
  beforeEach(() => {
    vi.spyOn(persistence, "getPreferenceSync").mockReturnValue(null);
    vi.spyOn(persistence, "setPreference").mockResolvedValue();
  });

  it("uses layout-preserving skeletons during the initial load", () => {
    vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise(() => undefined));

    render(<TeamDashboardScreen />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading work-stream insights");
    expect(document.querySelectorAll(".tb-dashboard-skeleton-row")).toHaveLength(6);
    expect(document.querySelectorAll(".tb-dashboard-kpi .tb-dashboard-skeleton").length).toBeGreaterThan(0);
    expect(screen.queryByText("Loading work-stream flow…")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /Flow period/ })).toBeDisabled();
  });

  it("keeps the current dashboard visible while refreshing", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(dashboardPayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
      .mockReturnValueOnce(new Promise(() => undefined));

    render(<TeamDashboardScreen />);

    expect(await screen.findByText("TeamBeacon 2.4")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    expect(screen.getByText("Refreshing…")).toBeInTheDocument();
    expect(screen.getByText("TeamBeacon 2.4")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Platform Delivery delivery progress" })).toBeInTheDocument();
  });

  it("summarizes delivery health and supports dashboard drill-downs", async () => {
    const callbacks = {
      onOpenWorkStream: vi.fn(),
      onOpenReleaseInsights: vi.fn(),
      onOpenTeamInsights: vi.fn(),
      onOpenSprintInsights: vi.fn(),
      onOpenSettings: vi.fn(),
    };
    const fetchSpy = setupFetchMock({ "/api/team/dashboard": dashboardPayload });

    render(<TeamDashboardScreen {...callbacks} />);

    expect(await screen.findByText("TeamBeacon 2.4")).toBeInTheDocument();
    expect(screen.getByText("3.4 days")).toBeInTheDocument();
    expect(screen.getByText("0.8 days faster")).toBeInTheDocument();
    expect(screen.getByText("Sprint 43 · 5 SP")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Blocked items" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Recently completed" })).not.toBeInTheDocument();

    const highlights = screen.getByRole("region", { name: "Team delivery highlights" });
    expect(Array.from(highlights.querySelectorAll(".tb-dashboard-kpi-heading span")).map((title) => title.textContent)).toEqual([
      "Latest completed release",
      "Latest sprint cycle time",
      "Current sprint blockers",
    ]);

    const progress = screen.getByRole("progressbar", { name: "Platform Delivery delivery progress" });
    expect(progress).toHaveAttribute("aria-valuenow", "65");
    const comparisonRegion = screen.getByRole("region", { name: "Work stream comparison" });
    const comparisonTable = within(comparisonRegion).getByRole("table");
    const streamOrder = () => Array.from(comparisonTable.querySelectorAll("tbody tr")).map((row) => (
      within(row as HTMLElement).getByRole("button").textContent
    ));
    expect(streamOrder()).toEqual(["Customer Operations", "Platform Delivery"]);
    expect(within(comparisonTable).getByRole("columnheader", { name: /Flow gap/ })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    expect(within(comparisonTable).getAllByRole("columnheader")).toHaveLength(7);
    expect(within(comparisonTable).queryByRole("columnheader", { name: "Recent flow · Last 4 weeks" })).not.toBeInTheDocument();

    const platformRow = screen.getByRole("button", { name: "Platform Delivery" }).closest("tr");
    expect(platformRow).not.toBeNull();
    expect(within(platformRow as HTMLElement).getByText("3 reduced")).toHaveClass("is-good");
    expect(within(platformRow as HTMLElement).getByText("13/20 completed")).toBeInTheDocument();
    expect(screen.getByText("Flow data unavailable")).toBeInTheDocument();

    fireEvent.click(within(comparisonTable).getByRole("button", { name: "Sort by Completed (descending)" }));
    expect(streamOrder()).toEqual(["Platform Delivery", "Customer Operations"]);
    fireEvent.click(within(comparisonTable).getByRole("button", { name: "Sort by Completed (descending)" }));
    expect(streamOrder()).toEqual(["Customer Operations", "Platform Delivery"]);

    const totalsRow = within(comparisonTable).getByRole("rowheader", { name: "All work streams" }).closest("tr");
    expect(totalsRow).not.toBeNull();
    expect(within(totalsRow as HTMLElement).getByText("Balanced")).toBeInTheDocument();
    expect(within(totalsRow as HTMLElement).getByText("17/30 completed")).toBeInTheDocument();
    expect(within(totalsRow as HTMLElement).getByText("57%")).toBeInTheDocument();
    for (const label of ["Work stream", "Epics", "Created", "Flow gap", "Current WIP", "Delivery progress"]) {
      fireEvent.click(within(comparisonTable).getByRole("button", { name: new RegExp(`Sort by ${label}`) }));
    }

    fireEvent.click(screen.getByRole("button", { name: "Platform Delivery" }));
    expect(callbacks.onOpenWorkStream).toHaveBeenCalledWith(5);
    fireEvent.click(screen.getByRole("button", { name: "View Release Insights" }));
    fireEvent.click(screen.getByRole("button", { name: "View Team Insights" }));
    fireEvent.click(screen.getAllByRole("button", { name: /View.*Sprint Insights/ })[0]);
    expect(callbacks.onOpenReleaseInsights).toHaveBeenCalledOnce();
    expect(callbacks.onOpenTeamInsights).toHaveBeenCalledOnce();
    expect(callbacks.onOpenSprintInsights).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));

  });

  it("persists and refreshes the selected work-stream flow period", async () => {
    const fetchSpy = setupFetchMock({ "/api/team/dashboard": dashboardPayload });
    render(<TeamDashboardScreen />);

    expect(await screen.findByRole("combobox", { name: /Flow period/ })).toHaveValue("4");
    fireEvent.change(screen.getByRole("combobox", { name: /Flow period/ }), { target: { value: "12" } });

    await waitFor(() => {
      expect(fetchSpy.mock.calls.some(([input]) => new URL(String(input)).searchParams.get("flowWeeks") === "12")).toBe(true);
    });
    expect(persistence.setPreference).toHaveBeenCalledWith("teambeacon.teamDashboard.flowWeeks", "12");
  });

  it("calls out a slower sprint cycle-time trend", async () => {
    setupFetchMock({
      "/api/team/dashboard": {
        ...dashboardPayload,
        sprintCycleTime: {
          ...dashboardPayload.sprintCycleTime,
          latestAverageDays: 5.1,
          deltaDays: 0.9,
          direction: "up",
        },
      },
    });

    render(<TeamDashboardScreen />);

    expect(await screen.findByText("0.9 days slower")).toHaveClass("is-warning");
  });

  it("shows recoverable full and partial failure states", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Backend offline" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ...dashboardPayload,
        latestRelease: null,
        sprintCycleTime: null,
        blockedItems: { sprintId: null, sprintName: null, count: 0, storyPointsTotal: 0, items: [] },
        recentlyCompleted: { windowDays: 7, count: 0, items: [] },
        workStreams: [],
        errors: { releases: "Release insights unavailable" },
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const onOpenSettings = vi.fn();

    render(<TeamDashboardScreen onOpenSettings={onOpenSettings} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Team dashboard request failed (503)");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Some dashboard sections could not be refreshed.")).toBeInTheDocument();
    expect(screen.getByText("No work streams configured")).toBeInTheDocument();
    expect(screen.getByText("No completed release")).toBeInTheDocument();
    expect(screen.getByText("No completed sprint data")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open Settings" }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
