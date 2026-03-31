import { h } from "preact";

export function ReleasesScreen() {
  return (
    <div class="tb-screen-grid">
      <section class="tb-panel">
        <header class="tb-panel-header">
          <div>
            <h3>Release Health</h3>
            <p>Deployment frequency, rollback rate, and release quality.</p>
          </div>
          <span class="tb-chip">Baseline</span>
        </header>
        <div class="tb-metrics-grid tb-three-up">
          <article class="tb-metric-card">
            <h4>Deployments (30d)</h4>
            <strong class="tb-value">--</strong>
            <p>SCM and release integration pending.</p>
          </article>
          <article class="tb-metric-card">
            <h4>Rollback Rate</h4>
            <strong class="tb-value">--</strong>
            <p>Computed from release event telemetry.</p>
          </article>
          <article class="tb-metric-card">
            <h4>Lead Time to Release</h4>
            <strong class="tb-value">--</strong>
            <p>Requires commit-to-production lineage.</p>
          </article>
        </div>
      </section>

      <section class="tb-panel">
        <header class="tb-panel-header">
          <div>
            <h3>Next Step</h3>
            <p>Configure release data sources for this dashboard.</p>
          </div>
        </header>
        <div class="tb-summary">
          After release telemetry is connected, TeamBeacon will provide deployment cadence,
          change-failure rate, and release confidence trend lines.
        </div>
      </section>
    </div>
  );
}
