import { describe, expect, it } from "vitest";

import { filterVisibleAnnouncements, isQaAnnouncement } from "./announcements";

describe("isQaAnnouncement", () => {
  it("recognizes the legacy QA fixture prefix", () => {
    expect(
      isQaAnnouncement({
        id: "qa-fixture-studio-update-20260312",
      })
    ).toBe(true);
  });

  it("recognizes the older QA seed prefix", () => {
    expect(
      isQaAnnouncement({
        id: "qa-studio-update-1772066906760",
      })
    ).toBe(true);
  });

  it("recognizes explicit QA metadata", () => {
    expect(
      isQaAnnouncement({
        id: "announcement-1",
        source: "qa_fixture",
      })
    ).toBe(true);

    expect(
      isQaAnnouncement({
        id: "announcement-2",
        audience: "qa",
      })
    ).toBe(true);
  });

  it("keeps legacy member-facing announcements visible", () => {
    expect(
      isQaAnnouncement({
        id: "announcement-3",
        source: "daily_digest",
        audience: "members",
      })
    ).toBe(false);
  });
});

describe("filterVisibleAnnouncements", () => {
  it("filters QA fixture items and keeps member updates", () => {
    expect(
      filterVisibleAnnouncements([
        { id: "qa-fixture-studio-update-20260312" },
        { id: "qa-studio-update-1772066906760" },
        { id: "announcement-1", source: "qa_fixture" },
        { id: "announcement-2", audience: "qa" },
        { id: "announcement-3", source: "daily_digest", audience: "members" },
        { id: "announcement-4" },
      ])
    ).toEqual([
      { id: "announcement-3", source: "daily_digest", audience: "members" },
      { id: "announcement-4" },
    ]);
  });
});
