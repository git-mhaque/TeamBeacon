import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MetricCard } from "../components/MetricCard";
import { Panel } from "../components/Panel";
import { StatusPill } from "../components/StatusPill";
import {
  chatWithOciGenAi,
  fetchConfiguredEpicSummary,
  fetchJiraIntegrationStatus,
  InitiativeEpicSummary,
} from "../lib/api";

type RagLabel = "Red" | "Amber" | "Green";
type DistributionSlice = {
  label: string;
  value: number;
  percent: number;
  color: string;
};

type ExecutiveRow = InitiativeEpicSummary & {
  groupText: string;
  typeText: string;
  rag: RagLabel;
  ragTooltip: string;
  completedLastWeekValue: number;
  deltaPercentValue: number;
};

const INITIATIVE_SECTION_SELECTION_KEY = "teambeacon.executive.initiative.visibleEpicKeys";
const REPORTING_PERIOD_SELECTION_KEY = "teambeacon.executive.reporting.period";
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

function isReportingPreset(value: unknown): value is ReportingPreset {
  return value === "last_7_days" || value === "last_14_days" || value === "last_30_days" || value === "custom";
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && parseIsoDateToUtcDay(value) !== null;
}

function readPersistedReportingSelection(defaultRange: ReportingRange): PersistedReportingSelection {
  const fallback: PersistedReportingSelection = {
    preset: "last_7_days",
    startDate: defaultRange.startDate,
    endDate: defaultRange.endDate,
  };
  if (typeof window === "undefined") {
    return fallback;
  }
  try {
    const raw = window.localStorage.getItem(REPORTING_PERIOD_SELECTION_KEY);
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw) as Partial<PersistedReportingSelection>;
    if (!isReportingPreset(parsed.preset) || !isIsoDate(parsed.startDate) || !isIsoDate(parsed.endDate)) {
      return fallback;
    }
    const startUtc = parseIsoDateToUtcDay(parsed.startDate);
    const endUtc = parseIsoDateToUtcDay(parsed.endDate);
    if (startUtc === null || endUtc === null || startUtc > endUtc) {
      return fallback;
    }
    return {
      preset: parsed.preset,
      startDate: parsed.startDate,
      endDate: parsed.endDate,
    };
  } catch {
    return fallback;
  }
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
  if (startDay === null || endDay === null) {
    return `${startDate} - ${endDate}`;
  }
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

function ragFromCompletion(percent: number): RagLabel {
  if (percent < 33) return "Red";
  if (percent < 66) return "Amber";
  return "Green";
}

type RagEvaluation = {
  label: RagLabel;
  reason: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function parseIsoDateToUtcDay(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const candidate = value.trim().slice(0, 10);
  const parts = candidate.split("-");
  if (parts.length !== 3) {
    return null;
  }
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }
  return Date.UTC(year, month - 1, day);
}

function toIsoFromUtcDay(utcDay: number): string {
  return new Date(utcDay).toISOString().slice(0, 10);
}

function daysBetweenUtc(startUtcDay: number, endUtcDay: number): number {
  return Math.floor((endUtcDay - startUtcDay) / DAY_MS);
}

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
      reason: `Complete (${completion.toFixed(1)}%). Target date ${toIsoFromUtcDay(targetUtcDay)}.`,
    };
  }

  if (todayUtcDay > targetUtcDay) {
    const overdueDays = daysBetweenUtc(targetUtcDay, todayUtcDay);
    return {
      label: "Red",
      reason: `Overdue by ${overdueDays} day${overdueDays === 1 ? "" : "s"} (target ${toIsoFromUtcDay(targetUtcDay)}). Completion ${completion.toFixed(1)}%.`,
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
        reason: `On track: ${completion.toFixed(1)}% vs expected ${expectedCompletion.toFixed(1)}% by now (target ${toIsoFromUtcDay(targetUtcDay)}).`,
      };
    }
    if (variance >= -25) {
      return {
        label: "Amber",
        reason: `Slightly behind: ${completion.toFixed(1)}% vs expected ${expectedCompletion.toFixed(1)}% by now (target ${toIsoFromUtcDay(targetUtcDay)}).`,
      };
    }
    return {
      label: "Red",
      reason: `Behind plan: ${completion.toFixed(1)}% vs expected ${expectedCompletion.toFixed(1)}% by now (target ${toIsoFromUtcDay(targetUtcDay)}).`,
    };
  }

  const daysRemaining = daysBetweenUtc(todayUtcDay, targetUtcDay);
  if (daysRemaining <= 7 && completion < 80) {
    return {
      label: "Red",
      reason: `${daysRemaining} day${daysRemaining === 1 ? "" : "s"} to target (${toIsoFromUtcDay(targetUtcDay)}) with completion ${completion.toFixed(1)}%.`,
    };
  }
  if (daysRemaining <= 14 && completion < 60) {
    return {
      label: "Amber",
      reason: `${daysRemaining} days to target (${toIsoFromUtcDay(targetUtcDay)}); completion ${completion.toFixed(1)}% is at risk.`,
    };
  }
  return {
    label: fallback,
    reason: `Timeline start date not set. Fallback to completion (${completion.toFixed(1)}%) with target ${toIsoFromUtcDay(targetUtcDay)}.`,
  };
}

function formatPercent(value: number): string {
  return `${value.toFixed(1).replace(/\.0$/, "")}%`;
}

const DISTRIBUTION_COLORS = [
  "#1f8f63",
  "#0f5570",
  "#b77700",
  "#c2372e",
  "#6c4ba6",
  "#1c6f9a",
  "#8a4f00",
  "#4a6b2d",
];

function buildDistributionSlices(
  rows: Array<{ name: string; completedLastWeek: number }>,
  totalCompleted: number,
): DistributionSlice[] {
  return rows.map((row, index) => ({
    label: row.name,
    value: row.completedLastWeek,
    percent: totalCompleted > 0 ? (row.completedLastWeek / totalCompleted) * 100 : 0,
    color: DISTRIBUTION_COLORS[index % DISTRIBUTION_COLORS.length],
  }));
}

function buildDonutBackground(slices: DistributionSlice[]): string {
  if (slices.length === 0) {
    return "#e1ebf0";
  }
  let cursor = 0;
  const stops = slices.map((slice) => {
    const start = cursor;
    const end = cursor + slice.percent;
    cursor = end;
    return `${slice.color} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
  });
  return `conic-gradient(${stops.join(", ")})`;
}

function buildExecutiveSummaryPrompt(params: {
  reportingPeriodLabel: string;
  reportingPeriodDays: number;
  timezone: string;
  totalEpics: number;
  totalCompletedLastWeek: number;
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
      ` | Period Progress: ${row.completedLastWeekValue}/${row.totalCards} cards (${formatPercent(row.deltaPercentValue)})` +
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
    `Completed cards in period (selected): ${params.totalCompletedLastWeek}`,
    `Selected RAG mix: ${params.greenCount} Green, ${params.amberCount} Amber, ${params.redCount} Red`,
    truncationNote,
    "",
    "Selected initiative data from Progress for Key Initiatives:",
    ...initiativeLines,
    "",
    "Return only the paragraph."
  ]
    .filter((line) => line.trim().length > 0)
    .join("\n");
}

export function ExecutiveReportScreen() {
  const initialRange = useMemo(() => buildRelativeRange(7), []);
  const initialReportingSelection = useMemo(
    () => readPersistedReportingSelection(initialRange),
    [initialRange],
  );
  const browserTimezone = useMemo(() => {
    if (typeof window === "undefined") return "UTC";
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  }, []);
  const [rows, setRows] = useState<ExecutiveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [jiraBaseUrl, setJiraBaseUrl] = useState<string | null>(null);
  const [selectedInitiativeEpicKeys, setSelectedInitiativeEpicKeys] = useState<string[]>([]);
  const [initiativeConfigOpen, setInitiativeConfigOpen] = useState(false);
  const [initiativeConfigDraftKeys, setInitiativeConfigDraftKeys] = useState<string[]>([]);
  const [initiativeConfigQuery, setInitiativeConfigQuery] = useState("");
  const [initiativeConfigDraggingKey, setInitiativeConfigDraggingKey] = useState<string | null>(null);
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
  const hasInitializedInitiativeSelection = useRef(false);
  const summaryRequestSequence = useRef(0);

  const persistInitiativeSelection = useCallback((keys: string[]) => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(INITIATIVE_SECTION_SELECTION_KEY, JSON.stringify(keys));
    } catch {
      // Persisting local selection is best-effort only.
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

      const mappedRows: ExecutiveRow[] = summaryResult.value.map((entry) => {
        const groupText = entry.groups.map((group) => group.name).join(", ");
        const typeText = entry.workTypes.map((type) => type.name).join(", ");
        const completedLastWeekValue = Math.max(
          0,
          entry.completedInPeriod ?? entry.completedLastWeek ?? 0,
        );
        const deltaCandidate =
          typeof entry.deltaPercentInPeriod === "number"
            ? entry.deltaPercentInPeriod
            : typeof entry.deltaPercent === "number"
              ? entry.deltaPercent
            : entry.totalCards > 0
              ? (completedLastWeekValue / entry.totalCards) * 100
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
          completedLastWeekValue,
          deltaPercentValue,
        };
      });

      mappedRows.sort((left, right) => {
        if (right.completedLastWeekValue !== left.completedLastWeekValue) {
          return right.completedLastWeekValue - left.completedLastWeekValue;
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
      // Reporting period persistence is best-effort only.
    }
  }, [reportingPreset, reportingRange.endDate, reportingRange.startDate]);

  const reportingPeriodLabel = useMemo(
    () => formatReportingPeriodLabel(reportingRange.startDate, reportingRange.endDate),
    [reportingRange.endDate, reportingRange.startDate],
  );

  const reportingPeriodDays = useMemo(() => {
    const startUtc = parseIsoDateToUtcDay(reportingRange.startDate);
    const endUtc = parseIsoDateToUtcDay(reportingRange.endDate);
    if (startUtc === null || endUtc === null || endUtc < startUtc) {
      return 7;
    }
    return Math.max(1, daysBetweenUtc(startUtc, endUtc) + 1);
  }, [reportingRange.endDate, reportingRange.startDate]);

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
    if (preset === "custom") {
      return;
    }
    const nextRange = preset === "last_14_days"
      ? buildRelativeRange(14)
      : preset === "last_30_days"
        ? buildRelativeRange(30)
        : buildRelativeRange(7);
    setReportingStartDraft(nextRange.startDate);
    setReportingEndDraft(nextRange.endDate);
    setReportingRange(nextRange);
  }, []);

  const metrics = useMemo(() => {
    const totalEpics = rows.length;
    const totalCards = rows.reduce((sum, row) => sum + row.totalCards, 0);
    const totalCompleted = rows.reduce((sum, row) => sum + row.completedCards, 0);
    const totalCompletedLastWeek = rows.reduce((sum, row) => sum + row.completedLastWeekValue, 0);
    const redCount = rows.filter((row) => row.rag === "Red").length;
    const amberCount = rows.filter((row) => row.rag === "Amber").length;
    const greenCount = rows.filter((row) => row.rag === "Green").length;
    const avgCompletion = totalCards > 0 ? (totalCompleted / totalCards) * 100 : 0;
    const avgDelta = totalCards > 0 ? (totalCompletedLastWeek / totalCards) * 100 : 0;
    return {
      totalEpics,
      totalCards,
      totalCompletedLastWeek,
      redCount,
      amberCount,
      greenCount,
      avgCompletion,
      avgDelta,
    };
  }, [rows]);

  const groupProgress = useMemo(() => {
    const map = new Map<string, { cards: number; completed: number; completedLastWeek: number }>();
    for (const row of rows) {
      const names = row.groups.length ? row.groups.map((group) => group.name) : ["Unassigned"];
      for (const name of names) {
        const current = map.get(name) ?? { cards: 0, completed: 0, completedLastWeek: 0 };
        current.cards += row.totalCards;
        current.completed += row.completedCards;
        current.completedLastWeek += row.completedLastWeekValue;
        map.set(name, current);
      }
    }
    return [...map.entries()]
      .map(([name, value]) => ({
        name,
        cards: value.cards,
        completedLastWeek: value.completedLastWeek,
        completionPercent: value.cards > 0 ? (value.completed / value.cards) * 100 : 0,
      }))
      .sort((left, right) => right.completedLastWeek - left.completedLastWeek);
  }, [rows]);

  const typeProgress = useMemo(() => {
    const map = new Map<string, { cards: number; completed: number; completedLastWeek: number }>();
    for (const row of rows) {
      const names = row.workTypes.length ? row.workTypes.map((type) => type.name) : ["Unassigned"];
      for (const name of names) {
        const current = map.get(name) ?? { cards: 0, completed: 0, completedLastWeek: 0 };
        current.cards += row.totalCards;
        current.completed += row.completedCards;
        current.completedLastWeek += row.completedLastWeekValue;
        map.set(name, current);
      }
    }
    return [...map.entries()]
      .map(([name, value]) => ({
        name,
        cards: value.cards,
        completedLastWeek: value.completedLastWeek,
        completionPercent: value.cards > 0 ? (value.completed / value.cards) * 100 : 0,
      }))
      .sort((left, right) => right.completedLastWeek - left.completedLastWeek);
  }, [rows]);

  const sortedGroupProgress = useMemo(
    () => [...groupProgress].sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" })),
    [groupProgress],
  );

  const sortedTypeProgress = useMemo(
    () => [...typeProgress].sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" })),
    [typeProgress],
  );

  const groupDistributionSlices = useMemo(
    () => buildDistributionSlices(sortedGroupProgress, metrics.totalCompletedLastWeek),
    [metrics.totalCompletedLastWeek, sortedGroupProgress],
  );

  const typeDistributionSlices = useMemo(
    () => buildDistributionSlices(sortedTypeProgress, metrics.totalCompletedLastWeek),
    [metrics.totalCompletedLastWeek, sortedTypeProgress],
  );

  const wins = useMemo(() => {
    const items: string[] = [];
    const completedThreshold = Math.max(1, Math.round((reportingPeriodDays * 3) / 7));
    for (const row of rows) {
      if (
        row.completedLastWeekValue >= completedThreshold
        || row.deltaPercentValue >= 12
        || (row.rag === "Green" && row.deltaPercentValue > 0)
      ) {
        items.push(
          `${row.epicName || row.epicKey}: +${formatPercent(row.deltaPercentValue)} period movement (${row.completedLastWeekValue}/${row.totalCards} cards), ${row.groupText} / ${row.typeText}.`,
        );
      }
      if (items.length >= 4) break;
    }
    if (items.length === 0 && rows.length > 0) {
      items.push("Steady delivery across configured epics with no major slippage in the selected reporting period.");
    }
    return items;
  }, [reportingPeriodDays, rows]);

  const risks = useMemo(() => {
    const items: string[] = [];
    for (const row of rows) {
      if (row.rag === "Red") {
        items.push(
          `${row.epicName || row.epicKey}: Red at ${formatPercent(row.completionPercent)} completion; prioritize scope burn-down and blocker removal.`,
        );
      } else if (row.totalCards > 0 && row.completedLastWeekValue === 0) {
        items.push(
          `${row.epicName || row.epicKey}: no completed cards in the selected reporting period (${row.groupText} / ${row.typeText}).`,
        );
      } else if (row.successCriteria.length === 0) {
        items.push(`${row.epicName || row.epicKey}: success criteria not configured; outcome quality risk remains.`);
      }
      if (items.length >= 4) break;
    }
    if (items.length === 0 && rows.length > 0) {
      items.push("No major initiative risks flagged from configured epic signals in the selected reporting period.");
    }
    return items;
  }, [rows]);

  const reportTone = metrics.redCount > 0 ? "warn" : "good";
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
      if (right.completedLastWeekValue !== left.completedLastWeekValue) {
        return right.completedLastWeekValue - left.completedLastWeekValue;
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
    const totalCompletedLastWeek = visibleInitiativeRows.reduce(
      (sum, row) => sum + row.completedLastWeekValue,
      0,
    );
    const redCount = visibleInitiativeRows.filter((row) => row.rag === "Red").length;
    const amberCount = visibleInitiativeRows.filter((row) => row.rag === "Amber").length;
    const greenCount = visibleInitiativeRows.filter((row) => row.rag === "Green").length;
    return {
      totalEpics,
      totalCompletedLastWeek,
      redCount,
      amberCount,
      greenCount,
    };
  }, [visibleInitiativeRows]);

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
      timezone: browserTimezone,
      totalEpics: visibleInitiativeSignals.totalEpics,
      totalCompletedLastWeek: visibleInitiativeSignals.totalCompletedLastWeek,
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
    browserTimezone,
    error,
    initiativeRows.length,
    loading,
    reportingPeriodDays,
    reportingPeriodLabel,
    visibleInitiativeRows,
    visibleInitiativeSignals.amberCount,
    visibleInitiativeSignals.greenCount,
    visibleInitiativeSignals.redCount,
    visibleInitiativeSignals.totalCompletedLastWeek,
    visibleInitiativeSignals.totalEpics,
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

  const selectedInitiativeConfigRows = useMemo(() => {
    const rowByKey = new Map(initiativeRows.map((row) => [row.epicKey, row]));
    const selectedRows: ExecutiveRow[] = [];
    for (const key of initiativeConfigDraftKeys) {
      const row = rowByKey.get(key);
      if (row) selectedRows.push(row);
    }
    return selectedRows;
  }, [initiativeConfigDraftKeys, initiativeRows]);

  const availableInitiativeConfigRows = useMemo(() => {
    const selected = new Set(initiativeConfigDraftKeys);
    return initiativeConfigRows.filter((row) => !selected.has(row.epicKey));
  }, [initiativeConfigDraftKeys, initiativeConfigRows]);

  const openInitiativeConfig = useCallback(() => {
    setInitiativeConfigDraftKeys(selectedInitiativeEpicKeys);
    setInitiativeConfigQuery("");
    setInitiativeConfigDraggingKey(null);
    setInitiativeConfigOpen(true);
  }, [selectedInitiativeEpicKeys]);

  const closeInitiativeConfig = useCallback(() => {
    setInitiativeConfigOpen(false);
    setInitiativeConfigQuery("");
    setInitiativeConfigDraggingKey(null);
  }, []);

  const addInitiativeDraftKey = useCallback((epicKey: string) => {
    setInitiativeConfigDraftKeys((previous) => {
      if (previous.includes(epicKey)) return previous;
      return [...previous, epicKey];
    });
  }, []);

  const removeInitiativeDraftKey = useCallback((epicKey: string) => {
    setInitiativeConfigDraftKeys((previous) => previous.filter((key) => key !== epicKey));
  }, []);

  const moveInitiativeDraftKey = useCallback((sourceKey: string, targetKey: string) => {
    if (sourceKey === targetKey) return;
    setInitiativeConfigDraftKeys((previous) => {
      const sourceIndex = previous.indexOf(sourceKey);
      const targetIndex = previous.indexOf(targetKey);
      if (sourceIndex < 0 || targetIndex < 0) return previous;
      const reordered = [...previous];
      reordered.splice(sourceIndex, 1);
      reordered.splice(targetIndex, 0, sourceKey);
      return reordered;
    });
  }, []);

  const saveInitiativeConfig = useCallback(() => {
    const available = new Set(initiativeRows.map((row) => row.epicKey));
    const normalized = initiativeConfigDraftKeys.filter((key, index, source) => available.has(key) && source.indexOf(key) === index);
    setSelectedInitiativeEpicKeys(normalized);
    persistInitiativeSelection(normalized);
    closeInitiativeConfig();
  }, [closeInitiativeConfig, initiativeConfigDraftKeys, initiativeRows, persistInitiativeSelection]);

  const exportReportPdf = useCallback(() => {
    if (typeof window === "undefined") return;
    setIsExportingPdf(true);
    const body = document.body;
    body.classList.add("executive-print-mode");
    const previousTitle = document.title;
    document.title = `TeamBeacon-Executive-Report-${reportingRange.startDate}_to_${reportingRange.endDate}`;

    window.setTimeout(() => {
      window.print();
      window.setTimeout(() => {
        body.classList.remove("executive-print-mode");
        document.title = previousTitle;
        setIsExportingPdf(false);
      }, 250);
    }, 120);
  }, [reportingRange.endDate, reportingRange.startDate]);

  return (
    <div className="screen-grid">
      <Panel
        title="Executive Summary Draft"
        subtitle="Drafted by OCI GenAI using selected items from Progress for Key Initiatives and reporting period movement."
        action={(
          <div className="executive-actions no-print">
            <StatusPill tone={reportTone} text={metrics.redCount > 0 ? "Review Risks" : "Ready to Export"} />
            <button className="mini-sync-btn" type="button" onClick={exportReportPdf} disabled={isExportingPdf}>
              {isExportingPdf ? "Preparing..." : "Print Report"}
            </button>
          </div>
        )}
      >
        <div className="executive-period-toolbar no-print">
          <label className="executive-period-field">
            <span>Reporting Period</span>
            <select
              value={reportingPreset}
              onChange={(event) => onReportingPresetChange(event.target.value as ReportingPreset)}
            >
              <option value="last_7_days">Last 7 Days</option>
              <option value="last_14_days">Last 14 Days</option>
              <option value="last_30_days">Last 30 Days</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          {reportingPreset === "custom" ? (
            <div className="executive-period-custom">
              <label className="executive-period-field">
                <span>Start</span>
                <input
                  type="date"
                  value={reportingStartDraft}
                  onChange={(event) => setReportingStartDraft(event.target.value)}
                />
              </label>
              <label className="executive-period-field">
                <span>End</span>
                <input
                  type="date"
                  value={reportingEndDraft}
                  onChange={(event) => setReportingEndDraft(event.target.value)}
                />
              </label>
              <button className="mini-sync-btn" type="button" onClick={applyCustomReportingRange}>
                Apply
              </button>
            </div>
          ) : null}
        </div>
        <p className="executive-period-summary">
          Reporting period: {reportingPeriodLabel} ({reportingPeriodDays} days, {browserTimezone})
        </p>
        {reportingValidationError ? <p className="sync-history-error">{reportingValidationError}</p> : null}
        <p className="summary">
          {executiveSummaryLoading ? "Generating executive summary with OCI GenAI..." : executiveSummaryDraft}
        </p>
        {executiveSummaryError ? <p className="sync-history-error">Executive summary draft error: {executiveSummaryError}</p> : null}
        {error ? <p className="sync-history-error">Executive report error: {error}</p> : null}
      </Panel>

      <Panel title="Wins and Risks" subtitle="Auto-highlighted report bullets for leadership updates.">
        <div className="metrics-grid two-up">
          <div>
            <h4 className="executive-list-title">Wins</h4>
            <ul className="list">
              {wins.map((item) => (
                <li key={item}>{item}</li>
              ))}
              {!loading && wins.length === 0 ? <li>Wins will appear once configured epic data is available.</li> : null}
            </ul>
          </div>
          <div>
            <h4 className="executive-list-title">Risks</h4>
            <ul className="list">
              {risks.map((item) => (
                <li key={item}>{item}</li>
              ))}
              {!loading && risks.length === 0 ? <li>Risks will appear once configured epic data is available.</li> : null}
            </ul>
          </div>
        </div>
      </Panel>

      <Panel
        title="Progress for Key Initiatives"
        action={
          <button className="mini-sync-btn no-print" type="button" onClick={openInitiativeConfig}>
            Configure
          </button>
        }
      >
        <div className="initiative-summary-table-wrap">
          <table className="sync-history-table">
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
              {visibleInitiativeRows.map((row) => {
                const timelineIconTitle = row.timelineEnabled
                  ? `Timeline configured: ${row.timelineStartDate ?? "?"} -> ${row.targetCompletionDate ?? "?"}`
                  : "";
                return (
                  <tr key={row.epicKey}>
                    <td className="initiative-group-cell">{row.groupText}</td>
                    <td className="initiative-name-cell">
                      <span className="initiative-summary-name-wrap">
                        {jiraBaseUrl ? (
                          <a
                            className="external-link"
                            href={`${jiraBaseUrl}/browse/${row.epicKey}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {row.epicName || row.epicKey}
                          </a>
                        ) : (
                          <span>{row.epicName || row.epicKey}</span>
                        )}
                        {row.timelineEnabled ? (
                          <span className="initiative-timeline-icon" title={timelineIconTitle} aria-label={timelineIconTitle}>
                            <svg viewBox="0 0 20 20" aria-hidden="true">
                              <circle cx="10" cy="10" r="7.2" />
                              <path d="M10 6.2v4.2l2.8 2" />
                            </svg>
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className="initiative-delta-cell">
                      {row.completedLastWeekValue}/{row.totalCards} cards ({formatPercent(row.deltaPercentValue)})
                    </td>
                    <td className="initiative-progress-cell">
                      <div className="initiative-progress-content">
                        <span className="initiative-progress-track">
                          <span className="initiative-progress-fill" style={{ width: `${Math.min(100, row.completionPercent)}%` }} />
                        </span>
                        <span className="initiative-progress-label">{formatPercent(row.completionPercent)}</span>
                      </div>
                    </td>
                    <td title={row.ragTooltip}>
                      <span className={`rag-indicator rag-${row.rag.toLowerCase()}`}>
                        <span className="rag-dot rag-dot-large" />
                      </span>
                    </td>
                  </tr>
                );
              })}
              {!loading && visibleInitiativeRows.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    {initiativeRows.length > 0
                      ? "No epics selected. Use Configure to include epics in this section."
                      : "No configured epic data available yet."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Report Signals" subtitle="High-level confidence snapshot for final review.">
        <div className="metrics-grid three-up">
          <MetricCard
            label="Ongoing Initiatives"
            value={loading ? "..." : visibleInitiativeSignals.totalEpics}
            hint="Selected for Progress for Key Initiatives."
          />
          <MetricCard
            label="Period Progress"
            value={loading ? "..." : `${visibleInitiativeSignals.totalCompletedLastWeek} cards`}
            hint="Completed in the selected reporting period."
            tone={visibleInitiativeSignals.totalCompletedLastWeek > 0 ? "good" : "warn"}
          />
          <MetricCard
            label="Initiative RAG"
            value={
              loading ? "..." : (
                <span className="initiative-rag-breakdown">
                  <span className="initiative-rag-text initiative-rag-red">{visibleInitiativeSignals.redCount} Red</span>
                  <span className="initiative-rag-separator">|</span>
                  <span className="initiative-rag-text initiative-rag-amber">{visibleInitiativeSignals.amberCount} Amber</span>
                  <span className="initiative-rag-separator">|</span>
                  <span className="initiative-rag-text initiative-rag-green">{visibleInitiativeSignals.greenCount} Green</span>
                </span>
              )
            }
            hint="For selected initiatives."
            tone="neutral"
          />
        </div>
      </Panel>

      <Panel title="Effort Distribution by Group and Type" subtitle="Share of completed cards in the selected reporting period.">
        <div className="executive-distribution-stack">
          <section className="executive-distribution-row">
            <div className="executive-distribution-chart-panel">
              <h4>Groups</h4>
              <div className="executive-distribution-wrap">
                <div
                  className="executive-distribution-donut"
                  style={{ background: buildDonutBackground(groupDistributionSlices) }}
                  aria-label="Group effort distribution chart"
                >
                  {metrics.totalCompletedLastWeek <= 0 ? <span>No data</span> : null}
                </div>
                <ul className="executive-distribution-legend">
                  {groupDistributionSlices.map((slice) => (
                    <li key={slice.label}>
                      <span
                        className="executive-distribution-swatch"
                        style={{ backgroundColor: slice.color }}
                        aria-hidden="true"
                      />
                      <span>{slice.label}</span>
                      <span>{formatPercent(slice.percent)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="executive-mini-table">
              <table className="sync-history-table">
                <thead>
                  <tr>
                    <th>Group</th>
                    <th>Completed in Period</th>
                    <th>%</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedGroupProgress.map((row) => (
                    <tr key={row.name}>
                      <td>{row.name}</td>
                      <td>{row.completedLastWeek}/{metrics.totalCompletedLastWeek}</td>
                      <td>
                        {formatPercent(
                          metrics.totalCompletedLastWeek > 0
                            ? (row.completedLastWeek / metrics.totalCompletedLastWeek) * 100
                            : 0,
                        )}
                      </td>
                    </tr>
                  ))}
                  {!loading && groupProgress.length === 0 ? (
                    <tr>
                      <td colSpan={3}>No group-tagged epics yet.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="executive-distribution-row">
            <div className="executive-distribution-chart-panel">
              <h4>Types</h4>
              <div className="executive-distribution-wrap">
                <div
                  className="executive-distribution-donut"
                  style={{ background: buildDonutBackground(typeDistributionSlices) }}
                  aria-label="Type effort distribution chart"
                >
                  {metrics.totalCompletedLastWeek <= 0 ? <span>No data</span> : null}
                </div>
                <ul className="executive-distribution-legend">
                  {typeDistributionSlices.map((slice) => (
                    <li key={slice.label}>
                      <span
                        className="executive-distribution-swatch"
                        style={{ backgroundColor: slice.color }}
                        aria-hidden="true"
                      />
                      <span>{slice.label}</span>
                      <span>{formatPercent(slice.percent)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="executive-mini-table">
              <table className="sync-history-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Completed in Period</th>
                    <th>%</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedTypeProgress.map((row) => (
                    <tr key={row.name}>
                      <td>{row.name}</td>
                      <td>{row.completedLastWeek}/{metrics.totalCompletedLastWeek}</td>
                      <td>
                        {formatPercent(
                          metrics.totalCompletedLastWeek > 0
                            ? (row.completedLastWeek / metrics.totalCompletedLastWeek) * 100
                            : 0,
                        )}
                      </td>
                    </tr>
                  ))}
                  {!loading && typeProgress.length === 0 ? (
                    <tr>
                      <td colSpan={3}>No type-tagged epics yet.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </Panel>

      {initiativeConfigOpen ? (
        <div className="sync-options-overlay" role="dialog" aria-modal="true" aria-label="Configure initiative epics">
          <div className="sync-options-backdrop" onClick={closeInitiativeConfig} />
          <div className="sync-options-dialog initiative-config-dialog">
            <div className="initiative-config-header">
              <div>
                <h3>Configure Initiative Epics</h3>
                <p>Select which configured epics appear in Progress for Key Initiatives.</p>
              </div>
              <div className="sync-options-footer initiative-config-top-actions">
                <button className="mini-sync-btn" type="button" onClick={closeInitiativeConfig}>
                  Cancel
                </button>
                <button className="sync-btn" type="button" onClick={saveInitiativeConfig}>
                  Save
                </button>
              </div>
            </div>

            <label className="initiative-config-search">
              <input
                type="text"
                value={initiativeConfigQuery}
                onChange={(event) => setInitiativeConfigQuery(event.target.value)}
                placeholder="Search epics"
                aria-label="Search epics"
              />
            </label>

            <div className="initiative-config-columns">
              <section className="initiative-config-column">
                <div className="initiative-config-column-head">
                  <h4>Available Epics ({availableInitiativeConfigRows.length})</h4>
                  <button
                    className="mini-sync-btn"
                    type="button"
                    onClick={() => setInitiativeConfigDraftKeys(initiativeRows.map((row) => row.epicKey))}
                  >
                    Select All
                  </button>
                </div>
                <p>Double-click to select.</p>
                <div className="initiative-config-card-list">
                  {availableInitiativeConfigRows.map((row) => (
                    <button
                      key={row.epicKey}
                      className="initiative-config-card"
                      type="button"
                      onDoubleClick={() => addInitiativeDraftKey(row.epicKey)}
                    >
                      <span className="initiative-config-card-meta">
                        {row.groupText} | {row.typeText} | {row.epicKey}
                      </span>
                      <span className="initiative-config-card-title">{row.epicName || row.epicKey}</span>
                    </button>
                  ))}
                  {availableInitiativeConfigRows.length === 0 ? (
                    <p className="sync-options-note">No epics match the current search.</p>
                  ) : null}
                </div>
              </section>

              <section className="initiative-config-column">
                <div className="initiative-config-column-head">
                  <h4>Selected Epics ({selectedInitiativeConfigRows.length})</h4>
                  <button className="mini-sync-btn" type="button" onClick={() => setInitiativeConfigDraftKeys([])}>
                    Clear All
                  </button>
                </div>
                <p>Double-click to remove. Drag to reorder.</p>
                <div className="initiative-config-card-list">
                  {selectedInitiativeConfigRows.map((row) => (
                    <div
                      key={row.epicKey}
                      className={`initiative-config-order-item ${
                        initiativeConfigDraggingKey === row.epicKey ? "dragging" : ""
                      }`}
                      draggable
                      onDoubleClick={() => removeInitiativeDraftKey(row.epicKey)}
                      onDragStart={() => setInitiativeConfigDraggingKey(row.epicKey)}
                      onDragEnd={() => setInitiativeConfigDraggingKey(null)}
                      onDragOver={(event) => {
                        event.preventDefault();
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        if (!initiativeConfigDraggingKey) return;
                        moveInitiativeDraftKey(initiativeConfigDraggingKey, row.epicKey);
                        setInitiativeConfigDraggingKey(null);
                      }}
                    >
                      <span className="initiative-drag-handle" aria-hidden="true">
                        ::
                      </span>
                      <span className="initiative-config-order-label">
                        <span className="initiative-config-card-meta">
                          {row.groupText} | {row.typeText} | {row.epicKey}
                        </span>
                        <span className="initiative-config-card-title">{row.epicName || row.epicKey}</span>
                      </span>
                    </div>
                  ))}
                  {selectedInitiativeConfigRows.length === 0 ? (
                    <p className="sync-options-note">No epics selected yet.</p>
                  ) : null}
                </div>
              </section>
            </div>

          </div>
        </div>
      ) : null}
    </div>
  );
}
