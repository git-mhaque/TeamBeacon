import { describe, expect, it } from "vitest";
import { readReportInitiativeSelection as read, resolveReportInitiativeSelection as resolve } from "../../src/lib/reportInitiativeSelection";

const rows = [{ epicKey: "A", completedInPeriodValue: 0 }, { epicKey: "B", completedInPeriodValue: 2 }, { epicKey: "C", completedInPeriodValue: 1 }];
describe("report initiative selection", () => {
  it("reads legacy arrays, preserves explicit empty selections and validates preferences", () => {
    expect(read('["A",42,"A"]')).toEqual({ mode: "manual", keys: ["A"] });
    expect(read('[]')).toEqual({ mode: "manual", keys: [] });
    expect(read('{"mode":"automatic","keys":["B",42,"B"]}')).toEqual({ mode: "automatic", keys: ["B"] });
    expect(read('{"mode":"manual","keys":[]}')).toEqual({ mode: "manual", keys: [] });
    for (const raw of [null, "", "invalid", "null", "42", "{}", '{"mode":"other","keys":[]}', '{"mode":"manual","keys":42}', '{"mode":"manual"}']) expect(read(raw)).toBeNull();
  });
  it("selects only period completions and preserves order while adding newly qualifying epics", () => {
    expect(resolve(rows, ["C", "A", "C", "gone"], "automatic")).toEqual(["C", "B"]);
    expect(resolve(rows, ["C", "A", "C", "gone"], "manual")).toEqual(["C", "A"]);
    expect(resolve(rows, [], "manual")).toEqual([]);
    expect(resolve(rows.map((row) => ({ ...row, completedInPeriodValue: 0 })), ["B"], "automatic")).toEqual([]);
    expect(resolve(rows, [], "automatic")).toEqual(["B", "C"]);
    expect(resolve([], ["B"], "automatic")).toEqual([]);
  });
});
