import { describe, expect, it } from "vitest";
import { formatDisplayDate, formatDisplayTimestamp, formatRelativeTimestamp } from "../../src/lib/dateTime";

describe("formatDisplayDate", () => {
  it("formats creation dates with a padded day and abbreviated month", () => {
    expect(formatDisplayDate("2026-09-04T16:40:39")).toBe("04-Sep-2026");
  });
  it("uses the fallback for missing or invalid dates", () => {
    expect(formatDisplayDate(null)).toBe("Not available");
    expect(formatDisplayDate("invalid", "—")).toBe("—");
  });
});

describe("formatDisplayTimestamp", () => {
  it("uses the shared day-month-year timestamp format without seconds", () => {
    expect(formatDisplayTimestamp("2026-09-14T16:40:39")).toBe("14-Sep-2026, 4:40 PM");
  });

  it("returns the caller fallback for missing or invalid timestamps", () => {
    expect(formatDisplayTimestamp(null, "Not generated yet")).toBe("Not generated yet");
    expect(formatDisplayTimestamp("not-a-date", "Not generated yet")).toBe("Not generated yet");
  });
});

describe("formatRelativeTimestamp", () => {
  const now = Date.parse("2026-10-19T12:00:00Z");
  it.each([
    [undefined, "time unavailable"], ["bad", "time unavailable"],
    ["2026-10-19T12:00:00Z", "just now"], ["2026-10-20T12:00:00Z", "just now"],
    ["2026-10-19T11:58:00Z", "2 minutes ago"], ["2026-10-19T10:00:00Z", "2 hours ago"],
    ["2026-10-17T12:00:00Z", "2 days ago"],
  ])("formats %s", (value, expected) => {
    expect(formatRelativeTimestamp(value, now)).toBe(expected);
  });
});
