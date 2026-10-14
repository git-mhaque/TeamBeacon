import { afterEach, vi } from "vitest";
import fixture from "../../../tests/fixtures/mcp_dashboard.json";
import { createDashboardBridge, readDashboard, type DashboardFilters } from "../../src/mcp/bridge";

const filters: DashboardFilters = { flow_weeks: 4, recent_limit: 5, timezone: "UTC", cycle_time_status_keys: null };
const data = { schemaVersion: "1", appliedFilters: filters, dashboard: fixture, uiUrl: "http://localhost:5174", warnings: [] };
let bridge: ReturnType<typeof createDashboardBridge>;
afterEach(() => { bridge?.close(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function setup() {
  bridge = createDashboardBridge();
  const post = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
  const receive = (message: unknown, origin = "https://host.test", source: Window | null = window.parent) => window.dispatchEvent(new MessageEvent("message", { data: message, origin, source }));
  const reply = (result: unknown, extra = {}) => {
    const call = post.mock.calls.filter(([message]) => message.id !== undefined).at(-1)![0];
    receive({ jsonrpc: "2.0", id: call.id, result, ...extra });
  };
  return { post, receive, reply };
}

it("initializes, receives model results and requests only the read dashboard tool", async () => {
  const { post, receive, reply } = setup();
  const onResult = vi.fn(), onError = vi.fn();
  const connecting = bridge.connect(onResult, onError);
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ method: "ui/initialize" }), "*");
  reply({ protocolVersion: "2026-01-26" }); await connecting;
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ method: "ui/notifications/initialized" }), "https://host.test");
  receive({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: data } });
  expect(onResult).toHaveBeenCalledWith(data);
  const reading = bridge.read(filters);
  expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ method: "tools/call", params: { name: "get_team_dashboard", arguments: filters } }), "https://host.test");
  reply({ structuredContent: data }); expect(await reading).toEqual(data);
  const opening = bridge.openLink("https://jira.test/A-1"); reply({}); await opening;
  expect(onError).not.toHaveBeenCalled();
});

it("ignores foreign sources/origins, invalid messages, and unknown responses", async () => {
  const { receive, reply } = setup();
  const onResult = vi.fn();
  const connecting = bridge.connect(onResult, vi.fn()); reply({ protocolVersion: "2026-01-26" }); await connecting;
  const result = { jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: data } };
  receive(result, "https://evil.test"); receive(result, "https://host.test", null);
  receive(null); receive({ jsonrpc: "1.0" }); receive({ jsonrpc: "2.0", id: 999 }); receive({ jsonrpc: "2.0", method: "unknown" });
  expect(onResult).not.toHaveBeenCalled();
});

it("sanitizes host errors and catches invalid tool results", async () => {
  const { receive, reply } = setup();
  const onError = vi.fn();
  const connecting = bridge.connect(vi.fn(), onError); reply({ protocolVersion: "2026-01-26" }); await connecting;
  receive({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { isError: true } });
  expect(onError).toHaveBeenCalledWith(expect.stringContaining("could not load"));
  const reading = bridge.read(filters); reply(null, { error: { message: "secret" } });
  await expect(reading).rejects.toThrow("The host could not complete");
  const opening = bridge.openLink("https://jira.test"); reply({ isError: true }); await expect(opening).rejects.toThrow("declined");
});

it("times out unanswered requests and rejects pending requests when closed", async () => {
  vi.useFakeTimers(); const { reply } = setup();
  const connecting = bridge.connect(vi.fn(), vi.fn()); reply({ protocolVersion: "2026-01-26" }); await connecting;
  const reading = bridge.read(filters);
  const rejected = expect(reading).rejects.toThrow("did not respond");
  await vi.advanceTimersByTimeAsync(35000); await rejected;
  const opening = bridge.openLink("https://jira.test");
  const closed = expect(opening).rejects.toThrow("closed"); bridge.close(); await closed;
});

it("rejects incompatible hosts and supports opaque-origin hosts", async () => {
  const { post, receive } = setup();
  const connecting = bridge.connect(vi.fn(), vi.fn());
  receive({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "unknown" } }, "null");
  await expect(connecting).rejects.toThrow("unsupported MCP Apps protocol");
  expect(post).toHaveBeenCalledTimes(1);
});

it("notifies the host when the widget resizes and disconnects the observer", async () => {
  let resized!: () => void;
  const disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { resized = callback; } observe() {} disconnect = disconnect; });
  const { post, reply } = setup();
  const connecting = bridge.connect(vi.fn(), vi.fn()); reply({ protocolVersion: "2026-01-26" }); await connecting;
  const bounds = vi.spyOn(document.body, "getBoundingClientRect").mockReturnValue({ height: 430.2 } as DOMRect);
  resized();
  expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ method: "ui/notifications/size-changed", params: { height: 431 } }), "https://host.test");
  bounds.mockReturnValue({ height: 210 } as DOMRect);
  resized();
  expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ method: "ui/notifications/size-changed", params: { height: 210 } }), "https://host.test");
  bounds.mockRestore();
  bridge.close(); expect(disconnect).toHaveBeenCalled();
});

it("validates the structured result contract", () => {
  expect(readDashboard({ structuredContent: data })).toEqual(data);
  expect(() => readDashboard({ isError: true })).toThrow("could not load");
  for (const broken of [undefined, {}, { ...data, schemaVersion: "2" }, { ...data, appliedFilters: null }, { ...data, dashboard: null },
    { ...data, dashboard: { ...fixture, workStreams: null } }, { ...data, dashboard: { ...fixture, blockedItems: null } },
    { ...data, dashboard: { ...fixture, recentlyCompleted: null } }, { ...data, warnings: null }]) {
    expect(() => readDashboard({ structuredContent: broken })).toThrow("incomplete");
  }
});
