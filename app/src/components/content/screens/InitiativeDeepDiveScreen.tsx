import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarRange, Check, RefreshCw, Search, SlidersHorizontal, X } from "lucide-react";
import {
  fetchEpicLookupConfig,
  fetchInitiativeDeepDive,
  type EpicLookupItem,
  type InitiativeDeepDiveActivity,
  type InitiativeDeepDiveCard,
  type InitiativeDeepDiveEpicOption,
  type InitiativeDeepDiveResponse,
} from "../../../lib/api";
import { getPreferenceSync, setPreference } from "../../../lib/persistence";
import { InitiativeFlowChart } from "./InitiativeFlowChart";

type TableWindowWeeks = 1 | 2 | 4 | 12;
type TableSortField = "activity" | "issueKey" | "summary" | "epic" | "status" | "created" | "inProgress" | "completed";
type SortDirection = "asc" | "desc";
type TrendPreset = "last_1_week" | "last_2_weeks" | "last_4_weeks" | "last_8_weeks" | "last_12_weeks" | "last_26_weeks" | "last_52_weeks" | "custom";

type TrendSelection = {
  preset: TrendPreset;
  startDate: string;
  endDate: string;
};

const WINDOW_OPTIONS: TableWindowWeeks[] = [1, 2, 4, 12];
const INITIATIVE_DEEP_DIVE_SCOPE_KEY = "teambeacon.initiativeDeepDive.scope";
const INITIATIVE_DEEP_DIVE_TREND_KEY = "teambeacon.initiativeDeepDive.trend.period";
const VISIBLE_SCOPE_PILLS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const TREND_PRESET_WEEKS: Record<Exclude<TrendPreset, "custom">, number> = {
  last_1_week: 1,
  last_2_weeks: 2,
  last_4_weeks: 4,
  last_8_weeks: 8,
  last_12_weeks: 12,
  last_26_weeks: 26,
  last_52_weeks: 52,
};

const TREND_PRESET_LABELS: Record<TrendPreset, string> = {
  last_1_week: "Last 1 week",
  last_2_weeks: "Last 2 weeks",
  last_4_weeks: "Last 4 weeks",
  last_8_weeks: "Last 8 weeks",
  last_12_weeks: "Last 12 weeks",
  last_26_weeks: "Last 26 weeks",
  last_52_weeks: "Last 52 weeks",
  custom: "Custom",
};

type PersistedDeepDiveScope = {
  groupIds: number[];
  epicKeys: string[];
};

const TABLE_COLUMNS: Array<{ id: TableSortField; label: string }> = [
  { id: "activity", label: "Activity" },
  { id: "epic", label: "Epic" },
  { id: "issueKey", label: "Key" },
  { id: "summary", label: "Title" },
  { id: "status", label: "Current status" },
  { id: "created", label: "Created" },
  { id: "inProgress", label: "In progress since" },
  { id: "completed", label: "Completed" },
];

const ACTIVITY_FILTERS: Array<{ id: InitiativeDeepDiveActivity; label: string }> = [
  { id: "all", label: "All activity" },
  { id: "new", label: "New" },
  { id: "in_progress", label: "In progress" },
  { id: "completed", label: "Completed" },
  { id: "current_wip", label: "Current WIP" },
];

function parsePersistedScope(raw: string | null): PersistedDeepDiveScope {
  if (!raw) return { groupIds: [], epicKeys: [] };
  try {
    const parsed = JSON.parse(raw) as { groupIds?: unknown; epicKeys?: unknown };
    const groupIds = Array.isArray(parsed.groupIds)
      ? [...new Set(parsed.groupIds.filter(
        (value): value is number => typeof value === "number" && Number.isInteger(value) && value > 0,
      ))]
      : [];
    const epicKeys = Array.isArray(parsed.epicKeys)
      ? [...new Set(parsed.epicKeys
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean))]
      : [];
    return { groupIds, epicKeys };
  } catch {
    return { groupIds: [], epicKeys: [] };
  }
}

function readPersistedScope(): PersistedDeepDiveScope {
  return parsePersistedScope(getPreferenceSync(INITIATIVE_DEEP_DIVE_SCOPE_KEY));
}

function isTrendPreset(value: unknown): value is TrendPreset {
  return value === "last_1_week"
    || value === "last_2_weeks"
    || value === "last_4_weeks"
    || value === "last_8_weeks"
    || value === "last_12_weeks"
    || value === "last_26_weeks"
    || value === "last_52_weeks"
    || value === "custom";
}

function trendPresetForWeeks(weeks: TableWindowWeeks): Exclude<TrendPreset, "custom"> {
  if (weeks === 1) return "last_1_week";
  return `last_${weeks}_weeks` as Exclude<TrendPreset, "custom">;
}

function formatLocalIsoDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseIsoDateToUtcDay(value: string | null | undefined): number | null {
  const candidate = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(candidate)) return null;
  const [year, month, day] = candidate.split("-").map(Number);
  const utcDay = Date.UTC(year, month - 1, day);
  if (new Date(utcDay).toISOString().slice(0, 10) !== candidate) return null;
  return utcDay;
}

function buildRelativeWeekRange(weeks: number): Pick<TrendSelection, "startDate" | "endDate"> {
  const safeWeeks = Math.max(1, Math.floor(weeks));
  const endDate = new Date();
  endDate.setHours(0, 0, 0, 0);
  const currentWeekStart = new Date(endDate);
  const daysSinceMonday = (currentWeekStart.getDay() + 6) % 7;
  currentWeekStart.setDate(currentWeekStart.getDate() - daysSinceMonday);
  const startDate = new Date(currentWeekStart);
  startDate.setDate(startDate.getDate() - ((safeWeeks - 1) * 7));
  return {
    startDate: formatLocalIsoDate(startDate),
    endDate: formatLocalIsoDate(endDate),
  };
}

function defaultTrendSelection(): TrendSelection {
  return { preset: "last_12_weeks", ...buildRelativeWeekRange(12) };
}

function readPersistedTrendSelection(): TrendSelection {
  const fallback = defaultTrendSelection();
  const raw = getPreferenceSync(INITIATIVE_DEEP_DIVE_TREND_KEY);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<TrendSelection>;
    if (!isTrendPreset(parsed.preset)) return fallback;
    if (parsed.preset !== "custom") {
      return { preset: parsed.preset, ...buildRelativeWeekRange(TREND_PRESET_WEEKS[parsed.preset]) };
    }
    const startUtc = parseIsoDateToUtcDay(parsed.startDate);
    const endUtc = parseIsoDateToUtcDay(parsed.endDate);
    const todayUtc = parseIsoDateToUtcDay(formatLocalIsoDate(new Date()));
    if (startUtc === null || endUtc === null || todayUtc === null || startUtc > endUtc || endUtc > todayUtc) return fallback;
    if (Math.floor((endUtc - startUtc) / DAY_MS) + 1 > 366) return fallback;
    return { preset: "custom", startDate: parsed.startDate!, endDate: parsed.endDate! };
  } catch {
    return fallback;
  }
}

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" })
    .format(parseLocalDate(value));
}

function formatDateRange(startDate: string, endDate: string): string {
  return `${formatDate(startDate)} – ${formatDate(endDate)}`;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: "base", numeric: true });
}

function compareTimestamp(
  left: string | null | undefined,
  right: string | null | undefined,
  direction: SortDirection,
): number {
  const leftTimestamp = left ? new Date(left).getTime() : Number.NaN;
  const rightTimestamp = right ? new Date(right).getTime() : Number.NaN;
  const leftMissing = Number.isNaN(leftTimestamp);
  const rightMissing = Number.isNaN(rightTimestamp);
  if (leftMissing || rightMissing) {
    if (leftMissing && rightMissing) return 0;
    return leftMissing ? 1 : -1;
  }
  const comparison = leftTimestamp === rightTimestamp ? 0 : leftTimestamp < rightTimestamp ? -1 : 1;
  return direction === "asc" ? comparison : -comparison;
}

function defaultSortDirection(field: TableSortField): SortDirection {
  return ["activity", "created", "inProgress", "completed"].includes(field) ? "desc" : "asc";
}

function compareCards(
  left: InitiativeDeepDiveCard,
  right: InitiativeDeepDiveCard,
  field: TableSortField,
  direction: SortDirection,
): number {
  let comparison = 0;
  switch (field) {
    case "activity":
      comparison = compareTimestamp(left.latestActivityAt, right.latestActivityAt, direction);
      break;
    case "issueKey":
      comparison = compareText(left.issueKey, right.issueKey);
      break;
    case "summary":
      comparison = compareText(left.summary, right.summary);
      break;
    case "epic":
      comparison = compareText(left.epicName || left.epicKey, right.epicName || right.epicKey);
      break;
    case "status":
      comparison = compareText(left.status, right.status);
      break;
    case "created":
      comparison = compareTimestamp(left.createdAt, right.createdAt, direction);
      break;
    case "inProgress":
      comparison = compareTimestamp(left.inProgressStartedAt, right.inProgressStartedAt, direction);
      break;
    case "completed":
      comparison = compareTimestamp(left.completedAt, right.completedAt, direction);
      break;
  }
  if (comparison === 0) return compareText(left.issueKey, right.issueKey);
  if (["activity", "created", "inProgress", "completed"].includes(field)) return comparison;
  return direction === "asc" ? comparison : -comparison;
}

function statusTone(statusCategory: string): string {
  const normalized = statusCategory.trim().toLowerCase();
  if (normalized === "done") return "is-completed";
  if (normalized === "in progress") return "is-in-progress";
  return "is-new";
}

function activityLabel(activity: InitiativeDeepDiveCard["activityTypes"][number]): string {
  if (activity === "in_progress") return "In progress";
  if (activity === "completed") return "Completed";
  return "New";
}

function countForActivity(payload: InitiativeDeepDiveResponse, activity: InitiativeDeepDiveActivity): number {
  if (activity === "new") return payload.tableCounts.new;
  if (activity === "in_progress") return payload.tableCounts.inProgress;
  if (activity === "completed") return payload.tableCounts.completed;
  if (activity === "current_wip") return payload.currentWipCount;
  return payload.tableCounts.all;
}

function sameSelection<T extends number | string>(left: T[], right: T[]): boolean {
  if (left.length !== right.length) return false;
  const rightValues = new Set(right);
  return left.every((value) => rightValues.has(value));
}

export function InitiativeDeepDiveScreen() {
  const [initialPersistedScope] = useState<PersistedDeepDiveScope>(readPersistedScope);
  const [trendSelection, setTrendSelection] = useState<TrendSelection>(readPersistedTrendSelection);
  const [groups, setGroups] = useState<EpicLookupItem[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<number[]>([]);
  const [selectedEpicKeys, setSelectedEpicKeys] = useState<string[]>([]);
  const [activity, setActivity] = useState<InitiativeDeepDiveActivity>("all");
  const [sortField, setSortField] = useState<TableSortField>("activity");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [payload, setPayload] = useState<InitiativeDeepDiveResponse | null>(null);
  const [isLookupLoading, setIsLookupLoading] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [hasHydratedPersistedScope, setHasHydratedPersistedScope] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isScopePickerOpen, setIsScopePickerOpen] = useState(false);
  const [draftGroupIds, setDraftGroupIds] = useState<number[]>([]);
  const [draftEpicKeys, setDraftEpicKeys] = useState<string[]>([]);
  const [draftEpicOptions, setDraftEpicOptions] = useState<InitiativeDeepDiveEpicOption[]>([]);
  const [groupSearch, setGroupSearch] = useState("");
  const [epicSearch, setEpicSearch] = useState("");
  const [isDraftEpicLoading, setIsDraftEpicLoading] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [isTrendConfigOpen, setIsTrendConfigOpen] = useState(false);
  const [trendPresetDraft, setTrendPresetDraft] = useState<TrendPreset>(trendSelection.preset);
  const [trendStartDraft, setTrendStartDraft] = useState(trendSelection.startDate);
  const [trendEndDraft, setTrendEndDraft] = useState(trendSelection.endDate);
  const [trendValidationError, setTrendValidationError] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const groupSearchRef = useRef<HTMLInputElement | null>(null);
  const persistedGroupIdsRef = useRef(initialPersistedScope.groupIds);
  const pendingPersistedEpicKeysRef = useRef(initialPersistedScope.epicKeys);
  const hasHydratedPersistedScopeRef = useRef(false);
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
  const todayIso = useMemo(() => formatLocalIsoDate(new Date()), []);

  useEffect(() => {
    let active = true;
    setIsLookupLoading(true);
    fetchEpicLookupConfig()
      .then((lookup) => {
        if (!active) return;
        setGroups(lookup.groups);
        const availableGroupIds = new Set(lookup.groups.map((group) => group.id));
        const restoredGroupIds = persistedGroupIdsRef.current.filter((groupId) => availableGroupIds.has(groupId));
        setSelectedGroupIds(
          restoredGroupIds.length === 0 || restoredGroupIds.length === lookup.groups.length
            ? []
            : lookup.groups.map((group) => group.id).filter((groupId) => restoredGroupIds.includes(groupId)),
        );
      })
      .catch((requestError: unknown) => {
        if (!active) return;
        setError(requestError instanceof Error ? requestError.message : "Unable to load initiative groups.");
      })
      .finally(() => {
        if (active) setIsLookupLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const effectiveGroupIds = useMemo(
    () => selectedGroupIds.length === 0 ? groups.map((group) => group.id) : selectedGroupIds,
    [groups, selectedGroupIds],
  );
  const draftEffectiveGroupIds = useMemo(
    () => draftGroupIds.length === 0 ? groups.map((group) => group.id) : draftGroupIds,
    [draftGroupIds, groups],
  );

  useEffect(() => {
    if (isLookupLoading || effectiveGroupIds.length === 0) return undefined;
    let activeRequest = true;
    setIsLoading(true);
    setError(null);
    fetchInitiativeDeepDive({
      groupIds: effectiveGroupIds,
      epicKeys: selectedEpicKeys,
      ...(trendSelection.preset === "custom"
        ? { chartStart: trendSelection.startDate, chartEnd: trendSelection.endDate }
        : { chartWeeks: TREND_PRESET_WEEKS[trendSelection.preset] }),
      activity,
      timezone,
      limit: 500,
    })
      .then((nextPayload) => {
        if (!activeRequest) return;
        if (!hasHydratedPersistedScopeRef.current) {
          const availableEpicKeys = new Set(nextPayload.epicOptions.map((epic) => epic.epicKey));
          const restoredEpicKeys = pendingPersistedEpicKeysRef.current.filter((epicKey) => availableEpicKeys.has(epicKey));
          hasHydratedPersistedScopeRef.current = true;
          setHasHydratedPersistedScope(true);
          pendingPersistedEpicKeysRef.current = [];
          if (restoredEpicKeys.length > 0 && restoredEpicKeys.length < nextPayload.epicOptions.length) {
            setSelectedEpicKeys(restoredEpicKeys);
            return;
          }
        }
        setPayload(nextPayload);
      })
      .catch((requestError: unknown) => {
        if (!activeRequest) return;
        setError(requestError instanceof Error ? requestError.message : "Unable to load initiative deep dive.");
      })
      .finally(() => {
        if (activeRequest) setIsLoading(false);
      });
    return () => {
      activeRequest = false;
    };
  }, [
    activity,
    effectiveGroupIds,
    isLookupLoading,
    refreshVersion,
    selectedEpicKeys,
    timezone,
    trendSelection.endDate,
    trendSelection.preset,
    trendSelection.startDate,
  ]);

  useEffect(() => {
    if (!hasHydratedPersistedScope || isLookupLoading) return;
    void setPreference(INITIATIVE_DEEP_DIVE_SCOPE_KEY, JSON.stringify({
      groupIds: selectedGroupIds,
      epicKeys: selectedEpicKeys,
    } satisfies PersistedDeepDiveScope));
  }, [hasHydratedPersistedScope, isLookupLoading, selectedEpicKeys, selectedGroupIds]);

  useEffect(() => {
    void setPreference(INITIATIVE_DEEP_DIVE_TREND_KEY, JSON.stringify(trendSelection));
  }, [trendSelection]);

  useEffect(() => {
    if (!isScopePickerOpen && !isTrendConfigOpen) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsScopePickerOpen(false);
        setIsTrendConfigOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    if (isScopePickerOpen) window.requestAnimationFrame(() => groupSearchRef.current?.focus());
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isScopePickerOpen, isTrendConfigOpen]);

  useEffect(() => {
    if (!isScopePickerOpen || draftEffectiveGroupIds.length === 0) return undefined;
    if (sameSelection(draftEffectiveGroupIds, effectiveGroupIds) && payload) {
      setDraftEpicOptions(payload.epicOptions);
      setIsDraftEpicLoading(false);
      setDraftError(null);
      return undefined;
    }

    let activeRequest = true;
    setIsDraftEpicLoading(true);
    setDraftError(null);
    fetchInitiativeDeepDive({
      groupIds: draftEffectiveGroupIds,
      epicKeys: [],
      ...(trendSelection.preset === "custom"
        ? { chartStart: trendSelection.startDate, chartEnd: trendSelection.endDate }
        : { chartWeeks: TREND_PRESET_WEEKS[trendSelection.preset] }),
      activity: "all",
      timezone,
      limit: 1,
    })
      .then((previewPayload) => {
        if (!activeRequest) return;
        const availableEpicKeys = new Set(previewPayload.epicOptions.map((epic) => epic.epicKey));
        setDraftEpicOptions(previewPayload.epicOptions);
        setDraftEpicKeys((current) => {
          const validKeys = current.filter((epicKey) => availableEpicKeys.has(epicKey));
          return validKeys.length === previewPayload.epicOptions.length ? [] : validKeys;
        });
      })
      .catch((requestError: unknown) => {
        if (!activeRequest) return;
        setDraftError(requestError instanceof Error ? requestError.message : "Unable to load epics for this group selection.");
      })
      .finally(() => {
        if (activeRequest) setIsDraftEpicLoading(false);
      });
    return () => {
      activeRequest = false;
    };
  }, [
    draftEffectiveGroupIds,
    effectiveGroupIds,
    isScopePickerOpen,
    payload,
    timezone,
    trendSelection.endDate,
    trendSelection.preset,
    trendSelection.startDate,
  ]);

  const allGroupsSelected = selectedGroupIds.length === 0;
  const epicOptions = payload?.epicOptions ?? [];
  const allEpicsSelected = selectedEpicKeys.length === 0;
  const selectedGroups = groups.filter((group) => selectedGroupIds.includes(group.id));
  const selectedEpics = selectedEpicKeys.map((epicKey) => (
    epicOptions.find((epic) => epic.epicKey === epicKey) ?? { epicKey, epicName: epicKey }
  ));
  const visibleSelectedGroups = selectedGroups.slice(0, VISIBLE_SCOPE_PILLS);
  const visibleSelectedEpics = selectedEpics.slice(0, VISIBLE_SCOPE_PILLS);
  const hiddenGroupCount = Math.max(0, selectedGroups.length - visibleSelectedGroups.length);
  const hiddenEpicCount = Math.max(0, selectedEpics.length - visibleSelectedEpics.length);
  const allDraftGroupsSelected = draftGroupIds.length === 0;
  const allDraftEpicsSelected = draftEpicKeys.length === 0;
  const filteredGroups = groups.filter((group) => group.name.toLowerCase().includes(groupSearch.trim().toLowerCase()));
  const normalizedEpicSearch = epicSearch.trim().toLowerCase();
  const filteredDraftEpics = draftEpicOptions.filter((epic) => (
    epic.epicKey.toLowerCase().includes(normalizedEpicSearch)
    || epic.epicName.toLowerCase().includes(normalizedEpicSearch)
  ));
  const scopeHasChanges = !sameSelection(selectedGroupIds, draftGroupIds)
    || !sameSelection(selectedEpicKeys, draftEpicKeys);
  const selectedTrendRange = {
    startDate: trendSelection.startDate,
    endDate: trendSelection.endDate,
    days: Math.max(1, Math.floor(
      ((parseIsoDateToUtcDay(trendSelection.endDate) ?? 0) - (parseIsoDateToUtcDay(trendSelection.startDate) ?? 0)) / DAY_MS,
    ) + 1),
  };
  const responseReportingPeriod = payload?.reportingPeriod ?? payload?.chartRange;
  const activeTrendRange = responseReportingPeriod?.startDate === trendSelection.startDate
    && responseReportingPeriod.endDate === trendSelection.endDate
    ? responseReportingPeriod
    : selectedTrendRange;
  const draftTrendStartUtc = parseIsoDateToUtcDay(trendStartDraft);
  const draftTrendEndUtc = parseIsoDateToUtcDay(trendEndDraft);
  const draftTrendDays = draftTrendStartUtc !== null && draftTrendEndUtc !== null && draftTrendEndUtc >= draftTrendStartUtc
    ? Math.floor((draftTrendEndUtc - draftTrendStartUtc) / DAY_MS) + 1
    : null;
  const sortedCards = useMemo(() => {
    const cards = [...(payload?.cards ?? [])];
    cards.sort((left, right) => compareCards(left, right, sortField, sortDirection));
    return cards;
  }, [payload?.cards, sortDirection, sortField]);

  const resetDependentScope = () => {
    setSelectedEpicKeys([]);
    setActivity("all");
    setPayload(null);
    setError(null);
  };

  const openScopePicker = () => {
    setDraftGroupIds(selectedGroupIds);
    setDraftEpicKeys(selectedEpicKeys);
    setDraftEpicOptions(epicOptions);
    setGroupSearch("");
    setEpicSearch("");
    setDraftError(null);
    setIsScopePickerOpen(true);
  };

  const toggleDraftGroup = (groupId: number) => {
    setDraftGroupIds((current) => {
      const next = current.includes(groupId)
        ? current.filter((id) => id !== groupId)
        : [...current, groupId];
      if (next.length === 0 || next.length === groups.length) return [];
      return groups.map((group) => group.id).filter((id) => next.includes(id));
    });
    setDraftEpicOptions([]);
    setDraftError(null);
  };

  const toggleDraftEpic = (epicKey: string) => {
    setDraftEpicKeys((current) => {
      const next = current.includes(epicKey)
        ? current.filter((key) => key !== epicKey)
        : [...current, epicKey];
      if (next.length === 0 || next.length === draftEpicOptions.length) return [];
      return draftEpicOptions.map((epic) => epic.epicKey).filter((key) => next.includes(key));
    });
  };

  const applyDraftScope = () => {
    const nextGroupIds = draftGroupIds.length === groups.length ? [] : draftGroupIds;
    const nextEpicKeys = draftEpicKeys.length === draftEpicOptions.length ? [] : draftEpicKeys;
    const changed = !sameSelection(selectedGroupIds, nextGroupIds) || !sameSelection(selectedEpicKeys, nextEpicKeys);
    setSelectedGroupIds(nextGroupIds);
    setSelectedEpicKeys(nextEpicKeys);
    setIsScopePickerOpen(false);
    if (changed) {
      setActivity("all");
      setPayload(null);
      setError(null);
    }
  };

  const removeAppliedGroup = (groupId: number) => {
    setSelectedGroupIds((current) => current.filter((id) => id !== groupId));
    resetDependentScope();
  };

  const removeAppliedEpic = (epicKey: string) => {
    setSelectedEpicKeys((current) => current.filter((key) => key !== epicKey));
  };

  const openTrendConfig = () => {
    setTrendPresetDraft(trendSelection.preset);
    setTrendStartDraft(trendSelection.startDate);
    setTrendEndDraft(trendSelection.endDate);
    setTrendValidationError(null);
    setIsTrendConfigOpen(true);
  };

  const changeTrendPresetDraft = (preset: TrendPreset) => {
    setTrendPresetDraft(preset);
    setTrendValidationError(null);
    if (preset === "custom") return;
    const nextRange = buildRelativeWeekRange(TREND_PRESET_WEEKS[preset]);
    setTrendStartDraft(nextRange.startDate);
    setTrendEndDraft(nextRange.endDate);
  };

  const saveTrendConfig = () => {
    if (trendPresetDraft !== "custom") {
      const nextRange = buildRelativeWeekRange(TREND_PRESET_WEEKS[trendPresetDraft]);
      setTrendSelection({ preset: trendPresetDraft, ...nextRange });
      if (activity === "current_wip") setActivity("all");
      setTrendValidationError(null);
      setIsTrendConfigOpen(false);
      return;
    }
    if (!trendStartDraft || !trendEndDraft) {
      setTrendValidationError("Start and end date are required.");
      return;
    }
    if (draftTrendStartUtc === null || draftTrendEndUtc === null) {
      setTrendValidationError("Invalid reporting-period date format.");
      return;
    }
    if (draftTrendStartUtc > draftTrendEndUtc) {
      setTrendValidationError("Start date cannot be after end date.");
      return;
    }
    const todayUtc = parseIsoDateToUtcDay(todayIso);
    if (todayUtc !== null && draftTrendEndUtc > todayUtc) {
      setTrendValidationError("End date cannot be after today.");
      return;
    }
    if ((draftTrendDays ?? 0) > 366) {
      setTrendValidationError("Reporting period cannot exceed 366 days.");
      return;
    }
    setTrendSelection({ preset: "custom", startDate: trendStartDraft, endDate: trendEndDraft });
    if (activity === "current_wip") setActivity("all");
    setTrendValidationError(null);
    setIsTrendConfigOpen(false);
  };

  const handleWindowSelection = (weeks: TableWindowWeeks) => {
    const preset = trendPresetForWeeks(weeks);
    setTrendSelection({ preset, ...buildRelativeWeekRange(weeks) });
    if (activity === "current_wip") setActivity("all");
  };

  const handleSortHeaderClick = (field: TableSortField) => {
    setSortField((current) => {
      if (current === field) {
        setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
        return current;
      }
      setSortDirection(defaultSortDirection(field));
      return field;
    });
  };

  const resolveSortIndicator = (field: TableSortField): string => {
    if (sortField !== field) return "↕";
    return sortDirection === "asc" ? "↑" : "↓";
  };

  if (isLookupLoading) {
    return <section className="tb-panel tb-deep-dive-state">Loading initiative groups…</section>;
  }

  return (
    <div className="tb-initiative-deep-dive" aria-busy={isLoading}>
      <section className="tb-panel tb-deep-dive-filter-panel" aria-labelledby="initiative-deep-dive-filters">
        <div className="tb-deep-dive-section-heading">
          <div>
            <p className="tb-eyebrow">Scope</p>
            <h3 id="initiative-deep-dive-filters">Choose groups and epics</h3>
          </div>
          <div className="tb-deep-dive-reporting-control">
            {payload ? <p className="tb-deep-dive-timezone">Weeks start Monday · {payload.timezone}</p> : null}
            <span>Reporting period</span>
            <button
              type="button"
              className="tb-btn tb-btn-sm"
              onClick={openTrendConfig}
              aria-label={`Configure reporting period: ${TREND_PRESET_LABELS[trendSelection.preset]}`}
            >
              <CalendarRange size={15} aria-hidden="true" />
              {TREND_PRESET_LABELS[trendSelection.preset]}
            </button>
          </div>
        </div>

        <div className="tb-deep-dive-scope-summary">
          <div className="tb-deep-dive-scope-rows">
            <div className="tb-deep-dive-scope-row" aria-label="Selected groups">
              <div className="tb-deep-dive-scope-label">
                <span>Groups</span>
                <small>{allGroupsSelected ? `${groups.length} available` : `${selectedGroupIds.length} selected`}</small>
              </div>
              <div className="tb-deep-dive-scope-pills">
                {allGroupsSelected ? (
                  <span className="tb-deep-dive-scope-pill is-all">
                    <Check size={13} aria-hidden="true" />
                    <span className="tb-deep-dive-scope-pill-label">All groups</span>
                  </span>
                ) : (
                  <>
                    {visibleSelectedGroups.map((group) => (
                      <span className="tb-deep-dive-scope-pill" key={group.id} title={group.name}>
                        <span className="tb-deep-dive-scope-pill-label">{group.name}</span>
                        <button
                          type="button"
                          aria-label={`Remove group ${group.name}`}
                          onClick={() => removeAppliedGroup(group.id)}
                        >
                          <X size={13} aria-hidden="true" />
                        </button>
                      </span>
                    ))}
                    {hiddenGroupCount > 0 ? (
                      <button type="button" className="tb-deep-dive-scope-more" onClick={openScopePicker}>
                        +{hiddenGroupCount} more
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            </div>

            <div className="tb-deep-dive-scope-row" aria-label="Selected epics">
              <div className="tb-deep-dive-scope-label">
                <span>Epics</span>
                <small>{allEpicsSelected ? `${epicOptions.length} eligible` : `${selectedEpicKeys.length} selected`}</small>
              </div>
              <div className="tb-deep-dive-scope-pills">
                {allEpicsSelected ? (
                  <span className="tb-deep-dive-scope-pill is-all">
                    <Check size={13} aria-hidden="true" />
                    <span className="tb-deep-dive-scope-pill-label">
                      All epics in selected groups{epicOptions.length > 0 ? ` (${epicOptions.length})` : ""}
                    </span>
                  </span>
                ) : (
                  <>
                    {visibleSelectedEpics.map((epic) => (
                      <span
                        className="tb-deep-dive-scope-pill"
                        key={epic.epicKey}
                        title={`${epic.epicName} (${epic.epicKey})`}
                      >
                        <span className="tb-deep-dive-scope-pill-label">{epic.epicName}</span>
                        <button
                          type="button"
                          aria-label={`Remove epic ${epic.epicName}`}
                          onClick={() => removeAppliedEpic(epic.epicKey)}
                        >
                          <X size={13} aria-hidden="true" />
                        </button>
                      </span>
                    ))}
                    {hiddenEpicCount > 0 ? (
                      <button type="button" className="tb-deep-dive-scope-more" onClick={openScopePicker}>
                        +{hiddenEpicCount} more
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          </div>
          <button
            type="button"
            className="tb-btn tb-deep-dive-edit-scope"
            onClick={openScopePicker}
            disabled={groups.length === 0 || (!payload && !error)}
          >
            <SlidersHorizontal size={15} aria-hidden="true" />
            Edit scope
          </button>
        </div>
      </section>

      {isScopePickerOpen ? (
        <div
          className="tb-modal-layer"
          role="dialog"
          aria-modal="true"
          aria-labelledby="initiative-scope-picker-heading"
        >
          <div className="tb-modal-backdrop" onClick={() => setIsScopePickerOpen(false)} />
          <div className="tb-modal tb-deep-dive-scope-dialog">
            <header className="tb-modal-head tb-deep-dive-scope-dialog-head">
              <div>
                <p className="tb-eyebrow">Initiative scope</p>
                <h3 id="initiative-scope-picker-heading">Choose groups and epics</h3>
                <p>Epics are filtered by the groups selected on the left.</p>
              </div>
              <button
                type="button"
                className="tb-deep-dive-dialog-close"
                aria-label="Close scope picker"
                onClick={() => setIsScopePickerOpen(false)}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </header>

            <div className="tb-deep-dive-scope-picker">
              <section className="tb-deep-dive-scope-pane" aria-labelledby="initiative-scope-groups-heading">
                <div className="tb-deep-dive-scope-pane-heading">
                  <h4 id="initiative-scope-groups-heading">Groups</h4>
                  <span>{allDraftGroupsSelected ? "All selected" : `${draftGroupIds.length} selected`}</span>
                </div>
                <label className="tb-deep-dive-scope-search">
                  <Search size={15} aria-hidden="true" />
                  <input
                    ref={groupSearchRef}
                    type="search"
                    value={groupSearch}
                    aria-label="Search groups"
                    placeholder="Search groups…"
                    onChange={(event) => setGroupSearch(event.target.value)}
                  />
                </label>
                <div className="tb-deep-dive-scope-options" role="group" aria-label="Group options">
                  <label className="tb-deep-dive-check-option is-all">
                    <input
                      type="checkbox"
                      checked={allDraftGroupsSelected}
                      onChange={() => {
                        setDraftGroupIds([]);
                        if (!allDraftGroupsSelected) setDraftEpicOptions([]);
                        setDraftError(null);
                      }}
                    />
                    <span className="tb-deep-dive-checkbox" aria-hidden="true">
                      {allDraftGroupsSelected ? <Check size={13} /> : null}
                    </span>
                    <span>
                      <strong>All groups</strong>
                      <small>Keep every configured group in scope</small>
                    </span>
                  </label>
                  {filteredGroups.map((group) => {
                    const checked = draftGroupIds.includes(group.id);
                    return (
                      <label className="tb-deep-dive-check-option" key={group.id}>
                        <input type="checkbox" checked={checked} onChange={() => toggleDraftGroup(group.id)} />
                        <span className="tb-deep-dive-checkbox" aria-hidden="true">
                          {checked ? <Check size={13} /> : null}
                        </span>
                        <span>{group.name}</span>
                      </label>
                    );
                  })}
                  {filteredGroups.length === 0 ? <p className="tb-deep-dive-option-empty">No matching groups.</p> : null}
                </div>
              </section>

              <section className="tb-deep-dive-scope-pane" aria-labelledby="initiative-scope-epics-heading">
                <div className="tb-deep-dive-scope-pane-heading">
                  <h4 id="initiative-scope-epics-heading">Epics</h4>
                  <span>{allDraftEpicsSelected ? "All selected" : `${draftEpicKeys.length} selected`}</span>
                </div>
                <label className="tb-deep-dive-scope-search">
                  <Search size={15} aria-hidden="true" />
                  <input
                    type="search"
                    value={epicSearch}
                    aria-label="Search epics"
                    placeholder="Search by title or key…"
                    onChange={(event) => setEpicSearch(event.target.value)}
                    disabled={isDraftEpicLoading}
                  />
                </label>
                <div className="tb-deep-dive-scope-options" role="group" aria-label="Epic options" aria-busy={isDraftEpicLoading}>
                  {isDraftEpicLoading ? (
                    <div className="tb-deep-dive-options-loading"><RefreshCw size={15} aria-hidden="true" /> Loading eligible epics…</div>
                  ) : draftError ? (
                    <p className="tb-deep-dive-option-error">{draftError}</p>
                  ) : (
                    <>
                      <label className="tb-deep-dive-check-option is-all">
                        <input
                          type="checkbox"
                          checked={allDraftEpicsSelected}
                          onChange={() => setDraftEpicKeys([])}
                        />
                        <span className="tb-deep-dive-checkbox" aria-hidden="true">
                          {allDraftEpicsSelected ? <Check size={13} /> : null}
                        </span>
                        <span>
                          <strong>All epics in selected groups</strong>
                          <small>{draftEpicOptions.length} eligible epics</small>
                        </span>
                      </label>
                      {filteredDraftEpics.map((epic) => {
                        const checked = draftEpicKeys.includes(epic.epicKey);
                        return (
                          <label className="tb-deep-dive-check-option" key={epic.epicKey}>
                            <input type="checkbox" checked={checked} onChange={() => toggleDraftEpic(epic.epicKey)} />
                            <span className="tb-deep-dive-checkbox" aria-hidden="true">
                              {checked ? <Check size={13} /> : null}
                            </span>
                            <span>
                              <strong>{epic.epicName}</strong>
                              <small>{epic.epicKey}</small>
                            </span>
                          </label>
                        );
                      })}
                      {filteredDraftEpics.length === 0 ? <p className="tb-deep-dive-option-empty">No matching epics.</p> : null}
                    </>
                  )}
                </div>
              </section>
            </div>

            <footer className="tb-deep-dive-scope-footer">
              <p>
                <strong>{allDraftGroupsSelected ? `All ${groups.length}` : draftGroupIds.length}</strong> groups
                <span aria-hidden="true">·</span>
                <strong>{allDraftEpicsSelected ? `All ${draftEpicOptions.length}` : draftEpicKeys.length}</strong> epics
              </p>
              <div>
                <button type="button" className="tb-btn" onClick={() => setIsScopePickerOpen(false)}>Cancel</button>
                <button
                  type="button"
                  className="tb-btn tb-btn-primary"
                  disabled={!scopeHasChanges || isDraftEpicLoading || Boolean(draftError)}
                  onClick={applyDraftScope}
                >
                  Apply scope
                </button>
              </div>
            </footer>
          </div>
        </div>
      ) : null}

      {isTrendConfigOpen ? (
        <div className="tb-modal-layer" role="dialog" aria-modal="true" aria-label="Configure Reporting Period">
          <div className="tb-modal-backdrop" onClick={() => setIsTrendConfigOpen(false)} />
          <div className="tb-modal tb-modal-reporting tb-deep-dive-trend-dialog">
            <header className="tb-modal-head">
              <div>
                <h3>Configure Reporting Period</h3>
                <p className="tb-muted-note">
                  Set one reporting window for the card-flow chart and work-item activity. Current WIP remains a point-in-time snapshot.
                </p>
              </div>
              <div className="tb-action-row">
                <button type="button" className="tb-btn tb-btn-sm" onClick={() => setIsTrendConfigOpen(false)}>
                  Cancel
                </button>
                <button type="button" className="tb-btn tb-btn-sm tb-btn-primary" onClick={saveTrendConfig}>
                  Save
                </button>
              </div>
            </header>

            <div className="tb-exec-period-toolbar">
              <div className={`tb-exec-period-row${trendPresetDraft === "custom" ? " is-custom" : ""}`}>
                <label className="tb-exec-period-field">
                  <span>Reporting Period</span>
                  <select
                    value={trendPresetDraft}
                    onChange={(event) => changeTrendPresetDraft(event.currentTarget.value as TrendPreset)}
                  >
                    <option value="last_1_week">Last 1 Week</option>
                    <option value="last_2_weeks">Last 2 Weeks</option>
                    <option value="last_4_weeks">Last 4 Weeks</option>
                    <option value="last_8_weeks">Last 8 Weeks</option>
                    <option value="last_12_weeks">Last 12 Weeks</option>
                    <option value="last_26_weeks">Last 26 Weeks</option>
                    <option value="last_52_weeks">Last 52 Weeks</option>
                    <option value="custom">Custom</option>
                  </select>
                </label>

                {trendPresetDraft === "custom" ? (
                  <>
                    <label className="tb-exec-period-field">
                      <span>Start</span>
                      <input
                        type="date"
                        value={trendStartDraft}
                        max={todayIso}
                        onInput={(event) => {
                          setTrendStartDraft(event.currentTarget.value);
                          setTrendValidationError(null);
                        }}
                      />
                    </label>
                    <label className="tb-exec-period-field">
                      <span>End</span>
                      <input
                        type="date"
                        value={trendEndDraft}
                        max={todayIso}
                        onInput={(event) => {
                          setTrendEndDraft(event.currentTarget.value);
                          setTrendValidationError(null);
                        }}
                      />
                    </label>
                  </>
                ) : null}
              </div>
            </div>

            <p className="tb-muted-note">
              Selected period: {draftTrendDays === null
                ? "Choose valid dates"
                : `${formatDateRange(trendStartDraft, trendEndDraft)} (${draftTrendDays} day${draftTrendDays === 1 ? "" : "s"}, ${timezone})`}
            </p>
            {trendValidationError ? <p className="tb-error-note">{trendValidationError}</p> : null}
          </div>
        </div>
      ) : null}

      {error ? (
        <section className="tb-panel tb-deep-dive-error" role="alert">
          <div>
            <strong>Initiative Deep Dive could not be loaded.</strong>
            <p>{error}</p>
          </div>
          <button type="button" className="tb-btn tb-btn-sm" onClick={() => setRefreshVersion((value) => value + 1)}>
            <RefreshCw size={15} aria-hidden="true" /> Retry
          </button>
        </section>
      ) : null}

      {groups.length === 0 ? (
        <section className="tb-panel tb-deep-dive-state">
          <h3>No initiative groups configured</h3>
          <p>Add an epic group in Settings before using Initiative Deep Dive.</p>
        </section>
      ) : null}

      {payload ? (
        <>
          <section className="tb-panel tb-deep-dive-chart-panel" aria-labelledby="initiative-flow-heading">
            <div className="tb-deep-dive-section-heading">
              <div>
                <p className="tb-eyebrow">Card flow</p>
                <h3 id="initiative-flow-heading">New and completed cards by week</h3>
                <p>Cards can contribute to both series when they are created and completed in the same week.</p>
                <p className="tb-deep-dive-trend-range">
                  {formatDateRange(activeTrendRange.startDate, activeTrendRange.endDate)} · {formatCount(activeTrendRange.days)} days
                </p>
              </div>
              <div className="tb-deep-dive-chart-actions">
                <button
                  type="button"
                  className={`tb-deep-dive-wip-summary${activity === "current_wip" ? " is-active" : ""}`}
                  aria-pressed={activity === "current_wip"}
                  onClick={() => setActivity("current_wip")}
                >
                  <span>Current WIP</span>
                  <strong>{formatCount(payload.currentWipCount)}</strong>
                  <small>View all active cards</small>
                </button>
              </div>
            </div>
            <InitiativeFlowChart buckets={payload.weekly} />
          </section>

          <section aria-labelledby="initiative-period-heading">
            <div className="tb-deep-dive-period-heading">
              <div>
                <p className="tb-eyebrow">Reporting period shortcuts</p>
                <h3 id="initiative-period-heading">Compare and select a weekly range</h3>
                <p>Choosing a shortcut updates both the chart and the activity table.</p>
              </div>
              <p>Active · {formatDateRange(activeTrendRange.startDate, activeTrendRange.endDate)}</p>
            </div>
            <div className="tb-deep-dive-period-grid">
              {WINDOW_OPTIONS.map((weeks) => {
                const period = payload.periods.find((entry) => entry.weeks === weeks);
                const selected = trendSelection.preset === trendPresetForWeeks(weeks);
                const netFlow = period?.netFlow ?? 0;
                return (
                  <button
                    key={weeks}
                    type="button"
                    className={`tb-deep-dive-period-card${selected ? " is-active" : ""}`}
                    aria-pressed={selected}
                    onClick={() => handleWindowSelection(weeks)}
                  >
                    <span>Last {weeks} week{weeks === 1 ? "" : "s"}</span>
                    <dl>
                      <div><dt>New</dt><dd>{formatCount(period?.newCount ?? 0)}</dd></div>
                      <div><dt>Completed</dt><dd>{formatCount(period?.completedCount ?? 0)}</dd></div>
                      <div><dt>Net flow</dt><dd className={netFlow > 0 ? "is-positive" : netFlow < 0 ? "is-negative" : ""}>{netFlow > 0 ? "+" : ""}{netFlow}</dd></div>
                    </dl>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="tb-panel tb-deep-dive-table-panel" aria-labelledby="initiative-activity-heading">
            <div className="tb-deep-dive-table-heading">
              <div>
                <p className="tb-eyebrow">Work item activity</p>
                <h3 id="initiative-activity-heading">
                  {activity === "current_wip"
                    ? "Current work in progress"
                    : `Activity · ${formatDateRange(activeTrendRange.startDate, activeTrendRange.endDate)}`}
                </h3>
                <p>{activity === "current_wip"
                  ? `Point-in-time snapshot as of ${formatDate(todayIso)}.`
                  : "Created, started, or completed during the shared reporting period."}</p>
              </div>
              <span>{formatCount(payload.count)} {activity === "current_wip" ? "active" : "matching"} card{payload.count === 1 ? "" : "s"}</span>
            </div>

            <div className="tb-deep-dive-activity-filters" role="toolbar" aria-label="Work item activity filter">
              {ACTIVITY_FILTERS.map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  className={activity === filter.id ? "is-active" : ""}
                  aria-pressed={activity === filter.id}
                  aria-label={`${filter.label}, ${formatCount(countForActivity(payload, filter.id))} cards`}
                  onClick={() => setActivity(filter.id)}
                >
                  {filter.label}
                  <span>{formatCount(countForActivity(payload, filter.id))}</span>
                </button>
              ))}
            </div>

            <div className="tb-deep-dive-table-scroll">
              <table className="tb-data-table tb-deep-dive-table">
                <thead>
                  <tr>
                    {TABLE_COLUMNS.map((column) => (
                      <th
                        key={column.id}
                        scope="col"
                        aria-sort={sortField === column.id ? (sortDirection === "asc" ? "ascending" : "descending") : undefined}
                      >
                        <button
                          type="button"
                          className={`tb-table-sort${sortField === column.id ? " is-active" : ""}`}
                          onClick={() => handleSortHeaderClick(column.id)}
                          aria-label={`Sort by ${column.label} (${sortField === column.id ? sortDirection === "asc" ? "ascending" : "descending" : defaultSortDirection(column.id) === "asc" ? "ascending" : "descending"})`}
                        >
                          <span>{column.label}</span>
                          <span className="tb-table-sort-indicator" aria-hidden="true">{resolveSortIndicator(column.id)}</span>
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedCards.map((card) => {
                    const epicTitle = card.epicName.trim() || card.epicKey;
                    return (
                    <tr key={card.issueKey}>
                      <td>
                        <div className="tb-deep-dive-activity-badges">
                          {card.activityTypes.map((entry) => (
                            <span key={entry} className={`is-${entry.replace("_", "-")}`}>{activityLabel(entry)}</span>
                          ))}
                        </div>
                      </td>
                      <td className="tb-deep-dive-epic-cell">
                        {card.epicUrl ? (
                          <a
                            className="tb-deep-dive-jira-link"
                            href={card.epicUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={`Jira epic ${card.epicKey}`}
                          >
                            {epicTitle}
                          </a>
                        ) : <span title={card.epicKey}>{epicTitle}</span>}
                      </td>
                      <td>
                        {card.issueUrl ? (
                          <a className="tb-deep-dive-jira-link" href={card.issueUrl} target="_blank" rel="noopener noreferrer">
                            {card.issueKey}
                          </a>
                        ) : <strong>{card.issueKey}</strong>}
                      </td>
                      <td className="tb-deep-dive-title-cell">
                        <span className="tb-deep-dive-title-text" title={card.summary}>
                          {card.summary}
                        </span>
                      </td>
                      <td><span className={`tb-deep-dive-status ${statusTone(card.statusCategory)}`}>{card.status}</span></td>
                      <td>{formatDateTime(card.createdAt)}</td>
                      <td>{formatDateTime(card.inProgressStartedAt)}</td>
                      <td>{formatDateTime(card.completedAt)}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
              {payload.cards.length === 0 ? (
                <div className="tb-deep-dive-table-empty">
                  No cards match this scope, period, and activity filter.
                </div>
              ) : null}
            </div>
            {payload.truncated ? (
              <p className="tb-deep-dive-truncated">Showing the first {formatCount(payload.limit)} cards, newest activity first.</p>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}
