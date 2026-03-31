import { render, screen } from "@testing-library/preact";
import { SecurityScreen } from "../../src/components/content/screens/SecurityScreen";

describe("SecurityScreen", () => {
  it("renders the security snapshot and next-step panels", () => {
    render(<SecurityScreen />);

    expect(screen.getByRole("heading", { name: "Security Posture Snapshot" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Open Vulnerabilities" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Next Step" })).toBeInTheDocument();
    expect(screen.getByText(/breach-risk forecasts/i)).toBeInTheDocument();
  });
});
