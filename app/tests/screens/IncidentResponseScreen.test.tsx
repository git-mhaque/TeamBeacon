import { render, screen } from "@testing-library/preact";
import { IncidentResponseScreen } from "../../src/components/content/screens/IncidentResponseScreen";

describe("IncidentResponseScreen", () => {
  it("renders a construction empty state", () => {
    render(<IncidentResponseScreen />);

    expect(screen.getByLabelText("Operations Insights under construction")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Under construction" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Incident Operations" })).not.toBeInTheDocument();
  });
});
