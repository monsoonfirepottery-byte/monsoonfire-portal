import { describe, expect, it } from "vitest";

import {
  buildLendingAdminApiPayload,
  normalizeLendingAdminLifecycleStatus,
  type LendingAdminPayloadDraft,
} from "./lendingAdminPayload";

const BASE_DRAFT: LendingAdminPayloadDraft = {
  title: "The Kiln Book",
  subtitle: "Materials, Specs, and Firing",
  description: "A practical guide for shared studio operations.",
  publisher: "Monsoon Press",
  publishedDate: "2025-10-12",
  mediaType: "book",
  format: "paperback",
  coverUrl: "https://covers.openlibrary.org/b/id/12345-M.jpg",
  totalCopies: "4",
  availableCopies: "2",
  status: "available",
  source: "manual",
};

describe("buildLendingAdminApiPayload", () => {
  it("builds a contract-clean API payload without route-wrapper keys", () => {
    const payload = buildLendingAdminApiPayload({
      draft: BASE_DRAFT,
      authors: ["Nils Lou"],
      subjects: ["Kilns", "Ceramics"],
      techniques: ["firing", "kiln-ops"],
      isbn: { primary: "9781234567890", isbn10: null, isbn13: "9781234567890" },
    });

    expect(payload).toEqual({
      title: "The Kiln Book",
      subtitle: "Materials, Specs, and Firing",
      authors: ["Nils Lou"],
      description: "A practical guide for shared studio operations.",
      publisher: "Monsoon Press",
      publishedDate: "2025-10-12",
      mediaType: "book",
      format: "paperback",
      coverUrl: "https://covers.openlibrary.org/b/id/12345-M.jpg",
      totalCopies: 4,
      availableCopies: 2,
      status: "available",
      source: "manual",
      subjects: ["Kilns", "Ceramics"],
      tags: ["firing", "kiln-ops"],
      isbn: "9781234567890",
    });

    expect(payload).not.toHaveProperty("item");
    expect(payload).not.toHaveProperty("patch");
    expect(payload).not.toHaveProperty("confirm");
    expect(payload).not.toHaveProperty("softDelete");
    expect(payload).not.toHaveProperty("isbn10");
    expect(payload).not.toHaveProperty("isbn13");
    expect(payload).not.toHaveProperty("isbn_normalized");
    expect(payload).not.toHaveProperty("identifiers");
    expect(payload).not.toHaveProperty("updatedByUid");
    expect(payload).not.toHaveProperty("techniques");
  });

  it("omits isbn when no canonical isbn value exists", () => {
    const payload = buildLendingAdminApiPayload({
      draft: { ...BASE_DRAFT, source: "" },
      authors: ["Monsoon Fire Team"],
      subjects: [],
      techniques: [],
      isbn: { primary: "", isbn10: null, isbn13: null },
    });

    expect(payload).toEqual({
      title: "The Kiln Book",
      subtitle: "Materials, Specs, and Firing",
      authors: ["Monsoon Fire Team"],
      description: "A practical guide for shared studio operations.",
      publisher: "Monsoon Press",
      publishedDate: "2025-10-12",
      mediaType: "book",
      format: "paperback",
      coverUrl: "https://covers.openlibrary.org/b/id/12345-M.jpg",
      totalCopies: 4,
      availableCopies: 2,
      status: "available",
      source: "manual",
      subjects: [],
      tags: [],
    });
  });
});

describe("normalizeLendingAdminLifecycleStatus", () => {
  it("normalizes checked-out aliases and defaults unknown values to archived", () => {
    expect(normalizeLendingAdminLifecycleStatus("checked out")).toBe("checked_out");
    expect(normalizeLendingAdminLifecycleStatus("checkedout")).toBe("checked_out");
    expect(normalizeLendingAdminLifecycleStatus("something-custom")).toBe("archived");
  });
});
