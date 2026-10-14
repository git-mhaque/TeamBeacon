import { useEffect, useState } from "react";
import { fetchEpicMappingInventory, fetchJiraIntegrationStatus, saveEpicMappings, type EpicLookupConfig, type EpicMappingInventory } from "../../../lib/api";

import { formatDisplayTimestamp } from "../../../lib/dateTime";

const PAGE_SIZE = 50;
export function EpicMappingTab({ lookup }: { lookup: EpicLookupConfig }) {
  const [inventory, setInventory] = useState<EpicMappingInventory | null>(null);
  const [jiraBaseUrl, setJiraBaseUrl] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, number | null>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [mappingFilter, setMappingFilter] = useState("all");
  const [streamFilter, setStreamFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sort, setSort] = useState("unmapped");
  const [page, setPage] = useState(0);
  const [bulkStream, setBulkStream] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const pending = Object.keys(draft).length;
  const load = async () => {
    setError("");
    try { setInventory(await fetchEpicMappingInventory()); }
    catch (err) { setError((err as Error).message); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    let cancelled = false;
    void fetchJiraIntegrationStatus().then((status) => {
      if (!cancelled) setJiraBaseUrl(status.config.baseUrl?.replace(/\/+$/, "") ?? null);
    }).catch(() => { /* Mapping remains available when JIRA status cannot be loaded. */ });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const navigate = (event: Event) => {
      if (saving || !window.confirm("Discard unsaved epic mapping changes?")) event.preventDefault();
    };
    if (pending || saving) {
      window.addEventListener("beforeunload", unload);
      window.addEventListener("tb-before-navigation", navigate);
    }
    return () => {
      window.removeEventListener("beforeunload", unload);
      window.removeEventListener("tb-before-navigation", navigate);
    };
  }, [pending, saving]);
  const epics = inventory?.epics ?? [];
  const mapped = epics.filter((epic) => epic.workStreamId !== null).length;
  const rows = epics.filter((epic) =>
    `${epic.epicKey} ${epic.title}`.toLowerCase().includes(query.toLowerCase()) &&
    (mappingFilter === "all" || (mappingFilter === "mapped" ? epic.workStreamId !== null : epic.workStreamId === null)) &&
    (streamFilter === "all" || epic.workStreamId === Number(streamFilter)) &&
    (statusFilter === "all" || epic.status === statusFilter),
  ).sort((a, b) => {
    if (sort === "unmapped") return Number(a.workStreamId !== null) - Number(b.workStreamId !== null) || a.epicKey.localeCompare(b.epicKey);
    if (sort === "title") return a.title.localeCompare(b.title);
    if (sort === "status") return a.status.localeCompare(b.status) || a.epicKey.localeCompare(b.epicKey);
    return a.epicKey.localeCompare(b.epicKey);
  });
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / PAGE_SIZE) - 1));
  const visible = rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const change = (keys: string[], value: number | null) => {
    setMessage("");
    setDraft((previous) => {
      const next = { ...previous };
      keys.forEach((key) => {
        if (epics.find((epic) => epic.epicKey === key)?.workStreamId === value) delete next[key];
        else next[key] = value;
      });
      return next;
    });
  };
  const save = async () => {
    setSaving(true); setError(""); setMessage("");
    try {
      const result = await saveEpicMappings(Object.entries(draft).map(([epicKey, workStreamId]) => ({
        epicKey, workStreamId, expectedWorkStreamId: epics.find((epic) => epic.epicKey === epicKey)!.workStreamId,
      })));
      setInventory((previous) => previous && ({ ...previous, epics: previous.epics.map((epic) =>
        Object.hasOwn(draft, epic.epicKey) ? { ...epic, workStreamId: draft[epic.epicKey] } : epic) }));
      setDraft({}); setSelected([]); setMessage(`Saved ${result.savedCount} epic mappings.`);
    } catch (err) { setError((err as Error).message); }
    finally { setSaving(false); }
  };
  const filter = (update: () => void) => { update(); setPage(0); };
  return <section className="tb-panel tb-epic-mapping">
    <header className="tb-panel-header"><div><h3>Work Stream Epic Mapping</h3>
      <p className="tb-muted-note">Assign work streams to locally synced JIRA epics. Changes are saved together.</p>
      <p className="tb-muted-note">Last successful JIRA sync: {formatDisplayTimestamp(inventory?.lastSyncedAt)}</p>
    </div></header>
    {error && <p role="alert" className="tb-error-note">{error}</p>}
    {message && <p role="status">{message}</p>}
    {!inventory ? <><p>{error ? "Inventory unavailable." : "Loading epics…"}</p><button className="tb-btn" onClick={() => void load()}>Retry loading</button></> : <>
      <div className="tb-mapping-stats">
        <button onClick={() => filter(() => setMappingFilter("all"))}>Total epics<strong>{epics.length}</strong></button>
        <button onClick={() => filter(() => setMappingFilter("mapped"))}>Mapped epics<strong>{mapped}</strong></button>
        <button onClick={() => filter(() => setMappingFilter("unmapped"))}>Unmapped epics<strong>{epics.length - mapped}</strong></button>
        <div>Mapping coverage<strong>{epics.length ? Math.round(mapped / epics.length * 100) : 0}%</strong></div>
      </div>
      <details className="tb-mapping-distribution" open><summary>Work stream distribution · saved assignments</summary>
        {[...lookup.groups, { id: null, name: "Unmapped" }].map((stream) => {
          const count = epics.filter((epic) => epic.workStreamId === stream.id).length;
          return <div key={stream.id ?? "unmapped"}><span>{stream.name}</span><progress max={epics.length || 1} value={count} aria-label={`${stream.name} epic count`} /><span>{count} ({epics.length ? Math.round(count / epics.length * 100) : 0}%)</span></div>;
        })}
      </details>
      <div className="tb-mapping-filters">
        <input aria-label="Search epics" placeholder="Search epic key or title" value={query} onChange={(event) => filter(() => setQuery(event.target.value))} />
        <select aria-label="Mapping filter" value={mappingFilter} onChange={(event) => filter(() => setMappingFilter(event.target.value))}><option value="all">All epics</option><option value="unmapped">Unmapped</option><option value="mapped">Mapped</option></select>
        <select aria-label="Work stream filter" value={streamFilter} onChange={(event) => filter(() => setStreamFilter(event.target.value))}><option value="all">All work streams</option>{lookup.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select>
        <select aria-label="Status filter" value={statusFilter} onChange={(event) => filter(() => setStatusFilter(event.target.value))}><option value="all">All statuses</option>{[...new Set(epics.map((epic) => epic.status))].sort().map((status) => <option key={status}>{status}</option>)}</select>
        <select aria-label="Sort epics" value={sort} onChange={(event) => setSort(event.target.value)}><option value="unmapped">Unmapped first</option><option value="key">Epic key</option><option value="title">Title</option><option value="status">Status</option></select>
      </div>
      <fieldset disabled={saving} className="tb-mapping-editor">
        <div className="tb-action-row"><span>{selected.length} selected across pages</span>
          <select aria-label="Bulk work stream" value={bulkStream} onChange={(event) => setBulkStream(event.target.value)}><option value="">Choose work stream</option><option value="unmapped">Unmapped</option>{lookup.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select>
          <button className="tb-btn" disabled={!selected.length || !bulkStream} onClick={() => change(selected, bulkStream === "unmapped" ? null : Number(bulkStream))}>Apply to selected</button>
          <button className="tb-btn" disabled={!selected.length} onClick={() => setSelected([])}>Clear selection</button>
        </div>
        <p className="tb-muted-note">Filters and statistics use saved assignments. Edited rows remain visible until saved.</p>
        <div className="tb-mapping-table"><table><thead><tr>
          <th><input type="checkbox" aria-label="Select this page" checked={visible.length > 0 && visible.every((epic) => selected.includes(epic.epicKey))} onChange={(event) => setSelected((previous) => event.target.checked ? [...new Set([...previous, ...visible.map((epic) => epic.epicKey)])] : previous.filter((key) => !visible.some((epic) => epic.epicKey === key)))} /></th>
          <th>Epic key</th><th>Title</th><th>Status</th><th>Work stream</th><th>Changes</th>
        </tr></thead><tbody>{visible.map((epic) => <tr key={epic.epicKey} className={Object.hasOwn(draft, epic.epicKey) ? "is-edited" : ""}>
          <td><input type="checkbox" aria-label={`Select ${epic.epicKey}`} checked={selected.includes(epic.epicKey)} onChange={(event) => setSelected((previous) => event.target.checked ? [...previous, epic.epicKey] : previous.filter((key) => key !== epic.epicKey))} /></td>
          <td>{jiraBaseUrl ? <a href={`${jiraBaseUrl}/browse/${encodeURIComponent(epic.epicKey)}`} target="_blank" rel="noopener noreferrer" className="tb-initiative-epic-key" aria-label={`Open ${epic.epicKey} in JIRA (new tab)`}>{epic.epicKey}</a> : epic.epicKey}</td><td>{epic.title}</td><td>{epic.status}</td>
          <td><select aria-label={`Work stream for ${epic.epicKey}`} value={(Object.hasOwn(draft, epic.epicKey) ? draft[epic.epicKey] : epic.workStreamId) ?? "unmapped"} onChange={(event) => change([epic.epicKey], event.target.value === "unmapped" ? null : Number(event.target.value))}><option value="unmapped">Unmapped</option>{lookup.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></td>
          <td>{Object.hasOwn(draft, epic.epicKey) ? "Unsaved" : epic.workStreamId === null ? "Unmapped" : "—"}</td>
        </tr>)}</tbody></table></div>
        {!rows.length && <p>No epics match these filters.</p>}
        <div className="tb-action-row"><button className="tb-btn" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><span>Page {currentPage + 1} of {Math.max(1, Math.ceil(rows.length / PAGE_SIZE))} · {rows.length} epics</span><button className="tb-btn" disabled={(currentPage + 1) * PAGE_SIZE >= rows.length} onClick={() => setPage(currentPage + 1)}>Next</button></div>
        <footer className="tb-mapping-save"><span>{pending} unsaved changes</span><button className="tb-btn" disabled={!pending} onClick={() => { setDraft({}); setMessage(""); }}>Discard changes</button><button className="tb-btn tb-btn-primary" disabled={!pending || pending > 1000} onClick={() => void save()}>{saving ? "Saving…" : "Save changes"}</button>{pending > 1000 && <span>Save up to 1000 changes per batch.</span>}</footer>
      </fieldset>
      <button className="tb-btn" disabled={saving} onClick={() => { if (!pending || window.confirm("Discard unsaved changes and reload inventory?")) { setDraft({}); setSelected([]); void load(); } }}>Reload inventory</button>
    </>}
  </section>;
}
