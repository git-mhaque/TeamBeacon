import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Activity,
  ChartNoAxesCombined,
  FileChartColumn,
  LayoutDashboard,
  ListChecks,
  Rocket,
  Settings,
  ShieldCheck,
  Target,
  UsersRound,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export type ScreenId =
  | "dashboard"
  | "integrations"
  | "initiatives"
  | "initiative-deep-dive"
  | "team"
  | "sprint"
  | "security"
  | "incidents"
  | "releases"
  | "team-report";

type NavItem = {
  id: ScreenId;
  label: string;
  shortLabel: string;
  blurb: string;
  construction?: boolean;
  icon: LucideIcon;
};

const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: "Team Dashboard", shortLabel: "Dashboard", blurb: "Delivery overview", icon: LayoutDashboard },
  { id: "initiatives", label: "Initiative Insights", shortLabel: "Initiatives", blurb: "Epic progress & RAG", icon: Target },
  { id: "initiative-deep-dive", label: "Initiative Deep Dive", shortLabel: "Deep dive", blurb: "New, active & completed work", icon: ChartNoAxesCombined },
  { id: "sprint", label: "Sprint Insights", shortLabel: "Sprints", blurb: "Progress, scope & blockers", icon: ListChecks },
  { id: "team", label: "Team Insights", shortLabel: "Team", blurb: "Trends & cycle time", icon: UsersRound },
  { id: "security", label: "Security Insights", shortLabel: "Security", blurb: "Vulnerability posture", construction: true, icon: ShieldCheck },
  { id: "incidents", label: "Operations Insights", shortLabel: "Operations", blurb: "Incidents & observability", construction: true, icon: Activity },
  { id: "releases", label: "Release Insights", shortLabel: "Releases", blurb: "Readiness & release risk", icon: Rocket },
  { id: "team-report", label: "Team Report", shortLabel: "Report", blurb: "Wins, risks & work mix", icon: FileChartColumn },
];

const SETTINGS_ITEM: NavItem = {
  id: "integrations", label: "Settings", shortLabel: "Settings", blurb: "Work streams & configuration", icon: Settings,
};

type Tooltip = {
  item: NavItem;
  anchor: HTMLButtonElement;
  top: number;
  left: number;
};

type Props = {
  active: ScreenId;
  isExpanded: boolean;
  onNavigate: (screen: ScreenId) => void;
};

export function PrimaryNavigation({ active, isExpanded, onNavigate }: Props) {
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const hideTimer = useRef<number | undefined>(undefined);
  const cancelHide = useCallback(() => window.clearTimeout(hideTimer.current), []);

  useEffect(() => {
    cancelHide();
    setTooltip(null);
  }, [isExpanded, cancelHide]);

  useEffect(() => cancelHide, [cancelHide]);

  useEffect(() => {
    if (!tooltip) return;
    const dismiss = () => setTooltip(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [tooltip]);

  function showTooltip(item: NavItem, anchor: HTMLButtonElement) {
    cancelHide();
    if (isExpanded) return;
    const rect = anchor.getBoundingClientRect();
    setTooltip({
      item,
      anchor,
      top: Math.min(Math.max(rect.top + rect.height / 2, 64), window.innerHeight - 64),
      left: rect.right,
    });
  }

  function scheduleHide() {
    cancelHide();
    hideTimer.current = window.setTimeout(() => setTooltip(null), 120);
  }

  function renderItem(item: NavItem) {
    return (
      <button
        key={item.id}
        type="button"
        className={`tb-nav-item${active === item.id ? " is-active" : ""}`}
        aria-label={`${item.label}: ${item.blurb}${item.construction ? "; under construction" : ""}`}
        aria-current={active === item.id ? "page" : undefined}
        aria-describedby={tooltip?.item.id === item.id ? `tb-nav-tooltip-${item.id}` : undefined}
        onClick={() => {
          cancelHide();
          setTooltip(null);
          onNavigate(item.id);
        }}
        onPointerEnter={(event) => {
          if (event.pointerType !== "touch") showTooltip(item, event.currentTarget);
        }}
        onPointerLeave={(event) => {
          if (document.activeElement !== event.currentTarget) scheduleHide();
        }}
        onFocus={(event) => showTooltip(item, event.currentTarget)}
        onBlur={scheduleHide}
      >
        <item.icon className="tb-nav-icon" aria-hidden="true" strokeWidth={2} />
        <span className="tb-nav-short-label" aria-hidden="true">{item.shortLabel}</span>
        <span className="tb-nav-copy" aria-hidden="true">
          <span className="tb-nav-title">{item.label}</span>
          {item.construction ? (
            <span className="tb-nav-construction-label"><Wrench aria-hidden="true" />Under construction</span>
          ) : <small>{item.blurb}</small>}
        </span>
        {item.construction ? (
          <span className="tb-nav-construction" aria-hidden="true"><Wrench /></span>
        ) : null}
      </button>
    );
  }

  return (
    <aside id="tb-primary-sidebar" className={`tb-sidebar${isExpanded ? " is-expanded" : ""}`}>
      <nav className="tb-nav" aria-label="Primary navigation">
        <div className="tb-nav-list">{NAV_ITEMS.map(renderItem)}</div>
        <div className="tb-nav-footer">{renderItem(SETTINGS_ITEM)}</div>
      </nav>
      {!isExpanded && tooltip ? createPortal(
        <div
          className="tb-nav-tooltip-layer tb-no-print"
          style={{ top: tooltip.top, left: tooltip.left, maxWidth: `calc(100vw - ${tooltip.left + 12}px)` }}
          onPointerEnter={cancelHide}
          onPointerLeave={() => {
            if (document.activeElement !== tooltip.anchor) scheduleHide();
          }}
        >
          <div role="tooltip" id={`tb-nav-tooltip-${tooltip.item.id}`} className="tb-nav-tooltip">
            <strong>{tooltip.item.label}</strong>
            <span>{tooltip.item.blurb}</span>
            {tooltip.item.construction ? <span className="tb-nav-tooltip-status"><Wrench aria-hidden="true" />Under construction</span> : null}
          </div>
        </div>,
        document.body,
      ) : null}
    </aside>
  );
}
