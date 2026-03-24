import { MetricCard } from "../components/MetricCard";
import { Panel } from "../components/Panel";

export function TeamInsightsScreen() {
  return (
    <div className="screen-grid">
      <Panel title="Sprint Performance (Last 6 Sprints)" subtitle="Committed/completed trend and carryover pressure.">
        <div className="metrics-grid four-up">
          <MetricCard label="Avg Committed" value="83 SP" hint="Across last six sprints." />
          <MetricCard label="Avg Completed" value="74 SP" hint="Completion ratio: 89%." tone="good" />
          <MetricCard label="Median Cycle Time" value="4.2 d" hint="Includes ops and security tickets." />
          <MetricCard label="Carryover" value="11%" hint="Target is <=10%." tone="warn" />
        </div>
      </Panel>

      <Panel title="Sprint Trend Bars" subtitle="Relative completion ratio snapshot per sprint.">
        <div className="bars">
          <div className="bar"><span style={{ width: "86%" }} /></div>
          <div className="bar"><span style={{ width: "90%" }} /></div>
          <div className="bar"><span style={{ width: "84%" }} /></div>
          <div className="bar"><span style={{ width: "92%" }} /></div>
          <div className="bar"><span style={{ width: "88%" }} /></div>
          <div className="bar"><span style={{ width: "89%" }} /></div>
        </div>
      </Panel>

      <Panel title="Work Mix and Capacity Signal" subtitle="Delivery profile across feature, operations, and security remediations.">
        <p className="summary">
          Work mix is currently Feature 58%, Ops 27%, Security 15%. Throughput remains stable; operations spikes correlate with
          carryover growth. Reserve protected capacity for security backlog burn to prevent SLA slippage.
        </p>
      </Panel>
    </div>
  );
}

