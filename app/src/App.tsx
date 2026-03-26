import { useMemo, useState } from "react";
import { ScreenId, NavItem } from "./types";
import { IntegrationsScreen } from "./screens/IntegrationsScreen";
import { InitiativesScreen } from "./screens/InitiativesScreen";
import { TeamInsightsScreen } from "./screens/TeamInsightsScreen";
import { IndividualsScreen } from "./screens/IndividualsScreen";
import { SprintBoardScreen } from "./screens/SprintBoardScreen";
import { SecurityScreen } from "./screens/SecurityScreen";
import { IncidentResponseScreen } from "./screens/IncidentResponseScreen";
import { ReleasesScreen } from "./screens/ReleasesScreen";
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
    id: "security",
    label: "Security",
    blurb: "Vulnerability and remediation view"
  },
  {
    id: "incidents",
    label: "Incident Response",
    blurb: "Operational incidents and SLAs"
  },
  {
    id: "releases",
    label: "Releases",
    blurb: "Release health and deployment cadence"
  },
  {
    id: "executive",
    label: "Executive Report",
    blurb: "Leadership summary output"
  }
];

function LighthouseMark() {
  return (
    <svg
      className="lighthouse-mark"
      viewBox="0 0 120 120"
      role="img"
      aria-label="Lighthouse icon"
    >
      <defs>
        <linearGradient id="badgeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#f6fbff" />
          <stop offset="100%" stopColor="#d6e4ef" />
        </linearGradient>
        <linearGradient id="towerGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#d9e4ee" />
        </linearGradient>
        <linearGradient id="capGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#1d5f86" />
          <stop offset="100%" stopColor="#123f5a" />
        </linearGradient>
        <linearGradient id="beamGradientRight" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#ffd36a" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#ff9f3f" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="beamGradientLeft" x1="100%" y1="0%" x2="0%" y2="0%">
          <stop offset="0%" stopColor="#ffd36a" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#ff9f3f" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="windowGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#2a6f95" />
          <stop offset="100%" stopColor="#184d6b" />
        </linearGradient>
      </defs>

      <circle cx="60" cy="60" r="56" fill="url(#badgeGradient)" stroke="#a8bfd0" strokeWidth="2" />
      <path d="M60 34 L114 22 L114 49 L60 43 Z" fill="url(#beamGradientRight)" />
      <path d="M60 34 L6 22 L6 49 L60 43 Z" fill="url(#beamGradientLeft)" />
      <ellipse cx="60" cy="94" rx="31" ry="7" fill="#87aec6" />
      <polygon points="44,92 76,92 70,36 50,36" fill="url(#towerGradient)" stroke="#8ea8bb" strokeWidth="2" />
      <rect x="48" y="52" width="24" height="6" fill="#1f5f84" />
      <rect x="48" y="64" width="24" height="6" fill="#1f5f84" />
      <rect x="53" y="31" width="14" height="8" rx="1.5" fill="#1d5b7f" />
      <polygon points="60,16 74,31 46,31" fill="url(#capGradient)" />
      <rect x="56" y="74" width="8" height="18" rx="1.5" fill="url(#windowGradient)" />
      <rect x="39" y="92" width="42" height="5" rx="2" fill="#245f82" />
    </svg>
  );
}

function currentScreenTitle(id: ScreenId): string {
  const mapping: Record<ScreenId, string> = {
    integrations: "Integrations & Field Mapping",
    initiatives: "Initiative Insights",
    team: "Team Insights",
    individuals: "Individual Insights",
    sprint: "Current Sprint Work",
    security: "Security",
    incidents: "Incident Response",
    releases: "Releases",
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

export default function App() {
  const [active, setActive] = useState<ScreenId>("integrations");
  const heading = useMemo(() => currentScreenTitle(active), [active]);

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <div className="brand-block">
          <LighthouseMark />
          <div className="brand-copy">
            <p className="eyebrow">TeamBeacon</p>
            <h1>Manager Console</h1>
            <small>Illuminating Engineering Insights</small>
          </div>
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
        </header>

        <section className="screen-body">{renderScreen(active)}</section>
      </main>
    </div>
  );
}
