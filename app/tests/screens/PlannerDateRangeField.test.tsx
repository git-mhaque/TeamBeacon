import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlannerDateRangeField } from "../../src/components/content/screens/PlannerDateRangeField";

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const day = (name: string) => screen.getByRole("button", { name: new RegExp(`, ${name}$`) });
const key = (value: string) => fireEvent.keyDown(document.activeElement!, { key: value });
function open(startDate: string | null = null, endDate: string | null = null) {
  const onChange = vi.fn();
  render(<PlannerDateRangeField startDate={startDate} endDate={endDate} onChange={onChange} />);
  const trigger = screen.getByRole("button", { name: /^Planned dates:/ });
  trigger.focus(); fireEvent.click(trigger);
  return { onChange, trigger };
}

describe("Planner date range picker", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("selects a range across two visible months and applies both dates together", () => {
    const { onChange, trigger } = open();
    expect(screen.getByRole("region", { name: "October 2026" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "November 2026" })).toBeInTheDocument();
    expect(day("20 October 2026")).toHaveFocus();
    expect(day("20 October 2026")).toHaveAttribute("aria-current", "date");
    click(/, 28 October 2026$/);
    fireEvent.mouseEnter(day("5 November 2026"));
    expect(day("31 October 2026")).toHaveClass("is-in-range");
    fireEvent.mouseLeave(day("31 October 2026").closest(".tb-planner-calendar-months")!);
    expect(day("31 October 2026")).not.toHaveClass("is-in-range");
    click(/, 5 November 2026$/);
    expect(day("28 October 2026")).toHaveAttribute("aria-pressed", "true");
    expect(day("5 November 2026")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent("9 calendar days");
    expect(onChange).not.toHaveBeenCalled();
    click("Apply dates");
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ startDate: "2026-10-28", endDate: "2026-11-05" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
  });

  it("keeps the original dates when cancelled, closed or dismissed with Escape", () => {
    const { onChange, trigger } = open("2026-12-01", "2026-12-12");
    click(/, 30 December 2026$/); click(/, 2 January 2027$/);
    expect(screen.getByRole("status")).toHaveTextContent("4 calendar days");
    click("Cancel"); fireEvent.click(trigger);
    expect(screen.getByRole("button", { name: "Planned start 1 Dec 2026" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Planned finish 12 Dec 2026" })).toBeInTheDocument();
    click("Close calendar"); fireEvent.click(trigger);
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("restarts at an earlier finish choice and allows a single-day schedule", () => {
    const { onChange } = open();
    click(/, 20 October 2026$/);
    fireEvent.mouseEnter(day("15 October 2026"));
    expect(day("16 October 2026")).not.toHaveClass("is-in-range");
    click(/, 15 October 2026$/);
    expect(screen.getByRole("button", { name: "Planned start 15 Oct 2026" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Choose a finish date");
    click(/, 15 October 2026$/);
    expect(screen.getByRole("status")).toHaveTextContent("1 calendar day ·");
    click("Apply dates");
    expect(onChange).toHaveBeenCalledWith({ startDate: "2026-10-15", endDate: "2026-10-15" });
  });

  it("clears a schedule only when applied", () => {
    const { onChange } = open("2026-10-01", "2026-10-10");
    click("Clear dates");
    expect(screen.getByRole("status")).toHaveTextContent("Select a start date");
    expect(onChange).not.toHaveBeenCalled();
    click("Apply dates");
    expect(onChange).toHaveBeenCalledWith({ startDate: null, endDate: null });
  });

  it("supports a start-only schedule and completes it on a later edit", () => {
    const { onChange, trigger } = open("2026-10-01");
    expect(screen.getByRole("button", { name: "Planned finish Not set" })).toHaveAttribute("aria-pressed", "true");
    click("Apply dates");
    expect(onChange).toHaveBeenLastCalledWith({ startDate: "2026-10-01", endDate: null });
    fireEvent.click(trigger); click(/, 10 October 2026$/); click("Apply dates");
    expect(onChange).toHaveBeenLastCalledWith({ startDate: "2026-10-01", endDate: "2026-10-10" });
  });

  it("supports finish-only dates and explicitly choosing which endpoint to edit", () => {
    const { onChange, trigger } = open(null, "2026-11-12");
    expect(day("12 November 2026")).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("finish-only");
    click("Planned finish 12 Nov 2026"); click(/, 20 November 2026$/); click("Apply dates");
    expect(onChange).toHaveBeenLastCalledWith({ startDate: null, endDate: "2026-11-20" });
    fireEvent.click(trigger);
    click("Planned start Not set"); click(/, 5 November 2026$/); click(/, 12 November 2026$/);
    click("Planned finish 12 Nov 2026"); click(/, 15 November 2026$/); click("Apply dates");
    expect(onChange).toHaveBeenLastCalledWith({ startDate: "2026-11-05", endDate: "2026-11-15" });
  });

  it("navigates months and years, and returns to the current month", () => {
    open("2026-12-31");
    click("Next month");
    expect(screen.getByRole("region", { name: "January 2027" })).toBeInTheDocument();
    click("Previous month");
    expect(screen.getByRole("region", { name: "December 2026" })).toBeInTheDocument();
    click("This month");
    expect(screen.getByRole("region", { name: "October 2026" })).toBeInTheDocument();
    click("Previous month");
    expect(screen.getByRole("region", { name: "September 2026" })).toBeInTheDocument();
  });

  it("moves calendar focus with arrow, Home and End keys across month boundaries", () => {
    open("2026-12-31");
    key("ArrowRight"); expect(day("1 January 2027")).toHaveFocus();
    key("ArrowDown"); expect(day("8 January 2027")).toHaveFocus();
    key("Home"); expect(day("4 January 2027")).toHaveFocus();
    key("Home"); expect(day("4 January 2027")).toHaveFocus();
    key("End"); expect(day("10 January 2027")).toHaveFocus();
    key("ArrowUp"); expect(day("3 January 2027")).toHaveFocus();
    key("ArrowLeft"); expect(day("2 January 2027")).toHaveFocus();
    key("Tab"); expect(day("2 January 2027")).toHaveFocus();
    day("31 January 2027").focus(); key("ArrowRight");
    expect(day("1 February 2027")).toHaveFocus();
    key("ArrowLeft");
    expect(day("31 January 2027")).toHaveFocus();
  });

  it("renders leap day and counts the inclusive range correctly", () => {
    const { onChange } = open("2028-02-01", "2028-03-01");
    click(/, 29 February 2028$/); click(/, 1 March 2028$/); click("Apply dates");
    expect(onChange).toHaveBeenCalledWith({ startDate: "2028-02-29", endDate: "2028-03-01" });
  });
});
