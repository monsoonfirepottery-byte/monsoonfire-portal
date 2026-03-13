import { describe, expect, it } from "vitest";
import {
  buildStudioReservationsPath,
  canonicalReservationsPath,
  parseStudioReservationsSearch,
  resolveReservationsPathTarget,
} from "./reservationsPaths";

describe("reservationsPaths", () => {
  it("resolves the new studio reservations path", () => {
    expect(resolveReservationsPathTarget("/reservations")).toBe("reservations");
    expect(canonicalReservationsPath("reservations")).toBe("/reservations");
  });

  it("normalizes ware check-in aliases to the canonical kiln intake path", () => {
    expect(resolveReservationsPathTarget("/ware-check-in")).toBe("wareCheckIn");
    expect(resolveReservationsPathTarget("/check-in")).toBe("wareCheckIn");
    expect(resolveReservationsPathTarget("/checkin")).toBe("wareCheckIn");
    expect(canonicalReservationsPath("wareCheckIn")).toBe("/ware-check-in");
  });

  it("builds and parses reservations deep links", () => {
    expect(buildStudioReservationsPath()).toBe("/reservations");
    expect(buildStudioReservationsPath({ dateKey: "2026-03-13", spaceId: "wheel-studio" })).toBe(
      "/reservations?date=2026-03-13&space=wheel-studio"
    );
    expect(parseStudioReservationsSearch("?date=2026-03-13&space=glaze-kitchen")).toEqual({
      dateKey: "2026-03-13",
      spaceId: "glaze-kitchen",
    });
  });
});
