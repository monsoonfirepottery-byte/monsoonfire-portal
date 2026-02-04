import { describe, expect, it } from "vitest";
import { createEmptyTagFilters, matchesComboFilters } from "./filters";

describe("matchesComboFilters", () => {
  it("uses OR within a category and AND across categories", () => {
    const tagsByGroup = createEmptyTagFilters();
    tagsByGroup.surface = ["glossy", "satin"];
    tagsByGroup.behavior = ["stable"];

    expect(
      matchesComboFilters(
        { hasPhoto: false, hasNotes: false, flags: ["satin", "stable"] },
        { requirePhoto: false, requireNotes: false, tagsByGroup }
      )
    ).toBe(true);

    expect(
      matchesComboFilters(
        { hasPhoto: false, hasNotes: false, flags: ["glossy"] },
        { requirePhoto: false, requireNotes: false, tagsByGroup }
      )
    ).toBe(false);
  });

  it("honors has-photo and has-notes toggles", () => {
    const tagsByGroup = createEmptyTagFilters();

    expect(
      matchesComboFilters(
        { hasPhoto: true, hasNotes: false, flags: [] },
        { requirePhoto: true, requireNotes: false, tagsByGroup }
      )
    ).toBe(true);

    expect(
      matchesComboFilters(
        { hasPhoto: false, hasNotes: true, flags: [] },
        { requirePhoto: true, requireNotes: false, tagsByGroup }
      )
    ).toBe(false);

    expect(
      matchesComboFilters(
        { hasPhoto: true, hasNotes: false, flags: [] },
        { requirePhoto: false, requireNotes: true, tagsByGroup }
      )
    ).toBe(false);
  });
});
