import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TeamReportScreen, OPEN_TEAM_REPORT_INITIATIVE_CONFIG_EVENT, OPEN_TEAM_REPORT_REPORTING_PERIOD_EVENT } from "../../src/components/content/screens/TeamReportScreen";
import * as preferences from "../../src/lib/persistence";

const KEY = "teambeacon.executive.initiative.visibleEpicKeys";
const LABEL = "Automatically select initiatives with completed cards in the reporting period";
let store: Map<string, string>;
let counts: number[];
const names = ["Completed earlier", "Delivery this period", "Another delivery", "No completed work"];

beforeEach(() => {
  store = new Map(); counts = [0, 2, 1, 0];
  vi.spyOn(preferences, "getPreferenceSync").mockImplementation((key) => store.get(key) ?? null);
  vi.spyOn(preferences, "getPreference").mockImplementation(async (key) => store.get(key) ?? null);
  vi.spyOn(preferences, "setPreference").mockImplementation(async (key, value) => { store.set(key, value); });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    if (String(input).includes("/metadata/epics/summary")) return new Response(JSON.stringify({ epics: names.map((epicName, index) => ({
      epicKey: `P-${index}`, epicName, groups: [], workTypes: [], successCriteria: [],
      timelineEnabled: false, completionPercent: index === 0 ? 100 : 10,
      totalCards: 10, completedCards: index === 0 ? 10 : 1, completedInPeriod: counts[index],
    })) }));
    return new Response(JSON.stringify({ config: {} }));
  });
});
async function openConfig() {
  act(() => { window.dispatchEvent(new CustomEvent(OPEN_TEAM_REPORT_INITIATIVE_CONFIG_EVENT)); });
  return screen.findByRole("dialog", { name: "Configure Initiative Epics" });
}
async function start() { const view = render(<TeamReportScreen />); await screen.findByText(names[0]); return view; }
function selection(dialog: HTMLElement) { return within(dialog).getByText(/^Selected \(/).closest("section")!; }
async function save(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Configure Initiative Epics" })).not.toBeInTheDocument());
}
async function changePeriod() {
  act(() => { window.dispatchEvent(new CustomEvent(OPEN_TEAM_REPORT_REPORTING_PERIOD_EVENT)); });
  const dialog = await screen.findByRole("dialog", { name: "Configure Reporting Period" });
  fireEvent.change(within(dialog).getByRole("combobox", { name: "Reporting Period" }), { target: { value: "custom" } });
  fireEvent.input(within(dialog).getByLabelText("Start"), { target: { value: "2026-02-01" } });
  fireEvent.input(within(dialog).getByLabelText("End"), { target: { value: "2026-02-07" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Configure Reporting Period" })).not.toBeInTheDocument());
}

describe("automatic initiative selection", () => {
  it("previews all qualifying initiatives independently of search, cancels cleanly and persists on Save", async () => {
    const view = await start();
    let dialog = await openConfig();
    expect(within(dialog).getByLabelText(LABEL)).not.toBeChecked();
    fireEvent.input(within(dialog).getByPlaceholderText("Search by epic key, title, work stream, or type"), { target: { value: "No completed work" } });
    fireEvent.click(within(dialog).getByLabelText(LABEL));
    expect(within(selection(dialog)).getByText("Selected (2)")).toBeInTheDocument();
    expect(within(selection(dialog)).queryByText(names[0])).not.toBeInTheDocument();
    expect(within(dialog).getByText(/2 initiatives qualify/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(JSON.parse(store.get(KEY)!).mode).toBe("manual");
    dialog = await openConfig();
    expect(within(dialog).getByText("Selected (4)")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByLabelText(LABEL));
    await save(dialog);
    expect(JSON.parse(store.get(KEY)!)).toEqual({ mode: "automatic", keys: ["P-1", "P-2"] });
    expect(screen.queryByText(names[0])).not.toBeInTheDocument();
    view.unmount();
    render(<TeamReportScreen />); await screen.findByText(names[1]);
    dialog = await openConfig(); expect(within(dialog).getByLabelText(LABEL)).toBeChecked();
    expect(within(dialog).getByText("Selected (2)")).toBeInTheDocument();
  });

  it("recalculates on period changes and keeps zero qualifying epics empty after reload", async () => {
    const view = await start();
    let dialog = await openConfig(); fireEvent.click(within(dialog).getByLabelText(LABEL)); await save(dialog);
    counts = [0, 0, 0, 3];
    await changePeriod();
    await waitFor(() => expect(JSON.parse(store.get(KEY)!).keys).toEqual(["P-3"]));
    counts = [0, 0, 0, 0];
    view.unmount(); const next = render(<TeamReportScreen />);
    await screen.findByText(/No initiatives selected\. Use Configure Initiatives/);
    dialog = await openConfig(); expect(within(dialog).getByLabelText(LABEL)).toBeChecked();
    expect(within(dialog).getByText("Selected (0)")).toBeInTheDocument();
    expect(within(dialog).getByText(/0 initiatives qualify/)).toBeInTheDocument();
    await save(dialog); next.unmount(); render(<TeamReportScreen />);
    await screen.findByText(/No initiatives selected\. Use Configure Initiatives/);
    expect(JSON.parse(store.get(KEY)!)).toEqual({ mode: "automatic", keys: [] });
  });

  it("retains automatic mode for reordering and switches to manual for membership edits", async () => {
    await start();
    let dialog = await openConfig(); fireEvent.click(within(dialog).getByLabelText(LABEL));
    const first = within(selection(dialog)).getByText(names[1]).closest(".tb-exec-config-item")!;
    const second = within(selection(dialog)).getByText(names[2]).closest(".tb-exec-config-item")!;
    fireEvent.dragStart(first); fireEvent.dragOver(second); fireEvent.drop(second); fireEvent.dragEnd(first);
    expect(within(dialog).getByLabelText(LABEL)).toBeChecked();
    await save(dialog); expect(JSON.parse(store.get(KEY)!).keys).toEqual(["P-2", "P-1"]);
    dialog = await openConfig(); fireEvent.dblClick(within(selection(dialog)).getByText(names[1]));
    expect(within(dialog).getByLabelText(LABEL)).not.toBeChecked();
    await save(dialog); expect(JSON.parse(store.get(KEY)!)).toEqual({ mode: "manual", keys: ["P-2"] });
    dialog = await openConfig(); fireEvent.click(within(dialog).getByLabelText(LABEL));
    const available = within(dialog).getByText(/^Available \(/).closest("section")!;
    fireEvent.dblClick(within(available).getByText(names[0]));
    expect(within(dialog).getByLabelText(LABEL)).not.toBeChecked(); await save(dialog);
    expect(JSON.parse(store.get(KEY)!).keys).toContain("P-0");
  });

  it("freezes current selection when unchecked and preserves explicit manual empty selections", async () => {
    const view = await start();
    let dialog = await openConfig(); fireEvent.click(within(dialog).getByLabelText(LABEL)); fireEvent.click(within(dialog).getByLabelText(LABEL));
    expect(within(dialog).getByText("Selected (2)")).toBeInTheDocument(); await save(dialog);
    expect(JSON.parse(store.get(KEY)!).mode).toBe("manual");
    dialog = await openConfig(); fireEvent.click(within(dialog).getByRole("button", { name: "Select All" }));
    expect(within(dialog).getByText("Selected (4)")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear All" })); await save(dialog);
    view.unmount(); render(<TeamReportScreen />);
    await screen.findByText(/No initiatives selected\. Use Configure Initiatives/);
    dialog = await openConfig(); expect(within(dialog).getByText("Selected (0)")).toBeInTheDocument();
    expect(within(dialog).getByLabelText(LABEL)).not.toBeChecked();
  });
});
