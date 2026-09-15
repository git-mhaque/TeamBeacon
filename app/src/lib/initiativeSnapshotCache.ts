const MAX_AGE_MS = 24 * 60 * 60 * 1000;

type SnapshotEntry<T> = {
  createdAt: number;
  value: T;
};

const snapshots = new Map<string, SnapshotEntry<unknown>>();

export function buildInitiativeSnapshotKey(input: {
  periodStart: string;
  periodEnd: string;
  timezone: string;
  viewId: number | "all";
}): string {
  return JSON.stringify(input);
}

export function readInitiativeSnapshot<T>(key: string, now = Date.now()): T | null {
  const entry = snapshots.get(key);
  if (!entry || now - entry.createdAt >= MAX_AGE_MS) {
    snapshots.delete(key);
    return null;
  }
  return entry.value as T;
}

export function writeInitiativeSnapshot<T>(key: string, value: T, now = Date.now()): void {
  snapshots.set(key, { createdAt: now, value });
}

export function clearInitiativeSnapshots(): void {
  snapshots.clear();
}
