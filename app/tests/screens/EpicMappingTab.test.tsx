import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EpicMappingTab } from "../../src/components/content/screens/EpicMappingTab";
import { IntegrationsScreen } from "../../src/components/content/screens/IntegrationsScreen";
import { type EpicMapping } from "../../src/lib/api";

const lookup = { groups: [{ id: 1, name: "Platform" }, { id: 2, name: "Delivery" }], workTypes: [] };
const epics = [
  { epicKey: "P-1", title: "Alpha", status: "Open", workStreamId: null },
  { epicKey: "P-2", title: "Beta", status: "Done", workStreamId: 1 },
];
function mockInventory(rows: EpicMapping[] = epics, failSave = false) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (String(input).endsWith("/integrations/jira/status")) return new Response(JSON.stringify({ config: { baseUrl: "https://jira.example.com/" } }));
    if (String(input).endsWith("/lookup")) return new Response(JSON.stringify(lookup));
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
  it("supports selection on pages, bulk updates, sorting and filters without losing drafts", async () => {
    mockInventory([...epics, ...Array.from({ length: 50 }, (_, i) => ({ epicKey: `X-${i}`, title: `Extra ${i}`, status: "Open", workStreamId: null }))]);
    await renderTab();
    for (const value of ["key", "title", "status", "unmapped"]) fireEvent.change(screen.getByLabelText("Sort epics"), { target: { value } });
    fireEvent.click(screen.getByLabelText("Select P-1"));
    fireEvent.change(screen.getByLabelText("Bulk work stream"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply to selected" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByLabelText("Select this page"));
    expect(screen.getByText("3 selected across pages")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Select this page"));
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(screen.getByLabelText("Work stream for P-1")).toHaveValue("1");
    fireEvent.click(screen.getByLabelText("Select P-1"));
    fireEvent.click(screen.getByLabelText("Select this page"));
    fireEvent.change(screen.getByLabelText("Bulk work stream"), { target: { value: "unmapped" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply to selected" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.getByText("0 selected across pages")).toBeInTheDocument();
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
    expect(window.dispatchEvent(new Event("tb-before-navigation", { cancelable: true }))).toBe(true);
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
    fireEvent.keyDown(screen.getByRole("tab", { name: "Initiative Metadata" }), { key: "End" });
    await screen.findByLabelText("Work stream for P-1"); edit();
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

it("resets pagination and keeps native sort controls focusable", async () => {
  mockInventory([...epics, ...Array.from({ length: 50 }, (_, i) => ({ epicKey: `X-${i}`, title: `Extra ${i}`, status: "Open", workStreamId: null }))]);
  await renderTab();
  fireEvent.click(screen.getByLabelText("Select P-1"));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  const header = screen.getByRole("button", { name: "Sort by Epic key" });
  expect(header).toHaveAttribute("type", "button");
  header.focus(); expect(header).toHaveFocus();
  fireEvent.click(header);
  expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
  expect(screen.getByLabelText("Select P-1")).toBeChecked();
  expect(screen.getByRole("columnheader", { name: /Epic key/ })).toHaveAttribute("aria-sort", "ascending");
});
