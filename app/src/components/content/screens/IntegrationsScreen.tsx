import { useCallback, useEffect, useState } from "react";
import {
  addEpicGroup,
  addWorkType,
  deleteEpicGroup,
  deleteWorkType,
  type EpicLookupConfig,
  fetchEpicLookupConfig,
  updateEpicGroup,
  updateWorkType,
} from "../../../lib/api";

type PendingLookupDelete = {
  type: "group" | "workType";
  id: number;
  name: string;
} | null;

export function IntegrationsScreen() {
  const [epicLookup, setEpicLookup] = useState<EpicLookupConfig>({ groups: [], workTypes: [] });
  const [groupDraft, setGroupDraft] = useState("");
  const [workTypeDraft, setWorkTypeDraft] = useState("");
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null);
  const [editingGroupName, setEditingGroupName] = useState("");
  const [editingWorkTypeId, setEditingWorkTypeId] = useState<number | null>(null);
  const [editingWorkTypeName, setEditingWorkTypeName] = useState("");
  const [pendingLookupDelete, setPendingLookupDelete] = useState<PendingLookupDelete>(null);
  const [lookupDeleteLoading, setLookupDeleteLoading] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [metaSuccess, setMetaSuccess] = useState<string | null>(null);

  const loadEpicMetadataConfig = useCallback(async () => {
    setMetaError(null);
    try {
      setEpicLookup(await fetchEpicLookupConfig());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown epic metadata failure.";
      setMetaError(message);
      setEpicLookup({ groups: [], workTypes: [] });
    }
  }, []);

  useEffect(() => {
    loadEpicMetadataConfig().catch(() => {
      // loadEpicMetadataConfig updates local state.
    });
  }, [loadEpicMetadataConfig]);

  useEffect(() => {
    if (!metaSuccess) return undefined;
    const timeoutId = window.setTimeout(() => setMetaSuccess(null), 2600);
    return () => window.clearTimeout(timeoutId);
  }, [metaSuccess]);

  const handleAddEpicGroup = useCallback(async () => {
    const candidate = groupDraft.trim();
    if (!candidate) {
      setMetaError("Work stream name is required.");
      return;
    }
    setMetaError(null);
    setMetaSuccess(null);
    try {
      await addEpicGroup(candidate);
      setGroupDraft("");
      await loadEpicMetadataConfig();
      setMetaSuccess(`Work stream "${candidate}" saved.`);
    } catch (err) {
      setMetaError(err instanceof Error ? err.message : "Failed to save work stream.");
    }
  }, [groupDraft, loadEpicMetadataConfig]);

  const handleAddWorkType = useCallback(async () => {
    const candidate = workTypeDraft.trim();
    if (!candidate) {
      setMetaError("Work type name is required.");
      return;
    }
    setMetaError(null);
    setMetaSuccess(null);
    try {
      await addWorkType(candidate);
      setWorkTypeDraft("");
      await loadEpicMetadataConfig();
      setMetaSuccess(`Work type "${candidate}" saved.`);
    } catch (err) {
      setMetaError(err instanceof Error ? err.message : "Failed to save work type.");
    }
  }, [loadEpicMetadataConfig, workTypeDraft]);

  const handleSaveEditedGroup = useCallback(async () => {
    if (editingGroupId === null) return;
    const candidate = editingGroupName.trim();
    if (!candidate) {
      setMetaError("Work stream name is required.");
      return;
    }
    setMetaError(null);
    setMetaSuccess(null);
    try {
      await updateEpicGroup(editingGroupId, candidate);
      await loadEpicMetadataConfig();
      setEditingGroupId(null);
      setEditingGroupName("");
      setMetaSuccess("Work stream updated.");
    } catch (err) {
      setMetaError(err instanceof Error ? err.message : "Failed to update work stream.");
    }
  }, [editingGroupId, editingGroupName, loadEpicMetadataConfig]);

  const handleSaveEditedWorkType = useCallback(async () => {
    if (editingWorkTypeId === null) return;
    const candidate = editingWorkTypeName.trim();
    if (!candidate) {
      setMetaError("Work type name is required.");
      return;
    }
    setMetaError(null);
    setMetaSuccess(null);
    try {
      await updateWorkType(editingWorkTypeId, candidate);
      await loadEpicMetadataConfig();
      setEditingWorkTypeId(null);
      setEditingWorkTypeName("");
      setMetaSuccess("Work type updated.");
    } catch (err) {
      setMetaError(err instanceof Error ? err.message : "Failed to update work type.");
    }
  }, [editingWorkTypeId, editingWorkTypeName, loadEpicMetadataConfig]);

  const confirmLookupDelete = useCallback(async () => {
    if (!pendingLookupDelete) return;
    setLookupDeleteLoading(true);
    setMetaError(null);
    setMetaSuccess(null);
    try {
      if (pendingLookupDelete.type === "group") {
        await deleteEpicGroup(pendingLookupDelete.id);
        if (editingGroupId === pendingLookupDelete.id) {
          setEditingGroupId(null);
          setEditingGroupName("");
        }
        setMetaSuccess(`Work stream "${pendingLookupDelete.name}" deleted.`);
      } else {
        await deleteWorkType(pendingLookupDelete.id);
        if (editingWorkTypeId === pendingLookupDelete.id) {
          setEditingWorkTypeId(null);
          setEditingWorkTypeName("");
        }
        setMetaSuccess(`Work type "${pendingLookupDelete.name}" deleted.`);
      }
      await loadEpicMetadataConfig();
      setPendingLookupDelete(null);
    } catch (err) {
      setMetaError(err instanceof Error ? err.message : "Failed to delete metadata value.");
    } finally {
      setLookupDeleteLoading(false);
    }
  }, [editingGroupId, editingWorkTypeId, loadEpicMetadataConfig, pendingLookupDelete]);

  return (
    <div className="tb-screen-grid">
      <section className="tb-panel">
        <header className="tb-panel-header">
          <div>
            <h3>Initiative Metadata</h3>
            <p className="tb-muted-note">Manage reusable work streams and work types used by initiative configuration.</p>
          </div>
        </header>

        {metaError ? <p className="tb-error-note">Epic metadata error: {metaError}</p> : null}

        <div className="tb-lookup-grid">
          <article className="tb-lookup-card">
            <h4>Work Streams</h4>
            <div className="tb-lookup-add-row">
              <input
                type="text"
                value={groupDraft}
                aria-label="Add work stream"
                onInput={(event) => setGroupDraft((event.currentTarget as HTMLInputElement).value)}
                placeholder="Add work stream"
              />
              <button type="button" className="tb-btn tb-btn-sm" onClick={() => handleAddEpicGroup()}>
                Add
              </button>
            </div>
            <div className="tb-lookup-item-list">
              {epicLookup.groups.length === 0 ? <span className="tb-chip">No work streams</span> : null}
              {epicLookup.groups.map((group) => (
                <div key={group.id} className="tb-lookup-item-row">
                  {editingGroupId === group.id ? (
                    <input
                      type="text"
                      value={editingGroupName}
                      aria-label={`Edit ${group.name}`}
                      onInput={(event) => setEditingGroupName((event.currentTarget as HTMLInputElement).value)}
                    />
                  ) : <span className="tb-chip">{group.name}</span>}
                  <div className="tb-action-row">
                    {editingGroupId === group.id ? (
                      <>
                        <button type="button" className="tb-btn tb-btn-sm" onClick={() => handleSaveEditedGroup()}>Save</button>
                        <button type="button" className="tb-btn tb-btn-sm" onClick={() => setEditingGroupId(null)}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button type="button" className="tb-btn tb-btn-sm" onClick={() => {
                          setEditingGroupId(group.id);
                          setEditingGroupName(group.name);
                        }}>Edit</button>
                        <button type="button" className="tb-btn tb-btn-sm tb-btn-danger" onClick={() => {
                          setPendingLookupDelete({ type: "group", id: group.id, name: group.name });
                        }}>Delete</button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="tb-lookup-card">
            <h4>Work Types</h4>
            <div className="tb-lookup-add-row">
              <input
                type="text"
                value={workTypeDraft}
                aria-label="Add work type"
                onInput={(event) => setWorkTypeDraft((event.currentTarget as HTMLInputElement).value)}
                placeholder="Add work type"
              />
              <button type="button" className="tb-btn tb-btn-sm" onClick={() => handleAddWorkType()}>
                Add
              </button>
            </div>
            <div className="tb-lookup-item-list">
              {epicLookup.workTypes.length === 0 ? <span className="tb-chip">No work types</span> : null}
              {epicLookup.workTypes.map((workType) => (
                <div key={workType.id} className="tb-lookup-item-row">
                  {editingWorkTypeId === workType.id ? (
                    <input
                      type="text"
                      value={editingWorkTypeName}
                      aria-label={`Edit ${workType.name}`}
                      onInput={(event) => setEditingWorkTypeName((event.currentTarget as HTMLInputElement).value)}
                    />
                  ) : <span className="tb-chip">{workType.name}</span>}
                  <div className="tb-action-row">
                    {editingWorkTypeId === workType.id ? (
                      <>
                        <button type="button" className="tb-btn tb-btn-sm" onClick={() => handleSaveEditedWorkType()}>Save</button>
                        <button type="button" className="tb-btn tb-btn-sm" onClick={() => setEditingWorkTypeId(null)}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button type="button" className="tb-btn tb-btn-sm" onClick={() => {
                          setEditingWorkTypeId(workType.id);
                          setEditingWorkTypeName(workType.name);
                        }}>Edit</button>
                        <button type="button" className="tb-btn tb-btn-sm tb-btn-danger" onClick={() => {
                          setPendingLookupDelete({ type: "workType", id: workType.id, name: workType.name });
                        }}>Delete</button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </article>
        </div>
      </section>

      {metaSuccess ? (
        <div className="tb-overlay-toast-layer" aria-live="polite" aria-atomic="true">
          <div className="tb-overlay-toast is-success">{metaSuccess}</div>
        </div>
      ) : null}

      {pendingLookupDelete ? (
        <div className="tb-modal-layer" role="dialog" aria-modal="true" aria-label="Confirm Metadata Delete">
          <div className="tb-modal-backdrop" onClick={() => {
            if (!lookupDeleteLoading) setPendingLookupDelete(null);
          }} />
          <div className="tb-modal">
            <header className="tb-modal-head">
              <h3>{pendingLookupDelete.type === "group" ? "Delete Work Stream" : "Delete Work Type"}</h3>
              <button
                type="button"
                className="tb-btn tb-btn-sm"
                onClick={() => setPendingLookupDelete(null)}
                disabled={lookupDeleteLoading}
              >Close</button>
            </header>
            <p className="tb-muted-note">
              Are you sure you want to delete <strong>{pendingLookupDelete.name}</strong>?
            </p>
            <p className="tb-muted-note">This change impacts all initiative forms that reference this value.</p>
            <footer className="tb-modal-actions">
              <button type="button" className="tb-btn" onClick={() => setPendingLookupDelete(null)} disabled={lookupDeleteLoading}>
                Cancel
              </button>
              <button type="button" className="tb-btn tb-btn-danger" onClick={() => confirmLookupDelete()} disabled={lookupDeleteLoading}>
                {lookupDeleteLoading ? "Deleting..." : "Delete"}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
