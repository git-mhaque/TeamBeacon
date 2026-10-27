import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EpicMappingTab } from "../../src/components/content/screens/EpicMappingTab";
import { IntegrationsScreen } from "../../src/components/content/screens/IntegrationsScreen";
import { type EpicMapping } from "../../src/lib/api";
import { readInitiativeSnapshot, writeInitiativeSnapshot } from "../../src/lib/initiativeSnapshotCache";

const lookup = { groups: [{ id: 1, name: "Platform" }, { id: 2, name: "Delivery" }], workTypes: [{ id: 10, name: "Feature" }, { id: 20, name: "Tech debt" }] };
const epics = [
  { epicKey: "P-1", title: "Alpha", status: "Open", workStreamId: null },
  { epicKey: "P-2", title: "Beta", status: "Done", workStreamId: 1 },
];
function mockInventory(rows: EpicMapping[] = epics, failSave = false) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (String(input).endsWith("/integrations/jira/status")) return new Response(JSON.stringify({ config: { baseUrl: "https://jira.example.com/" } }));
    if (String(input).endsWith("/lookup")) return new Response(JSON.stringify(lookup));
    if (String(input).endsWith("/unmapped-cards")) return new Response(JSON.stringify({ cards: [], count: 0, lastSyncedAt: null, jiraBaseUrl: null, projectKey: "P" }));
    if (init?.method === "POST") return new Response(JSON.stringify(failSave ? { detail: "P-1 changed. Reload inventory." } : { savedCount: 1 }), { status: failSave ? 409 : 200 });
    return new Response(JSON.stringify({ epics: rows, lastSyncedAt: "2026-10-14T10:00:00Z" }));
  });
}
async function renderTab() {
  render(<EpicMappingTab lookup={lookup} />);
  await screen.findByLabelText("Work stream for P-1");
}
const edit = () => fireEvent.change(screen.getByLabelText("Work stream for P-1"), { target: { value: "2" } });

describe("Epic mapping", () => {
  afterEach(() => vi.restoreAllMocks());
  it("compares all-status and non-Closed distributions using each scope's saved totals", async () => {
    mockInventory([
      { ...epics[0], workStreamId: 1 },
      { ...epics[1], status: "Closed", workStreamId: 2 },
      { epicKey: "P-3", title: "Analysis", status: "Analysis", workStreamId: 1 },
      { epicKey: "P-4", title: "Active", status: "In Progress", workStreamId: null },
      { epicKey: "P-5", title: "Unknown status", status: "", workStreamId: 2 },
    ]);
    await renderTab();
    const all = screen.getByRole("region", { name: "All statuses work stream distribution" });
    const nonClosed = screen.getByRole("region", { name: "Not Closed work stream distribution" });
    expect(within(all).getByText("5 epics")).toBeInTheDocument();
    expect(within(nonClosed).getByText("4 epics")).toBeInTheDocument();
    const assertCount = (scope: HTMLElement, stream: string, count: number, total: number, percentage: number) => {
      const bar = within(scope).getByRole("progressbar", { name: new RegExp(`^${stream} epic count`) });
      expect(bar).toHaveAttribute("value", String(count));
      expect(bar).toHaveAttribute("max", String(total));
      expect(bar.parentElement).toHaveTextContent(`${count} (${percentage}%)`);
    };
    assertCount(all, "Platform", 2, 5, 40);
    assertCount(all, "Delivery", 2, 5, 40);
    assertCount(all, "Unmapped", 1, 5, 20);
    assertCount(nonClosed, "Platform", 2, 4, 50);
    assertCount(nonClosed, "Delivery", 1, 4, 25);
    assertCount(nonClosed, "Unmapped", 1, 4, 25);
    fireEvent.change(screen.getByLabelText("Status filter"), { target: { value: "Closed" } });
    fireEvent.change(screen.getByLabelText("Work stream for P-2"), { target: { value: "1" } });
    expect(screen.getAllByText("1 epic shown")).toHaveLength(2);
    assertCount(all, "Delivery", 2, 5, 40);
    assertCount(nonClosed, "Delivery", 1, 4, 25);
  });
  it("shows zero non-Closed counts safely when every epic is closed", async () => {
    mockInventory([{ ...epics[0], status: "Closed" }]);
    await renderTab();
    const nonClosed = screen.getByRole("region", { name: "Not Closed work stream distribution" });
    expect(within(nonClosed).getByText("0 epics")).toBeInTheDocument();
    for (const bar of within(nonClosed).getAllByRole("progressbar")) {
      expect(bar).toHaveAttribute("value", "0");
      expect(bar).toHaveAttribute("max", "1");
      expect(bar.parentElement).toHaveTextContent("0 (0%)");
    }
  });
  it("stages and saves work type changes without changing the work stream", async () => {
    writeInitiativeSnapshot("work-type-edit", { workTypeId: 10 });
    const fetch = mockInventory([{ ...epics[0], workTypeId: 10 }, epics[1]]);
    await renderTab();
    const type = screen.getByLabelText("Work type for P-1");
    expect(type).toHaveValue("10");
    fireEvent.change(type, { target: { value: "20" } });
    expect(screen.getByText("1 unsaved changes")).toBeInTheDocument();
    expect(screen.getByLabelText("Work stream for P-1")).toHaveValue("unmapped");
    expect(screen.getByText("P-1").closest("tr")).toHaveClass("is-edited");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Saved 1 epic mappings.");
    expect(readInitiativeSnapshot("work-type-edit")).toBeNull();
    const post = fetch.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(post![1]!.body as string)).toEqual({ changes: [{ epicKey: "P-1", workTypeId: 20, expectedWorkTypeId: 10 }] });
    expect(type).toHaveValue("20");
    expect(screen.getByText("0 unsaved changes")).toBeInTheDocument();
    fireEvent.change(type, { target: { value: "unset" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.getByText("0 unsaved changes")).toBeInTheDocument());
    expect(JSON.parse(fetch.mock.calls.filter(([, init]) => init?.method === "POST")[1][1]!.body as string)).toEqual({ changes: [{ epicKey: "P-1", workTypeId: null, expectedWorkTypeId: 20 }] });
  });
  it("combines work type and stream drafts and reverts each field independently", async () => {
    const fetch = mockInventory(); await renderTab();
    fireEvent.change(screen.getByLabelText("Work type for P-1"), { target: { value: "10" } });
    edit();
    expect(screen.getByText("1 unsaved changes")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Work type for P-1"), { target: { value: "unset" } });
    expect(screen.getByText("1 unsaved changes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.getByLabelText("Work stream for P-1")).toHaveValue("unmapped");
    expect(screen.getByLabelText("Work type for P-1")).toHaveValue("unset");
    edit();
    fireEvent.change(screen.getByLabelText("Work type for P-1"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Saved 1 epic mappings.");
    const post = fetch.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(post![1]!.body as string)).toEqual({ changes: [{ epicKey: "P-1", workStreamId: 2, expectedWorkStreamId: null, workTypeId: 10, expectedWorkTypeId: null }] });
  });
  it("preserves work type drafts on failed saves and supports sorting and reload", async () => {
    mockInventory([{ ...epics[0], workTypeId: 20 }, { ...epics[1], workTypeId: 10 }], true);
    await renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Sort by Work type" }));
    expect(screen.getAllByRole("row")[1]).toHaveTextContent("P-2");
    fireEvent.change(screen.getByLabelText("Work type for P-1"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("P-1 changed");
    expect(screen.getByLabelText("Work type for P-1")).toHaveValue("10");
    expect(screen.getByText("1 unsaved changes")).toBeInTheDocument();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Reload inventory" }));
    expect(screen.getByText("1 unsaved changes")).toBeInTheDocument();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Reload inventory" }));
    await waitFor(() => expect(screen.getByLabelText("Work type for P-1")).toHaveValue("20"));
    expect(screen.getByText("0 unsaved changes")).toBeInTheDocument();
  });
  it("uses synced JIRA status labels and an Unknown fallback in rows and filters", async () => {
    mockInventory([
      { ...epics[0], status: "In Progress" },
      { ...epics[1], status: "" },
    ]);
    await renderTab();
    expect(within(screen.getByText("P-1").closest("tr")!).getByText("In Progress")).toBeInTheDocument();
    const statusFilter = screen.getByLabelText("Status filter");
    expect(within(statusFilter).getByRole("option", { name: "In Progress" })).toBeInTheDocument();
    fireEvent.change(statusFilter, { target: { value: "Unknown" } });
    expect(screen.queryByText("P-1")).not.toBeInTheDocument();
    expect(within(screen.getByText("P-2").closest("tr")!).getByText("Unknown")).toBeInTheDocument();
  });
  it("stages edits, filters by saved values and saves only changes", async () => {
    const fetch = mockInventory(); await renderTab();
    const link = await screen.findByRole("link", { name: "Open P-1 in JIRA (new tab)" });
    expect(link).toHaveAttribute("href", "https://jira.example.com/browse/P-1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    fireEvent.click(screen.getByRole("button", { name: /Unmapped epics/ }));
    expect(screen.queryByText("P-2")).not.toBeInTheDocument();
    edit(); expect(screen.getByText("1 unsaved changes")).toBeInTheDocument();
    expect(screen.getByText("P-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Saved 1 epic mappings.");
    const post = fetch.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(post![1]!.body as string)).toEqual({ changes: [{ epicKey: "P-1", workStreamId: 2, expectedWorkStreamId: null }] });
    expect(screen.getByText("0 unsaved changes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Mapped epics/ }));
    expect(screen.getByLabelText("Work stream for P-1")).toHaveValue("2");
    fireEvent.click(screen.getByRole("button", { name: /Total epics/ }));
    fireEvent.change(screen.getByLabelText("Work stream for P-2"), { target: { value: "unmapped" } });
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.getByLabelText("Work stream for P-2")).toHaveValue("1");
  });
  it("shows all matching epics and supports selection, bulk edits and filters without losing drafts", async () => {
    mockInventory([...epics, ...Array.from({ length: 50 }, (_, i) => ({ epicKey: `X-${i}`, title: `Extra ${i}`, status: "Open", workStreamId: null }))]);
    await renderTab();
    for (const value of ["key", "title", "status", "unmapped"]) fireEvent.change(screen.getByLabelText("Sort epics"), { target: { value } });
    fireEvent.click(screen.getByLabelText("Select P-1"));
    fireEvent.change(screen.getByLabelText("Bulk work stream"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply to selected" }));
    fireEvent.click(screen.getByLabelText("Select all filtered epics"));
    expect(screen.getByText("52 selected")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Select all filtered epics"));
    expect(screen.getByLabelText("Work stream for P-1")).toHaveValue("1");
    fireEvent.click(screen.getByLabelText("Select P-1"));
    fireEvent.click(screen.getByLabelText("Select all filtered epics"));
    fireEvent.change(screen.getByLabelText("Bulk work stream"), { target: { value: "unmapped" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply to selected" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.getByText("0 selected")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search epics"), { target: { value: "Beta" } });
    fireEvent.change(screen.getByLabelText("Work stream filter"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Status filter"), { target: { value: "Done" } });
    expect(screen.getByText("P-2")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Mapping filter"), { target: { value: "unmapped" } });
    expect(screen.getByText("No epics match these filters.")).toBeInTheDocument();
  });
  it("preserves failed drafts, guards leaving, and requires confirmation before reload", async () => {
    mockInventory(epics, true); await renderTab(); edit();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    expect(window.dispatchEvent(new Event("tb-before-navigation", { cancelable: true }))).toBe(false);
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Reload inventory" }));
    expect(screen.getByText("1 unsaved changes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByRole("alert");
    expect(screen.getByText("1 unsaved changes")).toBeInTheDocument();
    confirm.mockReturnValue(true);
    await waitFor(() => expect(window.dispatchEvent(new Event("tb-before-navigation", { cancelable: true }))).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Reload inventory" }));
    await waitFor(() => expect(screen.getByLabelText("Work stream for P-1")).toHaveValue("unmapped"));
    fireEvent.click(screen.getByRole("button", { name: "Reload inventory" }));
  });
  it("keeps epic mapping available if JIRA status has no configured URL", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => new Response(JSON.stringify(
      String(input).endsWith("/integrations/jira/status") ? { config: {} } : { epics, lastSyncedAt: null },
    )));
    await renderTab();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    edit();
    expect(screen.getByText("1 unsaved changes")).toBeInTheDocument();
  });
  it("shows empty inventory and recovers from load failure", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Offline"));
    render(<EpicMappingTab lookup={lookup} />);
    await screen.findByText("Offline");
    fetch.mockResolvedValue(new Response(JSON.stringify({ epics: [], lastSyncedAt: null })));
    fireEvent.click(screen.getByRole("button", { name: "Retry loading" }));
    await screen.findByText("No epics match these filters.");
    expect(screen.getByText("0%")).toBeInTheDocument();
  });
  it("keeps drafts while switching settings tabs and supports keyboard tab navigation", async () => {
    mockInventory(); render(<IntegrationsScreen />);
    fireEvent.keyDown(screen.getByRole("tab", { name: "Initiative Metadata" }), { key: "ArrowRight" });
    await screen.findByLabelText("Work stream for P-1"); edit();
    fireEvent.keyDown(screen.getByRole("tab", { name: "Work Stream Epic Mapping" }), { key: "End" });
    await screen.findByText("No unmapped cards found in synced data.");
    expect(screen.getByRole("tab", { name: "Unmapped cards" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("tab", { name: "Unmapped cards" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Initiative Metadata" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("tab", { name: "Initiative Metadata" }), { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Unmapped cards" })).toHaveFocus();
    fireEvent.click(screen.getByRole("tab", { name: "Work Stream Epic Mapping" }));
    fireEvent.keyDown(screen.getByRole("tab", { name: "Work Stream Epic Mapping" }), { key: "Home" });
    fireEvent.click(screen.getByRole("tab", { name: "Work Stream Epic Mapping" }));
    expect(screen.getByText("1 unsaved changes")).toBeVisible();
    fireEvent.keyDown(screen.getByRole("tab", { name: "Work Stream Epic Mapping" }), { key: "ArrowLeft" });
    fireEvent.keyDown(screen.getByRole("tab", { name: "Initiative Metadata" }), { key: "ArrowRight" });
    fireEvent.keyDown(screen.getByRole("tab", { name: "Work Stream Epic Mapping" }), { key: "Escape" });
    fireEvent.click(screen.getByRole("tab", { name: "Initiative Metadata" }));
  });
});

it("sorts every data header in both directions and preserves edits and selections", async () => {
  mockInventory([...epics, { epicKey: "P-10", title: "Alpha", status: "Open", workStreamId: 2 }]);
  await renderTab();
  const rowKeys = () => screen.getAllByRole("row").slice(1).map((row) => row.querySelectorAll("td")[1].textContent);
  const sort = (label: string) => fireEvent.click(screen.getByRole("button", { name: `Sort by ${label}` }));
  sort("Epic key"); expect(rowKeys()).toEqual(["P-1", "P-2", "P-10"]);
  sort("Epic key"); expect(rowKeys()).toEqual(["P-10", "P-2", "P-1"]);
  expect(screen.getByRole("columnheader", { name: /Epic key/ })).toHaveAttribute("aria-sort", "descending");
  sort("Title"); expect(rowKeys()).toEqual(["P-1", "P-10", "P-2"]);
  sort("Title"); expect(rowKeys()).toEqual(["P-2", "P-10", "P-1"]);
  sort("Status"); expect(rowKeys()).toEqual(["P-2", "P-1", "P-10"]);
  sort("Status"); expect(rowKeys()).toEqual(["P-10", "P-1", "P-2"]);
  sort("Work stream"); expect(rowKeys()).toEqual(["P-10", "P-2", "P-1"]);
  sort("Work stream"); expect(rowKeys()).toEqual(["P-1", "P-2", "P-10"]);
  fireEvent.click(screen.getByLabelText("Select P-2"));
  fireEvent.change(screen.getByLabelText("Work stream for P-10"), { target: { value: "1" } });
  sort("Changes"); expect(rowKeys()).toEqual(["P-10", "P-1", "P-2"]);
  sort("Changes"); expect(rowKeys()).toEqual(["P-2", "P-1", "P-10"]);
  expect(screen.getByLabelText("Select P-2")).toBeChecked();
  expect(screen.getByLabelText("Work stream for P-10")).toHaveValue("1");
  expect(screen.getByText("1 unsaved changes")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Sort epics"), { target: { value: "unmapped" } });
  expect(rowKeys()).toEqual(["P-1", "P-2", "P-10"]);
});

it("shows all 245 epics without paging and keeps sort controls focusable", async () => {
  mockInventory([...epics, ...Array.from({ length: 243 }, (_, i) => ({ epicKey: `X-${i}`, title: `Extra ${i}`, status: "Open", workStreamId: null }))]);
  await renderTab();
  fireEvent.click(screen.getByLabelText("Select P-1"));
  expect(screen.getByText("X-242")).toBeInTheDocument();
  const table = screen.getByRole<HTMLTableElement>("table");
  const tableHeader = within(table.tHead!);
  expect(table.rows).toHaveLength(246);
  const counts = screen.getAllByText("245 epics shown");
  expect(counts).toHaveLength(2);
  expect(counts[0].compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(counts[1].compareDocumentPosition(table) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
  const header = tableHeader.getByRole("button", { name: "Sort by Epic key" });
  expect(header).toHaveAttribute("type", "button");
  header.focus(); expect(header).toHaveFocus();
  fireEvent.click(header);
  expect(screen.queryByRole("button", { name: "Previous" })).not.toBeInTheDocument();
  expect(screen.getByLabelText("Select P-1")).toBeChecked();
  expect(tableHeader.getByRole("columnheader", { name: /Epic key/ })).toHaveAttribute("aria-sort", "ascending");
}, 15_000);

it("selects all filtered epics without removing hidden selections", async () => {
  mockInventory(); await renderTab();
  fireEvent.click(screen.getByLabelText("Select P-1"));
  fireEvent.change(screen.getByLabelText("Search epics"), { target: { value: "Beta" } });
  expect(screen.getAllByText("1 epic shown")).toHaveLength(2);
  fireEvent.click(screen.getByLabelText("Select all filtered epics"));
  expect(screen.getByText("2 selected")).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("Select all filtered epics"));
  expect(screen.getByText("1 selected")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Search epics"), { target: { value: "" } });
  expect(screen.getByLabelText("Select P-1")).toBeChecked();
  expect(screen.getByLabelText("Select P-2")).not.toBeChecked();
});

 it("shows synced labels after status, handles empty labels, and sorts labels both ways", async () => {
  mockInventory([
    { ...epics[0], labels: ["Security", "FY27Q1"] },
    { ...epics[1], labels: ["CI-CD"] },
    { epicKey: "P-3", title: "Unlabelled", status: "Open", workStreamId: null, labels: [] },
  ]);
  await renderTab();
  const headers = screen.getAllByRole("columnheader");
  expect(headers[3]).toHaveTextContent("Status");
  expect(headers[4]).toHaveTextContent("Labels");
  const row = screen.getByText("P-1").closest("tr")!;
  expect(within(row).getByText("Security, FY27Q1")).toBeInTheDocument();
  expect(screen.getByText("P-3").closest("tr")!.querySelectorAll("td")[4]).toHaveTextContent("—");
  const rowKeys = () => screen.getAllByRole("row").slice(1).map((item) => item.querySelectorAll("td")[1].textContent);
  fireEvent.click(screen.getByRole("button", { name: "Sort by Labels" }));
  expect(rowKeys()).toEqual(["P-3", "P-2", "P-1"]);
  fireEvent.click(screen.getByRole("button", { name: "Sort by Labels" }));
  expect(rowKeys()).toEqual(["P-1", "P-2", "P-3"]);
 });
