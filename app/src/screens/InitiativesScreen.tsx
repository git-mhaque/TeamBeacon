import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InitiativeSummaryProgress } from "../components/InitiativeSummaryProgress";
import { MetricCard } from "../components/MetricCard";
import { Panel } from "../components/Panel";
import { StatusPill } from "../components/StatusPill";
import {
  deleteEpicMetadata,
  EpicCandidate,
  EpicLookupConfig,
  fetchConfiguredEpicSummary,
  fetchEpicCandidates,
  fetchEpicLookupConfig,
  fetchJiraIntegrationStatus,
  InitiativeEpicSummary,
  upsertEpicMetadata,
} from "../lib/api";

type SummarySortKey = "epicKey" | "group" | "type" | "epicName" | "completion" | "delta" | "rag";
type SortDirection = "asc" | "desc";

type SummaryRow = InitiativeEpicSummary & {
  groupNames: string[];
  typeNames: string[];
  groupText: string;
  typeText: string;
  ragLabel: "Red" | "Amber" | "Green";
  successCriteriaTooltip: string;
  completedLastWeekValue: number;
  deltaPercentValue: number;
  deltaTooltip: string;
  insightTooltip: string;
};

function ragFromCompletion(percent: number): "Red" | "Amber" | "Green" {
  if (percent < 33) return "Red";
  if (percent < 66) return "Amber";
  return "Green";
}

function ragRank(label: "Red" | "Amber" | "Green"): number {
  if (label === "Red") return 1;
  if (label === "Amber") return 2;
  return 3;
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

export function InitiativesScreen() {
  const [epicSummary, setEpicSummary] = useState<InitiativeEpicSummary[]>([]);
  const [epicLookup, setEpicLookup] = useState<EpicLookupConfig>({ groups: [], workTypes: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [epicMetaError, setEpicMetaError] = useState<string | null>(null);
  const [epicMetaSuccess, setEpicMetaSuccess] = useState<string | null>(null);
  const [jiraBaseUrl, setJiraBaseUrl] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SummarySortKey>("epicKey");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [showGroupColumn, setShowGroupColumn] = useState(false);
  const [showTypeColumn, setShowTypeColumn] = useState(true);
  const [showDeltaColumn, setShowDeltaColumn] = useState(true);
  const [showRagColumn, setShowRagColumn] = useState(false);
  const [selectedGroupFilters, setSelectedGroupFilters] = useState<string[]>([]);
  const [selectedTypeFilters, setSelectedTypeFilters] = useState<string[]>([]);
  const [isGroupFilterOpen, setIsGroupFilterOpen] = useState(false);
  const [isTypeFilterOpen, setIsTypeFilterOpen] = useState(false);
  const [isEpicConfigureOpen, setIsEpicConfigureOpen] = useState(false);
  const [configureMetaSaving, setConfigureMetaSaving] = useState(false);
  const [configureMetaError, setConfigureMetaError] = useState<string | null>(null);
  const [epicSearchQuery, setEpicSearchQuery] = useState("");
  const [isEpicSearchFocused, setIsEpicSearchFocused] = useState(false);
  const [epicCandidatesLoading, setEpicCandidatesLoading] = useState(false);
  const [epicCandidatesError, setEpicCandidatesError] = useState<string | null>(null);
  const [epicCandidates, setEpicCandidates] = useState<EpicCandidate[]>([]);
  const [selectedEpicCandidate, setSelectedEpicCandidate] = useState<EpicCandidate | null>(null);
  const [configureSuccessCriteriaText, setConfigureSuccessCriteriaText] = useState("");
  const [configureTimelineEnabled, setConfigureTimelineEnabled] = useState(false);
  const [configureTimelineStartDate, setConfigureTimelineStartDate] = useState("");
  const [configureTargetCompletionDate, setConfigureTargetCompletionDate] = useState("");
  const [configureSelectedGroupIds, setConfigureSelectedGroupIds] = useState<number[]>([]);
  const [configureSelectedWorkTypeIds, setConfigureSelectedWorkTypeIds] = useState<number[]>([]);
  const [isEpicEditOpen, setIsEpicEditOpen] = useState(false);
  const [editMetaSaving, setEditMetaSaving] = useState(false);
  const [editMetaError, setEditMetaError] = useState<string | null>(null);
  const [removingEpicKey, setRemovingEpicKey] = useState<string | null>(null);
  const [pendingRemoveEpic, setPendingRemoveEpic] = useState<SummaryRow | null>(null);
  const [editingEpic, setEditingEpic] = useState<SummaryRow | null>(null);
  const [editSuccessCriteriaText, setEditSuccessCriteriaText] = useState("");
  const [editTimelineEnabled, setEditTimelineEnabled] = useState(false);
  const [editTimelineStartDate, setEditTimelineStartDate] = useState("");
  const [editTargetCompletionDate, setEditTargetCompletionDate] = useState("");
  const [editSelectedGroupIds, setEditSelectedGroupIds] = useState<number[]>([]);
  const [editSelectedWorkTypeIds, setEditSelectedWorkTypeIds] = useState<number[]>([]);
  const groupFilterRef = useRef<HTMLDivElement | null>(null);
  const typeFilterRef = useRef<HTMLDivElement | null>(null);

  const loadEpicSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryResult, jiraStatusResult] = await Promise.allSettled([
        fetchConfiguredEpicSummary(100),
        fetchJiraIntegrationStatus(),
      ]);
      if (summaryResult.status === "rejected") {
        throw summaryResult.reason;
      }
      setEpicSummary(summaryResult.value);

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
      const message = err instanceof Error ? err.message : "Unknown initiative summary failure";
      setError(message);
      setEpicSummary([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadEpicLookup = useCallback(async () => {
    try {
      const lookup = await fetchEpicLookupConfig();
      setEpicLookup(lookup);
      setEpicMetaError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown epic lookup failure";
      setEpicMetaError(message);
      setEpicLookup({ groups: [], workTypes: [] });
    }
  }, []);

  useEffect(() => {
    loadEpicSummary().catch(() => {
      // loadEpicSummary already sets local error state.
    });
    loadEpicLookup().catch(() => {
      // loadEpicLookup already sets local error state.
    });
  }, [loadEpicLookup, loadEpicSummary]);

  const configuredEpicSummaryText = useMemo(() => {
    if (loading) return "Loading...";
    if (error) return "Needs attention";
    return `${epicSummary.length} configured epics`;
  }, [epicSummary.length, error, loading]);

  const summaryRows = useMemo(() => {
    const rows: SummaryRow[] = epicSummary.map((entry) => {
      const groupNames = entry.groups.map((group) => group.name);
      const typeNames = entry.workTypes.map((workType) => workType.name);
      const groupText = groupNames.join(", ");
      const typeText = typeNames.join(", ");
      const ragLabel = ragFromCompletion(entry.completionPercent);
      const completedLastWeekValue = Math.max(0, entry.completedLastWeek ?? 0);
      const deltaPercentCandidate =
        typeof entry.deltaPercent === "number"
          ? entry.deltaPercent
          : entry.totalCards > 0
            ? (completedLastWeekValue / entry.totalCards) * 100
            : 0;
      const deltaPercentValue = Math.round(Math.max(0, deltaPercentCandidate) * 10) / 10;
      const successCriteriaTooltip = entry.successCriteria.length
        ? entry.successCriteria.map((item, index) => `${index + 1}. ${item}`).join("\n")
        : "No success criteria configured.";
      const deltaTooltip =
        `${completedLastWeekValue} completed in last 7 days out of ${entry.totalCards} total cards.`;
      const insightTooltip = entry.insightComment?.trim() || "Insight pending LLM output.";
      return {
        ...entry,
        groupNames,
        typeNames,
        groupText,
        typeText,
        ragLabel,
        successCriteriaTooltip,
        completedLastWeekValue,
        deltaPercentValue,
        deltaTooltip,
        insightTooltip,
      };
    });
    return rows;
  }, [epicSummary]);

  const groupFilterOptions = useMemo(() => {
    const unique = new Set<string>();
    for (const row of summaryRows) {
      for (const groupName of row.groupNames) {
        if (groupName.trim()) {
          unique.add(groupName.trim());
        }
      }
    }
    return Array.from(unique).sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: "base" }),
    );
  }, [summaryRows]);

  const typeFilterOptions = useMemo(() => {
    const unique = new Set<string>();
    for (const row of summaryRows) {
      for (const typeName of row.typeNames) {
        if (typeName.trim()) {
          unique.add(typeName.trim());
        }
      }
    }
    return Array.from(unique).sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: "base" }),
    );
  }, [summaryRows]);

  useEffect(() => {
    setSelectedGroupFilters((current) =>
      current.filter((value) => groupFilterOptions.includes(value)),
    );
  }, [groupFilterOptions]);

  useEffect(() => {
    setSelectedTypeFilters((current) =>
      current.filter((value) => typeFilterOptions.includes(value)),
    );
  }, [typeFilterOptions]);

  const filteredEpicSummary = useMemo(() => {
    return summaryRows.filter((row) => {
      const groupMatch =
        selectedGroupFilters.length === 0
        || selectedGroupFilters.some((value) => row.groupNames.includes(value));
      const typeMatch =
        selectedTypeFilters.length === 0
        || selectedTypeFilters.some((value) => row.typeNames.includes(value));
      return groupMatch && typeMatch;
    });
  }, [selectedGroupFilters, selectedTypeFilters, summaryRows]);

  const sortedEpicSummary = useMemo(() => {
    const sorted = [...filteredEpicSummary].sort((left, right) => {
      if (sortKey === "completion") {
        return left.completionPercent - right.completionPercent;
      }
      if (sortKey === "delta") {
        return left.deltaPercentValue - right.deltaPercentValue;
      }
      if (sortKey === "rag") {
        return ragRank(left.ragLabel) - ragRank(right.ragLabel);
      }
      const leftText =
        sortKey === "epicKey"
          ? left.epicKey
          : sortKey === "group"
            ? left.groupText
            : sortKey === "type"
              ? left.typeText
              : left.epicName;
      const rightText =
        sortKey === "epicKey"
          ? right.epicKey
          : sortKey === "group"
            ? right.groupText
            : sortKey === "type"
              ? right.typeText
              : right.epicName;
      return leftText.localeCompare(rightText, undefined, { sensitivity: "base" });
    });

    if (sortDirection === "desc") {
      sorted.reverse();
    }
    return sorted;
  }, [filteredEpicSummary, sortDirection, sortKey]);

  const handleSort = useCallback(
    (key: SummarySortKey) => {
      if (sortKey === key) {
        setSortDirection((currentDirection) => (currentDirection === "asc" ? "desc" : "asc"));
        return;
      }
      setSortKey(key);
      setSortDirection("asc");
    },
    [sortKey],
  );

  const sortIndicator = useCallback(
    (key: SummarySortKey) => {
      if (sortKey !== key) return "";
      return sortDirection === "asc" ? " ▲" : " ▼";
    },
    [sortDirection, sortKey],
  );

  useEffect(() => {
    const onDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (groupFilterRef.current && target && !groupFilterRef.current.contains(target)) {
        setIsGroupFilterOpen(false);
      }
      if (typeFilterRef.current && target && !typeFilterRef.current.contains(target)) {
        setIsTypeFilterOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocumentMouseDown);
    return () => {
      document.removeEventListener("mousedown", onDocumentMouseDown);
    };
  }, []);

  const toggleGroupFilter = useCallback((value: string) => {
    setSelectedGroupFilters((current) => {
      if (current.includes(value)) {
        return current.filter((item) => item !== value);
      }
      return [...current, value];
    });
  }, []);

  const toggleTypeFilter = useCallback((value: string) => {
    setSelectedTypeFilters((current) => {
      if (current.includes(value)) {
        return current.filter((item) => item !== value);
      }
      return [...current, value];
    });
  }, []);

  const toggleSingleSelection = useCallback((current: number[], id: number): number[] => {
    if (current[0] === id) {
      return [];
    }
    return [id];
  }, []);

  const loadEpicCandidates = useCallback(async (query: string) => {
    setEpicCandidatesLoading(true);
    setEpicCandidatesError(null);
    try {
      const candidates = await fetchEpicCandidates(query, 20);
      setEpicCandidates(candidates);
      if (candidates.length === 0) {
        setSelectedEpicCandidate(null);
        return;
      }
      setSelectedEpicCandidate((current) => {
        if (!current) {
          return candidates[0];
        }
        return candidates.find((candidate) => candidate.epicKey === current.epicKey) ?? candidates[0];
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load epic candidates.";
      setEpicCandidatesError(message);
      setEpicCandidates([]);
      setSelectedEpicCandidate(null);
    } finally {
      setEpicCandidatesLoading(false);
    }
  }, []);

  const openEpicConfigureOverlay = useCallback(() => {
    setEpicMetaError(null);
    setEpicMetaSuccess(null);
    setConfigureMetaSaving(false);
    setConfigureMetaError(null);
    setEpicSearchQuery("");
    setIsEpicSearchFocused(false);
    setEpicCandidates([]);
    setEpicCandidatesError(null);
    setSelectedEpicCandidate(null);
    setConfigureSuccessCriteriaText("");
    setConfigureTimelineEnabled(false);
    setConfigureTimelineStartDate("");
    setConfigureTargetCompletionDate("");
    setConfigureSelectedGroupIds([]);
    setConfigureSelectedWorkTypeIds([]);
    setIsEpicConfigureOpen(true);
  }, []);

  const closeEpicConfigureOverlay = useCallback(() => {
    if (configureMetaSaving) {
      return;
    }
    setIsEpicConfigureOpen(false);
    setConfigureMetaError(null);
  }, [configureMetaSaving]);

  const openEpicEditOverlay = useCallback((entry: SummaryRow) => {
    setEpicMetaError(null);
    setEpicMetaSuccess(null);
    setEditingEpic(entry);
    setEditSuccessCriteriaText(entry.successCriteria.join("\n"));
    setEditTimelineEnabled(Boolean(entry.timelineEnabled));
    setEditTimelineStartDate(normalizeDateInputValue(entry.timelineStartDate));
    setEditTargetCompletionDate(normalizeDateInputValue(entry.targetCompletionDate));
    setEditSelectedGroupIds(entry.groups.length > 0 ? [entry.groups[0].id] : []);
    setEditSelectedWorkTypeIds(entry.workTypes.length > 0 ? [entry.workTypes[0].id] : []);
    setEditMetaError(null);
    setIsEpicEditOpen(true);
  }, []);

  const closeEpicEditOverlay = useCallback(() => {
    if (editMetaSaving) {
      return;
    }
    setIsEpicEditOpen(false);
    setEditingEpic(null);
    setEditMetaError(null);
  }, [editMetaSaving]);

  const handleSaveConfiguredEpicMetadata = useCallback(async () => {
    if (!selectedEpicCandidate) {
      setConfigureMetaError("Please select an epic to configure.");
      return;
    }
    if (configureTimelineEnabled && !configureTargetCompletionDate.trim()) {
      setConfigureMetaError("Target completion date is required when timeline is enabled.");
      return;
    }
    if (
      configureTimelineEnabled
      && configureTimelineStartDate.trim()
      && configureTargetCompletionDate.trim()
      && configureTimelineStartDate.trim() > configureTargetCompletionDate.trim()
    ) {
      setConfigureMetaError("Timeline start date cannot be after target completion date.");
      return;
    }
    const criteria = configureSuccessCriteriaText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    setConfigureMetaSaving(true);
    setConfigureMetaError(null);
    setEpicMetaError(null);
    setEpicMetaSuccess(null);
    try {
      await upsertEpicMetadata({
        epicKey: selectedEpicCandidate.epicKey,
        successCriteria: criteria,
        groupIds: configureSelectedGroupIds,
        workTypeIds: configureSelectedWorkTypeIds,
        timelineEnabled: configureTimelineEnabled,
        timelineStartDate: configureTimelineEnabled ? configureTimelineStartDate.trim() || null : null,
        targetCompletionDate: configureTimelineEnabled ? configureTargetCompletionDate.trim() : null,
      });
      await loadEpicSummary();
      setEpicMetaSuccess(`Epic metadata saved for ${selectedEpicCandidate.epicKey}.`);
      setIsEpicConfigureOpen(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save epic metadata.";
      setConfigureMetaError(message);
    } finally {
      setConfigureMetaSaving(false);
    }
  }, [
    configureSelectedGroupIds,
    configureSelectedWorkTypeIds,
    configureSuccessCriteriaText,
    configureTimelineStartDate,
    configureTargetCompletionDate,
    configureTimelineEnabled,
    loadEpicSummary,
    selectedEpicCandidate,
  ]);

  const handleSaveEditedEpicMetadata = useCallback(async () => {
    if (!editingEpic) {
      return;
    }
    const criteria = editSuccessCriteriaText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (editTimelineEnabled && !editTargetCompletionDate.trim()) {
      setEditMetaError("Target completion date is required when timeline is enabled.");
      return;
    }
    if (
      editTimelineEnabled
      && editTimelineStartDate.trim()
      && editTargetCompletionDate.trim()
      && editTimelineStartDate.trim() > editTargetCompletionDate.trim()
    ) {
      setEditMetaError("Timeline start date cannot be after target completion date.");
      return;
    }

    setEditMetaSaving(true);
    setEditMetaError(null);
    setEpicMetaError(null);
    setEpicMetaSuccess(null);
    try {
      await upsertEpicMetadata({
        epicKey: editingEpic.epicKey,
        successCriteria: criteria,
        groupIds: editSelectedGroupIds,
        workTypeIds: editSelectedWorkTypeIds,
        timelineEnabled: editTimelineEnabled,
        timelineStartDate: editTimelineEnabled ? editTimelineStartDate.trim() || null : null,
        targetCompletionDate: editTimelineEnabled ? editTargetCompletionDate.trim() : null,
      });
      await loadEpicSummary();
      setEpicMetaSuccess(`Epic metadata updated for ${editingEpic.epicKey}.`);
      setIsEpicEditOpen(false);
      setEditingEpic(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update epic metadata.";
      setEditMetaError(message);
    } finally {
      setEditMetaSaving(false);
    }
  }, [
    editSelectedGroupIds,
    editSelectedWorkTypeIds,
    editSuccessCriteriaText,
    editTimelineStartDate,
    editTargetCompletionDate,
    editTimelineEnabled,
    editingEpic,
    loadEpicSummary,
  ]);

  const openRemoveEpicOverlay = useCallback((entry: SummaryRow) => {
    setEpicMetaError(null);
    setEpicMetaSuccess(null);
    setPendingRemoveEpic(entry);
  }, []);

  const closeRemoveEpicOverlay = useCallback(() => {
    if (removingEpicKey) {
      return;
    }
    setPendingRemoveEpic(null);
  }, [removingEpicKey]);

  const handleRemoveEpicConfig = useCallback(async () => {
    if (!pendingRemoveEpic) {
      return;
    }
    const epicKey = pendingRemoveEpic.epicKey;
    setRemovingEpicKey(epicKey);
    try {
      await deleteEpicMetadata(epicKey);
      await loadEpicSummary();
      if (editingEpic?.epicKey === epicKey) {
        setIsEpicEditOpen(false);
        setEditingEpic(null);
      }
      setPendingRemoveEpic(null);
      setEpicMetaSuccess(`Epic configuration removed for ${epicKey}.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to remove epic configuration.";
      setEpicMetaError(message);
    } finally {
      setRemovingEpicKey(null);
    }
  }, [editingEpic?.epicKey, loadEpicSummary, pendingRemoveEpic]);

  useEffect(() => {
    if (!isEpicConfigureOpen) {
      return;
    }
    const normalizedQuery = epicSearchQuery.trim();
    if (!normalizedQuery) {
      setEpicCandidatesLoading(false);
      setEpicCandidatesError(null);
      setEpicCandidates([]);
      return;
    }
    const timeoutId = window.setTimeout(() => {
      loadEpicCandidates(epicSearchQuery).catch(() => {
        // loadEpicCandidates already sets local error state.
      });
    }, 250);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [epicSearchQuery, isEpicConfigureOpen, loadEpicCandidates]);

  const showEpicAutocomplete = isEpicSearchFocused && epicSearchQuery.trim().length > 0;

  const groupFilterLabel = useMemo(() => {
    if (selectedGroupFilters.length === 0) return "All";
    if (selectedGroupFilters.length === 1) return selectedGroupFilters[0];
    return `${selectedGroupFilters.length} selected`;
  }, [selectedGroupFilters]);

  const typeFilterLabel = useMemo(() => {
    if (selectedTypeFilters.length === 0) return "All";
    if (selectedTypeFilters.length === 1) return selectedTypeFilters[0];
    return `${selectedTypeFilters.length} selected`;
  }, [selectedTypeFilters]);

  return (
    <div className="screen-grid">
      <Panel
        title="Initiative Epics Summary"
        subtitle="Configured epics with completion progress derived from synced cards."
        action={
          <StatusPill
            tone={error ? "risk" : loading ? "warn" : "good"}
            text={configuredEpicSummaryText}
          />
        }
      >
        {error ? <p className="sync-history-error">Initiative summary error: {error}</p> : null}
        {loading ? <p className="sync-history-loading">Loading configured epics...</p> : null}
        {epicMetaError ? <p className="sync-history-error">Epic metadata error: {epicMetaError}</p> : null}
        {epicMetaSuccess ? <p className="sync-history-loading">{epicMetaSuccess}</p> : null}

        <div className="epic-meta-table-actions">
          <button className="mini-sync-btn" onClick={openEpicConfigureOverlay} type="button">
            Configure Epic
          </button>
        </div>

        <div className="initiative-summary-toolbar">
          <div className="initiative-column-toggles">
            <span>Columns:</span>
            <label>
              <input
                type="checkbox"
                checked={showGroupColumn}
                onChange={(event) => setShowGroupColumn(event.target.checked)}
              />
              Group
            </label>
            <label>
              <input
                type="checkbox"
                checked={showTypeColumn}
                onChange={(event) => setShowTypeColumn(event.target.checked)}
              />
              Type
            </label>
            <label>
              <input
                type="checkbox"
                checked={showDeltaColumn}
                onChange={(event) => setShowDeltaColumn(event.target.checked)}
              />
              Delta
            </label>
            <label>
              <input
                type="checkbox"
                checked={showRagColumn}
                onChange={(event) => setShowRagColumn(event.target.checked)}
              />
              RAG
            </label>
          </div>
          <div className="initiative-filter-controls">
            <div className="initiative-filter-dropdown" ref={groupFilterRef}>
              <button
                className="initiative-filter-trigger"
                type="button"
                onClick={() => {
                  setIsTypeFilterOpen(false);
                  setIsGroupFilterOpen((current) => !current);
                }}
              >
                Group: {groupFilterLabel}
              </button>
              {isGroupFilterOpen ? (
                <div className="initiative-filter-menu">
                  <button
                    className="initiative-filter-clear"
                    type="button"
                    onClick={() => setSelectedGroupFilters([])}
                    disabled={selectedGroupFilters.length === 0}
                  >
                    Clear
                  </button>
                  {groupFilterOptions.length === 0 ? (
                    <p className="sync-history-loading">No groups available.</p>
                  ) : null}
                  {groupFilterOptions.map((option) => (
                    <label key={option} className="initiative-filter-option">
                      <input
                        type="checkbox"
                        checked={selectedGroupFilters.includes(option)}
                        onChange={() => toggleGroupFilter(option)}
                      />
                      <span>{option}</span>
                    </label>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="initiative-filter-dropdown" ref={typeFilterRef}>
              <button
                className="initiative-filter-trigger"
                type="button"
                onClick={() => {
                  setIsGroupFilterOpen(false);
                  setIsTypeFilterOpen((current) => !current);
                }}
              >
                Type: {typeFilterLabel}
              </button>
              {isTypeFilterOpen ? (
                <div className="initiative-filter-menu">
                  <button
                    className="initiative-filter-clear"
                    type="button"
                    onClick={() => setSelectedTypeFilters([])}
                    disabled={selectedTypeFilters.length === 0}
                  >
                    Clear
                  </button>
                  {typeFilterOptions.length === 0 ? (
                    <p className="sync-history-loading">No types available.</p>
                  ) : null}
                  {typeFilterOptions.map((option) => (
                    <label key={option} className="initiative-filter-option">
                      <input
                        type="checkbox"
                        checked={selectedTypeFilters.includes(option)}
                        onChange={() => toggleTypeFilter(option)}
                      />
                      <span>{option}</span>
                    </label>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="initiative-summary-table-wrap">
          <table className="sync-history-table">
            <thead>
              <tr>
                <th>
                  <button className="table-sort-btn" type="button" onClick={() => handleSort("epicKey")}>
                    Epic Key{sortIndicator("epicKey")}
                  </button>
                </th>
                {showGroupColumn ? (
                  <th>
                    <button className="table-sort-btn" type="button" onClick={() => handleSort("group")}>
                      Group{sortIndicator("group")}
                    </button>
                  </th>
                ) : null}
                {showTypeColumn ? (
                  <th>
                    <button className="table-sort-btn" type="button" onClick={() => handleSort("type")}>
                      Type{sortIndicator("type")}
                    </button>
                  </th>
                ) : null}
                <th>
                  <button className="table-sort-btn" type="button" onClick={() => handleSort("epicName")}>
                    Epic Name{sortIndicator("epicName")}
                  </button>
                </th>
                <th>
                  <button className="table-sort-btn" type="button" onClick={() => handleSort("completion")}>
                    Completion{sortIndicator("completion")}
                  </button>
                </th>
                {showDeltaColumn ? (
                  <th>
                    <button className="table-sort-btn" type="button" onClick={() => handleSort("delta")}>
                      Delta{sortIndicator("delta")}
                    </button>
                  </th>
                ) : null}
                {showRagColumn ? (
                  <th>
                    <button className="table-sort-btn" type="button" onClick={() => handleSort("rag")}>
                      RAG{sortIndicator("rag")}
                    </button>
                  </th>
                ) : null}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedEpicSummary.map((entry) => (
                <tr key={entry.epicKey}>
                  <td>
                    {jiraBaseUrl ? (
                      <a
                        className="external-link"
                        href={`${jiraBaseUrl}/browse/${entry.epicKey}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {entry.epicKey}
                      </a>
                    ) : (
                      entry.epicKey
                    )}
                  </td>
                  {showGroupColumn ? <td className="initiative-summary-group-cell">{entry.groupText || "-"}</td> : null}
                  {showTypeColumn ? <td className="initiative-summary-type-cell">{entry.typeText || "-"}</td> : null}
                  <td className="initiative-summary-name-cell">{entry.epicName || "-"}</td>
                  <td className="initiative-summary-progress-cell">
                    <InitiativeSummaryProgress
                      completionPercent={entry.completionPercent}
                      completedCards={entry.completedCards}
                      totalCards={entry.totalCards}
                      title={entry.successCriteriaTooltip}
                    />
                  </td>
                  {showDeltaColumn ? (
                    <td className="initiative-summary-delta-cell" title={entry.deltaTooltip}>
                      {entry.deltaPercentValue.toFixed(1).replace(/\.0$/, "")}%
                    </td>
                  ) : null}
                  {showRagColumn ? (
                    <td title={entry.insightTooltip}>
                      <span className={`rag-indicator rag-${entry.ragLabel.toLowerCase()}`}>
                        <span className="rag-dot rag-dot-large" />
                      </span>
                    </td>
                  ) : null}
                  <td>
                    <div className="initiative-actions">
                      <button
                        className="initiative-icon-btn"
                        onClick={() => openEpicEditOverlay(entry)}
                        type="button"
                        aria-label={`Edit ${entry.epicKey}`}
                        title="Edit"
                        disabled={removingEpicKey === entry.epicKey}
                      >
                        <svg viewBox="0 0 20 20" aria-hidden="true">
                          <path d="M14.7 2.3a1 1 0 0 1 1.4 0l1.6 1.6a1 1 0 0 1 0 1.4l-9.6 9.6-3.5.4.4-3.5zM3 17h14v1.5H3z" />
                        </svg>
                      </button>
                      <button
                        className="initiative-icon-btn initiative-icon-btn-danger"
                        onClick={() => openRemoveEpicOverlay(entry)}
                        type="button"
                        aria-label={removingEpicKey === entry.epicKey ? `Removing ${entry.epicKey}` : `Remove ${entry.epicKey}`}
                        title={removingEpicKey === entry.epicKey ? "Removing..." : "Remove"}
                        disabled={removingEpicKey === entry.epicKey}
                      >
                        <svg viewBox="0 0 20 20" aria-hidden="true">
                          <path d="M7 2h6l.8 1.5H17V5H3V3.5h3.2zM5 6.5h10l-.7 10.2a1.5 1.5 0 0 1-1.5 1.3H7.2a1.5 1.5 0 0 1-1.5-1.3zM8.2 8v8.2h1.4V8zm3.2 0v8.2h1.4V8z" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && sortedEpicSummary.length === 0 ? (
                <tr>
                  <td
                    colSpan={
                      4
                      + (showGroupColumn ? 1 : 0)
                      + (showTypeColumn ? 1 : 0)
                      + (showDeltaColumn ? 1 : 0)
                      + (showRagColumn ? 1 : 0)
                    }
                  >
                    {epicSummary.length === 0
                      ? "No configured epics found yet."
                      : "No epics match the selected filters."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title="Initiative Health"
        subtitle="RAG and velocity indicators based on epic progress and risk signals."
        action={<StatusPill tone="warn" text="Amber: Payments Hardening" />}
      >
        <div className="metrics-grid four-up">
          <MetricCard label="RAG Score" value="72/100" hint="Scope volatility increased this week." tone="warn" />
          <MetricCard label="Epic Completion" value="64%" hint="+9% since previous report." tone="neutral" />
          <MetricCard label="Blockers > 5d" value="3" hint="Threshold is <= 2." tone="risk" />
          <MetricCard label="Cycle Trend" value="-18%" hint="Median cycle time is improving." tone="good" />
        </div>
      </Panel>

      <Panel title="Success Criteria Checklist" subtitle="Configurable criteria per initiative with weighted scoring.">
        <ul className="list">
          <li>
            Delivery trajectory above target velocity <StatusPill tone="good" text="Pass" />
          </li>
          <li>
            Due date confidence {"\u2265"} 80% <StatusPill tone="warn" text="At Risk" />
          </li>
          <li>
            Blocker SLA breaches {"\u2264"} 2 <StatusPill tone="risk" text="Fail" />
          </li>
          <li>
            Scope growth {"\u2264"} 12% <StatusPill tone="risk" text="Fail (18%)" />
          </li>
        </ul>
      </Panel>

      <Panel title="Generated Insight" subtitle="Narrative generated from configured rules and latest JIRA state.">
        <p className="summary">
          Progress is steady and throughput is improving, but open blockers and scope growth are reducing due-date confidence.
          Restrict additional scope intake this sprint and prioritize cross-team dependency clearance.
        </p>
      </Panel>

      {pendingRemoveEpic ? (
        <div className="epic-edit-overlay" role="dialog" aria-modal="true" aria-label="Remove Epic Configuration">
          <div className="epic-edit-backdrop" onClick={closeRemoveEpicOverlay} />
          <div className="epic-edit-dialog">
            <div className="sync-history-header">
              <h3>Remove Epic Configuration</h3>
              <button className="mini-sync-btn" onClick={closeRemoveEpicOverlay} type="button" disabled={removingEpicKey === pendingRemoveEpic.epicKey}>
                Close
              </button>
            </div>

            <p className="sync-options-note">
              Remove configuration for{" "}
              {jiraBaseUrl ? (
                <a
                  className="external-link"
                  href={`${jiraBaseUrl}/browse/${pendingRemoveEpic.epicKey}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {pendingRemoveEpic.epicKey}
                </a>
              ) : (
                pendingRemoveEpic.epicKey
              )}
              {pendingRemoveEpic.epicName ? ` (${pendingRemoveEpic.epicName})` : ""}?
            </p>
            <p className="sync-options-note">
              This removes success criteria, group mappings, and work type mappings for this epic only.
            </p>

            <div className="sync-options-footer">
              <button
                className="mini-sync-btn"
                onClick={closeRemoveEpicOverlay}
                type="button"
                disabled={removingEpicKey === pendingRemoveEpic.epicKey}
              >
                Cancel
              </button>
              <button
                className="mini-sync-btn"
                onClick={handleRemoveEpicConfig}
                type="button"
                disabled={removingEpicKey === pendingRemoveEpic.epicKey}
              >
                {removingEpicKey === pendingRemoveEpic.epicKey ? "Removing..." : "Remove"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isEpicConfigureOpen ? (
        <div className="epic-edit-overlay" role="dialog" aria-modal="true" aria-label="Configure Epic Metadata">
          <div className="epic-edit-backdrop" onClick={closeEpicConfigureOverlay} />
          <div className="epic-edit-dialog">
            <div className="sync-history-header">
              <h3>Configure Epic Metadata</h3>
              <button
                className="mini-sync-btn"
                onClick={closeEpicConfigureOverlay}
                type="button"
                disabled={configureMetaSaving}
              >
                Close
              </button>
            </div>

            <label className="epic-meta-field epic-autocomplete">
              <span>Search Unconfigured Epic (Key or Name)</span>
              <input
                type="text"
                value={epicSearchQuery}
                onChange={(event) => setEpicSearchQuery(event.target.value)}
                onFocus={() => setIsEpicSearchFocused(true)}
                onBlur={() => {
                  window.setTimeout(() => {
                    setIsEpicSearchFocused(false);
                  }, 120);
                }}
                placeholder="CEGBUPOL-5000 or Illuminating Engineering Insights"
              />
              {showEpicAutocomplete ? (
                <div className="epic-candidate-dropdown" role="listbox" aria-label="Epic candidates">
                  {epicCandidatesError ? (
                    <p className="sync-history-error">Epic search error: {epicCandidatesError}</p>
                  ) : null}
                  {epicCandidatesLoading ? <p className="sync-history-loading">Searching epics...</p> : null}
                  {!epicCandidatesLoading && !epicCandidatesError && epicCandidates.length === 0 ? (
                    <p className="sync-history-loading">No unconfigured epics found.</p>
                  ) : null}
                  {epicCandidates.map((candidate) => (
                    <button
                      key={candidate.epicKey}
                      type="button"
                      className={`epic-candidate-option ${selectedEpicCandidate?.epicKey === candidate.epicKey ? "selected" : ""}`}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        setSelectedEpicCandidate(candidate);
                        setEpicSearchQuery(candidate.epicKey);
                        setIsEpicSearchFocused(false);
                      }}
                    >
                      <span>{candidate.epicKey}</span>
                      <small>{candidate.epicName || "No epic name"}</small>
                    </button>
                  ))}
                </div>
              ) : null}
            </label>

            {selectedEpicCandidate ? (
              <p className="sync-options-note">
                Selected epic:{" "}
                {jiraBaseUrl ? (
                  <a
                    className="external-link"
                    href={`${jiraBaseUrl}/browse/${selectedEpicCandidate.epicKey}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {selectedEpicCandidate.epicKey}
                  </a>
                ) : (
                  selectedEpicCandidate.epicKey
                )}
                {selectedEpicCandidate.epicName ? ` (${selectedEpicCandidate.epicName})` : ""}
              </p>
            ) : null}

            <div className="epic-meta-timeline-row">
              <label className="epic-meta-checkbox">
                <input
                  type="checkbox"
                  checked={configureTimelineEnabled}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setConfigureTimelineEnabled(checked);
                    if (!checked) {
                      setConfigureTimelineStartDate("");
                      setConfigureTargetCompletionDate("");
                    }
                  }}
                />
                <span>Enable timeline dates</span>
              </label>
              <label className="epic-meta-field">
                <span>Timeline Start Date</span>
                <input
                  type="date"
                  value={configureTimelineStartDate}
                  onChange={(event) => setConfigureTimelineStartDate(event.target.value)}
                  disabled={!configureTimelineEnabled}
                />
              </label>
              <label className="epic-meta-field">
                <span>Target Completion Date</span>
                <input
                  type="date"
                  value={configureTargetCompletionDate}
                  onChange={(event) => setConfigureTargetCompletionDate(event.target.value)}
                  disabled={!configureTimelineEnabled}
                />
              </label>
            </div>

            <div className="epic-meta-selection-grid">
              <div className="epic-meta-select-card">
                <h4>Epic Group (choose one)</h4>
                {epicLookup.groups.length === 0 ? <p>No groups configured yet.</p> : null}
                {epicLookup.groups.map((group) => (
                  <label key={group.id} className="epic-meta-checkbox">
                    <input
                      type="checkbox"
                      checked={configureSelectedGroupIds.includes(group.id)}
                      onChange={() =>
                        setConfigureSelectedGroupIds((current) => toggleSingleSelection(current, group.id))
                      }
                    />
                    <span>{group.name}</span>
                  </label>
                ))}
              </div>

              <div className="epic-meta-select-card">
                <h4>Work Type (choose one)</h4>
                {epicLookup.workTypes.length === 0 ? <p>No work types configured yet.</p> : null}
                {epicLookup.workTypes.map((workType) => (
                  <label key={workType.id} className="epic-meta-checkbox">
                    <input
                      type="checkbox"
                      checked={configureSelectedWorkTypeIds.includes(workType.id)}
                      onChange={() =>
                        setConfigureSelectedWorkTypeIds((current) => toggleSingleSelection(current, workType.id))
                      }
                    />
                    <span>{workType.name}</span>
                  </label>
                ))}
              </div>
            </div>

            <label className="epic-meta-field epic-meta-field-spaced">
              <span>Success Criteria Checklist (one per line)</span>
              <textarea
                value={configureSuccessCriteriaText}
                onChange={(event) => setConfigureSuccessCriteriaText(event.target.value)}
                rows={6}
              />
            </label>

            {configureMetaError ? <p className="sync-history-error">{configureMetaError}</p> : null}

            <div className="sync-options-footer">
              <button
                className="mini-sync-btn"
                onClick={closeEpicConfigureOverlay}
                type="button"
                disabled={configureMetaSaving}
              >
                Cancel
              </button>
              <button
                className="mini-sync-btn"
                onClick={handleSaveConfiguredEpicMetadata}
                type="button"
                disabled={configureMetaSaving || !selectedEpicCandidate}
              >
                {configureMetaSaving ? "Saving..." : "Save Epic Metadata"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isEpicEditOpen && editingEpic ? (
        <div className="epic-edit-overlay" role="dialog" aria-modal="true" aria-label="Edit Epic Metadata">
          <div className="epic-edit-backdrop" onClick={closeEpicEditOverlay} />
          <div className="epic-edit-dialog">
            <div className="sync-history-header">
              <h3>Edit Epic Metadata</h3>
              <button className="mini-sync-btn" onClick={closeEpicEditOverlay} type="button" disabled={editMetaSaving}>
                Close
              </button>
            </div>

            <p className="sync-options-note">
              Epic:{" "}
              {jiraBaseUrl ? (
                <a
                  className="external-link"
                  href={`${jiraBaseUrl}/browse/${editingEpic.epicKey}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {editingEpic.epicKey}
                </a>
              ) : (
                editingEpic.epicKey
              )}
              {editingEpic.epicName ? ` (${editingEpic.epicName})` : ""}
            </p>

            <div className="epic-meta-timeline-row">
              <label className="epic-meta-checkbox">
                <input
                  type="checkbox"
                  checked={editTimelineEnabled}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setEditTimelineEnabled(checked);
                    if (!checked) {
                      setEditTimelineStartDate("");
                      setEditTargetCompletionDate("");
                    }
                  }}
                />
                <span>Enable timeline dates</span>
              </label>
              <label className="epic-meta-field">
                <span>Timeline Start Date</span>
                <input
                  type="date"
                  value={editTimelineStartDate}
                  onChange={(event) => setEditTimelineStartDate(event.target.value)}
                  disabled={!editTimelineEnabled}
                />
              </label>
              <label className="epic-meta-field">
                <span>Target Completion Date</span>
                <input
                  type="date"
                  value={editTargetCompletionDate}
                  onChange={(event) => setEditTargetCompletionDate(event.target.value)}
                  disabled={!editTimelineEnabled}
                />
              </label>
            </div>

            <div className="epic-meta-selection-grid">
              <div className="epic-meta-select-card">
                <h4>Epic Group (choose one)</h4>
                {epicLookup.groups.length === 0 ? <p>No groups configured yet.</p> : null}
                {epicLookup.groups.map((group) => (
                  <label key={group.id} className="epic-meta-checkbox">
                    <input
                      type="checkbox"
                      checked={editSelectedGroupIds.includes(group.id)}
                      onChange={() =>
                        setEditSelectedGroupIds((current) => toggleSingleSelection(current, group.id))
                      }
                    />
                    <span>{group.name}</span>
                  </label>
                ))}
              </div>

              <div className="epic-meta-select-card">
                <h4>Work Type (choose one)</h4>
                {epicLookup.workTypes.length === 0 ? <p>No work types configured yet.</p> : null}
                {epicLookup.workTypes.map((workType) => (
                  <label key={workType.id} className="epic-meta-checkbox">
                    <input
                      type="checkbox"
                      checked={editSelectedWorkTypeIds.includes(workType.id)}
                      onChange={() =>
                        setEditSelectedWorkTypeIds((current) => toggleSingleSelection(current, workType.id))
                      }
                    />
                    <span>{workType.name}</span>
                  </label>
                ))}
              </div>
            </div>

            <label className="epic-meta-field epic-meta-field-spaced">
              <span>Success Criteria Checklist (one per line)</span>
              <textarea
                value={editSuccessCriteriaText}
                onChange={(event) => setEditSuccessCriteriaText(event.target.value)}
                rows={6}
              />
            </label>

            {editMetaError ? <p className="sync-history-error">{editMetaError}</p> : null}

            <div className="sync-options-footer">
              <button className="mini-sync-btn" onClick={closeEpicEditOverlay} type="button" disabled={editMetaSaving}>
                Cancel
              </button>
              <button className="mini-sync-btn" onClick={handleSaveEditedEpicMetadata} type="button" disabled={editMetaSaving}>
                {editMetaSaving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
