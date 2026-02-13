export type StudioBrainMode = "ok" | "degraded" | "offline";

export function isStudioBrainDegradedMode(mode?: StudioBrainMode | null): boolean {
  return mode === "degraded" || mode === "offline";
}
