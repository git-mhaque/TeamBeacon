import { MetricCard } from "../components/MetricCard";
import { Panel } from "../components/Panel";
import { StatusPill } from "../components/StatusPill";

export function InitiativesScreen() {
  return (
    <div className="screen-grid">
      <Panel
        title="Initiative Health"
        subtitle="RAG and velocity indicators based on epic progress and risk signals."
        action={<StatusPill tone="warn" text="Amber: Payments Hardening" />}
      >
        <div className="metrics-grid four-up">
          <MetricCard label="RAG Score" value="72/100" hint="Scope volatility increased this week." tone="warn" />
          <MetricCard label="Epic Completion" value="64%" hint="+9% since previous report." tone="neutral" />
          <MetricCard label="Blockers > 5d" value="3" hint="Threshold is <= 2." tone="risk" />
          <MetricCard label="Cycle Trend" value="-18%" hint="Median cycle time is improving." tone="good" />
        </div>
      </Panel>

      <Panel title="Success Criteria Checklist" subtitle="Configurable criteria per initiative with weighted scoring.">
        <ul className="list">
          <li>
            Delivery trajectory above target velocity <StatusPill tone="good" text="Pass" />
          </li>
          <li>
            Due date confidence {"\u2265"} 80% <StatusPill tone="warn" text="At Risk" />
          </li>
          <li>
            Blocker SLA breaches {"\u2264"} 2 <StatusPill tone="risk" text="Fail" />
          </li>
          <li>
            Scope growth {"\u2264"} 12% <StatusPill tone="risk" text="Fail (18%)" />
          </li>
        </ul>
      </Panel>

      <Panel title="Generated Insight" subtitle="Narrative generated from configured rules and latest JIRA state.">
        <p className="summary">
          Progress is steady and throughput is improving, but open blockers and scope growth are reducing due-date confidence.
          Restrict additional scope intake this sprint and prioritize cross-team dependency clearance.
        </p>
      </Panel>
    </div>
  );
}
