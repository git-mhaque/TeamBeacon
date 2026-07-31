export function getPreferenceSync(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export async function getPreference(key: string): Promise<string | null> {
  return getPreferenceSync(key);
}

export async function setPreference(key: string, value: string): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Browser preference persistence is best effort.
  }
}

export async function removePreference(key: string): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Browser preference persistence is best effort.
  }
}
