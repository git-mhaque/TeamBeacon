import { MetricCard } from "../components/MetricCard";
import { Panel } from "../components/Panel";
import { StatusPill } from "../components/StatusPill";

export function IncidentResponseScreen() {
  return (
    <div className="screen-grid">
      <Panel
        title="Incident Operations"
        subtitle="Placeholder view for incident volume, MTTR, and ownership signals."
        action={<StatusPill tone="warn" text="Placeholder" />}
      >
        <div className="metrics-grid three-up">
          <MetricCard label="Active Incidents" value="--" hint="Live incident feed not connected." />
          <MetricCard label="MTTR (30d)" value="--" hint="Will compute after historical import." />
          <MetricCard label="SLA Breaches" value="--" hint="On-call policy mapping pending." />
        </div>
      </Panel>

      <Panel title="Next Step" subtitle="Connect incident systems to activate this screen.">
        <p className="summary">
          This screen is a placeholder. TeamBeacon will populate it with incident lifecycle metrics, response latency, and
          follow-up closure trends after integration setup.
        </p>
      </Panel>
    </div>
  );
}
