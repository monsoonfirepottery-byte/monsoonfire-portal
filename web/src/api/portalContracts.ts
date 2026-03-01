// web/src/api/portalContracts.ts
// Canonical Portal API + timeline contracts (web + native clients)

export const V1_RESERVATION_CREATE_FN = "apiV1/v1/reservations.create";
export const V1_RESERVATION_UPDATE_FN = "apiV1/v1/reservations.update";
export const V1_RESERVATION_ASSIGN_STATION_FN = "apiV1/v1/reservations.assignStation";
export const V1_RESERVATION_PICKUP_WINDOW_FN = "apiV1/v1/reservations.pickupWindow";
export const V1_RESERVATION_QUEUE_FAIRNESS_FN = "apiV1/v1/reservations.queueFairness";
export const V1_RESERVATION_EXPORT_CONTINUITY_FN = "apiV1/v1/reservations.exportContinuity";
export const V1_LIBRARY_ITEMS_LIST_FN = "apiV1/v1/library.items.list";
export const V1_LIBRARY_ITEMS_GET_FN = "apiV1/v1/library.items.get";
export const V1_LIBRARY_DISCOVERY_GET_FN = "apiV1/v1/library.discovery.get";
export const V1_LIBRARY_EXTERNAL_LOOKUP_FN = "apiV1/v1/library.externalLookup";
export const V1_LIBRARY_EXTERNAL_LOOKUP_PROVIDER_CONFIG_GET_FN =
  "apiV1/v1/library.externalLookup.providerConfig.get";
export const V1_LIBRARY_EXTERNAL_LOOKUP_PROVIDER_CONFIG_SET_FN =
  "apiV1/v1/library.externalLookup.providerConfig.set";
export const V1_LIBRARY_ROLLOUT_CONFIG_GET_FN = "apiV1/v1/library.rollout.get";
export const V1_LIBRARY_ROLLOUT_CONFIG_SET_FN = "apiV1/v1/library.rollout.set";
export const V1_LIBRARY_RECOMMENDATIONS_LIST_FN = "apiV1/v1/library.recommendations.list";
export const V1_LIBRARY_RECOMMENDATIONS_CREATE_FN = "apiV1/v1/library.recommendations.create";
export const V1_LIBRARY_RECOMMENDATIONS_FEEDBACK_SUBMIT_FN =
  "apiV1/v1/library.recommendations.feedback.submit";
export const V1_LIBRARY_ITEMS_IMPORT_ISBNS_FN = "apiV1/v1/library.items.importIsbns";
export const V1_LIBRARY_RATINGS_UPSERT_FN = "apiV1/v1/library.ratings.upsert";
export const V1_LIBRARY_REVIEWS_CREATE_FN = "apiV1/v1/library.reviews.create";
export const V1_LIBRARY_REVIEWS_UPDATE_FN = "apiV1/v1/library.reviews.update";
export const V1_LIBRARY_TAG_SUBMISSIONS_CREATE_FN = "apiV1/v1/library.tags.submissions.create";
export const V1_LIBRARY_TAG_SUBMISSIONS_APPROVE_FN = "apiV1/v1/library.tags.submissions.approve";
export const V1_LIBRARY_TAGS_MERGE_FN = "apiV1/v1/library.tags.merge";
export const V1_LIBRARY_READING_STATUS_UPSERT_FN = "apiV1/v1/library.readingStatus.upsert";
export const V1_LIBRARY_LOANS_CHECKOUT_FN = "apiV1/v1/library.loans.checkout";
export const V1_LIBRARY_LOANS_CHECKIN_FN = "apiV1/v1/library.loans.checkIn";
export const V1_LIBRARY_LOANS_LIST_MINE_FN = "apiV1/v1/library.loans.listMine";
export const V1_LIBRARY_LOANS_MARK_LOST_FN = "apiV1/v1/library.loans.markLost";
export const V1_LIBRARY_LOANS_ASSESS_REPLACEMENT_FEE_FN = "apiV1/v1/library.loans.assessReplacementFee";
export const V1_LIBRARY_ITEMS_OVERRIDE_STATUS_FN = "apiV1/v1/library.items.overrideStatus";
export const LEGACY_RESERVATION_COMPAT_REVIEW_DATE = "2026-05-15";
export const LEGACY_RESERVATION_COMPAT_SUNSET_NOT_BEFORE = "2026-06-30";
export type IntakeMode = "SHELF_PURCHASE" | "WHOLE_KILN" | "COMMUNITY_SHELF";

export type PortalFnName =
  | "createBatch"
  | "pickedUpAndClose"
  | "continueJourney"
  | "createReservation"
  | "updateReservation"
  | "assignReservationStation"
  | typeof V1_RESERVATION_CREATE_FN
  | typeof V1_RESERVATION_UPDATE_FN
  | typeof V1_RESERVATION_ASSIGN_STATION_FN
  | typeof V1_RESERVATION_PICKUP_WINDOW_FN
  | typeof V1_RESERVATION_QUEUE_FAIRNESS_FN
  | typeof V1_RESERVATION_EXPORT_CONTINUITY_FN
  | typeof V1_LIBRARY_ITEMS_LIST_FN
  | typeof V1_LIBRARY_ITEMS_GET_FN
  | typeof V1_LIBRARY_DISCOVERY_GET_FN
  | typeof V1_LIBRARY_EXTERNAL_LOOKUP_FN
  | typeof V1_LIBRARY_EXTERNAL_LOOKUP_PROVIDER_CONFIG_GET_FN
  | typeof V1_LIBRARY_EXTERNAL_LOOKUP_PROVIDER_CONFIG_SET_FN
  | typeof V1_LIBRARY_ROLLOUT_CONFIG_GET_FN
  | typeof V1_LIBRARY_ROLLOUT_CONFIG_SET_FN
  | typeof V1_LIBRARY_RECOMMENDATIONS_LIST_FN
  | typeof V1_LIBRARY_RECOMMENDATIONS_CREATE_FN
  | typeof V1_LIBRARY_RECOMMENDATIONS_FEEDBACK_SUBMIT_FN
  | typeof V1_LIBRARY_ITEMS_IMPORT_ISBNS_FN
  | typeof V1_LIBRARY_RATINGS_UPSERT_FN
  | typeof V1_LIBRARY_REVIEWS_CREATE_FN
  | typeof V1_LIBRARY_REVIEWS_UPDATE_FN
  | typeof V1_LIBRARY_TAG_SUBMISSIONS_CREATE_FN
  | typeof V1_LIBRARY_TAG_SUBMISSIONS_APPROVE_FN
  | typeof V1_LIBRARY_TAGS_MERGE_FN
  | typeof V1_LIBRARY_READING_STATUS_UPSERT_FN
  | typeof V1_LIBRARY_LOANS_CHECKOUT_FN
  | typeof V1_LIBRARY_LOANS_CHECKIN_FN
  | typeof V1_LIBRARY_LOANS_LIST_MINE_FN
  | typeof V1_LIBRARY_LOANS_MARK_LOST_FN
  | typeof V1_LIBRARY_LOANS_ASSESS_REPLACEMENT_FEE_FN
  | typeof V1_LIBRARY_ITEMS_OVERRIDE_STATUS_FN
  | "listMaterialsProducts"
  | "createMaterialsCheckoutSession"
  | "seedMaterialsCatalog"
  | "listEvents"
  | "listIndustryEvents"
  | "listEventSignups"
  | "getEvent"
  | "getIndustryEvent"
  | "upsertIndustryEvent"
  | "runIndustryEventsFreshnessNow"
  | "createEvent"
  | "publishEvent"
  | "signupForEvent"
  | "cancelEventSignup"
  | "claimEventOffer"
  | "checkInEvent"
  | "createEventCheckoutSession"
  | "importLibraryIsbns"
  | "listBillingSummary"
  | "registerDeviceToken"
  | "unregisterDeviceToken"
  | "runNotificationMetricsAggregationNow"
  | "runNotificationFailureDrill"
  // add more function names here as you ship them
  | (string & {});

/**
 * Shared error envelope (client-side)
 * - We keep this flexible because Functions errors can come in different shapes.
 */
export type PortalApiErrorCode =
  | "UNAUTHENTICATED"
  | "PERMISSION_DENIED"
  | "INVALID_ARGUMENT"
  | "NOT_FOUND"
  | "CONFLICT"
  | "FAILED_PRECONDITION"
  | "INTERNAL"
  | "UNKNOWN"
  | (string & {});

export type PortalApiErrorEnvelope = {
  ok?: false;
  error?: string;
  message?: string;
  code?: PortalApiErrorCode;
  details?: unknown;
};

/**
 * Shared success envelope (most functions)
 */
export type PortalApiOkEnvelope = {
  ok: true;
};

/**
 * Utility: narrow an unknown response into "ok: true"
 */
export function isOkEnvelope(x: unknown): x is PortalApiOkEnvelope {
  return !!x && typeof x === "object" && (x as { ok?: unknown }).ok === true;
}

/**
 * Utility: extract a human-friendly message from unknown error responses
 */
export function getErrorMessage(x: unknown): string {
  if (!x) return "Request failed";
  if (typeof x === "string") return x;
  if (typeof x !== "object") return String(x);

  const o = x as { message?: unknown; error?: unknown; details?: unknown };
  return (
    (typeof o.message === "string" ? o.message : undefined) ||
    (typeof o.error === "string" ? o.error : undefined) ||
    (typeof o.details === "string" ? o.details : undefined) ||
    "Request failed"
  );
}

/**
 * Utility: extract an error code if present
 */
export function getErrorCode(x: unknown): PortalApiErrorCode | undefined {
  if (!x || typeof x !== "object") return undefined;
  const o = x as { code?: unknown };
  return typeof o.code === "string" ? (o.code as PortalApiErrorCode) : undefined;
}

/* =========================
   Requests
   ========================= */

export type CreateBatchRequest = {
  ownerUid: string;
  ownerDisplayName: string;
  title: string;

  // Important: Firestore rejects undefined; omit fields or use null if needed.
  kilnName?: string | null;

  intakeMode: IntakeMode | (string & {});

  estimatedCostCents: number;

  // Notes (prefer estimateNotes; notes is legacy alias)
  estimateNotes?: string | null;
  notes?: string | null;
  clientRequestId?: string | null;
};

export type ReservationPreferredWindow = {
  earliestDate?: string | null;
  latestDate?: string | null;
};

export type ReservationPieceStatus =
  | "awaiting_placement"
  | "loaded"
  | "fired"
  | "ready"
  | "picked_up";

export type ReservationPieceInput = {
  pieceId?: string | null;
  pieceLabel?: string | null;
  pieceCount?: number | null;
  piecePhotoUrl?: string | null;
  pieceStatus?: ReservationPieceStatus | null;
};

export type ReservationStationId =
  | "studio-kiln-a"
  | "studio-kiln-b"
  | "studio-electric"
  | "reduction-raku";
export type ReservationStationAlias = "reductionraku" | "reduction_raku";
export type ReservationStationInput =
  | ReservationStationId
  | ReservationStationAlias
  | (string & {});

export type CreateReservationRequest = {
  intakeMode?: IntakeMode | (string & {});
  firingType: "bisque" | "glaze" | "other";
  shelfEquivalent: number;
  footprintHalfShelves?: number | null;
  heightInches?: number | null;
  tiers?: number | null;
  estimatedHalfShelves?: number | null;
  estimatedCost?: number | null;
  preferredWindow?: ReservationPreferredWindow;
  linkedBatchId?: string | null;
  clientRequestId?: string | null;
  ownerUid?: string | null;
  wareType?: string | null;
  // Legacy aliases are accepted and normalized server-side.
  kilnId?: ReservationStationInput | null;
  kilnLabel?: string | null;
  quantityTier?: string | null;
  quantityLabel?: string | null;
  photoUrl?: string | null;
  photoPath?: string | null;
  dropOffProfile?: {
    id?: string | null;
    label?: string | null;
    pieceCount?: "single" | "many" | null;
    hasTall?: boolean | null;
    stackable?: boolean | null;
    bisqueOnly?: boolean | null;
    specialHandling?: boolean | null;
  } | null;
  dropOffQuantity?: {
    id?: string | null;
    label?: string | null;
    pieceRange?: string | null;
  } | null;
  notes?: {
    general?: string | null;
    clayBody?: string | null;
    glazeNotes?: string | null;
  } | null;
  pieces?: ReservationPieceInput[] | null;
  addOns?: {
    rushRequested?: boolean;
    wholeKilnRequested?: boolean;
    communityShelfFillInAllowed?: boolean;
    pickupDeliveryRequested?: boolean;
    returnDeliveryRequested?: boolean;
    useStudioGlazes?: boolean;
    glazeAccessCost?: number | null;
  } | null;
};

export type PickedUpAndCloseRequest = {
  uid: string;
  batchId: string;
};

export type ContinueJourneyRequest = {
  uid: string;
  fromBatchId: string;
};

export type UpdateReservationRequest = {
  reservationId: string;
  status?: "REQUESTED" | "CONFIRMED" | "WAITLISTED" | "CANCELLED";
  loadStatus?: "queued" | "loading" | "loaded";
  staffNotes?: string | null;
  force?: boolean;
};

export type UpdateReservationResponse = PortalApiOkEnvelope & {
  reservationId?: string;
  status?: string;
  loadStatus?: string;
  arrivalToken?: string | null;
  arrivalTokenExpiresAt?: unknown;
  idempotentReplay?: boolean;
};

export type PickupWindowStatus = "open" | "confirmed" | "missed" | "expired" | "completed";

export type ReservationPickupWindowAction =
  | "staff_set_open_window"
  | "member_confirm_window"
  | "member_request_reschedule"
  | "staff_mark_missed"
  | "staff_mark_completed";

export type ReservationPickupWindowRequest = {
  reservationId: string;
  action: ReservationPickupWindowAction;
  confirmedStart?: string | null;
  confirmedEnd?: string | null;
  requestedStart?: string | null;
  requestedEnd?: string | null;
  note?: string | null;
  force?: boolean;
};

export type ReservationPickupWindowResponse = PortalApiOkEnvelope & {
  reservationId?: string;
  pickupWindowStatus?: PickupWindowStatus | null;
  pickupWindow?: {
    requestedStart?: string | null;
    requestedEnd?: string | null;
    confirmedStart?: string | null;
    confirmedEnd?: string | null;
    status?: PickupWindowStatus | null;
    confirmedAt?: string | null;
    completedAt?: string | null;
    missedCount?: number | null;
    rescheduleCount?: number | null;
    lastMissedAt?: string | null;
    lastRescheduleRequestedAt?: string | null;
  } | null;
  storageStatus?: string | null;
  idempotentReplay?: boolean;
};

export type ReservationQueueFairnessAction =
  | "record_no_show"
  | "record_late_arrival"
  | "set_override_boost"
  | "clear_override";

export type ReservationQueueFairnessRequest = {
  reservationId: string;
  action: ReservationQueueFairnessAction;
  reason: string;
  boostPoints?: number | null;
  overrideUntil?: string | null;
};

export type ReservationQueueFairnessResponse = PortalApiOkEnvelope & {
  reservationId?: string;
  action?: ReservationQueueFairnessAction | string;
  evidenceId?: string | null;
  queueFairness?: {
    noShowCount?: number | null;
    lateArrivalCount?: number | null;
    overrideBoost?: number | null;
    overrideReason?: string | null;
    overrideUntil?: string | null;
    updatedAt?: string | null;
    updatedByUid?: string | null;
    updatedByRole?: "staff" | "dev" | "system" | null | string;
    lastPolicyNote?: string | null;
  } | null;
  queueFairnessPolicy?: {
    noShowCount?: number | null;
    lateArrivalCount?: number | null;
    penaltyPoints?: number | null;
    effectivePenaltyPoints?: number | null;
    overrideBoostApplied?: number | null;
    reasonCodes?: string[];
    policyVersion?: string | null;
    computedAt?: string | null;
  } | null;
};

export type ReservationExportContinuityRequest = {
  ownerUid?: string | null;
  includeCsv?: boolean;
  limit?: number;
};

export type ReservationExportContinuityResponse = PortalApiOkEnvelope & {
  exportHeader?: {
    artifactId?: string;
    ownerUid?: string;
    generatedAt?: string;
    schemaVersion?: string;
    format?: string[];
    signature?: string;
    requestId?: string;
  } | null;
  redactionRules?: string[];
  summary?: Record<string, number>;
  warnings?: string[];
  jsonBundle?: Record<string, unknown>;
  csvBundle?: Record<string, string> | null;
};

export type AssignReservationStationRequest = {
  reservationId: string;
  // Legacy aliases are accepted and normalized server-side.
  assignedStationId: ReservationStationInput;
  queueClass?: string | null;
  requiredResources?: {
    kilnProfile?: string | null;
    rackCount?: number | null;
    specialHandling?: string[];
  } | null;
};

export type AssignReservationStationResponse = PortalApiOkEnvelope & {
  reservationId?: string;
  assignedStationId?: string;
  previousAssignedStationId?: string | null;
  stationCapacity?: number | null;
  stationUsedAfter?: number | null;
  idempotentReplay?: boolean;
};

export type MaterialsCartItemRequest = {
  productId: string;
  quantity: number;
};

export type ListMaterialsProductsRequest = {
  includeInactive?: boolean;
};

export type CreateMaterialsCheckoutSessionRequest = {
  items: MaterialsCartItemRequest[];
  pickupNotes?: string | null;
};

export type SeedMaterialsCatalogRequest = {
  force?: boolean;
  acknowledge?: string;
  reason?: string;
};

export type ListEventsRequest = {
  includeDrafts?: boolean;
  includeCancelled?: boolean;
};

export type IndustryEventMode = "local" | "remote" | "hybrid";
export type IndustryEventModeFilter = IndustryEventMode | "all";

export type ListIndustryEventsRequest = {
  mode?: IndustryEventModeFilter;
  includePast?: boolean;
  includeDrafts?: boolean;
  includeCancelled?: boolean;
  featuredOnly?: boolean;
  limit?: number;
};

export type GetIndustryEventRequest = {
  eventId: string;
};

export type UpsertIndustryEventRequest = {
  eventId?: string | null;
  title: string;
  summary: string;
  description?: string | null;
  mode?: IndustryEventMode | null;
  status?: IndustryEventStatus | null;
  startAt?: string | null;
  endAt?: string | null;
  timezone?: string | null;
  location?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  remoteUrl?: string | null;
  registrationUrl?: string | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
  featured?: boolean;
  tags?: string[];
  verifiedAt?: string | null;
};

export type RunIndustryEventsFreshnessNowRequest = {
  dryRun?: boolean;
  limit?: number;
  staleReviewDays?: number;
  retirePastHours?: number;
};

export type GetEventRequest = {
  eventId: string;
};

export type ListEventSignupsRequest = {
  eventId: string;
  includeCancelled?: boolean;
  includeExpired?: boolean;
  limit?: number;
};

export type ListBillingSummaryRequest = {
  limit?: number;
  from?: string | null;
  to?: string | null;
};

export type EventAddOnInput = {
  id: string;
  title: string;
  priceCents: number;
  isActive: boolean;
};

export type CreateEventRequest = {
  templateId?: string | null;
  title: string;
  summary: string;
  description: string;
  location: string;
  timezone: string;
  startAt: string;
  endAt: string;
  capacity: number;
  priceCents: number;
  currency: string;
  includesFiring: boolean;
  firingDetails?: string | null;
  policyCopy?: string | null;
  addOns?: EventAddOnInput[];
  waitlistEnabled?: boolean;
  offerClaimWindowHours?: number;
  cancelCutoffHours?: number;
};

export type PublishEventRequest = {
  eventId: string;
};

export type SignupForEventRequest = {
  eventId: string;
};

export type CancelEventSignupRequest = {
  signupId: string;
};

export type ClaimEventOfferRequest = {
  signupId: string;
};

export type CheckInEventRequest = {
  signupId: string;
  method: "staff" | "self";
};

export type CreateEventCheckoutSessionRequest = {
  eventId: string;
  signupId: string;
  addOnIds?: string[];
};

export type ImportLibraryIsbnsRequest = {
  isbns: string[];
  source?: "csv" | "manual" | "donation" | (string & {});
};

export type LibraryRecommendationFeedbackKind = "helpful" | "not_helpful";
export type LibraryCatalogAvailabilityFilter =
  | "available"
  | "checked_out"
  | "overdue"
  | "lost"
  | "unavailable"
  | "archived";
export type LibraryItemsSort =
  | "highest_rated"
  | "most_borrowed"
  | "recently_added"
  | "recently_reviewed"
  | "staff_picks";

export type LibraryItemContract = {
  id?: string;
  title?: string | null;
  subtitle?: string | null;
  authors?: string[] | null;
  description?: string | null;
  publisher?: string | null;
  publishedDate?: string | null;
  pageCount?: number | null;
  subjects?: string[] | null;
  mediaType?: string | null;
  format?: string | null;
  coverUrl?: string | null;
  identifiers?: {
    isbn10?: string | null;
    isbn13?: string | null;
    olid?: string | null;
    googleVolumeId?: string | null;
  } | null;
  totalCopies?: number | null;
  availableCopies?: number | null;
  status?: string | null;
  source?: string | null;
  searchTokens?: string[] | null;
  techniques?: string[] | null;
  releaseYear?: number | null;
  primaryGenre?: string | null;
  genre?: string | null;
  studioCategory?: string | null;
  aggregateRating?: number | null;
  aggregateRatingCount?: number | null;
  borrowCount?: number | null;
  lastReviewedAtIso?: string | null;
  curation?: {
    staffPick?: boolean | null;
    staffRationale?: string | null;
    shelf?: string | null;
    shelfRank?: number | null;
    retrospectiveNote?: string | null;
    featuredUntilIso?: string | null;
  } | null;
  lifecycle?: {
    queueDepth?: number | null;
    queueMessage?: string | null;
    waitlistCount?: number | null;
    nextAvailableIso?: string | null;
    etaDays?: number | null;
    renewable?: boolean | null;
    renewalPolicyNote?: string | null;
    notifyEnabledByDefault?: boolean | null;
  } | null;
  reviewSummary?: {
    reviewCount?: number | null;
    averagePracticality?: number | null;
    topDifficulty?: "beginner" | "intermediate" | "advanced" | "all-levels" | null | string;
    topBestFor?: string | null;
    reflectionsCount?: number | null;
    latestReflection?: string | null;
  } | null;
  relatedWorkshops?: Array<{
    id?: string | null;
    title?: string | null;
    url?: string | null;
    scheduleLabel?: string | null;
    status?: string | null;
  }> | null;
  createdAt?: unknown;
  updatedAt?: unknown;
  [key: string]: unknown;
};

export type LibraryItemsListRequest = {
  q?: string | null;
  mediaType?: string[];
  genre?: string | null;
  studioCategory?: string[];
  availability?: LibraryCatalogAvailabilityFilter | null;
  ratingMin?: number;
  ratingMax?: number;
  sort?: LibraryItemsSort;
  page?: number;
  pageSize?: number;
};

export type LibraryItemsGetRequest = {
  itemId: string;
};

export type LibraryDiscoveryGetRequest = {
  limit?: number;
};

export type LibraryExternalLookupRequest = {
  q: string;
  limit?: number;
};

export type LibraryExternalLookupSource = {
  provider: "openlibrary" | "googlebooks" | (string & {});
  ok: boolean;
  itemCount: number;
  cached: boolean;
  disabled?: boolean;
};

export type LibraryExternalLookupResult = {
  title: string;
  subtitle?: string | null;
  author?: string | null;
  authors?: string[] | null;
  description?: string | null;
  publisher?: string | null;
  publishedDate?: string | null;
  coverUrl?: string | null;
  format?: string | null;
  source?: string | null;
  sourceLabel?: string | null;
  sourceId?: string | null;
  sourceUrl?: string | null;
  publicLibraryUrl?: string | null;
  summary?: string | null;
  publishedYear?: number | null;
  isbn10?: string | null;
  isbn13?: string | null;
  identifiers?: {
    isbn10?: string | null;
    isbn13?: string | null;
    olid?: string | null;
    googleVolumeId?: string | null;
  } | null;
};

export type LibraryRecommendationContract = {
  id?: string;
  itemId?: string | null;
  title?: string | null;
  author?: string | null;
  isbn?: string | null;
  rationale?: string | null;
  reason?: string | null;
  tags?: string[];
  linkUrl?: string | null;
  coverUrl?: string | null;
  sourceLabel?: string | null;
  sourceUrl?: string | null;
  techniques?: string[] | null;
  studioRelevance?: string[] | null;
  intentContext?: string | null;
  moderationStatus?: "pending_review" | "approved" | "rejected" | "hidden" | (string & {});
  recommenderUid?: string | null;
  recommenderName?: string | null;
  recommendedByUid?: string | null;
  recommendedByName?: string | null;
  viewerFeedback?: LibraryRecommendationFeedbackKind | null;
  isMine?: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
  createdAtIso?: string | null;
  updatedAtIso?: string | null;
  helpfulCount?: number | null;
  feedbackCount?: number | null;
};

export type LibraryRecommendationsListRequest = {
  itemId?: string | null;
  status?: "pending_review" | "approved" | "rejected" | "hidden" | null;
  sort?: "newest" | "helpful";
  limit?: number;
};

export type LibraryRecommendationsCreateRequest = {
  itemId?: string | null;
  title?: string | null;
  author?: string | null;
  isbn?: string | null;
  rationale: string;
  tags?: string[];
  linkUrl?: string | null;
  coverUrl?: string | null;
  sourceLabel?: string | null;
  sourceUrl?: string | null;
  techniques?: string[];
  studioRelevance?: string[];
  intentContext?: string | null;
};

export type LibraryRecommendationsFeedbackSubmitRequest = {
  recommendationId: string;
  helpful?: boolean;
  comment?: string | null;
};

export type LibraryExternalLookupProviderConfigSetRequest = {
  openlibraryEnabled?: boolean;
  googlebooksEnabled?: boolean;
  note?: string | null;
};

export type LibraryRolloutPhase =
  | "phase_1_read_only"
  | "phase_2_member_writes"
  | "phase_3_admin_full";

export type LibraryRolloutConfigGetRequest = Record<string, never>;

export type LibraryRolloutConfigSetRequest = {
  phase: LibraryRolloutPhase;
  note?: string | null;
};

export type LibraryTagSubmissionCreateRequest = {
  itemId: string;
  tag: string;
};

export type LibraryTagSubmissionApproveRequest = {
  submissionId: string;
  canonicalTagId?: string | null;
  canonicalTagName?: string | null;
};

export type LibraryTagMergeRequest = {
  sourceTagId: string;
  targetTagId: string;
  note?: string | null;
};

export type LibraryLoanMarkLostRequest = {
  loanId: string;
  note?: string | null;
};

export type LibraryLoanAssessReplacementFeeRequest = {
  loanId: string;
  amountCents?: number | null;
  note?: string | null;
  confirm: boolean;
};

export type LibraryItemOverrideStatusRequest = {
  itemId: string;
  status: "available" | "checked_out" | "overdue" | "lost" | "unavailable" | "archived";
  note?: string | null;
};

export type RegisterDeviceTokenRequest = {
  token: string;
  platform?: "ios";
  environment?: "sandbox" | "production";
  appVersion?: string;
  appBuild?: string;
  deviceModel?: string;
};

export type UnregisterDeviceTokenRequest = {
  token?: string;
  tokenHash?: string;
};

export type RunNotificationFailureDrillRequest = {
  uid: string;
  mode: "auth" | "provider_4xx" | "provider_5xx" | "network" | "success";
  channels?: {
    inApp?: boolean;
    email?: boolean;
    push?: boolean;
    sms?: boolean;
  };
  forceRunNow?: boolean;
};

export type RunNotificationMetricsAggregationNowRequest = Record<string, never>;

/* =========================
   Responses
   ========================= */

export type CreateBatchResponse = PortalApiOkEnvelope & {
  batchId?: string;
  newBatchId?: string;
  existingBatchId?: string;
};

export type PickedUpAndCloseResponse = PortalApiOkEnvelope;

export type ContinueJourneyResponse = PortalApiOkEnvelope & {
  // We accept multiple variants because we've seen different naming patterns across iterations.
  batchId?: string;
  newBatchId?: string;
  existingBatchId?: string;

  // Useful linkage / provenance (optional)
  rootId?: string;
  fromBatchId?: string;

  // Some versions may add messages even on ok
  message?: string;
};

export type CreateReservationResponse = PortalApiOkEnvelope & {
  reservationId?: string;
  status?: string;
};

export type MaterialProduct = {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  sku?: string | null;
  priceCents: number;
  currency: string;
  stripePriceId?: string | null;
  imageUrl?: string | null;
  trackInventory: boolean;
  inventoryOnHand?: number | null;
  inventoryReserved?: number | null;
  inventoryAvailable?: number | null;
  active: boolean;
};

export type ListMaterialsProductsResponse = PortalApiOkEnvelope & {
  products: MaterialProduct[];
};

export type CreateMaterialsCheckoutSessionResponse = PortalApiOkEnvelope & {
  orderId: string;
  checkoutUrl?: string | null;
};

export type SeedMaterialsCatalogResponse = PortalApiOkEnvelope & {
  created: number;
  updated: number;
  total: number;
};

export type EventStatus = "draft" | "published" | "cancelled" | (string & {});

export type EventSignupStatus =
  | "ticketed"
  | "waitlisted"
  | "offered"
  | "checked_in"
  | "cancelled"
  | "expired"
  | (string & {});

export type EventPaymentStatus = "unpaid" | "paid" | "checkout_pending" | "waived" | (string & {});

export type EventAddOn = {
  id: string;
  title: string;
  priceCents: number;
  isActive: boolean;
};

export type EventSummary = {
  id: string;
  title: string;
  summary: string;
  startAt?: string | null;
  endAt?: string | null;
  timezone?: string | null;
  location?: string | null;
  priceCents: number;
  currency: string;
  includesFiring: boolean;
  firingDetails?: string | null;
  capacity: number;
  waitlistEnabled: boolean;
  status: EventStatus;
  remainingCapacity?: number | null;
};

export type IndustryEventStatus = "draft" | "published" | "cancelled" | (string & {});

export type IndustryEventSummary = {
  id: string;
  title: string;
  summary: string;
  description?: string;
  mode: IndustryEventMode;
  status: IndustryEventStatus;
  startAt?: string | null;
  endAt?: string | null;
  timezone?: string | null;
  location?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  remoteUrl?: string | null;
  registrationUrl?: string | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
  featured: boolean;
  tags?: string[];
  verifiedAt?: string | null;
  freshnessState?: string | null;
  needsReview?: boolean;
  reviewByAt?: string | null;
  freshnessCheckedAt?: string | null;
  retiredAt?: string | null;
  retiredReason?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type IndustryEventDetail = IndustryEventSummary;

export type EventDetail = {
  id: string;
  title: string;
  summary: string;
  description: string;
  startAt?: string | null;
  endAt?: string | null;
  timezone?: string | null;
  location?: string | null;
  priceCents: number;
  currency: string;
  includesFiring: boolean;
  firingDetails?: string | null;
  policyCopy?: string | null;
  addOns?: EventAddOn[];
  capacity: number;
  waitlistEnabled: boolean;
  offerClaimWindowHours?: number | null;
  cancelCutoffHours?: number | null;
  status: EventStatus;
};

export type EventSignupSummary = {
  id: string;
  status: EventSignupStatus;
  paymentStatus?: EventPaymentStatus | null;
};

export type EventSignupRosterEntry = {
  id: string;
  uid?: string | null;
  displayName?: string | null;
  email?: string | null;
  status: EventSignupStatus;
  paymentStatus?: EventPaymentStatus | null;
  createdAt?: string | null;
  offerExpiresAt?: string | null;
  checkedInAt?: string | null;
  checkInMethod?: string | null;
};

export type ListEventsResponse = PortalApiOkEnvelope & {
  events: EventSummary[];
};

export type ListIndustryEventsResponse = PortalApiOkEnvelope & {
  events: IndustryEventSummary[];
};

export type ListEventSignupsResponse = PortalApiOkEnvelope & {
  signups: EventSignupRosterEntry[];
};

export type GetEventResponse = PortalApiOkEnvelope & {
  event: EventDetail;
  signup?: EventSignupSummary | null;
};

export type GetIndustryEventResponse = PortalApiOkEnvelope & {
  event: IndustryEventDetail;
};

export type UpsertIndustryEventResponse = PortalApiOkEnvelope & {
  eventId: string;
  created: boolean;
  event: IndustryEventDetail;
};

export type RunIndustryEventsFreshnessNowResponse = PortalApiOkEnvelope & {
  result: {
    dryRun: boolean;
    source: "manual" | "scheduled";
    scanned: number;
    updated: number;
    retired: number;
    staleReview: number;
    fresh: number;
    nonPublished: number;
  };
};

export type CreateEventResponse = PortalApiOkEnvelope & {
  eventId: string;
};

export type PublishEventResponse = PortalApiOkEnvelope & {
  status: string;
};

export type SignupForEventResponse = PortalApiOkEnvelope & {
  signupId: string;
  status: string;
};

export type CancelEventSignupResponse = PortalApiOkEnvelope & {
  status: string;
};

export type ClaimEventOfferResponse = PortalApiOkEnvelope & {
  status: string;
};

export type CheckInEventResponse = PortalApiOkEnvelope & {
  status: string;
  paymentStatus?: string;
};

export type CreateEventCheckoutSessionResponse = PortalApiOkEnvelope & {
  checkoutUrl?: string | null;
};

export type ImportLibraryIsbnsResponse = PortalApiOkEnvelope & {
  requested: number;
  created: number;
  updated: number;
  errors?: Array<{ isbn: string; message: string }>;
};

export type LibraryItemsListResponse = PortalApiOkEnvelope & {
  items?: LibraryItemContract[];
  page?: number;
  pageSize?: number;
  total?: number;
  sort?: LibraryItemsSort | string | null;
  data?: {
    items?: LibraryItemContract[];
    page?: number;
    pageSize?: number;
    total?: number;
    sort?: LibraryItemsSort | string | null;
  };
};

export type LibraryItemsGetResponse = PortalApiOkEnvelope & {
  item?: LibraryItemContract | null;
  data?: {
    item?: LibraryItemContract | null;
  };
};

export type LibraryDiscoveryGetResponse = PortalApiOkEnvelope & {
  limit?: number;
  staffPicks?: LibraryItemContract[];
  mostBorrowed?: LibraryItemContract[];
  recentlyAdded?: LibraryItemContract[];
  recentlyReviewed?: LibraryItemContract[];
  data?: {
    limit?: number;
    staffPicks?: LibraryItemContract[];
    mostBorrowed?: LibraryItemContract[];
    recentlyAdded?: LibraryItemContract[];
    recentlyReviewed?: LibraryItemContract[];
  };
};

export type LibraryExternalLookupResponse = PortalApiOkEnvelope & {
  q?: string | null;
  limit?: number;
  items?: LibraryExternalLookupResult[];
  cacheHit?: boolean;
  degraded?: boolean;
  policyLimited?: boolean;
  providers?: LibraryExternalLookupSource[];
  data?: {
    q?: string | null;
    limit?: number;
    items?: LibraryExternalLookupResult[];
    cacheHit?: boolean;
    degraded?: boolean;
    policyLimited?: boolean;
    providers?: LibraryExternalLookupSource[];
  };
};

export type LibraryExternalLookupProviderConfigResponse = PortalApiOkEnvelope & {
  data?: {
    openlibraryEnabled?: boolean;
    googlebooksEnabled?: boolean;
    disabledProviders?: string[];
    note?: string | null;
    updatedAtMs?: number;
    updatedByUid?: string | null;
  };
};

export type LibraryRolloutConfigResponse = PortalApiOkEnvelope & {
  data?: {
    phase?: LibraryRolloutPhase | null;
    memberWritesEnabled?: boolean;
    note?: string | null;
    updatedAtMs?: number;
    updatedByUid?: string | null;
  };
};

export type LibraryRecommendationsListResponse = PortalApiOkEnvelope & {
  data?: {
    recommendations?: LibraryRecommendationContract[];
    itemId?: string | null;
    status?: string | null;
    sort?: string | null;
    limit?: number;
  };
};

export type LibraryRecommendationsCreateResponse = PortalApiOkEnvelope & {
  data?: {
    recommendation?: LibraryRecommendationContract | null;
  };
};

export type LibraryRecommendationsFeedbackSubmitResponse = PortalApiOkEnvelope & {
  data?: {
    feedback?: {
      id?: string;
      recommendationId?: string | null;
      helpful?: boolean;
      comment?: string | null;
      moderationStatus?: string | null;
      reviewerUid?: string | null;
      createdAt?: unknown;
      updatedAt?: unknown;
    } | null;
    recommendation?: {
      id?: string;
      helpfulCount?: number | null;
      feedbackCount?: number | null;
    } | null;
  };
};

export type LibraryTagSubmissionCreateResponse = PortalApiOkEnvelope & {
  data?: {
    submission?: {
      id?: string;
      itemId?: string;
      tag?: string;
      normalizedTag?: string;
      status?: string;
    } | null;
  };
};

export type LibraryTagSubmissionApproveResponse = PortalApiOkEnvelope & {
  data?: {
    submission?: {
      id?: string;
      itemId?: string;
      status?: string;
      canonicalTagId?: string;
      canonicalTag?: string;
    } | null;
    tag?: {
      id?: string;
      name?: string;
      normalizedTag?: string;
    } | null;
  };
};

export type LibraryTagMergeResponse = PortalApiOkEnvelope & {
  data?: {
    sourceTagId?: string;
    targetTagId?: string;
    migratedItemTags?: number;
    retargetedSubmissions?: number;
  };
};

export type LibraryLoanMarkLostResponse = PortalApiOkEnvelope & {
  data?: {
    loan?: {
      id?: string;
      status?: string;
      idempotentReplay?: boolean;
      replacementValueCents?: number;
    } | null;
    item?: {
      itemId?: string;
      status?: string;
    } | null;
  };
};

export type LibraryLoanAssessReplacementFeeResponse = PortalApiOkEnvelope & {
  data?: {
    fee?: {
      id?: string;
      loanId?: string;
      itemId?: string;
      amountCents?: number;
      status?: string;
      idempotentReplay?: boolean;
    } | null;
  };
};

export type LibraryItemOverrideStatusResponse = PortalApiOkEnvelope & {
  data?: {
    item?: {
      id?: string;
      status?: string;
      availableCopies?: number;
    } | null;
  };
};

export type RegisterDeviceTokenResponse = PortalApiOkEnvelope & {
  uid: string;
  tokenHash: string;
};

export type UnregisterDeviceTokenResponse = PortalApiOkEnvelope & {
  uid: string;
  tokenHash: string;
};

export type RunNotificationFailureDrillResponse = PortalApiOkEnvelope & {
  jobId: string;
  uid: string;
  mode: "auth" | "provider_4xx" | "provider_5xx" | "network" | "success";
};

export type RunNotificationMetricsAggregationNowResponse = PortalApiOkEnvelope & {
  windowHours: number;
  totalAttempts: number;
  statusCounts: Record<string, number>;
  reasonCounts: Record<string, number>;
  providerCounts: Record<string, number>;
};

export type MaterialOrderItemSummary = {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  currency: string;
};

export type MaterialOrderSummary = {
  id: string;
  status: string;
  totalCents: number;
  currency: string;
  pickupNotes?: string | null;
  checkoutUrl?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  items: MaterialOrderItemSummary[];
};

export type BillingReceipt = {
  id: string;
  type: "event" | "materials";
  sourceId?: string | null;
  title: string;
  amountCents: number;
  currency: string;
  paidAt?: string | null;
  createdAt?: string | null;
  metadata?: Record<string, unknown>;
};

export type BillingSummaryTotals = {
  unpaidCheckInsCount: number;
  unpaidCheckInsAmountCents: number;
  materialsPendingCount: number;
  materialsPendingAmountCents: number;
  receiptsCount: number;
  receiptsAmountCents: number;
};

export type BillingSummaryResponse = PortalApiOkEnvelope & {
  unpaidCheckIns: EventSignupRosterEntry[];
  materialsOrders: MaterialOrderSummary[];
  receipts: BillingReceipt[];
  summary: BillingSummaryTotals;
};

/**
 * Utility: best-effort extraction of "the batch id created/returned" from create/continue responses
 * (helps keep UI + iOS logic consistent).
 */
export function getResultBatchId(
  resp: CreateBatchResponse | ContinueJourneyResponse | unknown
): string | undefined {
  if (!resp || typeof resp !== "object") return undefined;
  const o = resp as { newBatchId?: unknown; batchId?: unknown; existingBatchId?: unknown };
  if (typeof o.newBatchId === "string") return o.newBatchId;
  if (typeof o.batchId === "string") return o.batchId;
  if (typeof o.existingBatchId === "string") return o.existingBatchId;
  return undefined;
}

/* =========================
   Meta / troubleshooting (shape-only)
   ========================= */

export type PortalApiMeta = {
  atIso: string;
  requestId: string;
  fn: PortalFnName;
  url: string;

  payload: unknown;

  curlExample?: string;

  status?: number;
  ok?: boolean;
  responseSnippet?: string;

  response?: unknown;

  // Optional error info when ok === false
  error?: string;
  message?: string;
  code?: PortalApiErrorCode;
};

/* =========================
   Timeline events (shared)
   ========================= */

export const TIMELINE_EVENT_TYPES = [
  "CREATE_BATCH",
  "SUBMIT_DRAFT",
  "SHELVED",
  "KILN_LOAD",
  "KILN_UNLOAD",
  "ASSIGNED_FIRING",
  "READY_FOR_PICKUP",
  "PICKED_UP_AND_CLOSE",
  "CONTINUE_JOURNEY",
] as const;

export type TimelineEventType = (typeof TIMELINE_EVENT_TYPES)[number];

export const TIMELINE_EVENT_LABELS: Record<TimelineEventType, string> = {
  CREATE_BATCH: "Batch created",
  SUBMIT_DRAFT: "Draft submitted",
  SHELVED: "Shelved",
  KILN_LOAD: "Loaded into kiln",
  KILN_UNLOAD: "Unloaded from kiln",
  ASSIGNED_FIRING: "Firing assigned",
  READY_FOR_PICKUP: "Ready for pickup",
  PICKED_UP_AND_CLOSE: "Picked up & closed",
  CONTINUE_JOURNEY: "Journey continued",
};

const LEGACY_TIMELINE_EVENT_ALIASES: Record<string, TimelineEventType> = {
  BATCH_CREATED: "CREATE_BATCH",
  SUBMITTED: "SUBMIT_DRAFT",
  PICKED_UP_AND_CLOSED: "PICKED_UP_AND_CLOSE",
};

export function isTimelineEventType(v: unknown): v is TimelineEventType {
  return (
    typeof v === "string" &&
    (TIMELINE_EVENT_TYPES as readonly string[]).includes(v)
  );
}

export function normalizeTimelineEventType(
  v: unknown
): TimelineEventType | undefined {
  if (isTimelineEventType(v)) return v;
  if (typeof v === "string" && v in LEGACY_TIMELINE_EVENT_ALIASES) {
    return LEGACY_TIMELINE_EVENT_ALIASES[v];
  }
  return undefined;
}
