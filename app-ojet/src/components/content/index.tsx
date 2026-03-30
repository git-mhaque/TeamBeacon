/**
 * @license
 * Copyright (c) 2014, 2026, Oracle and/or its affiliates.
 * Licensed under The Universal Permissive License (UPL), Version 1.0
 * as shown at https://oss.oracle.com/licenses/upl/
 * @ignore
 */
import { h } from "preact";
import { useMemo, useState } from "preact/hooks";
import { InitiativesScreen } from "./screens/InitiativesScreen";
import { IntegrationsScreen } from "./screens/IntegrationsScreen";
import { IndividualsScreen } from "./screens/IndividualsScreen";
import { PlaceholderScreen } from "./screens/PlaceholderScreen";
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
};

type Props = {
  appName: string;
};

const NAV_ITEMS: NavItem[] = [
  { id: "integrations", label: "Integrations", blurb: "JIRA, OCI GenAI, Confluence" },
  { id: "initiatives", label: "Initiative Insights", blurb: "Epic progress + RAG" },
  { id: "team", label: "Team Insights", blurb: "Velocity and cycle time" },
  { id: "individuals", label: "Individual Insights", blurb: "Alias-based work windows" },
  { id: "sprint", label: "Current Sprint", blurb: "Done / In Progress / Planned" },
  { id: "security", label: "Security", blurb: "Vulnerability posture" },
  { id: "incidents", label: "Incident Response", blurb: "Operational incidents and SLAs" },
  { id: "releases", label: "Releases", blurb: "Release cadence and quality" },
  { id: "executive", label: "Executive Report", blurb: "Leadership-ready summary" },
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
      return (
        <PlaceholderScreen
          heading="Security"
          detail="Migration in progress. Shared OJET placeholder pattern is established for this module."
        />
      );
    case "incidents":
      return (
        <PlaceholderScreen
          heading="Incident Response"
          detail="Migration in progress. Shared OJET placeholder pattern is established for this module."
        />
      );
    case "releases":
      return (
        <PlaceholderScreen
          heading="Releases"
          detail="Migration in progress. Shared OJET placeholder pattern is established for this module."
        />
      );
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
            <small>Oracle JET migration baseline</small>
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
              <span>{item.label}</span>
              <small>{item.blurb}</small>
            </button>
          ))}
        </nav>
      </aside>

      <main class="tb-main">
        <header class="tb-topbar">
          <div>
            <p class="tb-eyebrow">TeamBeacon OJET Preview</p>
            <h2>{heading}</h2>
          </div>
          <span class="tb-chip">Phase 0/1 Migration</span>
        </header>
        <section class="tb-screen-body">{renderScreen(active)}</section>
      </main>
    </div>
  );
}
