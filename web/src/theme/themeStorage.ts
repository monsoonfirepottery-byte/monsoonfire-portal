import { DEFAULT_PORTAL_THEME, isPortalThemeName, type PortalThemeName } from "./themes";
import { safeStorageGetItem, safeStorageSetItem } from "../lib/safeStorage";

const STORAGE_KEY = "mf:portalTheme";

export function readStoredPortalTheme(): PortalThemeName {
  if (typeof window === "undefined") return DEFAULT_PORTAL_THEME;
  const raw = safeStorageGetItem("localStorage", STORAGE_KEY);
  return isPortalThemeName(raw) ? raw : DEFAULT_PORTAL_THEME;
}

export function writeStoredPortalTheme(theme: PortalThemeName): void {
  if (typeof window === "undefined") return;
  safeStorageSetItem("localStorage", STORAGE_KEY, theme);
}
