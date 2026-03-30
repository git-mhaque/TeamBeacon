import { render, screen } from "@testing-library/preact";
import { IndividualsScreen } from "../../src/components/content/screens/IndividualsScreen";

describe("IndividualsScreen", () => {
  it("renders individual activity metrics and timeline items", () => {
    render(<IndividualsScreen />);

    expect(screen.getByRole("heading", { name: "Individual Activity" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Completed (7d)" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Recent Work Timeline" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Manager Insight" })).toBeInTheDocument();
    expect(screen.getByText("CEG-8451 Closed - API idempotency fix")).toBeInTheDocument();
  });
});
