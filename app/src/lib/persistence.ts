type TauriInvoke = (command: string, payload?: Record<string, unknown>) => Promise<unknown>;

function resolveTauriInvoke(): TauriInvoke | null {
  if (typeof window === "undefined") return null;
  const candidate = (window as unknown as { __TAURI_INTERNALS__?: { invoke?: TauriInvoke } }).__TAURI_INTERNALS__;
  if (!candidate || typeof candidate.invoke !== "function") return null;
  return candidate.invoke;
}

export function getPreferenceSync(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export async function getPreference(key: string): Promise<string | null> {
  const localValue = getPreferenceSync(key);
  if (localValue !== null) return localValue;

  const invoke = resolveTauriInvoke();
  if (!invoke) return null;

  try {
    const value = await invoke("prefs_get", { key });
    if (typeof value === "string") return value;
    return null;
  } catch {
    return null;
  }
}

export async function setPreference(key: string, value: string): Promise<void> {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Fall through to Tauri fallback.
    }
  }

  const invoke = resolveTauriInvoke();
  if (!invoke) return;

  try {
    await invoke("prefs_set", { key, value });
  } catch {
    // Best-effort persistence only.
  }
}

export async function removePreference(key: string): Promise<void> {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Fall through to Tauri fallback.
    }
  }

  const invoke = resolveTauriInvoke();
  if (!invoke) return;

  try {
    await invoke("prefs_remove", { key });
  } catch {
    // Best-effort persistence only.
  }
}
