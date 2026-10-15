export type ReportSelectionMode = "manual" | "automatic";
export type ReportInitiativeSelection = { mode: ReportSelectionMode; keys: string[] };
type SelectionRow = { epicKey: string; completedInPeriodValue: number };

/** Accept existing key arrays and the new mode-aware preference. Empty is intentional. */
export function readReportInitiativeSelection(raw: string | null): ReportInitiativeSelection | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (Array.isArray(value)) return { mode: "manual", keys: [...new Set(value.filter((key): key is string => typeof key === "string"))] };
    if (!value || typeof value !== "object" || !("mode" in value) || !("keys" in value)) return null;
    if ((value.mode !== "manual" && value.mode !== "automatic") || !Array.isArray(value.keys)) return null;
    return { mode: value.mode, keys: [...new Set(value.keys.filter((key): key is string => typeof key === "string"))] };
  } catch {
    return null;
  }
}

/** Preserve custom order; automatic mode appends newly qualifying initiatives. */
export function resolveReportInitiativeSelection(rows: SelectionRow[], previous: string[], mode: ReportSelectionMode): string[] {
  const eligible = rows.filter((row) => mode === "manual" || row.completedInPeriodValue > 0).map((row) => row.epicKey);
  const eligibleSet = new Set(eligible);
  const retained = [...new Set(previous)].filter((key) => eligibleSet.has(key));
  if (mode === "manual") return retained;
  const retainedSet = new Set(retained);
  return [...retained, ...eligible.filter((key) => !retainedSet.has(key))];
}
