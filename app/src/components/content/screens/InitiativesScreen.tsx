import { h } from "preact";
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import {
  ConfiguredEpicSummaryResponse,
  EpicCandidate,
  EpicLookupConfig,
  InitiativeEpicSummary,
  deleteEpicMetadata,
  fetchConfiguredEpicSummary,
  fetchEpicCandidates,
  fetchEpicLookupConfig,
  fetchJiraIntegrationStatus,
  upsertEpicMetadata,
} from "../../../lib/api";

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

type OptionalColumnId = "group" | "type" | "progress" | "completed" | "delta" | "rag" | "criteria";

type SortField = "epic" | OptionalColumnId;

type SortDirection = "asc" | "desc";

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

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  return `${(Math.round(value * 10) / 10).toFixed(1).replace(/\.0$/, "")}%`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString();
}

function periodLabel(period: ConfiguredEpicSummaryResponse["reportingPeriod"]): string {
  if (!period) {
    return "Reporting period not returned by API.";
  }
  const start = formatDate(period.startDate);
  const end = formatDate(period.endDate);
  return `${start} - ${end} (${period.days} day${period.days === 1 ? "" : "s"}, ${period.timezone})`;
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

export function InitiativesScreen() {
  const [epicSummary, setEpicSummary] = useState<InitiativeEpicSummary[]>([]);
  const [reportingPeriod, setReportingPeriod] = useState<ConfiguredEpicSummaryResponse["reportingPeriod"]>(undefined);
  const [jiraBaseUrl, setJiraBaseUrl] = useState<string | null>(null);
  const [epicLookup, setEpicLookup] = useState<EpicLookupConfig>({ groups: [], workTypes: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [metaSuccess, setMetaSuccess] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [ragFilter, setRagFilter] = useState<"all" | RagLabel>("all");
  const [visibleOptionalColumns, setVisibleOptionalColumns] = useState<OptionalColumnId[]>(
    DEFAULT_VISIBLE_OPTIONAL_COLUMNS,
  );
  const [sortField, setSortField] = useState<SortField>("epic");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [isColumnOverlayOpen, setIsColumnOverlayOpen] = useState(false);

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

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
      const [summaryResult, jiraResult] = await Promise.allSettled([
        fetchConfiguredEpicSummary(100, { timezone }),
        fetchJiraIntegrationStatus(),
      ]);

      if (summaryResult.status === "rejected") {
        throw summaryResult.reason;
      }

      setEpicSummary(summaryResult.value.epics ?? []);
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
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown initiative summary request failure.";
      setError(message);
      setEpicSummary([]);
      setReportingPeriod(undefined);
      setJiraBaseUrl(null);
    } finally {
      setLoading(false);
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
    await Promise.all([loadSummary(), loadLookup()]);
  }, [loadLookup, loadSummary]);

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
    return epicSummary.map((entry) => {
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
    });
  }, [epicSummary]);

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
  }, [groupFilter, ragFilter, rows, searchQuery, typeFilter]);

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
          comparison = compareText(left.epicKey, right.epicKey);
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
          comparison = compareNumber(left.completedCards, right.completedCards);
          if (comparison === 0) {
            comparison = compareNumber(left.totalCards, right.totalCards);
          }
          break;
        case "delta":
          comparison = compareNumber(left.deltaPercentValue, right.deltaPercentValue);
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
  const atRiskCount = useMemo(
    () => rows.filter((row) => row.ragLabel === "Red" || row.ragLabel === "Amber").length,
    [rows],
  );
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

  return (
    <div class="tb-screen-grid">
      <p class="tb-muted-note tb-initiative-period">Reporting period: {periodLabel(reportingPeriod)}</p>

      <section class="tb-panel">
        <header class="tb-panel-header">
          <div>
            <h3>Configured Initiative Summary</h3>
            <p>Progress for configured epics sourced from local synced JIRA data.</p>
          </div>
          <div class="tb-btn-row">
            <button type="button" class="tb-btn" onClick={openConfigureDialog}>
              Configure Epic
            </button>
            <button type="button" class="tb-btn tb-btn-primary" onClick={() => refresh()}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </header>

        <div class="tb-metrics-grid tb-four-up">
          <article class="tb-metric-card">
            <h4>Configured Epics</h4>
            <strong class="tb-value">{totalConfigured}</strong>
            <p>Epics with metadata configured in TeamBeacon.</p>
          </article>
          <article class="tb-metric-card">
            <h4>Avg Completion</h4>
            <strong class="tb-value tb-value-good">{formatPercent(averageCompletion)}</strong>
            <p>Average completion percentage across configured epics.</p>
          </article>
          <article class="tb-metric-card">
            <h4>At Risk</h4>
            <strong class={`tb-value ${atRiskCount > 0 ? "tb-value-warn" : "tb-value-good"}`}>{atRiskCount}</strong>
            <p>RAG status currently Red or Amber.</p>
          </article>
          <article class="tb-metric-card">
            <h4>Completed In Period</h4>
            <strong class="tb-value">{completedInPeriodTotal}</strong>
            <p>Total issues completed in current reporting period.</p>
          </article>
        </div>

        {error && !loading ? <p class="tb-error-note">Initiative summary: {error}</p> : null}
        {metaError ? <p class="tb-error-note">Epic metadata: {metaError}</p> : null}
      </section>

      <section class="tb-panel">
        <header class="tb-panel-header">
          <div>
            <h3>Initiative Progress Matrix</h3>
            <p>Filter by group, type, and RAG to inspect initiative health.</p>
          </div>
          <div class="tb-panel-header-actions">
            <span class="tb-chip">{filteredRows.length} visible</span>
            <button type="button" class="tb-btn tb-btn-sm" onClick={openColumnOverlay}>
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
                  <th>
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
                  <th>
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
                          <td>
                            <div class="tb-initiative-progress">
                              <div class="tb-initiative-progress-track">
                                <span style={{ width: `${progressPercent}%` }} />
                              </div>
                              <span>{formatPercent(progressPercent)}</span>
                            </div>
                          </td>
                        ) : null}
                        {visibleColumnSet.has("completed") ? (
                          <td>
                            <div>
                              <strong>{row.completedCards} / {row.totalCards}</strong>
                              <p class="tb-muted-note">Period: {row.completedInPeriodValue}</p>
                            </div>
                          </td>
                        ) : null}
                        {visibleColumnSet.has("delta") ? <td>{formatPercent(row.deltaPercentValue)}</td> : null}
                        {visibleColumnSet.has("rag") ? (
                          <td>
                            <span class={`tb-rag-pill ${ragToneClass(row.ragLabel)}`} title={row.ragReason}>
                              {row.ragLabel}
                            </span>
                          </td>
                        ) : null}
                        {visibleColumnSet.has("criteria") ? (
                          <td>
                            <p class="tb-initiative-criteria" title={row.successCriteriaTooltip}>
                              {row.successCriteria.length > 0
                                ? `${row.successCriteria.length} criteria configured`
                                : "No criteria configured"}
                            </p>
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
