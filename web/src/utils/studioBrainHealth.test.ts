import { describe, expect, it } from "vitest";
import { isStudioBrainDegradedMode } from "./studioBrainHealth";

describe("studioBrainHealth", () => {
  it("flags degraded and offline modes", () => {
    expect(isStudioBrainDegradedMode("degraded")).toBe(true);
    expect(isStudioBrainDegradedMode("offline")).toBe(true);
  });

  it("does not flag ok or unknown modes", () => {
    expect(isStudioBrainDegradedMode("ok")).toBe(false);
    expect(isStudioBrainDegradedMode(null)).toBe(false);
    expect(isStudioBrainDegradedMode(undefined)).toBe(false);
  });
});
