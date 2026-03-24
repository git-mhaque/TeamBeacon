import { Panel } from "../components/Panel";

const DONE = [
  "CEG-8464 - audit log compression",
  "CEG-8451 - idempotency patch",
  "CEG-8432 - alert threshold tuning"
];

const IN_PROGRESS = [
  "CEG-8478 - release guard automation",
  "CEG-8483 - failed deploy triage",
  "CEG-8491 - security fix rollout"
];

const PLANNED = [
  "CEG-8504 - canary expansion",
  "CEG-8508 - flaky test stabilization",
  "CEG-8510 - runbook consolidation"
];

function WorkColumn({ title, items }: { title: string; items: string[] }) {
  return (
    <article className="work-column">
      <h4>{title}</h4>
      {items.map((item) => (
        <p key={item} className="ticket">
          {item}
        </p>
      ))}
    </article>
  );
}

export function SprintBoardScreen() {
  return (
    <div className="screen-grid">
      <Panel title="Current Sprint Work" subtitle="Done, in-progress, and planned items for active sprint filter set.">
        <div className="kanban-grid">
          <WorkColumn title="Done (17)" items={DONE} />
          <WorkColumn title="In Progress (9)" items={IN_PROGRESS} />
          <WorkColumn title="Planned (12)" items={PLANNED} />
        </div>
      </Panel>
    </div>
  );
}

