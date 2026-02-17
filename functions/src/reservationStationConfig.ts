export const STATION_CAPACITY_HALF_SHELVES = {
  "studio-kiln-a": 8,
  "studio-kiln-b": 8,
  "studio-electric": 8,
  "reduction-raku": 8,
} as const;

export type ReservationStationId = keyof typeof STATION_CAPACITY_HALF_SHELVES;

export const STATION_FALLBACK_CAPACITY_HALF_SHELVES = 8;

export const STATION_IDS = Object.keys(STATION_CAPACITY_HALF_SHELVES) as ReservationStationId[];

export const STATION_LABELS: Record<string, string> = {
  "studio-electric": "L&L eQ2827-3",
  "studio-kiln-a": "Studio Kiln A",
  "studio-kiln-b": "Studio Kiln B",
  "reduction-raku": "Reduction Raku",
  reductionraku: "Reduction Raku",
};

export function normalizeStationId(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function getStationCapacity(stationId: unknown): number {
  const normalized = normalizeStationId(stationId);
  if (Object.prototype.hasOwnProperty.call(STATION_CAPACITY_HALF_SHELVES, normalized)) {
    return STATION_CAPACITY_HALF_SHELVES[normalized as ReservationStationId];
  }
  return STATION_FALLBACK_CAPACITY_HALF_SHELVES;
}

export function isKnownStationId(stationId: string | null | undefined): stationId is ReservationStationId {
  if (!stationId) return false;
  return Object.prototype.hasOwnProperty.call(STATION_CAPACITY_HALF_SHELVES, stationId);
}
