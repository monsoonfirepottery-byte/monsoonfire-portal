import { describe, expect, it } from "vitest";
import { parseStaffRole, parseStaffRoleFromClaims } from "./staffRole";

describe("parseStaffRoleFromClaims", () => {
  it("resolves admin from claims.admin", () => {
    const out = parseStaffRoleFromClaims({ admin: true, roles: ["staff"] });
    expect(out.role).toBe("admin");
    expect(out.isAdmin).toBe(true);
    expect(out.isStaff).toBe(true);
    expect(out.source).toBe("claims_admin_flag");
  });

  it("resolves admin from roles array with normalization", () => {
    const out = parseStaffRoleFromClaims({ roles: [" Staff ", "ADMIN", "", "admin"] });
    expect(out.role).toBe("admin");
    expect(out.isAdmin).toBe(true);
    expect(out.roles).toContain("admin");
    expect(out.roles).toContain("staff");
    expect(out.source).toBe("claims_roles_admin");
  });

  it("resolves staff from legacy staff flag", () => {
    const out = parseStaffRoleFromClaims({ staff: true });
    expect(out.role).toBe("staff");
    expect(out.isStaff).toBe(true);
    expect(out.isAdmin).toBe(false);
    expect(out.source).toBe("claims_staff_flag");
  });

  it("defaults to member when claims are missing", () => {
    const out = parseStaffRoleFromClaims(undefined);
    expect(out.role).toBe("member");
    expect(out.isStaff).toBe(false);
    expect(out.source).toBe("default_member");
  });
});

describe("parseStaffRole", () => {
  it("uses fallback role when claims do not include role authority", () => {
    const out = parseStaffRole({
      claims: { roles: ["reader"] },
      fallbackRole: "staff",
    });
    expect(out.role).toBe("staff");
    expect(out.isStaff).toBe(true);
    expect(out.source).toBe("fallback_role");
  });

  it("normalizes fallback legacy role labels", () => {
    const out = parseStaffRole({
      claims: null,
      fallbackRole: "client",
    });
    expect(out.role).toBe("member");
    expect(out.source).toBe("fallback_role");
  });

  it("gives claims precedence over fallback role", () => {
    const out = parseStaffRole({
      claims: { roles: ["staff"] },
      fallbackRole: "admin",
    });
    expect(out.role).toBe("staff");
    expect(out.source).toBe("claims_roles_staff");
  });
});
