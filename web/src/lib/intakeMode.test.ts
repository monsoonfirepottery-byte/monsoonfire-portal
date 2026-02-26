import { describe, expect, test } from "vitest";
import { isCommunityShelfIntakeMode, normalizeIntakeMode } from "./intakeMode";

describe("intakeMode helpers", () => {
  test("normalizes canonical intake modes", () => {
    expect(normalizeIntakeMode("SHELF_PURCHASE")).toBe("SHELF_PURCHASE");
    expect(normalizeIntakeMode("WHOLE_KILN")).toBe("WHOLE_KILN");
    expect(normalizeIntakeMode("COMMUNITY_SHELF")).toBe("COMMUNITY_SHELF");
  });

  test("maps legacy values to shelf purchase", () => {
    expect(normalizeIntakeMode("SELF_SERVICE")).toBe("SHELF_PURCHASE");
    expect(normalizeIntakeMode("STAFF_HANDOFF")).toBe("SHELF_PURCHASE");
  });

  test("supports fallback and community checks", () => {
    expect(normalizeIntakeMode("unknown", "WHOLE_KILN")).toBe("WHOLE_KILN");
    expect(isCommunityShelfIntakeMode("COMMUNITY_SHELF")).toBe(true);
    expect(isCommunityShelfIntakeMode("WHOLE_KILN")).toBe(false);
  });
});
