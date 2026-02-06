import { describe, expect, it } from "vitest";
import {
  normalizeLibraryItem,
  normalizeLibraryLoan,
  normalizeLibraryRequest,
} from "../lib/normalizers/library";

describe("Lending library normalizers", () => {
  it("normalizes library items with safe defaults", () => {
    const row = normalizeLibraryItem("item-1", {
      title: "Cone 6 Glazes",
      authors: "invalid" as unknown as string[],
      subjects: null as unknown as string[],
      totalCopies: "bad" as unknown as number,
      availableCopies: undefined,
    });

    expect(row).toMatchObject({
      id: "item-1",
      title: "Cone 6 Glazes",
      authors: [],
      subjects: [],
      totalCopies: 1,
      availableCopies: 0,
      status: "available",
      source: "manual",
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
});
