export type StaffRole = "member" | "staff" | "admin";

export type StaffRoleSource =
  | "claims_admin_flag"
  | "claims_roles_admin"
  | "claims_staff_flag"
  | "claims_roles_staff"
  | "fallback_role"
  | "default_member";

export type ParsedStaffRole = {
  role: StaffRole;
  isStaff: boolean;
  isAdmin: boolean;
  roles: string[];
  source: StaffRoleSource;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeRoleValue(value: unknown): StaffRole | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "admin") return "admin";
  if (normalized === "staff") return "staff";
  if (normalized === "member" || normalized === "client" || normalized === "user") return "member";
  return null;
}

function normalizeRoles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const deduped = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const normalized = entry.trim().toLowerCase();
    if (!normalized) continue;
    deduped.add(normalized);
  }
  return Array.from(deduped);
}

function toParsed(role: StaffRole, roles: string[], source: StaffRoleSource): ParsedStaffRole {
  return {
    role,
    isAdmin: role === "admin",
    isStaff: role === "admin" || role === "staff",
    roles,
    source,
  };
}

export function parseStaffRole(input: {
  claims?: unknown;
  fallbackRole?: unknown;
}): ParsedStaffRole {
  const claims = asRecord(input.claims);
  const roles = normalizeRoles(claims.roles);
  if (claims.admin === true) return toParsed("admin", roles, "claims_admin_flag");
  if (roles.includes("admin")) return toParsed("admin", roles, "claims_roles_admin");
  if (claims.staff === true) return toParsed("staff", roles, "claims_staff_flag");
  if (roles.includes("staff")) return toParsed("staff", roles, "claims_roles_staff");

  const fallbackRole = normalizeRoleValue(input.fallbackRole);
  if (fallbackRole) return toParsed(fallbackRole, roles, "fallback_role");

  return toParsed("member", roles, "default_member");
}

export function parseStaffRoleFromClaims(claims: unknown): ParsedStaffRole {
  return parseStaffRole({ claims });
}
