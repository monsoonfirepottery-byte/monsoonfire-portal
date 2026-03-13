const STUDIO_RESERVATIONS_ALIASES = new Set(["/reservations"]);
const WARE_CHECKIN_ALIASES = new Set([
  "/ware-check-in",
  "/ware-checkin",
  "/check-in",
  "/checkin",
]);

export const STUDIO_RESERVATIONS_PATH = "/reservations";
export const WARE_CHECKIN_PATH = "/ware-check-in";

export type ReservationsPathTarget = "reservations" | "wareCheckIn";

function normalizePath(pathname: string): string {
  if (!pathname) return "";
  const normalized = pathname.trim().toLowerCase();
  if (!normalized) return "";
  const withLeadingSlash = normalized.startsWith("/") ? normalized : `/${normalized}`;
  const pathOnly = withLeadingSlash.split("?")[0] ?? "";
  const collapsed = pathOnly.replace(/\/{2,}/g, "/");
  if (collapsed === "/") return "/";
  return collapsed.replace(/\/+$/, "");
}

export function resolveReservationsPathTarget(pathname: string): ReservationsPathTarget | null {
  const normalized = normalizePath(pathname);
  if (STUDIO_RESERVATIONS_ALIASES.has(normalized)) return "reservations";
  if (WARE_CHECKIN_ALIASES.has(normalized)) return "wareCheckIn";
  return null;
}

export function canonicalReservationsPath(target: ReservationsPathTarget): string {
  return target === "wareCheckIn" ? WARE_CHECKIN_PATH : STUDIO_RESERVATIONS_PATH;
}

export function buildStudioReservationsPath(options?: {
  dateKey?: string | null;
  spaceId?: string | null;
}): string {
  const params = new URLSearchParams();
  const dateKey = typeof options?.dateKey === "string" ? options.dateKey.trim() : "";
  const spaceId = typeof options?.spaceId === "string" ? options.spaceId.trim() : "";
  if (dateKey) params.set("date", dateKey);
  if (spaceId) params.set("space", spaceId);
  const search = params.toString();
  return search ? `${STUDIO_RESERVATIONS_PATH}?${search}` : STUDIO_RESERVATIONS_PATH;
}

export function parseStudioReservationsSearch(search: string): { dateKey: string | null; spaceId: string | null } {
  const params = new URLSearchParams(search || "");
  const dateKey = params.get("date")?.trim() ?? "";
  const spaceId = params.get("space")?.trim() ?? "";
  return {
    dateKey: dateKey || null,
    spaceId: spaceId || null,
  };
}
