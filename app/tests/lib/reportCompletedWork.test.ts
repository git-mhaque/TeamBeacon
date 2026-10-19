import { describe, expect, it } from "vitest";
import { groupCompletedWorkByEpic, groupCompletedWork, reportJiraIssueUrl, type CompletedWorkSource } from "../../src/lib/reportCompletedWork";

const sources: CompletedWorkSource[] = [
  { cardId: "card-1", group: "Platform", epicKey: "P-1", epicName: "Search", issueKey: "P-2", issueTitle: "Fix timeout" },
  { cardId: "card-2", group: "Security", epicKey: "P-3", epicName: "Security", issueKey: "P-4", issueTitle: "Patch dependency" },
  { cardId: "card-3", group: "Platform", epicKey: "P-1", epicName: "Search", issueKey: "P-5", issueTitle: "Add index" },
];

describe("completed work sources", () => {
  it("groups interleaved bullets by epic key, preserving epic and issue order", () => {
    const bullets = sources.map((source) => ({ text: source.issueTitle, source }));
    const sameNameDifferentEpic = { text: "Separate epic", source: { ...sources[0], epicKey: "P-99" } };
    expect(groupCompletedWorkByEpic([...bullets, sameNameDifferentEpic])).toEqual([
      { epicKey: "P-1", epicName: "Search", bullets: [bullets[0], bullets[2]] },
      { epicKey: "P-3", epicName: "Security", bullets: [bullets[1]] },
      { epicKey: "P-99", epicName: "Search", bullets: [sameNameDifferentEpic] },
    ]);
  });

  it("keeps source-free notices visible without inventing epic headings", () => {
    const bullets = [{ text: "No completed cards" }, { text: "Unavailable" }];
    expect(groupCompletedWorkByEpic(bullets)).toEqual([{ epicKey: null, epicName: "", bullets }]);
    expect(groupCompletedWorkByEpic([])).toEqual([]);
  });

  it("groups original titles by source work stream without rewriting or clipping", () => {
    const result = groupCompletedWork(sources);
    expect(result).toEqual([
      { group: "Platform", bullets: [{ text: "Fix timeout", source: sources[0] }, { text: "Add index", source: sources[2] }] },
      { group: "Security", bullets: [{ text: "Patch dependency", source: sources[1] }] },
    ]);
  });

  it("handles empty input and missing titles deterministically", () => {
    expect(groupCompletedWork([])).toEqual([]);
    expect(groupCompletedWork([{ ...sources[0], issueTitle: "  " }])[0].bullets[0].text).toBe("No summary provided.");
    const title = "Keep the complete issue title including P-123 and its details " .repeat(5).trim();
    expect(groupCompletedWork([{ ...sources[0], issueTitle: title }])[0].bullets[0].text).toBe(title);
  });

  it("constructs encoded issue links only for valid HTTP(S) configurations", () => {
    expect(reportJiraIssueUrl("https://jira.example.com/jira/", "P-2")).toBe("https://jira.example.com/jira/browse/P-2");
    expect(reportJiraIssueUrl("http://localhost:8000", 'P-2/"')).toBe("http://localhost:8000/browse/P-2%2F%22");
    expect(reportJiraIssueUrl(null, "P-2")).toBeNull();
    expect(reportJiraIssueUrl("https://jira.example.com", " ")).toBeNull();
    expect(reportJiraIssueUrl("javascript:alert(1)", "P-2")).toBeNull();
    expect(reportJiraIssueUrl("not a URL", "P-2")).toBeNull();
  });
});
