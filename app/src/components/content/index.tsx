/**
 * @license
 * Copyright (c) 2014, 2026, Oracle and/or its affiliates.
 * Licensed under The Universal Permissive License (UPL), Version 1.0
 * as shown at https://oss.oracle.com/licenses/upl/
 * @ignore
 */
import { h } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import {
  EXPORT_TEAM_DASHBOARD_HTML_EVENT,
  OPEN_TEAM_DASHBOARD_INITIATIVE_CONFIG_EVENT,
  OPEN_TEAM_DASHBOARD_REPORTING_PERIOD_EVENT,
  TeamDashboardScreen,
} from "./screens/TeamDashboardScreen";
import { IncidentResponseScreen } from "./screens/IncidentResponseScreen";
import { InitiativesScreen } from "./screens/InitiativesScreen";
import { IntegrationsScreen } from "./screens/IntegrationsScreen";
import { ReleasesScreen } from "./screens/ReleasesScreen";
import { SecurityScreen } from "./screens/SecurityScreen";
import { SprintBoardScreen } from "./screens/SprintBoardScreen";
import {
  OPEN_TEAM_INSIGHTS_SETTINGS_EVENT,
  TEAM_INSIGHTS_TREND_WINDOW_CHANGE_EVENT,
  TEAM_INSIGHTS_TREND_WINDOW_SYNC_EVENT,
  TeamInsightsScreen,
  TREND_WINDOW_OPTIONS,
  formatTrendWindowLabel,
  normalizeTrendWindow,
} from "./screens/TeamInsightsScreen";

type ScreenId =
  | "integrations"
  | "initiatives"
  | "team"
  | "sprint"
  | "security"
  | "incidents"
  | "releases"
  | "executive";

type NavItem = {
  id: ScreenId;
  label: string;
  blurb: string;
  showConstruction: boolean;
};

type Props = {
  appName: string;
};

const NAV_ITEMS: NavItem[] = [
  { id: "initiatives", label: "Initiative Insights", blurb: "Epic Config / Progress / RAG", showConstruction: false },
  { id: "sprint", label: "Sprint Insights", blurb: "Overview / Progress / Scope Creep / Blockers", showConstruction: false },
  { id: "team", label: "Team Insights", blurb: "Sprint Trend / Cycle Time", showConstruction: false },
  { id: "security", label: "Security Insights", blurb: "Scan / Vulnerability Posture", showConstruction: true },
  { id: "incidents", label: "Operations Insights", blurb: "Incidents / DR / Observability", showConstruction: true },
  { id: "releases", label: "Release Insights", blurb: "Cadence / Release Notes", showConstruction: true },
  { id: "executive", label: "Team Dashboard", blurb: "Summary / Wins / Risks / Progress / Work Mix", showConstruction: false },
  { id: "integrations", label: "Settings", blurb: "Connections / Metadata Configuration", showConstruction: false },
];

function screenTitle(id: ScreenId): string {
  const mapping: Record<ScreenId, string> = {
    integrations: "Settings",
    initiatives: "Initiative Insights",
    team: "Team Insights",
    sprint: "Sprint Insights",
    security: "Security Insights",
    incidents: "Operations Insights",
    releases: "Release Insights",
    executive: "Team Dashboard",
  };
  return mapping[id];
}

function renderScreen(id: ScreenId) {
  switch (id) {
    case "integrations":
      return <IntegrationsScreen />;
    case "initiatives":
      return <InitiativesScreen />;
    case "team":
      return <TeamInsightsScreen />;
    case "sprint":
      return <SprintBoardScreen />;
    case "security":
      return <SecurityScreen />;
    case "incidents":
      return <IncidentResponseScreen />;
    case "releases":
      return <ReleasesScreen />;
    case "executive":
      return <TeamDashboardScreen />;
    default:
      return <IntegrationsScreen />;
  }
}

export function Content({ appName }: Props) {
  const [active, setActive] = useState<ScreenId>("integrations");
  const [teamTrendWindowSelection, setTeamTrendWindowSelection] = useState<number>(12);
  const heading = useMemo(() => screenTitle(active), [active]);
  useEffect(() => {
    const handleTeamInsightsTrendWindowSync = (event: Event) => {
      const detail = (event as CustomEvent<{ trendWindow?: number }>).detail;
      const requestedTrendWindow = Number.parseInt(String(detail?.trendWindow ?? ""), 10);
      if (Number.isNaN(requestedTrendWindow)) return;
      setTeamTrendWindowSelection(normalizeTrendWindow(requestedTrendWindow));
    };
    window.addEventListener(TEAM_INSIGHTS_TREND_WINDOW_SYNC_EVENT, handleTeamInsightsTrendWindowSync as EventListener);
    return () => {
      window.removeEventListener(TEAM_INSIGHTS_TREND_WINDOW_SYNC_EVENT, handleTeamInsightsTrendWindowSync as EventListener);
    };
  }, []);

  return (
    <div class="tb-app-frame">
      <aside class="tb-sidebar">
        <div class="tb-brand">
          <div class="tb-brand-mark" aria-hidden="true">TB</div>
          <div>
            <p class="tb-eyebrow">{appName}</p>
            <h1>Manager Console</h1>
            <small>Illuminating Engineering Insights</small>
          </div>
        </div>
        <nav class="tb-nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              class={`tb-nav-item${active === item.id ? " is-active" : ""}`}
              onClick={() => setActive(item.id)}
            >
              <div class="tb-nav-title-row">
                <span class="tb-nav-title">{item.label}</span>
                {item.showConstruction ? (
                  <span
                    class="tb-nav-construction"
                    title="Under construction"
                    aria-label={`${item.label} is under construction`}
                  >
                    🚧
                  </span>
                ) : null}
              </div>
              <small>{item.blurb}</small>
            </button>
          ))}
        </nav>
      </aside>

      <main class="tb-main">
        <header class="tb-topbar">
          <h2>{heading}</h2>
          {active === "team" ? (
            <div class="tb-topbar-actions">
              <label class="tb-topbar-trend-window">
                <span>Trend Window</span>
                <select
                  aria-label="Trend Window"
                  value={String(teamTrendWindowSelection)}
                  onChange={(event) => {
                    const nextValue = Number.parseInt((event.currentTarget as HTMLSelectElement).value, 10);
                    const normalizedValue = normalizeTrendWindow(nextValue);
                    setTeamTrendWindowSelection(normalizedValue);
                    window.dispatchEvent(new CustomEvent(TEAM_INSIGHTS_TREND_WINDOW_CHANGE_EVENT, {
                      detail: { trendWindow: normalizedValue },
                    }));
                  }}
                >
                  {TREND_WINDOW_OPTIONS.map((value) => (
                    <option key={value} value={String(value)}>
                      {formatTrendWindowLabel(value)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                class="tb-btn tb-btn-sm tb-no-print"
                aria-label="Team Insights Settings"
                onClick={() => window.dispatchEvent(new CustomEvent(OPEN_TEAM_INSIGHTS_SETTINGS_EVENT))}
              >
                Settings
              </button>
            </div>
          ) : null}
          {active === "executive" ? (
            <div class="tb-topbar-actions">
              <button
                type="button"
                class="tb-btn tb-btn-sm tb-no-print"
                onClick={() => window.dispatchEvent(new CustomEvent(OPEN_TEAM_DASHBOARD_REPORTING_PERIOD_EVENT))}
              >
                Reporting Period
              </button>
              <button
                type="button"
                class="tb-btn tb-btn-sm tb-no-print"
                onClick={() => window.dispatchEvent(new CustomEvent(OPEN_TEAM_DASHBOARD_INITIATIVE_CONFIG_EVENT))}
              >
                Configure Initiatives
              </button>
              <button
                type="button"
                class="tb-btn tb-btn-sm tb-no-print"
                onClick={() => window.dispatchEvent(new CustomEvent(EXPORT_TEAM_DASHBOARD_HTML_EVENT))}
              >
                Export Dashboard
              </button>
            </div>
          ) : null}
        </header>
        <section class="tb-screen-body">{renderScreen(active)}</section>
      </main>
    </div>
  );
}
