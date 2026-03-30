import { h } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  chatWithOciGenAi,
  EpicSummaryReportingPeriod,
  fetchConfiguredEpicSummary,
  fetchJiraIntegrationStatus,
  InitiativeEpicSummary,
} from "../../../lib/api";

type RagLabel = "Red" | "Amber" | "Green";

type ExecutiveRow = InitiativeEpicSummary & {
  groupText: string;
  typeText: string;
  rag: RagLabel;
  ragTooltip: string;
  completedInPeriodValue: number;
  deltaPercentValue: number;
};

type ReportingPreset = "last_7_days" | "last_14_days" | "last_30_days" | "custom";

type ReportingRange = {
  startDate: string;
  endDate: string;
};

type PersistedReportingSelection = {
  preset: ReportingPreset;
  startDate: string;
  endDate: string;
};

const INITIATIVE_SECTION_SELECTION_KEY = "teambeacon.executive.initiative.visibleEpicKeys";
const REPORTING_PERIOD_SELECTION_KEY = "teambeacon.executive.reporting.period";

const DAY_MS = 24 * 60 * 60 * 1000;

function parseIsoDateToUtcDay(value: string | null | undefined): number | null {
  if (!value) return null;
  const candidate = value.trim().slice(0, 10);
  const parts = candidate.split("-");
  if (parts.length !== 3) return null;
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  return Date.UTC(year, month - 1, day);
}

function daysBetweenUtc(startUtcDay: number, endUtcDay: number): number {
  return Math.floor((endUtcDay - startUtcDay) / DAY_MS);
}

function isReportingPreset(value: unknown): value is ReportingPreset {
  return value === "last_7_days" || value === "last_14_days" || value === "last_30_days" || value === "custom";
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && parseIsoDateToUtcDay(value) !== null;
}

function formatLocalIsoDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildRelativeRange(days: number): ReportingRange {
  const safeDays = Math.max(1, Math.floor(days));
  const endDate = new Date();
  endDate.setHours(0, 0, 0, 0);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - (safeDays - 1));
  return {
    startDate: formatLocalIsoDate(startDate),
    endDate: formatLocalIsoDate(endDate),
  };
}

function formatReportingPeriodLabel(startDate: string, endDate: string): string {
  const startDay = parseIsoDateToUtcDay(startDate);
  const endDay = parseIsoDateToUtcDay(endDate);
  if (startDay === null || endDay === null) return `${startDate} - ${endDate}`;

  const start = new Date(startDay);
  const end = new Date(endDay);
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();

  const startText = start.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
    timeZone: "UTC",
  });
  const endText = end.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${startText} - ${endText}`;
}

function readPersistedReportingSelection(defaultRange: ReportingRange): PersistedReportingSelection {
  const fallback: PersistedReportingSelection = {
    preset: "last_7_days",
    startDate: defaultRange.startDate,
    endDate: defaultRange.endDate,
  };

  if (typeof window === "undefined") return fallback;

  try {
    const raw = window.localStorage.getItem(REPORTING_PERIOD_SELECTION_KEY);
    if (!raw) return fallback;

    const parsed = JSON.parse(raw) as Partial<PersistedReportingSelection>;
    if (!isReportingPreset(parsed.preset) || !isIsoDate(parsed.startDate) || !isIsoDate(parsed.endDate)) {
      return fallback;
    }

    const startUtc = parseIsoDateToUtcDay(parsed.startDate);
    const endUtc = parseIsoDateToUtcDay(parsed.endDate);
    if (startUtc === null || endUtc === null || startUtc > endUtc) return fallback;

    return {
      preset: parsed.preset,
      startDate: parsed.startDate,
      endDate: parsed.endDate,
    };
  } catch {
    return fallback;
  }
}

function ragFromCompletion(percent: number): RagLabel {
  if (percent < 33) return "Red";
  if (percent < 66) return "Amber";
  return "Green";
}

type RagEvaluation = {
  label: RagLabel;
  reason: string;
};

function evaluateInitiativeRag(entry: InitiativeEpicSummary): RagEvaluation {
  const completion = Math.max(0, Math.min(100, entry.completionPercent));
  const fallback = ragFromCompletion(completion);
  if (!entry.timelineEnabled) {
    return {
      label: fallback,
      reason: `Timeline not enabled. RAG from completion (${completion.toFixed(1)}%).`,
    };
  }

  const todayUtcDay = parseIsoDateToUtcDay(new Date().toISOString());
  const targetUtcDay = parseIsoDateToUtcDay(entry.targetCompletionDate);
  const startUtcDay = parseIsoDateToUtcDay(entry.timelineStartDate);

  if (todayUtcDay === null || targetUtcDay === null) {
    return {
      label: fallback,
      reason: `Timeline metadata incomplete. Fallback to completion (${completion.toFixed(1)}%).`,
    };
  }

  if (completion >= 100) {
    return {
      label: "Green",
      reason: `Complete (${completion.toFixed(1)}%). Target date ${entry.targetCompletionDate ?? "n/a"}.`,
    };
  }

  if (todayUtcDay > targetUtcDay) {
    const overdueDays = daysBetweenUtc(targetUtcDay, todayUtcDay);
    return {
      label: "Red",
      reason: `Overdue by ${overdueDays} day${overdueDays === 1 ? "" : "s"} with completion ${completion.toFixed(1)}%.`,
    };
  }

  if (startUtcDay !== null && startUtcDay <= targetUtcDay) {
    const totalDays = Math.max(1, daysBetweenUtc(startUtcDay, targetUtcDay) + 1);
    const elapsedDays = Math.min(totalDays, Math.max(0, daysBetweenUtc(startUtcDay, todayUtcDay) + 1));
    const expectedCompletion = (elapsedDays / totalDays) * 100;
    const variance = completion - expectedCompletion;

    if (variance >= -10) {
      return {
        label: "Green",
        reason: `On track: ${completion.toFixed(1)}% vs expected ${expectedCompletion.toFixed(1)}% by now.`,
      };
    }
    if (variance >= -25) {
      return {
        label: "Amber",
        reason: `Slightly behind: ${completion.toFixed(1)}% vs expected ${expectedCompletion.toFixed(1)}%.`,
      };
    }
    return {
      label: "Red",
      reason: `Behind plan: ${completion.toFixed(1)}% vs expected ${expectedCompletion.toFixed(1)}%.`,
    };
  }

  return {
    label: fallback,
    reason: `Timeline start date not set. Fallback to completion (${completion.toFixed(1)}%).`,
  };
}

function formatPercent(value: number): string {
  return `${value.toFixed(1).replace(/\.0$/, "")}%`;
}

function buildExecutiveSummaryPrompt(params: {
  reportingPeriodLabel: string;
  reportingPeriodDays: number;
  timezone: string;
  totalEpics: number;
  totalCompletedInPeriod: number;
  greenCount: number;
  amberCount: number;
  redCount: number;
  rows: ExecutiveRow[];
}): string {
  const promptRows = params.rows.slice(0, 40);
  const initiativeLines = promptRows.map((row, index) => {
    const timelineText = row.timelineEnabled
      ? `Timeline ${row.timelineStartDate ?? "?"} -> ${row.targetCompletionDate ?? "?"}`
      : "Timeline not configured";

    return (
      `${index + 1}. ${row.epicName || row.epicKey} (${row.epicKey})` +
      ` | Group: ${row.groupText}` +
      ` | Type: ${row.typeText}` +
      ` | Period Progress: ${row.completedInPeriodValue}/${row.totalCards} cards (${formatPercent(row.deltaPercentValue)})` +
      ` | Overall Progress: ${formatPercent(row.completionPercent)}` +
      ` | RAG: ${row.rag}` +
      ` | ${timelineText}`
    );
  });

  const truncationNote = params.rows.length > promptRows.length
    ? `Only the first ${promptRows.length} selected initiatives are listed in this prompt.`
    : "";

  return [
    "You are drafting an executive summary paragraph for an engineering leadership report.",
    "Write exactly one paragraph of 4-6 sentences in plain text.",
    "Do not use bullet points, markdown, or headings.",
    "Use only the provided data; do not invent metrics or claims.",
    "Cover overall period progress, current RAG risk mix, strongest momentum areas, and immediate focus areas.",
    "",
    `Reporting period: ${params.reportingPeriodLabel} (${params.reportingPeriodDays} days, ${params.timezone})`,
    `Selected initiatives: ${params.totalEpics}`,
    `Completed cards in period (selected): ${params.totalCompletedInPeriod}`,
    `Selected RAG mix: ${params.greenCount} Green, ${params.amberCount} Amber, ${params.redCount} Red`,
    truncationNote,
    "",
    "Selected initiative data from Progress for Key Initiatives:",
    ...initiativeLines,
    "",
    "Return only the paragraph.",
  ]
    .filter((line) => line.trim().length > 0)
    .join("\n");
}

function normalizeDraftBullets(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];

  const deduped = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const normalized = item.trim().replace(/\s+/g, " ");
    if (!normalized) continue;
    deduped.add(normalized);
    if (deduped.size >= 4) break;
  }
  return [...deduped];
}

function parseWinsRisksDraft(text: string): { wins: string[]; risks: string[] } {
  const trimmed = text.trim();
  const unwrapped = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const candidates: string[] = [unwrapped];
  const firstBrace = unwrapped.indexOf("{");
  const lastBrace = unwrapped.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(unwrapped.slice(firstBrace, lastBrace + 1));
  }

  let parsed: Record<string, unknown> | null = null;
  for (const candidate of candidates) {
    try {
      const next = JSON.parse(candidate);
      if (next && typeof next === "object") {
        parsed = next as Record<string, unknown>;
        break;
      }
    } catch {
      // Try next parse candidate.
    }
  }

  if (!parsed) {
    throw new Error("OCI GenAI did not return valid JSON for wins and risks.");
  }

  const wins = normalizeDraftBullets(parsed.wins);
  const risks = normalizeDraftBullets(parsed.risks);
  if (wins.length === 0 || risks.length === 0) {
    throw new Error("OCI GenAI response did not include wins/risks lists.");
  }

  return { wins, risks };
}

function buildWinsRisksPrompt(params: {
  reportingPeriodLabel: string;
  reportingPeriodDays: number;
  timezone: string;
  rows: ExecutiveRow[];
}): string {
  const promptRows = params.rows.slice(0, 40);
  const initiativeLines = promptRows.map((row, index) => {
    const timelineText = row.timelineEnabled
      ? `Timeline ${row.timelineStartDate ?? "?"} -> ${row.targetCompletionDate ?? "?"}`
      : "Timeline not configured";

    return (
      `${index + 1}. ${row.epicName || row.epicKey} (${row.epicKey})` +
      ` | Group: ${row.groupText}` +
      ` | Type: ${row.typeText}` +
      ` | Period Progress: ${row.completedInPeriodValue}/${row.totalCards} cards (${formatPercent(row.deltaPercentValue)})` +
      ` | Overall Progress: ${formatPercent(row.completionPercent)}` +
      ` | RAG: ${row.rag}` +
      ` | ${timelineText}`
    );
  });

  const truncationNote = params.rows.length > promptRows.length
    ? `Only the first ${promptRows.length} selected initiatives are listed in this prompt.`
    : "";

  return [
    "Draft leadership-ready bullets from selected initiative progress data.",
    "Return JSON only with this schema:",
    "{\"wins\":[\"...\"],\"risks\":[\"...\"]}",
    "Rules:",
    "- wins must contain 3-4 concise bullets highlighting progress momentum.",
    "- risks must contain 3-4 concise bullets highlighting delivery risk or missing signals.",
    "- Each bullet must be <= 24 words.",
    "- Use only the provided data. No invented metrics.",
    "",
    `Reporting period: ${params.reportingPeriodLabel} (${params.reportingPeriodDays} days, ${params.timezone})`,
    truncationNote,
    "",
    "Selected initiative data from Progress for Key Initiatives:",
    ...initiativeLines,
  ]
    .filter((line) => line.trim().length > 0)
    .join("\n");
}

function ragToneClass(value: RagLabel): string {
  if (value === "Green") return "is-good";
  if (value === "Amber") return "is-warn";
  return "is-risk";
}

export function ExecutiveReportScreen() {
  const initialRange = useMemo(() => buildRelativeRange(7), []);
  const initialReportingSelection = useMemo(() => readPersistedReportingSelection(initialRange), [initialRange]);

  const browserTimezone = useMemo(() => {
    if (typeof window === "undefined") return "UTC";
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  }, []);

  const [rows, setRows] = useState<ExecutiveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [jiraBaseUrl, setJiraBaseUrl] = useState<string | null>(null);
  const [resolvedReportingPeriod, setResolvedReportingPeriod] = useState<EpicSummaryReportingPeriod | null>(null);

  const [selectedInitiativeEpicKeys, setSelectedInitiativeEpicKeys] = useState<string[]>([]);
  const [isInitiativeConfigOpen, setIsInitiativeConfigOpen] = useState(false);
  const [initiativeConfigDraftKeys, setInitiativeConfigDraftKeys] = useState<string[]>([]);
  const [initiativeConfigQuery, setInitiativeConfigQuery] = useState("");

  const [reportingPreset, setReportingPreset] = useState<ReportingPreset>(initialReportingSelection.preset);
  const [reportingStartDraft, setReportingStartDraft] = useState(initialReportingSelection.startDate);
  const [reportingEndDraft, setReportingEndDraft] = useState(initialReportingSelection.endDate);
  const [reportingRange, setReportingRange] = useState<ReportingRange>({
    startDate: initialReportingSelection.startDate,
    endDate: initialReportingSelection.endDate,
  });
  const [reportingValidationError, setReportingValidationError] = useState<string | null>(null);

  const [executiveSummaryDraft, setExecutiveSummaryDraft] = useState("Generating executive summary...");
  const [executiveSummaryLoading, setExecutiveSummaryLoading] = useState(true);
  const [executiveSummaryError, setExecutiveSummaryError] = useState<string | null>(null);

  const [winsDraft, setWinsDraft] = useState<string[]>([]);
  const [risksDraft, setRisksDraft] = useState<string[]>([]);
  const [winsRisksLoading, setWinsRisksLoading] = useState(true);
  const [winsRisksError, setWinsRisksError] = useState<string | null>(null);

  const hasInitializedInitiativeSelection = useRef(false);
  const summaryRequestSequence = useRef(0);
  const winsRisksRequestSequence = useRef(0);

  const persistInitiativeSelection = useCallback((keys: string[]) => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(INITIATIVE_SECTION_SELECTION_KEY, JSON.stringify(keys));
    } catch {
      // Best-effort persistence only.
    }
  }, []);

  const loadExecutiveData = useCallback(async (range: ReportingRange) => {
    setLoading(true);
    setError(null);

    try {
      const [summaryResult, jiraStatusResult] = await Promise.allSettled([
        fetchConfiguredEpicSummary(200, {
          periodStart: range.startDate,
          periodEnd: range.endDate,
          timezone: browserTimezone,
        }),
        fetchJiraIntegrationStatus(),
      ]);

      if (summaryResult.status === "rejected") {
        throw summaryResult.reason;
      }

      const summaryPayload = summaryResult.value;
      const summaryRows = summaryPayload.epics ?? [];
      setResolvedReportingPeriod(summaryPayload.reportingPeriod ?? null);

      const mappedRows: ExecutiveRow[] = summaryRows.map((entry) => {
        const groupText = entry.groups.map((group) => group.name).join(", ");
        const typeText = entry.workTypes.map((type) => type.name).join(", ");
        const completedInPeriodValue = Math.max(0, entry.completedInPeriod ?? entry.completedLastWeek ?? 0);

        const deltaCandidate =
          typeof entry.deltaPercentInPeriod === "number"
            ? entry.deltaPercentInPeriod
            : typeof entry.deltaPercent === "number"
              ? entry.deltaPercent
              : entry.totalCards > 0
                ? (completedInPeriodValue / entry.totalCards) * 100
                : 0;
        const deltaPercentValue = Math.max(0, Math.round(deltaCandidate * 10) / 10);

        const ragEvaluation = evaluateInitiativeRag(entry);
        const insightText = entry.insightComment?.trim();
        const ragTooltip = insightText
          ? `${ragEvaluation.reason}\n\nInsight: ${insightText}`
          : ragEvaluation.reason;

        return {
          ...entry,
          groupText: groupText || "Unassigned",
          typeText: typeText || "Unassigned",
          rag: ragEvaluation.label,
          ragTooltip,
          completedInPeriodValue,
          deltaPercentValue,
        };
      });

      mappedRows.sort((left, right) => {
        if (right.completedInPeriodValue !== left.completedInPeriodValue) {
          return right.completedInPeriodValue - left.completedInPeriodValue;
        }
        if (right.deltaPercentValue !== left.deltaPercentValue) {
          return right.deltaPercentValue - left.deltaPercentValue;
        }
        return left.epicName.localeCompare(right.epicName, undefined, { sensitivity: "base" });
      });

      setRows(mappedRows);

      if (jiraStatusResult.status === "fulfilled") {
        setJiraBaseUrl(
          jiraStatusResult.value.config.baseUrl
            ? jiraStatusResult.value.config.baseUrl.replace(/\/$/, "")
            : null,
        );
      } else {
        setJiraBaseUrl(null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown executive report load failure.";
      setError(message);
      setRows([]);
      setJiraBaseUrl(null);
      setResolvedReportingPeriod(null);
    } finally {
      setLoading(false);
    }
  }, [browserTimezone]);

  useEffect(() => {
    loadExecutiveData(reportingRange).catch(() => {
      // loadExecutiveData already updates local state.
    });
  }, [loadExecutiveData, reportingRange]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const payload: PersistedReportingSelection = {
        preset: reportingPreset,
        startDate: reportingRange.startDate,
        endDate: reportingRange.endDate,
      };
      window.localStorage.setItem(REPORTING_PERIOD_SELECTION_KEY, JSON.stringify(payload));
    } catch {
      // Best-effort persistence only.
    }
  }, [reportingPreset, reportingRange.endDate, reportingRange.startDate]);

  const effectivePeriodStart = resolvedReportingPeriod?.startDate ?? reportingRange.startDate;
  const effectivePeriodEnd = resolvedReportingPeriod?.endDate ?? reportingRange.endDate;
  const effectivePeriodTimezone = resolvedReportingPeriod?.timezone ?? browserTimezone;

  const reportingPeriodLabel = useMemo(
    () => formatReportingPeriodLabel(effectivePeriodStart, effectivePeriodEnd),
    [effectivePeriodEnd, effectivePeriodStart],
  );

  const reportingPeriodDays = useMemo(() => {
    if (resolvedReportingPeriod?.days && Number.isFinite(resolvedReportingPeriod.days)) {
      return resolvedReportingPeriod.days;
    }
    const startUtc = parseIsoDateToUtcDay(effectivePeriodStart);
    const endUtc = parseIsoDateToUtcDay(effectivePeriodEnd);
    if (startUtc === null || endUtc === null || endUtc < startUtc) return 7;
    return Math.max(1, daysBetweenUtc(startUtc, endUtc) + 1);
  }, [effectivePeriodEnd, effectivePeriodStart, resolvedReportingPeriod?.days]);

  const applyCustomReportingRange = useCallback(() => {
    if (!reportingStartDraft || !reportingEndDraft) {
      setReportingValidationError("Start and end date are required.");
      return;
    }

    const startUtc = parseIsoDateToUtcDay(reportingStartDraft);
    const endUtc = parseIsoDateToUtcDay(reportingEndDraft);
    if (startUtc === null || endUtc === null) {
      setReportingValidationError("Invalid reporting period date format.");
      return;
    }
    if (startUtc > endUtc) {
      setReportingValidationError("Start date cannot be after end date.");
      return;
    }

    setReportingValidationError(null);
    setReportingRange({
      startDate: reportingStartDraft,
      endDate: reportingEndDraft,
    });
  }, [reportingEndDraft, reportingStartDraft]);

  const onReportingPresetChange = useCallback((preset: ReportingPreset) => {
    setReportingPreset(preset);
    setReportingValidationError(null);

    if (preset === "custom") return;

    const nextRange = preset === "last_14_days"
      ? buildRelativeRange(14)
      : preset === "last_30_days"
        ? buildRelativeRange(30)
        : buildRelativeRange(7);

    setReportingStartDraft(nextRange.startDate);
    setReportingEndDraft(nextRange.endDate);
    setReportingRange(nextRange);
  }, []);

  const initiativeRows = useMemo(() => {
    const sorted = [...rows];
    sorted.sort((left, right) => {
      const leftGroup = left.groupText.trim();
      const rightGroup = right.groupText.trim();
      if (leftGroup !== rightGroup) {
        if (leftGroup === "Unassigned") return 1;
        if (rightGroup === "Unassigned") return -1;
        return leftGroup.localeCompare(rightGroup, undefined, { sensitivity: "base" });
      }
      if (left.typeText !== right.typeText) {
        if (left.typeText === "Unassigned") return 1;
        if (right.typeText === "Unassigned") return -1;
        return left.typeText.localeCompare(right.typeText, undefined, { sensitivity: "base" });
      }
      if (right.completedInPeriodValue !== left.completedInPeriodValue) {
        return right.completedInPeriodValue - left.completedInPeriodValue;
      }
      return (left.epicName || left.epicKey).localeCompare(right.epicName || right.epicKey, undefined, {
        sensitivity: "base",
      });
    });
    return sorted;
  }, [rows]);

  useEffect(() => {
    if (rows.length === 0) {
      setSelectedInitiativeEpicKeys([]);
      hasInitializedInitiativeSelection.current = false;
      return;
    }

    const allEpicKeys = rows.map((row) => row.epicKey);
    const available = new Set(allEpicKeys);

    if (!hasInitializedInitiativeSelection.current) {
      let storedKeys: string[] = [];
      if (typeof window !== "undefined") {
        try {
          const raw = window.localStorage.getItem(INITIATIVE_SECTION_SELECTION_KEY);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              storedKeys = parsed.filter((value): value is string => typeof value === "string");
            }
          }
        } catch {
          storedKeys = [];
        }
      }

      const initialKeys = storedKeys.filter((key) => available.has(key));
      const nextSelection = initialKeys.length > 0 ? initialKeys : allEpicKeys;
      setSelectedInitiativeEpicKeys(nextSelection);
      persistInitiativeSelection(nextSelection);
      hasInitializedInitiativeSelection.current = true;
      return;
    }

    setSelectedInitiativeEpicKeys((previous) => {
      const nextSelection = previous.filter((key) => available.has(key));
      const normalized = nextSelection.length > 0 ? nextSelection : allEpicKeys;
      if (normalized.length !== previous.length || normalized.some((key, index) => key !== previous[index])) {
        persistInitiativeSelection(normalized);
      }
      return normalized;
    });
  }, [persistInitiativeSelection, rows]);

  const visibleInitiativeRows = useMemo(() => {
    const rowByKey = new Map(initiativeRows.map((row) => [row.epicKey, row]));
    const orderedRows: ExecutiveRow[] = [];
    for (const key of selectedInitiativeEpicKeys) {
      const row = rowByKey.get(key);
      if (row) orderedRows.push(row);
    }
    return orderedRows;
  }, [initiativeRows, selectedInitiativeEpicKeys]);

  const visibleInitiativeSignals = useMemo(() => {
    const totalEpics = visibleInitiativeRows.length;
    const totalCompletedInPeriod = visibleInitiativeRows.reduce((sum, row) => sum + row.completedInPeriodValue, 0);
    const redCount = visibleInitiativeRows.filter((row) => row.rag === "Red").length;
    const amberCount = visibleInitiativeRows.filter((row) => row.rag === "Amber").length;
    const greenCount = visibleInitiativeRows.filter((row) => row.rag === "Green").length;
    return {
      totalEpics,
      totalCompletedInPeriod,
      redCount,
      amberCount,
      greenCount,
    };
  }, [visibleInitiativeRows]);

  const groupDistributionRows = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of visibleInitiativeRows) {
      const names = row.groups.length ? row.groups.map((group) => group.name) : ["Unassigned"];
      for (const name of names) {
        map.set(name, (map.get(name) ?? 0) + row.completedInPeriodValue);
      }
    }

    return [...map.entries()]
      .map(([name, value]) => ({
        name,
        completedInPeriod: value,
        percent: visibleInitiativeSignals.totalCompletedInPeriod > 0
          ? (value / visibleInitiativeSignals.totalCompletedInPeriod) * 100
          : 0,
      }))
      .sort((left, right) => right.completedInPeriod - left.completedInPeriod);
  }, [visibleInitiativeRows, visibleInitiativeSignals.totalCompletedInPeriod]);

  const typeDistributionRows = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of visibleInitiativeRows) {
      const names = row.workTypes.length ? row.workTypes.map((type) => type.name) : ["Unassigned"];
      for (const name of names) {
        map.set(name, (map.get(name) ?? 0) + row.completedInPeriodValue);
      }
    }

    return [...map.entries()]
      .map(([name, value]) => ({
        name,
        completedInPeriod: value,
        percent: visibleInitiativeSignals.totalCompletedInPeriod > 0
          ? (value / visibleInitiativeSignals.totalCompletedInPeriod) * 100
          : 0,
      }))
      .sort((left, right) => right.completedInPeriod - left.completedInPeriod);
  }, [visibleInitiativeRows, visibleInitiativeSignals.totalCompletedInPeriod]);

  useEffect(() => {
    if (loading) {
      setExecutiveSummaryLoading(true);
      setExecutiveSummaryError(null);
      return;
    }

    if (error) {
      setExecutiveSummaryLoading(false);
      setExecutiveSummaryError(null);
      setExecutiveSummaryDraft("Unable to generate executive summary because initiative data failed to load.");
      return;
    }

    if (visibleInitiativeRows.length === 0) {
      setExecutiveSummaryLoading(false);
      setExecutiveSummaryError(null);
      setExecutiveSummaryDraft(
        initiativeRows.length > 0
          ? "No initiatives are selected in Progress for Key Initiatives. Select at least one initiative to generate the summary."
          : "No configured epics found. Configure epic metadata to generate an executive summary.",
      );
      return;
    }

    const prompt = buildExecutiveSummaryPrompt({
      reportingPeriodLabel,
      reportingPeriodDays,
      timezone: effectivePeriodTimezone,
      totalEpics: visibleInitiativeSignals.totalEpics,
      totalCompletedInPeriod: visibleInitiativeSignals.totalCompletedInPeriod,
      greenCount: visibleInitiativeSignals.greenCount,
      amberCount: visibleInitiativeSignals.amberCount,
      redCount: visibleInitiativeSignals.redCount,
      rows: visibleInitiativeRows,
    });

    const requestId = summaryRequestSequence.current + 1;
    summaryRequestSequence.current = requestId;
    setExecutiveSummaryLoading(true);
    setExecutiveSummaryError(null);

    chatWithOciGenAi({
      message: prompt,
      maxTokens: 260,
      temperature: 0.2,
      topP: 0.8,
      topK: 0,
      frequencyPenalty: 0,
    })
      .then((response) => {
        if (summaryRequestSequence.current !== requestId) return;
        const text = response.response.text?.trim();
        if (!text) {
          throw new Error("OCI GenAI returned an empty summary draft.");
        }
        setExecutiveSummaryDraft(text);
      })
      .catch((err) => {
        if (summaryRequestSequence.current !== requestId) return;
        const message = err instanceof Error ? err.message : "Unknown OCI GenAI summary failure.";
        setExecutiveSummaryError(message);
        setExecutiveSummaryDraft("Unable to generate executive summary draft from OCI GenAI.");
      })
      .finally(() => {
        if (summaryRequestSequence.current !== requestId) return;
        setExecutiveSummaryLoading(false);
      });
  }, [
    effectivePeriodTimezone,
    error,
    initiativeRows.length,
    loading,
    reportingPeriodDays,
    reportingPeriodLabel,
    visibleInitiativeRows,
    visibleInitiativeSignals.amberCount,
    visibleInitiativeSignals.greenCount,
    visibleInitiativeSignals.redCount,
    visibleInitiativeSignals.totalCompletedInPeriod,
    visibleInitiativeSignals.totalEpics,
  ]);

  useEffect(() => {
    if (loading) {
      setWinsRisksLoading(true);
      setWinsRisksError(null);
      return;
    }

    if (error) {
      setWinsRisksLoading(false);
      setWinsRisksError(null);
      setWinsDraft(["Unable to generate wins because initiative data failed to load."]);
      setRisksDraft(["Unable to generate risks because initiative data failed to load."]);
      return;
    }

    if (visibleInitiativeRows.length === 0) {
      setWinsRisksLoading(false);
      setWinsRisksError(null);
      if (initiativeRows.length > 0) {
        setWinsDraft(["No initiatives are selected in Progress for Key Initiatives."]);
        setRisksDraft(["Select at least one initiative to generate risks."]);
      } else {
        setWinsDraft(["No configured epics found to generate wins."]);
        setRisksDraft(["No configured epics found to generate risks."]);
      }
      return;
    }

    const prompt = buildWinsRisksPrompt({
      reportingPeriodLabel,
      reportingPeriodDays,
      timezone: effectivePeriodTimezone,
      rows: visibleInitiativeRows,
    });

    const requestId = winsRisksRequestSequence.current + 1;
    winsRisksRequestSequence.current = requestId;

    setWinsRisksLoading(true);
    setWinsRisksError(null);
    setWinsDraft([]);
    setRisksDraft([]);

    chatWithOciGenAi({
      message: prompt,
      maxTokens: 420,
      temperature: 0.2,
      topP: 0.8,
      topK: 0,
      frequencyPenalty: 0,
    })
      .then((response) => {
        if (winsRisksRequestSequence.current !== requestId) return;
        const parsed = parseWinsRisksDraft(response.response.text ?? "");
        setWinsDraft(parsed.wins);
        setRisksDraft(parsed.risks);
      })
      .catch((err) => {
        if (winsRisksRequestSequence.current !== requestId) return;
        const message = err instanceof Error ? err.message : "Unknown OCI GenAI wins/risks failure.";
        setWinsRisksError(message);
        setWinsDraft(["Unable to generate wins draft from OCI GenAI."]);
        setRisksDraft(["Unable to generate risks draft from OCI GenAI."]);
      })
      .finally(() => {
        if (winsRisksRequestSequence.current !== requestId) return;
        setWinsRisksLoading(false);
      });
  }, [
    effectivePeriodTimezone,
    error,
    initiativeRows.length,
    loading,
    reportingPeriodDays,
    reportingPeriodLabel,
    visibleInitiativeRows,
  ]);

  const initiativeConfigRows = useMemo(() => {
    const query = initiativeConfigQuery.trim().toLowerCase();
    if (!query) return initiativeRows;
    return initiativeRows.filter((row) => {
      return (
        row.epicKey.toLowerCase().includes(query) ||
        (row.epicName || "").toLowerCase().includes(query) ||
        row.groupText.toLowerCase().includes(query) ||
        row.typeText.toLowerCase().includes(query)
      );
    });
  }, [initiativeConfigQuery, initiativeRows]);

  const selectedConfigRows = useMemo(() => {
    const byKey = new Map(initiativeRows.map((row) => [row.epicKey, row]));
    const selectedRows: ExecutiveRow[] = [];
    for (const key of initiativeConfigDraftKeys) {
      const row = byKey.get(key);
      if (row) selectedRows.push(row);
    }
    return selectedRows;
  }, [initiativeConfigDraftKeys, initiativeRows]);

  const availableConfigRows = useMemo(() => {
    const selected = new Set(initiativeConfigDraftKeys);
    return initiativeConfigRows.filter((row) => !selected.has(row.epicKey));
  }, [initiativeConfigDraftKeys, initiativeConfigRows]);

  const openInitiativeConfig = useCallback(() => {
    setInitiativeConfigDraftKeys(selectedInitiativeEpicKeys);
    setInitiativeConfigQuery("");
    setIsInitiativeConfigOpen(true);
  }, [selectedInitiativeEpicKeys]);

  const saveInitiativeConfig = useCallback(() => {
    const available = new Set(initiativeRows.map((row) => row.epicKey));
    const normalized = initiativeConfigDraftKeys.filter(
      (key, index, source) => available.has(key) && source.indexOf(key) === index,
    );

    setSelectedInitiativeEpicKeys(normalized);
    persistInitiativeSelection(normalized);
    setIsInitiativeConfigOpen(false);
  }, [initiativeConfigDraftKeys, initiativeRows, persistInitiativeSelection]);

  const moveDraftKeyUp = useCallback((epicKey: string) => {
    setInitiativeConfigDraftKeys((previous) => {
      const index = previous.indexOf(epicKey);
      if (index <= 0) return previous;
      const next = [...previous];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }, []);

  const moveDraftKeyDown = useCallback((epicKey: string) => {
    setInitiativeConfigDraftKeys((previous) => {
      const index = previous.indexOf(epicKey);
      if (index < 0 || index >= previous.length - 1) return previous;
      const next = [...previous];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  }, []);

  const reportToneClass = visibleInitiativeSignals.redCount > 0 ? "is-warn" : "is-good";
  const reportToneText = visibleInitiativeSignals.redCount > 0 ? "Review Risks" : "Ready";

  return (
    <div class="tb-screen-grid">
      <section class="tb-panel">
        <header class="tb-panel-header">
          <div>
            <h3>Executive Summary Draft</h3>
            <p>Drafted by OCI GenAI from selected progress data and reporting period movement.</p>
          </div>
          <div class="tb-btn-row">
            <span class={`tb-status-pill ${reportToneClass}`}>{reportToneText}</span>
            <button type="button" class="tb-btn tb-btn-sm" onClick={() => window.print()}>
              Print Report
            </button>
          </div>
        </header>

        <div class="tb-exec-period-toolbar">
          <label class="tb-exec-period-field">
            <span>Reporting Period</span>
            <select
              value={reportingPreset}
              onChange={(event) => onReportingPresetChange((event.currentTarget as HTMLSelectElement).value as ReportingPreset)}
            >
              <option value="last_7_days">Last 7 Days</option>
              <option value="last_14_days">Last 14 Days</option>
              <option value="last_30_days">Last 30 Days</option>
              <option value="custom">Custom</option>
            </select>
          </label>

          {reportingPreset === "custom" ? (
            <div class="tb-exec-period-custom">
              <label class="tb-exec-period-field">
                <span>Start</span>
                <input
                  type="date"
                  value={reportingStartDraft}
                  onInput={(event) => setReportingStartDraft((event.currentTarget as HTMLInputElement).value)}
                />
              </label>
              <label class="tb-exec-period-field">
                <span>End</span>
                <input
                  type="date"
                  value={reportingEndDraft}
                  onInput={(event) => setReportingEndDraft((event.currentTarget as HTMLInputElement).value)}
                />
              </label>
              <button type="button" class="tb-btn tb-btn-sm" onClick={applyCustomReportingRange}>
                Apply
              </button>
            </div>
          ) : null}
        </div>

        <p class="tb-muted-note">
          Reporting period: {reportingPeriodLabel} ({reportingPeriodDays} days, {effectivePeriodTimezone})
        </p>
        {reportingValidationError ? <p class="tb-error-note">{reportingValidationError}</p> : null}
        <div class="tb-summary">
          {executiveSummaryLoading ? "Generating executive summary with OCI GenAI..." : executiveSummaryDraft}
        </div>
        {executiveSummaryError ? <p class="tb-error-note">Executive summary draft error: {executiveSummaryError}</p> : null}
        {error ? <p class="tb-error-note">Executive report error: {error}</p> : null}
      </section>

      <section class="tb-panel">
        <header class="tb-panel-header">
          <div>
            <h3>Wins and Risks</h3>
            <p>Drafted by OCI GenAI from selected Progress for Key Initiatives data.</p>
          </div>
        </header>

        {winsRisksError ? <p class="tb-error-note">Wins and risks draft error: {winsRisksError}</p> : null}

        <div class="tb-exec-two-up">
          <div>
            <h4 class="tb-exec-list-title">Wins</h4>
            <ul class="tb-list">
              {winsDraft.map((item) => (
                <li key={item}>{item}</li>
              ))}
              {winsRisksLoading ? <li>Generating wins with OCI GenAI...</li> : null}
              {!winsRisksLoading && winsDraft.length === 0 ? <li>Wins will appear once configured epic data is available.</li> : null}
            </ul>
          </div>
          <div>
            <h4 class="tb-exec-list-title">Risks</h4>
            <ul class="tb-list">
              {risksDraft.map((item) => (
                <li key={item}>{item}</li>
              ))}
              {winsRisksLoading ? <li>Generating risks with OCI GenAI...</li> : null}
              {!winsRisksLoading && risksDraft.length === 0 ? <li>Risks will appear once configured epic data is available.</li> : null}
            </ul>
          </div>
        </div>
      </section>

      <section class="tb-panel">
        <header class="tb-panel-header">
          <div>
            <h3>Progress for Key Initiatives</h3>
            <p>Selected initiatives used for executive narrative generation.</p>
          </div>
          <button type="button" class="tb-btn tb-btn-sm" onClick={openInitiativeConfig}>
            Configure
          </button>
        </header>

        <div class="tb-sync-history-wrap">
          <table class="tb-sync-history-table">
            <thead>
              <tr>
                <th>Group</th>
                <th>Epic</th>
                <th>Period Progress</th>
                <th>Overall Progress</th>
                <th>RAG</th>
              </tr>
            </thead>
            <tbody>
              {visibleInitiativeRows.map((row) => (
                <tr key={row.epicKey}>
                  <td>{row.groupText}</td>
                  <td>
                    {jiraBaseUrl ? (
                      <a
                        class="tb-external-link"
                        href={`${jiraBaseUrl}/browse/${row.epicKey}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {row.epicName || row.epicKey}
                      </a>
                    ) : (
                      row.epicName || row.epicKey
                    )}
                  </td>
                  <td>
                    {row.completedInPeriodValue}/{row.totalCards} cards ({formatPercent(row.deltaPercentValue)})
                  </td>
                  <td>
                    <div class="tb-history-progress">
                      <span class="tb-history-progress-track">
                        <span class="tb-history-progress-fill" style={{ width: `${Math.min(100, row.completionPercent)}%` }} />
                      </span>
                      <span class="tb-history-progress-label">{formatPercent(row.completionPercent)}</span>
                    </div>
                  </td>
                  <td title={row.ragTooltip}>
                    <span class={`tb-status-pill ${ragToneClass(row.rag)}`}>{row.rag}</span>
                  </td>
                </tr>
              ))}
              {!loading && visibleInitiativeRows.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    {initiativeRows.length > 0
                      ? "No initiatives selected. Use Configure to include epics in this section."
                      : "No configured epic data available yet."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section class="tb-panel">
        <header class="tb-panel-header">
          <div>
            <h3>Report Signals</h3>
            <p>High-level confidence snapshot for final review.</p>
          </div>
        </header>
        <div class="tb-metrics-grid tb-three-up">
          <article class="tb-metric-card">
            <h4>Ongoing Initiatives</h4>
            <strong class="tb-value">{loading ? "..." : visibleInitiativeSignals.totalEpics}</strong>
            <p>Selected for Progress for Key Initiatives.</p>
          </article>
          <article class="tb-metric-card">
            <h4>Period Progress</h4>
            <strong class={`tb-value ${visibleInitiativeSignals.totalCompletedInPeriod > 0 ? "tb-value-good" : "tb-value-warn"}`}>
              {loading ? "..." : `${visibleInitiativeSignals.totalCompletedInPeriod} cards`}
            </strong>
            <p>Completed in the selected reporting period.</p>
          </article>
          <article class="tb-metric-card">
            <h4>Initiative RAG</h4>
            <strong class="tb-value">
              {loading ? "..." : `${visibleInitiativeSignals.redCount} Red | ${visibleInitiativeSignals.amberCount} Amber | ${visibleInitiativeSignals.greenCount} Green`}
            </strong>
            <p>For selected initiatives.</p>
          </article>
        </div>
      </section>

      <section class="tb-panel">
        <header class="tb-panel-header">
          <div>
            <h3>Effort Distribution by Group and Type</h3>
            <p>Share of completed cards in the selected reporting period.</p>
          </div>
        </header>

        <div class="tb-exec-two-up">
          <div>
            <h4 class="tb-exec-list-title">Groups</h4>
            <div class="tb-sync-history-wrap">
              <table class="tb-sync-history-table">
                <thead>
                  <tr>
                    <th>Group</th>
                    <th>Completed in Period</th>
                    <th>%</th>
                  </tr>
                </thead>
                <tbody>
                  {groupDistributionRows.map((row) => (
                    <tr key={row.name}>
                      <td>{row.name}</td>
                      <td>{row.completedInPeriod}/{visibleInitiativeSignals.totalCompletedInPeriod}</td>
                      <td>{formatPercent(row.percent)}</td>
                    </tr>
                  ))}
                  {!loading && groupDistributionRows.length === 0 ? (
                    <tr>
                      <td colSpan={3}>No group-tagged epics yet.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h4 class="tb-exec-list-title">Types</h4>
            <div class="tb-sync-history-wrap">
              <table class="tb-sync-history-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Completed in Period</th>
                    <th>%</th>
                  </tr>
                </thead>
                <tbody>
                  {typeDistributionRows.map((row) => (
                    <tr key={row.name}>
                      <td>{row.name}</td>
                      <td>{row.completedInPeriod}/{visibleInitiativeSignals.totalCompletedInPeriod}</td>
                      <td>{formatPercent(row.percent)}</td>
                    </tr>
                  ))}
                  {!loading && typeDistributionRows.length === 0 ? (
                    <tr>
                      <td colSpan={3}>No type-tagged epics yet.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {isInitiativeConfigOpen ? (
        <div class="tb-modal-layer" role="dialog" aria-modal="true" aria-label="Configure Initiative Epics">
          <div class="tb-modal-backdrop" onClick={() => setIsInitiativeConfigOpen(false)} />
          <div class="tb-modal tb-modal-wide">
            <header class="tb-modal-head">
              <div>
                <h3>Configure Initiative Epics</h3>
                <p class="tb-muted-note">Choose which epics appear in Progress for Key Initiatives.</p>
              </div>
              <div class="tb-action-row">
                <button type="button" class="tb-btn tb-btn-sm" onClick={() => setIsInitiativeConfigOpen(false)}>
                  Cancel
                </button>
                <button type="button" class="tb-btn tb-btn-sm tb-btn-primary" onClick={saveInitiativeConfig}>
                  Save
                </button>
              </div>
            </header>

            <label class="tb-exec-search">
              <span>Search epics</span>
              <input
                type="text"
                value={initiativeConfigQuery}
                onInput={(event) => setInitiativeConfigQuery((event.currentTarget as HTMLInputElement).value)}
                placeholder="Search by epic key, title, group, or type"
              />
            </label>

            <div class="tb-modal-two-up">
              <section>
                <header class="tb-panel-header-actions">
                  <strong>Available ({availableConfigRows.length})</strong>
                  <button
                    type="button"
                    class="tb-btn tb-btn-sm"
                    onClick={() => setInitiativeConfigDraftKeys(initiativeRows.map((row) => row.epicKey))}
                  >
                    Select All
                  </button>
                </header>

                <div class="tb-exec-config-list">
                  {availableConfigRows.map((row) => (
                    <div key={row.epicKey} class="tb-exec-config-item">
                      <div>
                        <strong>{row.epicName || row.epicKey}</strong>
                        <p>{row.groupText} | {row.typeText} | {row.epicKey}</p>
                      </div>
                      <button
                        type="button"
                        class="tb-btn tb-btn-sm"
                        onClick={() => setInitiativeConfigDraftKeys((previous) => [...previous, row.epicKey])}
                      >
                        Add
                      </button>
                    </div>
                  ))}
                  {availableConfigRows.length === 0 ? <p class="tb-muted-note">No epics match the current search.</p> : null}
                </div>
              </section>

              <section>
                <header class="tb-panel-header-actions">
                  <strong>Selected ({selectedConfigRows.length})</strong>
                  <button
                    type="button"
                    class="tb-btn tb-btn-sm"
                    onClick={() => setInitiativeConfigDraftKeys([])}
                  >
                    Clear All
                  </button>
                </header>

                <div class="tb-exec-config-list">
                  {selectedConfigRows.map((row, index) => (
                    <div key={row.epicKey} class="tb-exec-config-item">
                      <div>
                        <strong>{row.epicName || row.epicKey}</strong>
                        <p>{row.groupText} | {row.typeText} | {row.epicKey}</p>
                      </div>
                      <div class="tb-action-row">
                        <button
                          type="button"
                          class="tb-btn tb-btn-sm"
                          onClick={() => moveDraftKeyUp(row.epicKey)}
                          disabled={index === 0}
                        >
                          Up
                        </button>
                        <button
                          type="button"
                          class="tb-btn tb-btn-sm"
                          onClick={() => moveDraftKeyDown(row.epicKey)}
                          disabled={index === selectedConfigRows.length - 1}
                        >
                          Down
                        </button>
                        <button
                          type="button"
                          class="tb-btn tb-btn-sm tb-btn-danger"
                          onClick={() => setInitiativeConfigDraftKeys((previous) => previous.filter((key) => key !== row.epicKey))}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                  {selectedConfigRows.length === 0 ? <p class="tb-muted-note">No epics selected yet.</p> : null}
                </div>
              </section>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
