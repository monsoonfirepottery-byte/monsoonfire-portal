import { DEFAULT_PORTAL_THEME, isPortalThemeName, type PortalThemeName } from "./themes";

const STORAGE_KEY = "mf:portalTheme";

export function readStoredPortalTheme(): PortalThemeName {
  if (typeof window === "undefined") return DEFAULT_PORTAL_THEME;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isPortalThemeName(raw) ? raw : DEFAULT_PORTAL_THEME;
  } catch {
    return DEFAULT_PORTAL_THEME;
  }
}

export function writeStoredPortalTheme(theme: PortalThemeName): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Ignore storage errors (private browsing, disabled storage).
  }
}

