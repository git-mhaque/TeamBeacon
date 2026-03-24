import { MetricCard } from "../components/MetricCard";
import { Panel } from "../components/Panel";
import { StatusPill } from "../components/StatusPill";

const RECENT_WORK = [
  "CEG-8451 Closed - API idempotency fix",
  "CEG-8467 In Progress - rollback policy update",
  "CEG-8429 Closed - incident follow-up action",
  "CEG-8408 Closed - release guardrail checks"
];

export function IndividualsScreen() {
  return (
    <div className="screen-grid">
      <Panel
        title="Individual Activity"
        subtitle="Alias-based team member activity for configurable time windows."
        action={<StatusPill text="Selected: SE 1" />}
      >
        <div className="metrics-grid three-up">
          <MetricCard label="Completed (7d)" value="11" hint="Feature + ops + bug work items." tone="good" />
          <MetricCard label="In Progress" value="4" hint="2 feature, 1 bug, 1 ops task." />
          <MetricCard label="Median Cycle" value="3.7 d" hint="Lower than team median this week." tone="good" />
        </div>
      </Panel>

      <Panel title="Recent Work Timeline" subtitle="Most recent work item transitions for selected alias.">
        <ul className="list">
          {RECENT_WORK.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </Panel>

      <Panel title="Manager Insight" subtitle="Early warning signal for rebalancing ownership.">
        <p className="summary">
          SE 1 has elevated interruption load from incident follow-ups. Rebalance incident action items toward SE 2/SE 3 to protect
          initiative-critical throughput next sprint.
        </p>
      </Panel>
    </div>
  );
}

