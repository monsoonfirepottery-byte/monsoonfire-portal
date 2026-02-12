import { describe, expect, it } from "vitest";
import { computeEnhancedMotionDefault, resolvePortalMotion } from "./motionPreference";

describe("motion preference helpers", () => {
  it("defaults to reduced on constrained devices", () => {
    expect(
      computeEnhancedMotionDefault({
        likelyMobile: true,
        saveData: false,
        deviceMemory: 8,
        hardwareConcurrency: 8,
      })
    ).toBe(false);

    expect(
      computeEnhancedMotionDefault({
        likelyMobile: false,
        saveData: true,
        deviceMemory: 8,
        hardwareConcurrency: 8,
      })
    ).toBe(false);

    expect(
      computeEnhancedMotionDefault({
        likelyMobile: false,
        saveData: false,
        deviceMemory: 4,
        hardwareConcurrency: 8,
      })
    ).toBe(false);

    expect(
      computeEnhancedMotionDefault({
        likelyMobile: false,
        saveData: false,
        deviceMemory: 8,
        hardwareConcurrency: 4,
      })
    ).toBe(false);
  });

  it("defaults to enhanced on capable desktop profile", () => {
    expect(
      computeEnhancedMotionDefault({
        likelyMobile: false,
        saveData: false,
        deviceMemory: 8,
        hardwareConcurrency: 8,
      })
    ).toBe(true);
  });

  it("resolves final portal motion mode with reduced-motion precedence", () => {
    expect(resolvePortalMotion(true, true)).toBe("reduced");
    expect(resolvePortalMotion(true, false)).toBe("reduced");
    expect(resolvePortalMotion(false, false)).toBe("reduced");
    expect(resolvePortalMotion(false, true)).toBe("enhanced");
  });
});

