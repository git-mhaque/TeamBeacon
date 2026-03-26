import { MetricCard } from "../components/MetricCard";
import { Panel } from "../components/Panel";
import { StatusPill } from "../components/StatusPill";

export function ReleasesScreen() {
  return (
    <div className="screen-grid">
      <Panel
        title="Release Health"
        subtitle="Placeholder view for deployment frequency, rollback rate, and release quality."
        action={<StatusPill tone="warn" text="Placeholder" />}
      >
        <div className="metrics-grid three-up">
          <MetricCard label="Deployments (30d)" value="--" hint="SCM/release integration pending." />
          <MetricCard label="Rollback Rate" value="--" hint="Will compute from release events." />
          <MetricCard label="Lead Time to Release" value="--" hint="Requires commit-to-prod lineage." />
        </div>
      </Panel>

      <Panel title="Next Step" subtitle="Configure release data sources for this dashboard.">
        <p className="summary">
          This screen is a placeholder. After release telemetry is connected, TeamBeacon will provide deployment cadence,
          change failure rate, and release confidence trend lines.
        </p>
      </Panel>
    </div>
  );
}
