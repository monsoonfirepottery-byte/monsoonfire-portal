export const INTAKE_MODE_VALUES = [
  "SHELF_PURCHASE",
  "WHOLE_KILN",
  "COMMUNITY_SHELF",
] as const;

export type IntakeMode = (typeof INTAKE_MODE_VALUES)[number];

function normalizeToken(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

export function normalizeIntakeMode(value: unknown, fallback: IntakeMode = "SHELF_PURCHASE"): IntakeMode {
  const token = normalizeToken(value);
  if (token === "SHELF_PURCHASE") return "SHELF_PURCHASE";
  if (token === "WHOLE_KILN") return "WHOLE_KILN";
  if (token === "COMMUNITY_SHELF") return "COMMUNITY_SHELF";

  // Legacy values remain readable but normalize into current intake modes.
  if (
    token === "STAFF_HANDOFF" ||
    token === "SELF_SERVICE" ||
    token === "KILNFIRE_PIECES" ||
    token === "CLIENT_SUBMIT" ||
    token === "CLIENT_DROP_OFF"
  ) {
    return "SHELF_PURCHASE";
  }

  return fallback;
}

export function isCommunityShelfIntakeMode(value: unknown): boolean {
  return normalizeIntakeMode(value) === "COMMUNITY_SHELF";
}
