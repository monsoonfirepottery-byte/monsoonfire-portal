import { describe, expect, it } from "vitest";
import {
  deriveMemberLibraryPendingBadges,
  normalizeLibraryItem,
  normalizeLibraryLoan,
  normalizeLibraryRequest,
  resolveMemberLibraryCoverDisplay,
} from "../lib/normalizers/library";

describe("Lending library normalizers", () => {
  it("normalizes library items with safe defaults", () => {
    const row = normalizeLibraryItem("item-1", {
      title: "Cone 6 Glazes",
      summary: "Practical glaze tests for cone 6 studios.",
      authors: "invalid" as unknown as string[],
      subjects: null as unknown as string[],
      totalCopies: "bad" as unknown as number,
      availableCopies: undefined,
      detailStatus: "enriching",
    });

    expect(row).toMatchObject({
      id: "item-1",
      title: "Cone 6 Glazes",
      summary: "Practical glaze tests for cone 6 studios.",
      authors: [],
      subjects: [],
      totalCopies: 1,
      availableCopies: 0,
      status: "available",
      source: "manual",
      detailStatus: "enriching",
      createdAt: null,
      updatedAt: null,
    });
  });

  it("normalizes library requests with safe defaults", () => {
    const row = normalizeLibraryRequest("req-1", {});

    expect(row).toMatchObject({
      id: "req-1",
      itemId: "",
      itemTitle: "Library item",
      type: "reserve",
      status: "pending_approval",
      requesterUid: "",
      requesterName: null,
      requesterEmail: null,
      requestedAt: null,
      updatedAt: null,
      notes: null,
    });
  });

  it("normalizes library loans with safe defaults", () => {
    const row = normalizeLibraryLoan("loan-1", {});

    expect(row).toMatchObject({
      id: "loan-1",
      itemId: "",
      itemTitle: "Library item",
      borrowerUid: "",
      borrowerName: null,
      borrowerEmail: null,
      loanedAt: null,
      dueAt: null,
      returnedAt: null,
      status: "checked_out",
    });
  });

  it("shows stored cover art for member-facing pending-review items", () => {
    expect(
      resolveMemberLibraryCoverDisplay({
        title: "Pending Review",
        coverUrl: "https://covers.openlibrary.org/b/id/12345-M.jpg",
        coverQualityStatus: "needs_review",
        needsCoverReview: true,
      })
    ).toEqual({
      kind: "cover",
      coverUrl: "https://covers.openlibrary.org/b/id/12345-M.jpg",
    });
  });

  it("uses an explicit pending placeholder when no cover art exists yet", () => {
    expect(
      resolveMemberLibraryCoverDisplay({
        title: "Missing Cover",
        coverUrl: null,
        coverQualityStatus: "missing",
        needsCoverReview: true,
      })
    ).toEqual({
      kind: "placeholder",
      label: "Cover pending",
      accent: "Metadata in progress",
      ariaLabel: "Missing Cover cover unavailable",
    });
  });

  it("derives member-facing pending badges from incomplete metadata signals", () => {
    expect(
      deriveMemberLibraryPendingBadges({
        title: "ISBN 9780596007126",
        source: "manual",
        detailStatus: "sparse",
        coverUrl: "https://covers.openlibrary.org/b/id/12345-M.jpg",
        coverQualityStatus: "needs_review",
        needsCoverReview: true,
      })
    ).toEqual(["Details pending", "Staff finishing metadata"]);

    expect(
      deriveMemberLibraryPendingBadges({
        title: "ISBN 9780596007126",
        source: "manual",
        detailStatus: "sparse",
        coverUrl: null,
        coverQualityStatus: "missing",
        needsCoverReview: true,
      })
    ).toEqual(["Cover pending", "Details pending", "Staff finishing metadata"]);
  });
});
