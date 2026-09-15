import { describe, expect, it } from "vitest";
import { formatDisplayTimestamp } from "../../src/lib/dateTime";

describe("formatDisplayTimestamp", () => {
  it("uses the shared day-month-year timestamp format without seconds", () => {
    expect(formatDisplayTimestamp("2026-09-14T16:40:39")).toBe("14-Sep-2026, 4:40 PM");
  });

  it("returns the caller fallback for missing or invalid timestamps", () => {
    expect(formatDisplayTimestamp(null, "Not generated yet")).toBe("Not generated yet");
    expect(formatDisplayTimestamp("not-a-date", "Not generated yet")).toBe("Not generated yet");
  });
});
