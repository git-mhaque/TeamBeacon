import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export function PlannerLeaveDialog({ onStay, onDiscard, onSave }: { onStay: () => void; onDiscard: () => void; onSave: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    const opener = document.activeElement as HTMLElement;
    element.showModal();
    return () => { element.close(); opener.focus(); };
  }, []);
  return createPortal(<dialog ref={dialog} className="tb-modal tb-planner-leave-dialog"
    aria-labelledby="planner-leave-heading" aria-describedby="planner-leave-description"
    onCancel={event => { event.preventDefault(); onStay(); }}>
    <h3 id="planner-leave-heading">Save your changes before returning?</h3>
    <p id="planner-leave-description">This plan has unsaved changes. Save them or discard them to return to all plans.</p>
    <footer className="tb-modal-actions">
      <button type="button" className="tb-btn" onClick={onStay}>Keep editing</button>
      <button type="button" className="tb-btn" onClick={onDiscard}>Discard and return</button>
      <button type="button" className="tb-btn tb-btn-primary" onClick={() => { dialog.current!.close(); onSave(); }}>Save and return</button>
    </footer>
  </dialog>, document.body);
}
