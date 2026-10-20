import { useEffect, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { PlanDraft, PlanStatus } from "../../../lib/planner";

type Props = {
  plan: PlanDraft;
  mode: "edit" | "validate" | null;
  formRef: RefObject<HTMLFormElement | null>;
  hasBaseline: boolean;
  disabled: boolean;
  onChange: (patch: Partial<PlanDraft>) => void;
  onClose: () => void;
};

export function PlannerSettingsDialog({ plan, mode, formRef, hasBaseline, disabled, onChange, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!mode) return;
    const element = dialog.current!;
    const opener = document.activeElement as HTMLElement;
    const overflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = "hidden";
    const invalid = mode === "validate" ? formRef.current!.querySelector<HTMLElement>(":invalid:not(fieldset)") : null;
    (invalid ?? formRef.current!.querySelector<HTMLInputElement>("input")!).focus();
    if (invalid) formRef.current!.reportValidity();
    return () => {
      element.close();
      document.body.style.overflow = overflow;
      opener.focus();
    };
  }, [mode, formRef]);

  // Keep controls mounted so Save plan can validate a closed settings dialog.
  return createPortal(<dialog ref={dialog} className="tb-modal tb-planner-settings"
    aria-labelledby="planner-settings-title" aria-describedby="planner-settings-note"
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <form ref={formRef} aria-label="Plan settings" noValidate onSubmit={event => {
      event.preventDefault();
      if (formRef.current!.reportValidity()) onClose();
    }}>
      <header className="tb-modal-head">
        <h3 id="planner-settings-title">Plan settings</h3>
        <button type="button" className="tb-btn tb-btn-sm" onClick={onClose}>Close</button>
      </header>
      <fieldset disabled={disabled}>
        <legend className="tb-visually-hidden">Plan details</legend>
        <div className="tb-planner-fields">
          <label className="tb-modal-field"><span>Plan name</span><input required maxLength={160} value={plan.name} onChange={event => onChange({ name: event.target.value })} /></label>
          <label className="tb-modal-field"><span>Owner</span><input maxLength={160} value={plan.owner} onChange={event => onChange({ owner: event.target.value })} /></label>
          <label className="tb-modal-field"><span>Plan target</span><input type="date" value={plan.targetDate ?? ""} onChange={event => onChange({ targetDate: event.target.value || null })} /></label>
          <label className="tb-modal-field"><span>Status</span><select value={plan.status} onChange={event => onChange({ status: event.target.value as PlanStatus })}>
            <option value="draft">Draft</option><option value="active">Active</option><option value="completed">Completed</option><option value="archived">Archived</option>
          </select></label>
          <label className="tb-modal-field tb-planner-objective"><span>Objective</span><textarea maxLength={4000} rows={2} value={plan.objective} onChange={event => onChange({ objective: event.target.value })} /></label>
        </div>
        {!hasBaseline && <p className="tb-planner-muted">The first save as Active captures your schedule and current scope as a permanent baseline.</p>}
        <section className="tb-planner-settings-tracks" aria-labelledby="planner-settings-tracks-title">
          <h4 id="planner-settings-tracks-title">Tracks · {plan.tracks.length}</h4>
          <div className="tb-planner-track-list">
            {plan.tracks.map((track, index) => <div className="tb-planner-track-editor" key={track.id}>
              <input aria-label={`Track ${index + 1} name`} required maxLength={120} value={track.name} onChange={event => onChange({ tracks: plan.tracks.map(item => item.id === track.id ? { ...item, name: event.target.value } : item) })} />
              <button type="button" className="tb-btn tb-btn-sm" aria-label={`Move ${track.name} up`} disabled={index === 0} onClick={() => {
                const tracks = [...plan.tracks]; [tracks[index - 1], tracks[index]] = [tracks[index], tracks[index - 1]]; onChange({ tracks });
              }}>↑</button>
              <button type="button" className="tb-btn tb-btn-sm" aria-label={`Move ${track.name} down`} disabled={index === plan.tracks.length - 1} onClick={() => {
                const tracks = [...plan.tracks]; [tracks[index + 1], tracks[index]] = [tracks[index], tracks[index + 1]]; onChange({ tracks });
              }}>↓</button>
              <button type="button" className="tb-btn tb-btn-sm" disabled={plan.tracks.length === 1} onClick={() => {
                const tracks = plan.tracks.filter(item => item.id !== track.id);
                onChange({ tracks, epics: plan.epics.map(item => item.trackId === track.id ? { ...item, trackId: tracks[0].id } : item) });
              }} aria-label={`Remove track ${track.name}`}>Remove</button>
            </div>)}
          </div>
          <p className="tb-planner-muted">Removing a track moves its epics to the first remaining track.</p>
          <button type="button" className="tb-btn tb-btn-sm" disabled={plan.tracks.length >= 50} onClick={() => {
            const id = crypto.randomUUID(); onChange({ tracks: [...plan.tracks, { id, name: `Track ${plan.tracks.length + 1}` }] });
          }}>Add track</button>
        </section>
      </fieldset>
      <footer className="tb-modal-actions tb-modal-actions-split">
        <p id="planner-settings-note" className="tb-muted-note">Changes stay in your draft. Save the plan to keep them.</p>
        <button type="submit" className="tb-btn tb-btn-primary">Done</button>
      </footer>
    </form>
  </dialog>, document.body);
}
