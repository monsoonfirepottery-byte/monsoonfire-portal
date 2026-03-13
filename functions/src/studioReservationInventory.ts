export type StudioReservationInventoryResourceSeed = {
  id: string;
  label: string;
  active: boolean;
};

export type StudioReservationInventoryTemplateSeed = {
  id: string;
  label: string;
  daysOfWeek: number[];
  windowStart: string;
  windowEnd: string;
  slotDurationMinutes: number;
  slotIncrementMinutes: number;
  cleanupBufferMinutes: number;
  leadTimeMinutes: number;
  maxAdvanceDays: number;
};

export type StudioReservationInventorySpaceSeed = {
  id: string;
  slug: string;
  name: string;
  category: string;
  description: string;
  memberHelpText: string;
  bookingMode: "capacity" | "resource";
  active: boolean;
  capacity: number | null;
  colorToken: string;
  sortOrder: number;
  resources: StudioReservationInventoryResourceSeed[];
  templates: StudioReservationInventoryTemplateSeed[];
  timezone: "America/Phoenix";
};

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const DEFAULT_WINDOW_START = "10:00";
const DEFAULT_WINDOW_END = "19:00";
const DEFAULT_LEAD_TIME_MINUTES = 60;
const DEFAULT_MAX_ADVANCE_DAYS = 28;

function normalizeInventoryTitle(value: string): string {
  return String(value).replace(/\s*\/\s*/g, " & ").trim();
}

function createTemplate(
  id: string,
  label: string,
  slotDurationMinutes: number,
  slotIncrementMinutes: number,
  cleanupBufferMinutes = 15
): StudioReservationInventoryTemplateSeed {
  return {
    id,
    label,
    daysOfWeek: [...EVERY_DAY],
    windowStart: DEFAULT_WINDOW_START,
    windowEnd: DEFAULT_WINDOW_END,
    slotDurationMinutes,
    slotIncrementMinutes,
    cleanupBufferMinutes,
    leadTimeMinutes: DEFAULT_LEAD_TIME_MINUTES,
    maxAdvanceDays: DEFAULT_MAX_ADVANCE_DAYS,
  };
}

function createCapacitySpace(
  params: Omit<StudioReservationInventorySpaceSeed, "bookingMode" | "active" | "capacity" | "resources" | "timezone">
): StudioReservationInventorySpaceSeed {
  return {
    ...params,
    name: normalizeInventoryTitle(params.name),
    bookingMode: "capacity",
    active: true,
    capacity: 1,
    resources: [],
    timezone: "America/Phoenix",
  };
}

function createResourceSpace(
  params: Omit<StudioReservationInventorySpaceSeed, "bookingMode" | "active" | "capacity" | "timezone">
): StudioReservationInventorySpaceSeed {
  return {
    ...params,
    name: normalizeInventoryTitle(params.name),
    bookingMode: "resource",
    active: true,
    capacity: null,
    timezone: "America/Phoenix",
  };
}

export const STUDIO_RESERVATION_SPACE_SEED: readonly StudioReservationInventorySpaceSeed[] = [
  createResourceSpace({
    id: "wheel-throwing-sanding",
    slug: "wheel-throwing-sanding",
    name: "Wheel Throwing & Sanding",
    category: "Wheel",
    description: "Reserve a wheel for throwing, trimming, or sanding work.",
    memberHelpText: "The Skutt wheel is for throwing. The Vevor wheel is trimming and sanding only.",
    colorToken: "#b66f3d",
    sortOrder: 10,
    resources: [
      { id: "skutt-wheel", label: "Skutt wheel", active: true },
      { id: "vevor-wheel-trimming-only", label: "Vevor wheel (trimming only)", active: true },
    ],
    templates: [createTemplate("wheel-throwing-sanding-default", "Wheel block", 240, 240)],
  }),
  createCapacitySpace({
    id: "handbuilding-area-indoors",
    slug: "handbuilding-area-indoors",
    name: "Handbuilding Area (indoors)",
    category: "Handbuilding",
    description: "Reserve the indoor handbuilding area for slab, coil, and longer assembly sessions.",
    memberHelpText: "Use this for longer indoor handbuilding sessions that need a stable table setup.",
    colorToken: "#8b6a59",
    sortOrder: 20,
    templates: [createTemplate("handbuilding-area-indoors-default", "Handbuilding block", 240, 240)],
  }),
  createCapacitySpace({
    id: "glazing-area-outdoors",
    slug: "glazing-area-outdoors",
    name: "Glazing Area (outdoors)",
    category: "Glazing",
    description: "Reserve the outdoor glazing area for glazing, waxing, and finishing work.",
    memberHelpText: "Best for outdoor glazing sessions that need room to spread out and dry safely.",
    colorToken: "#4d9a90",
    sortOrder: 30,
    templates: [createTemplate("glazing-area-outdoors-default", "Glazing block", 240, 240)],
  }),
  createCapacitySpace({
    id: "glaze-kitchen-outdoors",
    slug: "glaze-kitchen-outdoors",
    name: "Glaze Kitchen (outdoors)",
    category: "Glaze kitchen",
    description: "Reserve the outdoor glaze kitchen for glaze prep, mixing, and finishing sessions.",
    memberHelpText: "Use this for outdoor glaze prep, glaze kitchen work, and careful finishing runs.",
    colorToken: "#739e62",
    sortOrder: 40,
    templates: [createTemplate("glaze-kitchen-outdoors-default", "Glaze kitchen block", 240, 240)],
  }),
  createCapacitySpace({
    id: "dropoff-pickup",
    slug: "dropoff-pickup",
    name: "Dropoff & Pickup",
    category: "Dropoff",
    description: "Reserve a short window for piece dropoff or pickup.",
    memberHelpText: "Use this for quick handoff visits so staff knows when to expect you.",
    colorToken: "#557db2",
    sortOrder: 50,
    templates: [createTemplate("dropoff-pickup-default", "Dropoff and pickup window", 30, 30, 0)],
  }),
  createCapacitySpace({
    id: "community-spaces",
    slug: "community-spaces",
    name: "Community Spaces",
    category: "Community",
    description: "Reserve shared community workspace for longer working sessions or collaborative support.",
    memberHelpText: "Use this for longer community work blocks that do not need a dedicated wheel or glaze station.",
    colorToken: "#b38a4d",
    sortOrder: 60,
    templates: [createTemplate("community-spaces-default", "Community block", 240, 240)],
  }),
] as const;
