/**
 * @license
 * Copyright (c) 2014, 2026, Oracle and/or its affiliates.
 * Licensed under The Universal Permissive License (UPL), Version 1.0
 * as shown at https://oss.oracle.com/licenses/upl/
 * @ignore
 */
import { h } from "preact";
import { useMemo, useState } from "preact/hooks";
import { IncidentResponseScreen } from "./screens/IncidentResponseScreen";
import { InitiativesScreen } from "./screens/InitiativesScreen";
import { IntegrationsScreen } from "./screens/IntegrationsScreen";
import { IndividualsScreen } from "./screens/IndividualsScreen";
import { PlaceholderScreen } from "./screens/PlaceholderScreen";
import { ReleasesScreen } from "./screens/ReleasesScreen";
import { SecurityScreen } from "./screens/SecurityScreen";
import { SprintBoardScreen } from "./screens/SprintBoardScreen";
import { TeamInsightsScreen } from "./screens/TeamInsightsScreen";

type ScreenId =
  | "integrations"
  | "initiatives"
  | "team"
  | "individuals"
  | "sprint"
  | "security"
  | "incidents"
  | "releases"
  | "executive";

type NavItem = {
  id: ScreenId;
  label: string;
  blurb: string;
  implemented: boolean;
};

type Props = {
  appName: string;
};

const NAV_ITEMS: NavItem[] = [
  { id: "integrations", label: "Integrations", blurb: "JIRA, OCI GenAI, Confluence", implemented: true },
  { id: "initiatives", label: "Initiative Insights", blurb: "Epic progress + RAG", implemented: true },
  { id: "team", label: "Team Insights", blurb: "Velocity and cycle time", implemented: true },
  { id: "individuals", label: "Individual Insights", blurb: "Alias-based work windows", implemented: true },
  { id: "sprint", label: "Current Sprint", blurb: "Done / In Progress / Planned", implemented: true },
  { id: "security", label: "Security", blurb: "Vulnerability posture", implemented: true },
  { id: "incidents", label: "Incident Response", blurb: "Operational incidents and SLAs", implemented: true },
  { id: "releases", label: "Releases", blurb: "Release cadence and quality", implemented: true },
  { id: "executive", label: "Executive Report", blurb: "Leadership-ready summary", implemented: false },
];

function screenTitle(id: ScreenId): string {
  const mapping: Record<ScreenId, string> = {
    integrations: "Integrations & Field Mapping",
    initiatives: "Initiative Insights",
    team: "Team Insights",
    individuals: "Individual Insights",
    sprint: "Current Sprint Work",
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
    case "individuals":
      return <IndividualsScreen />;
    case "sprint":
      return <SprintBoardScreen />;
    case "security":
      return <SecurityScreen />;
    case "incidents":
      return <IncidentResponseScreen />;
    case "releases":
      return <ReleasesScreen />;
    case "executive":
      return (
        <PlaceholderScreen
          heading="Executive Report"
          detail="Migration in progress. OCI GenAI-driven executive summary and wins/risks drafting will be migrated in Phase 3."
        />
      );
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
                {!item.implemented ? (
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
        </header>
        <section class="tb-screen-body">{renderScreen(active)}</section>
      </main>
    </div>
  );
}
