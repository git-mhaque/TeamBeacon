import { afterEach, describe, expect, it } from "vitest";
import {
  buildInitiativeSnapshotKey,
  clearInitiativeSnapshots,
  readInitiativeSnapshot,
  writeInitiativeSnapshot,
} from "../../src/lib/initiativeSnapshotCache";

afterEach(clearInitiativeSnapshots);

describe("initiative snapshot cache", () => {
  it("returns a matching snapshot for one day", () => {
    const key = buildInitiativeSnapshotKey({ periodStart: "2026-09-01", periodEnd: "2026-09-14", timezone: "Australia/Melbourne", viewId: "all" });
    writeInitiativeSnapshot(key, { total: 3 }, 100);
    expect(readInitiativeSnapshot<{ total: number }>(key, 100 + 24 * 60 * 60 * 1000 - 1)).toEqual({ total: 3 });
  });

  it("expires snapshots after one day", () => {
    writeInitiativeSnapshot("key", { total: 3 }, 100);
    expect(readInitiativeSnapshot("key", 100 + 24 * 60 * 60 * 1000)).toBeNull();
  });
});
