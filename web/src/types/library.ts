export type LibraryItemStatus =
  | "available"
  | "checked_out"
  | "overdue"
  | "lost"
  | "unavailable"
  | "archived"
  | (string & {});
export type LibraryMediaType =
  | "book"
  | "media"
  | "tool"
  | "other"
  | "physical_book"
  | "physical-book"
  | "print"
  | (string & {});
export type LibraryCoverQualityStatus =
  | "approved"
  | "needs_review"
  | "missing"
  | (string & {});
export type LibrarySource = "local_reference" | "openlibrary" | "googlebooks" | "manual" | "donation";
export type LibraryDifficulty = "beginner" | "intermediate" | "advanced" | "all-levels";

export type LibraryIdentifiers = {
  isbn10?: string | null;
  isbn13?: string | null;
  olid?: string | null;
  googleVolumeId?: string | null;
};

export type LibraryWorkshopLink = {
  id?: string | null;
  title: string;
  url?: string | null;
  scheduleLabel?: string | null;
  status?: string | null;
};

export type LibraryCuration = {
  staffPick?: boolean | null;
  staffRationale?: string | null;
  shelf?: string | null;
  shelfRank?: number | null;
  retrospectiveNote?: string | null;
  featuredUntilIso?: string | null;
};

export type LibraryLifecycle = {
  queueDepth?: number | null;
  queueMessage?: string | null;
  waitlistCount?: number | null;
  nextAvailableIso?: string | null;
  etaDays?: number | null;
  renewable?: boolean | null;
  renewalPolicyNote?: string | null;
  notifyEnabledByDefault?: boolean | null;
};

export type LibraryReviewSummary = {
  reviewCount: number;
  averagePracticality: number | null;
  topDifficulty?: LibraryDifficulty | null;
  topBestFor?: string | null;
  reflectionsCount?: number;
  latestReflection?: string | null;
};

export type LibraryItem = {
  id: string;
  title: string;
  subtitle?: string | null;
  authors: string[];
  description?: string | null;
  publisher?: string | null;
  publishedDate?: string | null;
  pageCount?: number | null;
  subjects?: string[];
  mediaType: LibraryMediaType;
  format?: string | null;
  coverUrl?: string | null;
  coverQualityStatus?: LibraryCoverQualityStatus | null;
  needsCoverReview?: boolean | null;
  coverQualityReason?: string | null;
  coverQualityValidatedAt?: { toDate?: () => Date } | null;
  identifiers?: LibraryIdentifiers;
  totalCopies: number;
  availableCopies: number;
  status: LibraryItemStatus;
  source: LibrarySource;
  searchTokens?: string[];
  techniques?: string[];
  releaseYear?: number | null;
  primaryGenre?: string | null;
  genre?: string | null;
  studioCategory?: string | null;
  aggregateRating?: number | null;
  aggregateRatingCount?: number | null;
  borrowCount?: number | null;
  lastReviewedAtIso?: string | null;
  lendingEligible?: boolean | null;
  curation?: LibraryCuration | null;
  lifecycle?: LibraryLifecycle | null;
  reviewSummary?: LibraryReviewSummary | null;
  relatedWorkshops?: LibraryWorkshopLink[];
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
  queuePosition?: number | null;
  queueDepth?: number | null;
  etaLabel?: string | null;
  notifyOnAvailable?: boolean | null;
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
  renewalEligible?: boolean | null;
  renewalCount?: number | null;
  renewalLimit?: number | null;
  renewalPolicyNote?: string | null;
  renewalRequestedAt?: { toDate?: () => Date } | null;
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

export type LibraryRecommendationFeedbackKind = "helpful" | "not_helpful";
export type LibraryRecommendationModerationStatus =
  | "pending_review"
  | "approved"
  | "rejected"
  | "hidden"
  | (string & {});

export type LibraryExternalLookupResult = {
  id: string;
  title: string;
  subtitle?: string | null;
  author: string;
  authors: string[];
  description?: string | null;
  publisher?: string | null;
  publishedDate?: string | null;
  coverUrl?: string | null;
  isbn10?: string | null;
  isbn13?: string | null;
  source: string;
  sourceLabel?: string | null;
  sourceUrl?: string | null;
  publicLibraryUrl?: string | null;
  summary?: string | null;
  publishedYear?: number | null;
};

export type LibraryRecommendation = {
  id: string;
  itemId?: string | null;
  title: string;
  author: string;
  rationale: string;
  reason: string;
  isbn?: string | null;
  linkUrl?: string | null;
  coverUrl?: string | null;
  sourceLabel?: string | null;
  sourceUrl?: string | null;
  techniques: string[];
  studioRelevance: string[];
  intentContext?: string | null;
  tags: string[];
  moderationStatus: LibraryRecommendationModerationStatus;
  recommenderUid?: string | null;
  recommenderName?: string | null;
  recommendedByUid?: string | null;
  recommendedByName?: string | null;
  isMine?: boolean;
  helpfulCount: number;
  feedbackCount: number;
  notHelpfulCount: number;
  viewerFeedback?: LibraryRecommendationFeedbackKind | null;
  createdAtIso?: string | null;
  updatedAtIso?: string | null;
  createdAt?: { toDate?: () => Date } | null;
};
