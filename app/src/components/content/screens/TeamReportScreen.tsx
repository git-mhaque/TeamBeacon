import { useCallback, useId, useEffect, useMemo, useRef, useState } from "react";
import {
  chatWithOciGenAi,
  EpicSummaryReportingPeriod,
  fetchAiIntegrationStatus,
  fetchConfiguredEpicsCompletedCards,
  fetchConfiguredEpicSummary,
  fetchJiraIntegrationStatus,
  InitiativeEpicSummary,
} from "../../../lib/api";
import { groupCompletedWorkByEpic, groupCompletedWork, reportJiraIssueUrl, type CompletedWorkSummaryGroup, type CompletedWorkSource } from "../../../lib/reportCompletedWork";
import { getPreference, getPreferenceSync, setPreference } from "../../../lib/persistence";

import { groupReportInitiatives, readReportInitiativeSelection, resolveReportInitiativeSelection, type ReportSelectionMode } from "../../../lib/reportInitiativeSelection";

type RagLabel = "Red" | "Amber" | "Green" | "Not assessed";

type ExecutiveRow = InitiativeEpicSummary & {
  groupText: string;
  typeText: string;
  rag: RagLabel;
  ragTooltip: string;
  completedInPeriodValue: number;
  deltaPercentValue: number;
};

type DistributionSlice = {
  label: string;
  value: number;
  percent: number;
  color: string;
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
export const OPEN_TEAM_REPORT_INITIATIVE_CONFIG_EVENT = "teambeacon:team-report-open-initiative-config";
export const OPEN_TEAM_REPORT_REPORTING_PERIOD_EVENT = "teambeacon:team-report-open-reporting-period";
export const EXPORT_TEAM_REPORT_HTML_EVENT = "teambeacon:team-report-export-html";

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

function formatDraftTimestamp(value: string | null): string {
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

function readPersistedReportingSelection(defaultRange: ReportingRange): PersistedReportingSelection {
  const fallback: PersistedReportingSelection = {
    preset: "last_7_days",
    startDate: defaultRange.startDate,
    endDate: defaultRange.endDate,
  };

  return parsePersistedReportingSelection(getPreferenceSync(REPORTING_PERIOD_SELECTION_KEY), fallback);
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
  if (!entry.timelineEnabled) {
    return {
      label: "Not assessed",
      reason: "Timeline not configured. RAG is not assessed.",
    };
  }

  const todayUtcDay = parseIsoDateToUtcDay(new Date().toISOString());
  const targetUtcDay = parseIsoDateToUtcDay(entry.targetCompletionDate);
  const startUtcDay = parseIsoDateToUtcDay(entry.timelineStartDate);

  if (todayUtcDay === null || targetUtcDay === null) {
    return {
      label: "Not assessed",
      reason: "Timeline target date is missing or invalid. RAG is not assessed.",
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
    label: ragFromCompletion(completion),
    reason: `Timeline start date not set. Fallback to completion (${completion.toFixed(1)}%).`,
  };
}

function formatPercent(value: number): string {
  return `${value.toFixed(1).replace(/\.0$/, "")}%`;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type TeamReportExportMode = "interactive" | "print";

type SaveFilePickerHandle = {
  createWritable: () => Promise<{
    write: (data: Blob | BufferSource | string) => Promise<void>;
    close: () => Promise<void>;
  }>;
};

type SaveFilePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName?: string;
    excludeAcceptAllOption?: boolean;
    types?: Array<{
      description?: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<SaveFilePickerHandle>;
};

async function saveHtmlWithDialogOrDownload(html: string, fileName: string): Promise<void> {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const picker = (window as SaveFilePickerWindow).showSaveFilePicker;

  if (typeof picker === "function") {
    try {
      const handle = await picker({
        suggestedName: fileName,
        types: [
          {
            description: "HTML Document",
            accept: { "text/html": [".html"] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      // Fall back to browser download handling when save-picker write fails.
    }
  }

  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
  }, 0);
}

function buildTeamReportExportHtml(params: {
  mode: TeamReportExportMode;
  generatedAt: string;
  reportingPeriodLabel: string;
  reportingPeriodDays: number;
  timezone: string;
  completedWork: CompletedWorkSummaryGroup[];
  jiraBaseUrl: string | null;
  totalInitiatives: number;
  totalCompletedInPeriod: number;
  greenCount: number;
  amberCount: number;
  redCount: number;
  progressRows: Array<{
    groupText: string;
    initiative: string;
    periodProgressLabel: string;
    periodProgressPercent: number;
    overallProgressLabel: string;
    overallProgressPercent: number;
    rag: RagLabel;
    ragTooltip: string;
  }>;
  groupMixRows: Array<{
    name: string;
    completedInPeriod: number;
    percent: number;
  }>;
  typeMixRows: Array<{
    name: string;
    completedInPeriod: number;
    percent: number;
  }>;
}): string {
  const sourceLink = (key: string, label: string): string => {
    const url = reportJiraIssueUrl(params.jiraBaseUrl, key);
    return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>` : escapeHtml(label);
  };
  const completedSections = params.completedWork.length > 0
    ? params.completedWork.map((entry) => `
        <section class="section-block">
          <h4>${escapeHtml(entry.group)}</h4>
          ${groupCompletedWorkByEpic(entry.bullets).map((epic) => `
            <div class="completed-epic">
              ${epic.epicKey ? `<h5>${sourceLink(epic.epicKey, epic.epicName)}</h5>` : ""}
              <ul>
                ${epic.bullets.map((bullet) => `<li><div>${escapeHtml(bullet.text)}</div>${bullet.source ? `<div class="completed-source">${sourceLink(bullet.source.issueKey, bullet.source.issueKey)} · ${escapeHtml(bullet.source.issueTitle)}</div>` : ""}</li>`).join("")}
              </ul>
            </div>
          `).join("")}
        </section>
      `).join("")
    : `
      <section class="section-block">
        <h4>No Completed Work</h4>
        <ul><li>No completed work summary is available for this period.</li></ul>
      </section>
    `;

  const mixChart = (title: string, label: string, rows: typeof params.groupMixRows): string => {
    const slices = buildDistributionSlices(rows, params.totalCompletedInPeriod);
    return `<section class="workmix-card">
      <h3>${escapeHtml(title)}</h3>
      <div class="workmix-chart"><div class="workmix-donut" role="img" aria-label="${escapeHtml(label)}" style="background:${params.totalCompletedInPeriod > 0 ? buildDonutBackground(slices) : "#e1ebf0"}">
        <div class="workmix-centre">${params.totalCompletedInPeriod > 0 ? "" : "No data"}</div>
      </div>
      <ul class="workmix-legend">${slices.map((slice) => `<li><span class="workmix-swatch" style="background:${slice.color}" aria-hidden="true"></span><span>${escapeHtml(slice.label)}</span><span class="workmix-value">${escapeHtml(formatPercent(slice.percent))}</span></li>`).join("")}</ul></div>
    </section>`;
  };

  const modeClass = params.mode === "print" ? "mode-print" : "mode-interactive";

  const progressRows = params.progressRows.length > 0
    ? groupReportInitiatives(params.progressRows).map((group) => `<tbody><tr class="initiative-group"><th scope="rowgroup" colspan="4">${escapeHtml(group.workStream)}</th></tr>${group.rows.map((row) => {
      const ragClass = `rag-${row.rag.toLowerCase().replace(/\s+/g, "-")}`;
      return `
        <tr>
          <td>${escapeHtml(row.initiative)}</td>
          <td>
            <div class="progress-cell">
              <span class="progress-label">${escapeHtml(row.periodProgressLabel)}</span>
            </div>
          </td>
          <td>
            <div class="progress-cell">
              <span class="progress-label">${escapeHtml(row.overallProgressLabel)}</span>
              <span class="progress-track">
                <span class="progress-fill progress-overall ${ragClass}" style="width:${clampPercent(row.overallProgressPercent).toFixed(1)}%;"></span>
              </span>
            </div>
          </td>
          <td class="${ragClass}"><span tabindex="0" title="${escapeHtml(row.ragTooltip)}" aria-label="${escapeHtml(`${row.rag}: ${row.ragTooltip}`)}">${escapeHtml(row.rag)}</span></td>
        </tr>
      `;
    }).join("")}</tbody>`).join("")
    : `<tbody><tr><td colspan="4" class="empty">No initiatives selected for this export.</td></tr></tbody>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Team Report</title>
    <style>
      :root {
        --ink: #282522;
        --muted: #6b645e;
        --line: #ddd7d0;
        --surface: #ffffff;
        --surface-alt: #faf8f6;
        --surface-accent: #ede9e4;
        --brand: #96382b;
        --brand-soft: #f8ece9;
        --brand-strong: #76271f;
        --good: #2c7653;
        --warn: #a76e00;
        --risk: #bc392d;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        color: var(--ink);
        font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f4f2ef;
      }
      .mode-print {
        background: #ffffff;
      }
      .mode-print .page {
        width: calc(100% - 3px);
        margin: 0 auto;
        gap: 10px;
      }
      .mode-print .hero {
        border: 1px solid var(--line);
        border-radius: 12px;
        box-shadow: none;
        background: #ffffff;
        padding: 16px;
        margin: 0;
      }
      .mode-print .panel {
        border: 1px solid var(--line);
        border-radius: 12px;
        box-shadow: none;
        background: #ffffff;
        padding: 14px;
        margin: 0;
      }
      .mode-print table {
        table-layout: fixed;
      }
      .mode-print th,
      .mode-print td {
        overflow-wrap: anywhere;
      }
      .mode-print .signals {
        display: grid;
        gap: 12px;
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
      .mode-print .metric {
        border: 1px solid #d2def0;
        border-radius: 10px;
        background: linear-gradient(135deg, #ffffff 0%, var(--surface-alt) 100%);
      }
      .page {
        width: min(1120px, 100%);
        margin: 0 auto;
        padding: 28px 24px 36px;
        display: grid;
        gap: 16px;
      }
      .hero {
        border: 1px solid var(--line);
        border-radius: 16px;
        background: linear-gradient(130deg, #ffffff 0%, #fcfaf8 100%);
        padding: 22px;
        box-shadow: 0 18px 34px rgba(57, 45, 37, 0.1);
      }
      .hero h1 {
        margin: 0;
        font-size: 28px;
        color: #2c2926;
        letter-spacing: 0.02em;
      }
      .hero p {
        margin: 8px 0 0;
        color: var(--muted);
        font-size: 13px;
      }
      .meta {
        margin-top: 12px;
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .chip {
        border: 1px solid #d9c3be;
        border-radius: 999px;
        background: var(--brand-soft);
        color: var(--brand-strong);
        font-size: 12px;
        padding: 4px 10px;
      }
      .panel {
        border: 1px solid var(--line);
        border-radius: 14px;
        background: var(--surface);
        padding: 16px;
        box-shadow: 0 12px 24px rgba(57, 45, 37, 0.07);
      }
      h2 {
        margin: 0 0 10px;
        font-size: 18px;
        color: #35302c;
      }
      h3 {
        margin: 0 0 8px;
        font-size: 14px;
        color: #4a433d;
      }
      h4 {
        margin: 0;
        font-size: 13px;
        color: #564e47;
      }
      .workmix-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
      .workmix-card { min-width: 0; border: 1px solid #ded7d0; border-radius: 10px; padding: 16px; background: #faf8f6; }
      .workmix-donut { width: 140px; height: 140px; border-radius: 50%; display: grid; place-items: center; margin: 0; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      .workmix-centre { width: 77px; height: 77px; border-radius: 50%; background: #fff; display: flex; flex-direction: column; justify-content: center; align-items: center; color: #625a54; font-size: 12px; }
      .workmix-chart { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 12px; }
      @media screen and (max-width: 600px) { .workmix-chart { grid-template-columns: 1fr; } }
      .workmix-legend { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
      .workmix-legend li { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: baseline; gap: 8px; font-size: 12px; overflow-wrap: anywhere; }
      .workmix-swatch { width: 10px; height: 10px; border-radius: 3px; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      .workmix-value { white-space: nowrap; font-variant-numeric: tabular-nums; }
      @media screen and (max-width: 900px) { .workmix-grid { grid-template-columns: 1fr; } }
      .section-stack {
        display: grid;
        gap: 10px;
      }
      .section-block {
        border-top: 1px solid #e5ecf8;
        padding-top: 10px;
      }
      .completed-epic { margin-top: 14px; overflow-wrap: anywhere; }
      .completed-epic h5 { margin: 0; font-size: 13px; font-weight: 600; }
      .completed-epic li { margin-bottom: 10px; }
      .completed-source { margin-top: 3px; font-size: 12px; color: #625a54; line-height: 1.45; }
      .section-block:first-child {
        border-top: none;
        padding-top: 0;
      }
      ul {
        margin: 8px 0 0;
        padding-left: 18px;
        color: #4a433d;
        line-height: 1.5;
      }
      .signals {
        display: grid;
        gap: 12px;
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
      .metric {
        border: 1px solid #d2def0;
        border-radius: 12px;
        background: linear-gradient(135deg, #ffffff 0%, var(--surface-alt) 100%);
        padding: 12px;
        display: grid;
        gap: 8px;
        align-content: start;
      }
      .metric .label {
        font-size: 11px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--muted);
      }
      .metric .value {
        margin-top: 6px;
        font-size: 24px;
        font-weight: 700;
        color: #1e457b;
      }
      .metric .value.value-good { color: var(--good); }
      .metric .value.value-warn { color: var(--warn); }
      .metric-note {
        margin: 0;
        color: #4d6182;
        font-size: 12px;
      }
      .value-rag {
        font-size: 16px;
        line-height: 1.4;
      }
      .rag-breakdown {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
      }
      .rag-breakdown .rag-red { color: var(--risk); }
      .rag-breakdown .rag-amber { color: var(--warn); }
      .rag-breakdown .rag-green { color: var(--good); }
      .rag-metric {
        display: grid;
        grid-template-columns: 80px minmax(0, 1fr);
        gap: 10px;
        align-items: center;
      }
      .rag-donut {
        width: 72px;
        height: 72px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        border: 1px solid #ccd8ea;
      }
      .rag-donut-hole {
        width: 42px;
        height: 42px;
        border-radius: 50%;
        background: #ffffff;
        border: 1px solid #d6e2f2;
        display: grid;
        place-items: center;
        color: #203f6b;
        font-weight: 700;
        font-size: 12px;
      }
      .rag-legend {
        display: grid;
        gap: 5px;
        font-size: 12px;
      }
      .rag-legend-row {
        display: flex;
        align-items: center;
        gap: 6px;
        color: #2a456d;
      }
      .rag-dot {
        width: 9px;
        height: 9px;
        border-radius: 50%;
        display: inline-block;
      }
      .rag-dot-green { background: var(--good); }
      .rag-dot-amber { background: var(--warn); }
      .rag-dot-red { background: var(--risk); }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
      }
      thead th {
        text-align: left;
        background: #ede9e4;
        color: #514943;
        border-bottom: 1px solid #d6cec7;
        padding: 8px 9px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        font-size: 11px;
      }
      tbody td {
        border-bottom: 1px solid #e2dcd6;
        padding: 8px 9px;
        color: #393530;
      }
      tbody tr:last-child td {
        border-bottom: none;
      }
      td.empty {
        color: #5a6d8c;
        font-style: italic;
      }
      td.rag-green { color: var(--good); font-weight: 700; }
      td.rag-amber { color: var(--warn); font-weight: 700; }
      td.rag-not-assessed { color: var(--muted); font-weight: 700; }
      .progress-period.rag-not-assessed, .progress-overall.rag-not-assessed { background: #7b8490; }
      td.rag-red { color: var(--risk); font-weight: 700; }
      .progress-cell {
        display: grid;
        gap: 4px;
      }
      .progress-label {
        font-size: 11px;
        color: #31507b;
      }
      .progress-track {
        height: 8px;
        border-radius: 999px;
        background: #e0e8f6;
        overflow: hidden;
      }
      .progress-fill {
        display: block;
        height: 100%;
        border-radius: 999px;
      }
      .progress-period.rag-green, .progress-overall.rag-green { background: linear-gradient(90deg, #1f8f63 0%, #33aa7a 100%); }
      .progress-period.rag-amber, .progress-overall.rag-amber { background: linear-gradient(90deg, #b77700 0%, #d19319 100%); }
      .progress-period.rag-red, .progress-overall.rag-red { background: linear-gradient(90deg, #c2372e 0%, #d74d45 100%); }
      .initiative-table thead th { background: #454039; color: #fff; }
      .initiative-table th, .initiative-table td { padding: 6px 10px; line-height: 1.3; }
      .initiative-table .initiative-group th { background: #f3f0eb; color: #514943; font-weight: 600; text-align: left; }
      .initiative-table td:nth-child(2) { white-space: nowrap; }
      .footer {
        color: #5b6f90;
        font-size: 11px;
        text-align: right;
      }
      @page {
        size: A4 portrait;
        margin: 12mm;
      }
      @media print {
        * {
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        body {
          background: #ffffff;
        }
        .page {
          width: calc(100% - 3px);
          margin: 0;
          padding: 0;
          gap: 8mm;
        }
        .hero,
        .panel {
          break-inside: avoid-page;
          page-break-inside: avoid;
          box-shadow: none;
        }
        .mode-print .metric {
          break-inside: avoid-page;
          page-break-inside: avoid;
        }
        .signals { display: grid; gap: 12px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
      }
      @media screen and (max-width: 900px) {
        .signals { display: grid; gap: 12px; grid-template-columns: 1fr; }
        .rag-metric { grid-template-columns: 1fr; }
        .rag-donut { margin: 0 auto; }
      }
    </style>
  </head>
  <body class="${modeClass}">
    <main class="page">
      <section class="hero">
        <h1>Team Report</h1>
        <div class="meta">
          <span class="chip">Reporting Period: ${escapeHtml(params.reportingPeriodLabel)}</span>
          <span class="chip">${params.reportingPeriodDays} day(s) | ${escapeHtml(params.timezone)}</span>
          <span class="chip">Generated: ${escapeHtml(formatDraftTimestamp(params.generatedAt))}</span>
        </div>
      </section>

      <section class="panel">
        <h2>Report Signals</h2>
        <div class="signals">
          <article class="metric">
            <div class="label">Selected Initiatives</div>
            <div class="value">${params.totalInitiatives}</div>
            <p class="metric-note">Initiatives included in this report.</p>
          </article>
          <article class="metric">
            <div class="label">Period Progress</div>
            <div class="value ${params.totalCompletedInPeriod > 0 ? "value-good" : "value-warn"}">${params.totalCompletedInPeriod} cards</div>
            <p class="metric-note">Completed in the selected reporting period.</p>
          </article>
          <article class="metric">
            <div class="label">Initiative RAG</div>
            <div class="value value-rag">
              <span class="rag-breakdown">
                <span class="rag-red">${params.redCount} R</span>
                <span class="rag-amber">${params.amberCount} A</span>
                <span class="rag-green">${params.greenCount} G</span>
              </span>
            </div>
            <p class="metric-note">Timeline-assessed initiatives only. ${params.totalInitiatives - params.redCount - params.amberCount - params.greenCount} not assessed.</p>
          </article>
        </div>
      </section>

      <section class="panel">
        <h2>Work Mix by Work Stream and Type</h2>
        <div class="workmix-grid">
          ${mixChart("Work Stream Mix", "Work stream effort distribution chart", params.groupMixRows)}
          ${mixChart("Work Type Mix", "Type effort distribution chart", params.typeMixRows)}
        </div>
      </section>

      <section class="panel">
        <h2>Progress for Key Initiatives</h2>
        <p>Delivery progress for initiatives included in this report.</p>
        <table class="initiative-table">
          <thead>
            <tr>
              <th>Initiative</th>
              <th>Period progress</th>
              <th>Overall completion</th>
              <th>Timeline health</th>
            </tr>
          </thead>
          ${progressRows}
        </table>
      </section>

      <section class="panel">
        <h2>Completed Work Summary</h2>
        <div class="section-stack">${completedSections}</div>
      </section>

      <p class="footer">Generated by TeamBeacon Team Report</p>
    </main>
  </body>
</html>`;
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
  rows: Array<{ name: string; completedInPeriod: number }>,
  totalCompleted: number,
): DistributionSlice[] {
  return rows.map((row, index) => ({
    label: row.name,
    value: row.completedInPeriod,
    percent: totalCompleted > 0 ? (row.completedInPeriod / totalCompleted) * 100 : 0,
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

function buildInitiativeAlias(index: number): string {
  return `Initiative ${index + 1}`;
}

function buildSimplifiedInitiativeName(raw: string | null | undefined, fallbackAlias: string): string {
  const source = (raw ?? "").trim();
  const withoutIssueKey = source
    .replace(/\b[A-Z][A-Z0-9]+-\d+\b/g, "")
    .replace(/^[\s:|\-_/]+|[\s:|\-_/]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!withoutIssueKey) return fallbackAlias;

  const words = withoutIssueKey.split(/\s+/).filter((word) => word.length > 0);
  if (words.length <= 4) return withoutIssueKey;
  return words.slice(0, 4).join(" ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function applyTextReplacements(text: string, replacements: Map<string, string>): string {
  const sortedPairs = [...replacements.entries()]
    .map(([from, to]) => [from.trim(), to.trim()] as const)
    .filter(([from, to]) => from.length > 0 && to.length > 0)
    .sort((left, right) => right[0].length - left[0].length);

  let next = text;
  for (const [from, to] of sortedPairs) {
    next = next.replace(new RegExp(escapeRegExp(from), "gi"), to);
  }
  return next;
}

function stripIsoTimestamps(text: string): string {
  return text
    .replace(
      /\b(\d{4}-\d{2}-\d{2})[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})\b/g,
      "$1",
    )
    .replace(/\s{2,}/g, " ")
    .trim();
}

function formatCompletedDateForPrompt(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "n/a";

  const candidate = stripIsoTimestamps(trimmed);
  const datePart = candidate.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
  if (!datePart) return candidate;

  const parsedUtcDay = parseIsoDateToUtcDay(datePart);
  if (parsedUtcDay === null) return datePart;

  return new Date(parsedUtcDay).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function sanitizeNarrativeText(text: string, replacements?: Map<string, string>): string {
  let next = text
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b[A-Z][A-Z0-9]+-\d+\b/g, "")
    .replace(/\bSP\s*\d+\b/gi, "")
    .replace(/\bstory\s*points?\b/gi, "");

  if (replacements && replacements.size > 0) {
    next = applyTextReplacements(next, replacements);
  }

  return next
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/^[,.;:\-\s]+/, "")
    .trim();
}

function clipWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/).filter((word) => word.length > 0);
  if (words.length <= maxWords) return text.trim();
  return `${words.slice(0, maxWords).join(" ")}...`;
}

function buildCompletedCardFallbackBullet(outcome: string, replacements?: Map<string, string>): string {
  const sanitized = sanitizeNarrativeText(stripIsoTimestamps(outcome), replacements);
  if (!sanitized) {
    return "Completed delivery outcome captured for this reporting period.";
  }
  return clipWords(sanitized, 22);
}

function buildCompletedWorkSummaryPrompt(params: {
  reportingPeriodLabel: string;
  reportingPeriodDays: number;
  timezone: string;
  selectedInitiatives: number;
  completedCardsCount: number;
  groupCounts: Array<{ name: string; count: number }>;
  maxCards?: number;
  cards: Array<{ cardId: string; group: string; initiativeAlias: string; status: string; completedAt: string; outcome: string }>;
}): string {
  const promptCards = params.cards.slice(0, params.maxCards ?? 220);
  const cardLines = promptCards.map((card, index) => (
    `${index + 1}. Card ID: ${card.cardId} | Work stream: ${card.group}` +
    ` | Initiative: ${card.initiativeAlias}` +
    ` | Status: ${card.status}` +
    ` | Completed: ${formatCompletedDateForPrompt(card.completedAt)}` +
    ` | Outcome: ${card.outcome}`
  ));
  const groupLines = params.groupCounts
    .slice(0, 30)
    .map((entry, index) => `${index + 1}. ${entry.name}: ${entry.count} completed cards`);
  const truncationNote = params.cards.length > promptCards.length
    ? `Only the first ${promptCards.length} completed cards are listed in this prompt.`
    : "";

  return [
    "Draft a completed-work summary grouped by work stream for engineering leaders.",
    "Return JSON only with this schema:",
    "{\"items\":[{\"cardId\":\"card-1\",\"bullet\":\"...\"}]}",
    "Rules:",
    `- Return exactly ${promptCards.length} items, one bullet per listed completed card.`,
    "- Copy the exact Card ID for each item. Do not merge cards or invent IDs.",
    "- Each bullet must describe a delivered outcome for that completed card and be <= 22 words.",
    "- Use only provided data. Do not invent metrics, dependencies, or blockers.",
    "- Do not reference issue keys, ticket IDs, or story points (SP).",
    "- Do not use full initiative names literally; keep references generic or by initiative alias.",
    "- Don't need to include any date or timestamp information in the bullet; the completedAt field is for context only.",
    "",
    `Reporting period: ${params.reportingPeriodLabel} (${params.reportingPeriodDays} days, ${params.timezone})`,
    `Selected initiatives in scope: ${params.selectedInitiatives}`,
    `Completed cards in scope: ${params.completedCardsCount}`,
    truncationNote,
    "",
    "Completed-card distribution by work stream:",
    ...groupLines,
    "",
    "Completed card outcomes by work stream:",
    ...cardLines,
  ]
    .filter((line) => line.trim().length > 0)
    .join("\n");
}

function parseCompletedWorkSummaryDraft(
  text: string,
  options: {
    fallbackCards: CompletedWorkSource[];
    replacements?: Map<string, string>;
  },
): CompletedWorkSummaryGroup[] {
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
    throw new Error("AI provider did not return valid JSON for completed work summary.");
  }

  const normalizedItems: Array<{ cardId: unknown; text: string }> = [];
  if (Array.isArray(parsed.items)) {
    for (const entry of parsed.items) {
      if (!entry || typeof entry !== "object") continue;
      const record = entry as { cardId?: unknown; bullet?: unknown };
      if (typeof record.bullet !== "string") continue;
      const text = clipWords(sanitizeNarrativeText(stripIsoTimestamps(record.bullet), options.replacements), 22);
      normalizedItems.push({ cardId: record.cardId, text });
    }
  }
  return groupCompletedWork(options.fallbackCards, normalizedItems);
}

function ragToneClass(value: RagLabel): string {
  if (value === "Not assessed") return "is-neutral";
  if (value === "Green") return "is-good";
  if (value === "Amber") return "is-warn";
  return "is-risk";
}

function formatAiProviderName(value: string | null | undefined): string {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "oci" || normalized === "oci-genai" || normalized === "oci_genai") return "OCI";
  if (normalized === "ollama") return "Ollama";
  if (normalized === "openai") return "OpenAI";
  return "AI";
}

function ReportWorkMixChart({ title, label, slices, total, loading }: {
  title: string; label: string; slices: DistributionSlice[]; total: number; loading: boolean;
}) {
  return (
    <section className="tb-exec-workmix-card">
      <h4 className="tb-exec-list-title">{title}</h4>
      <div className="tb-exec-donut-wrap">
        <div className="tb-exec-donut" style={{ background: total > 0 ? buildDonutBackground(slices) : "#e1ebf0" }} role="img" aria-label={label}>
          {loading || total <= 0 ? <span>{loading ? "Loading…" : "No data"}</span> : null}
        </div>
        <ul className="tb-exec-donut-legend">
          {slices.map((slice) => (
            <li key={slice.label}>
              <span className="tb-exec-donut-swatch" style={{ backgroundColor: slice.color }} aria-hidden="true" />
              <span>{slice.label}</span>
              <span className="tb-exec-workmix-value">{formatPercent(slice.percent)}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function ReportTimelineHealth({ rag, explanation }: { rag: RagLabel; explanation: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span className="tb-exec-timeline-health" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" className={`tb-status-pill ${ragToneClass(rag)}`} aria-describedby={open ? id : undefined}
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onClick={() => setOpen(true)}
        onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}>
        {rag}
      </button>
      {open ? <span id={id} role="tooltip" className="tb-exec-health-tooltip">{explanation}</span> : null}
    </span>
  );
}

function ReportJiraLink({ baseUrl, issueKey, children }: { baseUrl: string | null; issueKey: string; children: string }) {
  const url = reportJiraIssueUrl(baseUrl, issueKey);
  return url ? <a className="tb-external-link" href={url} target="_blank" rel="noopener noreferrer">{children}</a> : <>{children}</>;
}

export function TeamReportScreen() {
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
  const [aiProviderName, setAiProviderName] = useState("AI");
  const [resolvedReportingPeriod, setResolvedReportingPeriod] = useState<EpicSummaryReportingPeriod | null>(null);

  const initialInitiativeSelection = useMemo(() => readReportInitiativeSelection(getPreferenceSync(INITIATIVE_SECTION_SELECTION_KEY)), []);
  const [initiativeSelectionMode, setInitiativeSelectionMode] = useState<ReportSelectionMode>(initialInitiativeSelection?.mode ?? "manual");
  const [selectedInitiativeEpicKeys, setSelectedInitiativeEpicKeys] = useState<string[]>(initialInitiativeSelection?.keys ?? []);
  const [initiativeConfigDraftMode, setInitiativeConfigDraftMode] = useState<ReportSelectionMode>("manual");
  const [isInitiativeConfigOpen, setIsInitiativeConfigOpen] = useState(false);
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
  const [isReportingConfigOpen, setIsReportingConfigOpen] = useState(false);

  const [completedWorkDraft, setCompletedWorkDraft] = useState<CompletedWorkSummaryGroup[]>([]);
  const [completedWorkLoading, setCompletedWorkLoading] = useState(true);
  const [completedWorkError, setCompletedWorkError] = useState<string | null>(null);
  const [completedWorkModelId, setCompletedWorkModelId] = useState<string | null>(null);
  const [completedWorkGeneratedAt, setCompletedWorkGeneratedAt] = useState<string | null>(null);
  const [completedWorkRefreshNonce, setCompletedWorkRefreshNonce] = useState(0);

  const hasInitializedInitiativeSelection = useRef(false);
  const hasHydratedReportingSelectionFromStore = useRef(false);
  const completedWorkRequestSequence = useRef(0);

  const persistInitiativeSelection = useCallback((keys: string[], mode: ReportSelectionMode) => {
    void setPreference(INITIATIVE_SECTION_SELECTION_KEY, JSON.stringify({ mode, keys }));
  }, []);

  const loadExecutiveData = useCallback(async (range: ReportingRange) => {
    setLoading(true);
    setError(null);

    try {
      const [summaryResult, jiraStatusResult, aiStatusResult] = await Promise.allSettled([
        fetchConfiguredEpicSummary("all", {
          periodStart: range.startDate,
          periodEnd: range.endDate,
          timezone: browserTimezone,
        }),
        fetchJiraIntegrationStatus(),
        fetchAiIntegrationStatus(),
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
      const message = err instanceof Error ? err.message : "Unknown executive report load failure.";
      setError(message);
      setRows([]);
      setJiraBaseUrl(null);
      setAiProviderName("AI");
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
    const payload: PersistedReportingSelection = {
      preset: reportingPreset,
      startDate: reportingRange.startDate,
      endDate: reportingRange.endDate,
    };
    void setPreference(REPORTING_PERIOD_SELECTION_KEY, JSON.stringify(payload));
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
      const raw = await getPreference(REPORTING_PERIOD_SELECTION_KEY);
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
    window.addEventListener(OPEN_TEAM_REPORT_REPORTING_PERIOD_EVENT, handleOpen);
    return () => {
      window.removeEventListener(OPEN_TEAM_REPORT_REPORTING_PERIOD_EVENT, handleOpen);
    };
  }, [openReportingConfig]);

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

  const qualifyingInitiativeKeys = useMemo(() => initiativeRows.filter((row) => row.completedInPeriodValue > 0).map((row) => row.epicKey), [initiativeRows]);

  useEffect(() => {
    if (loading || rows.length === 0) return;
    const previous = hasInitializedInitiativeSelection.current
      ? selectedInitiativeEpicKeys
      : initialInitiativeSelection?.keys ?? initiativeRows.map((row) => row.epicKey);
    const next = resolveReportInitiativeSelection(initiativeRows, previous, initiativeSelectionMode);
    const initial = !hasInitializedInitiativeSelection.current;
    hasInitializedInitiativeSelection.current = true;
    if (initial || next.length !== selectedInitiativeEpicKeys.length || next.some((key, index) => key !== selectedInitiativeEpicKeys[index])) {
      setSelectedInitiativeEpicKeys(next);
      persistInitiativeSelection(next, initiativeSelectionMode);
    }
  }, [loading, rows.length, initiativeRows, selectedInitiativeEpicKeys, initialInitiativeSelection, initiativeSelectionMode, persistInitiativeSelection]);

  const visibleInitiativeRows = useMemo(() => {
    const rowByKey = new Map(initiativeRows.map((row) => [row.epicKey, row]));
    const orderedRows: ExecutiveRow[] = [];
    for (const key of selectedInitiativeEpicKeys) {
      const row = rowByKey.get(key);
      if (row) orderedRows.push(row);
    }
    return orderedRows;
  }, [initiativeRows, selectedInitiativeEpicKeys]);

  const initiativeAliasByEpicKey = useMemo(
    () => new Map(visibleInitiativeRows.map((row, index) => [row.epicKey, buildInitiativeAlias(index)])),
    [visibleInitiativeRows],
  );

  const completedWorkReplacements = useMemo(() => {
    const map = new Map<string, string>();
    visibleInitiativeRows.forEach((row, index) => {
      const alias = buildInitiativeAlias(index);
      map.set(alias, "this initiative");
      if (row.epicName?.trim()) {
        map.set(row.epicName.trim(), "this initiative");
      }
    });
    return map;
  }, [visibleInitiativeRows]);

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

  const groupDistributionSlices = useMemo(
    () => buildDistributionSlices(groupDistributionRows, visibleInitiativeSignals.totalCompletedInPeriod),
    [groupDistributionRows, visibleInitiativeSignals.totalCompletedInPeriod],
  );

  const typeDistributionSlices = useMemo(
    () => buildDistributionSlices(typeDistributionRows, visibleInitiativeSignals.totalCompletedInPeriod),
    [typeDistributionRows, visibleInitiativeSignals.totalCompletedInPeriod],
  );

  const refreshCompletedWorkSummary = useCallback(() => {
    setCompletedWorkRefreshNonce((previous) => previous + 1);
  }, []);

  const exportTeamReportHtml = useCallback(async () => {
    if (typeof window === "undefined" || typeof document === "undefined") return;

    const generatedAt = new Date().toISOString();
    const progressRows = visibleInitiativeRows.map((row, index) => ({
      groupText: row.groupText,
      initiative: buildSimplifiedInitiativeName(row.epicName || row.epicKey, buildInitiativeAlias(index)),
      periodProgressLabel: `${row.completedInPeriodValue}/${row.totalCards} cards (${formatPercent(row.deltaPercentValue)})`,
      periodProgressPercent: row.deltaPercentValue,
      overallProgressLabel: formatPercent(row.completionPercent),
      overallProgressPercent: row.completionPercent,
      rag: row.rag,
      ragTooltip: row.ragTooltip,
    }));

    const html = buildTeamReportExportHtml({
      mode: "interactive",
      generatedAt,
      reportingPeriodLabel,
      reportingPeriodDays,
      timezone: effectivePeriodTimezone,
      completedWork: completedWorkDraft,
      jiraBaseUrl,
      totalInitiatives: visibleInitiativeSignals.totalEpics,
      totalCompletedInPeriod: visibleInitiativeSignals.totalCompletedInPeriod,
      greenCount: visibleInitiativeSignals.greenCount,
      amberCount: visibleInitiativeSignals.amberCount,
      redCount: visibleInitiativeSignals.redCount,
      progressRows,
      groupMixRows: groupDistributionRows,
      typeMixRows: typeDistributionRows,
    });

    const fileDate = effectivePeriodEnd || generatedAt.slice(0, 10);
    const safeFileDate = fileDate.replace(/[^0-9-]/g, "");
    const fileName = `team-report-export-${safeFileDate || "latest"}.html`;
    await saveHtmlWithDialogOrDownload(html, fileName);
  }, [
    completedWorkDraft,
    jiraBaseUrl,
    effectivePeriodEnd,
    effectivePeriodTimezone,
    groupDistributionRows,
    reportingPeriodDays,
    reportingPeriodLabel,
    typeDistributionRows,
    visibleInitiativeRows,
    visibleInitiativeSignals.amberCount,
    visibleInitiativeSignals.greenCount,
    visibleInitiativeSignals.redCount,
    visibleInitiativeSignals.totalCompletedInPeriod,
    visibleInitiativeSignals.totalEpics,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleExport = () => {
      void exportTeamReportHtml();
    };
    window.addEventListener(EXPORT_TEAM_REPORT_HTML_EVENT, handleExport);
    return () => {
      window.removeEventListener(EXPORT_TEAM_REPORT_HTML_EVENT, handleExport);
    };
  }, [exportTeamReportHtml]);

  useEffect(() => {
    if (loading) {
      setCompletedWorkLoading(true);
      setCompletedWorkError(null);
      return;
    }

    if (error) {
      setCompletedWorkLoading(false);
      setCompletedWorkError(null);
      setCompletedWorkDraft([
        {
          group: "Unavailable",
          bullets: [{ text: "Unable to generate completed work summary because initiative data failed to load." }],
        },
      ]);
      setCompletedWorkModelId(null);
      setCompletedWorkGeneratedAt(null);
      return;
    }

    if (visibleInitiativeRows.length === 0) {
      setCompletedWorkLoading(false);
      setCompletedWorkError(null);
      if (initiativeRows.length > 0) {
        setCompletedWorkDraft([
          {
            group: "No Selection",
            bullets: [{ text: "No initiatives are selected in Progress for Key Initiatives." }],
          },
        ]);
      } else {
        setCompletedWorkDraft([
          {
            group: "No Data",
            bullets: [{ text: "No configured epic data available to summarize completed work." }],
          },
        ]);
      }
      setCompletedWorkModelId(null);
      setCompletedWorkGeneratedAt(null);
      return;
    }

    const selectedByEpicKey = new Map(visibleInitiativeRows.map((row) => [row.epicKey, row]));
    const requestId = completedWorkRequestSequence.current + 1;
    completedWorkRequestSequence.current = requestId;
    setCompletedWorkLoading(true);
    setCompletedWorkError(null);
    setCompletedWorkDraft([]);

    void (async () => {
      try {
        let payload = await fetchConfiguredEpicsCompletedCards({
          limit: 2000,
          periodStart: effectivePeriodStart,
          periodEnd: effectivePeriodEnd,
          timezone: effectivePeriodTimezone,
        });
        if (payload.truncated && payload.count > payload.completedCards.length) {
          payload = await fetchConfiguredEpicsCompletedCards({
            limit: Math.max(2000, payload.count),
            periodStart: effectivePeriodStart,
            periodEnd: effectivePeriodEnd,
            timezone: effectivePeriodTimezone,
          });
        }

        if (completedWorkRequestSequence.current !== requestId) return;

        const scopedCards: Array<CompletedWorkSource & {
          initiativeAlias: string;
          status: string;
          completedAt: string;
          outcome: string;
        }> = [];

        const groupCounts = new Map<string, number>();
        for (const card of payload.completedCards) {
          const epicKey = card.epicKey?.trim();
          if (!epicKey) continue;

          const row = selectedByEpicKey.get(epicKey);
          const initiativeAlias = initiativeAliasByEpicKey.get(epicKey);
          if (!row || !initiativeAlias) continue;

          const groupName = row.groups[0]?.name?.trim() || "Unassigned";
          const status = card.status?.trim() || "Done";
          const completedAt = formatCompletedDateForPrompt(card.completedAt?.trim() || "n/a");
          const outcome = stripIsoTimestamps(card.summary?.trim() || "No summary provided.");

          scopedCards.push({
            cardId: `card-${scopedCards.length + 1}`,
            epicKey,
            epicName: row.epicName || card.epicName || epicKey,
            issueKey: card.issueKey,
            issueTitle: card.summary?.trim() || "No summary provided.",
            fallbackText: buildCompletedCardFallbackBullet(outcome, completedWorkReplacements),
            group: groupName,
            initiativeAlias,
            status,
            completedAt,
            outcome,
          });
          groupCounts.set(groupName, (groupCounts.get(groupName) ?? 0) + 1);
        }

        if (scopedCards.length === 0) {
          setCompletedWorkDraft([
            {
              group: "No Completed Cards",
              bullets: [{ text: "No completed cards were found for selected initiatives in this reporting period." }],
            },
          ]);
          setCompletedWorkModelId(null);
          setCompletedWorkGeneratedAt(null);
          return;
        }

        const sortedGroupCounts = [...groupCounts.entries()]
          .map(([name, count]) => ({ name, count }))
          .sort((left, right) => right.count - left.count);

        const prompt = buildCompletedWorkSummaryPrompt({
          reportingPeriodLabel,
          reportingPeriodDays,
          timezone: effectivePeriodTimezone,
          selectedInitiatives: visibleInitiativeRows.length,
          completedCardsCount: scopedCards.length,
          groupCounts: sortedGroupCounts,
          maxCards: aiProviderName === "Ollama" ? 90 : 220,
          cards: scopedCards,
        });

        const response = await chatWithOciGenAi({
          message: prompt,
          maxTokens: aiProviderName === "Ollama" ? 700 : 1500,
          temperature: 0.15,
          topP: 0.8,
          topK: 0,
          frequencyPenalty: 0,
        });

        if (completedWorkRequestSequence.current !== requestId) return;

        const parsed = parseCompletedWorkSummaryDraft(response.response.text ?? "", {
          fallbackCards: scopedCards,
          replacements: completedWorkReplacements,
        });
        setCompletedWorkDraft(parsed);
        setCompletedWorkModelId(response.modelId ?? null);
        setAiProviderName(formatAiProviderName(response.provider ?? response.configuredProvider ?? response.source));
        setCompletedWorkGeneratedAt(new Date().toISOString());
      } catch (err) {
        if (completedWorkRequestSequence.current !== requestId) return;
        const message = err instanceof Error ? err.message : "Unknown AI completed-work summary failure.";
        setCompletedWorkError(message);
        setCompletedWorkDraft([
          {
            group: "Summary Unavailable",
            bullets: [{ text: "Unable to generate completed work summary draft from AI provider." }],
          },
        ]);
        setCompletedWorkModelId(null);
        setCompletedWorkGeneratedAt(null);
      } finally {
        if (completedWorkRequestSequence.current !== requestId) return;
        setCompletedWorkLoading(false);
      }
    })();
  }, [
    completedWorkRefreshNonce,
    effectivePeriodEnd,
    effectivePeriodStart,
    effectivePeriodTimezone,
    error,
    initiativeAliasByEpicKey,
    initiativeRows.length,
    loading,
    reportingPeriodDays,
    reportingPeriodLabel,
    aiProviderName,
    completedWorkReplacements,
    visibleInitiativeRows,
  ]);

  const completedWorkWordCount = useMemo(() => {
    const text = completedWorkDraft
      .flatMap((entry) => entry.bullets.map((bullet) => bullet.text))
      .join(" ")
      .trim();
    if (!text) return 0;
    return text.split(/\s+/).length;
  }, [completedWorkDraft]);

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
    setInitiativeConfigDraftMode(initiativeSelectionMode);
    setInitiativeConfigQuery("");
    setInitiativeConfigDraggingKey(null);
    setIsInitiativeConfigOpen(true);
  }, [selectedInitiativeEpicKeys, initiativeSelectionMode]);

  const closeInitiativeConfig = useCallback(() => {
    setIsInitiativeConfigOpen(false);
    setInitiativeConfigQuery("");
    setInitiativeConfigDraggingKey(null);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleOpen = () => {
      openInitiativeConfig();
    };
    window.addEventListener(OPEN_TEAM_REPORT_INITIATIVE_CONFIG_EVENT, handleOpen);
    return () => {
      window.removeEventListener(OPEN_TEAM_REPORT_INITIATIVE_CONFIG_EVENT, handleOpen);
    };
  }, [openInitiativeConfig]);

  const addInitiativeDraftKey = useCallback((epicKey: string) => {
    setInitiativeConfigDraftMode("manual");
    setInitiativeConfigDraftKeys((previous) => {
      if (previous.includes(epicKey)) return previous;
      return [...previous, epicKey];
    });
  }, []);

  const removeInitiativeDraftKey = useCallback((epicKey: string) => {
    setInitiativeConfigDraftMode("manual");
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
    const normalized = resolveReportInitiativeSelection(initiativeRows, initiativeConfigDraftKeys, initiativeConfigDraftMode);
    setInitiativeSelectionMode(initiativeConfigDraftMode);
    setSelectedInitiativeEpicKeys(normalized);
    hasInitializedInitiativeSelection.current = true;
    persistInitiativeSelection(normalized, initiativeConfigDraftMode);
    closeInitiativeConfig();
  }, [closeInitiativeConfig, initiativeConfigDraftKeys, initiativeConfigDraftMode, initiativeRows, persistInitiativeSelection]);

  return (
    <div className="tb-screen-grid">
      <p className="tb-muted-note tb-exec-reporting-period-note">
        Reporting period: {reportingPeriodLabel} ({reportingPeriodDays} days, {effectivePeriodTimezone})
      </p>
      {error ? <p className="tb-error-note" role="alert">Team report error: {error}</p> : null}

      <section className="tb-panel">
        <header className="tb-panel-header">
          <div>
            <h3>Report Signals</h3>
            <p className="tb-muted-note">High-level confidence snapshot for final review.</p>
          </div>
        </header>
        <div className="tb-metrics-grid tb-three-up">
          <article className="tb-metric-card">
            <h4>Selected Initiatives</h4>
            <strong className="tb-value">{loading ? "..." : visibleInitiativeSignals.totalEpics}</strong>
            <p>Initiatives included in this report.</p>
          </article>
          <article className="tb-metric-card">
            <h4>Period Progress</h4>
            <strong className={`tb-value ${visibleInitiativeSignals.totalCompletedInPeriod > 0 ? "tb-value-good" : "tb-value-warn"}`}>
              {loading ? "..." : `${visibleInitiativeSignals.totalCompletedInPeriod} cards`}
            </strong>
            <p>Completed in the selected reporting period.</p>
          </article>
          <article className="tb-metric-card">
            <h4>Initiative RAG</h4>
            <strong className="tb-value tb-value-rag">
              {loading ? (
                "..."
              ) : (
                <span className="tb-initiative-rag-breakdown">
                  <span className="tb-initiative-rag-text tb-initiative-rag-red">{visibleInitiativeSignals.redCount} Red</span>
                  <span className="tb-initiative-rag-separator">|</span>
                  <span className="tb-initiative-rag-text tb-initiative-rag-amber">{visibleInitiativeSignals.amberCount} Amber</span>
                  <span className="tb-initiative-rag-separator">|</span>
                  <span className="tb-initiative-rag-text tb-initiative-rag-green">{visibleInitiativeSignals.greenCount} Green</span>
                </span>
              )}
            </strong>
            <p>For initiatives with a configured timeline. {visibleInitiativeSignals.totalEpics - visibleInitiativeSignals.redCount - visibleInitiativeSignals.amberCount - visibleInitiativeSignals.greenCount} not assessed.</p>
          </article>
        </div>
      </section>

      <section className="tb-panel">
        <header className="tb-panel-header">
          <div>
            <h3>Work Mix by Work Stream and Type</h3>
            <p className="tb-muted-note">Share of completed cards in the selected reporting period.</p>
          </div>
        </header>

        <div className="tb-exec-workmix-grid">
          <ReportWorkMixChart title="Work Stream Mix" label="Work stream effort distribution chart" slices={groupDistributionSlices} total={visibleInitiativeSignals.totalCompletedInPeriod} loading={loading} />
          <ReportWorkMixChart title="Work Type Mix" label="Type effort distribution chart" slices={typeDistributionSlices} total={visibleInitiativeSignals.totalCompletedInPeriod} loading={loading} />
        </div>
      </section>

      <section className="tb-panel">
        <header className="tb-panel-header">
          <div>
            <h3>Progress for Key Initiatives</h3>
            <p className="tb-muted-note">Delivery progress for initiatives included in this report.</p>
          </div>
        </header>

        <div className="tb-sync-history-wrap tb-sync-history-wrap-no-scroll">
          <table className="tb-sync-history-table tb-exec-initiative-table">
            <thead>
              <tr>
                <th scope="col">Initiative</th>
                <th scope="col">Period progress</th>
                <th scope="col">Overall completion</th>
                <th scope="col">Timeline health</th>
              </tr>
            </thead>
            {groupReportInitiatives(visibleInitiativeRows).map((group, index) => (
              <tbody key={`${index}:${group.workStream}`}>
                <tr className="tb-exec-initiative-group">
                  <th scope="rowgroup" colSpan={4}>{group.workStream}</th>
                </tr>
                {group.rows.map((row) => (
                  <tr key={row.epicKey}>
                    <td><ReportJiraLink baseUrl={jiraBaseUrl} issueKey={row.epicKey}>{row.epicName || row.epicKey}</ReportJiraLink></td>
                    <td className="tb-exec-period-progress">
                      {row.completedInPeriodValue}/{row.totalCards} cards ({formatPercent(row.deltaPercentValue)})
                    </td>
                    <td>
                      <div className="tb-history-progress">
                        <span className="tb-history-progress-track">
                          <span className="tb-history-progress-fill" style={{ width: `${Math.min(100, row.completionPercent)}%` }} />
                        </span>
                        <span className="tb-history-progress-label">{formatPercent(row.completionPercent)}</span>
                      </div>
                    </td>
                    <td><ReportTimelineHealth rag={row.rag} explanation={row.ragTooltip} /></td>
                  </tr>
                ))}
              </tbody>
            ))}
            <tbody>
              {!loading && visibleInitiativeRows.length === 0 ? (
                <tr>
                  <td colSpan={4}>
                    {initiativeRows.length > 0
                      ? "No initiatives selected. Use Configure Initiatives to include epics in this section."
                      : "No configured epic data available yet."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="tb-panel">
        <header className="tb-panel-header">
          <div>
            <h3>Completed Work Summary</h3>
          </div>
          <div className="tb-btn-row">
            <button
              type="button"
              className="tb-btn tb-btn-sm tb-no-print"
              onClick={refreshCompletedWorkSummary}
              disabled={completedWorkLoading}
            >
              Refresh Completed Work Summary
            </button>
          </div>
        </header>

        {completedWorkError ? <p className="tb-error-note">Completed work summary draft error: {completedWorkError}</p> : null}

        <div className="tb-exec-completed-summary">
          {completedWorkDraft.map((entry) => (
            <div key={entry.group}>
              <h4 className="tb-exec-list-title">{entry.group}</h4>
              {groupCompletedWorkByEpic(entry.bullets).map((epic) => (
                <div className="tb-exec-completed-epic" key={epic.epicKey ?? "notice"}>
                  {epic.epicKey ? (
                    <h5 className="tb-exec-completed-epic-title">
                      <ReportJiraLink baseUrl={jiraBaseUrl} issueKey={epic.epicKey}>{epic.epicName}</ReportJiraLink>
                    </h5>
                  ) : null}
                  <ul className="tb-list tb-exec-narrative-list">
                    {epic.bullets.map((item) => (
                      <li key={item.source?.cardId ?? `${entry.group}:${item.text}`}>
                        <div>{item.text}</div>
                        {item.source ? (
                          <div className="tb-exec-completed-source">
                            <ReportJiraLink baseUrl={jiraBaseUrl} issueKey={item.source.issueKey}>{item.source.issueKey}</ReportJiraLink>
                            {" · "}{item.source.issueTitle}
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ))}
          {completedWorkLoading ? <p className="tb-muted-note">Generating completed work summary with {aiProviderName}...</p> : null}
          {!completedWorkLoading && completedWorkDraft.length === 0 ? (
            <p className="tb-muted-note">Completed work summary will appear once selected initiatives have completed cards.</p>
          ) : null}
        </div>
        <hr className="tb-section-divider" />
        <div className="tb-exec-summary-meta">
          <span>Generated with {aiProviderName}</span>
          <span>Model: {completedWorkModelId ?? "default"}</span>
          <span>Updated: {formatDraftTimestamp(completedWorkGeneratedAt)}</span>
          <span>{completedWorkWordCount} words</span>
        </div>
      </section>

      {isReportingConfigOpen ? (
        <div className="tb-modal-layer" role="dialog" aria-modal="true" aria-label="Configure Reporting Period">
          <div className="tb-modal-backdrop" onClick={closeReportingConfig} />
          <div className="tb-modal tb-modal-reporting">
            <header className="tb-modal-head">
              <div>
                <h3>Configure Reporting Period</h3>
                <p className="tb-muted-note">Set the reporting window used across Team Report sections.</p>
              </div>
              <div className="tb-action-row">
                <button type="button" className="tb-btn tb-btn-sm" onClick={closeReportingConfig}>
                  Cancel
                </button>
                <button type="button" className="tb-btn tb-btn-sm tb-btn-primary" onClick={saveReportingConfig}>
                  Save
                </button>
              </div>
            </header>

            <div className="tb-exec-period-toolbar">
              <div className={`tb-exec-period-row${reportingPreset === "custom" ? " is-custom" : ""}`}>
                <label className="tb-exec-period-field">
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
                    <label className="tb-exec-period-field">
                      <span>Start</span>
                      <input
                        type="date"
                        value={reportingStartDraft}
                        onInput={(event) => setReportingStartDraft((event.currentTarget as HTMLInputElement).value)}
                      />
                    </label>
                    <label className="tb-exec-period-field">
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

            <p className="tb-muted-note">
              Active period: {reportingPeriodLabel} ({reportingPeriodDays} days, {effectivePeriodTimezone})
            </p>
            {reportingValidationError ? <p className="tb-error-note">{reportingValidationError}</p> : null}
          </div>
        </div>
      ) : null}

      {isInitiativeConfigOpen ? (
        <div className="tb-modal-layer" role="dialog" aria-modal="true" aria-label="Configure Initiative Epics">
          <div className="tb-modal-backdrop" onClick={closeInitiativeConfig} />
          <div className="tb-modal tb-modal-wide">
            <header className="tb-modal-head">
              <div>
                <h3>Configure Initiative Epics</h3>
                <p className="tb-muted-note">Choose which epics appear in Progress for Key Initiatives.</p>
              </div>
              <div className="tb-action-row">
                <button type="button" className="tb-btn tb-btn-sm" onClick={closeInitiativeConfig}>
                  Cancel
                </button>
                <button type="button" className="tb-btn tb-btn-sm tb-btn-primary" onClick={saveInitiativeConfig} disabled={loading}>
                  Save
                </button>
              </div>
            </header>

            <div className="tb-exec-auto-select">
              <label>
                <input type="checkbox" checked={initiativeConfigDraftMode === "automatic"} disabled={loading}
                  onChange={(event) => {
                    setInitiativeConfigDraftMode(event.target.checked ? "automatic" : "manual");
                    if (event.target.checked) setInitiativeConfigDraftKeys(resolveReportInitiativeSelection(initiativeRows, initiativeConfigDraftKeys, "automatic"));
                  }} />
                Automatically select initiatives with completed cards in the reporting period
              </label>
              <p className="tb-muted-note" aria-live="polite">{loading ? "Updating initiatives for the reporting period…" : `${qualifyingInitiativeKeys.length} initiatives qualify for ${reportingPeriodLabel}. Updates when the reporting period changes.`}</p>
              <p className="tb-muted-note">Adding or removing initiatives switches to manual selection. Reordering keeps automatic selection enabled.</p>
            </div>

            <label className="tb-exec-search">
              <span>Search epics</span>
              <input
                type="text"
                value={initiativeConfigQuery}
                onInput={(event) => setInitiativeConfigQuery((event.currentTarget as HTMLInputElement).value)}
                placeholder="Search by epic key, title, work stream, or type"
              />
            </label>

            <div className="tb-modal-two-up">
              <section>
                <header className="tb-panel-header-actions">
                  <strong>Available ({availableConfigRows.length})</strong>
                  <button
                    type="button"
                    className="tb-btn tb-btn-sm"
                    onClick={() => { setInitiativeConfigDraftMode("manual"); setInitiativeConfigDraftKeys(initiativeRows.map((row) => row.epicKey)); }}
                  >
                    Select All
                  </button>
                </header>
                <p className="tb-muted-note">Double-click to add.</p>

                <div className="tb-exec-config-list">
                  {availableConfigRows.map((row) => (
                    <button
                      key={row.epicKey}
                      type="button"
                      className="tb-exec-config-item tb-exec-config-item-button"
                      onDoubleClick={() => addInitiativeDraftKey(row.epicKey)}
                    >
                      <div>
                        <strong>{row.epicName || row.epicKey}</strong>
                        <p>{row.groupText} | {row.typeText} | {row.epicKey}</p>
                      </div>
                    </button>
                  ))}
                  {availableConfigRows.length === 0 ? <p className="tb-muted-note">No epics match the current search.</p> : null}
                </div>
              </section>

              <section>
                <header className="tb-panel-header-actions">
                  <strong>Selected ({selectedConfigRows.length})</strong>
                  <button
                    type="button"
                    className="tb-btn tb-btn-sm"
                    onClick={() => { setInitiativeConfigDraftMode("manual"); setInitiativeConfigDraftKeys([]); }}
                  >
                    Clear All
                  </button>
                </header>
                <p className="tb-muted-note">Double-click to remove. Drag to reorder.</p>

                <div className="tb-exec-config-list">
                  {selectedConfigRows.map((row) => (
                    <div
                      key={row.epicKey}
                      className={`tb-exec-config-item tb-exec-config-item-draggable${initiativeConfigDraggingKey === row.epicKey ? " is-dragging" : ""}`}
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
                      <span className="tb-exec-drag-handle" aria-hidden="true">
                        ::
                      </span>
                      <div>
                        <strong>{row.epicName || row.epicKey}</strong>
                        <p>{row.groupText} | {row.typeText} | {row.epicKey}</p>
                      </div>
                    </div>
                  ))}
                  {selectedConfigRows.length === 0 ? <p className="tb-muted-note">No epics selected yet.</p> : null}
                </div>
              </section>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
