import { MetricCard } from "../components/MetricCard";
import { Panel } from "../components/Panel";
import { StatusPill } from "../components/StatusPill";

export function ExecutiveReportScreen() {
  return (
    <div className="screen-grid">
      <Panel
        title="Executive Summary Draft"
        subtitle="Generated summary of initiative progress and operational health since last report."
        action={<StatusPill tone="good" text="Ready to Export" />}
      >
        <p className="summary">
          Team delivered 74 story points (89% of commitment) and reduced median cycle time to 4.2 days. Payments Hardening reached
          64% completion but remains Amber due to blocker age and scope volatility. Incident MTTR improved 14% after release
          automation updates.
        </p>
      </Panel>

      <Panel title="Initiative Delta Since Last Report" subtitle="Concise progress statements for leadership consumption.">
        <ul className="list">
          <li>Payments Hardening: +9% completion, 2 new blockers opened.</li>
          <li>Release Automation: +6% completion, no new high risks.</li>
          <li>Security Burn: 12 remediations completed, backlog down 8%.</li>
        </ul>
      </Panel>

      <Panel title="Report Signals" subtitle="High-level confidence snapshot for final review.">
        <div className="metrics-grid three-up">
          <MetricCard label="Initiative RAG" value="2 Amber, 0 Red" hint="No critical red initiatives this week." tone="warn" />
          <MetricCard label="Open Risks" value="5" hint="Two SLA breaches require follow-up." tone="warn" />
          <MetricCard label="Export Bundle" value="Markdown + PDF" hint="Generated with report timestamp and baseline diff." tone="good" />
        </div>
      </Panel>
    </div>
  );
}

