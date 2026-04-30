import { h } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { TeamInsightAvailableStatus, TeamInsightsResponse, fetchTeamInsights } from "../../../lib/api";
import { getPreference, getPreferenceSync, setPreference } from "../../../lib/persistence";
import { TrendBarChart, type TrendBarChartPoint } from "./TrendBarChart";

export const TREND_WINDOW_OPTIONS = [1, 2, 3, 4, 6, 8, 10, 12] as const;
export const OPEN_TEAM_INSIGHTS_SETTINGS_EVENT = "teambeacon:team-insights-open-settings";
export const TEAM_INSIGHTS_TREND_WINDOW_CHANGE_EVENT = "teambeacon:team-insights-trend-window-change";
export const TEAM_INSIGHTS_TREND_WINDOW_SYNC_EVENT = "teambeacon:team-insights-trend-window-sync";
const DEFAULT_TARGET_CYCLE_TIME_DAYS = 5;
const DEFAULT_TREND_WINDOW = 12;
const TEAM_INSIGHTS_SETTINGS_KEY = "teambeacon.teamInsights.settings";

const EMPTY_INSIGHTS: TeamInsightsResponse = {
  source: "local",
  metrics: {
    avgCommittedStoryPoints: 0,
    avgCompletedStoryPoints: 0,
    completionRatioPercent: 0,
    carryoverPercent: 0,
    avgCycleTimeDays: null,
    cycleTimeStdDevDays: null,
    medianCycleTimeDays: null,
  },
  trend: [],
  statusCycleTime: {
    trackedIssues: 0,
    completedIssues: 0,
    excludedIssues: 0,
    totalDays: 0,
    appliedStatusKeys: [],
    defaultStatusKeys: [],
    availableStatuses: [],
    rows: [],
  },
  cardsInWindow: {
    totalCards: 0,
    inProgressCards: 0,
    completedCards: 0,
    trackedCards: 0,
    appliedStatusKeys: [],
    rows: [],
  },
  workMix: {
    sprintId: null,
    sprintName: null,
    totalIssues: 0,
    slices: [],
  },
  summary: "Work mix will appear once sprint data is synced.",
  error: null,
};

function formatStoryPoints(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "0";
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1).replace(/\.0$/, "");
}

function formatDays(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return `${value.toFixed(1).replace(/\.0$/, "")} d`;
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return `${value.toFixed(1).replace(/\.0$/, "")}%`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  const month = parsed.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const year = String(parsed.getUTCFullYear());
  return `${day}-${month}-${year}`;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).replace(",", "");
}

function formatSprintDateRange(startDate: string | null | undefined, endDate: string | null | undefined): string {
  return `From ${formatDate(startDate)} to ${formatDate(endDate)}`;
}

function formatSprintSequenceLabel(position: number): string {
  return `Sprint ${position + 1}`;
}

function resolveSprintChartLabel(
  sprintName: string | null | undefined,
  position: number,
  showSprintNames: boolean,
): string {
  if (showSprintNames) {
    const trimmedName = sprintName?.trim();
    if (trimmedName) {
      return trimmedName;
    }
  }
  return formatSprintSequenceLabel(position);
}

function computeNiceAxisStep(rawStep: number): number {
  if (!Number.isFinite(rawStep) || rawStep <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  if (normalized <= 1) return magnitude;
  if (normalized <= 2) return 2 * magnitude;
  if (normalized <= 5) return 5 * magnitude;
  return 10 * magnitude;
}

function buildTrendAxis(maxValue: number): { upperBound: number; ticks: number[] } {
  if (!Number.isFinite(maxValue) || maxValue <= 0) {
    return { upperBound: 4, ticks: [0, 1, 2, 3, 4] };
  }

  const step = computeNiceAxisStep(maxValue / 4);
  const upperBound = Math.max(step * 4, Math.ceil(maxValue / step) * step);
  const tickCount = Math.max(2, Math.round(upperBound / step) + 1);
  const ticks = Array.from({ length: tickCount }, (_, index) => roundMetric(index * step));
  return { upperBound, ticks };
}

function formatTrendAxisValue(value: number, chart: TrendChartTab): string {
  if (chart === "completedStoryPoints") {
    return `${formatStoryPoints(value)} SP`;
  }
  return formatDays(value);
}

function normalizeStatusKey(value: string | null | undefined): string | null {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized ? normalized : null;
}

function normalizeStatusSelection(
  statusKeys: string[] | null | undefined,
  availableStatuses: TeamInsightAvailableStatus[],
): string[] {
  if (!statusKeys || statusKeys.length === 0) return [];
  const requested = new Set(
    statusKeys
      .map((statusKey) => normalizeStatusKey(statusKey))
      .filter((statusKey): statusKey is string => statusKey !== null),
  );
  return availableStatuses
    .map((status) => status.statusKey)
    .filter((statusKey) => requested.has(statusKey));
}

function selectionsMatch(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function resolveDefaultCycleTimeStatusKeys(
  availableStatuses: TeamInsightAvailableStatus[],
  explicitDefaultStatusKeys?: string[],
): string[] {
  if (explicitDefaultStatusKeys !== undefined) {
    return normalizeStatusSelection(explicitDefaultStatusKeys, availableStatuses);
  }
  return availableStatuses
    .filter((status) => status.defaultIncluded)
    .map((status) => status.statusKey);
}

export function normalizeTrendWindow(value: number): number {
  return TREND_WINDOW_OPTIONS.includes(value as typeof TREND_WINDOW_OPTIONS[number]) ? value : DEFAULT_TREND_WINDOW;
}

export function formatTrendWindowLabel(value: number): string {
  if (value === 1) return "1 sprint";
  return `Last ${value} sprints`;
}

function getTrendAxisStep(ticks: number[]): number {
  if (ticks.length < 2) return 1;
  return roundMetric(ticks[1] - ticks[0]) || 1;
}

type StatusCycleSortField = "status" | "issueCount" | "avgDays" | "percentOfCycleTime";
type StatusCycleSortDirection = "asc" | "desc";
type CardsInWindowRow = NonNullable<TeamInsightsResponse["cardsInWindow"]>["rows"][number];
type CardsInWindowSortField = (
  "issueKey"
  | "summary"
  | "status"
  | "cycleTime"
);
type CardsInWindowSortDirection = "asc" | "desc";
type TrendChartTab = "cycleTime" | "completedStoryPoints";
type PersistedTeamInsightsSettings = {
  targetCycleTimeDays: number;
  showTargetCycleTime: boolean;
  showCompletedStoryPointsChart: boolean;
  showTrendValueLabels: boolean;
  showActiveSprintMarker: boolean;
  showSprintNames: boolean;
  selectedCycleTimeStatusKeys: string[] | null;
};

const STATUS_CYCLE_PIE_COLORS = [
  "#2e79d8",
  "#1f8f63",
  "#b77700",
  "#c2372e",
  "#6c4ba6",
  "#1c6f9a",
  "#8a4f00",
  "#4a6b2d",
];

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

function compareNumber(left: number, right: number): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function roundMetric(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeTargetCycleTime(value: number | string | null | undefined): number {
  const numericValue = typeof value === "number" ? value : Number.parseFloat(value ?? "");
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return DEFAULT_TARGET_CYCLE_TIME_DAYS;
  }
  return roundMetric(numericValue);
}

function defaultSortDirectionForStatusCycleField(field: StatusCycleSortField): StatusCycleSortDirection {
  return field === "status" ? "asc" : "desc";
}

function defaultSortDirectionForCardsInWindowField(field: CardsInWindowSortField): CardsInWindowSortDirection {
  return field === "cycleTime"
    ? "desc"
    : "asc";
}

function isMissingNumber(value: number | null | undefined): boolean {
  return value === null || value === undefined || Number.isNaN(value);
}

function compareTextWithDirection(
  left: string,
  right: string,
  direction: CardsInWindowSortDirection,
): number {
  const comparison = compareText(left, right);
  return direction === "asc" ? comparison : -comparison;
}

function compareNullableNumberWithDirection(
  left: number | null | undefined,
  right: number | null | undefined,
  direction: CardsInWindowSortDirection,
): number {
  const leftMissing = isMissingNumber(left);
  const rightMissing = isMissingNumber(right);
  if (leftMissing || rightMissing) {
    if (leftMissing && rightMissing) return 0;
    return leftMissing ? 1 : -1;
  }
  const comparison = compareNumber(left as number, right as number);
  return direction === "asc" ? comparison : -comparison;
}

function resolveCardCycleTimeDays(row: CardsInWindowRow): number | null {
  if (!isMissingNumber(row.cycleTimeDays)) return row.cycleTimeDays as number;
  if (!isMissingNumber(row.cycleTimeToDateDays)) return row.cycleTimeToDateDays as number;
  return null;
}

function normalizePersistedCycleTimeStatusKeys(
  value: unknown,
  fallback: string[] | null,
): string[] | null {
  if (value === null) return null;
  if (!Array.isArray(value)) return fallback;
  return Array.from(new Set(
    value
      .map((entry) => normalizeStatusKey(typeof entry === "string" ? entry : null))
      .filter((entry): entry is string => entry !== null),
  ));
}

function nullableSelectionsMatch(left: string[] | null, right: string[] | null): boolean {
  if (left === null || right === null) return left === right;
  return selectionsMatch(left, right);
}

function parsePersistedTeamInsightsSettings(
  raw: string | null,
  fallback: PersistedTeamInsightsSettings,
): PersistedTeamInsightsSettings {
  try {
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<PersistedTeamInsightsSettings>;
    return {
      targetCycleTimeDays: normalizeTargetCycleTime(parsed.targetCycleTimeDays ?? fallback.targetCycleTimeDays),
      showTargetCycleTime: (
        typeof parsed.showTargetCycleTime === "boolean"
          ? parsed.showTargetCycleTime
          : fallback.showTargetCycleTime
      ),
      showCompletedStoryPointsChart: (
        typeof parsed.showCompletedStoryPointsChart === "boolean"
          ? parsed.showCompletedStoryPointsChart
          : fallback.showCompletedStoryPointsChart
      ),
      showTrendValueLabels: (
        typeof parsed.showTrendValueLabels === "boolean"
          ? parsed.showTrendValueLabels
          : fallback.showTrendValueLabels
      ),
      showActiveSprintMarker: (
        typeof parsed.showActiveSprintMarker === "boolean"
          ? parsed.showActiveSprintMarker
          : fallback.showActiveSprintMarker
      ),
      showSprintNames: (
        typeof parsed.showSprintNames === "boolean"
          ? parsed.showSprintNames
          : fallback.showSprintNames
      ),
      selectedCycleTimeStatusKeys: normalizePersistedCycleTimeStatusKeys(
        parsed.selectedCycleTimeStatusKeys,
        fallback.selectedCycleTimeStatusKeys,
      ),
    };
  } catch {
    return fallback;
  }
}

function readPersistedTeamInsightsSettings(
  fallback: PersistedTeamInsightsSettings,
): PersistedTeamInsightsSettings {
  return parsePersistedTeamInsightsSettings(getPreferenceSync(TEAM_INSIGHTS_SETTINGS_KEY), fallback);
}

export function TeamInsightsScreen() {
  const initialSettings = useMemo(
    () => readPersistedTeamInsightsSettings({
      targetCycleTimeDays: DEFAULT_TARGET_CYCLE_TIME_DAYS,
      showTargetCycleTime: true,
      showCompletedStoryPointsChart: true,
      showTrendValueLabels: true,
      showActiveSprintMarker: true,
      showSprintNames: true,
      selectedCycleTimeStatusKeys: null,
    }),
    [],
  );
  const hasHydratedSettingsFromStore = useRef(false);
  const [insights, setInsights] = useState<TeamInsightsResponse>(EMPTY_INSIGHTS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trendWindowSelection, setTrendWindowSelection] = useState<number>(DEFAULT_TREND_WINDOW);
  const [selectedTrendChart, setSelectedTrendChart] = useState<TrendChartTab>("cycleTime");
  const [targetCycleTimeDays, setTargetCycleTimeDays] = useState<number>(initialSettings.targetCycleTimeDays);
  const [showTargetCycleTime, setShowTargetCycleTime] = useState(initialSettings.showTargetCycleTime);
  const [showCompletedStoryPointsChart, setShowCompletedStoryPointsChart] = useState(initialSettings.showCompletedStoryPointsChart);
  const [showTrendValueLabels, setShowTrendValueLabels] = useState(initialSettings.showTrendValueLabels);
  const [showActiveSprintMarker, setShowActiveSprintMarker] = useState(initialSettings.showActiveSprintMarker);
  const [showSprintNames, setShowSprintNames] = useState(initialSettings.showSprintNames);
  const [selectedCycleTimeStatusKeys, setSelectedCycleTimeStatusKeys] = useState<string[] | null>(
    initialSettings.selectedCycleTimeStatusKeys,
  );
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [draftTargetCycleTimeInput, setDraftTargetCycleTimeInput] = useState(String(initialSettings.targetCycleTimeDays));
  const [draftShowTargetCycleTime, setDraftShowTargetCycleTime] = useState(initialSettings.showTargetCycleTime);
  const [draftShowCompletedStoryPointsChart, setDraftShowCompletedStoryPointsChart] = useState(
    initialSettings.showCompletedStoryPointsChart,
  );
  const [draftShowTrendValueLabels, setDraftShowTrendValueLabels] = useState(initialSettings.showTrendValueLabels);
  const [draftShowActiveSprintMarker, setDraftShowActiveSprintMarker] = useState(initialSettings.showActiveSprintMarker);
  const [draftShowSprintNames, setDraftShowSprintNames] = useState(initialSettings.showSprintNames);
  const [draftSelectedCycleTimeStatusKeys, setDraftSelectedCycleTimeStatusKeys] = useState(
    initialSettings.selectedCycleTimeStatusKeys ?? [],
  );
  const [statusCycleSortField, setStatusCycleSortField] = useState<StatusCycleSortField>("percentOfCycleTime");
  const [statusCycleSortDirection, setStatusCycleSortDirection] = useState<StatusCycleSortDirection>("desc");
  const [cardKeyFilter, setCardKeyFilter] = useState("");
  const [cardSprintFilter, setCardSprintFilter] = useState("all");
  const [cardStatusFilter, setCardStatusFilter] = useState("all");
  const [cardTypeFilter, setCardTypeFilter] = useState("all");
  const [cardEpicFilter, setCardEpicFilter] = useState("all");
  const [cardsInWindowSortField, setCardsInWindowSortField] = useState<CardsInWindowSortField>("cycleTime");
  const [cardsInWindowSortDirection, setCardsInWindowSortDirection] = useState<CardsInWindowSortDirection>("desc");
  const [selectedCardIssueKey, setSelectedCardIssueKey] = useState<string | null>(null);

  const loadInsights = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchTeamInsights(trendWindowSelection, selectedCycleTimeStatusKeys);
      setInsights(payload);
      if (payload.error) {
        setError(payload.error);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown team insights request failure.";
      setError(message);
      setInsights(EMPTY_INSIGHTS);
    } finally {
      setLoading(false);
    }
  }, [selectedCycleTimeStatusKeys, trendWindowSelection]);

  useEffect(() => {
    loadInsights().catch(() => {
      // Local state handles request failures.
    });
  }, [loadInsights]);

  useEffect(() => {
    const payload: PersistedTeamInsightsSettings = {
      targetCycleTimeDays,
      showTargetCycleTime,
      showCompletedStoryPointsChart,
      showTrendValueLabels,
      showActiveSprintMarker,
      showSprintNames,
      selectedCycleTimeStatusKeys,
    };
    void setPreference(TEAM_INSIGHTS_SETTINGS_KEY, JSON.stringify(payload));
  }, [
    selectedCycleTimeStatusKeys,
    showActiveSprintMarker,
    showCompletedStoryPointsChart,
    showSprintNames,
    showTargetCycleTime,
    showTrendValueLabels,
    targetCycleTimeDays,
  ]);

  useEffect(() => {
    if (hasHydratedSettingsFromStore.current) return;
    hasHydratedSettingsFromStore.current = true;

    let cancelled = false;
    const fallback: PersistedTeamInsightsSettings = {
      targetCycleTimeDays: initialSettings.targetCycleTimeDays,
      showTargetCycleTime: initialSettings.showTargetCycleTime,
      showCompletedStoryPointsChart: initialSettings.showCompletedStoryPointsChart,
      showTrendValueLabels: initialSettings.showTrendValueLabels,
      showActiveSprintMarker: initialSettings.showActiveSprintMarker,
      showSprintNames: initialSettings.showSprintNames,
      selectedCycleTimeStatusKeys: initialSettings.selectedCycleTimeStatusKeys,
    };

    void (async () => {
      const raw = await getPreference(TEAM_INSIGHTS_SETTINGS_KEY);
      if (cancelled) return;

      const persisted = parsePersistedTeamInsightsSettings(raw, fallback);
      const isSame = (
        persisted.targetCycleTimeDays === targetCycleTimeDays
        && persisted.showTargetCycleTime === showTargetCycleTime
        && persisted.showCompletedStoryPointsChart === showCompletedStoryPointsChart
        && persisted.showTrendValueLabels === showTrendValueLabels
        && persisted.showActiveSprintMarker === showActiveSprintMarker
        && persisted.showSprintNames === showSprintNames
        && nullableSelectionsMatch(persisted.selectedCycleTimeStatusKeys, selectedCycleTimeStatusKeys)
      );
      if (isSame) return;

      setTargetCycleTimeDays(persisted.targetCycleTimeDays);
      setDraftTargetCycleTimeInput(String(persisted.targetCycleTimeDays));
      setShowTargetCycleTime(persisted.showTargetCycleTime);
      setDraftShowTargetCycleTime(persisted.showTargetCycleTime);
      setShowCompletedStoryPointsChart(persisted.showCompletedStoryPointsChart);
      setDraftShowCompletedStoryPointsChart(persisted.showCompletedStoryPointsChart);
      if (!persisted.showCompletedStoryPointsChart) {
        setSelectedTrendChart("cycleTime");
      }
      setShowTrendValueLabels(persisted.showTrendValueLabels);
      setDraftShowTrendValueLabels(persisted.showTrendValueLabels);
      setShowActiveSprintMarker(persisted.showActiveSprintMarker);
      setDraftShowActiveSprintMarker(persisted.showActiveSprintMarker);
      setShowSprintNames(persisted.showSprintNames);
      setDraftShowSprintNames(persisted.showSprintNames);
      setSelectedCycleTimeStatusKeys(persisted.selectedCycleTimeStatusKeys);
      setDraftSelectedCycleTimeStatusKeys(persisted.selectedCycleTimeStatusKeys ?? []);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    initialSettings,
    selectedCycleTimeStatusKeys,
    showActiveSprintMarker,
    showCompletedStoryPointsChart,
    showSprintNames,
    showTargetCycleTime,
    showTrendValueLabels,
    targetCycleTimeDays,
  ]);

  const availableCycleTimeStatuses = useMemo(
    () => insights.statusCycleTime.availableStatuses ?? [],
    [insights.statusCycleTime.availableStatuses],
  );
  const defaultCycleTimeStatusKeys = useMemo(
    () => resolveDefaultCycleTimeStatusKeys(availableCycleTimeStatuses, insights.statusCycleTime.defaultStatusKeys),
    [availableCycleTimeStatuses, insights.statusCycleTime.defaultStatusKeys],
  );
  const appliedCycleTimeStatusKeys = useMemo(() => {
    if (insights.statusCycleTime.appliedStatusKeys !== undefined) {
      return normalizeStatusSelection(insights.statusCycleTime.appliedStatusKeys, availableCycleTimeStatuses);
    }
    if (selectedCycleTimeStatusKeys !== null) {
      return normalizeStatusSelection(selectedCycleTimeStatusKeys, availableCycleTimeStatuses);
    }
    return defaultCycleTimeStatusKeys;
  }, [
    availableCycleTimeStatuses,
    defaultCycleTimeStatusKeys,
    insights.statusCycleTime.appliedStatusKeys,
    selectedCycleTimeStatusKeys,
  ]);

  const openSettings = useCallback(() => {
    setDraftTargetCycleTimeInput(String(targetCycleTimeDays));
    setDraftShowTargetCycleTime(showTargetCycleTime);
    setDraftShowCompletedStoryPointsChart(showCompletedStoryPointsChart);
    setDraftShowTrendValueLabels(showTrendValueLabels);
    setDraftShowActiveSprintMarker(showActiveSprintMarker);
    setDraftShowSprintNames(showSprintNames);
    setDraftSelectedCycleTimeStatusKeys(appliedCycleTimeStatusKeys);
    setIsSettingsOpen(true);
  }, [
    appliedCycleTimeStatusKeys,
    showActiveSprintMarker,
    showCompletedStoryPointsChart,
    showSprintNames,
    showTargetCycleTime,
    showTrendValueLabels,
    targetCycleTimeDays,
  ]);

  const closeSettings = useCallback(() => {
    setIsSettingsOpen(false);
  }, []);

  const saveSettings = useCallback(() => {
    const nextTargetCycleTimeDays = normalizeTargetCycleTime(draftTargetCycleTimeInput);
    const nextCycleTimeStatusKeys = normalizeStatusSelection(draftSelectedCycleTimeStatusKeys, availableCycleTimeStatuses);
    setTargetCycleTimeDays(nextTargetCycleTimeDays);
    setDraftTargetCycleTimeInput(String(nextTargetCycleTimeDays));
    setShowTargetCycleTime(draftShowTargetCycleTime);
    setShowCompletedStoryPointsChart(draftShowCompletedStoryPointsChart);
    if (!draftShowCompletedStoryPointsChart) {
      setSelectedTrendChart("cycleTime");
    }
    setShowTrendValueLabels(draftShowTrendValueLabels);
    setShowActiveSprintMarker(draftShowActiveSprintMarker);
    setShowSprintNames(draftShowSprintNames);
    setSelectedCycleTimeStatusKeys(
      selectionsMatch(nextCycleTimeStatusKeys, defaultCycleTimeStatusKeys) ? null : nextCycleTimeStatusKeys,
    );
    setIsSettingsOpen(false);
  }, [
    availableCycleTimeStatuses,
    defaultCycleTimeStatusKeys,
    draftSelectedCycleTimeStatusKeys,
    draftTargetCycleTimeInput,
    draftShowCompletedStoryPointsChart,
    draftShowActiveSprintMarker,
    draftShowSprintNames,
    draftShowTargetCycleTime,
    draftShowTrendValueLabels,
  ]);

  useEffect(() => {
    const handleOpen = () => openSettings();
    window.addEventListener(OPEN_TEAM_INSIGHTS_SETTINGS_EVENT, handleOpen);
    return () => {
      window.removeEventListener(OPEN_TEAM_INSIGHTS_SETTINGS_EVENT, handleOpen);
    };
  }, [openSettings]);
  useEffect(() => {
    const handleTrendWindowChange = (event: Event) => {
      const detail = (event as CustomEvent<{ trendWindow?: number }>).detail;
      const requestedTrendWindow = Number.parseInt(String(detail?.trendWindow ?? ""), 10);
      if (Number.isNaN(requestedTrendWindow)) return;
      setTrendWindowSelection(normalizeTrendWindow(requestedTrendWindow));
    };
    window.addEventListener(TEAM_INSIGHTS_TREND_WINDOW_CHANGE_EVENT, handleTrendWindowChange as EventListener);
    return () => {
      window.removeEventListener(TEAM_INSIGHTS_TREND_WINDOW_CHANGE_EVENT, handleTrendWindowChange as EventListener);
    };
  }, []);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(TEAM_INSIGHTS_TREND_WINDOW_SYNC_EVENT, {
      detail: { trendWindow: trendWindowSelection },
    }));
  }, [trendWindowSelection]);

  const maxCompletedStoryPoints = useMemo(() => {
    if (insights.trend.length === 0) return 0;
    return Math.max(...insights.trend.map((point) => point.completedStoryPoints), 0);
  }, [insights.trend]);
  const maxSprintAvgCycleTimeDays = useMemo(() => {
    if (insights.trend.length === 0) return 0;
    return Math.max(...insights.trend.map((point) => point.avgCycleTimeDays ?? 0), 0);
  }, [insights.trend]);
  const cycleTimeAxis = useMemo(
    () => buildTrendAxis(Math.max(maxSprintAvgCycleTimeDays, showTargetCycleTime ? targetCycleTimeDays : 0)),
    [maxSprintAvgCycleTimeDays, showTargetCycleTime, targetCycleTimeDays]
  );
  const completedStoryPointsAxis = useMemo(() => buildTrendAxis(maxCompletedStoryPoints), [maxCompletedStoryPoints]);
  const selectedStatusCycleRows = useMemo(() => insights.statusCycleTime.rows, [insights.statusCycleTime.rows]);
  const cardsInWindowRows = useMemo(
    () => insights.cardsInWindow?.rows ?? [],
    [insights.cardsInWindow?.rows],
  );
  const cardsInWindowTotalCards = insights.cardsInWindow?.totalCards ?? cardsInWindowRows.length;
  const cardSprintFilterOptions = useMemo(
    () => insights.trend.map((row) => ({
      value: String(row.sprintId),
      label: row.sprintName?.trim() ? row.sprintName : `Sprint ${row.sprintId}`,
    })),
    [insights.trend],
  );
  const cardStatusFilterOptions = useMemo(
    () => Array.from(
      new Map(cardsInWindowRows.map((row) => [row.statusKey, row.status])).entries(),
    )
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => compareText(left.label, right.label)),
    [cardsInWindowRows],
  );
  const cardTypeFilterOptions = useMemo(
    () => Array.from(
      new Map(cardsInWindowRows.map((row) => [row.issueTypeKey, row.issueType])).entries(),
    )
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => compareText(left.label, right.label)),
    [cardsInWindowRows],
  );
  const cardEpicFilterOptions = useMemo(() => {
    const optionsByValue = new Map<string, { value: string; label: string }>();
    for (const row of cardsInWindowRows) {
      const epicKey = row.epicKey?.trim();
      if (!epicKey) continue;
      const epicName = row.epicName?.trim();
      const label = epicName ? `${epicKey} - ${epicName}` : epicKey;
      const current = optionsByValue.get(epicKey);
      if (!current || current.label === current.value) {
        optionsByValue.set(epicKey, { value: epicKey, label });
      }
    }
    return Array.from(optionsByValue.values()).sort((left, right) => compareText(left.label, right.label));
  }, [cardsInWindowRows]);
  const filteredCardsInWindowRows = useMemo(() => {
    const normalizedSearchFilter = cardKeyFilter.trim().toLowerCase();
    return cardsInWindowRows.filter((row) => {
      if (normalizedSearchFilter) {
        const issueKeyMatches = row.issueKey.toLowerCase().includes(normalizedSearchFilter);
        const summaryMatches = row.summary.toLowerCase().includes(normalizedSearchFilter);
        if (!issueKeyMatches && !summaryMatches) {
          return false;
        }
      }
      if (cardSprintFilter !== "all" && String(row.sprintId) !== cardSprintFilter) {
        return false;
      }
      if (cardStatusFilter !== "all" && row.statusKey !== cardStatusFilter) {
        return false;
      }
      if (cardTypeFilter !== "all" && row.issueTypeKey !== cardTypeFilter) {
        return false;
      }
      if (cardEpicFilter !== "all" && (row.epicKey?.trim() ?? "") !== cardEpicFilter) {
        return false;
      }
      return true;
    });
  }, [cardEpicFilter, cardKeyFilter, cardSprintFilter, cardStatusFilter, cardTypeFilter, cardsInWindowRows]);
  const sortedCardsInWindowRows = useMemo(() => {
    const nextRows = [...filteredCardsInWindowRows];
    nextRows.sort((left, right) => {
      let comparison = 0;
      switch (cardsInWindowSortField) {
        case "issueKey":
          comparison = compareTextWithDirection(left.issueKey, right.issueKey, cardsInWindowSortDirection);
          break;
        case "summary":
          comparison = compareTextWithDirection(left.summary, right.summary, cardsInWindowSortDirection);
          break;
        case "status":
          comparison = compareTextWithDirection(left.status, right.status, cardsInWindowSortDirection);
          break;
        case "cycleTime":
          comparison = compareNullableNumberWithDirection(
            resolveCardCycleTimeDays(left),
            resolveCardCycleTimeDays(right),
            cardsInWindowSortDirection,
          );
          break;
      }
      if (comparison === 0) {
        comparison = compareText(left.issueKey, right.issueKey);
      }
      return comparison;
    });
    return nextRows;
  }, [cardsInWindowSortDirection, cardsInWindowSortField, filteredCardsInWindowRows]);
  const visibleCardsInWindowCount = sortedCardsInWindowRows.length;
  const selectedCardRow = useMemo(
    () => sortedCardsInWindowRows.find((row) => row.issueKey === selectedCardIssueKey) ?? null,
    [selectedCardIssueKey, sortedCardsInWindowRows],
  );
  const selectedCardStatusTimeline = selectedCardRow?.statusTimeline ?? [];
  const selectedCardStatusBreakdown = useMemo(() => {
    const totalsByStatus = new Map<string, { status: string; days: number }>();
    for (const entry of selectedCardStatusTimeline) {
      if (!entry.isCycleTimeStatus) continue;
      if (entry.days <= 0) continue;
      const current = totalsByStatus.get(entry.statusKey);
      if (current) {
        current.days += entry.days;
      } else {
        totalsByStatus.set(entry.statusKey, { status: entry.status, days: entry.days });
      }
    }
    const totalDays = Array.from(totalsByStatus.values()).reduce((sum, row) => sum + row.days, 0);
    const rows = Array.from(totalsByStatus.entries())
      .map(([statusKey, row]) => ({
        statusKey,
        status: row.status,
        days: roundMetric(row.days),
        percentOfTicketTime: totalDays > 0 ? roundMetric((row.days / totalDays) * 100) : 0,
      }))
      .sort((left, right) => compareNumber(right.days, left.days));
    return rows.map((row, index) => ({
      ...row,
      color: STATUS_CYCLE_PIE_COLORS[index % STATUS_CYCLE_PIE_COLORS.length],
    }));
  }, [selectedCardStatusTimeline]);
  const selectedCardStatusPieGradient = useMemo(() => {
    if (selectedCardStatusBreakdown.length === 0) {
      return "conic-gradient(#dfe8f8 0% 100%)";
    }
    let cursor = 0;
    const segments: string[] = [];
    for (const slice of selectedCardStatusBreakdown) {
      const start = cursor;
      const end = Math.min(100, start + slice.percentOfTicketTime);
      segments.push(`${slice.color} ${start}% ${end}%`);
      cursor = end;
    }
    if (cursor < 100) {
      segments.push(`#dfe8f8 ${cursor}% 100%`);
    }
    return `conic-gradient(${segments.join(", ")})`;
  }, [selectedCardStatusBreakdown]);
  const statusCyclePieSlices = useMemo(() => {
    const rows = [...selectedStatusCycleRows].sort((left, right) => right.percentOfCycleTime - left.percentOfCycleTime);
    return rows.map((row, index) => ({
      ...row,
      color: STATUS_CYCLE_PIE_COLORS[index % STATUS_CYCLE_PIE_COLORS.length],
    }));
  }, [selectedStatusCycleRows]);
  const statusCyclePieGradient = useMemo(() => {
    if (statusCyclePieSlices.length === 0) {
      return "conic-gradient(#dfe8f8 0% 100%)";
    }
    let cursor = 0;
    const segments: string[] = [];
    for (const slice of statusCyclePieSlices) {
      const start = cursor;
      const end = Math.min(start + slice.percentOfCycleTime, 100);
      segments.push(`${slice.color} ${start}% ${end}%`);
      cursor = end;
    }
    if (cursor < 100) {
      segments.push(`#dfe8f8 ${cursor}% 100%`);
    }
    return `conic-gradient(${segments.join(", ")})`;
  }, [statusCyclePieSlices]);
  const sortedStatusCycleRows = useMemo(() => {
    const nextRows = [...selectedStatusCycleRows];
    nextRows.sort((left, right) => {
      let comparison = 0;
      switch (statusCycleSortField) {
        case "status":
          comparison = compareText(left.status, right.status);
          break;
        case "issueCount":
          comparison = compareNumber(left.issueCount, right.issueCount);
          break;
        case "avgDays":
          comparison = compareNumber(left.avgDays, right.avgDays);
          break;
        case "percentOfCycleTime":
          comparison = compareNumber(left.percentOfCycleTime, right.percentOfCycleTime);
          break;
      }

      if (comparison === 0) {
        comparison = compareText(left.status, right.status);
      }
      return statusCycleSortDirection === "asc" ? comparison : -comparison;
    });
    return nextRows;
  }, [selectedStatusCycleRows, statusCycleSortDirection, statusCycleSortField]);
  useEffect(() => {
    if (cardSprintFilter === "all") return;
    if (cardSprintFilterOptions.some((option) => option.value === cardSprintFilter)) return;
    setCardSprintFilter("all");
  }, [cardSprintFilter, cardSprintFilterOptions]);
  useEffect(() => {
    if (cardStatusFilter === "all") return;
    if (cardStatusFilterOptions.some((option) => option.value === cardStatusFilter)) return;
    setCardStatusFilter("all");
  }, [cardStatusFilter, cardStatusFilterOptions]);
  useEffect(() => {
    if (cardTypeFilter === "all") return;
    if (cardTypeFilterOptions.some((option) => option.value === cardTypeFilter)) return;
    setCardTypeFilter("all");
  }, [cardTypeFilter, cardTypeFilterOptions]);
  useEffect(() => {
    if (cardEpicFilter === "all") return;
    if (cardEpicFilterOptions.some((option) => option.value === cardEpicFilter)) return;
    setCardEpicFilter("all");
  }, [cardEpicFilter, cardEpicFilterOptions]);
  useEffect(() => {
    if (sortedCardsInWindowRows.length === 0) {
      if (selectedCardIssueKey !== null) setSelectedCardIssueKey(null);
      return;
    }
    if (selectedCardIssueKey && sortedCardsInWindowRows.some((row) => row.issueKey === selectedCardIssueKey)) {
      return;
    }
    setSelectedCardIssueKey(sortedCardsInWindowRows[0].issueKey);
  }, [selectedCardIssueKey, sortedCardsInWindowRows]);

  const cycleTimeStatusGroups = useMemo(() => {
    const categoryOrder = ["To Do", "In Progress", "Done", "Other"] as const;
    return categoryOrder
      .map((category) => ({
        category,
        statuses: availableCycleTimeStatuses.filter((status) => status.statusCategory === category),
      }))
      .filter((group) => group.statuses.length > 0);
  }, [availableCycleTimeStatuses]);
  const draftSelectedCycleTimeStatusCount = draftSelectedCycleTimeStatusKeys.length;
  const availableCycleTimeStatusCount = availableCycleTimeStatuses.length;
  const hasNoDraftCycleTimeStatuses = (
    availableCycleTimeStatusCount > 0
    && draftSelectedCycleTimeStatusCount === 0
  );
  const trackedCompletedIssueCount = insights.statusCycleTime.trackedIssues;
  const excludedCompletedIssueCount = insights.statusCycleTime.excludedIssues ?? 0;

  const toggleDraftCycleTimeStatus = useCallback((statusKey: string) => {
    setDraftSelectedCycleTimeStatusKeys((current) => (
      current.includes(statusKey)
        ? current.filter((value) => value !== statusKey)
        : [...current, statusKey]
    ));
  }, []);

  const selectAllDraftCycleTimeStatuses = useCallback(() => {
    setDraftSelectedCycleTimeStatusKeys(availableCycleTimeStatuses.map((status) => status.statusKey));
  }, [availableCycleTimeStatuses]);

  const clearDraftCycleTimeStatuses = useCallback(() => {
    setDraftSelectedCycleTimeStatusKeys([]);
  }, []);

  const handleStatusCycleSortHeaderClick = useCallback((field: StatusCycleSortField) => {
    setStatusCycleSortField((current) => {
      if (current === field) {
        setStatusCycleSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
        return current;
      }
      setStatusCycleSortDirection(defaultSortDirectionForStatusCycleField(field));
      return field;
    });
  }, []);

  const handleCardsInWindowSortHeaderClick = useCallback((field: CardsInWindowSortField) => {
    setCardsInWindowSortField((current) => {
      if (current === field) {
        setCardsInWindowSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
        return current;
      }
      setCardsInWindowSortDirection(defaultSortDirectionForCardsInWindowField(field));
      return field;
    });
  }, []);

  const resolveStatusCycleSortIndicator = useCallback((field: StatusCycleSortField): string => {
    if (statusCycleSortField !== field) return "↕";
    return statusCycleSortDirection === "asc" ? "↑" : "↓";
  }, [statusCycleSortDirection, statusCycleSortField]);
  const resolveCardsInWindowSortIndicator = useCallback((field: CardsInWindowSortField): string => {
    if (cardsInWindowSortField !== field) return "↕";
    return cardsInWindowSortDirection === "asc" ? "↑" : "↓";
  }, [cardsInWindowSortDirection, cardsInWindowSortField]);

  const trendRows = insights.trend;
  const activeTrendChart = selectedTrendChart === "completedStoryPoints" && showCompletedStoryPointsChart
    ? "completedStoryPoints"
    : "cycleTime";
  const cycleTimeAxisStep = useMemo(() => getTrendAxisStep(cycleTimeAxis.ticks), [cycleTimeAxis.ticks]);
  const completedStoryPointsAxisStep = useMemo(
    () => getTrendAxisStep(completedStoryPointsAxis.ticks),
    [completedStoryPointsAxis.ticks]
  );
  const cycleTimeTrendPoints = useMemo<TrendBarChartPoint[]>(
    () => trendRows.map((point, index) => ({
      label: resolveSprintChartLabel(point.sprintName, index, showSprintNames),
      tooltipLabel: formatSprintDateRange(point.startDate, point.endDate),
      value: point.avgCycleTimeDays ?? 0,
      valueLabel: formatDays(point.avgCycleTimeDays),
      isActive: point.state?.toLowerCase() === "active",
    })),
    [showSprintNames, trendRows]
  );
  const completedStoryPointsTrendPoints = useMemo<TrendBarChartPoint[]>(
    () => trendRows.map((point, index) => ({
      label: resolveSprintChartLabel(point.sprintName, index, showSprintNames),
      tooltipLabel: formatSprintDateRange(point.startDate, point.endDate),
      value: point.completedStoryPoints,
      valueLabel: `${formatStoryPoints(point.completedStoryPoints)} SP`,
      isActive: point.state?.toLowerCase() === "active",
    })),
    [showSprintNames, trendRows]
  );
  const trendChartNote = showActiveSprintMarker
    ? "Older sprints are shown on the left and recent sprints on the right. The green dot marks the active sprint."
    : "Older sprints are shown on the left and recent sprints on the right.";

  return (
    <div class="tb-screen-grid">
      <section class="tb-panel">
        <header class="tb-panel-header">
          <div>
            <h3>Sprint Trend</h3>
          </div>
        </header>
        <div class="tb-metrics-grid tb-four-up">
          <article class="tb-metric-card">
            <h4>Median Cycle Time</h4>
            <strong class="tb-value tb-value-good">{formatDays(insights.metrics.medianCycleTimeDays)}</strong>
            <p>Middle cycle-time value across completed cards.</p>
          </article>
          <article class="tb-metric-card">
            <h4>Avg Cycle Time</h4>
            <strong class="tb-value tb-value-good">{formatDays(insights.metrics.avgCycleTimeDays)}</strong>
            <p>Average across completed cards in trend window.</p>
          </article>
          <article class="tb-metric-card">
            <h4>Cycle Time Std Dev</h4>
            <strong class="tb-value tb-value-good">{formatDays(insights.metrics.cycleTimeStdDevDays)}</strong>
            <p>Variation across completed-card cycle times in trend window.</p>
          </article>
          <article class="tb-metric-card">
            <h4>Avg SP</h4>
            <strong class="tb-value tb-value-good">{formatStoryPoints(insights.metrics.avgCompletedStoryPoints)} SP</strong>
            <p>Average completed story points per sprint.</p>
          </article>
        </div>
        <article class="tb-metric-card tb-trend-tab-card">
          <div class="tb-trend-tabs" role="tablist" aria-label="Sprint trend charts">
            <button
              id="tb-trend-tab-cycle-time"
              type="button"
              role="tab"
              class={`tb-trend-tab${activeTrendChart === "cycleTime" ? " is-active" : ""}`}
              aria-selected={activeTrendChart === "cycleTime"}
              aria-controls="tb-trend-panel-cycle-time"
              tabIndex={activeTrendChart === "cycleTime" ? 0 : -1}
              onClick={() => setSelectedTrendChart("cycleTime")}
            >
              Avg Cycle Time
            </button>
            {showCompletedStoryPointsChart ? (
              <button
                id="tb-trend-tab-completed-sp"
                type="button"
                role="tab"
                class={`tb-trend-tab${activeTrendChart === "completedStoryPoints" ? " is-active" : ""}`}
                aria-selected={activeTrendChart === "completedStoryPoints"}
                aria-controls="tb-trend-panel-completed-sp"
                tabIndex={activeTrendChart === "completedStoryPoints" ? 0 : -1}
                onClick={() => setSelectedTrendChart("completedStoryPoints")}
              >
                Completed SP
              </button>
            ) : null}
          </div>
          {activeTrendChart === "cycleTime" ? (
            <section
              id="tb-trend-panel-cycle-time"
              class="tb-trend-tab-panel"
              role="tabpanel"
              aria-labelledby="tb-trend-tab-cycle-time"
            >
              <div class="tb-trend-chart-frame">
                <TrendBarChart
                  ariaLabel="Average cycle time sprint bar chart"
                  canvasTestId="cycle-time-trend-chart"
                  points={cycleTimeTrendPoints}
                  axisMax={cycleTimeAxis.upperBound}
                  axisStepSize={cycleTimeAxisStep}
                  formatYAxisTick={(value) => formatTrendAxisValue(value, "cycleTime")}
                  showValueLabels={showTrendValueLabels}
                  showActiveSprintMarker={showActiveSprintMarker}
                  showTargetLine={showTargetCycleTime}
                  targetValue={targetCycleTimeDays}
                />
                <p class="tb-trend-x-axis-label">Sprints (old to new)</p>
              </div>
            </section>
          ) : (
            <section
              id="tb-trend-panel-completed-sp"
              class="tb-trend-tab-panel"
              role="tabpanel"
              aria-labelledby="tb-trend-tab-completed-sp"
            >
              <div class="tb-trend-chart-frame">
                <TrendBarChart
                  ariaLabel="Completed story points sprint bar chart"
                  canvasTestId="completed-story-points-trend-chart"
                  points={completedStoryPointsTrendPoints}
                  axisMax={completedStoryPointsAxis.upperBound}
                  axisStepSize={completedStoryPointsAxisStep}
                  formatYAxisTick={(value) => formatTrendAxisValue(value, "completedStoryPoints")}
                  showValueLabels={showTrendValueLabels}
                  showActiveSprintMarker={showActiveSprintMarker}
                />
                <p class="tb-trend-x-axis-label">Sprints (old to new)</p>
              </div>
            </section>
          )}
        </article>
        <p class="tb-trend-order-pill tb-trend-chart-note">
          {trendChartNote}
        </p>
        {loading ? <p class="tb-muted-note">Loading sprint trend...</p> : null}
        {error ?? insights.error ? <p class="tb-muted-note">Team insights error: {error ?? insights.error}</p> : null}
        {!loading && insights.trend.length === 0 ? <p class="tb-muted-note">No recent sprint trend data found.</p> : null}
        {isSettingsOpen ? (
          <div class="tb-modal-layer" role="dialog" aria-modal="true" aria-label="Team Insights Settings">
            <div class="tb-modal-backdrop" onClick={closeSettings} />
            <div class="tb-modal tb-modal-team-settings">
              <header class="tb-modal-head">
                <h3>Team Insights Settings</h3>
                <button type="button" class="tb-btn tb-btn-sm" onClick={closeSettings}>
                  Close
                </button>
              </header>

              <p class="tb-muted-note tb-team-settings-intro">
                Tune the sprint-trend display and decide exactly which workflow statuses count toward cycle time.
              </p>

              <div class="tb-team-settings-grid">
                <section class="tb-team-settings-card" aria-label="Chart Display">
                  <div class="tb-team-settings-card-head">
                    <div>
                      <h4>Chart Display</h4>
                      <p class="tb-muted-note">Choose which helpers and charts appear in Sprint Trend.</p>
                    </div>
                  </div>
                  <div class="tb-team-settings-toggle-list">
                    <div class="tb-team-settings-toggle-row">
                      <div class="tb-team-settings-toggle-copy">
                        <label class="tb-modal-check">
                          <input
                            type="checkbox"
                            checked={draftShowSprintNames}
                            onChange={(event) => setDraftShowSprintNames((event.currentTarget as HTMLInputElement).checked)}
                          />
                          <span>Show sprint names on charts</span>
                        </label>
                        <p class="tb-muted-note">Use the Jira sprint name on the x-axis instead of Sprint 1, Sprint 2, and so on.</p>
                      </div>
                    </div>

                    <div class="tb-team-settings-toggle-row">
                      <div class="tb-team-settings-toggle-copy">
                        <label class="tb-modal-check">
                          <input
                            type="checkbox"
                            checked={draftShowCompletedStoryPointsChart}
                            onChange={(event) => setDraftShowCompletedStoryPointsChart((event.currentTarget as HTMLInputElement).checked)}
                          />
                          <span>Show SP chart</span>
                        </label>
                        <p class="tb-muted-note">Avg Cycle Time is always visible. This adds the completed story points tab.</p>
                      </div>
                    </div>

                    <div class="tb-team-settings-toggle-row">
                      <div class="tb-team-settings-toggle-copy">
                        <label class="tb-modal-check">
                          <input
                            type="checkbox"
                            checked={draftShowTrendValueLabels}
                            onChange={(event) => setDraftShowTrendValueLabels((event.currentTarget as HTMLInputElement).checked)}
                          />
                          <span>Show bar value labels</span>
                        </label>
                        <p class="tb-muted-note">Show the exact value above each bar instead of extra chart labels.</p>
                      </div>
                    </div>

                    <div class="tb-team-settings-toggle-row">
                      <div class="tb-team-settings-toggle-copy">
                        <label class="tb-modal-check">
                          <input
                            type="checkbox"
                            checked={draftShowActiveSprintMarker}
                            onChange={(event) => setDraftShowActiveSprintMarker((event.currentTarget as HTMLInputElement).checked)}
                          />
                          <span>Show active sprint marker</span>
                        </label>
                        <p class="tb-muted-note">Keep the green dot on the current sprint for quick orientation.</p>
                      </div>
                    </div>
                  </div>

                  <div class="tb-team-settings-divider" />

                  <section class="tb-team-settings-subsection" aria-label="Target Cycle Time">
                    <div class="tb-team-settings-subsection-head">
                      <h5>Target Cycle Time</h5>
                      <p class="tb-muted-note">Add a target line behind the Avg Cycle Time bars.</p>
                    </div>
                    <div class="tb-team-settings-target-grid">
                      <div class="tb-team-settings-toggle-row">
                        <div class="tb-team-settings-toggle-copy">
                          <label class="tb-modal-check">
                            <input
                              type="checkbox"
                              checked={draftShowTargetCycleTime}
                              onChange={(event) => setDraftShowTargetCycleTime((event.currentTarget as HTMLInputElement).checked)}
                            />
                            <span>Show target cycle time</span>
                          </label>
                          <p class="tb-muted-note">Use this to compare each sprint against a consistent cycle-time goal.</p>
                        </div>
                      </div>

                      <label class="tb-modal-field tb-team-settings-field">
                        <span>Target Cycle Time</span>
                        <div class="tb-team-settings-number-input">
                          <input
                            aria-label="Target Cycle Time"
                            type="number"
                            min="0"
                            step="0.1"
                            disabled={!draftShowTargetCycleTime}
                            value={draftTargetCycleTimeInput}
                            onInput={(event) => setDraftTargetCycleTimeInput((event.currentTarget as HTMLInputElement).value)}
                          />
                          <span class="tb-team-settings-input-suffix">days</span>
                        </div>
                      </label>
                    </div>
                  </section>
                </section>

                <section class="tb-team-settings-panel" aria-label="Cycle Time Definition">
                  <div class="tb-team-settings-panel-head">
                    <div class="tb-team-settings-panel-copy">
                      <div class="tb-team-settings-heading-row">
                        <h4>Cycle Time Definition</h4>
                        {availableCycleTimeStatusCount > 0 ? (
                          <span class="tb-team-settings-count-pill">
                            {draftSelectedCycleTimeStatusCount} of {availableCycleTimeStatusCount} statuses selected
                          </span>
                        ) : null}
                      </div>
                      <p class="tb-muted-note">
                        We sum time spent in the checked workflow statuses only. Completed cards with no time in checked
                        statuses are excluded from cycle-time metrics.
                      </p>
                    </div>
                    <div class="tb-team-settings-actions">
                      <button type="button" class="tb-btn tb-btn-sm" onClick={selectAllDraftCycleTimeStatuses}>
                        Select all
                      </button>
                      <button type="button" class="tb-btn tb-btn-sm" onClick={clearDraftCycleTimeStatuses}>
                        Clear all
                      </button>
                    </div>
                  </div>
  
                  {hasNoDraftCycleTimeStatuses ? (
                    <p class="tb-team-settings-warning">
                      No statuses are selected. Completed cards will be excluded from cycle-time metrics until at least
                      one workflow status is checked.
                    </p>
                  ) : null}

                  {cycleTimeStatusGroups.length === 0 ? (
                    <p class="tb-muted-note">Workflow statuses will appear here once sprint history is available.</p>
                  ) : (
                    <div class="tb-team-settings-status-groups">
                      {cycleTimeStatusGroups.map((group) => (
                        <section key={group.category} class="tb-cycle-status-group">
                          <header class="tb-cycle-status-group-head">
                            <h5>{group.category}</h5>
                            <span class="tb-cycle-status-group-count">{group.statuses.length}</span>
                          </header>
                          <div class="tb-cycle-status-grid">
                            {group.statuses.map((status) => (
                              <label key={status.statusKey} class="tb-modal-check tb-cycle-status-option">
                                <input
                                  type="checkbox"
                                  checked={draftSelectedCycleTimeStatusKeys.includes(status.statusKey)}
                                  onChange={() => toggleDraftCycleTimeStatus(status.statusKey)}
                                />
                                <span>{status.status}</span>
                              </label>
                            ))}
                          </div>
                        </section>
                      ))}
                    </div>
                  )}
                </section>
              </div>

              <footer class="tb-modal-actions">
                <button type="button" class="tb-btn" onClick={closeSettings}>
                  Cancel
                </button>
                <button type="button" class="tb-btn tb-btn-primary" onClick={saveSettings}>
                  Save
                </button>
              </footer>
            </div>
          </div>
        ) : null}
      </section>
      <section class="tb-panel">
        <header class="tb-panel-header">
          <div>
            <h3>Cards in Selected Window ({formatTrendWindowLabel(trendWindowSelection)})</h3>
          </div>
          <div class="tb-panel-header-actions">
            <span class="tb-chip">{visibleCardsInWindowCount} of {cardsInWindowTotalCards} cards visible</span>
          </div>
        </header>
        <div class="tb-cards-window-filters">
          <label class="tb-cards-window-filter">
            <span>Search</span>
            <input
              aria-label="Search by key or summary"
              type="text"
              placeholder="Search key, summary"
              value={cardKeyFilter}
              onInput={(event) => setCardKeyFilter((event.currentTarget as HTMLInputElement).value)}
            />
          </label>
          <label class="tb-cards-window-filter">
            <span>Sprint</span>
            <select
              aria-label="Filter sprint"
              value={cardSprintFilter}
              onChange={(event) => setCardSprintFilter((event.currentTarget as HTMLSelectElement).value)}
            >
              <option value="all">All sprints</option>
              {cardSprintFilterOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label class="tb-cards-window-filter">
            <span>Status</span>
            <select
              aria-label="Filter status"
              value={cardStatusFilter}
              onChange={(event) => setCardStatusFilter((event.currentTarget as HTMLSelectElement).value)}
            >
              <option value="all">All statuses</option>
              {cardStatusFilterOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label class="tb-cards-window-filter">
            <span>Type</span>
            <select
              aria-label="Filter type"
              value={cardTypeFilter}
              onChange={(event) => setCardTypeFilter((event.currentTarget as HTMLSelectElement).value)}
            >
              <option value="all">All types</option>
              {cardTypeFilterOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label class="tb-cards-window-filter">
            <span>Epic</span>
            <select
              aria-label="Filter epic"
              value={cardEpicFilter}
              onChange={(event) => setCardEpicFilter((event.currentTarget as HTMLSelectElement).value)}
            >
              <option value="all">All epics</option>
              {cardEpicFilterOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {loading ? <p class="tb-muted-note">Loading cards in selected window...</p> : null}
        {!loading && cardsInWindowRows.length === 0 ? (
          <p class="tb-muted-note">No cards found for the selected sprint window.</p>
        ) : null}
        {!loading && sortedCardsInWindowRows.length === 0 && cardsInWindowRows.length > 0 ? (
          <p class="tb-muted-note">No cards match the current filters.</p>
        ) : null}
        {sortedCardsInWindowRows.length > 0 ? (
          <div class="tb-cards-window-layout">
            <div class="tb-cards-window-table-wrap">
              <table class="tb-cards-window-table" aria-label="Cards in selected window table">
                <thead>
                  <tr>
                    <th>
                      <button
                        type="button"
                        class={`tb-table-sort${cardsInWindowSortField === "issueKey" ? " is-active" : ""}`}
                        onClick={() => handleCardsInWindowSortHeaderClick("issueKey")}
                        aria-label={`Sort by Key (${cardsInWindowSortField === "issueKey" && cardsInWindowSortDirection === "asc" ? "ascending" : "descending"})`}
                      >
                        <span>Key</span>
                        <span class="tb-table-sort-indicator" aria-hidden="true">{resolveCardsInWindowSortIndicator("issueKey")}</span>
                      </button>
                    </th>
                    <th>
                      <button
                        type="button"
                        class={`tb-table-sort${cardsInWindowSortField === "summary" ? " is-active" : ""}`}
                        onClick={() => handleCardsInWindowSortHeaderClick("summary")}
                        aria-label={`Sort by Summary (${cardsInWindowSortField === "summary" && cardsInWindowSortDirection === "asc" ? "ascending" : "descending"})`}
                      >
                        <span>Summary</span>
                        <span class="tb-table-sort-indicator" aria-hidden="true">{resolveCardsInWindowSortIndicator("summary")}</span>
                      </button>
                    </th>
                    <th>
                      <button
                        type="button"
                        class={`tb-table-sort${cardsInWindowSortField === "status" ? " is-active" : ""}`}
                        onClick={() => handleCardsInWindowSortHeaderClick("status")}
                        aria-label={`Sort by Status (${cardsInWindowSortField === "status" && cardsInWindowSortDirection === "asc" ? "ascending" : "descending"})`}
                      >
                        <span>Status</span>
                        <span class="tb-table-sort-indicator" aria-hidden="true">{resolveCardsInWindowSortIndicator("status")}</span>
                      </button>
                    </th>
                    <th class="is-numeric tb-cards-window-cycle-time-head">
                      <button
                        type="button"
                        class={`tb-table-sort${cardsInWindowSortField === "cycleTime" ? " is-active" : ""}`}
                        onClick={() => handleCardsInWindowSortHeaderClick("cycleTime")}
                        aria-label={`Sort by Cycle Time (${cardsInWindowSortField === "cycleTime" && cardsInWindowSortDirection === "asc" ? "ascending" : "descending"})`}
                      >
                        <span>Cycle Time</span>
                        <span class="tb-table-sort-indicator" aria-hidden="true">{resolveCardsInWindowSortIndicator("cycleTime")}</span>
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedCardsInWindowRows.map((row) => (
                    <tr
                      key={`cards-window-${row.issueKey}`}
                      class={row.issueKey === selectedCardIssueKey ? "is-selected" : ""}
                    >
                      <td class="tb-cards-window-key-cell">
                        <button
                          type="button"
                          class={`tb-cards-window-ticket-button${row.issueKey === selectedCardIssueKey ? " is-selected" : ""}`}
                          onClick={() => setSelectedCardIssueKey(row.issueKey)}
                        >
                          <span class="tb-cards-window-ticket-key">{row.issueKey}</span>
                        </button>
                      </td>
                      <td class="tb-cards-window-summary-cell">{row.summary}</td>
                      <td>{row.status}</td>
                      <td class="tb-status-cycle-cell-numeric tb-cards-window-cycle-time-cell">
                        {formatDays(resolveCardCycleTimeDays(row))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <aside class="tb-cards-window-detail-card">
              <h4>Card Statuses</h4>
              {selectedCardRow ? (
                <>
                  {selectedCardRow.issueUrl ? (
                    <a
                      class="tb-cards-window-detail-issue-link"
                      href={selectedCardRow.issueUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <span class="tb-cards-window-detail-issue-key">{selectedCardRow.issueKey}</span>
                      <span class="tb-cards-window-detail-issue-summary">{selectedCardRow.summary}</span>
                    </a>
                  ) : (
                    <div class="tb-cards-window-detail-issue-link is-static">
                      <span class="tb-cards-window-detail-issue-key">{selectedCardRow.issueKey}</span>
                      <span class="tb-cards-window-detail-issue-summary">{selectedCardRow.summary}</span>
                    </div>
                  )}
                  <p class="tb-muted-note">Bold statuses contribute to cycle-time calculations.</p>
                  {selectedCardStatusTimeline.length > 0 ? (
                    <div class="tb-cards-window-detail-wrap">
                      <table class="tb-cards-window-detail-table" aria-label="Selected card status timeline">
                        <thead>
                          <tr>
                            <th>Status</th>
                            <th>Changed At</th>
                            <th class="is-numeric">Days</th>
                            <th class="is-numeric">% Time</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedCardStatusTimeline.map((entry, index) => (
                            <tr key={`${selectedCardRow.issueKey}-${entry.statusKey}-${index}`}>
                              <td>
                                {entry.isCycleTimeStatus ? <strong>{entry.status}</strong> : entry.status}
                              </td>
                              <td>{formatDateTime(entry.changedAt)}</td>
                              <td class="tb-status-cycle-cell-numeric">
                                {entry.isCycleTimeStatus ? <strong>{formatDays(entry.days)}</strong> : formatDays(entry.days)}
                              </td>
                              <td class="tb-status-cycle-cell-numeric">
                                {entry.isCycleTimeStatus ? <strong>{formatPercent(entry.percentOfTicketTime)}</strong> : formatPercent(entry.percentOfTicketTime)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p class="tb-muted-note">No status timeline found for this card.</p>
                  )}
                  {selectedCardStatusBreakdown.length > 0 ? (
                    <section class="tb-cards-window-pie-card">
                      <h5>Time Distribution by Status</h5>
                      <div class="tb-cards-window-pie-wrap">
                        <div
                          class="tb-cards-window-pie"
                          role="img"
                          aria-label="Selected card status time distribution pie chart"
                          style={{ background: selectedCardStatusPieGradient }}
                        />
                        <ul class="tb-cards-window-pie-legend">
                          {selectedCardStatusBreakdown.map((slice) => (
                            <li key={`card-pie-${selectedCardRow.issueKey}-${slice.statusKey}`}>
                              <span class="tb-cards-window-pie-legend-dot" style={{ background: slice.color }} aria-hidden="true" />
                              <span class="tb-cards-window-pie-legend-label">{slice.status}</span>
                              <span class="tb-cards-window-pie-legend-value">{formatPercent(slice.percentOfTicketTime)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </section>
                  ) : null}
                </>
              ) : (
                <p class="tb-muted-note">Select a ticket to view status history details.</p>
              )}
            </aside>
          </div>
        ) : null}
      </section>
      <section class="tb-panel">
        <header class="tb-panel-header">
          <div>
            <h3>Cycle Time Breakdown ({formatTrendWindowLabel(trendWindowSelection)})</h3>
          </div>
        </header>
        <div class="tb-trend-order-pill tb-status-cycle-info-pill">
          <p>Time spent in the selected workflow statuses across completed cards in the selected trend window.</p>
          <p>% Cycle Time is normalized within the selected statuses.</p>
          <p>Tracked completed cards: {trackedCompletedIssueCount}</p>
          {excludedCompletedIssueCount > 0 ? <p>Excluded completed cards: {excludedCompletedIssueCount}</p> : null}
        </div>
        {loading ? <p class="tb-muted-note">Loading status-level cycle time...</p> : null}
        {!loading && selectedStatusCycleRows.length === 0 ? (
          <p class="tb-muted-note">No cycle-time data found for the selected workflow statuses.</p>
        ) : null}
        {sortedStatusCycleRows.length > 0 ? (
          <div class="tb-status-cycle-layout">
            <div class="tb-status-cycle-table-wrap">
              <table class="tb-status-cycle-table" aria-label="Status cycle time table">
                <thead>
                  <tr>
                    <th>
                      <button
                        type="button"
                        class={`tb-table-sort${statusCycleSortField === "status" ? " is-active" : ""}`}
                        onClick={() => handleStatusCycleSortHeaderClick("status")}
                        aria-label={`Sort by Status (${statusCycleSortField === "status" && statusCycleSortDirection === "asc" ? "ascending" : "descending"})`}
                      >
                        <span>Status</span>
                        <span class="tb-table-sort-indicator" aria-hidden="true">{resolveStatusCycleSortIndicator("status")}</span>
                      </button>
                    </th>
                    <th class="is-numeric">
                      <button
                        type="button"
                        class={`tb-table-sort${statusCycleSortField === "issueCount" ? " is-active" : ""}`}
                        onClick={() => handleStatusCycleSortHeaderClick("issueCount")}
                        aria-label={`Sort by Issue Count (${statusCycleSortField === "issueCount" && statusCycleSortDirection === "asc" ? "ascending" : "descending"})`}
                      >
                        <span>Cards</span>
                        <span class="tb-table-sort-indicator" aria-hidden="true">{resolveStatusCycleSortIndicator("issueCount")}</span>
                      </button>
                    </th>
                    <th class="is-numeric">
                      <button
                        type="button"
                        class={`tb-table-sort${statusCycleSortField === "avgDays" ? " is-active" : ""}`}
                        onClick={() => handleStatusCycleSortHeaderClick("avgDays")}
                        aria-label={`Sort by Avg Days (${statusCycleSortField === "avgDays" && statusCycleSortDirection === "asc" ? "ascending" : "descending"})`}
                      >
                        <span>Avg Days</span>
                        <span class="tb-table-sort-indicator" aria-hidden="true">{resolveStatusCycleSortIndicator("avgDays")}</span>
                      </button>
                    </th>
                    <th class="is-numeric">
                      <button
                        type="button"
                        class={`tb-table-sort${statusCycleSortField === "percentOfCycleTime" ? " is-active" : ""}`}
                        onClick={() => handleStatusCycleSortHeaderClick("percentOfCycleTime")}
                        aria-label={`Sort by Percent Of Cycle Time (${statusCycleSortField === "percentOfCycleTime" && statusCycleSortDirection === "asc" ? "ascending" : "descending"})`}
                      >
                        <span>% Cycle Time</span>
                        <span class="tb-table-sort-indicator" aria-hidden="true">{resolveStatusCycleSortIndicator("percentOfCycleTime")}</span>
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedStatusCycleRows.map((row) => (
                    <tr key={`status-cycle-${row.status}`}>
                      <td class="tb-status-cycle-name">{row.status}</td>
                      <td class="tb-status-cycle-cell-numeric">{row.issueCount}</td>
                      <td class="tb-status-cycle-cell-numeric">{formatDays(row.avgDays)}</td>
                      <td class="tb-status-cycle-cell-numeric">{formatPercent(row.percentOfCycleTime)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <aside class="tb-status-cycle-pie-card">
              <h4>% Cycle Time Breakdown</h4>
              <div class="tb-status-cycle-pie-wrap">
                <div
                  class="tb-status-cycle-pie"
                  role="img"
                  aria-label="Status cycle time share pie chart"
                  style={{ background: statusCyclePieGradient }}
                />
                <ul class="tb-status-cycle-pie-legend">
                  {statusCyclePieSlices.map((slice) => (
                    <li key={`pie-${slice.status}`}>
                      <span class="tb-status-cycle-pie-legend-dot" style={{ background: slice.color }} aria-hidden="true" />
                      <span class="tb-status-cycle-pie-legend-label">{slice.status}</span>
                      <span class="tb-status-cycle-pie-legend-value">{formatPercent(slice.percentOfCycleTime)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </aside>
          </div>
        ) : null}
      </section>
    </div>
  );
}
