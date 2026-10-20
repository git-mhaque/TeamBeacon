import { fireEvent, render, screen, within } from "@testing-library/react";
import { PlannerOverview } from "../../src/components/content/screens/PlannerOverview";
import { newPlan, type DeliveryPlan } from "../../src/lib/planner";

const plan = (id: number, changes: Partial<DeliveryPlan> = {}): DeliveryPlan => ({
  ...newPlan(), id, name: `Plan ${id}`, version: 1, createdAt: "2026-10-01", updatedAt: `2026-10-0${id}`,
  metrics: { available: true, completionPercent: 50, totalCards: 10, completedCards: 5 },
  warnings: [], baseline: null, scopeChange: null, ...changes,
});
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const names = () => screen.getAllByRole("link").map(link => link.textContent);

describe("Planner overview", () => {
  it("counts plans by lifecycle and warns only on active plans, with clickable summary filters", () => {
    const plans = [plan(1, { status: "active", warnings: ["Missing dates", "Overlap"] }),
      plan(2, { status: "active" }), plan(3, { warnings: ["Draft warning"] }),
      plan(4, { status: "completed" }), plan(5, { status: "archived", warnings: ["Old warning"] })];
    render(<PlannerOverview plans={plans} onOpen={vi.fn()} />);
    const summary = screen.getByRole("group", { name: "All plans summary" });
    expect(within(summary).getByRole("button", { name: /Active plans 2/ })).toBeInTheDocument();
    expect(within(summary).getByRole("button", { name: /Draft plans 1/ })).toBeInTheDocument();
    expect(within(summary).getByRole("button", { name: /Needs attention 1/ })).toBeInTheDocument();
    expect(names()).toEqual(["Plan 4", "Plan 3", "Plan 2", "Plan 1"]);
    click(/Needs attention 1/); expect(names()).toEqual(["Plan 1"]);
    expect(screen.getByText("2 warnings")).toBeInTheDocument();
    click(/Needs attention 1/); expect(names()).toHaveLength(4);
    click(/Active plans 2/); expect(names()).toEqual(["Plan 2", "Plan 1"]);
    click(/Draft plans 1/); expect(names()).toEqual(["Plan 3"]);
    expect(screen.getByText("1 warning")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Plan status"), { target: { value: "archived" } });
    expect(names()).toEqual(["Plan 5"]);
    click("Clear filters"); expect(names()).toHaveLength(4);
  });

  it("searches names, owners and objectives, explains no matches and clears filters", () => {
    render(<PlannerOverview plans={[plan(1, { owner: "Alex", objective: "Customer portal" }), plan(2)]} onOpen={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Search plans"), { target: { value: " ALEX " } });
    expect(names()).toEqual(["Plan 1"]);
    fireEvent.change(screen.getByLabelText("Search plans"), { target: { value: "portal" } });
    expect(names()).toEqual(["Plan 1"]);
    fireEvent.change(screen.getByLabelText("Search plans"), { target: { value: "missing" } });
    expect(screen.getByRole("status")).toHaveTextContent("No matching plans");
    click("Clear filters"); expect(names()).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeDisabled();
  });

  it("sorts the table with missing dates and unknown progress last in either direction", () => {
    render(<PlannerOverview plans={[
      plan(1, { name: "Zulu", targetDate: "2026-11-01" }),
      plan(2, { name: "Alpha", targetDate: "2026-12-01", metrics: { available: true, completionPercent: 20, totalCards: 10, completedCards: 2 } }),
      plan(3, { metrics: { available: false, completionPercent: null, totalCards: 0, completedCards: 0 } }),
      plan(4, { metrics: { available: true, completionPercent: null, totalCards: 0, completedCards: 0 } }),
    ]} onOpen={vi.fn()} />);
    expect(screen.getByText("No cards")).toBeInTheDocument();
    expect(screen.getByText("Source data incomplete")).toBeInTheDocument();
    expect(screen.getAllByRole("progressbar")).toHaveLength(2);
    click("Plan"); expect(names()).toEqual(["Alpha", "Plan 3", "Plan 4", "Zulu"]);
    click("Plan"); expect(names()).toEqual(["Zulu", "Plan 4", "Plan 3", "Alpha"]);
    click("Target"); expect(names().slice(0, 2)).toEqual(["Zulu", "Alpha"]);
    click("Target"); expect(names().slice(0, 2)).toEqual(["Alpha", "Zulu"]);
    click("Scope progress"); expect(names().slice(0, 2)).toEqual(["Alpha", "Zulu"]);
    click("Scope progress"); expect(names().slice(0, 2)).toEqual(["Zulu", "Alpha"]);
    click("Updated"); expect(names()[0]).toBe("Plan 4");
    click("Updated"); expect(names()[0]).toBe("Zulu");
  });

  it("opens from a row or accessible plan link and preserves modified link clicks", () => {
    const onOpen = vi.fn();
    const first = plan(1);
    render(<PlannerOverview plans={[first, plan(2, { updatedAt: first.updatedAt })]} onOpen={onOpen} />);
    expect(names()).toEqual(["Plan 1", "Plan 2"]);
    const link = screen.getByRole("link", { name: "Plan 1" });
    expect(link).toHaveAttribute("href", "#planner/1");
    fireEvent.click(link);
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(first);
    const row = link.closest("tr")!;
    fireEvent.click(within(row).getByText("No owner"));
    expect(onOpen).toHaveBeenCalledTimes(2);
    fireEvent.click(row, { ctrlKey: true });
    // Prevent jsdom from following the link; its click remains available to the browser.
    link.addEventListener("click", event => event.preventDefault(), { once: true });
    fireEvent.click(link, { ctrlKey: true });
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(link).toHaveFocus();
  });
});
