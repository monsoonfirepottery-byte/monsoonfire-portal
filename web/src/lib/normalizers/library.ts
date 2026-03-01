import type {
  LibraryExternalLookupResult,
  LibraryItem,
  LibraryLoan,
  LibraryRecommendation,
  LibraryRecommendationFeedbackKind,
  LibraryRequest,
} from "../../types/library";

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function recommendationMetadataList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return uniqueStrings(strList(value).map(normalizeToken).filter(Boolean));
  }
  if (typeof value === "string") {
    return uniqueStrings(
      value
        .split(/[,\n;]+/g)
        .map(normalizeToken)
        .filter(Boolean)
    );
  }
  return [];
}

function tagsWithPrefix(tags: string[], prefix: string): string[] {
  return uniqueStrings(
    tags
      .filter((tag) => tag.startsWith(prefix))
      .map((tag) => normalizeToken(tag.slice(prefix.length)))
      .filter(Boolean)
  );
}

function nonNegativeInt(value: unknown): number {
  const parsed = num(value);
  if (parsed === null) return 0;
  if (parsed < 0) return 0;
  return Math.round(parsed);
}

function feedbackKind(value: unknown): LibraryRecommendationFeedbackKind | null {
  return value === "helpful" || value === "not_helpful" ? value : null;
}

function timestampFromUnknown(value: unknown): { toDate?: () => Date } | null {
  if (value && typeof value === "object" && typeof (value as { toDate?: unknown }).toDate === "function") {
    return value as { toDate?: () => Date };
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return { toDate: () => new Date(parsed) };
    }
  }
  return null;
}

export function resolveMemberApprovedLibraryCoverUrl(
  item: Pick<LibraryItem, "coverUrl" | "coverQualityStatus" | "needsCoverReview">
): string | null {
  const coverUrl = str(item.coverUrl)?.trim() ?? "";
  if (!coverUrl) return null;
  if (item.needsCoverReview === true) return null;
  return item.coverQualityStatus === "approved" ? coverUrl : null;
}

export function normalizeLibraryItem(id: string, raw: Partial<LibraryItem>): LibraryItem {
  const reviewSummaryRaw = raw.reviewSummary ?? null;
  const curationRaw = raw.curation ?? null;
  const lifecycleRaw = raw.lifecycle ?? null;
  const workshopRaw = raw.relatedWorkshops ?? [];

  return {
    id,
    title: typeof raw.title === "string" ? raw.title : "Untitled",
    subtitle: raw.subtitle ?? null,
    authors: strList(raw.authors),
    description: raw.description ?? null,
    publisher: raw.publisher ?? null,
    publishedDate: raw.publishedDate ?? null,
    pageCount: typeof raw.pageCount === "number" ? raw.pageCount : null,
    subjects: strList(raw.subjects),
    mediaType: raw.mediaType ?? "book",
    format: raw.format ?? null,
    coverUrl: raw.coverUrl ?? null,
    coverQualityStatus: str(raw.coverQualityStatus),
    needsCoverReview: bool(raw.needsCoverReview),
    coverQualityReason: str(raw.coverQualityReason),
    coverQualityValidatedAt: timestampFromUnknown(raw.coverQualityValidatedAt),
    identifiers: raw.identifiers ?? undefined,
    totalCopies: typeof raw.totalCopies === "number" ? raw.totalCopies : 1,
    availableCopies: typeof raw.availableCopies === "number" ? raw.availableCopies : 0,
    status: raw.status ?? "available",
    source: raw.source ?? "manual",
    searchTokens: strList(raw.searchTokens),
    techniques: strList(raw.techniques),
    releaseYear: num(raw.releaseYear),
    primaryGenre: str(raw.primaryGenre),
    genre: str(raw.genre) ?? str(raw.primaryGenre),
    studioCategory: str(raw.studioCategory),
    aggregateRating: num(raw.aggregateRating),
    aggregateRatingCount: num(raw.aggregateRatingCount),
    borrowCount: num(raw.borrowCount),
    lastReviewedAtIso: str(raw.lastReviewedAtIso),
    lendingEligible: bool(raw.lendingEligible),
    curation: curationRaw
      ? {
          staffPick: bool(curationRaw.staffPick),
          staffRationale: str(curationRaw.staffRationale),
          shelf: str(curationRaw.shelf),
          shelfRank: num(curationRaw.shelfRank),
          retrospectiveNote: str(curationRaw.retrospectiveNote),
          featuredUntilIso: str(curationRaw.featuredUntilIso),
        }
      : null,
    lifecycle: lifecycleRaw
      ? {
          queueDepth: num(lifecycleRaw.queueDepth),
          queueMessage: str(lifecycleRaw.queueMessage),
          waitlistCount: num(lifecycleRaw.waitlistCount),
          nextAvailableIso: str(lifecycleRaw.nextAvailableIso),
          etaDays: num(lifecycleRaw.etaDays),
          renewable: bool(lifecycleRaw.renewable),
          renewalPolicyNote: str(lifecycleRaw.renewalPolicyNote),
          notifyEnabledByDefault: bool(lifecycleRaw.notifyEnabledByDefault),
        }
      : null,
    reviewSummary: reviewSummaryRaw
      ? {
          reviewCount: num(reviewSummaryRaw.reviewCount) ?? 0,
          averagePracticality: num(reviewSummaryRaw.averagePracticality),
          topDifficulty:
            reviewSummaryRaw.topDifficulty === "beginner" ||
            reviewSummaryRaw.topDifficulty === "intermediate" ||
            reviewSummaryRaw.topDifficulty === "advanced" ||
            reviewSummaryRaw.topDifficulty === "all-levels"
              ? reviewSummaryRaw.topDifficulty
              : null,
          topBestFor: str(reviewSummaryRaw.topBestFor),
          reflectionsCount: num(reviewSummaryRaw.reflectionsCount) ?? 0,
          latestReflection: str(reviewSummaryRaw.latestReflection),
        }
      : null,
    relatedWorkshops: Array.isArray(workshopRaw)
      ? workshopRaw
          .map((entry) => {
            const title = str(entry?.title);
            if (!title) return null;
            return {
              id: str(entry.id),
              title,
              url: str(entry.url),
              scheduleLabel: str(entry.scheduleLabel),
              status: str(entry.status),
            };
          })
          .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      : [],
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
    queuePosition: num(raw.queuePosition),
    queueDepth: num(raw.queueDepth),
    etaLabel: str(raw.etaLabel),
    notifyOnAvailable: bool(raw.notifyOnAvailable),
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
    renewalEligible: bool(raw.renewalEligible),
    renewalCount: num(raw.renewalCount),
    renewalLimit: num(raw.renewalLimit),
    renewalPolicyNote: str(raw.renewalPolicyNote),
    renewalRequestedAt: raw.renewalRequestedAt ?? null,
  };
}

export function normalizeLibraryExternalLookupResult(
  raw: Record<string, unknown>,
  index = 0
): LibraryExternalLookupResult | null {
  const identifiers =
    raw.identifiers && typeof raw.identifiers === "object"
      ? (raw.identifiers as Record<string, unknown>)
      : null;
  const rawTitle = str(raw.title) ?? "Untitled";
  const rawAuthors = strList(raw.authors);
  const rawAuthor = str(raw.author) ?? rawAuthors[0] ?? "Unknown author";
  const source = str(raw.source) ?? "external";
  const sourceId = str(raw.sourceId);
  const id =
    str(raw.id) ??
    (sourceId ? `${source}-${sourceId}` : null) ??
    `external-${index + 1}-${rawTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  return {
    id,
    title: rawTitle,
    subtitle: str(raw.subtitle),
    author: rawAuthor,
    authors: rawAuthors.length > 0 ? rawAuthors : [rawAuthor],
    description: str(raw.description),
    publisher: str(raw.publisher),
    publishedDate: str(raw.publishedDate),
    coverUrl: str(raw.coverUrl),
    isbn10: str(identifiers?.isbn10) ?? str(raw.isbn10),
    isbn13: str(identifiers?.isbn13) ?? str(raw.isbn13),
    source,
    sourceLabel: str(raw.sourceLabel) ?? source,
    sourceUrl: str(raw.sourceUrl),
    publicLibraryUrl: str(raw.publicLibraryUrl),
    summary: str(raw.summary) ?? str(raw.description),
  };
}

export function normalizeLibraryRecommendation(id: string, raw: Partial<LibraryRecommendation>): LibraryRecommendation {
  const createdAt = timestampFromUnknown(raw.createdAt) ?? timestampFromUnknown(raw.createdAtIso) ?? null;
  const feedbackCount = nonNegativeInt(raw.feedbackCount);
  const helpfulCount = nonNegativeInt(raw.helpfulCount);
  const notHelpfulCount = Math.max(0, feedbackCount - helpfulCount);
  const rawFeedback = feedbackKind(raw.viewerFeedback);
  const rationale = typeof raw.rationale === "string" ? raw.rationale : typeof raw.reason === "string" ? raw.reason : "";
  const tags = uniqueStrings(strList(raw.tags).map(normalizeToken).filter(Boolean));
  const techniques = uniqueStrings([
    ...recommendationMetadataList(raw.techniques),
    ...tagsWithPrefix(tags, "technique:"),
  ]);
  const studioRelevance = uniqueStrings([
    ...recommendationMetadataList(raw.studioRelevance),
    ...tagsWithPrefix(tags, "studio:"),
  ]);
  const intentContext =
    str(raw.intentContext) ??
    tagsWithPrefix(tags, "intent:")[0] ??
    null;
  const recommenderUid = str(raw.recommenderUid) ?? str(raw.recommendedByUid);
  const recommenderName = str(raw.recommenderName) ?? str(raw.recommendedByName);

  return {
    id,
    itemId: str(raw.itemId),
    title: typeof raw.title === "string" ? raw.title : "Untitled recommendation",
    author: typeof raw.author === "string" ? raw.author : "Unknown author",
    rationale,
    reason: rationale,
    isbn: str(raw.isbn),
    linkUrl: str(raw.linkUrl),
    coverUrl: str(raw.coverUrl),
    sourceLabel: str(raw.sourceLabel),
    sourceUrl: str(raw.sourceUrl),
    techniques,
    studioRelevance,
    intentContext,
    tags,
    moderationStatus: str(raw.moderationStatus) ?? "pending_review",
    recommenderUid,
    recommenderName,
    recommendedByUid: recommenderUid,
    recommendedByName: recommenderName,
    isMine: raw.isMine === true,
    helpfulCount,
    feedbackCount,
    notHelpfulCount,
    viewerFeedback: rawFeedback,
    createdAtIso: str(raw.createdAtIso),
    updatedAtIso: str(raw.updatedAtIso),
    createdAt,
  };
}
