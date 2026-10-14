import type { TeamDashboardResponse } from "../lib/api";

export type DashboardFilters = {
  flow_weeks: 1 | 4 | 12;
  recent_limit: number;
  timezone: string;
  cycle_time_status_keys: string[] | null;
};

export type DashboardEnvelope = {
  schemaVersion: "1";
  appliedFilters: DashboardFilters;
  uiUrl: string;
  warnings: string[];
  dashboard: TeamDashboardResponse;
};

export function readDashboard(result: { isError?: boolean; structuredContent?: unknown }): DashboardEnvelope {
  if (result.isError) throw new Error("TeamBeacon could not load the dashboard. Check that its local API is running.");
  const value = result.structuredContent as DashboardEnvelope | undefined;
  if (!value || value.schemaVersion !== "1" || !value.appliedFilters || !value.dashboard
    || !Array.isArray(value.dashboard.workStreams) || !value.dashboard.blockedItems
    || !value.dashboard.recentlyCompleted || !Array.isArray(value.warnings)) {
    throw new Error("The dashboard response was incomplete. Try updating the view.");
  }
  return value;
}

export function createDashboardBridge() {
  // MCP Apps standard JSON-RPC bridge. See the official MCP UI quickstart.
  // The parent is the host; pin its origin after the initialization response.
  let sequence = 0;
  let hostOrigin = "*";
  let onResult: (value: DashboardEnvelope) => void;
  let onError: (message: string) => void;
  let observer: ResizeObserver | undefined;
  const pending = new Map<number, { resolve: (value: any) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const notify = (method: string, params: unknown) => window.parent.postMessage({ jsonrpc: "2.0", method, params }, hostOrigin);
  const request = (method: string, params: unknown): Promise<any> => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("The dashboard host did not respond. Try reopening this view.")); }, 35000);
    pending.set(id, { resolve, reject, timer });
    window.parent.postMessage({ jsonrpc: "2.0", id, method, params }, hostOrigin);
  });
  const receive = (event: MessageEvent) => {
    if (event.source !== window.parent || (hostOrigin !== "*" && event.origin !== hostOrigin)) return;
    const message = event.data;
    if (!message || message.jsonrpc !== "2.0") return;
    if (message.id !== undefined && !message.method) {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error("The host could not complete the dashboard request."));
      else {
        if (event.origin && event.origin !== "null") hostOrigin = event.origin;
        entry.resolve(message.result);
      }
    } else if (message.method === "ui/notifications/tool-result") {
      try { onResult(readDashboard(message.params)); }
      catch (error) { onError((error as Error).message); }
    }
  };
  return {
    async connect(resultHandler: (value: DashboardEnvelope) => void, errorHandler: (message: string) => void) {
      onResult = resultHandler;
      onError = errorHandler;
      window.addEventListener("message", receive);
      const host = await request("ui/initialize", {
        appInfo: { name: "TeamBeacon dashboard", version: "1.0.0" },
        appCapabilities: {}, protocolVersion: "2026-01-26",
      });
      if (host?.protocolVersion !== "2026-01-26") throw new Error("The host uses an unsupported MCP Apps protocol.");
      notify("ui/notifications/initialized", {});
      if (typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(() => notify("ui/notifications/size-changed", { height: Math.ceil(document.body.getBoundingClientRect().height) }));
        observer.observe(document.body);
      }
    },
    async read(filters: DashboardFilters) {
      return readDashboard(await request("tools/call", { name: "get_team_dashboard", arguments: filters }));
    },
    async openLink(url: string) {
      const response = await request("ui/open-link", { url });
      if (response?.isError) throw new Error("The host declined to open this link.");
    },
    close() {
      window.removeEventListener("message", receive);
      observer?.disconnect();
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error("Dashboard closed."));
      }
      pending.clear();
    },
  };
}

export type DashboardBridge = ReturnType<typeof createDashboardBridge>;
