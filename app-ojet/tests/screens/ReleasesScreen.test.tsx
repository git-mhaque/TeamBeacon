import { render, screen } from "@testing-library/preact";
import { ReleasesScreen } from "../../src/components/content/screens/ReleasesScreen";

describe("ReleasesScreen", () => {
  it("renders release health baseline metrics", () => {
    render(<ReleasesScreen />);

    expect(screen.getByRole("heading", { name: "Release Health" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Deployments (30d)" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Rollback Rate" })).toBeInTheDocument();
    expect(screen.getByText(/change-failure rate/i)).toBeInTheDocument();
  });
});
