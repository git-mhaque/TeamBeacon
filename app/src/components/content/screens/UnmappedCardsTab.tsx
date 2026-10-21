import { ExternalLink, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchUnmappedCards, type UnmappedCard, type UnmappedCardsInventory } from "../../../lib/api";
import { formatDisplayDate, formatDisplayTimestamp } from "../../../lib/dateTime";

const COLUMNS = [
  ["issueKey", "Card"], ["summary", "Summary"], ["issueType", "Type"],
  ["status", "Status"], ["createdBy", "Created by"], ["createdAt", "Created on"],
] as const;
type SortField = typeof COLUMNS[number][0];

export function UnmappedCardsTab() {
  const [inventory, setInventory] = useState<UnmappedCardsInventory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [issueType, setIssueType] = useState("");
  const [sort, setSort] = useState<SortField>("createdAt");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void fetchUnmappedCards().then((data) => { if (!cancelled) setInventory(data); })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load unmapped cards."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [reload]);

  const cards = inventory?.cards ?? [];
  const rows = cards.filter((card) =>
    `${card.issueKey} ${card.summary} ${card.createdBy ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()) &&
    (!status || card.status === status) && (!issueType || card.issueType === issueType),
  ).sort((left, right) => {
    const value = (card: UnmappedCard) => sort === "createdAt" ? Date.parse(card.createdAt ?? "") || 0 : card[sort] ?? "";
    const a = value(left), b = value(right);
    const result = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
    return (result || left.issueKey.localeCompare(right.issueKey, undefined, { numeric: true })) * (direction === "asc" ? 1 : -1);
  });
  const jiraBaseUrl = /^https?:\/\//i.test(inventory?.jiraBaseUrl ?? "") ? inventory!.jiraBaseUrl!.replace(/\/+$/, "") : null;
  const link = (key: string) => jiraBaseUrl
    ? <a href={`${jiraBaseUrl}/browse/${encodeURIComponent(key)}`} target="_blank" rel="noopener noreferrer" className="tb-unmapped-jira-link" aria-label={`Open ${key} in JIRA (new tab)`}>{key}<ExternalLink size={13} aria-hidden="true" /></a>
    : key;
  const refresh = () => { setLoading(true); setError(""); setReload((value) => value + 1); };

  return <section className="tb-panel tb-unmapped-cards">
    <header className="tb-panel-header"><div>
      <h3>Unmapped cards</h3>
      <p className="tb-muted-note">Cards with no epic link in synced JIRA data. Open a card in JIRA to assign an epic; for subtasks, update the parent card.</p>
      <p className="tb-muted-note">Changes appear after the next JIRA sync. All statuses are included{inventory?.projectKey ? ` for ${inventory.projectKey}` : ""}.</p>
      <p className="tb-muted-note">Last successful JIRA sync: {formatDisplayTimestamp(inventory?.lastSyncedAt)}</p>
    </div><button type="button" className="tb-btn" onClick={refresh} disabled={loading}><RefreshCw size={16} aria-hidden="true" />{loading ? "Loading…" : "Refresh list"}</button></header>
    {error && <div role="alert" className="tb-error-note">{error} <button type="button" className="tb-btn" onClick={refresh} disabled={loading}>Retry loading</button></div>}
    {loading && <p role="status">Loading unmapped cards…</p>}
    {inventory && <>
      {!jiraBaseUrl && <p className="tb-muted-note">Configure the JIRA base URL to enable card links.</p>}
      <div className="tb-mapping-filters">
        <input aria-label="Search unmapped cards" placeholder="Search card, summary or creator" value={query} onChange={(event) => setQuery(event.target.value)} />
        <select aria-label="Card status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option>{[...new Set(cards.map((card) => card.status))].sort().map((value) => <option key={value}>{value}</option>)}</select>
        <select aria-label="Card type" value={issueType} onChange={(event) => setIssueType(event.target.value)}><option value="">All types</option>{[...new Set(cards.map((card) => card.issueType).filter((value): value is string => Boolean(value)))].sort().map((value) => <option key={value}>{value}</option>)}</select>
        {(query || status || issueType) && <button type="button" className="tb-btn" onClick={() => { setQuery(""); setStatus(""); setIssueType(""); }}>Clear filters</button>}
      </div>
      <p className="tb-muted-note" role="status">{rows.length} of {inventory.count} unmapped cards</p>
      {rows.length > 0 ? (
        <div className="tb-mapping-table" role="region" aria-label="Unmapped cards table" tabIndex={0}>
          <table><caption className="tb-visually-hidden">Synced cards without a direct or inherited epic link</caption><thead><tr>{COLUMNS.map(([field, label]) => <th key={field} scope="col" aria-sort={sort === field ? direction === "asc" ? "ascending" : "descending" : undefined}>
            <button type="button" className={`tb-table-sort${sort === field ? " is-active" : ""}`} aria-label={`Sort by ${label}`} onClick={() => { setDirection(sort === field && direction === "asc" ? "desc" : "asc"); setSort(field); }}><span>{label}</span><span className="tb-table-sort-indicator" aria-hidden="true">{sort === field ? direction === "asc" ? "↑" : "↓" : "↕"}</span></button>
          </th>)}</tr></thead><tbody>{rows.map((card) => <tr key={card.issueKey}>
            <td>{link(card.issueKey)}</td><td>{card.summary}</td><td>{card.issueType || "—"}</td><td>{card.status}</td><td>{card.createdBy || "Unknown"}</td>
            <td>{formatDisplayDate(card.createdAt, "—")}</td>
          </tr>)}</tbody></table>
        </div>
      ) : <p>{cards.length ? "No cards match these filters." : "No unmapped cards found in synced data."}</p>}
    </>}
  </section>;
}
