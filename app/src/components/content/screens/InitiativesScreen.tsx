import { h } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  chatWithOciGenAi,
  ConfiguredEpicSummaryResponse,
  EpicCandidate,
  EpicCompletedCard,
  EpicLookupConfig,
  EpicSummaryReportingPeriod,
  InitiativeView,
  InitiativeViewId,
  InitiativeEpicSummary,
  createInitiativeView,
  deleteEpicMetadata,
  deleteInitiativeView,
  fetchAiIntegrationStatus,
  fetchConfiguredEpicsCompletedCards,
  fetchEpicCompletedCards,
  fetchConfiguredEpicSummary,
  fetchEpicCandidates,
  fetchEpicLookupConfig,
  fetchInitiativeViews,
  fetchJiraIntegrationStatus,
  updateInitiativeView,
  upsertEpicMetadata,
} from "../../../lib/api";
import { getPreference, getPreferenceSync, setPreference } from "../../../lib/persistence";

type RagLabel = "Red" | "Amber" | "Green";

type SummaryRow = InitiativeEpicSummary & {
  groupText: string;
  typeText: string;
  completedInPeriodValue: number;
  deltaPercentValue: number;
  ragLabel: RagLabel;
  ragReason: string;
  successCriteriaTooltip: string;
};

type CompletedSummaryContext =
  | { scope: "epic"; epicKey: string; epicName: string }
  | { scope: "configured"; viewName: string; isAllConfigured: boolean };

type OptionalColumnId = "group" | "type" | "progress" | "completed" | "delta" | "rag" | "criteria";

type SortField = "epic" | OptionalColumnId;

type SortDirection = "asc" | "desc";

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

type ViewEditorMode = "create" | "edit";

const OPTIONAL_COLUMN_DEFINITIONS: Array<{ id: OptionalColumnId; label: string }> = [
  { id: "group", label: "Group" },
  { id: "type", label: "Type" },
  { id: "progress", label: "Progress" },
  { id: "completed", label: "Completed" },
  { id: "delta", label: "Delta" },
  { id: "rag", label: "RAG" },
  { id: "criteria", label: "Criteria / Insight" },
];

const DEFAULT_VISIBLE_OPTIONAL_COLUMNS: OptionalColumnId[] = OPTIONAL_COLUMN_DEFINITIONS.map((column) => column.id);
const INITIATIVES_VISIBLE_COLUMNS_KEY = "teambeacon.initiatives.visibleOptionalColumns";
const INITIATIVES_REPORTING_PERIOD_SELECTION_KEY = "teambeacon.initiatives.reporting.period";
const INITIATIVES_ACTIVE_VIEW_KEY = "teambeacon.initiatives.activeViewId";
export const OPEN_INITIATIVES_CONFIGURE_EVENT = "teambeacon:initiatives-open-configure";
export const OPEN_INITIATIVES_REPORTING_PERIOD_EVENT = "teambeacon:initiatives-open-reporting-period";
export const OPEN_INITIATIVES_MANAGE_VIEW_EVENT = "teambeacon:initiatives-open-manage-view";
export const INITIATIVES_VIEW_STATE_EVENT = "teambeacon:initiatives-view-state";
export const SET_INITIATIVES_ACTIVE_VIEW_EVENT = "teambeacon:initiatives-set-active-view";

const RAG_SORT_RANK: Record<RagLabel, number> = {
  Red: 0,
  Amber: 1,
  Green: 2,
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

function toIsoFromUtcDay(utcDay: number): string {
  return new Date(utcDay).toISOString().slice(0, 10);
}

function daysBetweenUtc(startUtcDay: number, endUtcDay: number): number {
  return Math.floor((endUtcDay - startUtcDay) / DAY_MS);
}

function ragFromCompletion(percent: number): RagLabel {
  if (percent < 33) return "Red";
  if (percent < 66) return "Amber";
  return "Green";
}

function evaluateInitiativeRag(entry: InitiativeEpicSummary): { label: RagLabel; reason: string } {
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
      reason: `Overdue by ${overdueDays} day${overdueDays === 1 ? "" : "s"} (target ${toIsoFromUtcDay(targetUtcDay)}).`,
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
        reason: `On track: ${completion.toFixed(1)}% vs expected ${expectedCompletion.toFixed(1)}%.`,
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

  const daysRemaining = daysBetweenUtc(todayUtcDay, targetUtcDay);
  if (daysRemaining <= 7 && completion < 80) {
    return {
      label: "Red",
      reason: `${daysRemaining} day${daysRemaining === 1 ? "" : "s"} remaining with completion ${completion.toFixed(1)}%.`,
    };
  }
  if (daysRemaining <= 14 && completion < 60) {
    return {
      label: "Amber",
      reason: `${daysRemaining} days remaining with completion ${completion.toFixed(1)}%.`,
    };
  }

  return {
    label: fallback,
    reason: `Timeline start date not set. Fallback to completion (${completion.toFixed(1)}%).`,
  };
}

function ragToneClass(label: RagLabel): string {
  if (label === "Red") return "is-red";
  if (label === "Amber") return "is-amber";
  return "is-green";
}

function formatAiProviderName(value: string | null | undefined): string {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "oci" || normalized === "oci-genai" || normalized === "oci_genai") return "OCI";
  if (normalized === "ollama") return "Ollama";
  if (normalized === "openai") return "OpenAI";
  return "AI";
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  return `${(Math.round(value * 10) / 10).toFixed(1).replace(/\.0$/, "")}%`;
}

function formatDate(value: string): string {
  const utcDay = parseIsoDateToUtcDay(value);
  if (utcDay === null) {
    return value;
  }
  const date = new Date(utcDay);
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = date.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const year = String(date.getUTCFullYear());
  return `${day}-${month}-${year}`;
}

function periodLabel(period: ConfiguredEpicSummaryResponse["reportingPeriod"]): string {
  if (!period) {
    return "Reporting period not returned by API.";
  }
  const start = formatDate(period.startDate);
  const end = formatDate(period.endDate);
  return `${start} - ${end} (${period.days} day${period.days === 1 ? "" : "s"}, ${period.timezone})`;
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

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "Not generated yet";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Date(parsed).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function buildCompletedCardsSummaryPrompt(params: {
  epicName: string;
  reportingPeriodText: string;
  completedCards: EpicCompletedCard[];
  expectedCount: number;
}): string {
  const cards = params.completedCards.slice(0, 80);
  const cardLines = cards.map((card, index) => {
    const completedAt = card.completedAt || "n/a";
    const status = card.status || "unknown";
    return `${index + 1}. ${status} | ${completedAt} | Outcome: ${card.summary}`;
  });
  const truncationNote = params.expectedCount > cards.length
    ? `Only ${cards.length} of ${params.expectedCount} completed cards are listed.`
    : "";

  return [
    "You are summarizing completed outcomes for an initiative update.",
    "Return exactly one concise paragraph (4-6 sentences) in plain text.",
    "Use only the provided card data and do not invent metrics.",
    "Call out what shipped, delivery outcomes, and any risk signals.",
    "Do not infer delivery risk from story-point values or card size alone.",
    "Only mention risk when it is directly supported by status, timing, or outcome text in the provided data.",
    "Do not reference issue keys or ticket IDs.",
    "",
    `Initiative: ${params.epicName}`,
    `Reporting period: ${params.reportingPeriodText}`,
    `Completed cards in period: ${params.expectedCount}`,
    truncationNote,
    "",
    "Completed card details:",
    ...cardLines,
  ]
    .filter((line) => line.trim().length > 0)
    .join("\n");
}

function buildConfiguredCompletedCardsSummaryPrompt(params: {
  reportingPeriodText: string;
  completedCards: EpicCompletedCard[];
  expectedCount: number;
  perEpicCounts: Record<string, number>;
  scopeLabel: string;
}): string {
  const cards = params.completedCards.slice(0, 120);
  const cardLines = cards.map((card, index) => {
    const completedAt = card.completedAt || "n/a";
    const status = card.status || "unknown";
    const initiative = card.epicName || card.epicKey || "Unknown initiative";
    return `${index + 1}. Initiative: ${initiative} | ${status} | ${completedAt} | Outcome: ${card.summary}`;
  });

  const epicNameByKey = new Map<string, string>();
  for (const card of cards) {
    const key = card.epicKey?.trim();
    const name = card.epicName?.trim();
    if (!key || !name) continue;
    if (!epicNameByKey.has(key)) {
      epicNameByKey.set(key, name);
    }
  }

  const perEpicLines = Object.entries(params.perEpicCounts)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 30)
    .map(([epicKey, count], index) => {
      const initiative = epicNameByKey.get(epicKey) || epicKey;
      return `${index + 1}. ${initiative}: ${count} completed outcomes`;
    });

  const truncationNote = params.expectedCount > cards.length
    ? `Only ${cards.length} of ${params.expectedCount} completed cards are listed.`
    : "";

  return [
    `You are summarizing completed outcomes for ${params.scopeLabel}.`,
    "Return exactly one concise paragraph (4-6 sentences) in plain text.",
    "Use only the provided card data and do not invent metrics.",
    "Call out which initiatives drove completion, the strongest delivery themes, and immediate risk signals.",
    "Do not infer delivery risk from story-point values or card size alone.",
    "Only mention risk when it is directly supported by status, timing, or outcome text in the provided data.",
    "Do not reference issue keys or ticket IDs.",
    "",
    `Reporting period: ${params.reportingPeriodText}`,
    `Completed cards in period (${params.scopeLabel}): ${params.expectedCount}`,
    truncationNote,
    "",
    "Completion distribution by initiative:",
    ...perEpicLines,
    "",
    "Completed card details:",
    ...cardLines,
  ]
    .filter((line) => line.trim().length > 0)
    .join("\n");
}

function normalizeDateInputValue(value: string | null | undefined): string {
  if (!value) return "";
  const candidate = value.trim();
  if (!candidate) return "";
  if (candidate.length >= 10) {
    return candidate.slice(0, 10);
  }
  return "";
}

function toSingleIdArray(raw: string): number[] {
  if (!raw) return [];
  const candidate = Number(raw);
  if (!Number.isFinite(candidate) || candidate <= 0) {
    return [];
  }
  return [candidate];
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

function compareNumber(left: number, right: number): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function epicDisplaySortText(row: SummaryRow): string {
  const name = row.epicName.trim();
  return name || row.epicKey;
}

function parsePersistedVisibleOptionalColumns(raw: string | null): OptionalColumnId[] {
  if (!raw) return DEFAULT_VISIBLE_OPTIONAL_COLUMNS;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_VISIBLE_OPTIONAL_COLUMNS;
    const allowed = new Set<OptionalColumnId>(OPTIONAL_COLUMN_DEFINITIONS.map((column) => column.id));
    const selected = new Set<OptionalColumnId>();
    for (const entry of parsed) {
      if (typeof entry !== "string") continue;
      if (allowed.has(entry as OptionalColumnId)) {
        selected.add(entry as OptionalColumnId);
      }
    }
    return OPTIONAL_COLUMN_DEFINITIONS
      .map((column) => column.id)
      .filter((columnId) => selected.has(columnId));
  } catch {
    return DEFAULT_VISIBLE_OPTIONAL_COLUMNS;
  }
}

function readPersistedVisibleOptionalColumns(): OptionalColumnId[] {
  return parsePersistedVisibleOptionalColumns(getPreferenceSync(INITIATIVES_VISIBLE_COLUMNS_KEY));
}

function readPersistedReportingSelection(defaultRange: ReportingRange): PersistedReportingSelection {
  const fallback: PersistedReportingSelection = {
    preset: "last_7_days",
    startDate: defaultRange.startDate,
    endDate: defaultRange.endDate,
  };

  return parsePersistedReportingSelection(getPreferenceSync(INITIATIVES_REPORTING_PERIOD_SELECTION_KEY), fallback);
}

function parsePersistedInitiativeViewId(raw: string | null): InitiativeViewId {
  if (!raw) return "all";
  const candidate = raw.trim();
  if (!candidate || candidate === "all") return "all";
  const parsed = Number(candidate);
  if (!Number.isInteger(parsed) || parsed <= 0) return "all";
  return parsed;
}

function readPersistedInitiativeViewId(): InitiativeViewId {
  return parsePersistedInitiativeViewId(getPreferenceSync(INITIATIVES_ACTIVE_VIEW_KEY));
}

function buildSummaryRow(entry: InitiativeEpicSummary): SummaryRow {
  const completedInPeriodValue = Math.max(0, entry.completedInPeriod ?? entry.completedLastWeek ?? 0);
  const deltaPercentValue = Math.max(0, entry.deltaPercentInPeriod ?? entry.deltaPercent ?? 0);
  const ragEvaluation = evaluateInitiativeRag(entry);
  return {
    ...entry,
    groupText: entry.groups.length > 0 ? entry.groups.map((group) => group.name).join(", ") : "-",
    typeText: entry.workTypes.length > 0 ? entry.workTypes.map((type) => type.name).join(", ") : "-",
    completedInPeriodValue,
    deltaPercentValue,
    ragLabel: ragEvaluation.label,
    ragReason: ragEvaluation.reason,
    successCriteriaTooltip: entry.successCriteria.length > 0
      ? entry.successCriteria.map((criterion, index) => `${index + 1}. ${criterion}`).join("\n")
      : "No success criteria configured.",
  };
}

function parsePersistedReportingSelection(
  raw: string | null,
  fallback: PersistedReportingSelection,
): PersistedReportingSelection {
  try {
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

export function InitiativesScreen() {
  const initialRange = useMemo(() => buildRelativeRange(7), []);
  const initialReportingSelection = useMemo(() => readPersistedReportingSelection(initialRange), [initialRange]);
  const browserTimezone = useMemo(() => {
    if (typeof window === "undefined") return "UTC";
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  }, []);
  const hasHydratedReportingSelectionFromStore = useRef(false);

  const [epicSummary, setEpicSummary] = useState<InitiativeEpicSummary[]>([]);
  const [allConfiguredEpicSummary, setAllConfiguredEpicSummary] = useState<InitiativeEpicSummary[]>([]);
  const [reportingPeriod, setReportingPeriod] = useState<ConfiguredEpicSummaryResponse["reportingPeriod"]>(undefined);
  const [initiativeViews, setInitiativeViews] = useState<InitiativeView[]>([]);
  const [activeViewId, setActiveViewId] = useState<InitiativeViewId>(readPersistedInitiativeViewId);
  const [jiraBaseUrl, setJiraBaseUrl] = useState<string | null>(null);
  const [aiProviderName, setAiProviderName] = useState("AI");
  const [epicLookup, setEpicLookup] = useState<EpicLookupConfig>({ groups: [], workTypes: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [metaSuccess, setMetaSuccess] = useState<string | null>(null);
  const [viewError, setViewError] = useState<string | null>(null);
  const [reportingPreset, setReportingPreset] = useState<ReportingPreset>(initialReportingSelection.preset);
  const [reportingStartDraft, setReportingStartDraft] = useState(initialReportingSelection.startDate);
  const [reportingEndDraft, setReportingEndDraft] = useState(initialReportingSelection.endDate);
  const [reportingRange, setReportingRange] = useState<ReportingRange>({
    startDate: initialReportingSelection.startDate,
    endDate: initialReportingSelection.endDate,
  });
  const [reportingValidationError, setReportingValidationError] = useState<string | null>(null);
  const [isReportingConfigOpen, setIsReportingConfigOpen] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [ragFilter, setRagFilter] = useState<"all" | RagLabel>("all");
  const [positiveDeltaOnly, setPositiveDeltaOnly] = useState(false);
  const [timeBoundOnly, setTimeBoundOnly] = useState(false);
  const [visibleOptionalColumns, setVisibleOptionalColumns] = useState<OptionalColumnId[]>(readPersistedVisibleOptionalColumns);
  const [sortField, setSortField] = useState<SortField>("epic");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [isColumnOverlayOpen, setIsColumnOverlayOpen] = useState(false);

  const [isViewEditorOpen, setIsViewEditorOpen] = useState(false);
  const [viewEditorMode, setViewEditorMode] = useState<ViewEditorMode>("create");
  const [viewEditorSaving, setViewEditorSaving] = useState(false);
  const [viewEditorError, setViewEditorError] = useState<string | null>(null);
  const [editingView, setEditingView] = useState<InitiativeView | null>(null);
  const [viewNameDraft, setViewNameDraft] = useState("");
  const [viewDescriptionDraft, setViewDescriptionDraft] = useState("");
  const [viewEpicQuery, setViewEpicQuery] = useState("");
  const [viewDraftEpicKeys, setViewDraftEpicKeys] = useState<string[]>([]);
  const [pendingDeleteView, setPendingDeleteView] = useState<InitiativeView | null>(null);
  const [deletingViewId, setDeletingViewId] = useState<number | null>(null);

  const [isConfigureOpen, setIsConfigureOpen] = useState(false);
  const [configureSaving, setConfigureSaving] = useState(false);
  const [configureError, setConfigureError] = useState<string | null>(null);
  const [configureSearchQuery, setConfigureSearchQuery] = useState("");
  const [configureCandidates, setConfigureCandidates] = useState<EpicCandidate[]>([]);
  const [configureCandidatesLoading, setConfigureCandidatesLoading] = useState(false);
  const [configureCandidatesError, setConfigureCandidatesError] = useState<string | null>(null);
  const [isConfigureSearchFocused, setIsConfigureSearchFocused] = useState(false);
  const [selectedConfigureCandidate, setSelectedConfigureCandidate] = useState<EpicCandidate | null>(null);
  const [configureSelectedGroupId, setConfigureSelectedGroupId] = useState("");
  const [configureSelectedWorkTypeId, setConfigureSelectedWorkTypeId] = useState("");
  const [configureSuccessCriteriaText, setConfigureSuccessCriteriaText] = useState("");
  const [configureTimelineEnabled, setConfigureTimelineEnabled] = useState(false);
  const [configureTimelineStartDate, setConfigureTimelineStartDate] = useState("");
  const [configureTargetCompletionDate, setConfigureTargetCompletionDate] = useState("");

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editingEpic, setEditingEpic] = useState<SummaryRow | null>(null);
  const [editSelectedGroupId, setEditSelectedGroupId] = useState("");
  const [editSelectedWorkTypeId, setEditSelectedWorkTypeId] = useState("");
  const [editSuccessCriteriaText, setEditSuccessCriteriaText] = useState("");
  const [editTimelineEnabled, setEditTimelineEnabled] = useState(false);
  const [editTimelineStartDate, setEditTimelineStartDate] = useState("");
  const [editTargetCompletionDate, setEditTargetCompletionDate] = useState("");

  const [pendingDeleteEpic, setPendingDeleteEpic] = useState<SummaryRow | null>(null);
  const [deletingEpicKey, setDeletingEpicKey] = useState<string | null>(null);
  const [completedSummaryContext, setCompletedSummaryContext] = useState<CompletedSummaryContext | null>(null);
  const [completedSummaryCards, setCompletedSummaryCards] = useState<EpicCompletedCard[]>([]);
  const [completedSummaryPerEpicCounts, setCompletedSummaryPerEpicCounts] = useState<Record<string, number>>({});
  const [completedSummaryReportingPeriod, setCompletedSummaryReportingPeriod] = useState<
    ConfiguredEpicSummaryResponse["reportingPeriod"]
  >(undefined);
  const [completedSummaryCount, setCompletedSummaryCount] = useState(0);
  const [completedSummaryTruncated, setCompletedSummaryTruncated] = useState(false);
  const [completedSummaryLoading, setCompletedSummaryLoading] = useState(false);
  const [completedSummaryError, setCompletedSummaryError] = useState<string | null>(null);
  const [completedSummaryText, setCompletedSummaryText] = useState("");
  const [completedSummaryTextLoading, setCompletedSummaryTextLoading] = useState(false);
  const [completedSummaryTextError, setCompletedSummaryTextError] = useState<string | null>(null);
  const [completedSummaryModelId, setCompletedSummaryModelId] = useState<string | null>(null);
  const [completedSummaryGeneratedAt, setCompletedSummaryGeneratedAt] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const selectedViewId = activeViewId === "all" ? null : activeViewId;
      const [summaryResult, allSummaryResult, jiraResult, aiStatusResult] = await Promise.allSettled([
        fetchConfiguredEpicSummary(200, {
          periodStart: reportingRange.startDate,
          periodEnd: reportingRange.endDate,
          timezone: browserTimezone,
          viewId: selectedViewId,
        }),
        selectedViewId === null
          ? Promise.resolve(null)
          : fetchConfiguredEpicSummary(200, {
              periodStart: reportingRange.startDate,
              periodEnd: reportingRange.endDate,
              timezone: browserTimezone,
            }),
        fetchJiraIntegrationStatus(),
        fetchAiIntegrationStatus(),
      ]);

      if (summaryResult.status === "rejected") {
        throw summaryResult.reason;
      }

      setEpicSummary(summaryResult.value.epics ?? []);
      if (selectedViewId === null) {
        setAllConfiguredEpicSummary(summaryResult.value.epics ?? []);
      } else if (allSummaryResult.status === "fulfilled" && allSummaryResult.value) {
        setAllConfiguredEpicSummary(allSummaryResult.value.epics ?? []);
      } else {
        setAllConfiguredEpicSummary([]);
      }
      setReportingPeriod(summaryResult.value.reportingPeriod);

      if (jiraResult.status === "fulfilled") {
        setJiraBaseUrl(
          jiraResult.value.config.baseUrl
            ? jiraResult.value.config.baseUrl.replace(/\/$/, "")
            : null,
        );
      } else {
        setJiraBaseUrl(null);
      }

      if (aiStatusResult.status === "fulfilled") {
        setAiProviderName(
          formatAiProviderName(
            aiStatusResult.value.provider ?? aiStatusResult.value.configuredProvider ?? aiStatusResult.value.source,
          ),
        );
      } else {
        setAiProviderName("AI");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown initiative summary request failure.";
      setError(message);
      setEpicSummary([]);
      setAllConfiguredEpicSummary([]);
      setReportingPeriod(undefined);
      setJiraBaseUrl(null);
      setAiProviderName("AI");
    } finally {
      setLoading(false);
    }
  }, [activeViewId, browserTimezone, reportingRange.endDate, reportingRange.startDate]);

  const loadViews = useCallback(async () => {
    try {
      const views = await fetchInitiativeViews();
      setInitiativeViews(views);
      setViewError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown initiative view request failure.";
      setViewError(message);
      setInitiativeViews([]);
    }
  }, []);

  const loadLookup = useCallback(async () => {
    try {
      const lookup = await fetchEpicLookupConfig();
      setEpicLookup(lookup);
      setMetaError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown epic lookup request failure.";
      setMetaError(message);
      setEpicLookup({ groups: [], workTypes: [] });
    }
  }, []);

  const refresh = useCallback(async () => {
    await Promise.all([loadSummary(), loadLookup(), loadViews()]);
  }, [loadLookup, loadSummary, loadViews]);

  useEffect(() => {
    refresh().catch(() => {
      // refresh already updates local state.
    });
  }, [refresh]);

  useEffect(() => {
    if (!metaSuccess) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setMetaSuccess(null);
    }, 2600);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [metaSuccess]);

  useEffect(() => {
    void setPreference(INITIATIVES_VISIBLE_COLUMNS_KEY, JSON.stringify(visibleOptionalColumns));
  }, [visibleOptionalColumns]);

  useEffect(() => {
    void setPreference(INITIATIVES_ACTIVE_VIEW_KEY, String(activeViewId));
  }, [activeViewId]);

  useEffect(() => {
    if (activeViewId === "all" || initiativeViews.length === 0) {
      return;
    }
    const exists = initiativeViews.some((view) => view.id === activeViewId);
    if (!exists) {
      setActiveViewId("all");
    }
  }, [activeViewId, initiativeViews]);

  useEffect(() => {
    const payload: PersistedReportingSelection = {
      preset: reportingPreset,
      startDate: reportingRange.startDate,
      endDate: reportingRange.endDate,
    };
    void setPreference(INITIATIVES_REPORTING_PERIOD_SELECTION_KEY, JSON.stringify(payload));
  }, [reportingPreset, reportingRange.endDate, reportingRange.startDate]);

  useEffect(() => {
    if (hasHydratedReportingSelectionFromStore.current) return;
    hasHydratedReportingSelectionFromStore.current = true;

    let cancelled = false;
    const fallback: PersistedReportingSelection = {
      preset: initialReportingSelection.preset,
      startDate: initialReportingSelection.startDate,
      endDate: initialReportingSelection.endDate,
    };

    void (async () => {
      const raw = await getPreference(INITIATIVES_REPORTING_PERIOD_SELECTION_KEY);
      if (cancelled) return;

      const persisted = parsePersistedReportingSelection(raw, fallback);
      const isSame =
        persisted.preset === reportingPreset
        && persisted.startDate === reportingRange.startDate
        && persisted.endDate === reportingRange.endDate;
      if (isSame) return;

      setReportingPreset(persisted.preset);
      setReportingStartDraft(persisted.startDate);
      setReportingEndDraft(persisted.endDate);
      setReportingRange({
        startDate: persisted.startDate,
        endDate: persisted.endDate,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [
    initialReportingSelection.endDate,
    initialReportingSelection.preset,
    initialReportingSelection.startDate,
    reportingPreset,
    reportingRange.endDate,
    reportingRange.startDate,
  ]);

  const effectivePeriodStart = reportingPeriod?.startDate ?? reportingRange.startDate;
  const effectivePeriodEnd = reportingPeriod?.endDate ?? reportingRange.endDate;
  const effectivePeriodTimezone = reportingPeriod?.timezone ?? browserTimezone;

  const activeReportingPeriodDays = useMemo(() => {
    if (reportingPeriod?.days && Number.isFinite(reportingPeriod.days)) {
      return reportingPeriod.days;
    }
    const startUtc = parseIsoDateToUtcDay(effectivePeriodStart);
    const endUtc = parseIsoDateToUtcDay(effectivePeriodEnd);
    if (startUtc === null || endUtc === null || endUtc < startUtc) return 7;
    return Math.max(1, daysBetweenUtc(startUtc, endUtc) + 1);
  }, [effectivePeriodEnd, effectivePeriodStart, reportingPeriod?.days]);

  const activeReportingPeriod = useMemo<EpicSummaryReportingPeriod>(() => ({
    startDate: effectivePeriodStart,
    endDate: effectivePeriodEnd,
    days: activeReportingPeriodDays,
    timezone: effectivePeriodTimezone,
  }), [activeReportingPeriodDays, effectivePeriodEnd, effectivePeriodStart, effectivePeriodTimezone]);

  const activeReportingPeriodLabel = useMemo(
    () => formatReportingPeriodLabel(effectivePeriodStart, effectivePeriodEnd),
    [effectivePeriodEnd, effectivePeriodStart],
  );

  const effectiveInitiativeViews = useMemo<InitiativeView[]>(() => {
    if (initiativeViews.length > 0) {
      return initiativeViews;
    }
    return [
      {
        id: "all",
        name: "All Configured",
        description: "All epics with metadata configured in TeamBeacon.",
        epicKeys: [],
        epicCount: allConfiguredEpicSummary.length || epicSummary.length,
        isDefault: true,
        updatedAt: null,
      },
    ];
  }, [allConfiguredEpicSummary.length, epicSummary.length, initiativeViews]);

  const activeView = useMemo<InitiativeView>(() => {
    return effectiveInitiativeViews.find((view) => view.id === activeViewId)
      ?? effectiveInitiativeViews.find((view) => view.id === "all")
      ?? {
        id: "all",
        name: "All Configured",
        description: "All epics with metadata configured in TeamBeacon.",
        epicKeys: [],
        epicCount: allConfiguredEpicSummary.length || epicSummary.length,
        isDefault: true,
        updatedAt: null,
      };
  }, [activeViewId, allConfiguredEpicSummary.length, effectiveInitiativeViews, epicSummary.length]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent(INITIATIVES_VIEW_STATE_EVENT, {
        detail: {
          views: effectiveInitiativeViews.map((view) => ({
            id: view.id,
            name: view.name,
            epicCount: view.epicCount,
            isDefault: Boolean(view.isDefault),
          })),
          activeViewId: activeView.id,
        },
      }),
    );
  }, [activeView.id, effectiveInitiativeViews]);

  const applyCustomReportingRange = useCallback((): boolean => {
    if (!reportingStartDraft || !reportingEndDraft) {
      setReportingValidationError("Start and end date are required.");
      return false;
    }

    const startUtc = parseIsoDateToUtcDay(reportingStartDraft);
    const endUtc = parseIsoDateToUtcDay(reportingEndDraft);
    if (startUtc === null || endUtc === null) {
      setReportingValidationError("Invalid reporting period date format.");
      return false;
    }
    if (startUtc > endUtc) {
      setReportingValidationError("Start date cannot be after end date.");
      return false;
    }

    setReportingValidationError(null);
    setReportingRange({
      startDate: reportingStartDraft,
      endDate: reportingEndDraft,
    });
    return true;
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

  const openReportingConfig = useCallback(() => {
    setReportingStartDraft(reportingRange.startDate);
    setReportingEndDraft(reportingRange.endDate);
    setReportingValidationError(null);
    setIsReportingConfigOpen(true);
  }, [reportingRange.endDate, reportingRange.startDate]);

  const closeReportingConfig = useCallback(() => {
    setReportingValidationError(null);
    setIsReportingConfigOpen(false);
  }, []);

  const saveReportingConfig = useCallback(() => {
    if (reportingPreset === "custom" && !applyCustomReportingRange()) {
      return;
    }
    setReportingValidationError(null);
    setIsReportingConfigOpen(false);
  }, [applyCustomReportingRange, reportingPreset]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleOpen = () => {
      openReportingConfig();
    };
    window.addEventListener(OPEN_INITIATIVES_REPORTING_PERIOD_EVENT, handleOpen);
    return () => {
      window.removeEventListener(OPEN_INITIATIVES_REPORTING_PERIOD_EVENT, handleOpen);
    };
  }, [openReportingConfig]);

  const loadConfigureCandidates = useCallback(async (query: string) => {
    setConfigureCandidatesLoading(true);
    setConfigureCandidatesError(null);
    try {
      const candidates = await fetchEpicCandidates(query, 20);
      setConfigureCandidates(candidates);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to search epic candidates.";
      setConfigureCandidates([]);
      setConfigureCandidatesError(message);
    } finally {
      setConfigureCandidatesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isConfigureOpen || !isConfigureSearchFocused) {
      return;
    }
    const timeout = window.setTimeout(() => {
      loadConfigureCandidates(configureSearchQuery).catch(() => {
        // loadConfigureCandidates already updates local state.
      });
    }, 200);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [configureSearchQuery, isConfigureOpen, isConfigureSearchFocused, loadConfigureCandidates]);

  const rows = useMemo<SummaryRow[]>(() => {
    return epicSummary.map(buildSummaryRow);
  }, [epicSummary]);

  const allConfiguredRows = useMemo<SummaryRow[]>(() => {
    return allConfiguredEpicSummary.map(buildSummaryRow);
  }, [allConfiguredEpicSummary]);

  const viewSelectedRows = useMemo(() => {
    const rowByKey = new Map(allConfiguredRows.map((row) => [row.epicKey, row]));
    return viewDraftEpicKeys
      .map((epicKey) => rowByKey.get(epicKey))
      .filter((row): row is SummaryRow => Boolean(row));
  }, [allConfiguredRows, viewDraftEpicKeys]);

  const viewAvailableRows = useMemo(() => {
    const selected = new Set(viewDraftEpicKeys);
    const query = viewEpicQuery.trim().toLowerCase();
    return allConfiguredRows.filter((row) => {
      if (selected.has(row.epicKey)) {
        return false;
      }
      if (!query) {
        return true;
      }
      return (
        row.epicKey.toLowerCase().includes(query)
        || row.epicName.toLowerCase().includes(query)
        || row.groupText.toLowerCase().includes(query)
        || row.typeText.toLowerCase().includes(query)
      );
    });
  }, [allConfiguredRows, viewDraftEpicKeys, viewEpicQuery]);

  const groupOptions = useMemo(() => {
    const unique = new Set<string>();
    for (const row of rows) {
      for (const group of row.groups) {
        if (group.name.trim()) {
          unique.add(group.name.trim());
        }
      }
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const typeOptions = useMemo(() => {
    const unique = new Set<string>();
    for (const row of rows) {
      for (const type of row.workTypes) {
        if (type.name.trim()) {
          unique.add(type.name.trim());
        }
      }
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return rows.filter((row) => {
      if (groupFilter !== "all" && !row.groups.some((group) => group.name === groupFilter)) {
        return false;
      }
      if (typeFilter !== "all" && !row.workTypes.some((type) => type.name === typeFilter)) {
        return false;
      }
      if (ragFilter !== "all" && row.ragLabel !== ragFilter) {
        return false;
      }
      if (positiveDeltaOnly && row.completedInPeriodValue <= 0) {
        return false;
      }
      if (timeBoundOnly && !row.timelineEnabled) {
        return false;
      }
      if (!query) {
        return true;
      }
      const criteriaText = row.successCriteria.join(" ").toLowerCase();
      return (
        row.epicKey.toLowerCase().includes(query)
        || row.epicName.toLowerCase().includes(query)
        || row.groupText.toLowerCase().includes(query)
        || row.typeText.toLowerCase().includes(query)
        || criteriaText.includes(query)
      );
    });
  }, [groupFilter, positiveDeltaOnly, ragFilter, rows, searchQuery, timeBoundOnly, typeFilter]);

  const visibleColumnSet = useMemo(() => new Set(visibleOptionalColumns), [visibleOptionalColumns]);

  useEffect(() => {
    if (sortField === "epic") {
      return;
    }
    if (!visibleColumnSet.has(sortField)) {
      setSortField("epic");
    }
  }, [sortField, visibleColumnSet]);

  const sortedRows = useMemo(() => {
    const nextRows = [...filteredRows];
    nextRows.sort((left, right) => {
      let comparison = 0;
      switch (sortField) {
        case "epic":
          comparison = compareText(epicDisplaySortText(left), epicDisplaySortText(right));
          break;
        case "group":
          comparison = compareText(left.groupText, right.groupText);
          break;
        case "type":
          comparison = compareText(left.typeText, right.typeText);
          break;
        case "progress":
          comparison = compareNumber(left.completionPercent, right.completionPercent);
          break;
        case "completed":
          comparison = compareNumber(left.deltaPercentValue, right.deltaPercentValue);
          break;
        case "delta":
          comparison = compareNumber(left.completedInPeriodValue, right.completedInPeriodValue);
          break;
        case "rag":
          comparison = compareNumber(RAG_SORT_RANK[left.ragLabel], RAG_SORT_RANK[right.ragLabel]);
          break;
        case "criteria":
          comparison = compareNumber(left.successCriteria.length, right.successCriteria.length);
          break;
      }

      if (comparison === 0) {
        comparison = compareText(left.epicKey, right.epicKey);
      }
      return sortDirection === "asc" ? comparison : -comparison;
    });
    return nextRows;
  }, [filteredRows, sortDirection, sortField]);

  const tableColumnCount = 2 + visibleOptionalColumns.length;

  const handleSortHeaderClick = useCallback((field: SortField) => {
    setSortField((current) => {
      if (current === field) {
        setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
        return current;
      }
      setSortDirection("asc");
      return field;
    });
  }, []);

  const toggleColumnVisibility = useCallback((columnId: OptionalColumnId) => {
    setVisibleOptionalColumns((current) => {
      if (current.includes(columnId)) {
        return current.filter((value) => value !== columnId);
      }
      const nextSet = new Set<OptionalColumnId>(current);
      nextSet.add(columnId);
      return OPTIONAL_COLUMN_DEFINITIONS
        .map((column) => column.id)
        .filter((column) => nextSet.has(column));
    });
  }, []);

  const showAllColumns = useCallback(() => {
    setVisibleOptionalColumns(DEFAULT_VISIBLE_OPTIONAL_COLUMNS);
  }, []);

  const addViewDraftEpicKey = useCallback((epicKey: string) => {
    setViewDraftEpicKeys((current) => {
      if (current.includes(epicKey)) return current;
      return [...current, epicKey];
    });
  }, []);

  const removeViewDraftEpicKey = useCallback((epicKey: string) => {
    setViewDraftEpicKeys((current) => current.filter((key) => key !== epicKey));
  }, []);

  const openCreateViewDialog = useCallback(() => {
    setMetaError(null);
    setMetaSuccess(null);
    setViewEditorError(null);
    setViewEditorMode("create");
    setEditingView(null);
    setViewNameDraft("");
    setViewDescriptionDraft("");
    setViewEpicQuery("");
    setViewDraftEpicKeys([]);
    setIsViewEditorOpen(true);
  }, []);

  const openEditViewDialog = useCallback((view: InitiativeView) => {
    if (view.id === "all") {
      return;
    }
    setMetaError(null);
    setMetaSuccess(null);
    setViewEditorError(null);
    setViewEditorMode("edit");
    setEditingView(view);
    setViewNameDraft(view.name);
    setViewDescriptionDraft(view.description ?? "");
    setViewEpicQuery("");
    setViewDraftEpicKeys(view.epicKeys ?? []);
    setIsViewEditorOpen(true);
  }, []);

  const closeViewEditor = useCallback(() => {
    if (viewEditorSaving) {
      return;
    }
    setIsViewEditorOpen(false);
    setEditingView(null);
    setViewEditorError(null);
  }, [viewEditorSaving]);

  const saveViewEditor = useCallback(async () => {
    const name = viewNameDraft.trim();
    if (!name) {
      setViewEditorError("View name is required.");
      return;
    }

    setViewEditorSaving(true);
    setViewEditorError(null);
    setMetaError(null);
    setMetaSuccess(null);
    try {
      const description = viewDescriptionDraft.trim() || null;
      const saved = viewEditorMode === "edit" && editingView && typeof editingView.id === "number"
        ? await updateInitiativeView({
            id: editingView.id,
            name,
            description,
            epicKeys: viewDraftEpicKeys,
          })
        : await createInitiativeView({
            name,
            description,
            epicKeys: viewDraftEpicKeys,
          });

      await loadViews();
      if (saved.id !== "all") {
        setActiveViewId(saved.id);
      }
      if (viewEditorMode === "edit") {
        await loadSummary();
      }
      setMetaSuccess(`Initiative view ${viewEditorMode === "edit" ? "updated" : "created"}: ${saved.name}.`);
      setIsViewEditorOpen(false);
      setEditingView(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save initiative view.";
      setViewEditorError(message);
    } finally {
      setViewEditorSaving(false);
    }
  }, [
    editingView,
    loadSummary,
    loadViews,
    viewDescriptionDraft,
    viewDraftEpicKeys,
    viewEditorMode,
    viewNameDraft,
  ]);

  const confirmDeleteView = useCallback(async () => {
    if (!pendingDeleteView || typeof pendingDeleteView.id !== "number") {
      return;
    }
    const viewId = pendingDeleteView.id;
    setDeletingViewId(viewId);
    setMetaError(null);
    setMetaSuccess(null);
    try {
      await deleteInitiativeView(viewId);
      await loadViews();
      if (activeViewId === viewId) {
        setActiveViewId("all");
      } else {
        await loadSummary();
      }
      setMetaSuccess(`Initiative view deleted: ${pendingDeleteView.name}.`);
      setPendingDeleteView(null);
      if (editingView?.id === viewId) {
        setIsViewEditorOpen(false);
        setEditingView(null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete initiative view.";
      setMetaError(message);
    } finally {
      setDeletingViewId(null);
    }
  }, [activeViewId, editingView?.id, loadSummary, loadViews, pendingDeleteView]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleSetActiveView = (event: Event) => {
      const detail = (event as CustomEvent<{ viewId?: InitiativeViewId | string | number }>).detail;
      const nextViewId = detail?.viewId;
      if (nextViewId === "all") {
        setActiveViewId("all");
        return;
      }
      const parsed = Number(nextViewId);
      if (Number.isInteger(parsed) && parsed > 0) {
        setActiveViewId(parsed);
      }
    };
    window.addEventListener(SET_INITIATIVES_ACTIVE_VIEW_EVENT, handleSetActiveView);
    return () => {
      window.removeEventListener(SET_INITIATIVES_ACTIVE_VIEW_EVENT, handleSetActiveView);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleManageView = () => {
      if (activeView.id === "all") {
        openCreateViewDialog();
        return;
      }
      openEditViewDialog(activeView);
    };
    window.addEventListener(OPEN_INITIATIVES_MANAGE_VIEW_EVENT, handleManageView);
    return () => {
      window.removeEventListener(OPEN_INITIATIVES_MANAGE_VIEW_EVENT, handleManageView);
    };
  }, [activeView, openCreateViewDialog, openEditViewDialog]);

  const openColumnOverlay = useCallback(() => {
    setIsColumnOverlayOpen(true);
  }, []);

  const closeColumnOverlay = useCallback(() => {
    setIsColumnOverlayOpen(false);
  }, []);

  const totalConfigured = rows.length;
  const averageCompletion = useMemo(() => {
    if (rows.length === 0) return 0;
    const total = rows.reduce((sum, row) => sum + Math.max(0, Math.min(100, row.completionPercent)), 0);
    return total / rows.length;
  }, [rows]);
  const ragCounts = useMemo<Record<RagLabel, number>>(() => {
    const counts: Record<RagLabel, number> = { Red: 0, Amber: 0, Green: 0 };
    for (const row of rows) {
      counts[row.ragLabel] += 1;
    }
    return counts;
  }, [rows]);
  const completedInPeriodTotal = useMemo(
    () => rows.reduce((sum, row) => sum + row.completedInPeriodValue, 0),
    [rows],
  );

  const openConfigureDialog = useCallback(() => {
    setMetaError(null);
    setMetaSuccess(null);
    setConfigureError(null);
    setConfigureSearchQuery("");
    setConfigureCandidates([]);
    setConfigureCandidatesError(null);
    setIsConfigureSearchFocused(false);
    setSelectedConfigureCandidate(null);
    setConfigureSelectedGroupId("");
    setConfigureSelectedWorkTypeId("");
    setConfigureSuccessCriteriaText("");
    setConfigureTimelineEnabled(false);
    setConfigureTimelineStartDate("");
    setConfigureTargetCompletionDate("");
    setIsConfigureOpen(true);
  }, []);

  const closeConfigureDialog = useCallback(() => {
    if (configureSaving) {
      return;
    }
    setIsConfigureSearchFocused(false);
    setIsConfigureOpen(false);
  }, [configureSaving]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleOpen = () => {
      openConfigureDialog();
    };
    window.addEventListener(OPEN_INITIATIVES_CONFIGURE_EVENT, handleOpen);
    return () => {
      window.removeEventListener(OPEN_INITIATIVES_CONFIGURE_EVENT, handleOpen);
    };
  }, [openConfigureDialog]);

  const openEditDialog = useCallback((entry: SummaryRow) => {
    setMetaError(null);
    setMetaSuccess(null);
    setEditError(null);
    setEditingEpic(entry);
    setEditSelectedGroupId(entry.groups[0] ? String(entry.groups[0].id) : "");
    setEditSelectedWorkTypeId(entry.workTypes[0] ? String(entry.workTypes[0].id) : "");
    setEditSuccessCriteriaText(entry.successCriteria.join("\n"));
    setEditTimelineEnabled(Boolean(entry.timelineEnabled));
    setEditTimelineStartDate(normalizeDateInputValue(entry.timelineStartDate));
    setEditTargetCompletionDate(normalizeDateInputValue(entry.targetCompletionDate));
    setIsEditOpen(true);
  }, []);

  const closeEditDialog = useCallback(() => {
    if (editSaving) {
      return;
    }
    setIsEditOpen(false);
    setEditingEpic(null);
  }, [editSaving]);

  const saveConfiguredEpic = useCallback(async () => {
    if (!selectedConfigureCandidate) {
      setConfigureError("Please select an epic to configure.");
      return;
    }
    if (configureTimelineEnabled && !configureTargetCompletionDate.trim()) {
      setConfigureError("Target completion date is required when timeline is enabled.");
      return;
    }
    if (
      configureTimelineEnabled
      && configureTimelineStartDate.trim()
      && configureTargetCompletionDate.trim()
      && configureTimelineStartDate.trim() > configureTargetCompletionDate.trim()
    ) {
      setConfigureError("Timeline start date cannot be after target completion date.");
      return;
    }

    const criteria = configureSuccessCriteriaText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    setConfigureSaving(true);
    setConfigureError(null);
    setMetaError(null);
    setMetaSuccess(null);
    try {
      await upsertEpicMetadata({
        epicKey: selectedConfigureCandidate.epicKey,
        successCriteria: criteria,
        groupIds: toSingleIdArray(configureSelectedGroupId),
        workTypeIds: toSingleIdArray(configureSelectedWorkTypeId),
        timelineEnabled: configureTimelineEnabled,
        timelineStartDate: configureTimelineEnabled ? configureTimelineStartDate.trim() || null : null,
        targetCompletionDate: configureTimelineEnabled ? configureTargetCompletionDate.trim() : null,
      });
      await loadSummary();
      setMetaSuccess(`Epic metadata saved for ${selectedConfigureCandidate.epicKey}.`);
      setIsConfigureOpen(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save epic metadata.";
      setConfigureError(message);
    } finally {
      setConfigureSaving(false);
    }
  }, [
    configureSelectedGroupId,
    configureSelectedWorkTypeId,
    configureSuccessCriteriaText,
    configureTargetCompletionDate,
    configureTimelineEnabled,
    configureTimelineStartDate,
    loadSummary,
    selectedConfigureCandidate,
  ]);

  const saveEditedEpic = useCallback(async () => {
    if (!editingEpic) {
      return;
    }
    if (editTimelineEnabled && !editTargetCompletionDate.trim()) {
      setEditError("Target completion date is required when timeline is enabled.");
      return;
    }
    if (
      editTimelineEnabled
      && editTimelineStartDate.trim()
      && editTargetCompletionDate.trim()
      && editTimelineStartDate.trim() > editTargetCompletionDate.trim()
    ) {
      setEditError("Timeline start date cannot be after target completion date.");
      return;
    }

    const criteria = editSuccessCriteriaText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    setEditSaving(true);
    setEditError(null);
    setMetaError(null);
    setMetaSuccess(null);
    try {
      await upsertEpicMetadata({
        epicKey: editingEpic.epicKey,
        successCriteria: criteria,
        groupIds: toSingleIdArray(editSelectedGroupId),
        workTypeIds: toSingleIdArray(editSelectedWorkTypeId),
        timelineEnabled: editTimelineEnabled,
        timelineStartDate: editTimelineEnabled ? editTimelineStartDate.trim() || null : null,
        targetCompletionDate: editTimelineEnabled ? editTargetCompletionDate.trim() : null,
      });
      await loadSummary();
      setMetaSuccess(`Epic metadata updated for ${editingEpic.epicKey}.`);
      setIsEditOpen(false);
      setEditingEpic(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update epic metadata.";
      setEditError(message);
    } finally {
      setEditSaving(false);
    }
  }, [
    editSelectedGroupId,
    editSelectedWorkTypeId,
    editSuccessCriteriaText,
    editTargetCompletionDate,
    editTimelineEnabled,
    editTimelineStartDate,
    editingEpic,
    loadSummary,
  ]);

  const confirmDeleteEpic = useCallback(async () => {
    if (!pendingDeleteEpic) {
      return;
    }
    const epicKey = pendingDeleteEpic.epicKey;
    setDeletingEpicKey(epicKey);
    setMetaError(null);
    setMetaSuccess(null);
    try {
      await deleteEpicMetadata(epicKey);
      await loadSummary();
      if (editingEpic?.epicKey === epicKey) {
        setIsEditOpen(false);
        setEditingEpic(null);
      }
      setPendingDeleteEpic(null);
      setMetaSuccess(`Epic configuration removed for ${epicKey}.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to remove epic configuration.";
      setMetaError(message);
    } finally {
      setDeletingEpicKey(null);
    }
  }, [editingEpic?.epicKey, loadSummary, pendingDeleteEpic]);

  const closeCompletedSummary = useCallback(() => {
    setCompletedSummaryContext(null);
    setCompletedSummaryCards([]);
    setCompletedSummaryPerEpicCounts({});
    setCompletedSummaryReportingPeriod(undefined);
    setCompletedSummaryCount(0);
    setCompletedSummaryTruncated(false);
    setCompletedSummaryLoading(false);
    setCompletedSummaryError(null);
    setCompletedSummaryText("");
    setCompletedSummaryTextLoading(false);
    setCompletedSummaryTextError(null);
    setCompletedSummaryModelId(null);
    setCompletedSummaryGeneratedAt(null);
  }, []);

  const openCompletedSummary = useCallback(async (row: SummaryRow) => {
    setCompletedSummaryContext({
      scope: "epic",
      epicKey: row.epicKey,
      epicName: row.epicName || "(Untitled epic)",
    });
    setCompletedSummaryCards([]);
    setCompletedSummaryPerEpicCounts({});
    setCompletedSummaryReportingPeriod(activeReportingPeriod);
    setCompletedSummaryCount(0);
    setCompletedSummaryTruncated(false);
    setCompletedSummaryLoading(true);
    setCompletedSummaryError(null);
    setCompletedSummaryText("");
    setCompletedSummaryTextLoading(false);
    setCompletedSummaryTextError(null);
    setCompletedSummaryModelId(null);
    setCompletedSummaryGeneratedAt(null);

    const timezone = activeReportingPeriod.timezone
      || Intl.DateTimeFormat().resolvedOptions().timeZone
      || "UTC";
    try {
      const payload = await fetchEpicCompletedCards(row.epicKey, {
        limit: 250,
        periodStart: activeReportingPeriod.startDate,
        periodEnd: activeReportingPeriod.endDate,
        timezone,
      });
      const completedCards = payload.completedCards ?? [];
      const count = Number.isFinite(payload.count) ? payload.count : completedCards.length;
      setCompletedSummaryCards(completedCards);
      setCompletedSummaryPerEpicCounts({ [row.epicKey]: count });
      setCompletedSummaryCount(count);
      setCompletedSummaryTruncated(Boolean(payload.truncated));
      setCompletedSummaryReportingPeriod(payload.reportingPeriod ?? activeReportingPeriod);

      if (count <= 0 || completedCards.length === 0) {
        setCompletedSummaryText("No completed cards were found for this reporting period.");
        return;
      }

      setCompletedSummaryTextLoading(true);
      const effectivePeriod = payload.reportingPeriod ?? activeReportingPeriod;
      const prompt = buildCompletedCardsSummaryPrompt({
        epicName: row.epicName || "(Untitled epic)",
        reportingPeriodText: periodLabel(effectivePeriod),
        completedCards,
        expectedCount: count,
      });
      try {
        const aiPayload = await chatWithOciGenAi({
          message: prompt,
          maxTokens: aiProviderName === "Ollama" ? 280 : 420,
          temperature: 0.2,
          topP: 0.8,
          topK: 0,
          frequencyPenalty: 0,
        });
        setAiProviderName(
          formatAiProviderName(aiPayload.provider ?? aiPayload.configuredProvider ?? aiPayload.source),
        );
        const summaryText = aiPayload.response?.text?.trim();
        if (!summaryText) {
          throw new Error("AI provider returned an empty completed-card summary.");
        }
        setCompletedSummaryText(summaryText);
        setCompletedSummaryModelId(aiPayload.modelId);
        setCompletedSummaryGeneratedAt(new Date().toISOString());
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to generate completed-card summary.";
        setCompletedSummaryTextError(message);
        setCompletedSummaryText("Unable to generate completed-card summary from AI provider.");
      } finally {
        setCompletedSummaryTextLoading(false);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load completed cards for this epic.";
      setCompletedSummaryError(message);
    } finally {
      setCompletedSummaryLoading(false);
    }
  }, [activeReportingPeriod, aiProviderName]);

  const openConfiguredCompletedSummary = useCallback(async () => {
    setCompletedSummaryContext({
      scope: "configured",
      viewName: activeView.name,
      isAllConfigured: activeView.id === "all",
    });
    setCompletedSummaryCards([]);
    setCompletedSummaryPerEpicCounts({});
    setCompletedSummaryReportingPeriod(activeReportingPeriod);
    setCompletedSummaryCount(0);
    setCompletedSummaryTruncated(false);
    setCompletedSummaryLoading(true);
    setCompletedSummaryError(null);
    setCompletedSummaryText("");
    setCompletedSummaryTextLoading(false);
    setCompletedSummaryTextError(null);
    setCompletedSummaryModelId(null);
    setCompletedSummaryGeneratedAt(null);

    const timezone = activeReportingPeriod.timezone
      || Intl.DateTimeFormat().resolvedOptions().timeZone
      || "UTC";
    try {
      const payload = await fetchConfiguredEpicsCompletedCards({
        limit: 350,
        periodStart: activeReportingPeriod.startDate,
        periodEnd: activeReportingPeriod.endDate,
        timezone,
        viewId: activeView.id,
      });

      const completedCards = payload.completedCards ?? [];
      const count = Number.isFinite(payload.count) ? payload.count : completedCards.length;
      const perEpicCounts = payload.perEpicCounts ?? {};
      setCompletedSummaryCards(completedCards);
      setCompletedSummaryPerEpicCounts(perEpicCounts);
      setCompletedSummaryCount(count);
      setCompletedSummaryTruncated(Boolean(payload.truncated));
      setCompletedSummaryReportingPeriod(payload.reportingPeriod ?? activeReportingPeriod);

      if (count <= 0 || completedCards.length === 0) {
        setCompletedSummaryText("No completed cards were found for this reporting period.");
        return;
      }

      setCompletedSummaryTextLoading(true);
      const effectivePeriod = payload.reportingPeriod ?? activeReportingPeriod;
      const prompt = buildConfiguredCompletedCardsSummaryPrompt({
        reportingPeriodText: periodLabel(effectivePeriod),
        completedCards,
        expectedCount: count,
        perEpicCounts,
        scopeLabel: activeView.id === "all" ? "all configured initiatives" : `the ${activeView.name} initiative view`,
      });
      try {
        const aiPayload = await chatWithOciGenAi({
          message: prompt,
          maxTokens: aiProviderName === "Ollama" ? 320 : 500,
          temperature: 0.2,
          topP: 0.8,
          topK: 0,
          frequencyPenalty: 0,
        });
        setAiProviderName(
          formatAiProviderName(aiPayload.provider ?? aiPayload.configuredProvider ?? aiPayload.source),
        );
        const summaryText = aiPayload.response?.text?.trim();
        if (!summaryText) {
          throw new Error("AI provider returned an empty completed-card summary.");
        }
        setCompletedSummaryText(summaryText);
        setCompletedSummaryModelId(aiPayload.modelId);
        setCompletedSummaryGeneratedAt(new Date().toISOString());
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to generate completed-card summary.";
        setCompletedSummaryTextError(message);
        setCompletedSummaryText("Unable to generate completed-card summary from AI provider.");
      } finally {
        setCompletedSummaryTextLoading(false);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load completed cards for configured initiatives.";
      setCompletedSummaryError(message);
    } finally {
      setCompletedSummaryLoading(false);
    }
  }, [activeReportingPeriod, activeView.id, activeView.name, aiProviderName]);

  return (
    <div class="tb-screen-grid">
      <div class="tb-initiative-context-bar">
        <p class="tb-muted-note tb-initiative-period">Reporting period: {periodLabel(reportingPeriod ?? activeReportingPeriod)}</p>
        <button type="button" class="tb-btn tb-btn-sm tb-no-print" onClick={openReportingConfig}>
          Reporting Period
        </button>
      </div>

      <section class="tb-panel">
        <header class="tb-panel-header">
          <div>
            <h3>Configured Initiative Summary</h3>
          </div>
        </header>

        <div class="tb-metrics-grid tb-four-up">
          <article class="tb-metric-card">
            <h4>Configured Epics</h4>
            <strong class="tb-value">{totalConfigured}</strong>
            <p>{activeView.id === "all" ? "Epics with metadata configured in TeamBeacon." : `Epics in ${activeView.name}.`}</p>
          </article>
          <article class="tb-metric-card">
            <h4>Avg Completion</h4>
            <strong class="tb-value tb-value-good">{formatPercent(averageCompletion)}</strong>
            <p>Average completion percentage across configured epics.</p>
          </article>
          <article class="tb-metric-card">
            <h4>Initiative RAG</h4>
            <strong class="tb-value tb-value-rag">
              <span class="tb-initiative-rag-breakdown">
                <span class="tb-initiative-rag-text tb-initiative-rag-red">{ragCounts.Red} Red</span>
                <span class="tb-initiative-rag-separator">|</span>
                <span class="tb-initiative-rag-text tb-initiative-rag-amber">{ragCounts.Amber} Amber</span>
                <span class="tb-initiative-rag-separator">|</span>
                <span class="tb-initiative-rag-text tb-initiative-rag-green">{ragCounts.Green} Green</span>
              </span>
            </strong>
            <p>{activeView.id === "all" ? "For configured initiatives." : "For selected initiative view."}</p>
          </article>
          <article class="tb-metric-card">
            <h4>Completed In Period</h4>
            <strong class="tb-value">
              <button
                type="button"
                class="tb-initiative-period-trigger tb-initiative-period-trigger-metric"
                onClick={() => void openConfiguredCompletedSummary()}
                aria-label="Summarize completed cards across configured initiatives"
              >
                {completedInPeriodTotal}
              </button>
            </strong>
            <p>Total issues completed in current reporting period.</p>
          </article>
        </div>

        {error && !loading ? <p class="tb-error-note">Initiative summary: {error}</p> : null}
        {metaError ? <p class="tb-error-note">Epic metadata: {metaError}</p> : null}
        {viewError ? <p class="tb-error-note">Initiative views: {viewError}</p> : null}
      </section>

      <section class="tb-panel">
        <header class="tb-panel-header">
          <div class="tb-initiative-matrix-title">
            <h3>Initiative Progress Matrix</h3>
            <span class="tb-chip tb-initiative-visible-count">{filteredRows.length} visible</span>
          </div>
          <div class="tb-panel-header-actions">
            <button type="button" class="tb-btn tb-btn-sm tb-initiative-matrix-action" onClick={openColumnOverlay}>
              Columns
            </button>
          </div>
        </header>

        <div class="tb-initiative-toolbar">
          <label class="tb-initiative-filter">
            <span>Search</span>
            <input
              type="text"
              placeholder="Epic key, name, group, type..."
              value={searchQuery}
              onInput={(event) => setSearchQuery((event.currentTarget as HTMLInputElement).value)}
            />
          </label>

          <label class="tb-initiative-filter">
            <span>Group</span>
            <select
              value={groupFilter}
              onChange={(event) => setGroupFilter((event.currentTarget as HTMLSelectElement).value)}
            >
              <option value="all">All groups</option>
              {groupOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>

          <label class="tb-initiative-filter">
            <span>Work Type</span>
            <select
              value={typeFilter}
              onChange={(event) => setTypeFilter((event.currentTarget as HTMLSelectElement).value)}
            >
              <option value="all">All types</option>
              {typeOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>

          <label class="tb-initiative-filter">
            <span>RAG</span>
            <select
              value={ragFilter}
              onChange={(event) => setRagFilter((event.currentTarget as HTMLSelectElement).value as "all" | RagLabel)}
            >
              <option value="all">All</option>
              <option value="Red">Red</option>
              <option value="Amber">Amber</option>
              <option value="Green">Green</option>
            </select>
          </label>

          <div class="tb-initiative-filter tb-initiative-filter-quick">
            <span>Quick Filters</span>
            <div class="tb-initiative-quick-filters" role="group" aria-label="Quick filters">
              <button
                type="button"
                class={`tb-initiative-filter-toggle${positiveDeltaOnly ? " is-active" : ""}`}
                aria-pressed={positiveDeltaOnly}
                onClick={() => setPositiveDeltaOnly((current) => !current)}
              >
                Positive Delta
              </button>
              <button
                type="button"
                class={`tb-initiative-filter-toggle${timeBoundOnly ? " is-active" : ""}`}
                aria-pressed={timeBoundOnly}
                onClick={() => setTimeBoundOnly((current) => !current)}
              >
                Time-bound
              </button>
            </div>
          </div>
        </div>

        <div class="tb-initiative-table-wrap">
          <table class="tb-initiative-table">
            <thead>
              <tr>
                <th>
                  <button
                    type="button"
                    class={`tb-table-sort${sortField === "epic" ? " is-active" : ""}`}
                    onClick={() => handleSortHeaderClick("epic")}
                    aria-label={`Sort by Epic (${sortField === "epic" && sortDirection === "asc" ? "ascending" : "descending"})`}
                  >
                    <span>Epic</span>
                    <span class="tb-table-sort-indicator" aria-hidden="true">
                      {sortField === "epic" ? (sortDirection === "asc" ? "↑" : "↓") : "↕"}
                    </span>
                  </button>
                </th>
                {visibleColumnSet.has("group") ? (
                  <th>
                    <button
                      type="button"
                      class={`tb-table-sort${sortField === "group" ? " is-active" : ""}`}
                      onClick={() => handleSortHeaderClick("group")}
                      aria-label={`Sort by Group (${sortField === "group" && sortDirection === "asc" ? "ascending" : "descending"})`}
                    >
                      <span>Group</span>
                      <span class="tb-table-sort-indicator" aria-hidden="true">
                        {sortField === "group" ? (sortDirection === "asc" ? "↑" : "↓") : "↕"}
                      </span>
                    </button>
                  </th>
                ) : null}
                {visibleColumnSet.has("type") ? (
                  <th>
                    <button
                      type="button"
                      class={`tb-table-sort${sortField === "type" ? " is-active" : ""}`}
                      onClick={() => handleSortHeaderClick("type")}
                      aria-label={`Sort by Type (${sortField === "type" && sortDirection === "asc" ? "ascending" : "descending"})`}
                    >
                      <span>Type</span>
                      <span class="tb-table-sort-indicator" aria-hidden="true">
                        {sortField === "type" ? (sortDirection === "asc" ? "↑" : "↓") : "↕"}
                      </span>
                    </button>
                  </th>
                ) : null}
                {visibleColumnSet.has("progress") ? (
                  <th class="tb-initiative-progress-head">
                    <button
                      type="button"
                      class={`tb-table-sort${sortField === "progress" ? " is-active" : ""}`}
                      onClick={() => handleSortHeaderClick("progress")}
                      aria-label={`Sort by Progress (${sortField === "progress" && sortDirection === "asc" ? "ascending" : "descending"})`}
                    >
                      <span>Progress</span>
                      <span class="tb-table-sort-indicator" aria-hidden="true">
                        {sortField === "progress" ? (sortDirection === "asc" ? "↑" : "↓") : "↕"}
                      </span>
                    </button>
                  </th>
                ) : null}
                {visibleColumnSet.has("completed") ? (
                  <th>
                    <button
                      type="button"
                      class={`tb-table-sort${sortField === "completed" ? " is-active" : ""}`}
                      onClick={() => handleSortHeaderClick("completed")}
                      aria-label={`Sort by Completed (${sortField === "completed" && sortDirection === "asc" ? "ascending" : "descending"})`}
                    >
                      <span>Completed</span>
                      <span class="tb-table-sort-indicator" aria-hidden="true">
                        {sortField === "completed" ? (sortDirection === "asc" ? "↑" : "↓") : "↕"}
                      </span>
                    </button>
                  </th>
                ) : null}
                {visibleColumnSet.has("delta") ? (
                  <th class="tb-initiative-delta-head">
                    <button
                      type="button"
                      class={`tb-table-sort${sortField === "delta" ? " is-active" : ""}`}
                      onClick={() => handleSortHeaderClick("delta")}
                      aria-label={`Sort by Delta (${sortField === "delta" && sortDirection === "asc" ? "ascending" : "descending"})`}
                    >
                      <span>Delta</span>
                      <span class="tb-table-sort-indicator" aria-hidden="true">
                        {sortField === "delta" ? (sortDirection === "asc" ? "↑" : "↓") : "↕"}
                      </span>
                    </button>
                  </th>
                ) : null}
                {visibleColumnSet.has("rag") ? (
                  <th>
                    <button
                      type="button"
                      class={`tb-table-sort${sortField === "rag" ? " is-active" : ""}`}
                      onClick={() => handleSortHeaderClick("rag")}
                      aria-label={`Sort by RAG (${sortField === "rag" && sortDirection === "asc" ? "ascending" : "descending"})`}
                    >
                      <span>RAG</span>
                      <span class="tb-table-sort-indicator" aria-hidden="true">
                        {sortField === "rag" ? (sortDirection === "asc" ? "↑" : "↓") : "↕"}
                      </span>
                    </button>
                  </th>
                ) : null}
                {visibleColumnSet.has("criteria") ? (
                  <th>
                    <button
                      type="button"
                      class={`tb-table-sort${sortField === "criteria" ? " is-active" : ""}`}
                      onClick={() => handleSortHeaderClick("criteria")}
                      aria-label={`Sort by Criteria / Insight (${sortField === "criteria" && sortDirection === "asc" ? "ascending" : "descending"})`}
                    >
                      <span>Criteria / Insight</span>
                      <span class="tb-table-sort-indicator" aria-hidden="true">
                        {sortField === "criteria" ? (sortDirection === "asc" ? "↑" : "↓") : "↕"}
                      </span>
                    </button>
                  </th>
                ) : null}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={tableColumnCount} class="tb-initiative-empty">Loading configured initiatives...</td>
                </tr>
              ) : null}

              {!loading && sortedRows.length === 0 ? (
                <tr>
                  <td colSpan={tableColumnCount} class="tb-initiative-empty">No initiative rows match the active filters.</td>
                </tr>
              ) : null}

              {!loading
                ? sortedRows.map((row) => {
                    const progressPercent = Math.max(0, Math.min(100, row.completionPercent));
                    const epicHref = jiraBaseUrl ? `${jiraBaseUrl}/browse/${encodeURIComponent(row.epicKey)}` : null;
                    return (
                      <tr key={row.epicKey}>
                        <td>
                          <div class="tb-initiative-epic">
                            {epicHref ? (
                              <a href={epicHref} target="_blank" rel="noopener noreferrer" class="tb-initiative-epic-key">
                                {row.epicKey}
                              </a>
                            ) : (
                              <strong class="tb-initiative-epic-key">{row.epicKey}</strong>
                            )}
                            <p class="tb-initiative-epic-name">{row.epicName || "(Untitled epic)"}</p>
                          </div>
                        </td>
                        {visibleColumnSet.has("group") ? <td>{row.groupText}</td> : null}
                        {visibleColumnSet.has("type") ? <td>{row.typeText}</td> : null}
                        {visibleColumnSet.has("progress") ? (
                          <td class="tb-initiative-progress-cell">
                            <div class="tb-initiative-progress">
                              <div class="tb-initiative-progress-track">
                                <span style={{ width: `${progressPercent}%` }} />
                              </div>
                              <span>{Math.round(progressPercent)}% ({row.completedCards}/{row.totalCards})</span>
                            </div>
                          </td>
                        ) : null}
                        {visibleColumnSet.has("completed") ? (
                          <td>
                            <div class="tb-initiative-metric-stack">
                              <strong>{row.completedCards} / {row.totalCards}</strong>
                              <p class="tb-muted-note tb-initiative-metric-detail">
                                <span>Period:</span>
                                <span>{formatPercent(row.deltaPercentValue)}</span>
                              </p>
                            </div>
                          </td>
                        ) : null}
                        {visibleColumnSet.has("delta") ? (
                          <td class="tb-initiative-delta-cell">
                            <button
                              type="button"
                              class="tb-initiative-period-trigger"
                              onClick={() => void openCompletedSummary(row)}
                              aria-label={`Summarize completed cards for ${row.epicKey}`}
                            >
                              {row.completedInPeriodValue}
                            </button>
                          </td>
                        ) : null}
                        {visibleColumnSet.has("rag") ? (
                          <td>
                            <span class={`tb-rag-pill ${ragToneClass(row.ragLabel)}`} title={row.ragReason}>
                              {row.ragLabel}
                            </span>
                          </td>
                        ) : null}
                        {visibleColumnSet.has("criteria") ? (
                          <td>
                            <p class="tb-initiative-insight" title={row.ragReason}>
                              {row.insightComment?.trim() || row.ragReason}
                            </p>
                          </td>
                        ) : null}
                        <td>
                          <div class="tb-action-row">
                            <button type="button" class="tb-btn tb-btn-sm" onClick={() => openEditDialog(row)}>
                              Edit
                            </button>
                            <button
                              type="button"
                              class="tb-btn tb-btn-sm tb-btn-danger"
                              onClick={() => {
                                setMetaError(null);
                                setMetaSuccess(null);
                                setPendingDeleteEpic(row);
                              }}
                              disabled={deletingEpicKey === row.epicKey}
                            >
                              {deletingEpicKey === row.epicKey ? "Removing..." : "Delete"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                : null}
            </tbody>
          </table>
        </div>
      </section>

      {isReportingConfigOpen ? (
        <div class="tb-modal-layer" role="dialog" aria-modal="true" aria-label="Configure Reporting Period">
          <div class="tb-modal-backdrop" onClick={closeReportingConfig} />
          <div class="tb-modal tb-modal-reporting">
            <header class="tb-modal-head">
              <div>
                <h3>Configure Reporting Period</h3>
                <p class="tb-muted-note">Set the reporting window used across Initiative Insights summaries and completed-card analysis.</p>
              </div>
              <div class="tb-action-row">
                <button type="button" class="tb-btn tb-btn-sm" onClick={closeReportingConfig}>
                  Cancel
                </button>
                <button type="button" class="tb-btn tb-btn-sm tb-btn-primary" onClick={saveReportingConfig}>
                  Save
                </button>
              </div>
            </header>

            <div class="tb-exec-period-toolbar">
              <div class={`tb-exec-period-row${reportingPreset === "custom" ? " is-custom" : ""}`}>
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
                  <>
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
                  </>
                ) : null}
              </div>
            </div>

            <p class="tb-muted-note">
              Active period: {activeReportingPeriodLabel} ({activeReportingPeriod.days} days, {activeReportingPeriod.timezone})
            </p>
            {reportingValidationError ? <p class="tb-error-note">{reportingValidationError}</p> : null}
          </div>
        </div>
      ) : null}

      {isColumnOverlayOpen ? (
        <div class="tb-modal-layer" role="dialog" aria-modal="true" aria-label="Select Initiative Columns">
          <div class="tb-modal-backdrop" onClick={closeColumnOverlay} />
          <div class="tb-modal tb-modal-columns">
            <header class="tb-modal-head">
              <h3>Select Columns</h3>
              <button type="button" class="tb-btn tb-btn-sm" onClick={closeColumnOverlay}>
                Close
              </button>
            </header>

            <p class="tb-muted-note">
              Choose which initiative matrix columns are visible. Sorting is applied by clicking any visible header.
            </p>

            <div class="tb-column-overlay-list" role="group" aria-label="Initiative column selection">
              {OPTIONAL_COLUMN_DEFINITIONS.map((column) => (
                <label key={column.id} class="tb-column-toggle">
                  <input
                    type="checkbox"
                    checked={visibleColumnSet.has(column.id)}
                    onChange={() => toggleColumnVisibility(column.id)}
                  />
                  <span>{column.label}</span>
                </label>
              ))}
            </div>

            <footer class="tb-modal-actions">
              <button
                type="button"
                class="tb-btn"
                onClick={showAllColumns}
                disabled={visibleOptionalColumns.length === OPTIONAL_COLUMN_DEFINITIONS.length}
              >
                Show all
              </button>
              <button type="button" class="tb-btn tb-btn-primary" onClick={closeColumnOverlay}>
                Done
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {isViewEditorOpen ? (
        <div
          class="tb-modal-layer"
          role="dialog"
          aria-modal="true"
          aria-label={viewEditorMode === "edit" ? "Edit Initiative View" : "Create Initiative View"}
        >
          <div class="tb-modal-backdrop" onClick={closeViewEditor} />
          <div class="tb-modal tb-modal-wide tb-modal-initiative-view">
            <header class="tb-modal-head">
              <div>
                <h3>{viewEditorMode === "edit" ? "Edit Initiative View" : "Create Initiative View"}</h3>
                <p class="tb-muted-note">Choose configured epics for this saved view.</p>
              </div>
              <button type="button" class="tb-btn tb-btn-sm" onClick={closeViewEditor} disabled={viewEditorSaving}>
                Close
              </button>
            </header>

            <div class="tb-modal-two-up">
              <label class="tb-modal-field">
                <span>View Name</span>
                <input
                  type="text"
                  value={viewNameDraft}
                  onInput={(event) => setViewNameDraft((event.currentTarget as HTMLInputElement).value)}
                  placeholder="Q1 FY27"
                />
              </label>
              <label class="tb-modal-field">
                <span>Description</span>
                <input
                  type="text"
                  value={viewDescriptionDraft}
                  onInput={(event) => setViewDescriptionDraft((event.currentTarget as HTMLInputElement).value)}
                  placeholder="Optional"
                />
              </label>
            </div>

            <div class="tb-initiative-view-picker">
              <section class="tb-initiative-view-picker-panel">
                <label class="tb-modal-field">
                  <span>Search Epics</span>
                  <input
                    type="text"
                    value={viewEpicQuery}
                    onInput={(event) => setViewEpicQuery((event.currentTarget as HTMLInputElement).value)}
                    placeholder="Epic key, name, group, or type"
                  />
                </label>
                <div class="tb-initiative-view-list" role="group" aria-label="Available configured epics">
                  {viewAvailableRows.map((row) => (
                    <button
                      key={row.epicKey}
                      type="button"
                      class="tb-initiative-view-list-item"
                      onClick={() => addViewDraftEpicKey(row.epicKey)}
                      aria-label={`Add ${row.epicKey} to view`}
                    >
                      <strong>{row.epicName || row.epicKey}</strong>
                      <span>{row.groupText} | {row.typeText} | {row.epicKey}</span>
                    </button>
                  ))}
                  {viewAvailableRows.length === 0 ? (
                    <p class="tb-muted-note tb-initiative-view-empty">No available epics match the current search.</p>
                  ) : null}
                </div>
              </section>

              <section class="tb-initiative-view-picker-panel">
                <div class="tb-initiative-view-picker-head">
                  <span>Included Epics</span>
                  <span class="tb-chip">{viewSelectedRows.length}</span>
                </div>
                <div class="tb-initiative-view-list" role="group" aria-label="Selected view epics">
                  {viewSelectedRows.map((row) => (
                    <button
                      key={row.epicKey}
                      type="button"
                      class="tb-initiative-view-list-item is-selected"
                      onClick={() => removeViewDraftEpicKey(row.epicKey)}
                      aria-label={`Remove ${row.epicKey} from view`}
                    >
                      <strong>{row.epicName || row.epicKey}</strong>
                      <span>{row.groupText} | {row.typeText} | {row.epicKey}</span>
                    </button>
                  ))}
                  {viewSelectedRows.length === 0 ? (
                    <p class="tb-muted-note tb-initiative-view-empty">No epics included yet.</p>
                  ) : null}
                </div>
              </section>
            </div>

            {viewEditorError ? <p class="tb-error-note">{viewEditorError}</p> : null}

            <footer class="tb-modal-actions tb-modal-actions-split">
              {viewEditorMode === "edit" && editingView && typeof editingView.id === "number" ? (
                <button
                  type="button"
                  class="tb-btn tb-btn-danger"
                  onClick={() => {
                    setPendingDeleteView(editingView);
                    setIsViewEditorOpen(false);
                  }}
                  disabled={viewEditorSaving}
                >
                  Delete View
                </button>
              ) : (
                <span />
              )}
              <span class="tb-action-row">
                <button type="button" class="tb-btn" onClick={closeViewEditor} disabled={viewEditorSaving}>
                  Cancel
                </button>
                <button type="button" class="tb-btn tb-btn-primary" onClick={() => void saveViewEditor()} disabled={viewEditorSaving}>
                  {viewEditorSaving ? "Saving..." : viewEditorMode === "edit" ? "Save View" : "Create View"}
                </button>
              </span>
            </footer>
          </div>
        </div>
      ) : null}

      {pendingDeleteView ? (
        <div class="tb-modal-layer" role="dialog" aria-modal="true" aria-label="Delete Initiative View">
          <div
            class="tb-modal-backdrop"
            onClick={() => {
              if (!deletingViewId) {
                setPendingDeleteView(null);
              }
            }}
          />
          <div class="tb-modal">
            <header class="tb-modal-head">
              <h3>Delete Initiative View</h3>
              <button
                type="button"
                class="tb-btn tb-btn-sm"
                onClick={() => setPendingDeleteView(null)}
                disabled={Boolean(deletingViewId)}
              >
                Close
              </button>
            </header>
            <p class="tb-muted-note">
              Delete <strong>{pendingDeleteView.name}</strong>? Epic metadata will remain configured.
            </p>
            <footer class="tb-modal-actions">
              <button
                type="button"
                class="tb-btn"
                onClick={() => setPendingDeleteView(null)}
                disabled={Boolean(deletingViewId)}
              >
                Cancel
              </button>
              <button
                type="button"
                class="tb-btn tb-btn-danger"
                onClick={() => void confirmDeleteView()}
                disabled={Boolean(deletingViewId)}
              >
                {deletingViewId ? "Deleting..." : "Delete"}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {pendingDeleteEpic ? (
        <div class="tb-modal-layer" role="dialog" aria-modal="true" aria-label="Remove Epic Configuration">
          <div
            class="tb-modal-backdrop"
            onClick={() => {
              if (!deletingEpicKey) {
                setPendingDeleteEpic(null);
              }
            }}
          />
          <div class="tb-modal">
            <header class="tb-modal-head">
              <h3>Remove Epic Configuration</h3>
              <button
                type="button"
                class="tb-btn tb-btn-sm"
                onClick={() => setPendingDeleteEpic(null)}
                disabled={Boolean(deletingEpicKey)}
              >
                Close
              </button>
            </header>
            <p class="tb-muted-note">
              Remove configuration for <strong>{pendingDeleteEpic.epicKey}</strong>
              {pendingDeleteEpic.epicName ? ` (${pendingDeleteEpic.epicName})` : ""}?
            </p>
            <p class="tb-muted-note">
              This removes success criteria, group mapping, and work type mapping for this epic.
            </p>
            <footer class="tb-modal-actions">
              <button
                type="button"
                class="tb-btn"
                onClick={() => setPendingDeleteEpic(null)}
                disabled={Boolean(deletingEpicKey)}
              >
                Cancel
              </button>
              <button
                type="button"
                class="tb-btn tb-btn-danger"
                onClick={() => confirmDeleteEpic()}
                disabled={Boolean(deletingEpicKey)}
              >
                {deletingEpicKey ? "Removing..." : "Remove"}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {completedSummaryContext ? (
        <div class="tb-modal-layer" role="dialog" aria-modal="true" aria-label="Completed Cards Summary">
          <div class="tb-modal-backdrop" onClick={closeCompletedSummary} />
          <div class="tb-modal tb-modal-wide">
            <header class="tb-modal-head">
              <h3>Completed Cards Summary</h3>
              <button type="button" class="tb-btn tb-btn-sm" onClick={closeCompletedSummary}>
                Close
              </button>
            </header>

            <p class="tb-muted-note">
              {completedSummaryContext.scope === "epic" ? (
                <span>
                  Epic: <strong>{completedSummaryContext.epicKey}</strong>
                  {completedSummaryContext.epicName ? ` (${completedSummaryContext.epicName})` : ""}
                </span>
              ) : (
                <span>
                  {completedSummaryContext.isAllConfigured ? "Scope:" : "View:"}{" "}
                  <strong>{completedSummaryContext.isAllConfigured ? "All configured initiatives" : completedSummaryContext.viewName}</strong>
                </span>
              )}
            </p>
            <p class="tb-muted-note">Reporting period: {periodLabel(completedSummaryReportingPeriod ?? reportingPeriod)}</p>

            {completedSummaryError ? <p class="tb-error-note">{completedSummaryError}</p> : null}

            <section>
              <h4 class="tb-initiative-completed-section-title">AI Summary</h4>
              {completedSummaryLoading ? <p class="tb-muted-note">Loading completed cards...</p> : null}
              {completedSummaryTextLoading ? <p class="tb-muted-note">Generating summary with {aiProviderName}...</p> : null}
              {completedSummaryTextError ? <p class="tb-error-note">{completedSummaryTextError}</p> : null}
              {completedSummaryText ? (
                <div class="tb-summary">
                  <p>{completedSummaryText}</p>
                </div>
              ) : null}
              {(completedSummaryModelId || completedSummaryGeneratedAt) && !completedSummaryTextLoading ? (
                <p class="tb-muted-note">
                  Generated with {aiProviderName}
                  {completedSummaryModelId ? ` | Model: ${completedSummaryModelId}` : ""}
                  {completedSummaryGeneratedAt ? ` | Updated: ${formatTimestamp(completedSummaryGeneratedAt)}` : ""}
                </p>
              ) : null}
            </section>

            <section>
              <h4 class="tb-initiative-completed-section-title">Completed Cards ({completedSummaryCount})</h4>
              {completedSummaryTruncated ? (
                <p class="tb-muted-note">Showing the first {completedSummaryCards.length} cards due to response limit.</p>
              ) : null}
              {!completedSummaryLoading && completedSummaryCards.length === 0 ? (
                <p class="tb-muted-note">No completed cards were returned for this period.</p>
              ) : null}
              {completedSummaryCards.length > 0 ? (
                <div class="tb-initiative-completed-list">
                  {completedSummaryCards.map((card) => (
                    <article key={card.issueKey} class="tb-initiative-completed-card">
                      <p class="tb-initiative-completed-line-primary">{card.summary || "No summary available."}</p>
                      <p class="tb-initiative-completed-line-meta">
                        {card.issueKey}
                        {card.epicName ? ` • ${card.epicName}` : card.epicKey ? ` • ${card.epicKey}` : ""}
                        {card.status ? ` • ${card.status}` : ""}
                        {card.storyPoints != null ? ` • SP ${card.storyPoints}` : ""}
                        {card.completedAt ? ` • ${formatTimestamp(card.completedAt)}` : ""}
                      </p>
                    </article>
                  ))}
                </div>
              ) : null}
            </section>
          </div>
        </div>
      ) : null}

      {isConfigureOpen ? (
        <div class="tb-modal-layer" role="dialog" aria-modal="true" aria-label="Configure Epic Metadata">
          <div class="tb-modal-backdrop" onClick={closeConfigureDialog} />
          <div class="tb-modal tb-modal-wide">
            <header class="tb-modal-head">
              <h3>Configure Epic Metadata</h3>
              <button
                type="button"
                class="tb-btn tb-btn-sm"
                onClick={closeConfigureDialog}
                disabled={configureSaving}
              >
                Close
              </button>
            </header>

            <label class="tb-modal-field tb-autocomplete">
              <span>Search Unconfigured Epic</span>
              <input
                type="text"
                value={configureSearchQuery}
                onInput={(event) => setConfigureSearchQuery((event.currentTarget as HTMLInputElement).value)}
                onFocus={() => setIsConfigureSearchFocused(true)}
                onBlur={() => {
                  window.setTimeout(() => {
                    setIsConfigureSearchFocused(false);
                  }, 120);
                }}
                placeholder="Epic key or name"
              />
              {isConfigureSearchFocused ? (
                <div class="tb-candidate-list" role="listbox" aria-label="Epic candidates">
                  {configureCandidatesError ? <p class="tb-error-note">{configureCandidatesError}</p> : null}
                  {configureCandidatesLoading ? <p class="tb-muted-note">Searching epics...</p> : null}
                  {!configureCandidatesLoading && !configureCandidatesError && configureCandidates.length === 0 ? (
                    <p class="tb-muted-note">No unconfigured epics found.</p>
                  ) : null}
                  {!configureCandidatesLoading
                    ? configureCandidates.map((candidate) => (
                        <button
                          key={candidate.epicKey}
                          type="button"
                          class={`tb-candidate-item${selectedConfigureCandidate?.epicKey === candidate.epicKey ? " is-selected" : ""}`}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            setSelectedConfigureCandidate(candidate);
                            setConfigureSearchQuery(candidate.epicKey);
                            setIsConfigureSearchFocused(false);
                          }}
                        >
                          <strong>{candidate.epicKey}</strong>
                          <small>{candidate.epicName || "No epic name"}</small>
                        </button>
                      ))
                    : null}
                </div>
              ) : null}
            </label>

            {selectedConfigureCandidate ? (
              <p class="tb-muted-note">
                Selected epic: <strong>{selectedConfigureCandidate.epicKey}</strong>
                {selectedConfigureCandidate.epicName ? ` (${selectedConfigureCandidate.epicName})` : ""}
              </p>
            ) : null}

            <div class="tb-modal-two-up">
              <label class="tb-modal-field">
                <span>Epic Group (one)</span>
                <select
                  value={configureSelectedGroupId}
                  onChange={(event) => setConfigureSelectedGroupId((event.currentTarget as HTMLSelectElement).value)}
                >
                  <option value="">None</option>
                  {epicLookup.groups.map((group) => (
                    <option key={group.id} value={String(group.id)}>{group.name}</option>
                  ))}
                </select>
              </label>

              <label class="tb-modal-field">
                <span>Work Type (one)</span>
                <select
                  value={configureSelectedWorkTypeId}
                  onChange={(event) => setConfigureSelectedWorkTypeId((event.currentTarget as HTMLSelectElement).value)}
                >
                  <option value="">None</option>
                  {epicLookup.workTypes.map((workType) => (
                    <option key={workType.id} value={String(workType.id)}>{workType.name}</option>
                  ))}
                </select>
              </label>
            </div>

            <label class="tb-modal-check">
              <input
                type="checkbox"
                checked={configureTimelineEnabled}
                onChange={(event) => {
                  const checked = (event.currentTarget as HTMLInputElement).checked;
                  setConfigureTimelineEnabled(checked);
                  if (!checked) {
                    setConfigureTimelineStartDate("");
                    setConfigureTargetCompletionDate("");
                  }
                }}
              />
              <span>Enable timeline dates</span>
            </label>

            <div class="tb-modal-two-up">
              <label class="tb-modal-field">
                <span>Timeline Start Date</span>
                <input
                  type="date"
                  value={configureTimelineStartDate}
                  onInput={(event) => setConfigureTimelineStartDate((event.currentTarget as HTMLInputElement).value)}
                  disabled={!configureTimelineEnabled}
                />
              </label>

              <label class="tb-modal-field">
                <span>Target Completion Date</span>
                <input
                  type="date"
                  value={configureTargetCompletionDate}
                  onInput={(event) => setConfigureTargetCompletionDate((event.currentTarget as HTMLInputElement).value)}
                  disabled={!configureTimelineEnabled}
                />
              </label>
            </div>

            <label class="tb-modal-field">
              <span>Success Criteria (one per line)</span>
              <textarea
                rows={6}
                value={configureSuccessCriteriaText}
                onInput={(event) => setConfigureSuccessCriteriaText((event.currentTarget as HTMLTextAreaElement).value)}
              />
            </label>

            {configureError ? <p class="tb-error-note">{configureError}</p> : null}

            <footer class="tb-modal-actions">
              <button type="button" class="tb-btn" onClick={closeConfigureDialog} disabled={configureSaving}>
                Cancel
              </button>
              <button
                type="button"
                class="tb-btn tb-btn-primary"
                onClick={() => saveConfiguredEpic()}
                disabled={configureSaving || !selectedConfigureCandidate}
              >
                {configureSaving ? "Saving..." : "Save Epic Metadata"}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {metaSuccess ? (
        <div class="tb-overlay-toast-layer" aria-live="polite" aria-atomic="true">
          <div class="tb-overlay-toast is-success">{metaSuccess}</div>
        </div>
      ) : null}

      {isEditOpen && editingEpic ? (
        <div class="tb-modal-layer" role="dialog" aria-modal="true" aria-label="Edit Epic Metadata">
          <div class="tb-modal-backdrop" onClick={closeEditDialog} />
          <div class="tb-modal tb-modal-wide">
            <header class="tb-modal-head">
              <h3>Edit Epic Metadata</h3>
              <button type="button" class="tb-btn tb-btn-sm" onClick={closeEditDialog} disabled={editSaving}>
                Close
              </button>
            </header>

            <p class="tb-muted-note">
              Epic: <strong>{editingEpic.epicKey}</strong>
              {editingEpic.epicName ? ` (${editingEpic.epicName})` : ""}
            </p>

            <div class="tb-modal-two-up">
              <label class="tb-modal-field">
                <span>Epic Group (one)</span>
                <select
                  value={editSelectedGroupId}
                  onChange={(event) => setEditSelectedGroupId((event.currentTarget as HTMLSelectElement).value)}
                >
                  <option value="">None</option>
                  {epicLookup.groups.map((group) => (
                    <option key={group.id} value={String(group.id)}>{group.name}</option>
                  ))}
                </select>
              </label>

              <label class="tb-modal-field">
                <span>Work Type (one)</span>
                <select
                  value={editSelectedWorkTypeId}
                  onChange={(event) => setEditSelectedWorkTypeId((event.currentTarget as HTMLSelectElement).value)}
                >
                  <option value="">None</option>
                  {epicLookup.workTypes.map((workType) => (
                    <option key={workType.id} value={String(workType.id)}>{workType.name}</option>
                  ))}
                </select>
              </label>
            </div>

            <label class="tb-modal-check">
              <input
                type="checkbox"
                checked={editTimelineEnabled}
                onChange={(event) => {
                  const checked = (event.currentTarget as HTMLInputElement).checked;
                  setEditTimelineEnabled(checked);
                  if (!checked) {
                    setEditTimelineStartDate("");
                    setEditTargetCompletionDate("");
                  }
                }}
              />
              <span>Enable timeline dates</span>
            </label>

            <div class="tb-modal-two-up">
              <label class="tb-modal-field">
                <span>Timeline Start Date</span>
                <input
                  type="date"
                  value={editTimelineStartDate}
                  onInput={(event) => setEditTimelineStartDate((event.currentTarget as HTMLInputElement).value)}
                  disabled={!editTimelineEnabled}
                />
              </label>

              <label class="tb-modal-field">
                <span>Target Completion Date</span>
                <input
                  type="date"
                  value={editTargetCompletionDate}
                  onInput={(event) => setEditTargetCompletionDate((event.currentTarget as HTMLInputElement).value)}
                  disabled={!editTimelineEnabled}
                />
              </label>
            </div>

            <label class="tb-modal-field">
              <span>Success Criteria (one per line)</span>
              <textarea
                rows={6}
                value={editSuccessCriteriaText}
                onInput={(event) => setEditSuccessCriteriaText((event.currentTarget as HTMLTextAreaElement).value)}
              />
            </label>

            {editError ? <p class="tb-error-note">{editError}</p> : null}

            <footer class="tb-modal-actions">
              <button type="button" class="tb-btn" onClick={closeEditDialog} disabled={editSaving}>
                Cancel
              </button>
              <button type="button" class="tb-btn tb-btn-primary" onClick={() => saveEditedEpic()} disabled={editSaving}>
                {editSaving ? "Saving..." : "Save Changes"}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
