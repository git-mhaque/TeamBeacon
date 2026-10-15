import { describe, expect, it } from "vitest";
import { groupCompletedWorkByEpic, groupCompletedWork, reportJiraIssueUrl, type CompletedWorkSource } from "../../src/lib/reportCompletedWork";

const sources: CompletedWorkSource[] = [
  { cardId: "card-1", group: "Platform", epicKey: "P-1", epicName: "Search", issueKey: "P-2", issueTitle: "Fix timeout", fallbackText: "Fixed timeout" },
  { cardId: "card-2", group: "Security", epicKey: "P-3", epicName: "Security", issueKey: "P-4", issueTitle: "Patch dependency", fallbackText: "Patched dependency" },
  { cardId: "card-3", group: "Platform", epicKey: "P-1", epicName: "Search", issueKey: "P-5", issueTitle: "Add index", fallbackText: "Added index" },
];

describe("completed work sources", () => {
  it("groups interleaved bullets by epic key, preserving epic and issue order", () => {
    const bullets = sources.map((source) => ({ text: source.fallbackText, source }));
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

  it("matches reordered AI bullets by ID and groups using the source work stream", () => {
    const result = groupCompletedWork(sources, [
      { cardId: "card-3", text: "Improved indexing" },
      { cardId: "card-1", text: "Improved reliability" },
      { cardId: "card-2", text: "Strengthened security" },
    ]);
    expect(result).toEqual([
      { group: "Platform", bullets: [{ text: "Improved reliability", source: sources[0] }, { text: "Improved indexing", source: sources[2] }] },
      { group: "Security", bullets: [{ text: "Strengthened security", source: sources[1] }] },
    ]);
  });

  it("ignores missing, invented, duplicate and empty AI references and falls back to the source outcome", () => {
    const result = groupCompletedWork(sources, [
      { cardId: undefined, text: "Untraceable" },
      { cardId: "invented", text: "Unknown" },
      { cardId: "card-1", text: "First outcome" },
      { cardId: "card-1", text: "Duplicate" },
      { cardId: "card-2", text: "  " },
    ]);
    expect(result[0].bullets).toEqual([{ text: "First outcome", source: sources[0] }, { text: "Added index", source: sources[2] }]);
    expect(result[1].bullets).toEqual([{ text: "Patched dependency", source: sources[1] }]);
    expect(groupCompletedWork([], [])).toEqual([]);
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
