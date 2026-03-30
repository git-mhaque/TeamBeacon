import { render, screen } from "@testing-library/preact";
import { TeamInsightsScreen } from "../../src/components/content/screens/TeamInsightsScreen";

describe("TeamInsightsScreen", () => {
  it("renders team metrics, trend bars, and work-mix summary", () => {
    render(<TeamInsightsScreen />);

    expect(screen.getByRole("heading", { name: "Sprint Performance (Last 6 Sprints)" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Avg Committed" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sprint Trend Bars" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Work Mix and Capacity Signal" })).toBeInTheDocument();
    expect(screen.getByText(/feature 58%/i)).toBeInTheDocument();
  });
});
