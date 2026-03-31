/**
 * @license
 * Copyright (c) 2014, 2026, Oracle and/or its affiliates.
 * Licensed under The Universal Permissive License (UPL), Version 1.0
 * as shown at https://oss.oracle.com/licenses/upl/
 * @ignore
 */
import { h } from "preact";
import { useMemo, useState } from "preact/hooks";
import { ExecutiveReportScreen, OPEN_EXEC_REPORTING_PERIOD_EVENT } from "./screens/ExecutiveReportScreen";
import { IncidentResponseScreen } from "./screens/IncidentResponseScreen";
import { InitiativesScreen } from "./screens/InitiativesScreen";
import { IntegrationsScreen } from "./screens/IntegrationsScreen";
import { ReleasesScreen } from "./screens/ReleasesScreen";
import { SecurityScreen } from "./screens/SecurityScreen";
import { SprintBoardScreen } from "./screens/SprintBoardScreen";
import { TeamInsightsScreen } from "./screens/TeamInsightsScreen";

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
  { id: "sprint", label: "Current Sprint", blurb: "Overview / Progress / Scope Creep / Blockers", showConstruction: false },
  { id: "initiatives", label: "Initiative Insights", blurb: "Epic progress + RAG", showConstruction: false },
  { id: "team", label: "Team Insights", blurb: "Velocity and cycle time", showConstruction: true },
  { id: "security", label: "Security", blurb: "Vulnerability posture", showConstruction: true },
  { id: "incidents", label: "Incident Response", blurb: "Operational incidents and SLAs", showConstruction: true },
  { id: "releases", label: "Release", blurb: "Release cadence and quality", showConstruction: true },
  { id: "executive", label: "Executive Report", blurb: "Leadership summary output", showConstruction: false },
  { id: "integrations", label: "Settings", blurb: "Connections / Field Mapping / Epic Metadata", showConstruction: false },
];

function screenTitle(id: ScreenId): string {
  const mapping: Record<ScreenId, string> = {
    integrations: "Settings",
    initiatives: "Initiative Insights",
    team: "Team Insights",
    sprint: "Current Sprint",
    security: "Security",
    incidents: "Incident Response",
    releases: "Releases",
    executive: "Executive Report",
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
      return <ExecutiveReportScreen />;
    default:
      return <IntegrationsScreen />;
  }
}

export function Content({ appName }: Props) {
  const [active, setActive] = useState<ScreenId>("integrations");
  const heading = useMemo(() => screenTitle(active), [active]);

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
          {active === "executive" ? (
            <div class="tb-topbar-actions">
              <button
                type="button"
                class="tb-btn tb-btn-sm tb-no-print"
                onClick={() => window.dispatchEvent(new CustomEvent(OPEN_EXEC_REPORTING_PERIOD_EVENT))}
              >
                Reporting Period
              </button>
              <button type="button" class="tb-btn tb-btn-sm tb-no-print" onClick={() => window.print()}>
                Print Report
              </button>
            </div>
          ) : null}
        </header>
        <section class="tb-screen-body">{renderScreen(active)}</section>
      </main>
    </div>
  );
}
