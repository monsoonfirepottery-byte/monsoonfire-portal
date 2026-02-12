import type { CSSProperties } from "react";

export type PortalThemeName = "portal" | "memoria";

export const DEFAULT_PORTAL_THEME: PortalThemeName = "portal";

export function isPortalThemeName(value: unknown): value is PortalThemeName {
  return value === "portal" || value === "memoria";
}

export const portalTheme = {
  "--text": "#1b1a17",
  "--muted": "#6b6256",
  "--bg": "#f7f1e8",
  "--bg-2": "#efe5d8",
  "--surface": "#ffffff",
  "--surface-strong": "#ffffff",
  "--surface-2": "#f7f1e8",
  "--surface-3": "#efe5d8",
  "--border-soft": "rgba(27, 26, 23, 0.08)",
  "--border": "rgba(27, 26, 23, 0.12)",
  "--border-strong": "rgba(27, 26, 23, 0.2)",
  "--accent": "#b44f35",
  "--accent-soft": "#9d412b",
  "--accent-2": "#c46a50",
  "--accent-3": "#6b6256",
  "--shadow": "0 10px 26px rgba(27, 26, 23, 0.08)",
  "--shadow-soft": "0 6px 16px rgba(27, 26, 23, 0.06)",
  "--shadow-card": "0 10px 26px rgba(27, 26, 23, 0.08)",
  "--shadow-card-hover": "0 14px 34px rgba(27, 26, 23, 0.10)",
  "--shadow-card-dashboard": "0 16px 40px rgba(27, 26, 23, 0.12)",
  "--shadow-card-dashboard-hover": "0 22px 56px rgba(27, 26, 23, 0.14)",
  "--focus-ring": "rgba(180, 79, 53, 0.45)",
  "--display-font": "\"Bebas Neue\", \"Impact\", sans-serif",
  "--body-font": "\"Fraunces\", \"Georgia\", serif",
  "--ui-font": "\"Segoe UI\", \"Helvetica Neue\", Arial, sans-serif",
  "--radius-lg": "20px",
  "--radius-md": "12px",
  "--radius-sm": "8px",
} as CSSProperties;

export const memoriaTheme = {
  "--text": "rgba(255, 255, 255, 0.92)",
  "--muted": "rgba(255, 255, 255, 0.64)",
  "--bg": "#0b0d0f",
  "--bg-2": "#0f1215",
  "--surface": "#121518",
  "--surface-strong": "#171b1f",
  "--surface-2": "#14181c",
  "--surface-3": "#171b1f",
  "--border-soft": "rgba(255, 255, 255, 0.06)",
  "--border": "rgba(255, 255, 255, 0.10)",
  "--border-strong": "rgba(255, 255, 255, 0.16)",
  "--accent": "rgba(255, 255, 255, 0.92)",
  "--accent-soft": "rgba(255, 255, 255, 0.74)",
  "--accent-2": "rgba(255, 255, 255, 0.84)",
  "--accent-3": "rgba(255, 255, 255, 0.64)",
  "--shadow": "0 10px 26px rgba(0, 0, 0, 0.35)",
  "--shadow-soft": "0 6px 16px rgba(0, 0, 0, 0.28)",
  "--shadow-card": "0 16px 44px rgba(0, 0, 0, 0.55), 0 6px 18px rgba(0, 0, 0, 0.34), inset 0 1px 0 rgba(255, 255, 255, 0.05)",
  "--shadow-card-hover": "0 24px 70px rgba(0, 0, 0, 0.62), 0 10px 30px rgba(0, 0, 0, 0.42), inset 0 1px 0 rgba(255, 255, 255, 0.06)",
  "--shadow-card-dashboard": "0 18px 46px rgba(0, 0, 0, 0.52), 0 6px 18px rgba(0, 0, 0, 0.34), inset 0 1px 0 rgba(255, 255, 255, 0.05)",
  "--shadow-card-dashboard-hover": "0 26px 70px rgba(0, 0, 0, 0.62), 0 10px 30px rgba(0, 0, 0, 0.42), inset 0 1px 0 rgba(255, 255, 255, 0.06)",
  "--focus-ring": "rgba(255, 255, 255, 0.22)",
  "--display-font": "\"Segoe UI\", system-ui, -apple-system, Arial, sans-serif",
  "--body-font": "\"Segoe UI\", system-ui, -apple-system, Arial, sans-serif",
  "--ui-font": "\"Segoe UI\", system-ui, -apple-system, Arial, sans-serif",
  "--radius-lg": "16px",
  "--radius-md": "12px",
  "--radius-sm": "10px",
} as CSSProperties;

export const PORTAL_THEMES: Record<PortalThemeName, CSSProperties> = {
  portal: portalTheme,
  memoria: memoriaTheme,
};
