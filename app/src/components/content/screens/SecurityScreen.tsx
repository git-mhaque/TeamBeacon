import { h } from "preact";

export function SecurityScreen() {
  return (
    <div class="tb-screen-grid">
      <section class="tb-panel">
        <header class="tb-panel-header">
          <div>
            <h3>Security Posture Snapshot</h3>
            <p>Vulnerability trends, SLA posture, and remediation throughput.</p>
          </div>
          <span class="tb-chip">Baseline</span>
        </header>
        <div class="tb-metrics-grid tb-three-up">
          <article class="tb-metric-card">
            <h4>Open Vulnerabilities</h4>
            <strong class="tb-value">--</strong>
            <p>Data source integration pending.</p>
          </article>
          <article class="tb-metric-card">
            <h4>SLA At Risk</h4>
            <strong class="tb-value">--</strong>
            <p>Policy mapping not configured yet.</p>
          </article>
          <article class="tb-metric-card">
            <h4>Remediation Throughput</h4>
            <strong class="tb-value">--</strong>
            <p>Historical trend appears after sync.</p>
          </article>
        </div>
      </section>

      <section class="tb-panel">
        <header class="tb-panel-header">
          <div>
            <h3>Next Step</h3>
            <p>Connect security data feeds to activate this dashboard.</p>
          </div>
        </header>
        <div class="tb-summary">
          Once security ingestion is configured, TeamBeacon will surface backlog aging, severity
          distribution, and breach-risk forecasts.
        </div>
      </section>
    </div>
  );
}
