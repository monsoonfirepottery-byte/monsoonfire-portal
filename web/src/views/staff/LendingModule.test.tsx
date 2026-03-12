/** @vitest-environment jsdom */

import type { ComponentProps, Dispatch, SetStateAction } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import LendingModule from "./LendingModule";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makeSetter<T>() {
  return vi.fn() as unknown as Dispatch<SetStateAction<T>>;
}

function buildProps(
  overrides: Partial<ComponentProps<typeof LendingModule>> = {}
): ComponentProps<typeof LendingModule> {
  const emptyAdminDraft = {
    title: "",
    subtitle: "",
    authorsCsv: "",
    summary: "",
    description: "",
    publisher: "",
    publishedDate: "",
    isbn: "",
    mediaType: "book",
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
  };

  return {
    run: vi.fn(async (_key: string, fn: () => Promise<void>) => {
      await fn();
    }),
    busy: "",
    hasFunctionsAuthMismatch: false,
    fBaseUrl: "http://127.0.0.1:5001",
    copy: vi.fn(async () => {}),
    safeJsonStringify: JSON.stringify,
    libraryPhaseMetricsWindowMinutes: 60,
    loadLending: vi.fn(async () => {}),
    openLendingIntake: vi.fn(),
    externalLookupPolicyOpenLibraryEnabled: true,
    setExternalLookupPolicyOpenLibraryEnabled: makeSetter<boolean>(),
    externalLookupPolicyGoogleBooksEnabled: true,
    setExternalLookupPolicyGoogleBooksEnabled: makeSetter<boolean>(),
    externalLookupPolicyCoverReviewGuardrailEnabled: true,
    setExternalLookupPolicyCoverReviewGuardrailEnabled: makeSetter<boolean>(),
    externalLookupPolicyBusy: false,
    externalLookupPolicyNote: "",
    setExternalLookupPolicyNote: makeSetter<string>(),
    externalLookupPolicyStatus: "",
    externalLookupPolicyUpdatedAtMs: 0,
    externalLookupPolicyUpdatedByUid: "",
    lendingAdminItemBusy: false,
    externalLookupProbeQuery: "",
    setExternalLookupProbeQuery: makeSetter<string>(),
    externalLookupProbeBusy: false,
    externalLookupProbeStatus: "",
    externalLookupProbeProviders: [],
    runExternalLookupProviderProbe: vi.fn(async () => {}),
    saveExternalLookupProviderPolicy: vi.fn(async () => {}),
    libraryRolloutPhase: "phase_3_admin_full",
    setLibraryRolloutPhase: makeSetter<"phase_1_read_only" | "phase_2_member_writes" | "phase_3_admin_full">(),
    libraryRolloutMemberWritesEnabled: true,
    libraryRolloutPhaseBusy: false,
    libraryRolloutNote: "",
    setLibraryRolloutNote: makeSetter<string>(),
    saveLibraryRolloutPhasePolicy: vi.fn(async () => {}),
    libraryRolloutPhaseStatus: "",
    libraryRolloutUpdatedAtMs: 0,
    libraryRolloutUpdatedByUid: "",
    refreshLibraryPhaseMetricsSnapshot: vi.fn(),
    libraryPhaseMetricsArtifact: null,
    libraryPhaseMetricsStatus: "",
    libraryPhaseMetricsSnapshot: null,
    lendingAdminItemSearch: "",
    setLendingAdminItemSearch: makeSetter<string>(),
    filteredLendingAdminItems: [],
    selectedAdminItemId: "",
    handleStartLendingAdminItemCreate: vi.fn(),
    handleSelectLendingAdminItem: vi.fn(),
    selectedAdminItem: null,
    lendingAdminItemDeleteConfirmInput: "",
    setLendingAdminItemDeleteConfirmInput: makeSetter<string>(),
    lendingAdminDeleteConfirmationPhrase: "DELETE",
    setLendingAdminItemDraft: makeSetter<typeof emptyAdminDraft>(),
    lendingAdminItemDraft: emptyAdminDraft,
    handleLendingAdminResolveIsbn: vi.fn(async () => {}),
    lendingAdminIsbnResolveBusy: false,
    lendingAdminIsbnResolveStatus: "",
    lendingAdminItemError: "",
    lendingAdminItemStatus: "",
    handleLendingAdminSave: vi.fn(async () => true),
    handleLendingAdminDelete: vi.fn(async () => {}),
    libraryAdminItems: [],
    libraryRequests: [],
    libraryLoans: [],
    requestsLoadError: "",
    loansLoadError: "",
    recommendationsLoadError: "",
    tagSubmissionsLoadError: "",
    coverReviewsLoadError: "",
    lendingTriage: {
      requestView: [],
      loanView: [],
      openRequests: [],
      activeLoans: [],
      overdueLoans: [],
      returnedLoans: [],
    },
    recommendationModerationKpis: {
      total: 0,
      pendingReview: 0,
      approved: 0,
      hidden: 0,
    },
    tagModerationKpis: {
      total: 0,
      pending: 0,
    },
    lendingSearch: "",
    setLendingSearch: makeSetter<string>(),
    lendingStatusFilter: "all",
    setLendingStatusFilter: makeSetter<string>(),
    lendingStatusOptions: ["all"],
    lendingFocusFilter: "all",
    setLendingFocusFilter: makeSetter<"all" | "requests" | "active" | "overdue" | "returned">(),
    lendingRecommendationFilter: "all",
    setLendingRecommendationFilter: makeSetter<string>(),
    lendingRecommendationStatusOptions: ["all"],
    selectedRequestId: "",
    setSelectedRequestId: makeSetter<string>(),
    selectedLoanId: "",
    setSelectedLoanId: makeSetter<string>(),
    overdueLoanIdsById: {},
    selectedRequest: null,
    selectedLoan: null,
    filteredRecommendations: [],
    recommendationModerationBusyById: {},
    recommendationModerationStatus: "",
    handleRecommendationModeration: vi.fn(async () => {}),
    filteredTagSubmissions: [],
    tagSubmissionApprovalDraftById: {},
    setTagSubmissionApprovalDraftById: makeSetter<Record<string, string>>(),
    tagModerationBusyById: {},
    tagModerationStatus: "",
    handleTagSubmissionApprove: vi.fn(async () => {}),
    tagMergeSourceId: "",
    setTagMergeSourceId: makeSetter<string>(),
    tagMergeTargetId: "",
    setTagMergeTargetId: makeSetter<string>(),
    tagMergeNote: "",
    setTagMergeNote: makeSetter<string>(),
    tagMergeBusy: false,
    handleTagMerge: vi.fn(async () => {}),
    coverReviewStatus: "",
    coverReviewReconcileBusy: false,
    coverReviewBusyById: {},
    coverReviewDraftById: {},
    setCoverReviewDraftById: makeSetter<Record<string, string>>(),
    coverReviewErrorById: {},
    setCoverReviewErrorById: makeSetter<Record<string, string>>(),
    libraryCoverReviews: [],
    libraryMetadataGaps: [],
    metadataEnrichmentSummary: {
      pendingCount: 0,
      thinBacklogCount: 0,
      lastRunAtMs: 0,
      lastRunStatus: "",
      lastRunSource: "",
      lastRunQueued: 0,
      lastRunAttempted: 0,
      lastRunEnriched: 0,
      lastRunSkipped: 0,
      lastRunErrors: 0,
      lastRunStillPending: 0,
    },
    metadataEnrichmentBusy: false,
    metadataEnrichmentStatus: "",
    handleMetadataEnrichmentRun: vi.fn(async () => {}),
    handleCoverReviewReconcile: vi.fn(async () => {}),
    handleCoverReviewResolve: vi.fn(async () => {}),
    loanRecoveryBusy: false,
    loanRecoveryStatus: "",
    loanReplacementFeeAmountInput: "",
    setLoanReplacementFeeAmountInput: makeSetter<string>(),
    loanOverrideStatusDraft: "available",
    setLoanOverrideStatusDraft: makeSetter<"available" | "checked_out" | "overdue" | "lost" | "unavailable" | "archived">(),
    loanOverrideNoteDraft: "",
    setLoanOverrideNoteDraft: makeSetter<string>(),
    handleLoanMarkLost: vi.fn(async () => {}),
    handleLoanAssessReplacementFee: vi.fn(async () => {}),
    handleLoanItemStatusOverride: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("LendingModule", () => {
  it("shows an intake CTA and removes embedded scan/import controls", () => {
    const openLendingIntake = vi.fn();
    render(<LendingModule {...buildProps({ openLendingIntake })} />);

    expect(screen.getByTestId("lending-tools-page")).toBeTruthy();
    expect(screen.getByRole("button", { name: /open lending intake/i })).toBeTruthy();
    expect(screen.queryByTestId("lending-scan-input")).toBeNull();
    expect(screen.queryByText("Quick scan")).toBeNull();
    expect(screen.queryByText("ISBN bulk import")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /open lending intake/i }));
    expect(openLendingIntake).toHaveBeenCalledTimes(1);
  });

  it("opens catalog admin when the page is entered from intake cleanup", async () => {
    const selectedAdminItem = {
      id: "isbn-9780596007126",
      title: "ISBN 9780596007126",
      authorLine: "",
      isbn: "9780596007126",
      isbn10: "",
      isbn13: "9780596007126",
      mediaType: "book",
      status: "available",
      source: "manual",
      totalCopies: 1,
      availableCopies: 1,
      updatedAtMs: Date.now(),
      rawDoc: {},
    };

    render(
      <LendingModule
        {...buildProps({
          selectedAdminItemId: selectedAdminItem.id,
          selectedAdminItem,
          filteredLendingAdminItems: [selectedAdminItem],
          libraryAdminItems: [selectedAdminItem],
        })}
      />
    );

    const catalogAdmin = screen
      .getByText("Catalog admin (create/edit/delete + ISBN resolve)")
      .closest("details");

    await waitFor(() => {
      expect(catalogAdmin?.hasAttribute("open")).toBe(true);
    });
    expect(screen.getByText("Editing ISBN 9780596007126")).toBeTruthy();
    expect(screen.getByTestId("lending-catalog-editor")).toBeTruthy();
  });

  it("keeps lending load failures local to each section", () => {
    render(
      <LendingModule
        {...buildProps({
          requestsLoadError: "Requests failed to load.",
          loansLoadError: "Loans failed to load.",
          recommendationsLoadError: "Recommendations failed to load.",
          tagSubmissionsLoadError: "Tag submissions failed to load.",
          coverReviewsLoadError: "Cover review failed to load.",
        })}
      />
    );

    expect(screen.getByText("Requests failed to load.")).toBeTruthy();
    expect(screen.getByText("Loans failed to load.")).toBeTruthy();
    expect(screen.getByText("Recommendations failed to load.")).toBeTruthy();
    expect(screen.getByText("Tag submissions failed to load.")).toBeTruthy();
    expect(screen.getByText("Cover review failed to load.")).toBeTruthy();
  });

  it("supports cover-review reconciliation and triage filters", () => {
    const handleCoverReviewReconcile = vi.fn(async () => {});
    render(
      <LendingModule
        {...buildProps({
          handleCoverReviewReconcile,
          libraryCoverReviews: [
            {
              id: "item-manual",
              title: "Manual Review Title",
              isbn: "9780596007126",
              source: "openlibrary",
              mediaType: "book",
              coverUrl: "https://covers.openlibrary.org/b/id/12345-M.jpg",
              coverProvider: "openlibrary",
              coverQualityStatus: "needs_review",
              coverQualityReason: "low_confidence_cover_url",
              coverIssueKind: "low_confidence",
              updatedAtMs: Date.now(),
              rawDoc: {},
            },
            {
              id: "item-missing",
              title: "Missing Cover Title",
              isbn: "",
              source: "manual",
              mediaType: "book",
              coverUrl: null,
              coverProvider: "unknown",
              coverQualityStatus: "missing",
              coverQualityReason: "missing_cover",
              coverIssueKind: "missing",
              updatedAtMs: Date.now(),
              rawDoc: {},
            },
          ],
        })}
      />
    );

    expect(screen.getByRole("button", { name: /reconcile imported covers/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /reconcile imported covers/i }));
    expect(handleCoverReviewReconcile).toHaveBeenCalledTimes(1);

    expect(screen.getByText("Missing 1 | Invalid 0 | Low confidence 1 | Untrusted 0 | Non-book mismatch 0 | Manual review 0")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /missing cover \(1\)/i }));
    expect(screen.getByText("Missing Cover Title")).toBeTruthy();
    expect(screen.queryByText("Manual Review Title")).toBeNull();
  });

  it("shows metadata enrichment controls and summary", () => {
    const handleMetadataEnrichmentRun = vi.fn(async () => {});
    render(
      <LendingModule
        {...buildProps({
          handleMetadataEnrichmentRun,
          metadataEnrichmentSummary: {
            pendingCount: 6,
            thinBacklogCount: 14,
            lastRunAtMs: 1_730_000_000_000,
            lastRunStatus: "success",
            lastRunSource: "manual",
            lastRunQueued: 12,
            lastRunAttempted: 12,
            lastRunEnriched: 8,
            lastRunSkipped: 4,
            lastRunErrors: 0,
            lastRunStillPending: 2,
          },
        })}
      />
    );

    expect(screen.getByText("Metadata enrichment")).toBeTruthy();
    expect(screen.getByText(/Pending 6 \| Thin backlog 14/i)).toBeTruthy();
    expect(screen.getByText(/Last run queued 12 \| attempted 12 \| enriched 8 \| skipped 4 \| errors 0 \| still pending 2/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /enrich recent imports/i }));
    expect(handleMetadataEnrichmentRun).toHaveBeenCalledWith("recent_imports");

    fireEvent.click(screen.getByRole("button", { name: /backfill thin records/i }));
    expect(handleMetadataEnrichmentRun).toHaveBeenCalledWith("thin_backfill");
  });
});
