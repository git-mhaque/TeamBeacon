import { MetricCard } from "../components/MetricCard";
import { Panel } from "../components/Panel";
import { StatusPill } from "../components/StatusPill";

export function SecurityScreen() {
  return (
    <div className="screen-grid">
      <Panel
        title="Security Posture Snapshot"
        subtitle="Placeholder view for vulnerability trends, SLA posture, and remediation throughput."
        action={<StatusPill tone="warn" text="Placeholder" />}
      >
        <div className="metrics-grid three-up">
          <MetricCard label="Open Vulnerabilities" value="--" hint="Data source integration pending." />
          <MetricCard label="SLA At Risk" value="--" hint="Policy mapping not configured yet." />
          <MetricCard label="Remediation Throughput" value="--" hint="Historical trend will appear after sync." />
        </div>
      </Panel>

      <Panel title="Next Step" subtitle="Connect security data feeds to enable this dashboard.">
        <p className="summary">
          This screen is a placeholder. Once security data ingestion is configured, TeamBeacon will surface backlog aging,
          severity distribution, and breach-risk forecasts.
        </p>
      </Panel>
    </div>
  );
}
