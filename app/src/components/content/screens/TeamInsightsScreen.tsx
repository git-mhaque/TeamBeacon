import { h } from "preact";

export function TeamInsightsScreen() {
  return (
    <div class="tb-screen-grid">
      <section class="tb-panel">
        <header class="tb-panel-header">
          <div>
            <h3>Sprint Performance (Last 6 Sprints)</h3>
            <p>Committed/completed trend and carryover pressure.</p>
          </div>
          <span class="tb-chip">Migrated</span>
        </header>
        <div class="tb-metrics-grid tb-four-up">
          <article class="tb-metric-card">
            <h4>Avg Committed</h4>
            <strong class="tb-value">83 SP</strong>
            <p>Across last six sprints.</p>
          </article>
          <article class="tb-metric-card">
            <h4>Avg Completed</h4>
            <strong class="tb-value tb-value-good">74 SP</strong>
            <p>Completion ratio: 89%.</p>
          </article>
          <article class="tb-metric-card">
            <h4>Median Cycle Time</h4>
            <strong class="tb-value">4.2 d</strong>
            <p>Includes ops and security tickets.</p>
          </article>
          <article class="tb-metric-card">
            <h4>Carryover</h4>
            <strong class="tb-value tb-value-warn">11%</strong>
            <p>Target is &lt;= 10%.</p>
          </article>
        </div>
      </section>

      <section class="tb-panel">
        <header class="tb-panel-header">
          <div>
            <h3>Sprint Trend Bars</h3>
            <p>Relative completion ratio snapshot per sprint.</p>
          </div>
        </header>
        <div class="tb-bars">
          <div class="tb-bar"><span style={{ width: "86%" }} /></div>
          <div class="tb-bar"><span style={{ width: "90%" }} /></div>
          <div class="tb-bar"><span style={{ width: "84%" }} /></div>
          <div class="tb-bar"><span style={{ width: "92%" }} /></div>
          <div class="tb-bar"><span style={{ width: "88%" }} /></div>
          <div class="tb-bar"><span style={{ width: "89%" }} /></div>
        </div>
      </section>

      <section class="tb-panel">
        <header class="tb-panel-header">
          <div>
            <h3>Work Mix and Capacity Signal</h3>
            <p>Delivery profile across feature, operations, and security remediations.</p>
          </div>
        </header>
        <div class="tb-summary">
          Work mix is currently Feature 58%, Ops 27%, Security 15%. Throughput remains stable;
          operations spikes correlate with carryover growth. Reserve protected capacity for
          security backlog burn to prevent SLA slippage.
        </div>
      </section>
    </div>
  );
}

