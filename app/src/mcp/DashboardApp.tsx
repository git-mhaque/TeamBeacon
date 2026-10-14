import { useEffect, useRef, useState } from "react";
import type { DashboardBridge, DashboardEnvelope } from "./bridge";
import "./dashboard.css";

export function safeLink(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function displayDate(value: string | null | undefined, timezone: string, withTime = false): string {
  if (!value) return "unknown";
  try {
    return new Intl.DateTimeFormat("en-AU", { timeZone: timezone, dateStyle: "medium", ...(withTime ? { timeStyle: "short" as const } : {}) }).format(new Date(value));
  } catch { return value; }
}

export function DashboardApp({ bridge }: { bridge: DashboardBridge }) {
  const [result, setResult] = useState<DashboardEnvelope | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedStream, setSelectedStream] = useState<number | null>(null);
  const generation = useRef({ value: 0 });

  useEffect(() => {
    let active = true;
    const counter = generation.current;
    bridge.connect((value) => {
      if (active) { counter.value++; setResult(value); setError(null); setBusy(false); }
    }, (message) => { if (active) setError(message); })
      .catch(() => { if (active) setError("This view needs an MCP Apps-compatible host. You can still ask for the dashboard in chat."); });
    return () => { active = false; counter.value++; bridge.close(); };
  }, [bridge]);

  async function update(weeks: 1 | 4 | 12) {
    if (!result) return;
    const requestGeneration = ++generation.current.value;
    setBusy(true);
    setError(null);
    try {
      const next = await bridge.read({ ...result.appliedFilters, flow_weeks: weeks });
      if (generation.current.value === requestGeneration) setResult(next);
    }
    catch (failure) { if (generation.current.value === requestGeneration) setError((failure as Error).message); }
    finally { if (generation.current.value === requestGeneration) setBusy(false); }
  }

  async function open(value: string) {
    try { await bridge.openLink(value); }
    catch { setError("The host could not open that link. Open TeamBeacon in your browser."); }
  }

  const data = result?.dashboard;
  const streams = data?.workStreams.filter((stream) => selectedStream === null || stream.id === selectedStream);
  const uiUrl = safeLink(result?.uiUrl);
  const warnings = result?.warnings.filter((warning) => !/^Showing \d+ of \d+ items in a dashboard list\.$/.test(warning)) ?? [];

  return <main className="tb-mcp" aria-busy={busy}>
    <header className="tb-header">
      <div><div className="tb-eyebrow"><span className="tb-beacon" /> TEAMBEACON <span className="tb-badge">READ ONLY</span></div>
        <h1>Delivery at a glance</h1></div>
      {uiUrl && <button className="tb-link" onClick={() => void open(uiUrl)}>Open TeamBeacon ↗</button>}
    </header>
    {error && <div role="alert" className="tb-notice tb-error">{error}{data && " The previous view is still shown."}</div>}
    {!data && !error && <div role="status" className="tb-empty">Connecting to TeamBeacon…</div>}
    {data && result && <>
      <div className="tb-toolbar">
        <div role="group" aria-label="Flow window" className="tb-segment">
          {([1, 4, 12] as const).map((weeks) => <button key={weeks} disabled={busy}
            aria-pressed={data.flowPeriod.weeks === weeks} onClick={() => void update(weeks)}>{weeks} {weeks === 1 ? "week" : "weeks"}</button>)}
        </div>
        <label>Work stream <select value={selectedStream ?? "all"} onChange={(event) => setSelectedStream(event.target.value === "all" ? null : Number(event.target.value))}>
          <option value="all">All work streams</option>{data.workStreams.map((stream) => <option key={stream.id} value={stream.id}>{stream.name}</option>)}
        </select></label>
        <button className="tb-update" disabled={busy} onClick={() => void update(result.appliedFilters.flow_weeks)}>{busy ? "Updating…" : "Update view"}</button>
      </div>
      <div className="tb-context">
        <span>{data.flowPeriod.startDate ?? "Start unknown"} → {data.flowPeriod.endDate ?? "End unknown"} · {data.timezone}</span>
        <span>Source data: {data.dataAsOf ? displayDate(data.dataAsOf, data.timezone, true) : "freshness unknown"}</span>
      </div>
      {warnings.length > 0 && <div className="tb-notice" role="status">{warnings.map((warning, i) => <p key={i}>{warning}</p>)}</div>}
      <section aria-label="Work-stream progress">
        <div className="tb-section-heading"><h2>Work streams</h2><span>Flow in selected period · progress across current scope</span></div>
        {!streams?.length && <p className="tb-empty">No configured work streams in this view.</p>}
        <div className="tb-streams">{streams?.map((stream) => <article key={stream.id} className="tb-stream">
          <div className="tb-stream-title"><h3>{stream.name}</h3><span>{stream.epicCount} epics</span></div>
          <div className="tb-stream-progress">{data.errors.progress ? <p>Progress unavailable</p> : <><div className="tb-progress-caption"><strong>{stream.completionPercent}% complete</strong><span>{stream.totalCompletedCards} / {stream.totalCards} cards</span></div>
            <progress aria-label={`${stream.name} completion`} max={100} value={stream.completionPercent} /></>}</div>
          {stream.error ? <p className="tb-notice">Flow unavailable for this work stream.</p> : <dl className="tb-flow">
            <div><dt>Created</dt><dd>{stream.newCount}</dd></div><div><dt>Completed</dt><dd>{stream.completedCount}</dd></div>
            <div><dt>Net intake</dt><dd>{stream.netFlow > 0 ? "+" : ""}{stream.netFlow}</dd></div><div><dt>Current WIP</dt><dd>{stream.currentWipCount}</dd></div>
          </dl>}
        </article>)}</div>
      </section>
      <footer>Calculated {displayDate(data.generatedAt, data.timezone, true)} · Updating this view does not sync JIRA.</footer>
    </>}
  </main>;
}
