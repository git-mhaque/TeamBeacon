import { h } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { TeamInsightAvailableStatus, TeamInsightsResponse, fetchTeamInsights } from "../../../lib/api";
import { getPreference, getPreferenceSync, setPreference } from "../../../lib/persistence";
import { TrendBarChart, type TrendBarChartPoint } from "./TrendBarChart";

const TREND_WINDOW_OPTIONS = [1, 2, 3, 4, 6, 8, 10, 12] as const;
export const OPEN_TEAM_INSIGHTS_SETTINGS_EVENT = "teambeacon:team-insights-open-settings";
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

function formatSprintDateRange(startDate: string | null | undefined, endDate: string | null | undefined): string {
  return `From ${formatDate(startDate)} to ${formatDate(endDate)}`;
}

function formatSprintSequenceLabel(position: number): string {
  return `Sprint ${position + 1}`;
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

function normalizeTrendWindow(value: number): number {
  return TREND_WINDOW_OPTIONS.includes(value as typeof TREND_WINDOW_OPTIONS[number]) ? value : DEFAULT_TREND_WINDOW;
}

function formatTrendWindowLabel(value: number): string {
  if (value === 1) return "1 sprint";
  return `Last ${value} sprints`;
}

function getTrendAxisStep(ticks: number[]): number {
  if (ticks.length < 2) return 1;
  return roundMetric(ticks[1] - ticks[0]) || 1;
}

type StatusCycleSortField = "status" | "issueCount" | "avgDays" | "percentOfCycleTime";
type StatusCycleSortDirection = "asc" | "desc";
type TrendChartTab = "cycleTime" | "completedStoryPoints";
type PersistedTeamInsightsSettings = {
  targetCycleTimeDays: number;
  showTargetCycleTime: boolean;
  showCompletedStoryPointsChart: boolean;
  showTrendValueLabels: boolean;
  showActiveSprintMarker: boolean;
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
  const [draftSelectedCycleTimeStatusKeys, setDraftSelectedCycleTimeStatusKeys] = useState(
    initialSettings.selectedCycleTimeStatusKeys ?? [],
  );
  const [statusCycleSortField, setStatusCycleSortField] = useState<StatusCycleSortField>("percentOfCycleTime");
  const [statusCycleSortDirection, setStatusCycleSortDirection] = useState<StatusCycleSortDirection>("desc");

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
      selectedCycleTimeStatusKeys,
    };
    void setPreference(TEAM_INSIGHTS_SETTINGS_KEY, JSON.stringify(payload));
  }, [
    selectedCycleTimeStatusKeys,
    showActiveSprintMarker,
    showCompletedStoryPointsChart,
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
    setDraftSelectedCycleTimeStatusKeys(appliedCycleTimeStatusKeys);
    setIsSettingsOpen(true);
  }, [
    appliedCycleTimeStatusKeys,
    showActiveSprintMarker,
    showCompletedStoryPointsChart,
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

  const resetDraftCycleTimeStatuses = useCallback(() => {
    setDraftSelectedCycleTimeStatusKeys(defaultCycleTimeStatusKeys);
  }, [defaultCycleTimeStatusKeys]);

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

  const resolveSortIndicator = useCallback((field: StatusCycleSortField): string => {
    if (statusCycleSortField !== field) return "↕";
    return statusCycleSortDirection === "asc" ? "↑" : "↓";
  }, [statusCycleSortDirection, statusCycleSortField]);

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
      label: formatSprintSequenceLabel(index),
      tooltipLabel: formatSprintDateRange(point.startDate, point.endDate),
      value: point.avgCycleTimeDays ?? 0,
      valueLabel: formatDays(point.avgCycleTimeDays),
      isActive: point.state?.toLowerCase() === "active",
    })),
    [trendRows]
  );
  const completedStoryPointsTrendPoints = useMemo<TrendBarChartPoint[]>(
    () => trendRows.map((point, index) => ({
      label: formatSprintSequenceLabel(index),
      tooltipLabel: formatSprintDateRange(point.startDate, point.endDate),
      value: point.completedStoryPoints,
      valueLabel: `${formatStoryPoints(point.completedStoryPoints)} SP`,
      isActive: point.state?.toLowerCase() === "active",
    })),
    [trendRows]
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
        <div class="tb-trend-window-inline">
          <label for="tb-trend-window-select">Trend Window</label>
          <select
            id="tb-trend-window-select"
            value={String(trendWindowSelection)}
            onChange={(event) => {
              const nextValue = Number.parseInt((event.currentTarget as HTMLSelectElement).value, 10);
              setTrendWindowSelection(normalizeTrendWindow(nextValue));
            }}
          >
            {TREND_WINDOW_OPTIONS.map((value) => (
              <option key={value} value={String(value)}>
                {formatTrendWindowLabel(value)}
              </option>
            ))}
          </select>
        </div>
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
                      <button type="button" class="tb-btn tb-btn-sm" onClick={resetDraftCycleTimeStatuses}>
                        Reset defaults
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
                        <span class="tb-table-sort-indicator" aria-hidden="true">{resolveSortIndicator("status")}</span>
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
                        <span class="tb-table-sort-indicator" aria-hidden="true">{resolveSortIndicator("issueCount")}</span>
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
                        <span class="tb-table-sort-indicator" aria-hidden="true">{resolveSortIndicator("avgDays")}</span>
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
                        <span class="tb-table-sort-indicator" aria-hidden="true">{resolveSortIndicator("percentOfCycleTime")}</span>
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
