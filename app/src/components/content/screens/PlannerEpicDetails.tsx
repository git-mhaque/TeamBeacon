import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { jiraEpicUrl, progressLabel, type PlanDraft, type PlanEpic, type PlannerEpic } from "../../../lib/planner";
import { PlannerDateRangeField } from "./PlannerDateRangeField";

type Props = {
  epic: PlanEpic;
  plan: PlanDraft;
  sources: PlannerEpic[];
  jiraBaseUrl: string | null;
  onChange: (patch: Partial<PlanEpic>) => void;
  onRemove: () => void;
  onClose: () => void;
};

export function PlannerEpicDetails({ epic, plan, sources, jiraBaseUrl, onChange, onRemove, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const track = useRef<HTMLSelectElement>(null);
  const source = sources.find(item => item.epicKey === epic.epicKey);
  const sourceUrl = source ? jiraEpicUrl(jiraBaseUrl, source.epicKey) : undefined;

  useEffect(() => {
    const element = dialog.current!;
    const opener = document.activeElement as HTMLElement;
    const overflow = document.body.style.overflow;
    element.showModal();
    track.current!.focus();
    document.body.style.overflow = "hidden";
    return () => {
      element.close();
      document.body.style.overflow = overflow;
      opener.focus();
    };
  }, []);

  return createPortal(
    <dialog ref={dialog} className="tb-modal tb-planner-epic-details"
      aria-labelledby="planner-epic-details-title" aria-describedby="planner-epic-details-note"
      onCancel={event => { event.preventDefault(); onClose(); }}>
      <header className="tb-modal-head">
        <div>
          <h3 id="planner-epic-details-title">{epic.epicKey} · {source?.title ?? "Source unavailable"}</h3>
          {source && <p className="tb-muted-note">{progressLabel(source)} scope complete · {source.status}{source.isCompleted ? " (completed)" : ""}</p>}
          {sourceUrl && <a className="tb-external-link" href={sourceUrl} target="_blank" rel="noopener noreferrer">Open {epic.epicKey} in JIRA</a>}
        </div>
        <button type="button" className="tb-btn tb-btn-sm" onClick={onClose}>Close</button>
      </header>
      <div className="tb-planner-epic-fields">
        <label className="tb-modal-field tb-planner-epic-track"><span>Epic track</span>
          <select ref={track} value={epic.trackId} onChange={event => onChange({ trackId: event.target.value })}>
            {plan.tracks.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <PlannerDateRangeField startDate={epic.startDate} endDate={epic.endDate} onChange={onChange} />
      </div>
      <fieldset className="tb-planner-epic-dependencies">
        <legend>Must start after these epics finish</legend>
        <div>
          {plan.epics.filter(item => item.epicKey !== epic.epicKey).map(item => {
            const name = sources.find(source => source.epicKey === item.epicKey)?.title ?? "Source unavailable";
            const selected = epic.dependsOn.includes(item.epicKey);
            return <button key={item.epicKey} type="button" className="tb-planner-dependency-chip"
              aria-pressed={selected} aria-label={`${item.epicKey} ${name}`} title={`${item.epicKey} · ${name}`}
              onClick={() => onChange({ dependsOn: selected ? epic.dependsOn.filter(key => key !== item.epicKey) : [...epic.dependsOn, item.epicKey] })}>
              <Check size={14} aria-hidden="true" />
              <strong>{item.epicKey}</strong><span>{name}</span>
            </button>;
          })}
          {plan.epics.length === 1 && <p className="tb-muted-note">Add another epic to define a dependency.</p>}
        </div>
      </fieldset>
      <label className="tb-modal-field"><span>Planning notes</span>
        <textarea rows={2} maxLength={4000} value={epic.notes} onChange={event => onChange({ notes: event.target.value })} />
      </label>
      <p id="planner-epic-details-note" className="tb-muted-note">Changes stay in your draft. Save the plan to keep them.</p>
      <footer className="tb-modal-actions tb-modal-actions-split">
        <button type="button" className="tb-btn tb-btn-danger" onClick={onRemove}>Remove epic from plan</button>
        <button type="button" className="tb-btn tb-btn-primary" onClick={onClose}>Done</button>
      </footer>
    </dialog>, document.body,
  );
}
