export const SURFACE_TAGS = [
  "glossy",
  "satin",
  "matte",
  "semi-matte",
] as const;

export const BEHAVIOR_TAGS = [
  "stable",
  "runny",
  "very-runny",
  "crawl",
  "pinholes",
  "crazes",
  "shivers",
  "breaks-on-edges",
  "crystals",
  "speckled",
] as const;

export const USE_TAGS = [
  "food-safe-unknown",
  "food-safe-yes",
  "food-safe-no",
  "texture",
  "translucent",
  "opaque",
  "celadon-ish",
  "iron-heavy",
  "cobalt-heavy",
] as const;

export const QUICK_TAGS = [
  "stable",
  "runny",
  "very-runny",
  "glossy",
  "matte",
  "breaks-on-edges",
] as const;

export const TAG_GROUPS = [
  {
    id: "surface",
    label: "Surface",
    tags: SURFACE_TAGS,
  },
  {
    id: "behavior",
    label: "Behavior",
    tags: BEHAVIOR_TAGS,
  },
  {
    id: "use",
    label: "Use / Notes",
    tags: USE_TAGS,
  },
] as const;

export const ALL_TAGS = [
  ...SURFACE_TAGS,
  ...BEHAVIOR_TAGS,
  ...USE_TAGS,
] as const;

export type GlazeTag = (typeof ALL_TAGS)[number];
