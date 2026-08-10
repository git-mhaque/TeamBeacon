import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IntegrationsScreen } from "../../src/components/content/screens/IntegrationsScreen";
import { setupFetchMock } from "../utils/fetchMock";

const lookupPayload = {
  groups: [{ id: 1, name: "Core Platform" }],
  workTypes: [{ id: 2, name: "Feature" }],
};

describe("IntegrationsScreen metadata settings", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows metadata settings without source-connection features and saves edits", async () => {
    const fetchSpy = setupFetchMock({
      "/api/metadata/lookup/groups/update": { id: 1, name: "Platform Core" },
      "/api/metadata/lookup/work-types/update": { id: 2, name: "Product Feature" },
      "/api/metadata/lookup/work-types": { id: 3, name: "Security" },
      "/api/metadata/lookup/groups": { id: 3, name: "Operations" },
      "/api/metadata/lookup": lookupPayload,
    });

    render(<IntegrationsScreen />);

    expect(await screen.findByRole("heading", { name: "Initiative Metadata" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Source Connections" })).not.toBeInTheDocument();
    expect(screen.queryByText("JIRA Connection")).not.toBeInTheDocument();

    const groupsCard = screen.getByRole("heading", { name: "Work Streams" }).closest("article") as HTMLElement;
    const workTypesCard = screen.getByRole("heading", { name: "Work Types" }).closest("article") as HTMLElement;

    fireEvent.click(within(groupsCard).getByRole("button", { name: "Add" }));
    expect(screen.getByText(/Work stream name is required/)).toBeInTheDocument();
    fireEvent.input(within(groupsCard).getByRole("textbox", { name: "Add work stream" }), { target: { value: "Operations" } });
    fireEvent.click(within(groupsCard).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(fetchSpy.mock.calls.some(([input, init]) => (
      String(input).endsWith("/api/metadata/lookup/groups") && init?.method === "POST"
    ))).toBe(true));

    fireEvent.click(within(groupsCard).getByRole("button", { name: "Edit" }));
    fireEvent.input(within(groupsCard).getByRole("textbox", { name: "Edit Core Platform" }), { target: { value: "Platform Core" } });
    fireEvent.click(within(groupsCard).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fetchSpy.mock.calls.some(([input]) => (
      String(input).endsWith("/api/metadata/lookup/groups/update")
    ))).toBe(true));

    fireEvent.input(within(workTypesCard).getByRole("textbox", { name: "Add work type" }), { target: { value: "Security" } });
    fireEvent.click(within(workTypesCard).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(fetchSpy.mock.calls.some(([input, init]) => (
      String(input).endsWith("/api/metadata/lookup/work-types") && init?.method === "POST"
    ))).toBe(true));
    fireEvent.click(within(workTypesCard).getByRole("button", { name: "Edit" }));
    fireEvent.input(within(workTypesCard).getByRole("textbox", { name: "Edit Feature" }), { target: { value: "Product Feature" } });
    fireEvent.click(within(workTypesCard).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fetchSpy.mock.calls.some(([input]) => (
      String(input).endsWith("/api/metadata/lookup/work-types/update")
    ))).toBe(true));
  });

  it("uses overlay confirmation before deleting metadata values", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    setupFetchMock({
      "/api/metadata/lookup/groups/delete": { id: 1, deleted: true },
      "/api/metadata/lookup": lookupPayload,
    });

    render(<IntegrationsScreen />);
    expect(await screen.findByText("Core Platform")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
    let dialog = screen.getByRole("dialog", { name: "Confirm Metadata Delete" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Confirm Metadata Delete" })).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
    dialog = screen.getByRole("dialog", { name: "Confirm Metadata Delete" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Confirm Metadata Delete" })).not.toBeInTheDocument());
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("reports metadata loading failures", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Metadata service unavailable"));
    render(<IntegrationsScreen />);
    expect(await screen.findByText(/Metadata service unavailable/)).toBeInTheDocument();
    expect(screen.getByText("No work streams")).toBeInTheDocument();
    expect(screen.getByText("No work types")).toBeInTheDocument();
  });

  it("validates blank metadata names and lets users cancel inline edits", async () => {
    setupFetchMock({ "/api/metadata/lookup": lookupPayload });
    render(<IntegrationsScreen />);
    expect(await screen.findByText("Core Platform")).toBeInTheDocument();

    const groupsCard = screen.getByRole("heading", { name: "Work Streams" }).closest("article") as HTMLElement;
    const workTypesCard = screen.getByRole("heading", { name: "Work Types" }).closest("article") as HTMLElement;
    fireEvent.click(within(workTypesCard).getByRole("button", { name: "Add" }));
    expect(screen.getByText(/Work type name is required/)).toBeInTheDocument();

    fireEvent.click(within(groupsCard).getByRole("button", { name: "Edit" }));
    fireEvent.input(within(groupsCard).getByRole("textbox", { name: "Edit Core Platform" }), { target: { value: " " } });
    fireEvent.click(within(groupsCard).getByRole("button", { name: "Save" }));
    expect(screen.getByText(/Work stream name is required/)).toBeInTheDocument();
    fireEvent.click(within(groupsCard).getByRole("button", { name: "Cancel" }));

    fireEvent.click(within(workTypesCard).getByRole("button", { name: "Edit" }));
    fireEvent.input(within(workTypesCard).getByRole("textbox", { name: "Edit Feature" }), { target: { value: " " } });
    fireEvent.click(within(workTypesCard).getByRole("button", { name: "Save" }));
    expect(screen.getByText(/Work type name is required/)).toBeInTheDocument();
    fireEvent.click(within(workTypesCard).getByRole("button", { name: "Cancel" }));
  });

  it("keeps metadata controls usable when mutation requests fail", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      const isLookupLoad = url.endsWith("/api/metadata/lookup") && (!init?.method || init.method === "GET");
      return Promise.resolve(new Response(JSON.stringify(isLookupLoad ? lookupPayload : { detail: "Metadata mutation failed" }), {
        status: isLookupLoad ? 200 : 500,
        headers: { "Content-Type": "application/json" },
      }));
    });

    render(<IntegrationsScreen />);
    expect(await screen.findByText("Core Platform")).toBeInTheDocument();
    const groupsCard = screen.getByRole("heading", { name: "Work Streams" }).closest("article") as HTMLElement;
    const workTypesCard = screen.getByRole("heading", { name: "Work Types" }).closest("article") as HTMLElement;

    fireEvent.input(within(groupsCard).getByRole("textbox", { name: "Add work stream" }), { target: { value: "Operations" } });
    fireEvent.click(within(groupsCard).getByRole("button", { name: "Add" }));
    expect(await screen.findByText(/Metadata mutation failed/)).toBeInTheDocument();

    fireEvent.input(within(workTypesCard).getByRole("textbox", { name: "Add work type" }), { target: { value: "Security" } });
    fireEvent.click(within(workTypesCard).getByRole("button", { name: "Add" }));
    expect(await screen.findByText(/Metadata mutation failed/)).toBeInTheDocument();

    fireEvent.click(within(groupsCard).getByRole("button", { name: "Edit" }));
    fireEvent.input(within(groupsCard).getByRole("textbox", { name: "Edit Core Platform" }), { target: { value: "Platform" } });
    fireEvent.click(within(groupsCard).getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/Metadata mutation failed/)).toBeInTheDocument();
    fireEvent.click(within(groupsCard).getByRole("button", { name: "Cancel" }));

    fireEvent.click(within(workTypesCard).getByRole("button", { name: "Edit" }));
    fireEvent.input(within(workTypesCard).getByRole("textbox", { name: "Edit Feature" }), { target: { value: "Product" } });
    fireEvent.click(within(workTypesCard).getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/Metadata mutation failed/)).toBeInTheDocument();
    fireEvent.click(within(workTypesCard).getByRole("button", { name: "Cancel" }));

    fireEvent.click(within(workTypesCard).getByRole("button", { name: "Delete" }));
    let dialog = screen.getByRole("dialog", { name: "Confirm Metadata Delete" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText(/Metadata mutation failed/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));

    fireEvent.click(within(groupsCard).getByRole("button", { name: "Delete" }));
    dialog = screen.getByRole("dialog", { name: "Confirm Metadata Delete" });
    fireEvent.click(dialog.querySelector(".tb-modal-backdrop") as HTMLElement);
    expect(screen.queryByRole("dialog", { name: "Confirm Metadata Delete" })).not.toBeInTheDocument();
  });

  it("uses safe fallback messages for non-Error metadata failures", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      const isLookupLoad = url.endsWith("/api/metadata/lookup") && (!init?.method || init.method === "GET");
      if (!isLookupLoad) return Promise.reject("metadata rejected");
      return Promise.resolve(new Response(JSON.stringify(lookupPayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    });

    const { unmount } = render(<IntegrationsScreen />);
    expect(await screen.findByText("Core Platform")).toBeInTheDocument();
    const groupsCard = screen.getByRole("heading", { name: "Work Streams" }).closest("article") as HTMLElement;
    const workTypesCard = screen.getByRole("heading", { name: "Work Types" }).closest("article") as HTMLElement;

    fireEvent.input(within(groupsCard).getByRole("textbox", { name: "Add work stream" }), { target: { value: "Operations" } });
    fireEvent.click(within(groupsCard).getByRole("button", { name: "Add" }));
    expect(await screen.findByText(/Failed to save work stream/)).toBeInTheDocument();
    fireEvent.input(within(workTypesCard).getByRole("textbox", { name: "Add work type" }), { target: { value: "Security" } });
    fireEvent.click(within(workTypesCard).getByRole("button", { name: "Add" }));
    expect(await screen.findByText(/Failed to save work type/)).toBeInTheDocument();

    fireEvent.click(within(groupsCard).getByRole("button", { name: "Edit" }));
    fireEvent.input(within(groupsCard).getByRole("textbox", { name: "Edit Core Platform" }), { target: { value: "Platform" } });
    fireEvent.click(within(groupsCard).getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/Failed to update work stream/)).toBeInTheDocument();
    fireEvent.click(within(groupsCard).getByRole("button", { name: "Cancel" }));

    fireEvent.click(within(workTypesCard).getByRole("button", { name: "Edit" }));
    fireEvent.input(within(workTypesCard).getByRole("textbox", { name: "Edit Feature" }), { target: { value: "Product" } });
    fireEvent.click(within(workTypesCard).getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/Failed to update work type/)).toBeInTheDocument();
    fireEvent.click(within(workTypesCard).getByRole("button", { name: "Cancel" }));

    fireEvent.click(within(groupsCard).getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog", { name: "Confirm Metadata Delete" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText(/Failed to delete metadata value/)).toBeInTheDocument();

    unmount();
    fetchSpy.mockRestore();
    vi.spyOn(globalThis, "fetch").mockRejectedValue("lookup rejected");
    render(<IntegrationsScreen />);
    expect(await screen.findByText(/Unknown epic metadata failure/)).toBeInTheDocument();
  });

  it("clears matching inline edit state after successful group and work-type deletion", async () => {
    setupFetchMock({
      "/api/metadata/lookup/groups/delete": { id: 1, deleted: true },
      "/api/metadata/lookup/work-types/delete": { id: 2, deleted: true },
      "/api/metadata/lookup": lookupPayload,
    });
    render(<IntegrationsScreen />);
    expect(await screen.findByText("Core Platform")).toBeInTheDocument();
    const groupsCard = screen.getByRole("heading", { name: "Work Streams" }).closest("article") as HTMLElement;
    const workTypesCard = screen.getByRole("heading", { name: "Work Types" }).closest("article") as HTMLElement;

    const groupEdit = within(groupsCard).getByRole("button", { name: "Edit" });
    fireEvent.click(within(groupsCard).getByRole("button", { name: "Delete" }));
    fireEvent.click(groupEdit);
    let dialog = screen.getByRole("dialog", { name: "Confirm Metadata Delete" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Confirm Metadata Delete" })).not.toBeInTheDocument());
    expect(within(groupsCard).queryByRole("textbox", { name: "Edit Core Platform" })).not.toBeInTheDocument();

    const workTypeEdit = within(workTypesCard).getByRole("button", { name: "Edit" });
    fireEvent.click(within(workTypesCard).getByRole("button", { name: "Delete" }));
    fireEvent.click(workTypeEdit);
    dialog = screen.getByRole("dialog", { name: "Confirm Metadata Delete" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Confirm Metadata Delete" })).not.toBeInTheDocument());
    expect(within(workTypesCard).queryByRole("textbox", { name: "Edit Feature" })).not.toBeInTheDocument();
  });
});
