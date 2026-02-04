export type LibraryItemStatus = "available" | "checked_out" | "unavailable" | "archived";
export type LibraryMediaType = "book" | "media" | "tool" | "other";
export type LibrarySource = "openlibrary" | "googlebooks" | "manual" | "donation";

export type LibraryIdentifiers = {
  isbn10?: string | null;
  isbn13?: string | null;
  olid?: string | null;
  googleVolumeId?: string | null;
};

export type LibraryItem = {
  id: string;
  title: string;
  subtitle?: string | null;
  authors: string[];
  description?: string | null;
  subjects?: string[];
  mediaType: LibraryMediaType;
  format?: string | null;
  coverUrl?: string | null;
  identifiers?: LibraryIdentifiers;
  totalCopies: number;
  availableCopies: number;
  status: LibraryItemStatus;
  source: LibrarySource;
  searchTokens?: string[];
  createdAt?: { toDate?: () => Date } | null;
  updatedAt?: { toDate?: () => Date } | null;
};

export type LibraryRequestType = "reserve" | "waitlist" | "return";
export type LibraryRequestStatus =
  | "pending_approval"
  | "approved"
  | "denied"
  | "fulfilled"
  | "cancelled";

export type LibraryRequest = {
  id: string;
  itemId: string;
  itemTitle: string;
  type: LibraryRequestType;
  status: LibraryRequestStatus;
  requesterUid: string;
  requesterName?: string | null;
  requesterEmail?: string | null;
  requestedAt?: { toDate?: () => Date } | null;
  updatedAt?: { toDate?: () => Date } | null;
  notes?: string | null;
};

export type LibraryLoanStatus = "checked_out" | "return_requested" | "returned" | "overdue";

export type LibraryLoan = {
  id: string;
  itemId: string;
  itemTitle: string;
  borrowerUid: string;
  borrowerName?: string | null;
  borrowerEmail?: string | null;
  loanedAt?: { toDate?: () => Date } | null;
  dueAt?: { toDate?: () => Date } | null;
  returnedAt?: { toDate?: () => Date } | null;
  status: LibraryLoanStatus;
};

export type LibraryDonationRequest = {
  id: string;
  isbn?: string | null;
  title?: string | null;
  author?: string | null;
  format?: string | null;
  notes?: string | null;
  status: "pending" | "reviewed" | "accepted" | "declined";
  donorUid: string;
  donorName?: string | null;
  donorEmail?: string | null;
  createdAt?: { toDate?: () => Date } | null;
  updatedAt?: { toDate?: () => Date } | null;
};
