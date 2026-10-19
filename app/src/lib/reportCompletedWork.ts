export type CompletedWorkSource = {
  cardId: string;
  group: string;
  epicKey: string;
  epicName: string;
  issueKey: string;
  issueTitle: string;
};

export type CompletedWorkBullet = {
  text: string;
  source?: CompletedWorkSource;
};

export type CompletedWorkSummaryGroup = {
  group: string;
  bullets: CompletedWorkBullet[];
};

// Preserve synced titles and source metadata without model-generated text.
export function groupCompletedWork(sources: CompletedWorkSource[]): CompletedWorkSummaryGroup[] {
  const groups = new Map<string, CompletedWorkBullet[]>();
  for (const source of sources) {
    const bullets = groups.get(source.group) ?? [];
    bullets.push({ text: source.issueTitle.trim() || "No summary provided.", source });
    groups.set(source.group, bullets);
  }
  return [...groups].map(([group, bullets]) => ({ group, bullets }));
}

export function reportJiraIssueUrl(baseUrl: string | null, key: string): string | null {
  if (!baseUrl || !key.trim()) return null;
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return `${baseUrl.replace(/\/+$/, "")}/browse/${encodeURIComponent(key)}`;
  } catch {
    return null;
  }
}

// Keep each epic together within a work stream, preserving first-seen order.
export function groupCompletedWorkByEpic(bullets: CompletedWorkBullet[]): Array<{
  epicKey: string | null;
  epicName: string;
  bullets: CompletedWorkBullet[];
}> {
  const groups = new Map<string | null, { epicKey: string | null; epicName: string; bullets: CompletedWorkBullet[] }>();
  for (const bullet of bullets) {
    const epicKey = bullet.source?.epicKey ?? null;
    const group = groups.get(epicKey) ?? { epicKey, epicName: bullet.source?.epicName ?? "", bullets: [] };
    group.bullets.push(bullet);
    groups.set(epicKey, group);
  }
  return [...groups.values()];
}
