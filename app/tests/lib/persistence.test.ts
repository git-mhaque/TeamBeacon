import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getPreference,
  getPreferenceSync,
  removePreference,
  setPreference,
} from "../../src/lib/persistence";

describe("browser preference persistence", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as unknown as { localStorage?: Storage }).localStorage;
    vi.restoreAllMocks();
  });

  it("stores, reads, and removes preferences in local storage", async () => {
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: vi.fn((key: string) => values.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => values.set(key, value)),
        removeItem: vi.fn((key: string) => values.delete(key)),
      },
    });

    expect(getPreferenceSync("teambeacon.test")).toBeNull();
    expect(await getPreference("teambeacon.test")).toBeNull();

    await setPreference("teambeacon.test", "compact");

    expect(getPreferenceSync("teambeacon.test")).toBe("compact");
    expect(await getPreference("teambeacon.test")).toBe("compact");

    await removePreference("teambeacon.test");

    expect(getPreferenceSync("teambeacon.test")).toBeNull();
  });

  it("treats unavailable local storage as best-effort persistence", async () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: vi.fn(() => {
          throw new Error("storage unavailable");
        }),
        setItem: vi.fn(() => {
          throw new Error("storage unavailable");
        }),
        removeItem: vi.fn(() => {
          throw new Error("storage unavailable");
        }),
      },
    });

    expect(getPreferenceSync("teambeacon.test")).toBeNull();
    await expect(setPreference("teambeacon.test", "compact")).resolves.toBeUndefined();
    await expect(removePreference("teambeacon.test")).resolves.toBeUndefined();
  });

  it("returns safely when no browser window is available", async () => {
    vi.stubGlobal("window", undefined);

    expect(getPreferenceSync("teambeacon.test")).toBeNull();
    expect(await getPreference("teambeacon.test")).toBeNull();
    await expect(setPreference("teambeacon.test", "compact")).resolves.toBeUndefined();
    await expect(removePreference("teambeacon.test")).resolves.toBeUndefined();
  });
});
