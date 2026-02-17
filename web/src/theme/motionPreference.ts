import type { PortalMotionMode } from "../context/UiSettingsContext";

type EnhancedMotionHeuristics = {
  likelyMobile: boolean;
  saveData: boolean;
  deviceMemory?: number | null;
  hardwareConcurrency?: number | null;
};

export function computeEnhancedMotionDefault(input: EnhancedMotionHeuristics): boolean {
  const lowMemory = typeof input.deviceMemory === "number" && input.deviceMemory <= 4;
  const lowCores = typeof input.hardwareConcurrency === "number" && input.hardwareConcurrency <= 4;
  const lowPower = lowMemory || lowCores;
  return !(input.likelyMobile || input.saveData || lowPower);
}

export function resolvePortalMotion(
  prefersReducedMotion: boolean,
  enhancedMotion: boolean
): PortalMotionMode {
  return prefersReducedMotion || !enhancedMotion ? "reduced" : "enhanced";
}

