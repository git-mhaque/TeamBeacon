import { useState, type MouseEvent } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronRight } from "lucide-react";
import { planDate, progressLabel, type DeliveryPlan } from "../../../lib/planner";

type Filter = "current" | "active" | "draft" | "completed" | "archived" | "attention";
type Sort = "updated" | "name" | "target" | "progress";
export function PlannerOverview({ plans, onOpen }: { plans: DeliveryPlan[]; onOpen: (plan: DeliveryPlan) => void }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("current");
  const [sort, setSort] = useState<Sort>("updated");
  const [descending, setDescending] = useState(true);
  const visible = plans.filter(plan =>
    (filter === "current" ? plan.status !== "archived"
      : filter === "attention" ? plan.status === "active" && plan.warnings.length > 0 : plan.status === filter)
    && `${plan.name} ${plan.owner} ${plan.objective}`.toLowerCase().includes(query.trim().toLowerCase()),
  ).sort((a, b) => {
    const left = sort === "progress" ? (a.metrics.available ? a.metrics.completionPercent : null)
      : sort === "target" ? a.targetDate : sort === "name" ? a.name : a.updatedAt;
    const right = sort === "progress" ? (b.metrics.available ? b.metrics.completionPercent : null)
      : sort === "target" ? b.targetDate : sort === "name" ? b.name : b.updatedAt;
    if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1;
    const order = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right));
    return order * (descending ? -1 : 1) || a.id - b.id;
  });
  const orderBy = (value: Sort) => {
    setSort(value); setDescending(value === sort ? !descending : value === "updated");
  };
  const sortHeading = (value: Sort, label: string) => <th scope="col" aria-sort={sort === value ? descending ? "descending" : "ascending" : "none"}>
    <button type="button" onClick={() => orderBy(value)}>{label}{sort !== value ? <ArrowUpDown size={14} /> : descending ? <ArrowDown size={14} /> : <ArrowUp size={14} />}</button>
  </th>;
  const open = (event: MouseEvent<HTMLAnchorElement>, plan: DeliveryPlan) => {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); onOpen(plan);
  };
  return <div className="tb-planner-overview">
    <div className="tb-planner-portfolio-summary" role="group" aria-label="All plans summary">
      {([
        ["active", "Active plans", "Delivery in progress", plans.filter(plan => plan.status === "active").length],
        ["draft", "Draft plans", "Plans being prepared", plans.filter(plan => plan.status === "draft").length],
        ["attention", "Needs attention", "Active plans with planning warnings", plans.filter(plan => plan.status === "active" && plan.warnings.length > 0).length],
      ] as const).map(([value, label, hint, count]) => <button type="button" key={value}
        className={`tb-planner-summary-card${value === "attention" && count ? " has-warnings" : ""}`}
        aria-label={`${label} ${count}: ${hint}`} aria-pressed={filter === value} onClick={() => { setQuery(""); setFilter(filter === value ? "current" : value); }}>
        <span>{label}</span><strong>{count}</strong><small>{hint}</small>
      </button>)}
    </div>
    <section className="tb-planner-plan-list" aria-labelledby="planner-plans-heading">
      <div className="tb-planner-list-heading"><h2 id="planner-plans-heading">Delivery plans <span>{visible.length}</span></h2><span className="tb-planner-muted">Select a plan to open its workspace</span></div>
      <div className="tb-planner-list-filters">
        <label>Search plans<input type="search" placeholder="Plan name, owner, or objective" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <label>Plan status<select value={filter} onChange={event => setFilter(event.target.value as Filter)}>
          <option value="current">All non-archived</option><option value="active">Active</option><option value="draft">Draft</option>
          <option value="completed">Completed</option><option value="archived">Archived</option><option value="attention">Needs attention</option>
        </select></label>
        <button type="button" disabled={!query && filter === "current"} onClick={() => { setQuery(""); setFilter("current"); }}>Clear filters</button>
      </div>
      {!plans.length ? <div className="tb-planner-empty"><h3>Your delivery plans start here</h3><p>No saved plans yet. Choose New plan to add epics and schedule delivery.</p></div>
        : !visible.length ? <div className="tb-planner-empty" role="status"><h3>No matching plans</h3><p>Try another search or clear your filters.</p></div>
          : <div className="tb-planner-table-scroll" tabIndex={0} role="region" aria-label="Delivery plans table">
            <table className="tb-planner-plan-table">
              <caption className="tb-visually-hidden">Delivery plans and their saved scope progress</caption>
              <thead><tr>{sortHeading("name", "Plan")}<th scope="col">Status</th>{sortHeading("progress", "Scope progress")}<th scope="col">Scope</th>{sortHeading("target", "Target")}<th scope="col">Attention</th>{sortHeading("updated", "Updated")}</tr></thead>
              <tbody>{visible.map(plan => <tr key={plan.id} onClick={event => {
                if ((event.target as Element).closest("a") || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.currentTarget.querySelector<HTMLAnchorElement>("a")!.focus({ preventScroll: true }); onOpen(plan);
              }}>
                <td><a href={`#planner/${plan.id}`} onClick={event => open(event, plan)}>{plan.name}<ChevronRight size={16} aria-hidden="true" /></a><small>{plan.owner || "No owner"}</small></td>
                <td><span className={`tb-planner-status is-${plan.status}`}>{plan.status}</span></td>
                <td><div className="tb-planner-table-progress">
                  <strong>{progressLabel(plan.metrics)}</strong>
                  {plan.metrics.available && plan.metrics.completionPercent !== null && <progress aria-label={`${plan.name} scope complete`} max={100} value={plan.metrics.completionPercent} />}
                  <small>{plan.metrics.available ? `${plan.metrics.completedCards}/${plan.metrics.totalCards} cards` : "Source data incomplete"}</small>
                </div></td>
                <td><span>{plan.epics.length} epics</span><small>{plan.tracks.length} tracks</small></td>
                <td className="tb-planner-table-date">{planDate(plan.targetDate)}</td>
                <td>{plan.warnings.length ? <span className="tb-planner-warning-count">{plan.warnings.length} {plan.warnings.length === 1 ? "warning" : "warnings"}</span> : <span className="tb-planner-muted">No warnings</span>}</td>
                <td className="tb-planner-table-date">{planDate(plan.updatedAt.slice(0, 10))}</td>
              </tr>)}</tbody>
            </table>
          </div>}
    </section>
  </div>;
}
