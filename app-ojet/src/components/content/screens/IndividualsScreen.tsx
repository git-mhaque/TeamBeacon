import { h } from "preact";

const RECENT_WORK = [
  "CEG-8451 Closed - API idempotency fix",
  "CEG-8467 In Progress - rollback policy update",
  "CEG-8429 Closed - incident follow-up action",
  "CEG-8408 Closed - release guardrail checks",
];

export function IndividualsScreen() {
  return (
    <div class="tb-screen-grid">
      <section class="tb-panel">
        <header class="tb-panel-header">
          <div>
            <h3>Individual Activity</h3>
            <p>Alias-based team member activity for configurable time windows.</p>
          </div>
          <span class="tb-chip">Selected: SE 1</span>
        </header>
        <div class="tb-metrics-grid tb-three-up">
          <article class="tb-metric-card">
            <h4>Completed (7d)</h4>
            <strong class="tb-value tb-value-good">11</strong>
            <p>Feature + ops + bug work items.</p>
          </article>
          <article class="tb-metric-card">
            <h4>In Progress</h4>
            <strong class="tb-value">4</strong>
            <p>2 feature, 1 bug, 1 ops task.</p>
          </article>
          <article class="tb-metric-card">
            <h4>Median Cycle</h4>
            <strong class="tb-value tb-value-good">3.7 d</strong>
            <p>Lower than team median this week.</p>
          </article>
        </div>
      </section>

      <section class="tb-panel">
        <header class="tb-panel-header">
          <div>
            <h3>Recent Work Timeline</h3>
            <p>Most recent work item transitions for selected alias.</p>
          </div>
        </header>
        <ul class="tb-list">
          {RECENT_WORK.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section class="tb-panel">
        <header class="tb-panel-header">
          <div>
            <h3>Manager Insight</h3>
            <p>Early warning signal for rebalancing ownership.</p>
          </div>
        </header>
        <div class="tb-summary">
          SE 1 has elevated interruption load from incident follow-ups. Rebalance incident action
          items toward SE 2 and SE 3 to protect initiative-critical throughput next sprint.
        </div>
      </section>
    </div>
  );
}

