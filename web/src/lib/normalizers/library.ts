import type { LibraryItem, LibraryLoan, LibraryRequest } from "../../types/library";

export function normalizeLibraryItem(id: string, raw: Partial<LibraryItem>): LibraryItem {
  return {
    id,
    title: typeof raw.title === "string" ? raw.title : "Untitled",
    subtitle: raw.subtitle ?? null,
    authors: Array.isArray(raw.authors) ? raw.authors : [],
    description: raw.description ?? null,
    subjects: Array.isArray(raw.subjects) ? raw.subjects : [],
    mediaType: raw.mediaType ?? "book",
    format: raw.format ?? null,
    coverUrl: raw.coverUrl ?? null,
    identifiers: raw.identifiers ?? undefined,
    totalCopies: typeof raw.totalCopies === "number" ? raw.totalCopies : 1,
    availableCopies: typeof raw.availableCopies === "number" ? raw.availableCopies : 0,
    status: raw.status ?? "available",
    source: raw.source ?? "manual",
    searchTokens: Array.isArray(raw.searchTokens) ? raw.searchTokens : [],
    createdAt: raw.createdAt ?? null,
    updatedAt: raw.updatedAt ?? null,
  };
}

export function normalizeLibraryRequest(id: string, raw: Partial<LibraryRequest>): LibraryRequest {
  return {
    id,
    itemId: typeof raw.itemId === "string" ? raw.itemId : "",
    itemTitle: typeof raw.itemTitle === "string" ? raw.itemTitle : "Library item",
    type: raw.type ?? "reserve",
    status: raw.status ?? "pending_approval",
    requesterUid: typeof raw.requesterUid === "string" ? raw.requesterUid : "",
    requesterName: raw.requesterName ?? null,
    requesterEmail: raw.requesterEmail ?? null,
    requestedAt: raw.requestedAt ?? null,
    updatedAt: raw.updatedAt ?? null,
    notes: raw.notes ?? null,
  };
}

export function normalizeLibraryLoan(id: string, raw: Partial<LibraryLoan>): LibraryLoan {
  return {
    id,
    itemId: typeof raw.itemId === "string" ? raw.itemId : "",
    itemTitle: typeof raw.itemTitle === "string" ? raw.itemTitle : "Library item",
    borrowerUid: typeof raw.borrowerUid === "string" ? raw.borrowerUid : "",
    borrowerName: raw.borrowerName ?? null,
    borrowerEmail: raw.borrowerEmail ?? null,
    loanedAt: raw.loanedAt ?? null,
    dueAt: raw.dueAt ?? null,
    returnedAt: raw.returnedAt ?? null,
    status: raw.status ?? "checked_out",
  };
}
