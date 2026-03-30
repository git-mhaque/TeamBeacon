import { render, screen } from "@testing-library/preact";
import { IncidentResponseScreen } from "../../src/components/content/screens/IncidentResponseScreen";

describe("IncidentResponseScreen", () => {
  it("renders incident operations baseline metrics", () => {
    render(<IncidentResponseScreen />);

    expect(screen.getByRole("heading", { name: "Incident Operations" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Active Incidents" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "SLA Breaches" })).toBeInTheDocument();
    expect(screen.getByText(/response latency/i)).toBeInTheDocument();
  });
});
