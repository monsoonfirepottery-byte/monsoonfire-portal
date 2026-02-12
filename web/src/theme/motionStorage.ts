const STORAGE_KEY = "mf:enhancedMotion";

export function readStoredEnhancedMotion(defaultValue: boolean): boolean {
  if (typeof window === "undefined") return defaultValue;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "1") return true;
    if (raw === "0") return false;
    return defaultValue;
  } catch {
    return defaultValue;
  }
}

export function writeStoredEnhancedMotion(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // ignore
  }
}

