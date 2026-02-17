import { describe, expect, it } from "vitest";
import { normalizeFiringDoc, normalizeKilnDoc } from "../lib/normalizers/kiln";

describe("Kiln schedule normalizers", () => {
  it("normalizes kiln docs and defaults arrays/flags", () => {
    const row = normalizeKilnDoc("kiln-1", {
      name: 123 as unknown as string,
      isAvailable: "yes" as unknown as boolean,
      typicalCycles: null as unknown as string[],
      notes: undefined,
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

  it("normalizes firing docs and defaults lists", () => {
    const row = normalizeFiringDoc("firing-1", {
      title: 123 as unknown as string,
      batchIds: null as unknown as string[],
      pieceIds: "bad" as unknown as string[],
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
