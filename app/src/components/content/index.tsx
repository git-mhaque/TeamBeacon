/**
 * @license
 * Copyright (c) 2014, 2026, Oracle and/or its affiliates.
 * Licensed under The Universal Permissive License (UPL), Version 1.0
 * as shown at https://oss.oracle.com/licenses/upl/
 * @ignore
 */
import { h } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
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
  { id: "initiatives", label: "Initiative Insights", blurb: "Epic Config / Progress / RAG", showConstruction: false },
  { id: "sprint", label: "Sprint Insights", blurb: "Overview / Progress / Scope Creep / Blockers", showConstruction: false },
  { id: "team", label: "Team Insights", blurb: "Sprint Trend / Cycle Time", showConstruction: false },
  { id: "security", label: "Security Insights", blurb: "Scan / Vulnerability Posture", showConstruction: true },
  { id: "incidents", label: "Operations Insights", blurb: "Incidents / DR / Observability", showConstruction: true },
  { id: "releases", label: "Release Insights", blurb: "Cycle Time / Readiness / Risk", showConstruction: false },
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
    <div class="tb-topbar-trend-window">
      <span id="tb-trend-window-label">Trend Window</span>
      <div class="tb-topbar-trend-window-dropdown" ref={dropdownRef}>
        <button
          ref={triggerRef}
          type="button"
          class={`tb-topbar-trend-window-trigger${isOpen ? " is-open" : ""}`}
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
          <span id="tb-trend-window-value" class="tb-topbar-trend-window-value">
            {formatTrendWindowLabel(value)}
          </span>
          <span class={`tb-topbar-trend-window-chevron${isOpen ? " is-open" : ""}`} aria-hidden="true"></span>
        </button>

        {isOpen ? (
          <div
            id="tb-trend-window-listbox"
            class="tb-topbar-trend-window-menu"
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
                  class={`tb-topbar-trend-window-option${selected ? " is-selected" : ""}`}
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
    focusOption(activeView.id);
  }, [activeView.id, isOpen]);

  return (
    <div class="tb-initiative-view-select tb-topbar-initiative-view tb-no-print">
      <span id="tb-initiative-view-label">Select View</span>
      <div class="tb-initiative-view-dropdown" ref={dropdownRef}>
        <button
          ref={triggerRef}
          type="button"
          class={`tb-initiative-view-trigger${isOpen ? " is-open" : ""}`}
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
          <span id="tb-initiative-view-value" class="tb-initiative-view-value">
            {formatInitiativeViewOption(activeView)}
          </span>
          <span class={`tb-initiative-view-chevron${isOpen ? " is-open" : ""}`} aria-hidden="true"></span>
        </button>

        {isOpen ? (
          <div
            id="tb-initiative-view-listbox"
            class="tb-initiative-view-menu"
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
                  class={`tb-initiative-view-option${selected ? " is-selected" : ""}`}
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
          {active === "initiatives" ? (
            <div class="tb-topbar-actions tb-topbar-actions-initiative">
              <InitiativeViewDropdown
                views={initiativeTopbarState.views}
                activeViewId={initiativeTopbarState.activeViewId}
                onChange={updateInitiativeViewSelection}
              />
              <button
                type="button"
                class="tb-btn tb-btn-sm tb-no-print"
                onClick={() => window.dispatchEvent(new CustomEvent(OPEN_INITIATIVES_MANAGE_VIEW_EVENT))}
              >
                Manage View
              </button>
              <button
                type="button"
                class="tb-btn tb-btn-sm tb-no-print"
                onClick={() => window.dispatchEvent(new CustomEvent(OPEN_INITIATIVES_CONFIGURE_EVENT))}
              >
                Configure Initiative
              </button>
            </div>
          ) : null}
          {active === "team" ? (
            <div class="tb-topbar-actions">
              <TrendWindowDropdown
                value={teamTrendWindowSelection}
                onChange={updateTeamTrendWindowSelection}
              />
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
