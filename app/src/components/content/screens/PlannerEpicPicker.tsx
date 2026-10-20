import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PlannerEpic } from "../../../lib/planner";

type Props = {
  epics: PlannerEpic[];
  includedKeys: string[];
  onAdd: (epics: PlannerEpic[]) => void;
  onClose: () => void;
};

export function PlannerEpicPicker({ epics, includedKeys, onAdd, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const included = new Set(includedKeys);
  const selected = new Set(selectedKeys);
  const selectedEpics = selectedKeys.map(key => epics.find(epic => epic.epicKey === key)!);
  const available = epics.filter(epic => !included.has(epic.epicKey) && !selected.has(epic.epicKey));
  const candidates = available.filter(epic =>
    `${epic.epicKey} ${epic.title} ${epic.status}`.toLowerCase().includes(query.trim().toLowerCase()));
  const count = includedKeys.length + selectedKeys.length;
  const atLimit = count >= 200;

  useEffect(() => {
    const element = dialog.current!;
    const opener = document.activeElement as HTMLElement;
    const overflow = document.body.style.overflow;
    element.showModal();
    search.current!.focus();
    document.body.style.overflow = "hidden";
    return () => {
      element.close();
      document.body.style.overflow = overflow;
      opener.focus();
    };
  }, []);

  return createPortal(
    <dialog ref={dialog} className="tb-modal tb-modal-initiative-view tb-planner-epic-picker"
      aria-labelledby="planner-epic-picker-title" aria-describedby="planner-epic-picker-description"
      onCancel={event => { event.preventDefault(); onClose(); }}>
      <header className="tb-modal-head">
        <div>
          <h3 id="planner-epic-picker-title">Add configured epics</h3>
          <p id="planner-epic-picker-description" className="tb-muted-note">Choose configured epics for this delivery plan. Click a card to include it.</p>
        </div>
        <button type="button" className="tb-btn tb-btn-sm" onClick={onClose}>Close</button>
      </header>
      <div className="tb-initiative-view-picker">
        <section className="tb-initiative-view-picker-panel">
          <label className="tb-modal-field">
            <span>Search Epics</span>
            <input ref={search} value={query} onChange={event => setQuery(event.target.value)}
              placeholder="Epic key, name, or status" />
          </label>
          <div className="tb-initiative-view-list" role="group" aria-label="Available configured epics">
            {candidates.map(epic => <button key={epic.epicKey} type="button" className="tb-initiative-view-list-item"
              disabled={atLimit} aria-label={`Include ${epic.epicKey}: ${epic.title}`} title={epic.title}
              onClick={() => setSelectedKeys(keys => [...keys, epic.epicKey])}>
              <strong>{epic.title}</strong>
              <span>{epic.epicKey} · {epic.status}</span>
            </button>)}
            {!candidates.length && <p className="tb-muted-note tb-initiative-view-empty">
              {!epics.length ? "No configured epics yet. Configure epics in Initiatives or Settings to make them available here."
                : available.length ? "No available epics match your search."
                  : "All configured epics are included."}
            </p>}
          </div>
        </section>
        <section className="tb-initiative-view-picker-panel">
          <div className="tb-initiative-view-picker-head">
            <span>Included Epics</span><span className="tb-chip" aria-label={`${count} included epics`}>{count}</span>
          </div>
          <div className="tb-initiative-view-list" role="group" aria-label="Included plan epics">
            {selectedEpics.map(epic => <button key={epic.epicKey} type="button"
              className="tb-initiative-view-list-item is-selected" title={epic.title}
              aria-label={`Remove ${epic.epicKey} from selection`}
              onClick={() => setSelectedKeys(keys => keys.filter(key => key !== epic.epicKey))}>
              <strong>{epic.title}</strong>
              <span>{epic.epicKey} · New selection · Click to remove</span>
            </button>)}
            {includedKeys.map(key => <div key={key} className="tb-initiative-view-list-item tb-planner-included-epic">
              <strong>{epics.find(epic => epic.epicKey === key)?.title ?? key}</strong>
              <span>{key} · Already in plan</span>
            </div>)}
            {!count && <p className="tb-muted-note tb-initiative-view-empty">No epics included yet. Choose epics from the list on the left.</p>}
          </div>
        </section>
      </div>
      <p className="tb-muted-note" role="status">{atLimit ? "Plan limit reached: 200 epics." : `${count} of 200 epics included.`} {selectedKeys.length} new selected.</p>
      <p className="tb-muted-note">New epics use the first track and copy their initiative dates. Save the plan to keep your changes.</p>
      <footer className="tb-modal-actions">
        <button type="button" className="tb-btn" onClick={onClose}>Cancel</button>
        <button type="button" className="tb-btn tb-btn-primary" disabled={!selectedKeys.length || count > 200}
          onClick={() => onAdd(selectedEpics)}>Add selected epics ({selectedKeys.length})</button>
      </footer>
    </dialog>, document.body,
  );
}
