import { useEffect, useRef, useState } from "react";
import { fetchPlanner, savePlan } from "../../../lib/api";
import { formatDisplayTimestamp } from "../../../lib/dateTime";
import { newPlan, planDraft, progressLabel, type DeliveryPlan, type PlanDraft, type PlanEpic, type PlannerInventory, type PlanStatus } from "../../../lib/planner";
import { PlannerTimeline } from "./PlannerTimeline";
import { PlannerEpicPicker } from "./PlannerEpicPicker";
import { PlannerEpicDetails } from "./PlannerEpicDetails";
import "../../../styles/planner.css";

export function PlannerScreen() {
  const [inventory, setInventory] = useState<PlannerInventory | null>(null);
  const [draft, setDraft] = useState<PlanDraft | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [editingEpic, setEditingEpic] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const mounted = useRef(false);
  const current = inventory?.plans.find(plan => plan.id === draft?.id);
  const dirty = Boolean(draft && (!current || JSON.stringify(draft) !== JSON.stringify(planDraft(current))));
  const choose = (plan: DeliveryPlan | null) => {
    setDraft(plan ? planDraft(plan) : newPlan());
    setSelected(null); setEditingEpic(null); setPickerOpen(false); setError(""); setMessage("");
  };
  const canLeave = () => !saving && (!dirty || window.confirm("Discard unsaved plan changes?"));
  const load = async (preferredId?: number) => {
    setLoading(true); setError("");
    try {
      const data = await fetchPlanner();
      if (!mounted.current) return;
      setInventory(data);
      const plan = data.plans.find(item => item.id === preferredId) ?? data.plans.find(item => item.status === "active") ?? data.plans[0];
      if (plan) choose(plan);
      else setDraft(null);
    } catch (err) { if (mounted.current) setError(err instanceof Error ? err.message : "Unable to load Planner."); }
    finally { if (mounted.current) setLoading(false); }
  };
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; };
    // Loading is triggered by mounting and by the explicit refresh action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!dirty && !saving) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const navigate = (event: Event) => {
      if (saving || !window.confirm("Discard unsaved plan changes?")) event.preventDefault();
    };
    window.addEventListener("beforeunload", unload);
    window.addEventListener("tb-before-navigation", navigate);
    return () => {
      window.removeEventListener("beforeunload", unload);
      window.removeEventListener("tb-before-navigation", navigate);
    };
  }, [dirty, saving]);
  const change = (patch: Partial<PlanDraft>) => {
    setDraft(previous => previous && { ...previous, ...patch }); setMessage("");
  };
  const updateEpic = (key: string, patch: Partial<PlanEpic>) => {
    if (draft) change({ epics: draft.epics.map(epic => epic.epicKey === key ? { ...epic, ...patch } : epic) });
  };
  const save = async () => {
    if (!draft) return;
    setSaving(true); setError(""); setMessage("");
    try {
      const result = await savePlan(draft);
      if (!mounted.current) return;
      setInventory(previous => previous && ({ ...previous, plans: [result, ...previous.plans.filter(plan => plan.id !== result.id)] }));
      setDraft(planDraft(result));
      setMessage("Plan saved.");
    } catch (err) { if (mounted.current) setError(err instanceof Error ? err.message : "Unable to save the plan."); }
    finally { if (mounted.current) setSaving(false); }
  };
  const epic = draft?.epics.find(item => item.epicKey === editingEpic);

  return <section className="tb-planner" aria-label="Delivery planner">
    <div className="tb-planner-toolbar">
      <p>Plan delivery across epics. Track commitments, scope and dependencies.</p>
      <button type="button" disabled={loading || saving} onClick={() => { if (canLeave()) void load(draft?.id); }}>Refresh plans</button>
      <button type="button" className="tb-planner-primary" disabled={loading || saving || !inventory} onClick={() => { if (canLeave()) choose(null); }}>New plan</button>
    </div>
    {error && <div role="alert" className="tb-planner-error">{error} <button type="button" disabled={loading || saving} onClick={() => { if (canLeave()) void load(draft?.id); }}>Reload saved plans</button></div>}
    {loading && <p role="status">Loading Planner…</p>}
    {message && <p role="status">{message}</p>}
    {inventory && <p className="tb-planner-muted">Last successful JIRA sync: {inventory.lastSyncedAt ? formatDisplayTimestamp(inventory.lastSyncedAt) : "Not available"} · Progress counts work items once; epics and subtasks are excluded.</p>}
    {inventory && !loading && <div className="tb-planner-layout">
      <aside className="tb-planner-plans" aria-label="Delivery plans">
        <h2>Plans <span>{inventory.plans.length}</span></h2>
        {!inventory.plans.length && <p>No saved plans yet. Create your first delivery plan.</p>}
        {inventory.plans.map(plan => <button type="button" key={plan.id} className={`tb-planner-plan${plan.id === draft?.id ? " is-selected" : ""}`}
          aria-pressed={plan.id === draft?.id} disabled={saving} onClick={() => { if (canLeave()) choose(plan); }}>
          <strong>{plan.name}</strong><span>{plan.status} · {plan.epics.length} epics</span>
          <span>{progressLabel(plan.metrics)} · Target {plan.targetDate ?? "not set"}</span>
          {plan.warnings.length > 0 && <span>{plan.warnings.length} planning warnings</span>}
        </button>)}
      </aside>
      <div className="tb-planner-workspace">
        {!draft ? <div className="tb-planner-empty"><h2>A delivery plan starts with your epics</h2><p>Create a plan, add configured epics, and arrange their dates and dependencies.</p></div> :
          <form onSubmit={event => { event.preventDefault(); void save(); }}>
            <fieldset disabled={saving}>
              <legend className="tb-planner-title">{draft.id ? draft.name : "New delivery plan"}</legend>
              <details key={draft.id ?? "new"} open={!draft.id} className="tb-planner-plan-details">
                <summary>Plan details</summary>
              <div className="tb-planner-fields">
                <label>Plan name<input required maxLength={160} value={draft.name} onChange={event => change({ name: event.target.value })} /></label>
                <label>Owner<input maxLength={160} value={draft.owner} onChange={event => change({ owner: event.target.value })} /></label>
                <label>Plan target<input type="date" value={draft.targetDate ?? ""} onChange={event => change({ targetDate: event.target.value || null })} /></label>
                <label>Status<select value={draft.status} onChange={event => change({ status: event.target.value as PlanStatus })}>
                  <option value="draft">Draft</option><option value="active">Active</option><option value="completed">Completed</option><option value="archived">Archived</option>
                </select></label>
                <label className="tb-planner-objective">Objective<textarea maxLength={4000} rows={2} value={draft.objective} onChange={event => change({ objective: event.target.value })} /></label>
              </div>
              {!current?.baseline && <p className="tb-planner-muted">The first save as Active captures your schedule and current scope as a permanent baseline.</p>}
              </details>
              {current && <div className="tb-planner-summary" aria-label="Saved plan summary">
                <span><strong>{progressLabel(current.metrics)}</strong> scope complete · {current.metrics.completedCards}/{current.metrics.totalCards} cards</span>
                <span>{current.epics.length} epics · {current.tracks.length} tracks</span>
                <span>Target {current.targetDate ?? "not set"}</span>
                {dirty && <span>Summary reflects the last save</span>}
              </div>}
              <details className="tb-planner-section">
                <summary>Tracks · {draft.tracks.length}</summary>
                {draft.tracks.map((track, index) => <div className="tb-planner-track-editor" key={track.id}>
                  <input aria-label={`Track ${index + 1} name`} required maxLength={120} value={track.name} onChange={event => change({ tracks: draft.tracks.map(item => item.id === track.id ? { ...item, name: event.target.value } : item) })} />
                  <button type="button" aria-label={`Move ${track.name} up`} disabled={index === 0} onClick={() => {
                    const tracks = [...draft.tracks]; [tracks[index - 1], tracks[index]] = [tracks[index], tracks[index - 1]]; change({ tracks });
                  }}>↑</button>
                  <button type="button" aria-label={`Move ${track.name} down`} disabled={index === draft.tracks.length - 1} onClick={() => {
                    const tracks = [...draft.tracks]; [tracks[index + 1], tracks[index]] = [tracks[index], tracks[index + 1]]; change({ tracks });
                  }}>↓</button>
                  <button type="button" disabled={draft.tracks.length === 1} onClick={() => {
                    const tracks = draft.tracks.filter(item => item.id !== track.id);
                    change({ tracks, epics: draft.epics.map(item => item.trackId === track.id ? { ...item, trackId: tracks[0].id } : item) });
                  }} aria-label={`Remove track ${track.name}`}>Remove</button>
                </div>)}
                <p className="tb-planner-muted">Removing a track moves its epics to the first remaining track.</p>
                <button type="button" disabled={draft.tracks.length >= 50} onClick={() => {
                  const id = crypto.randomUUID(); change({ tracks: [...draft.tracks, { id, name: `Track ${draft.tracks.length + 1}` }] });
                }}>Add track</button>
              </details>
              <div className="tb-planner-section tb-planner-epics-toolbar">
                <span>{draft.epics.length} epics in this plan</span>
                <button type="button" onClick={() => setPickerOpen(true)}>Add configured epics</button>
              </div>
              <div className="tb-planner-section">
                <h2>Delivery timeline</h2>
                <PlannerTimeline plan={draft} epics={inventory.epics} selected={selected} onSelect={setSelected}
                  onEdit={key => { if (!saving) { setSelected(key); setEditingEpic(key); } }} baseline={current?.baseline?.document ?? null} />
                {!draft.epics.length && <p>Add configured epics to begin scheduling.</p>}
              </div>
              {current && !dirty && current.warnings.length > 0 && <section className="tb-planner-warnings" aria-label="Planning warnings"><h2>Planning warnings</h2><ul>{current.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></section>}
              {dirty && <p className="tb-planner-muted">Save to check dependencies and update planning warnings. Dates use inclusive calendar days.</p>}
              {current?.baseline && <details className="tb-planner-section">
                <summary>Activation baseline · {formatDisplayTimestamp(current.baseline.capturedAt)}</summary>
                <p>Original target: {current.baseline.document.targetDate ?? "not set"} · {current.baseline.document.epics.length} epics · {current.baseline.issueKeys.length} cards</p>
                <p>Scope since activation: +{current.scopeChange!.added} added / −{current.scopeChange!.removed} removed{!current.metrics.available ? " · Source data is incomplete" : ""}</p>
                <table><thead><tr><th>Epic</th><th>Original start</th><th>Original finish</th><th>Original dependencies</th></tr></thead><tbody>
                  {current.baseline.document.epics.map(item => <tr key={item.epicKey}><td>{item.epicKey}</td><td>{item.startDate ?? "Unscheduled"}</td><td>{item.endDate ?? "Unscheduled"}</td><td>{item.dependsOn.join(", ") || "None"}</td></tr>)}
                </tbody></table>
              </details>}
            </fieldset>
            <div className="tb-planner-savebar">
              <span>{saving ? "Saving…" : dirty ? "Unsaved plan changes" : "All changes saved"}</span>
              <button type="button" disabled={saving || !dirty} onClick={() => { if (canLeave()) { if (current) choose(current); else setDraft(null); } }}>Discard changes</button>
              <button type="submit" className="tb-planner-primary" disabled={saving || !dirty}>Save plan</button>
            </div>
          </form>}
      </div>
    </div>}
    {epic && draft && inventory && <PlannerEpicDetails epic={epic} plan={draft} sources={inventory.epics} jiraBaseUrl={inventory.jiraBaseUrl}
      onClose={() => setEditingEpic(null)} onChange={patch => updateEpic(epic.epicKey, patch)}
      onRemove={() => {
        change({ epics: draft.epics.filter(item => item.epicKey !== epic.epicKey).map(item => ({ ...item, dependsOn: item.dependsOn.filter(key => key !== epic.epicKey) })) });
        setSelected(null); setEditingEpic(null);
      }} />}
    {pickerOpen && draft && inventory && <PlannerEpicPicker epics={inventory.epics}
      includedKeys={draft.epics.map(item => item.epicKey)} onClose={() => setPickerOpen(false)}
      onAdd={items => {
        const added = items.map(item => ({
          epicKey: item.epicKey, trackId: draft.tracks[0].id, startDate: item.startDate, endDate: item.endDate, dependsOn: [], notes: "",
        }));
        change({ epics: [...draft.epics, ...added] }); setSelected(added[0].epicKey); setPickerOpen(false);
      }} />}
  </section>;
}
