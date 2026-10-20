import { useEffect, useId, useRef, useState } from "react";
import { progressLabel, type PlanDraft, type PlannerEpic } from "../../../lib/planner";

const DAY = 86400000;
const day = (value: string) => Date.parse(`${value}T00:00:00Z`) / DAY;
const label = (value: number) => new Date(value * DAY).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function PlannerTimeline({ plan, epics, selected, onSelect, baseline }: {
  plan: PlanDraft; epics: PlannerEpic[]; selected: string | null;
  onSelect: (key: string) => void; baseline: PlanDraft | null;
}) {
  const marker = useId().replace(/:/g, "");
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1120);
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const element = host.current!;
    const observer = new ResizeObserver(() => setWidth(Math.max(800, element.clientWidth)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const dates = [...plan.epics, ...(baseline?.epics ?? [])]
    .flatMap(epic => [epic.startDate, epic.endDate]).filter((value): value is string => Boolean(value));
  if (plan.targetDate) dates.push(plan.targetDate);
  if (baseline?.targetDate) dates.push(baseline.targetDate);
  const now = new Date();
  const today = day(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`);
  const values = dates.map(day).filter(Number.isFinite);
  const min = values.length ? Math.min(...values) - 2 : today - 2;
  const max = values.length ? Math.max(...values) + 3 : today + 28;
  const left = 270, right = 24, rowHeight = 82;
  const x = (value: string) => left + ((day(value) - min) / (max - min)) * (width - left - right);
  let cursor = 60;
  const rows = plan.tracks.map(track => {
    const top = cursor;
    cursor += 32;
    const items = plan.epics.filter(epic => epic.trackId === track.id).map(epic => {
      const y = cursor;
      cursor += rowHeight;
      return { epic, y };
    });
    if (!items.length) cursor += 32;
    return { track, top, items };
  });
  const positions = new Map(rows.flatMap(row => row.items.map(item => [item.epic.epicKey, item] as const)));
  const height = cursor + 16;
  return <div className="tb-planner-timeline-wrap">
    <div className="tb-planner-legend"><span>Solid: planned dates</span><span>Dashed: activation baseline</span><span>Arrows: finish → start</span></div>
    <div ref={host} className="tb-planner-timeline-scroll" tabIndex={0} aria-label="Delivery timeline, scroll horizontally to explore">
      <svg className="tb-planner-timeline" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="group" aria-label="Plan timeline">
        <defs><marker id={marker} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7" className="tb-planner-arrowhead" /></marker></defs>
        {[0, 1, 2, 3, 4].map(tick => {
          const value = min + ((max - min) * tick / 4);
          const at = left + ((width - left - right) * tick / 4);
          return <g key={tick}><line x1={at} x2={at} y1={45} y2={height} className="tb-planner-gridline" /><text x={at} y={28} textAnchor={tick === 4 ? "end" : "start"}>{label(value)}</text></g>;
        })}
        {today >= min && today <= max && <g><line x1={left + (today - min) / (max - min) * (width - left - right)} x2={left + (today - min) / (max - min) * (width - left - right)} y1={43} y2={height} className="tb-planner-today" /><text x={left + (today - min) / (max - min) * (width - left - right)} y={43}>Today</text></g>}
        {plan.targetDate && <g><line x1={x(plan.targetDate)} x2={x(plan.targetDate)} y1={45} y2={height} className="tb-planner-target" /><text x={x(plan.targetDate)} y={height - 3} textAnchor="end">Target</text></g>}
        {rows.map(({ track, top, items }) => <g key={track.id}>
          <text x={16} y={top + 16} className="tb-planner-track-label">{track.name}</text>
          {!items.length && <text x={left} y={top + 48}>No epics in this track</text>}
          {items.map(({ epic, y }) => {
            const source = epics.find(item => item.epicKey === epic.epicKey);
            const original = baseline?.epics.find(item => item.epicKey === epic.epicKey);
            const scheduled = epic.startDate && epic.endDate && epic.startDate <= epic.endDate;
            return <g key={epic.epicKey} className={`tb-planner-node${selected === epic.epicKey ? " is-selected" : ""}`}
              role="button" tabIndex={0} aria-label={`Edit ${epic.epicKey}${source ? `: ${source.title}` : ""}`}
              onClick={() => onSelect(epic.epicKey)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(epic.epicKey); } }}>
              <title>{source?.title ?? epic.epicKey} · {epic.startDate ?? "No start"} → {epic.endDate ?? "No finish"}</title>
              <rect x={6} y={y - 4} width={width - 12} height={rowHeight - 4} rx={6} className="tb-planner-row-hit" />
              <text x={16} y={y + 17} className="tb-planner-epic-key">{epic.epicKey} · {source ? progressLabel(source) : "Unavailable"}</text>
              <text x={16} y={y + 37}>{(source?.title ?? "Source unavailable").slice(0, 30)}{source && source.title.length > 30 ? "…" : ""}</text>
              {source && <text x={16} y={y + 57}>{source.completedCards}/{source.totalCards} cards · {source.status}</text>}
              {scheduled ? <rect x={x(epic.startDate!)} y={y + 12} width={Math.max(3, x(epic.endDate!) - x(epic.startDate!) + (width - left - right) / (max - min))} height={26} rx={4} className="tb-planner-schedule" /> : <text x={left + 12} y={y + 30}>Unscheduled / incomplete dates</text>}
              {original?.startDate && original.endDate && <line x1={x(original.startDate)} x2={x(original.endDate) + (width - left - right) / (max - min)} y1={y + 48} y2={y + 48} className="tb-planner-baseline" />}
              {source && source.available && source.completionPercent !== null && <g><rect x={16} y={y + 64} width={210} height={4} className="tb-planner-progress-track" /><rect x={16} y={y + 64} width={210 * source.completionPercent / 100} height={4} className="tb-planner-progress" /></g>}
            </g>;
          })}
        </g>)}
        <g className="tb-planner-edges" aria-label="Dependencies">
          {plan.epics.flatMap(epic => epic.dependsOn.map(key => {
            const from = positions.get(key), to = positions.get(epic.epicKey);
            if (!from?.epic.endDate || !to?.epic.startDate || !from.epic.startDate || !to.epic.endDate) return null;
            const start = x(from.epic.endDate) + (width - left - right) / (max - min), end = x(to.epic.startDate);
            const highlighted = selected === key || selected === epic.epicKey;
            return <path key={`${key}-${epic.epicKey}`} d={`M ${start} ${from.y + 25} C ${start + 24} ${from.y + 25}, ${end - 24} ${to.y + 25}, ${end} ${to.y + 25}`}
              className={`tb-planner-edge${highlighted ? " is-highlighted" : ""}`} markerEnd={`url(#${marker})`}><title>{key} must finish before {epic.epicKey} starts</title></path>;
          }))}
        </g>
      </svg>
    </div>
  </div>;
}
