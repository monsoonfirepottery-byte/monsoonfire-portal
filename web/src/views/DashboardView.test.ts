import { describe, expect, it } from "vitest";
import { normalizeFiringDoc as normalizeFiringRow, normalizeKilnDoc as normalizeKilnRow } from "../lib/normalizers/kiln";
import { getDashboardPieceStatus, getDashboardPieceTitle, isQaWorkshopEvent, summarizeDashboardPieces } from "./DashboardView";

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

  it("summarizes dashboard pieces from piece-level data and keeps archived count", () => {
    const { preview, archivedCount } = summarizeDashboardPieces([
      {
        key: "batch-1:piece-1",
        batchId: "batch-1",
        pieceId: "piece-1",
        batchTitle: "First check-in",
        pieceCode: "MUG-1",
        shortDesc: "Tall mug",
        stage: "BISQUE",
        isArchived: false,
        updatedAt: { toDate: () => new Date("2026-03-19T10:00:00Z") },
      },
      {
        key: "batch-2:piece-2",
        batchId: "batch-2",
        pieceId: "piece-2",
        batchTitle: "Archived check-in",
        pieceCode: "BOWL-9",
        shortDesc: "Serving bowl",
        stage: "FINISHED",
        isArchived: true,
        updatedAt: { toDate: () => new Date("2026-03-20T10:00:00Z") },
      },
    ]);

    expect(preview.map((piece) => piece.pieceId)).toEqual(["piece-2", "piece-1"]);
    expect(archivedCount).toBe(1);
  });

  it("formats dashboard piece titles and archived status labels", () => {
    expect(
      getDashboardPieceTitle({
        pieceId: "piece-2",
        pieceCode: "BOWL-9",
        shortDesc: "Serving bowl",
      })
    ).toBe("BOWL-9");

    expect(
      getDashboardPieceStatus({
        isArchived: true,
        stage: "FINISHED",
      })
    ).toBe("Archived");
  });

  it("keeps one archived piece visible in the dashboard preview when archives exist", () => {
    const { preview } = summarizeDashboardPieces([
      {
        key: "batch-1:piece-1",
        batchId: "batch-1",
        pieceId: "piece-1",
        batchTitle: "First check-in",
        pieceCode: "MUG-1",
        shortDesc: "Tall mug",
        stage: "BISQUE",
        isArchived: false,
        updatedAt: { toDate: () => new Date("2026-03-20T12:00:00Z") },
      },
      {
        key: "batch-1:piece-2",
        batchId: "batch-1",
        pieceId: "piece-2",
        batchTitle: "First check-in",
        pieceCode: "MUG-2",
        shortDesc: "Wide mug",
        stage: "GLAZED",
        isArchived: false,
        updatedAt: { toDate: () => new Date("2026-03-20T11:00:00Z") },
      },
      {
        key: "batch-1:piece-3",
        batchId: "batch-1",
        pieceId: "piece-3",
        batchTitle: "First check-in",
        pieceCode: "BOWL-4",
        shortDesc: "Mixing bowl",
        stage: "FINISHED",
        isArchived: false,
        updatedAt: { toDate: () => new Date("2026-03-20T10:00:00Z") },
      },
      {
        key: "batch-2:piece-4",
        batchId: "batch-2",
        pieceId: "piece-4",
        batchTitle: "Archived check-in",
        pieceCode: "ARCH-1",
        shortDesc: "Archived serving bowl",
        stage: "FINISHED",
        isArchived: true,
        updatedAt: { toDate: () => new Date("2026-03-18T10:00:00Z") },
      },
    ]);

    expect(preview).toHaveLength(3);
    expect(preview.some((piece) => piece.isArchived)).toBe(true);
    expect(preview.map((piece) => piece.pieceId)).toContain("piece-4");
  });

  it("recognizes QA workshop fixtures so the dashboard can hide them", () => {
    expect(
      isQaWorkshopEvent({
        title: "QA Fixture Workshop 2026-03-20",
        summary: "Seeded workshop fixture for deterministic canary coverage.",
      })
    ).toBe(true);

    expect(
      isQaWorkshopEvent({
        title: "Surface Decoration Intensive",
        summary: "A live carving and slip session for members.",
      })
    ).toBe(false);
  });
});
