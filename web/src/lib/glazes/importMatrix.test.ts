import { describe, expect, test } from "vitest";
import { importGlazeMatrix } from "./importMatrix";

describe("importGlazeMatrix", () => {
  test("parses base/top names and combo IDs", () => {
    const raw = [
      "0,Base A,Base B",
      "Top X,1,2",
      "Top Y,3,4",
    ].join("\n");

    const result = importGlazeMatrix(raw);
    const glazeByName = new Map(result.glazes.map((glaze) => [glaze.name, glaze.id]));

    expect(glazeByName.has("Base A")).toBe(true);
    expect(glazeByName.has("Base B")).toBe(true);
    expect(glazeByName.has("Top X")).toBe(true);
    expect(glazeByName.has("Top Y")).toBe(true);

    const baseA = glazeByName.get("Base A")!;
    const baseB = glazeByName.get("Base B")!;
    const topX = glazeByName.get("Top X")!;
    const topY = glazeByName.get("Top Y")!;

    const combo1 = result.comboKeys.find((combo) => combo.id === 1);
    const combo2 = result.comboKeys.find((combo) => combo.id === 2);
    const combo4 = result.comboKeys.find((combo) => combo.id === 4);

    expect(combo1).toEqual({
      id: 1,
      baseGlazeId: baseA,
      topGlazeId: topX,
    });
    expect(combo2).toEqual({
      id: 2,
      baseGlazeId: baseB,
      topGlazeId: topX,
    });
    expect(combo4).toEqual({
      id: 4,
      baseGlazeId: baseB,
      topGlazeId: topY,
    });
  });

  test("handles trailing blank rows and columns", () => {
    const raw = [
      "0,Base A,Base B,,",
      "Top X,1,2,,",
      ",,,",
      "Top Y,3,4,,",
      ",,",
    ].join("\n");

    const result = importGlazeMatrix(raw);
    expect(result.comboKeys).toHaveLength(4);
  });

  test("throws on duplicate combo IDs", () => {
    const raw = [
      "0,Base A,Base B",
      "Top X,1,1",
    ].join("\n");

    expect(() => importGlazeMatrix(raw)).toThrow(/Duplicate combo ID/i);
  });

  test("throws on non-integer combo IDs", () => {
    const raw = [
      "0,Base A",
      "Top X,1.5",
    ].join("\n");

    expect(() => importGlazeMatrix(raw)).toThrow(/Combo ID must be an integer/i);
  });
});
