import { MetricCard } from "../components/MetricCard";
import { Panel } from "../components/Panel";
import { StatusPill } from "../components/StatusPill";

export function IntegrationsScreen() {
  return (
    <div className="screen-grid">
      <Panel
        title="Source Connections"
        subtitle="Hosted Atlassian data source health and setup status."
        action={<StatusPill tone="good" text="2/2 Connected" />}
      >
        <div className="metrics-grid two-up">
          <MetricCard label="JIRA Connection" value="Connected" hint="PAT validated; project + board access confirmed." tone="good" />
          <MetricCard label="Confluence Connection" value="Connected" hint="Space reads enabled for initiative context pages." tone="good" />
        </div>
      </Panel>

      <Panel
        title="Field Mapping Readiness"
        subtitle="Track required custom fields before sync pipelines run."
        action={<StatusPill tone="warn" text="1 Missing Field" />}
      >
        <ul className="list">
          <li>
            Story Points <StatusPill tone="good" text="customfield_10004" />
          </li>
          <li>
            Sprint <StatusPill tone="good" text="auto-detected" />
          </li>
          <li>
            Epic Link <StatusPill tone="good" text="customfield_10014" />
          </li>
          <li>
            Cycle Start Date <StatusPill tone="warn" text="pending" />
          </li>
        </ul>
      </Panel>

      <Panel title="Alias Mapping" subtitle="Identity privacy mapping for individual views and executive exports.">
        <div className="chips">
          <span className="chip">SE 1 {"->"} 7cx91</span>
          <span className="chip">SE 2 {"->"} 4jb72</span>
          <span className="chip">SE 3 {"->"} 9gt15</span>
          <span className="chip">QA 1 {"->"} 3kp44</span>
          <span className="chip">SRE 1 {"->"} 8mf23</span>
        </div>
      </Panel>
    </div>
  );
}
