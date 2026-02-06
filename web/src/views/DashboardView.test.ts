import { describe, expect, it } from "vitest";
import { normalizeFiringDoc as normalizeFiringRow, normalizeKilnDoc as normalizeKilnRow } from "../lib/normalizers/kiln";

describe("Dashboard normalizers", () => {
  it("normalizes kiln rows with expected defaults", () => {
    const row = normalizeKilnRow("kiln-1", {
      type: 123 as unknown as string,
      isAvailable: "true" as unknown as boolean,
      typicalCycles: "invalid" as unknown as string[],
    });

    expect(row).toMatchObject({
      id: "kiln-1",
      name: "Kiln",
      type: "electric",
      volume: "",
      maxTemp: "",
      status: "idle",
      isAvailable: true,
      typicalCycles: [],
      notes: null,
    });
  });

  it("normalizes firing rows with safe defaults", () => {
    const row = normalizeFiringRow("firing-1", {
      cycleType: 12 as unknown as string,
      batchIds: null as unknown as string[],
      pieceIds: undefined,
    });

    expect(row).toMatchObject({
      id: "firing-1",
      kilnId: "",
      title: "Firing",
      cycleType: "unknown",
      startAt: null,
      endAt: null,
      status: "scheduled",
      confidence: "estimated",
      notes: null,
      unloadedAt: null,
      unloadedByUid: null,
      unloadNote: null,
      batchIds: [],
      pieceIds: [],
      kilnName: null,
    });
  });
});
