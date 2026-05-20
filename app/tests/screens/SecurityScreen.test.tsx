import { render, screen } from "@testing-library/preact";
import { SecurityScreen } from "../../src/components/content/screens/SecurityScreen";

describe("SecurityScreen", () => {
  it("renders a construction empty state", () => {
    render(<SecurityScreen />);

    expect(screen.getByLabelText("Security Insights under construction")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Under construction" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Security Posture Snapshot" })).not.toBeInTheDocument();
  });
});
