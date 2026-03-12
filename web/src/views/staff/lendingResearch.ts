export type LendingResearchLink = {
  id: string;
  label: string;
  url: string;
};

export type LendingResearchSection = {
  id: string;
  title: string;
  policyNote: string;
  links: LendingResearchLink[];
};

type ResearchInput = {
  title?: string | null;
  authorsCsv?: string | null;
  isbn?: string | null;
  mediaType?: string | null;
};

const DISALLOWED_RETAIL_COVER_HOST_MARKERS = [
  "amazon.",
  "ssl-images-amazon.",
  "media-amazon.com",
  "ebay.",
  "ebayimg.com",
  "abebooks.",
  "thriftbooks.com",
  "alibris.com",
  "barnesandnoble.com",
  "powells.com",
] as const;

function cleanText(value: string | null | undefined): string {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function cleanIsbn(value: string | null | undefined): string {
  return cleanText(value).replace(/[^0-9xX]/g, "").toUpperCase();
}

function firstAuthor(authorsCsv: string | null | undefined): string {
  const raw = cleanText(authorsCsv);
  if (!raw) return "";
  return raw
    .split(/[\n,]+/g)
    .map((entry) => entry.trim())
    .find(Boolean) ?? "";
}

function encodeQuery(value: string): string {
  return encodeURIComponent(value.trim());
}

function buildSearchQuery(input: ResearchInput): string {
  const title = cleanText(input.title);
  const author = firstAuthor(input.authorsCsv);
  const isbn = cleanIsbn(input.isbn);
  if (isbn) {
    return [isbn, title, author].filter(Boolean).join(" ");
  }
  return [title, author].filter(Boolean).join(" ").trim();
}

function normalizeMediaType(value: string | null | undefined): string {
  return cleanText(value).toLowerCase().replace(/[\s-]+/g, "_");
}

export function isDisallowedRetailCoverUrl(value: string | null | undefined): boolean {
  const raw = cleanText(value);
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    return DISALLOWED_RETAIL_COVER_HOST_MARKERS.some((marker) => host.includes(marker));
  } catch {
    return false;
  }
}

export function buildLendingResearchSections(input: ResearchInput): LendingResearchSection[] {
  const searchQuery = buildSearchQuery(input);
  if (!searchQuery) return [];
  const isbn = cleanIsbn(input.isbn);
  const title = cleanText(input.title);
  const author = firstAuthor(input.authorsCsv);
  const mediaType = normalizeMediaType(input.mediaType);

  const catalogLinks: LendingResearchLink[] = [
    {
      id: "openlibrary",
      label: "Open Library",
      url: `https://openlibrary.org/search?${isbn ? `isbn=${encodeQuery(isbn)}` : `q=${encodeQuery(searchQuery)}`}`,
    },
    {
      id: "googlebooks",
      label: "Google Books",
      url: `https://books.google.com/books?q=${encodeQuery(searchQuery)}`,
    },
    {
      id: "loc",
      label: "Library of Congress",
      url: `https://www.loc.gov/search/?in=all&q=${encodeQuery(searchQuery)}`,
    },
    {
      id: "wikidata",
      label: "Wikidata",
      url: `https://www.wikidata.org/w/index.php?search=${encodeQuery(searchQuery)}`,
    },
    {
      id: "worldcat",
      label: "WorldCat",
      url: `https://search.worldcat.org/search?q=${encodeQuery(searchQuery)}`,
    },
  ];

  const manualLinks: LendingResearchLink[] = [
    {
      id: "google",
      label: "Google web",
      url: `https://www.google.com/search?q=${encodeQuery(searchQuery)}`,
    },
    {
      id: "amazon",
      label: "Amazon",
      url: `https://www.amazon.com/s?k=${encodeQuery(searchQuery)}`,
    },
    {
      id: "abebooks",
      label: "AbeBooks",
      url: `https://www.abebooks.com/servlet/SearchResults?kn=${encodeQuery(searchQuery)}`,
    },
    {
      id: "ebay",
      label: "eBay",
      url: `https://www.ebay.com/sch/i.html?_nkw=${encodeQuery(searchQuery)}`,
    },
  ];

  const sections: LendingResearchSection[] = [
    {
      id: "catalogs",
      title: "Catalogs and documented APIs",
      policyNote: "Best source for automation-safe metadata and approved covers.",
      links: catalogLinks,
    },
    {
      id: "manual",
      title: "Manual browser assist",
      policyNote: "Reference only. Capture factual metadata, not retailer copy, ratings, prices, or hosted cover images.",
      links: manualLinks,
    },
  ];

  if (["board_game", "tabletop_rpg", "video_game"].includes(mediaType) || /\brpg\b|\bgame\b/i.test(`${title} ${author}`)) {
    sections.push({
      id: "games",
      title: "Game and RPG reference",
      policyNote: "Use these for manual verification until Geek providers are enabled in production.",
      links: [
        {
          id: "boardgamegeek",
          label: "BoardGameGeek",
          url: `https://www.google.com/search?q=${encodeQuery(`site:boardgamegeek.com ${searchQuery}`)}`,
        },
        {
          id: "rpggeek",
          label: "RPGGeek",
          url: `https://www.google.com/search?q=${encodeQuery(`site:rpggeek.com ${searchQuery}`)}`,
        },
        {
          id: "videogamegeek",
          label: "VideoGameGeek",
          url: `https://www.google.com/search?q=${encodeQuery(`site:videogamegeek.com ${searchQuery}`)}`,
        },
      ],
    });
  }

  return sections;
}
