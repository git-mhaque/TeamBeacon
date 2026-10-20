import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { fetchPlanner, savePlan } from "../../../lib/api";
import { formatDisplayTimestamp } from "../../../lib/dateTime";
import { newPlan, planDate, planDraft, progressLabel, type DeliveryPlan, type PlanDraft, type PlanEpic, type PlannerInventory } from "../../../lib/planner";
import { ArrowLeft, RefreshCw, Plus, SlidersHorizontal } from "lucide-react";
import { usePlannerNavigation } from "../../../lib/plannerNavigation";
import { PlannerOverview } from "./PlannerOverview";
import { PlannerLeaveDialog } from "./PlannerLeaveDialog";
import { PlannerTimeline } from "./PlannerTimeline";
import { PlannerEpicPicker } from "./PlannerEpicPicker";
import { PlannerEpicDetails } from "./PlannerEpicDetails";
import { PlannerSettingsDialog } from "./PlannerSettingsDialog";
import "../../../styles/planner.css";

export function PlannerScreen() {
  const [inventory, setInventory] = useState<PlannerInventory | null>(null);
  const [draft, setDraft] = useState<PlanDraft | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [editingEpic, setEditingEpic] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [settingsMode, setSettingsMode] = useState<"edit" | "validate" | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const mounted = useRef(false);
  const settingsForm = useRef<HTMLFormElement>(null);
  const workspaceTitle = useRef<HTMLHeadingElement>(null);
  const newPlanButton = useRef<HTMLButtonElement>(null);
  const overviewPosition = useRef({ scroll: 0, opener: null as HTMLElement | null });
  const current = inventory?.plans.find(plan => plan.id === draft?.id);
  const dirty = Boolean(draft && (!current || JSON.stringify(draft) !== JSON.stringify(planDraft(current))));
  const navigation = usePlannerNavigation(dirty, saving);
  const inWorkspace = navigation.route !== "home";
  const hasDraft = Boolean(draft);
  const choose = (plan: DeliveryPlan | null) => {
    setDraft(plan ? planDraft(plan) : newPlan());
    setSettingsMode(plan ? null : "edit");
    setSelected(null); setEditingEpic(null); setPickerOpen(false);
  };
  const canLeave = () => !saving && (!dirty || window.confirm("Discard unsaved plan changes?"));
  const load = async () => {
    setLoading(true); setError("");
    try {
      const data = await fetchPlanner();
      if (!mounted.current) return;
      setInventory(data);
    } catch (err) { if (mounted.current) setError(err instanceof Error ? err.message : "Unable to load Planner."); }
    finally { if (mounted.current) setLoading(false); }
  };
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; };
    // Loading is triggered by mounting and by the explicit refresh action.
  }, []);
  useEffect(() => {
    if (!inventory) return;
    const plan = inventory.plans.find(item => item.id === navigation.route);
    if (navigation.route === "new") choose(null);
    else if (plan) choose(plan);
    else { setSettingsMode(null); setDraft(null); setError(""); setSelected(null); setEditingEpic(null); setPickerOpen(false); }
    // Reset the workspace only when its route or saved inventory changes.
  }, [navigation.route, inventory]);
  useLayoutEffect(() => {
    if (inWorkspace) {
      workspaceTitle.current?.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    } else {
      const opener = overviewPosition.current.opener;
      (opener?.isConnected ? opener : newPlanButton.current)?.focus({ preventScroll: true });
      window.scrollTo(0, overviewPosition.current.scroll);
    }
  }, [inWorkspace, draft?.id, hasDraft]);
  const openPlan = (plan: DeliveryPlan | null) => {
    overviewPosition.current = { scroll: window.scrollY, opener: document.activeElement as HTMLElement };
    setError(""); setMessage("");
    navigation.open(plan?.id ?? "new");
  };
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
  const save = async (afterSave?: () => void) => {
    if (!draft) return;
    const invalid = settingsForm.current!.querySelector<HTMLInputElement>("input:invalid, select:invalid, textarea:invalid");
    if (invalid) {
      setSettingsMode("validate");
      return;
    }
    setSaving(true); setError(""); setMessage("");
    try {
      const result = await savePlan(draft);
      if (!mounted.current) return;
      setInventory(previous => previous && ({ ...previous, plans: [result, ...previous.plans.filter(plan => plan.id !== result.id)] }));
      setDraft(planDraft(result));
      setMessage("Plan saved.");
      navigation.replace(result.id);
      afterSave?.();
    } catch (err) { if (mounted.current) setError(err instanceof Error ? err.message : "Unable to save the plan."); }
    finally { if (mounted.current) setSaving(false); }
  };
  const epic = draft?.epics.find(item => item.epicKey === editingEpic);

  return <section className="tb-planner" aria-label="Delivery planner">
    <div className={`tb-planner-toolbar${inWorkspace && draft ? " tb-planner-workspace-toolbar" : ""}`}>
      {inWorkspace ? <button type="button" className="tb-planner-back" disabled={saving} onClick={navigation.back}><ArrowLeft size={17} aria-hidden="true" />All plans</button>
        : <p>Plan delivery across epics. Track commitments, scope and dependencies.</p>}
      {inWorkspace && draft && <header className="tb-planner-workspace-heading">
        <h2 ref={workspaceTitle} tabIndex={-1}>{draft.name || "New delivery plan"}</h2>
        <span className={`tb-planner-status is-${draft.status}`}>{draft.status}</span>
      </header>}
      <div className="tb-planner-toolbar-actions">
        {inWorkspace && draft && <button type="button" disabled={loading || saving} aria-haspopup="dialog" onClick={event => { event.currentTarget.focus(); setSettingsMode("edit"); }}><SlidersHorizontal size={15} aria-hidden="true" />Plan settings</button>}
        <button type="button" disabled={loading || saving} onClick={() => { if (canLeave()) void load(); }}><RefreshCw size={15} aria-hidden="true" />{inWorkspace ? "Refresh plan" : "Refresh plans"}</button>
        {!inWorkspace && <button ref={newPlanButton} type="button" className="tb-planner-primary" disabled={loading || !inventory} onClick={event => { event.currentTarget.focus(); openPlan(null); }}><Plus size={17} aria-hidden="true" />New plan</button>}
      </div>
    </div>
    {error && <div role="alert" className="tb-planner-error">{error} <button type="button" disabled={loading || saving} onClick={() => { if (canLeave()) void load(); }}>Reload saved plans</button></div>}
    {loading && <p role="status">Loading Planner…</p>}
    {message && <p role="status">{message}</p>}
    {inventory && !inWorkspace && <p className="tb-planner-muted">Last successful JIRA sync: {inventory.lastSyncedAt ? formatDisplayTimestamp(inventory.lastSyncedAt) : "Not available"} · Progress counts work items once; epics and subtasks are excluded.</p>}
    {inventory && <div hidden={inWorkspace}><PlannerOverview plans={inventory.plans} onOpen={openPlan} /></div>}
    {inventory && typeof navigation.route === "number" && !inventory.plans.some(plan => plan.id === navigation.route) && !loading && <div className="tb-planner-empty" role="status"><h2>Plan not found</h2><p>This plan is no longer available. Return to all plans to choose another.</p></div>}
    {inventory && inWorkspace && draft && <div className="tb-planner-workspace">
          <div className="tb-planner-summary" aria-label="Plan summary">
            {current && <span title="Progress counts work items once; epics and subtasks are excluded."><strong>{progressLabel(current.metrics)}</strong> scope complete · {current.metrics.completedCards}/{current.metrics.totalCards} cards{dirty && <small> · Last saved scope</small>}</span>}
            <span>{draft.epics.length} epics · {draft.tracks.length} tracks</span>
            <span>{draft.owner || "No owner assigned"}</span>
            <span>Target <strong>{planDate(draft.targetDate)}</strong></span>
            <span className="tb-planner-freshness">Last successful JIRA sync: {inventory.lastSyncedAt ? formatDisplayTimestamp(inventory.lastSyncedAt) : "Not available"}</span>
          </div>
          <form aria-label="Delivery plan" noValidate onSubmit={event => { event.preventDefault(); void save(); }}>
            <fieldset disabled={saving || loading}>
              <legend className="tb-visually-hidden">Plan configuration</legend>
              <div className="tb-planner-section">
                <div className="tb-planner-epics-toolbar">
                  <h2>Delivery timeline</h2>
                  <button type="button" onClick={() => setPickerOpen(true)}>Add configured epics</button>
                </div>
                <PlannerTimeline plan={draft} epics={inventory.epics} selected={selected} onSelect={setSelected}
                  onEdit={key => { if (!saving && !loading) { setSelected(key); setEditingEpic(key); } }} baseline={current?.baseline?.document ?? null} />
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
              <button type="button" disabled={saving || !dirty} onClick={() => { if (canLeave()) { if (current) choose(current); else navigation.replace("home"); } }}>Discard changes</button>
              <button type="submit" className="tb-planner-primary" disabled={saving || !dirty}>Save plan</button>
            </div>
          </form>
    </div>}
    {inWorkspace && draft && <PlannerSettingsDialog plan={draft} mode={navigation.pendingReturn ? null : settingsMode} formRef={settingsForm}
      hasBaseline={Boolean(current?.baseline)} disabled={saving || loading} onChange={change} onClose={() => setSettingsMode(null)} />}
    {navigation.pendingReturn && <PlannerLeaveDialog onStay={navigation.clearPendingReturn}
      onDiscard={navigation.finishReturn}
      onSave={() => { const finish = navigation.finishReturn; navigation.clearPendingReturn(); void save(finish); }} />}
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
