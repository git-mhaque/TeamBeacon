import { validateDateRange } from "../../src/components/content/DateRangeFields";

it.each(["invalid", "2026-02-30", "2026-1-01"])("rejects invalid dates: %s", (startDate) => {
  expect(validateDateRange({ startDate, endDate: "2026-08-01" })).toBe("Invalid reporting period date format.");
});
