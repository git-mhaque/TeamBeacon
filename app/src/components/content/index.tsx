/**
 * @license
 * Copyright (c) 2014, 2026, Oracle and/or its affiliates.
 * Licensed under The Universal Permissive License (UPL), Version 1.0
 * as shown at https://oss.oracle.com/licenses/upl/
 * @ignore
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ChartColumn,
  Gauge,
  LayoutDashboard,
  ListTodo,
  Menu,
  PanelLeftClose,
  Rocket,
  Settings,
  ShieldCheck,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { InitiativeDeepDiveScreen } from "./screens/InitiativeDeepDiveScreen";
import {
  INITIATIVES_VIEW_STATE_EVENT,
  OPEN_INITIATIVES_CONFIGURE_EVENT,
  OPEN_INITIATIVES_MANAGE_VIEW_EVENT,
  SET_INITIATIVES_ACTIVE_VIEW_EVENT,
  InitiativesScreen,
} from "./screens/InitiativesScreen";
import {
  EXPORT_TEAM_DASHBOARD_HTML_EVENT,
  OPEN_TEAM_DASHBOARD_INITIATIVE_CONFIG_EVENT,
  OPEN_TEAM_DASHBOARD_REPORTING_PERIOD_EVENT,
  TeamDashboardScreen,
} from "./screens/TeamDashboardScreen";
import { IncidentResponseScreen } from "./screens/IncidentResponseScreen";
import { IntegrationsScreen } from "./screens/IntegrationsScreen";
import { SystemStatusControl } from "./screens/SystemStatusControl";
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
  | "initiative-deep-dive"
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
  icon: LucideIcon;
};

type Props = {
  appName: string;
};

type InitiativeTopbarView = {
  id: number | "all";
  name: string;
  epicCount: number;
  isDefault?: boolean;
};

type InitiativeTopbarState = {
  views: InitiativeTopbarView[];
  activeViewId: number | "all";
};

const DEFAULT_INITIATIVE_TOPBAR_STATE: InitiativeTopbarState = {
  views: [{ id: "all", name: "All Configured", epicCount: 0, isDefault: true }],
  activeViewId: "all",
};

const NAV_ITEMS: NavItem[] = [
  { id: "initiatives", label: "Initiative Insights", blurb: "Epic Config / Progress / RAG", showConstruction: false, icon: Gauge },
  { id: "initiative-deep-dive", label: "Initiative Deep Dive", blurb: "New / WIP / Completed Flow", showConstruction: false, icon: ChartColumn },
  { id: "sprint", label: "Sprint Insights", blurb: "Overview / Progress / Scope Creep / Blockers", showConstruction: false, icon: ListTodo },
  { id: "team", label: "Team Insights", blurb: "Sprint Trend / Cycle Time", showConstruction: false, icon: UsersRound },
  { id: "security", label: "Security Insights", blurb: "Scan / Vulnerability Posture", showConstruction: true, icon: ShieldCheck },
  { id: "incidents", label: "Operations Insights", blurb: "Incidents / DR / Observability", showConstruction: true, icon: Activity },
  { id: "releases", label: "Release Insights", blurb: "Cycle Time / Readiness / Risk", showConstruction: false, icon: Rocket },
  { id: "executive", label: "Team Dashboard", blurb: "Summary / Wins / Risks / Progress / Work Mix", showConstruction: false, icon: LayoutDashboard },
  { id: "integrations", label: "Settings", blurb: "Groups / Work Types / Metadata", showConstruction: false, icon: Settings },
];

function screenTitle(id: ScreenId): string {
  const mapping: Record<ScreenId, string> = {
    integrations: "Settings",
    initiatives: "Initiative Insights",
    "initiative-deep-dive": "Initiative Deep Dive",
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
    case "initiative-deep-dive":
      return <InitiativeDeepDiveScreen />;
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

type TrendWindowDropdownProps = {
  value: number;
  onChange: (value: number) => void;
};

type InitiativeViewDropdownProps = {
  views: InitiativeTopbarView[];
  activeViewId: number | "all";
  onChange: (viewId: number | "all") => void;
};

function formatInitiativeViewOption(view: InitiativeTopbarView): string {
  return `${view.name} (${view.epicCount})`;
}

function TrendWindowDropdown({ value, onChange }: TrendWindowDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef<Record<number, HTMLButtonElement | null>>({});

  const focusOption = (optionValue: number) => {
    optionRefs.current[optionValue]?.focus();
  };

  const focusOptionByOffset = (optionValue: number, offset: number) => {
    const currentIndex = TREND_WINDOW_OPTIONS.indexOf(optionValue as typeof TREND_WINDOW_OPTIONS[number]);
    if (currentIndex < 0) return;
    const nextIndex = Math.min(Math.max(currentIndex + offset, 0), TREND_WINDOW_OPTIONS.length - 1);
    focusOption(TREND_WINDOW_OPTIONS[nextIndex]);
  };

  const closeMenu = () => {
    setIsOpen(false);
  };

  const selectValue = (nextValue: number) => {
    const normalizedValue = normalizeTrendWindow(nextValue);
    if (normalizedValue !== value) {
      onChange(normalizedValue);
    }
    closeMenu();
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!isOpen) return undefined;

    const handlePointerDown = (event: MouseEvent) => {
      if (dropdownRef.current?.contains(event.target as Node)) return;
      closeMenu();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeMenu();
      triggerRef.current?.focus();
    };

    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    focusOption(value);
  }, [isOpen, value]);

  return (
    <div className="tb-topbar-trend-window">
      <span id="tb-trend-window-label">Trend Window</span>
      <div className="tb-topbar-trend-window-dropdown" ref={dropdownRef}>
        <button
          ref={triggerRef}
          type="button"
          className={`tb-topbar-trend-window-trigger${isOpen ? " is-open" : ""}`}
          role="combobox"
          aria-labelledby="tb-trend-window-label"
          aria-describedby="tb-trend-window-value"
          aria-expanded={isOpen ? "true" : "false"}
          aria-haspopup="listbox"
          aria-controls="tb-trend-window-listbox"
          onClick={() => setIsOpen((current) => !current)}
          onKeyDown={(event) => {
            switch (event.key) {
              case "ArrowDown":
                event.preventDefault();
                if (!isOpen) {
                  setIsOpen(true);
                  return;
                }
                focusOptionByOffset(value, 1);
                return;
              case "ArrowUp":
                event.preventDefault();
                if (!isOpen) {
                  setIsOpen(true);
                  return;
                }
                focusOptionByOffset(value, -1);
                return;
              case "Enter":
              case " ":
                event.preventDefault();
                if (!isOpen) {
                  setIsOpen(true);
                }
                return;
              default:
                return;
            }
          }}
        >
          <span id="tb-trend-window-value" className="tb-topbar-trend-window-value">
            {formatTrendWindowLabel(value)}
          </span>
          <span className={`tb-topbar-trend-window-chevron${isOpen ? " is-open" : ""}`} aria-hidden="true"></span>
        </button>

        {isOpen ? (
          <div
            id="tb-trend-window-listbox"
            className="tb-topbar-trend-window-menu"
            role="listbox"
            aria-label="Trend Window options"
          >
            {TREND_WINDOW_OPTIONS.map((optionValue) => {
              const selected = optionValue === value;
              return (
                <button
                  key={optionValue}
                  id={`tb-trend-window-option-${optionValue}`}
                  ref={(node) => {
                    optionRefs.current[optionValue] = node;
                  }}
                  type="button"
                  role="option"
                  className={`tb-topbar-trend-window-option${selected ? " is-selected" : ""}`}
                  aria-selected={selected ? "true" : "false"}
                  onClick={() => selectValue(optionValue)}
                  onKeyDown={(event) => {
                    switch (event.key) {
                      case "ArrowDown":
                        event.preventDefault();
                        focusOptionByOffset(optionValue, 1);
                        return;
                      case "ArrowUp":
                        event.preventDefault();
                        focusOptionByOffset(optionValue, -1);
                        return;
                      case "Home":
                        event.preventDefault();
                        focusOption(TREND_WINDOW_OPTIONS[0]);
                        return;
                      case "End":
                        event.preventDefault();
                        focusOption(TREND_WINDOW_OPTIONS[TREND_WINDOW_OPTIONS.length - 1]);
                        return;
                      case "Enter":
                      case " ":
                        event.preventDefault();
                        selectValue(optionValue);
                        return;
                      default:
                        return;
                    }
                  }}
                >
                  <span>{formatTrendWindowLabel(optionValue)}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function InitiativeViewDropdown({ views, activeViewId, onChange }: InitiativeViewDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const activeView = views.find((view) => view.id === activeViewId) ?? views[0] ?? DEFAULT_INITIATIVE_TOPBAR_STATE.views[0];

  const viewKey = (viewId: number | "all") => String(viewId);

  const focusOption = (viewId: number | "all") => {
    optionRefs.current[viewKey(viewId)]?.focus();
  };

  const focusOptionByOffset = (viewId: number | "all", offset: number) => {
    const currentIndex = views.findIndex((view) => view.id === viewId);
    if (currentIndex < 0) return;
    const nextIndex = Math.min(Math.max(currentIndex + offset, 0), views.length - 1);
    const nextView = views[nextIndex];
    if (nextView) {
      focusOption(nextView.id);
    }
  };

  const closeMenu = () => {
    setIsOpen(false);
  };

  const selectView = (viewId: number | "all") => {
    if (viewId !== activeViewId) {
      onChange(viewId);
    }
    closeMenu();
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!isOpen) return undefined;

    const handlePointerDown = (event: MouseEvent) => {
      if (dropdownRef.current?.contains(event.target as Node)) return;
      closeMenu();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeMenu();
      triggerRef.current?.focus();
    };

    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    optionRefs.current[String(activeView.id)]?.focus();
  }, [activeView.id, isOpen]);

  return (
    <div className="tb-initiative-view-select tb-topbar-initiative-view tb-no-print">
      <span id="tb-initiative-view-label">Select View</span>
      <div className="tb-initiative-view-dropdown" ref={dropdownRef}>
        <button
          ref={triggerRef}
          type="button"
          className={`tb-initiative-view-trigger${isOpen ? " is-open" : ""}`}
          role="combobox"
          aria-labelledby="tb-initiative-view-label"
          aria-describedby="tb-initiative-view-value"
          aria-expanded={isOpen ? "true" : "false"}
          aria-haspopup="listbox"
          aria-controls="tb-initiative-view-listbox"
          onClick={() => setIsOpen((current) => !current)}
          onKeyDown={(event) => {
            switch (event.key) {
              case "ArrowDown":
                event.preventDefault();
                if (!isOpen) {
                  setIsOpen(true);
                  return;
                }
                focusOptionByOffset(activeView.id, 1);
                return;
              case "ArrowUp":
                event.preventDefault();
                if (!isOpen) {
                  setIsOpen(true);
                  return;
                }
                focusOptionByOffset(activeView.id, -1);
                return;
              case "Enter":
              case " ":
                event.preventDefault();
                if (!isOpen) {
                  setIsOpen(true);
                }
                return;
              default:
                return;
            }
          }}
        >
          <span id="tb-initiative-view-value" className="tb-initiative-view-value">
            {formatInitiativeViewOption(activeView)}
          </span>
          <span className={`tb-initiative-view-chevron${isOpen ? " is-open" : ""}`} aria-hidden="true"></span>
        </button>

        {isOpen ? (
          <div
            id="tb-initiative-view-listbox"
            className="tb-initiative-view-menu"
            role="listbox"
            aria-label="Initiative View options"
          >
            {views.map((view) => {
              const selected = view.id === activeView.id;
              return (
                <button
                  key={String(view.id)}
                  id={`tb-initiative-view-option-${String(view.id)}`}
                  ref={(node) => {
                    optionRefs.current[viewKey(view.id)] = node;
                  }}
                  type="button"
                  role="option"
                  className={`tb-initiative-view-option${selected ? " is-selected" : ""}`}
                  aria-selected={selected ? "true" : "false"}
                  onClick={() => selectView(view.id)}
                  onKeyDown={(event) => {
                    switch (event.key) {
                      case "ArrowDown":
                        event.preventDefault();
                        focusOptionByOffset(view.id, 1);
                        return;
                      case "ArrowUp":
                        event.preventDefault();
                        focusOptionByOffset(view.id, -1);
                        return;
                      case "Home":
                        event.preventDefault();
                        focusOption(views[0]?.id ?? "all");
                        return;
                      case "End":
                        event.preventDefault();
                        focusOption(views[views.length - 1]?.id ?? "all");
                        return;
                      case "Enter":
                      case " ":
                        event.preventDefault();
                        selectView(view.id);
                        return;
                      default:
                        return;
                    }
                  }}
                >
                  <span>{formatInitiativeViewOption(view)}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function Content({ appName }: Props) {
  const [active, setActive] = useState<ScreenId>("integrations");
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);
  const [teamTrendWindowSelection, setTeamTrendWindowSelection] = useState<number>(12);
  const [initiativeTopbarState, setInitiativeTopbarState] = useState<InitiativeTopbarState>(
    DEFAULT_INITIATIVE_TOPBAR_STATE,
  );
  const heading = useMemo(() => screenTitle(active), [active]);

  const updateTeamTrendWindowSelection = (nextValue: number) => {
    setTeamTrendWindowSelection(nextValue);
    window.dispatchEvent(new CustomEvent(TEAM_INSIGHTS_TREND_WINDOW_CHANGE_EVENT, {
      detail: { trendWindow: nextValue },
    }));
  };

  const updateInitiativeViewSelection = (nextViewId: number | "all") => {
    setInitiativeTopbarState((current) => ({
      ...current,
      activeViewId: nextViewId,
    }));
    window.dispatchEvent(new CustomEvent(SET_INITIATIVES_ACTIVE_VIEW_EVENT, {
      detail: { viewId: nextViewId },
    }));
  };

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

  useEffect(() => {
    const handleInitiativeViewState = (event: Event) => {
      const detail = (event as CustomEvent<Partial<InitiativeTopbarState>>).detail;
      const views = Array.isArray(detail?.views) && detail.views.length > 0
        ? detail.views
        : DEFAULT_INITIATIVE_TOPBAR_STATE.views;
      const activeViewId = detail?.activeViewId === "all" || typeof detail?.activeViewId === "number"
        ? detail.activeViewId
        : DEFAULT_INITIATIVE_TOPBAR_STATE.activeViewId;
      setInitiativeTopbarState({ views, activeViewId });
    };
    window.addEventListener(INITIATIVES_VIEW_STATE_EVENT, handleInitiativeViewState as EventListener);
    return () => {
      window.removeEventListener(INITIATIVES_VIEW_STATE_EVENT, handleInitiativeViewState as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!isSidebarExpanded) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsSidebarExpanded(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isSidebarExpanded]);

  return (
    <div className={`tb-app-frame${isSidebarExpanded ? " is-nav-expanded" : ""}`}>
      <header className="tb-app-header">
        <div className="tb-app-header-start">
          <button
            type="button"
            className="tb-sidebar-toggle"
            aria-controls="tb-primary-sidebar"
            aria-expanded={isSidebarExpanded}
            aria-label={isSidebarExpanded ? "Collapse navigation" : "Expand navigation"}
            title={isSidebarExpanded ? "Collapse navigation" : "Expand navigation"}
            onClick={() => setIsSidebarExpanded((current) => !current)}
          >
            {isSidebarExpanded ? (
              <>
                <PanelLeftClose
                  className="tb-sidebar-toggle-desktop-icon"
                  aria-hidden="true"
                  strokeWidth={2}
                />
                <X className="tb-sidebar-toggle-mobile-icon" aria-hidden="true" strokeWidth={2} />
              </>
            ) : (
              <Menu aria-hidden="true" strokeWidth={2} />
            )}
          </button>
          <div className="tb-app-header-brand">
            <div className="tb-app-header-brand-lockup">
              <p>{appName}</p>
              <small>Illuminating Engineering Insights</small>
            </div>
            <h1>Manager Console</h1>
          </div>
        </div>
        <div className="tb-app-header-end">
          <SystemStatusControl />
        </div>
      </header>

      <aside
        id="tb-primary-sidebar"
        className={`tb-sidebar${isSidebarExpanded ? " is-expanded" : ""}`}
      >
        <nav className="tb-nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`tb-nav-item${active === item.id ? " is-active" : ""}`}
              aria-label={`${item.label}: ${item.blurb}`}
              data-tooltip={item.label}
              onClick={() => setActive(item.id)}
            >
              <item.icon className="tb-nav-icon" aria-hidden="true" strokeWidth={1.8} />
              <div className="tb-nav-copy">
                <div className="tb-nav-title-row">
                  <span className="tb-nav-title">{item.label}</span>
                </div>
                <small>{item.blurb}</small>
              </div>
              {item.showConstruction ? (
                <span
                  className="tb-nav-construction"
                  title="Under construction"
                  aria-label={`${item.label} is under construction`}
                >
                  <span aria-hidden="true">•</span>
                </span>
              ) : null}
            </button>
          ))}
        </nav>
      </aside>

      <main className={`tb-main tb-main-${active}`}>
        <header className="tb-topbar">
          <div className="tb-topbar-title">
            <h2>{heading}</h2>
          </div>
          {active === "initiatives" ? (
            <div className="tb-topbar-actions tb-topbar-actions-initiative">
              <InitiativeViewDropdown
                views={initiativeTopbarState.views}
                activeViewId={initiativeTopbarState.activeViewId}
                onChange={updateInitiativeViewSelection}
              />
              <button
                type="button"
                className="tb-btn tb-btn-sm tb-no-print"
                onClick={() => window.dispatchEvent(new CustomEvent(OPEN_INITIATIVES_MANAGE_VIEW_EVENT))}
              >
                Manage View
              </button>
              <button
                type="button"
                className="tb-btn tb-btn-sm tb-no-print"
                onClick={() => window.dispatchEvent(new CustomEvent(OPEN_INITIATIVES_CONFIGURE_EVENT))}
              >
                Configure Initiative
              </button>
            </div>
          ) : null}
          {active === "team" ? (
            <div className="tb-topbar-actions">
              <TrendWindowDropdown
                value={teamTrendWindowSelection}
                onChange={updateTeamTrendWindowSelection}
              />
              <button
                type="button"
                className="tb-btn tb-btn-sm tb-no-print"
                aria-label="Team Insights Settings"
                onClick={() => window.dispatchEvent(new CustomEvent(OPEN_TEAM_INSIGHTS_SETTINGS_EVENT))}
              >
                Settings
              </button>
            </div>
          ) : null}
          {active === "executive" ? (
            <div className="tb-topbar-actions">
              <button
                type="button"
                className="tb-btn tb-btn-sm tb-no-print"
                onClick={() => window.dispatchEvent(new CustomEvent(OPEN_TEAM_DASHBOARD_REPORTING_PERIOD_EVENT))}
              >
                Reporting Period
              </button>
              <button
                type="button"
                className="tb-btn tb-btn-sm tb-no-print"
                onClick={() => window.dispatchEvent(new CustomEvent(OPEN_TEAM_DASHBOARD_INITIATIVE_CONFIG_EVENT))}
              >
                Configure Initiatives
              </button>
              <button
                type="button"
                className="tb-btn tb-btn-sm tb-no-print"
                onClick={() => window.dispatchEvent(new CustomEvent(EXPORT_TEAM_DASHBOARD_HTML_EVENT))}
              >
                Export Dashboard
              </button>
            </div>
          ) : null}
        </header>
        <section className="tb-screen-body">{renderScreen(active)}</section>
      </main>
    </div>
  );
}
