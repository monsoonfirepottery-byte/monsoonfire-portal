import { safeReadBoolean, safeStorageSetItem } from "../lib/safeStorage";

const STORAGE_KEY = "mf:enhancedMotion";

export function readStoredEnhancedMotion(defaultValue: boolean): boolean {
  if (typeof window === "undefined") return defaultValue;
  return safeReadBoolean("localStorage", STORAGE_KEY, defaultValue);
}

export function writeStoredEnhancedMotion(enabled: boolean): void {
  if (typeof window === "undefined") return;
  safeStorageSetItem("localStorage", STORAGE_KEY, enabled ? "1" : "0");
}
