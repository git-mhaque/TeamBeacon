import { fireEvent, render, screen } from "@testing-library/preact";
import { ReleasesScreen } from "../../src/components/content/screens/ReleasesScreen";

describe("ReleasesScreen", () => {
  it("renders configure and refresh actions with configuration status", () => {
    render(<ReleasesScreen />);

    expect(screen.getByRole("heading", { name: "Release Configuration" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Configure" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Confluence Sources" })).toBeInTheDocument();
    expect(screen.getByText("Configuration Needed")).toBeInTheDocument();
  });

  it("opens configuration overlay and saves source and prompt data", () => {
    render(<ReleasesScreen />);

    fireEvent.click(screen.getByRole("button", { name: "Configure" }));
    expect(screen.getByRole("dialog", { name: "Configure Release Insights" })).toBeInTheDocument();

    const sourceUrlInput = screen.getByRole("textbox", { name: "Confluence Page URL" }) as HTMLInputElement;
    const sourcePromptInput = screen.getByRole("textbox", { name: "Source Prompt" }) as HTMLTextAreaElement;
    const overallPromptInput = screen.getByRole("textbox", { name: "Overall Prompt" }) as HTMLTextAreaElement;

    fireEvent.input(sourceUrlInput, { target: { value: "https://gbuconfluence.oraclecorp.com/display/SEN/Release+Notes" } });
    fireEvent.input(sourcePromptInput, { target: { value: "Summarize release scope and risks." } });
    fireEvent.input(overallPromptInput, { target: { value: "Generate release highlights for engineering leaders." } });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.queryByRole("dialog", { name: "Configure Release Insights" })).not.toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "https://gbuconfluence.oraclecorp.com/display/SEN/Release+Notes" })).toBeInTheDocument();
    expect(screen.getByText(/Summarize release scope and risks/i)).toBeInTheDocument();
    expect(screen.getByText(/Generate release highlights for engineering leaders/i)).toBeInTheDocument();
  });
});
