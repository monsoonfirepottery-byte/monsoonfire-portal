/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import LendingCatalogEditor, { type LendingAdminItemDraft } from "./LendingCatalogEditor";

afterEach(() => {
  cleanup();
});

function makeDraft(overrides: Partial<LendingAdminItemDraft> = {}): LendingAdminItemDraft {
  return {
    title: "The Invisibles Omnibus",
    subtitle: "",
    authorsCsv: "Grant Morrison",
    summary: "",
    description: "",
    publisher: "",
    publishedDate: "",
    isbn: "9781401234591",
    mediaType: "comic",
    format: "",
    coverUrl: "",
    totalCopies: "1",
    availableCopies: "1",
    status: "available",
    source: "manual",
    staffPick: false,
    staffRationale: "",
    subjectsCsv: "",
    techniquesCsv: "",
    ...overrides,
  };
}

describe("LendingCatalogEditor", () => {
  it("shows research assist links for catalog and manual reference sources", () => {
    render(
      <LendingCatalogEditor
        busy=""
        lendingAdminItemBusy={false}
        selectedAdminItem={null}
        lendingAdminItemDraft={makeDraft()}
        setLendingAdminItemDraft={vi.fn()}
        handleLendingAdminResolveIsbn={vi.fn(async () => {})}
        lendingAdminIsbnResolveBusy={false}
        lendingAdminIsbnResolveStatus=""
        lendingAdminItemError=""
        lendingAdminItemStatus=""
        handleLendingAdminSave={vi.fn(async () => true)}
      />
    );

    expect(screen.getByText("Research assist")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Library" }).getAttribute("href")).toContain("9781401234591");
    expect(screen.getByRole("link", { name: "Amazon" }).getAttribute("href")).toContain("9781401234591");
  });

  it("warns when the draft contains a retail-hosted cover url", () => {
    const setDraft = vi.fn();
    render(
      <LendingCatalogEditor
        busy=""
        lendingAdminItemBusy={false}
        selectedAdminItem={null}
        lendingAdminItemDraft={makeDraft({
          coverUrl: "https://m.media-amazon.com/images/I/cover.jpg",
        })}
        setLendingAdminItemDraft={setDraft}
        handleLendingAdminResolveIsbn={vi.fn(async () => {})}
        lendingAdminIsbnResolveBusy={false}
        lendingAdminIsbnResolveStatus=""
        lendingAdminItemError=""
        lendingAdminItemStatus=""
        handleLendingAdminSave={vi.fn(async () => true)}
      />
    );

    expect(screen.getByText(/Retail-hosted cover URLs are blocked/i)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Updated title" } });
    expect(setDraft).toHaveBeenCalled();
  });
});
