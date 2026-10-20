import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PlannerScreen } from "../../src/components/content/screens/PlannerScreen";
import { PlannerTimeline } from "../../src/components/content/screens/PlannerTimeline";
import { jiraEpicUrl, newPlan, progressLabel, type DeliveryPlan, type PlanDraft, type PlannerEpic, type PlannerInventory } from "../../src/lib/planner";

const sources: PlannerEpic[] = [
  { epicKey: "P-1", title: "API platform", status: "In Progress", isCompleted: false, available: true, startDate: "2026-10-01", endDate: "2026-10-10", completedCards: 4, totalCards: 10, completionPercent: 40 },
  { epicKey: "P-2", title: "Web experience", status: "Done", isCompleted: true, available: true, startDate: null, endDate: null, completedCards: 5, totalCards: 5, completionPercent: 100 },
];
const placement = (epicKey = "P-1") => ({ epicKey, trackId: "default", startDate: "2026-10-01", endDate: "2026-10-10", dependsOn: [] as string[], notes: "" });
const saved = (changes: Partial<DeliveryPlan> = {}): DeliveryPlan => ({
  ...newPlan(), name: "Launch", id: 1, version: 1, createdAt: "2026-10-01", updatedAt: "2026-10-01", epics: [placement()],
  metrics: { completedCards: 4, totalCards: 10, completionPercent: 40, available: true },
  warnings: [], baseline: null, scopeChange: null, ...changes,
});
const data = (plans: DeliveryPlan[] = []): PlannerInventory => ({ plans, epics: sources, lastSyncedAt: "2026-10-20T01:00:00Z", jiraBaseUrl: "https://jira.example.test" });
function mock(initial = data()) {
  let state = structuredClone(initial);
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    if (init?.method === "POST") {
      const payload = JSON.parse(String(init.body)) as PlanDraft;
      const plan = saved({ ...payload, id: payload.id ?? 3, version: (payload.version ?? 0) + 1 });
      state = { ...state, plans: [plan, ...state.plans.filter(item => item.id !== plan.id)] };
      return new Response(JSON.stringify(plan));
    }
    return new Response(JSON.stringify(state));
  });
}
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
async function open(initial = data([saved()])) {
  const fetch = mock(initial);
  render(<PlannerScreen />);
  await screen.findByRole("heading", { name: /Plans/ });
  return fetch;
}

describe("Planner", () => {
  it("creates a persistent plan with tracks, multiple epics, local dates and dependencies", async () => {
    const fetch = await open(data());
    expect(screen.getByText(/No saved plans yet/)).toBeInTheDocument();
    click("New plan");
    change("Plan name", "Customer launch"); change("Owner", "Manager");
    change("Objective", "Ship the customer portal"); change("Plan target", "2026-11-01");
    click("Add track"); change("Track 2 name", "Web");
    fireEvent.click(screen.getByLabelText("P-1 · API platform"));
    fireEvent.click(screen.getByLabelText("P-2 · Web experience"));
    click("Add selected epics (2)");
    expect(screen.getByLabelText("Planned start")).toHaveValue("2026-10-01");
    change("Planning notes", "Coordinate API contract");
    click(/Edit P-2/);
    change("Epic track", screen.getByRole("option", { name: "Web" }).getAttribute("value")!);
    change("Planned start", "2026-10-11"); change("Planned finish", "2026-10-30");
    fireEvent.click(screen.getByLabelText("P-1")); change("Status", "active");
    click("Save plan");
    await screen.findByText("Plan saved.");
    const payload = JSON.parse(String(fetch.mock.calls.find(([, options]) => options?.method === "POST")![1]!.body));
    expect(payload).toMatchObject({ name: "Customer launch", owner: "Manager", objective: "Ship the customer portal", status: "active", targetDate: "2026-11-01" });
    expect(payload.epics[1]).toMatchObject({ epicKey: "P-2", startDate: "2026-10-11", endDate: "2026-10-30", dependsOn: ["P-1"] });
    expect(screen.getByRole("button", { name: "Save plan" })).toBeDisabled();
    click("Refresh plans");
    await waitFor(() => expect(screen.getByLabelText("Plan name")).toHaveValue("Customer launch"));
  });

  it("selects saved plans, edits tracks and safely removes epics and dependency links", async () => {
    const first = saved({ epics: [placement(), { ...placement("P-2"), trackId: "web", dependsOn: ["P-1"] }], tracks: [{ id: "default", name: "API" }, { id: "web", name: "Web" }] });
    await open(data([first, saved({ id: 2, name: "Other", status: "archived" })]));
    click("Move Web up"); expect(screen.getByLabelText("Track 1 name")).toHaveValue("Web");
    click("Move Web down"); expect(screen.getByLabelText("Track 1 name")).toHaveValue("API");
    click("Remove track Web");
    click(/Edit P-2/); expect(screen.getByLabelText("Epic track")).toHaveValue("default");
    fireEvent.click(screen.getByLabelText("P-1"));
    expect(screen.getByLabelText("P-1")).not.toBeChecked();
    fireEvent.click(screen.getByLabelText("P-1"));
    click(/Edit P-1/); click("Remove epic from plan");
    click(/Edit P-2/);
    expect(screen.getByText("Add another epic to define a dependency.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open P-2 in JIRA" })).toHaveAttribute("rel", "noopener noreferrer");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    click(/Otherarchived/); expect(screen.getByLabelText("Plan name")).toHaveValue("Launch");
    confirm.mockReturnValue(true);
    click(/Otherarchived/); expect(screen.getByLabelText("Plan name")).toHaveValue("Other");
    change("Status", "completed"); click("Save plan");
    await screen.findByText("Plan saved.");
  });

  it("protects drafts on navigation, refresh and reload and supports discard", async () => {
    const fetch = await open();
    change("Plan name", "Unsaved");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    expect(window.dispatchEvent(new Event("tb-before-navigation", { cancelable: true }))).toBe(false);
    const unload = new Event("beforeunload", { cancelable: true });
    expect(window.dispatchEvent(unload)).toBe(false);
    click("New plan"); click("Discard changes"); click("Refresh plans");
    expect(screen.getByLabelText("Plan name")).toHaveValue("Unsaved");
    expect(fetch).toHaveBeenCalledTimes(1);
    confirm.mockReturnValue(true);
    expect(window.dispatchEvent(new Event("tb-before-navigation", { cancelable: true }))).toBe(true);
    click("Discard changes"); expect(screen.getByLabelText("Plan name")).toHaveValue("Launch");
    click("New plan"); change("Plan name", "Abandoned"); click("Discard changes");
    expect(screen.queryByLabelText("Plan name")).not.toBeInTheDocument();
  });

  it("preserves a failed save draft and recovers from loading errors", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("not json", { status: 503 }));
    render(<PlannerScreen />);
    await screen.findByText("Unable to load Planner.");
    fetch.mockResolvedValue(new Response(JSON.stringify(data([saved()]))));
    click("Reload saved plans");
    await screen.findByLabelText("Plan name");
    change("Owner", "Draft owner");
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ detail: "This plan changed. Reload it." }), { status: 409 }));
    click("Save plan"); await screen.findByText("This plan changed. Reload it.");
    expect(screen.getByLabelText("Owner")).toHaveValue("Draft owner");
    fetch.mockResolvedValueOnce(new Response("", { status: 503 }));
    click("Save plan"); await screen.findByText("Unable to save the plan.");
    fetch.mockRejectedValueOnce("offline"); click("Save plan");
    await screen.findByText("Unable to save the plan.");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fetch.mockRejectedValueOnce("offline"); click("Reload saved plans");
    await screen.findByText("Unable to load Planner.");
  });

  it("shows saved warnings, activation baseline and unavailable progress without unsafe links", async () => {
    const plan = saved({ status: "active", targetDate: "2026-11-01", warnings: ["P-1: source epic is unavailable."],
      metrics: { totalCards: 0, completedCards: 0, completionPercent: null, available: false },
      baseline: { capturedAt: "2026-10-01", document: { ...newPlan(), epics: [{ ...placement(), startDate: null, endDate: null, dependsOn: ["P-2"] }], targetDate: "2026-10-31" }, issueKeys: ["P-10"] },
      scopeChange: { added: 2, removed: 1 },
    });
    await open({ ...data([plan]), lastSyncedAt: null, jiraBaseUrl: "javascript:alert(1)", epics: [{ ...sources[0], available: false, completionPercent: null }] });
    expect(screen.getByText(/Last successful JIRA sync/)).toHaveTextContent("Not available");
    expect(screen.getByRole("region", { name: "Planning warnings" })).toHaveTextContent("source epic is unavailable");
    expect(screen.getByText(/Scope since activation/)).toHaveTextContent("+2 added / −1 removed · Source data is incomplete");
    click(/Edit P-1/);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    change("Plan target", "");
    expect(screen.queryByRole("region", { name: "Planning warnings" })).not.toBeInTheDocument();
    expect(screen.getByText("Summary reflects the last save")).toBeInTheDocument();
    change("Planned start", ""); change("Planned finish", "");
    expect(screen.getByText("Unscheduled / incomplete dates")).toBeInTheDocument();
  });

  it("searches and deselects candidates and preserves hidden selections", async () => {
    await open(data());
    click("New plan");
    fireEvent.click(screen.getByLabelText("P-1 · API platform"));
    fireEvent.click(screen.getByLabelText("P-1 · API platform"));
    expect(screen.getByRole("button", { name: "Add selected epics (0)" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText("P-1 · API platform"));
    change("Search configured epics", "Web");
    expect(screen.queryByLabelText("P-1 · API platform")).not.toBeInTheDocument();
    click("Add selected epics (1)");
    change("Search configured epics", "missing");
    expect(screen.getByText(/No matching epics/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove track Default" })).toBeDisabled();
  });

  it("blocks navigation during a save and ignores requests after unmounting", async () => {
    let finish!: (response: Response) => void;
    const fetch = mock(data([saved()]));
    const view = render(<PlannerScreen />);
    await screen.findByLabelText("Plan name");
    change("Plan name", "Saving");
    fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    click("Save plan");
    expect(screen.getByLabelText("Plan name")).toBeDisabled();
    expect(window.dispatchEvent(new Event("tb-before-navigation", { cancelable: true }))).toBe(false);
    expect(screen.getByRole("button", { name: "New plan" })).toBeDisabled();
    view.unmount();
    await act(async () => finish(new Response(JSON.stringify(saved()))));
    let loaded!: (response: Response) => void;
    fetch.mockImplementationOnce(() => new Promise(resolve => { loaded = resolve; }));
    const second = render(<PlannerScreen />); second.unmount();
    await act(async () => loaded(new Response(JSON.stringify(data()))));
  });

  it("shows missing source epic details and baseline defaults", async () => {
    await open({ ...data([saved({ epics: [placement("MISSING")],
      baseline: { capturedAt: "2026-10-01", document: { ...newPlan(), epics: [placement()] }, issueKeys: [] }, scopeChange: { added: 0, removed: 0 },
    })]), epics: [] });
    click("Edit MISSING");
    expect(screen.getByRole("heading", { name: "MISSING · Source unavailable" })).toBeInTheDocument();
    expect(screen.getByText(/Original target: not set/)).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "None" })).toBeInTheDocument();
  });
});

describe("Planner timeline", () => {
  it("fits the available width without shrinking labels and disconnects on unmount", () => {
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      callback: () => void;
      constructor(callback: () => void) { this.callback = callback; }
      observe() { this.callback(); }
      disconnect = disconnect;
    });
    const view = render(<PlannerTimeline plan={newPlan()} epics={[]} selected={null} onSelect={vi.fn()} baseline={null} />);
    expect(view.container.querySelector("svg")).toHaveAttribute("width", "800");
    view.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
  it("renders planned dates, baseline, dependencies, empty tracks and keyboard selection", () => {
    const onSelect = vi.fn();
    const plan: PlanDraft = { ...newPlan(), targetDate: "2026-11-01", tracks: [{ id: "default", name: "API" }, { id: "empty", name: "Empty" }],
      epics: [placement(), { ...placement("P-2"), startDate: "2026-10-11", endDate: "2026-10-20", dependsOn: ["P-1"] }] };
    const baseline = { ...plan, epics: [placement()] };
    const { container, rerender } = render(<PlannerTimeline plan={plan} epics={[{ ...sources[0], title: "A very long epic title which needs clipping" }, sources[1]]} selected="P-1" onSelect={onSelect} baseline={baseline} />);
    expect(container.querySelectorAll(".tb-planner-edge")).toHaveLength(1);
    expect(container.querySelector(".tb-planner-edge")).toHaveClass("is-highlighted");
    expect(container.querySelectorAll(".tb-planner-baseline")).toHaveLength(1);
    const node = screen.getByRole("button", { name: /Edit P-1/ });
    fireEvent.keyDown(node, { key: "ArrowDown" }); expect(onSelect).not.toHaveBeenCalled();
    fireEvent.keyDown(node, { key: "Enter" }); fireEvent.keyDown(node, { key: " " }); fireEvent.click(node);
    expect(onSelect).toHaveBeenCalledTimes(3);
    expect(screen.getByText("No epics in this track")).toBeInTheDocument();
    rerender(<PlannerTimeline plan={plan} epics={sources} selected="P-2" onSelect={onSelect} baseline={null} />);
    expect(container.querySelector(".tb-planner-edge")).toHaveClass("is-highlighted");
    rerender(<PlannerTimeline plan={plan} epics={sources} selected={null} onSelect={onSelect} baseline={null} />);
    expect(container.querySelector(".tb-planner-edge")).not.toHaveClass("is-highlighted");
    plan.epics[0].endDate = null;
    rerender(<PlannerTimeline plan={plan} epics={sources} selected={null} onSelect={onSelect} baseline={null} />);
    expect(container.querySelector(".tb-planner-edge")).toBeNull();
    rerender(<PlannerTimeline plan={newPlan()} epics={[]} selected={null} onSelect={onSelect} baseline={null} />);
    expect(screen.getByText("Today")).toBeInTheDocument();
  });

  it("handles empty progress and safe links", () => {
    expect(progressLabel({ available: true, totalCards: 0, completedCards: 0, completionPercent: null })).toBe("No cards");
    expect(jiraEpicUrl(null, "P-1")).toBeUndefined();
    expect(jiraEpicUrl("https://jira.test///", "P 1")).toBe("https://jira.test/browse/P%201");
  });
});
