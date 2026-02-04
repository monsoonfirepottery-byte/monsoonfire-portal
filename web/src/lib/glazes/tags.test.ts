import { describe, expect, test } from "vitest";
import { ALL_TAGS, QUICK_TAGS, TAG_GROUPS } from "./tags";

describe("glaze tags", () => {
  test("quick tags are valid tag values", () => {
    const all = new Set(ALL_TAGS);
    QUICK_TAGS.forEach((tag) => {
      expect(all.has(tag)).toBe(true);
    });
  });

  test("all tags are unique", () => {
    const unique = new Set(ALL_TAGS);
    expect(unique.size).toBe(ALL_TAGS.length);
  });

  test("tag groups cover all tags", () => {
    const groupTags = TAG_GROUPS.flatMap((group) => group.tags);
    const grouped = new Set(groupTags);
    expect(groupTags.length).toBe(grouped.size);
    ALL_TAGS.forEach((tag) => {
      expect(grouped.has(tag)).toBe(true);
    });
  });
});
