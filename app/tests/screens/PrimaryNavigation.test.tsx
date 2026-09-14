import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { PrimaryNavigation } from "../../src/components/content/PrimaryNavigation";

afterEach(() => vi.useRealTimers());

describe("PrimaryNavigation", () => {
  it("keeps short labels, full accessible names and destination order in the compact rail", () => {
    const onNavigate = vi.fn();
    const { rerender } = render(<PrimaryNavigation active="dashboard" isExpanded={false} onNavigate={onNavigate} />);
    const nav = screen.getByRole("navigation", { name: "Primary navigation" });
    const buttons = within(nav).getAllByRole("button");
    expect(buttons.map(button => button.querySelector(".tb-nav-short-label")?.textContent)).toEqual([
      "Dashboard", "Initiatives", "Deep dive", "Sprints", "Team", "Security", "Operations", "Releases", "Report", "Settings",
    ]);
    expect(buttons[0]).toHaveAttribute("aria-current", "page");
    expect(buttons.filter(button => button.hasAttribute("aria-current"))).toHaveLength(1);
    const deepDive = within(nav).getByRole("button", { name: /Initiative Deep Dive: New, active & completed work/ });
    fireEvent.click(deepDive);
    expect(onNavigate).toHaveBeenCalledWith("initiative-deep-dive");
    rerender(<PrimaryNavigation active="initiative-deep-dive" isExpanded onNavigate={onNavigate} />);
    expect(deepDive).toHaveAttribute("aria-current", "page");
    expect(buttons[0]).not.toHaveAttribute("aria-current");
    const settings = within(nav).getByRole("button", { name: /Settings: Work streams & configuration/ });
    expect(settings.closest(".tb-nav-footer")).not.toBeNull();
    fireEvent.click(settings);
    expect(onNavigate).toHaveBeenLastCalledWith("integrations");
  });

  it("identifies only Security and Operations as under construction and keeps them navigable", () => {
    const onNavigate = vi.fn();
    render(<PrimaryNavigation active="security" isExpanded onNavigate={onNavigate} />);
    const constructionButtons = screen.getAllByRole("button", { name: /under construction/ });
    expect(constructionButtons).toHaveLength(2);
    expect(constructionButtons[0]).toHaveAccessibleName(/Security Insights/);
    expect(constructionButtons[1]).toHaveAccessibleName(/Operations Insights/);
    for (const button of constructionButtons) {
      expect(within(button).getByText("Under construction")).toBeInTheDocument();
      expect(button).toBeEnabled();
      fireEvent.click(button);
    }
    expect(onNavigate.mock.calls).toEqual([["security"], ["incidents"]]);
  });

  it("shows full details on keyboard focus and dismisses with Escape without moving focus", () => {
    render(<PrimaryNavigation active="dashboard" isExpanded={false} onNavigate={vi.fn()} />);
    const button = screen.getByRole("button", { name: /Security Insights/ });
    act(() => button.focus());
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("Security Insights");
    expect(tooltip).toHaveTextContent("Vulnerability posture");
    expect(tooltip).toHaveTextContent("Under construction");
    expect(button).toHaveAttribute("aria-describedby", tooltip.id);
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(tooltip).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
    expect(button).not.toHaveAttribute("aria-describedby");
  });

  it("allows the pointer to move onto a tooltip before closing it on leave", () => {
    vi.useFakeTimers();
    render(<PrimaryNavigation active="dashboard" isExpanded={false} onNavigate={vi.fn()} />);
    const button = screen.getByRole("button", { name: /Initiative Deep Dive/ });
    fireEvent.pointerEnter(button);
    expect(screen.getByRole("tooltip")).toHaveTextContent("New, active & completed work");
    fireEvent.pointerLeave(button);
    const tooltipLayer = screen.getByRole("tooltip").parentElement!;
    fireEvent.pointerEnter(tooltipLayer);
    act(() => vi.advanceTimersByTime(150));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.pointerLeave(tooltipLayer);
    act(() => vi.advanceTimersByTime(150));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("keeps focused details open when the pointer leaves, then closes on blur", () => {
    vi.useFakeTimers();
    render(<PrimaryNavigation active="dashboard" isExpanded={false} onNavigate={vi.fn()} />);
    const button = screen.getByRole("button", { name: /Team Dashboard/ });
    act(() => button.focus());
    fireEvent.pointerLeave(button);
    fireEvent.pointerLeave(screen.getByRole("tooltip").parentElement!);
    act(() => vi.advanceTimersByTime(150));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    act(() => button.blur());
    act(() => vi.advanceTimersByTime(150));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("does not open hover details for touch input or in the expanded sidebar", () => {
    const onNavigate = vi.fn();
    const { rerender } = render(<PrimaryNavigation active="dashboard" isExpanded={false} onNavigate={onNavigate} />);
    const button = screen.getByRole("button", { name: /Team Dashboard/ });
    const pointerEvent = new Event("pointerover", { bubbles: true });
    Object.defineProperty(pointerEvent, "pointerType", { value: "touch" });
    fireEvent(button, pointerEvent);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.pointerEnter(button);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    rerender(<PrimaryNavigation active="dashboard" isExpanded onNavigate={onNavigate} />);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.pointerEnter(button);
    fireEvent.focus(button);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    rerender(<PrimaryNavigation active="dashboard" isExpanded={false} onNavigate={onNavigate} />);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("dismisses detached tooltip positions after navigation, scrolling or resizing", () => {
    const onNavigate = vi.fn();
    const { unmount } = render(<PrimaryNavigation active="dashboard" isExpanded={false} onNavigate={onNavigate} />);
    const button = screen.getByRole("button", { name: /Team Dashboard/ });
    fireEvent.pointerEnter(button);
    fireEvent.scroll(button.closest(".tb-nav-list")!);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.pointerEnter(button);
    fireEvent.resize(window);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.pointerEnter(button);
    fireEvent.click(button);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(onNavigate).toHaveBeenCalledWith("dashboard");
    fireEvent.pointerEnter(button);
    unmount();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
