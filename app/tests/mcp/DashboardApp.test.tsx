import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import fixture from "../../../tests/fixtures/mcp_dashboard.json";
import { DashboardApp, displayDate, safeLink } from "../../src/mcp/DashboardApp";
import type { DashboardBridge, DashboardEnvelope } from "../../src/mcp/bridge";

function envelope(): DashboardEnvelope {
  return { schemaVersion: "1", appliedFilters: { flow_weeks: 4, recent_limit: 5, timezone: "Australia/Melbourne", cycle_time_status_keys: ["in progress"] },
    uiUrl: "http://localhost:5174", warnings: [], dashboard: structuredClone(fixture) } as DashboardEnvelope;
}

function mockBridge(value: DashboardEnvelope | null = envelope()) {
  let deliver: (value: DashboardEnvelope) => void;
  let fail: (message: string) => void;
  const bridge: DashboardBridge = {
    connect: vi.fn(async (result, error) => { deliver = result; fail = error; if (value) result(value); }),
    read: vi.fn(async () => envelope()), openLink: vi.fn(async () => {}), close: vi.fn(),
  };
  return { bridge, deliver: (value: DashboardEnvelope) => deliver(value), fail: (message: string) => fail(message) };
}

it("shows only work-stream progress and filters the visible rows", async () => {
  const value = envelope();
  value.warnings = ["Showing 5 of 11 items in a dashboard list."];
  const { bridge } = mockBridge(value);
  render(<DashboardApp bridge={bridge} />);
  expect(await screen.findByText("65% complete")).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Highlights" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Blockers" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Recently completed" })).not.toBeInTheDocument();
  expect(screen.queryByText(/Cycle-time statuses/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Showing 5 of 11/)).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "1" } });
  expect(screen.queryByRole("heading", { name: "Customer experience" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "all" } });
  expect(screen.getByRole("heading", { name: "Customer experience" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Open TeamBeacon/ }));
  expect(bridge.openLink).toHaveBeenCalledWith("http://localhost:5174/");
});

it("updates the flow window through a read tool while preserving custom status selection", async () => {
  const { bridge } = mockBridge();
  let finish!: (value: DashboardEnvelope) => void;
  vi.mocked(bridge.read).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  render(<DashboardApp bridge={bridge} />);
  fireEvent.click(await screen.findByRole("button", { name: "12 weeks" }));
  expect(screen.getByRole("button", { name: "Updating…" })).toBeDisabled();
  expect(bridge.read).toHaveBeenCalledWith({ ...envelope().appliedFilters, flow_weeks: 12 });
  const next = envelope(); next.appliedFilters.flow_weeks = 12; next.dashboard.flowPeriod.weeks = 12;
  await act(async () => finish(next));
  expect(screen.getByRole("button", { name: "12 weeks" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "Update view" }));
  await waitFor(() => expect(bridge.read).toHaveBeenCalledTimes(2));
});

it("keeps the previous view on failed refresh and reports failed links", async () => {
  const { bridge } = mockBridge();
  vi.mocked(bridge.read).mockRejectedValue(new Error("API unavailable"));
  vi.mocked(bridge.openLink).mockRejectedValue(new Error("denied"));
  render(<DashboardApp bridge={bridge} />);
  fireEvent.click(await screen.findByRole("button", { name: "Update view" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("API unavailable");
  expect(screen.getByText("65% complete")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Open TeamBeacon/ }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("could not open"));
});

it("shows initial loading and handles bridge failures and teardown", async () => {
  const mock = mockBridge(null);
  const view = render(<DashboardApp bridge={mock.bridge} />);
  expect(screen.getByRole("status")).toHaveTextContent("Connecting");
  act(() => mock.fail("Tool failed"));
  expect(screen.getByRole("alert")).toHaveTextContent("Tool failed");
  act(() => mock.deliver(envelope()));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  view.unmount();
  expect(mock.bridge.close).toHaveBeenCalled();
  act(() => { mock.deliver(envelope()); mock.fail("late error"); });
  const disconnected = mockBridge(null).bridge;
  vi.mocked(disconnected.connect).mockRejectedValue(new Error("unsupported"));
  render(<DashboardApp bridge={disconnected} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("MCP Apps-compatible host");
});

it("keeps relevant warnings and unavailable work-stream states visible", async () => {
  const value = envelope();
  value.warnings = ["Some sections unavailable"];
  value.dashboard.errors = { blockedItems: "error", sprintCycleTime: "error", release: "error", progress: "error", "workStreams.1": "error" };
  value.dashboard.workStreams[0].error = "error";
  render(<DashboardApp bridge={mockBridge(value).bridge} />);
  expect(await screen.findByRole("status")).toHaveTextContent("Some sections unavailable");
  expect(screen.getAllByText("Progress unavailable")).toHaveLength(2);
  expect(screen.getByText("Flow unavailable for this work stream.")).toBeInTheDocument();
  expect(screen.queryByText("65% complete")).not.toBeInTheDocument();
});

it("handles missing data, unknown freshness and empty work streams", async () => {
  const value = envelope();
  value.appliedFilters.cycle_time_status_keys = null;
  value.uiUrl = "javascript:alert(1)";
  value.dashboard.dataAsOf = null;
  value.dashboard.flowPeriod.startDate = null; value.dashboard.flowPeriod.endDate = null;
  value.dashboard.latestRelease = null; value.dashboard.sprintCycleTime = null;
  value.dashboard.workStreams = [];
  value.dashboard.blockedItems = { count: 0, items: [], storyPointsTotal: 0 };
  value.dashboard.recentlyCompleted.items = [];
  render(<DashboardApp bridge={mockBridge(value).bridge} />);
  expect(await screen.findByText("No configured work streams in this view.")).toBeInTheDocument();
  expect(screen.getByText(/Source data: freshness unknown/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Open TeamBeacon/ })).not.toBeInTheDocument();
});

it("renders work-stream names as text and rejects unsafe URLs", async () => {
  const value = envelope();
  value.dashboard.workStreams[0].name = "<img src=x onerror=alert(1)>";
  render(<DashboardApp bridge={mockBridge(value).bridge} />);
  expect(await screen.findByRole("heading", { name: "<img src=x onerror=alert(1)>" })).toBeInTheDocument();
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /DEMO-421/ })).not.toBeInTheDocument();
  for (const link of [undefined, null, "", "bad", "file:///etc/passwd", "https://user:secret@host"]) expect(safeLink(link)).toBeNull();
  expect(displayDate(null, "UTC")).toBe("unknown");
  expect(displayDate("bad", "UTC")).toBe("bad");
});

it("does not overwrite a newer model-supplied dashboard with a slow read", async () => {
  const mock = mockBridge();
  let finish!: (value: DashboardEnvelope) => void;
  vi.mocked(mock.bridge.read).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  render(<DashboardApp bridge={mock.bridge} />);
  fireEvent.click(await screen.findByRole("button", { name: "1 week" }));
  const newer = envelope(); newer.dashboard.flowPeriod.weeks = 12; newer.appliedFilters.flow_weeks = 12;
  newer.appliedFilters.cycle_time_status_keys = [];
  act(() => mock.deliver(newer));
  await act(async () => finish(envelope()));
  expect(screen.getByRole("button", { name: "12 weeks" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByText(/Cycle-time statuses/)).not.toBeInTheDocument();
});
