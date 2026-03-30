import { render, screen } from "@testing-library/preact";
import { PlaceholderScreen } from "../../src/components/content/screens/PlaceholderScreen";

describe("PlaceholderScreen", () => {
  it("renders heading and migration detail copy", () => {
    render(
      <PlaceholderScreen
        heading="Executive Report"
        detail="Migration in progress. OCI GenAI drafting integration is queued."
      />,
    );

    expect(screen.getByRole("heading", { name: "Executive Report" })).toBeInTheDocument();
    expect(screen.getByText(/OCI GenAI drafting integration is queued/i)).toBeInTheDocument();
    expect(screen.getByText("Migration in Progress")).toBeInTheDocument();
  });
});
