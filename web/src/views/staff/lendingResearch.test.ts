import { describe, expect, it } from "vitest";

import { buildLendingResearchSections, isDisallowedRetailCoverUrl } from "./lendingResearch";

describe("lendingResearch", () => {
  it("builds catalog and manual research sections from title, author, and isbn", () => {
    const sections = buildLendingResearchSections({
      title: "The Incal",
      authorsCsv: "Alejandro Jodorowsky, Moebius",
      isbn: "9781594650932",
      mediaType: "comic",
    });

    expect(sections.map((section) => section.id)).toEqual(["catalogs", "manual"]);
    expect(sections[0]?.links.map((link) => link.label)).toContain("Open Library");
    expect(sections[1]?.links.map((link) => link.label)).toContain("Amazon");
    expect(sections[0]?.links.find((link) => link.id === "openlibrary")?.url).toContain("isbn=9781594650932");
  });

  it("adds game-specific references for tabletop and game media", () => {
    const sections = buildLendingResearchSections({
      title: "Vecna Reborn",
      authorsCsv: "Monte Cook",
      mediaType: "tabletop_rpg",
    });

    expect(sections.map((section) => section.id)).toContain("games");
    expect(sections.find((section) => section.id === "games")?.links.map((link) => link.label)).toEqual([
      "BoardGameGeek",
      "RPGGeek",
      "VideoGameGeek",
    ]);
  });

  it("flags retail-hosted cover urls as disallowed", () => {
    expect(isDisallowedRetailCoverUrl("https://m.media-amazon.com/images/I/cover.jpg")).toBe(true);
    expect(isDisallowedRetailCoverUrl("https://i.ebayimg.com/images/g/123/s-l1600.jpg")).toBe(true);
    expect(isDisallowedRetailCoverUrl("https://covers.openlibrary.org/b/id/123-M.jpg")).toBe(false);
  });
});
