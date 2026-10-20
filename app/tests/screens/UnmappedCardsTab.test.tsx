import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UnmappedCardsTab } from "../../src/components/content/screens/UnmappedCardsTab";
import { IntegrationsScreen } from "../../src/components/content/screens/IntegrationsScreen";
import type { UnmappedCard, UnmappedCardsInventory } from "../../src/lib/api";

const card = (index: number): UnmappedCard => ({
  issueKey: `P-${index}`, summary: `Task ${index}`, issueType: "Story", status: "Open", createdBy: "Alice",
  parentIssueKey: null, parentMissing: false, createdAt: "2026-10-20T01:00:00Z",
});
const inventory = (cards: UnmappedCard[]): UnmappedCardsInventory => ({ cards, count: cards.length, projectKey: "P", lastSyncedAt: "2026-10-20T02:00:00Z", jiraBaseUrl: "https://jira.example.test/" });
const mock = (data = inventory([card(1), { ...card(2), summary: "Child task", issueType: "Sub-task", status: "Closed", createdBy: null, parentIssueKey: "P-100", parentMissing: true, createdAt: null }])) =>
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => new Response(JSON.stringify(String(url).endsWith("/lookup") ? { groups: [], workTypes: [] } : data)));

describe("Unmapped cards", () => {
  afterEach(() => vi.restoreAllMocks());

  it("loads lazily as the third settings tab and provides safe card JIRA links and creation dates", async () => {
    const fetch = mock();
    render(<IntegrationsScreen />);
    expect(fetch.mock.calls.some(([url]) => String(url).endsWith("/unmapped-cards"))).toBe(false);
    fireEvent.click(screen.getByRole("tab", { name: "Unmapped cards" }));
    const link = await screen.findByRole("link", { name: "Open P-1 in JIRA (new tab)" });
    expect(link).toHaveAttribute("href", "https://jira.example.test/browse/P-1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.queryByRole("button", { name: "Sort by Parent card" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sort by Updated" })).not.toBeInTheDocument();
    expect(screen.getByText("20-Oct-2026")).toBeInTheDocument();
    expect(screen.getByText("Unknown")).toBeInTheDocument();
    expect(screen.getByText(/Changes appear after the next JIRA sync/)).toBeInTheDocument();
    expect(screen.getByText(/Last successful JIRA sync:/)).not.toHaveTextContent("Not available");
    fireEvent.change(screen.getByLabelText("Search unmapped cards"), { target: { value: "Child" } });
    fireEvent.click(screen.getByRole("tab", { name: "Initiative Metadata" }));
    fireEvent.click(screen.getByRole("tab", { name: "Unmapped cards" }));
    expect(screen.getByLabelText("Search unmapped cards")).toHaveValue("Child");
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith("/unmapped-cards"))).toHaveLength(1);
  });

  it("searches the complete inventory, filters, sorts and paginates without truncation", async () => {
    mock(inventory([...Array.from({ length: 101 }, (_, index) => card(index)), { ...card(999), issueType: null, status: "Done", createdBy: null, createdAt: "2026-10-21T00:00:00Z" }]));
    render(<UnmappedCardsTab />);
    await screen.findByText("102 of 102 unmapped cards");
    expect(screen.getAllByRole("row")).toHaveLength(101);
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    for (const label of ["Card", "Summary", "Type", "Status", "Created by", "Created on"]) {
      const sort = screen.getByRole("button", { name: `Sort by ${label}` });
      fireEvent.click(sort);
      expect(sort.closest("th")).toHaveAttribute("aria-sort", "ascending");
      fireEvent.click(sort);
      expect(sort.closest("th")).toHaveAttribute("aria-sort", "descending");
    }
    fireEvent.change(screen.getByLabelText("Search unmapped cards"), { target: { value: " P-0 " } });
    expect(screen.getByText("1 of 102 unmapped cards")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Card status"), { target: { value: "Done" } });
    expect(screen.getByText("No cards match these filters.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    fireEvent.change(screen.getByLabelText("Card type"), { target: { value: "Story" } });
    expect(screen.getByText("101 of 102 unmapped cards")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search unmapped cards"), { target: { value: "Alice" } });
    expect(screen.getByText("101 of 102 unmapped cards")).toBeInTheDocument();
  });

  it("keeps useful empty states and recovers from request failures", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ detail: "Inventory unavailable" }), { status: 500 }));
    render(<UnmappedCardsTab />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading unmapped cards");
    expect(screen.getByRole("button", { name: "Loading…" })).toBeDisabled();
    await screen.findByText("Inventory unavailable");
    fetch.mockImplementation(async () => new Response(JSON.stringify({ ...inventory([]), projectKey: null, lastSyncedAt: null, jiraBaseUrl: null })));
    fireEvent.click(screen.getByRole("button", { name: "Retry loading" }));
    await screen.findByText("No unmapped cards found in synced data.");
    expect(screen.getByText(/Last successful JIRA sync:/)).toHaveTextContent("Not available");
    expect(screen.getByText("Configure the JIRA base URL to enable card links.")).toBeInTheDocument();
    fetch.mockRejectedValueOnce("offline");
    fireEvent.click(screen.getByRole("button", { name: "Refresh list" }));
    await screen.findByText("Unable to load unmapped cards.");
  });

  it("refreshes after sync and keeps cards readable without a usable JIRA URL", async () => {
    const fetch = mock({ ...inventory([{ ...card(1), issueType: null, createdAt: null }]), jiraBaseUrl: "javascript:alert(1)" });
    render(<UnmappedCardsTab />);
    await screen.findByText("Task 1");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    fetch.mockImplementation(async () => new Response(JSON.stringify(inventory([]))));
    fireEvent.click(screen.getByRole("button", { name: "Refresh list" }));
    await screen.findByText("No unmapped cards found in synced data.");
    expect(screen.queryByText("Task 1")).not.toBeInTheDocument();
  });

  it("ignores responses after leaving settings", async () => {
    let resolve!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise<Response>((done) => { resolve = done; }));
    const view = render(<UnmappedCardsTab />);
    view.unmount();
    resolve(new Response(JSON.stringify(inventory([card(1)]))));
    await waitFor(() => expect(screen.queryByText("Task 1")).not.toBeInTheDocument());
  });

  it("uses current status and search filters independently of the dashboard flow period", async () => {
    mock(); render(<UnmappedCardsTab />);
    await screen.findByText("Child task");
    fireEvent.change(screen.getByLabelText("Card status"), { target: { value: "Closed" } });
    expect(screen.getByText("1 of 2 unmapped cards")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search unmapped cards"), { target: { value: "Child" } });
    expect(within(screen.getByRole("table")).getByText("Child task")).toBeInTheDocument();
    expect(screen.queryByText("Task 1")).not.toBeInTheDocument();
  });
});
