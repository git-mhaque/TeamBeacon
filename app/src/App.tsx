import { useMemo, useState } from "react";
import { ScreenId, NavItem } from "./types";
import { IntegrationsScreen } from "./screens/IntegrationsScreen";
import { InitiativesScreen } from "./screens/InitiativesScreen";
import { TeamInsightsScreen } from "./screens/TeamInsightsScreen";
import { IndividualsScreen } from "./screens/IndividualsScreen";
import { SprintBoardScreen } from "./screens/SprintBoardScreen";
import { ExecutiveReportScreen } from "./screens/ExecutiveReportScreen";

const NAV_ITEMS: NavItem[] = [
  {
    id: "integrations",
    label: "Integrations",
    blurb: "JIRA and Confluence setup"
  },
  {
    id: "initiatives",
    label: "Initiative Insights",
    blurb: "Epic-driven progress + RAG"
  },
  {
    id: "team",
    label: "Team Insights",
    blurb: "Sprint velocity and cycle time"
  },
  {
    id: "individuals",
    label: "Individual Insights",
    blurb: "Alias-based work windows"
  },
  {
    id: "sprint",
    label: "Current Sprint",
    blurb: "Done / In Progress / Planned"
  },
  {
    id: "executive",
    label: "Executive Report",
    blurb: "Leadership summary output"
  }
];

function currentScreenTitle(id: ScreenId): string {
  const mapping: Record<ScreenId, string> = {
    integrations: "Integrations & Field Mapping",
    initiatives: "Initiative Insights",
    team: "Team Insights",
    individuals: "Individual Insights",
    sprint: "Current Sprint Work",
    executive: "Executive Report"
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
    case "executive":
      return <ExecutiveReportScreen />;
    default:
      return <IntegrationsScreen />;
  }
}

export default function App() {
  const [active, setActive] = useState<ScreenId>("integrations");
  const heading = useMemo(() => currentScreenTitle(active), [active]);

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <div className="brand-block">
          <p className="eyebrow">TeamBeacon</p>
          <h1>Manager Console</h1>
          <small>Unified Engineering Pulse</small>
        </div>
        <nav>
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${active === item.id ? "active" : ""}`}
              onClick={() => setActive(item.id)}
              type="button"
            >
              <span>{item.label}</span>
              <small>{item.blurb}</small>
            </button>
          ))}
        </nav>
      </aside>

      <main className="main-pane">
        <header className="topbar">
          <div>
            <p className="eyebrow">TeamBeacon Insights</p>
            <h2>{heading}</h2>
          </div>
          <div className="topbar-actions">
            <span className="chip">Team: Platform</span>
            <span className="chip">Window: Last 7 Days</span>
            <button className="sync-btn" type="button">
              Sync Data
            </button>
          </div>
        </header>

        <section className="screen-body">{renderScreen(active)}</section>
      </main>
    </div>
  );
}
