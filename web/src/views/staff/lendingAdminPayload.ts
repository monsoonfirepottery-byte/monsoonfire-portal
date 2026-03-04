export type LendingAdminLifecycleStatus =
  | "available"
  | "checked_out"
  | "overdue"
  | "lost"
  | "unavailable"
  | "archived";

export type LendingAdminIsbnVariants = {
  primary: string;
  isbn10: string | null;
  isbn13: string | null;
};

export type LendingAdminPayloadDraft = {
  title: string;
  subtitle: string;
  description: string;
  publisher: string;
  publishedDate: string;
  mediaType: string;
  format: string;
  coverUrl: string;
  totalCopies: string;
  availableCopies: string;
  status: string;
  source: string;
};

export type LendingAdminApiPayload = {
  title: string;
  subtitle: string | null;
  authors: string[];
  description: string | null;
  publisher: string | null;
  publishedDate: string | null;
  mediaType: string;
  format: string | null;
  coverUrl: string | null;
  totalCopies: number;
  availableCopies: number;
  status: LendingAdminLifecycleStatus;
  source: string;
  subjects: string[];
  tags: string[];
  isbn?: string;
};

function nullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function firstNonBlankString(...values: string[]): string {
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

export function normalizeLendingAdminLifecycleStatus(value: string): LendingAdminLifecycleStatus {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "available") return "available";
  if (normalized === "checked_out" || normalized === "checkedout") return "checked_out";
  if (normalized === "overdue") return "overdue";
  if (normalized === "lost") return "lost";
  if (normalized === "unavailable") return "unavailable";
  return "archived";
}

export function buildLendingAdminApiPayload(input: {
  draft: LendingAdminPayloadDraft;
  authors: string[];
  subjects: string[];
  techniques: string[];
  isbn: LendingAdminIsbnVariants;
}): LendingAdminApiPayload {
  const totalCopies = Number.parseInt(input.draft.totalCopies.trim(), 10);
  const availableCopies = Number.parseInt(input.draft.availableCopies.trim(), 10);

  const payload: LendingAdminApiPayload = {
    title: input.draft.title.trim(),
    subtitle: nullableText(input.draft.subtitle),
    authors: input.authors,
    description: nullableText(input.draft.description),
    publisher: nullableText(input.draft.publisher),
    publishedDate: nullableText(input.draft.publishedDate),
    mediaType: firstNonBlankString(input.draft.mediaType, "book"),
    format: nullableText(input.draft.format),
    coverUrl: nullableText(input.draft.coverUrl),
    totalCopies: Number.isFinite(totalCopies) ? totalCopies : 0,
    availableCopies: Number.isFinite(availableCopies) ? availableCopies : 0,
    status: normalizeLendingAdminLifecycleStatus(input.draft.status),
    source: firstNonBlankString(input.draft.source, "manual"),
    subjects: input.subjects,
    tags: input.techniques,
  };

  if (input.isbn.primary) {
    payload.isbn = input.isbn.primary;
  }

  return payload;
}
