/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext } from "react";
import type { PortalThemeName } from "../theme/themes";

export type PortalMotionMode = "enhanced" | "reduced";

type UiSettings = {
  themeName: PortalThemeName;
  portalMotion: PortalMotionMode;
  enhancedMotion: boolean;
  prefersReducedMotion: boolean;
};

const UiSettingsContext = createContext<UiSettings | null>(null);

export function UiSettingsProvider({
  value,
  children,
}: {
  value: UiSettings;
  children: React.ReactNode;
}) {
  return <UiSettingsContext.Provider value={value}>{children}</UiSettingsContext.Provider>;
}

export function useUiSettings(): UiSettings {
  const ctx = useContext(UiSettingsContext);
  if (!ctx) {
    // Keep the app resilient if a view is ever rendered outside App's provider.
    return {
      themeName: "portal",
      portalMotion: "reduced",
      enhancedMotion: false,
      prefersReducedMotion: false,
    };
  }
  return ctx;
}
