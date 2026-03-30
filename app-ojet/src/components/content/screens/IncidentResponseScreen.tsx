import { h } from "preact";

export function IncidentResponseScreen() {
  return (
    <div class="tb-screen-grid">
      <section class="tb-panel">
        <header class="tb-panel-header">
          <div>
            <h3>Incident Operations</h3>
            <p>Incident volume, MTTR, and ownership signals.</p>
          </div>
          <span class="tb-chip">Baseline</span>
        </header>
        <div class="tb-metrics-grid tb-three-up">
          <article class="tb-metric-card">
            <h4>Active Incidents</h4>
            <strong class="tb-value">--</strong>
            <p>Live incident feed is not connected.</p>
          </article>
          <article class="tb-metric-card">
            <h4>MTTR (30d)</h4>
            <strong class="tb-value">--</strong>
            <p>Computed once historical data is imported.</p>
          </article>
          <article class="tb-metric-card">
            <h4>SLA Breaches</h4>
            <strong class="tb-value">--</strong>
            <p>On-call policy mapping is pending.</p>
          </article>
        </div>
      </section>

      <section class="tb-panel">
        <header class="tb-panel-header">
          <div>
            <h3>Next Step</h3>
            <p>Connect incident systems to activate this screen.</p>
          </div>
        </header>
        <div class="tb-summary">
          TeamBeacon will populate incident lifecycle metrics, response latency, and follow-up
          closure trends after integration setup.
        </div>
      </section>
    </div>
  );
}
