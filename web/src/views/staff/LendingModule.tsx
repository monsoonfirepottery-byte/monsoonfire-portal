import type { Dispatch, SetStateAction } from "react";
import type { LibraryRolloutPhase } from "../../api/portalContracts";

type RunAction = (key: string, fn: () => Promise<void>) => Promise<void>;

type LendingRequestRecord = {
  id: string;
  title: string;
  status: string;
  requesterUid: string;
  requesterName: string;
  requesterEmail: string;
  createdAtMs: number;
  rawDoc: Record<string, unknown>;
};

type LendingLoanRecord = {
  id: string;
  title: string;
  status: string;
  borrowerUid: string;
  borrowerName: string;
  borrowerEmail: string;
  createdAtMs: number;
  dueAtMs: number;
  returnedAtMs: number;
  rawDoc: Record<string, unknown>;
};

type LendingAdminItemRecord = {
  id: string;
  title: string;
  authorLine: string;
  isbn: string;
  isbn10: string;
  isbn13: string;
  status: string;
  source: string;
  totalCopies: number;
  availableCopies: number;
  updatedAtMs: number;
  rawDoc: Record<string, unknown>;
};

type LendingAdminItemDraft = {
  title: string;
  subtitle: string;
  authorsCsv: string;
  description: string;
  publisher: string;
  publishedDate: string;
  isbn: string;
  mediaType: string;
  format: string;
  coverUrl: string;
  totalCopies: string;
  availableCopies: string;
  status: string;
  source: string;
  subjectsCsv: string;
  techniquesCsv: string;
};

type LendingRecommendationRecord = {
  id: string;
  title: string;
  author: string;
  isbn: string;
  moderationStatus: string;
  recommenderUid: string;
  recommenderName: string;
  rationale: string;
  createdAtMs: number;
  updatedAtMs: number;
  rawDoc: Record<string, unknown>;
};

type LendingTagSubmissionRecord = {
  id: string;
  itemId: string;
  itemTitle: string;
  tag: string;
  normalizedTag: string;
  status: string;
  submittedByUid: string;
  submittedByName: string;
  createdAtMs: number;
  updatedAtMs: number;
  rawDoc: Record<string, unknown>;
};

type LendingCoverReviewRecord = {
  id: string;
  title: string;
  coverUrl: string | null;
  coverQualityStatus: string;
  coverQualityReason: string | null;
  updatedAtMs: number;
  rawDoc: Record<string, unknown>;
};

type LendingLibraryPhaseRouteMetrics = {
  route: string;
  requestCount: number;
  errorCount: number;
  conflictCount: number;
  routeErrorCount: number;
  p95LatencyMs: number | null;
  p50LatencyMs: number | null;
};

type LendingLibraryPhaseMetricsSnapshot = {
  generatedAtIso: string;
  requestCount: number;
  errorCount: number;
  conflictCount: number;
  routeErrorCount: number;
  errorRate: number;
  conflictRate: number;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  maxLatencyMs: number | null;
  endpoints: LendingLibraryPhaseRouteMetrics[];
};

type LendingLibraryPhaseMetricsArtifact = {
  rolloutPhase: LibraryRolloutPhase;
  rolloutLabel: string;
  memberWritesEnabled: boolean;
  generatedAtIso: string;
  windowMinutes: number;
  summary: {
    requestCount: number;
    errorCount: number;
    conflictCount: number;
    routeErrorCount: number;
    errorRate: number;
    conflictRate: number;
    p50LatencyMs: number | null;
    p95LatencyMs: number | null;
    maxLatencyMs: number | null;
  };
  endpoints: LendingLibraryPhaseRouteMetrics[];
};

type LendingTriage = {
  requestView: LendingRequestRecord[];
  loanView: LendingLoanRecord[];
  openRequests: LendingRequestRecord[];
  activeLoans: LendingLoanRecord[];
  overdueLoans: LendingLoanRecord[];
  returnedLoans: LendingLoanRecord[];
};

type RecommendationModerationKpis = {
  total: number;
  pendingReview: number;
  approved: number;
  hidden: number;
};

type TagModerationKpis = {
  total: number;
  pending: number;
};

type ExternalLookupProbeProvider = {
  provider: string;
  ok: boolean;
  itemCount: number;
  cached: boolean;
  disabled: boolean;
};

type Props = {
  run: RunAction;
  busy: string;
  hasFunctionsAuthMismatch: boolean;
  fBaseUrl: string;
  copy: (next: string) => Promise<void>;
  safeJsonStringify: (value: unknown) => string;
  libraryPhaseMetricsWindowMinutes: number;
  loadLending: () => Promise<void>;

  isbnInput: string;
  setIsbnInput: Dispatch<SetStateAction<string>>;
  isbnImportBusy: boolean;
  isbnImportStatus: string;
  isbnImportError: string;
  handleLendingIsbnFile: (file: File | null) => void;
  handleLendingIsbnImport: () => Promise<void>;

  isbnScanInput: string;
  setIsbnScanInput: Dispatch<SetStateAction<string>>;
  isbnScanBusy: boolean;
  isbnScanStatus: string;
  handleLendingIsbnScanSubmit: () => Promise<void>;

  externalLookupPolicyOpenLibraryEnabled: boolean;
  setExternalLookupPolicyOpenLibraryEnabled: Dispatch<SetStateAction<boolean>>;
  externalLookupPolicyGoogleBooksEnabled: boolean;
  setExternalLookupPolicyGoogleBooksEnabled: Dispatch<SetStateAction<boolean>>;
  externalLookupPolicyCoverReviewGuardrailEnabled: boolean;
  setExternalLookupPolicyCoverReviewGuardrailEnabled: Dispatch<SetStateAction<boolean>>;
  externalLookupPolicyBusy: boolean;
  externalLookupPolicyNote: string;
  setExternalLookupPolicyNote: Dispatch<SetStateAction<string>>;
  externalLookupPolicyStatus: string;
  externalLookupPolicyUpdatedAtMs: number;
  externalLookupPolicyUpdatedByUid: string;
  lendingAdminItemBusy: boolean;
  externalLookupProbeBusy: boolean;
  externalLookupProbeStatus: string;
  externalLookupProbeProviders: ExternalLookupProbeProvider[];
  runExternalLookupProviderProbe: () => Promise<void>;
  saveExternalLookupProviderPolicy: () => Promise<void>;

  libraryRolloutPhase: LibraryRolloutPhase;
  setLibraryRolloutPhase: Dispatch<SetStateAction<LibraryRolloutPhase>>;
  libraryRolloutMemberWritesEnabled: boolean;
  libraryRolloutPhaseBusy: boolean;
  libraryRolloutNote: string;
  setLibraryRolloutNote: Dispatch<SetStateAction<string>>;
  saveLibraryRolloutPhasePolicy: () => Promise<void>;
  libraryRolloutPhaseStatus: string;
  libraryRolloutUpdatedAtMs: number;
  libraryRolloutUpdatedByUid: string;
  refreshLibraryPhaseMetricsSnapshot: () => Promise<void> | void;
  libraryPhaseMetricsArtifact: LendingLibraryPhaseMetricsArtifact | null;
  libraryPhaseMetricsStatus: string;
  libraryPhaseMetricsSnapshot: LendingLibraryPhaseMetricsSnapshot | null;

  lendingAdminItemSearch: string;
  setLendingAdminItemSearch: Dispatch<SetStateAction<string>>;
  externalLookupProbeQuery: string;
  setExternalLookupProbeQuery: Dispatch<SetStateAction<string>>;
  filteredLendingAdminItems: LendingAdminItemRecord[];
  selectedAdminItemId: string;
  handleStartLendingAdminItemCreate: () => void;
  handleSelectLendingAdminItem: (item: LendingAdminItemRecord) => void;
  selectedAdminItem: LendingAdminItemRecord | null;
  lendingAdminItemDeleteConfirmInput: string;
  setLendingAdminItemDeleteConfirmInput: Dispatch<SetStateAction<string>>;
  lendingAdminDeleteConfirmationPhrase: string;
  setLendingAdminItemDraft: Dispatch<SetStateAction<LendingAdminItemDraft>>;
  lendingAdminItemDraft: LendingAdminItemDraft;
  handleLendingAdminResolveIsbn: () => Promise<void>;
  lendingAdminIsbnResolveBusy: boolean;
  lendingAdminIsbnResolveStatus: string;
  lendingAdminItemError: string;
  lendingAdminItemStatus: string;
  lendingAdminIsbnResolveNote: string;
  handleLendingAdminSave: () => Promise<void>;
  handleLendingAdminDelete: () => Promise<void>;

  libraryAdminItems: LendingAdminItemRecord[];
  libraryRequests: LendingRequestRecord[];
  libraryLoans: LendingLoanRecord[];

  lendingTriage: LendingTriage;
  recommendationModerationKpis: RecommendationModerationKpis;
  tagModerationKpis: TagModerationKpis;

  lendingSearch: string;
  setLendingSearch: Dispatch<SetStateAction<string>>;
  lendingStatusFilter: string;
  setLendingStatusFilter: Dispatch<SetStateAction<string>>;
  lendingStatusOptions: string[];
  lendingFocusFilter: "all" | "requests" | "active" | "overdue" | "returned";
  setLendingFocusFilter: Dispatch<SetStateAction<"all" | "requests" | "active" | "overdue" | "returned">>;
  lendingRecommendationFilter: string;
  setLendingRecommendationFilter: Dispatch<SetStateAction<string>>;
  lendingRecommendationStatusOptions: string[];

  selectedRequestId: string;
  setSelectedRequestId: Dispatch<SetStateAction<string>>;
  selectedLoanId: string;
  setSelectedLoanId: Dispatch<SetStateAction<string>>;
  overdueLoanIdsById: Record<string, true>;
  selectedRequest: LendingRequestRecord | null;
  selectedLoan: LendingLoanRecord | null;
  filteredRequests: LendingRequestRecord[];
  filteredLoans: LendingLoanRecord[];
  filteredRecommendations: LendingRecommendationRecord[];
  recommendationModerationBusyById: Record<string, boolean>;
  recommendationModerationStatus: string;
  handleRecommendationModeration: (row: LendingRecommendationRecord, action: "approve" | "hide" | "restore") => Promise<void>;
  filteredTagSubmissions: LendingTagSubmissionRecord[];
  tagSubmissionApprovalDraftById: Record<string, string>;
  setTagSubmissionApprovalDraftById: Dispatch<SetStateAction<Record<string, string>>>;
  tagModerationBusyById: Record<string, boolean>;
  tagModerationStatus: string;
  handleTagSubmissionApprove: (row: LendingTagSubmissionRecord) => Promise<void>;
  tagMergeSourceId: string;
  setTagMergeSourceId: Dispatch<SetStateAction<string>>;
  tagMergeTargetId: string;
  setTagMergeTargetId: Dispatch<SetStateAction<string>>;
  tagMergeNote: string;
  setTagMergeNote: Dispatch<SetStateAction<string>>;
  tagMergeBusy: boolean;
  handleTagMerge: () => Promise<void>;

  coverReviewStatus: string;
  coverReviewBusyById: Record<string, boolean>;
  coverReviewDraftById: Record<string, string>;
  setCoverReviewDraftById: Dispatch<SetStateAction<Record<string, string>>>;
  coverReviewErrorById: Record<string, string>;
  setCoverReviewErrorById: Dispatch<SetStateAction<Record<string, string>>>;
  libraryCoverReviews: LendingCoverReviewRecord[];
  handleCoverReviewResolve: (
    row: LendingCoverReviewRecord,
    mode: "approve_existing" | "set_replacement"
  ) => Promise<void>;

  loanRecoveryBusy: boolean;
  loanRecoveryStatus: string;
  loanReplacementFeeAmountInput: string;
  setLoanReplacementFeeAmountInput: Dispatch<SetStateAction<string>>;
  loanOverrideStatusDraft: "available" | "checked_out" | "overdue" | "lost" | "unavailable" | "archived";
  setLoanOverrideStatusDraft: Dispatch<SetStateAction<"available" | "checked_out" | "overdue" | "lost" | "unavailable" | "archived">>;
  loanOverrideNoteDraft: string;
  setLoanOverrideNoteDraft: Dispatch<SetStateAction<string>>;
  handleLoanMarkLost: (loan: LendingLoanRecord) => Promise<void>;
  handleLoanAssessReplacementFee: (loan: LendingLoanRecord) => Promise<void>;
  handleLoanItemStatusOverride: (loan: LendingLoanRecord) => Promise<void>;
};

function when(ms: number): string {
  if (!ms) return "-";
  return new Date(ms).toLocaleString();
}

function formatLatencyMs(ms: number | null): string {
  if (ms === null) return "-";
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function normalizeLibraryRolloutPhase(
  value: unknown,
  fallback: LibraryRolloutPhase = "phase_3_admin_full"
): LibraryRolloutPhase {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "phase_1_read_only" || normalized === "1" || normalized === "phase1") {
      return "phase_1_read_only";
    }
    if (normalized === "phase_2_member_writes" || normalized === "2" || normalized === "phase2") {
      return "phase_2_member_writes";
    }
    if (normalized === "phase_3_admin_full" || normalized === "3" || normalized === "phase3") {
      return "phase_3_admin_full";
    }
  }
  return fallback;
}

function normalizeLibraryItemOverrideStatus(
  value: string
): "available" | "checked_out" | "overdue" | "lost" | "unavailable" | "archived" {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "available") return "available";
  if (normalized === "checked_out" || normalized === "checkedout") return "checked_out";
  if (normalized === "overdue") return "overdue";
  if (normalized === "lost") return "lost";
  if (normalized === "unavailable") return "unavailable";
  return "archived";
}

function normalizeLibraryTagLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_]+/g, " ")
    .replace(/[^a-z0-9+\-/&.\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function isValidHttpUrl(value: string): boolean {
  if (!value.trim()) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export default function LendingModule({
  run,
  busy,
  hasFunctionsAuthMismatch,
  fBaseUrl,
  copy,
  safeJsonStringify,
  libraryPhaseMetricsWindowMinutes,
  loadLending,
  isbnInput,
  setIsbnInput,
  isbnImportBusy,
  isbnImportStatus,
  isbnImportError,
  handleLendingIsbnFile,
  handleLendingIsbnImport,
  isbnScanInput,
  setIsbnScanInput,
  isbnScanBusy,
  isbnScanStatus,
  handleLendingIsbnScanSubmit,
  externalLookupPolicyOpenLibraryEnabled,
  setExternalLookupPolicyOpenLibraryEnabled,
  externalLookupPolicyGoogleBooksEnabled,
  setExternalLookupPolicyGoogleBooksEnabled,
  externalLookupPolicyCoverReviewGuardrailEnabled,
  setExternalLookupPolicyCoverReviewGuardrailEnabled,
  externalLookupPolicyBusy,
  externalLookupPolicyNote,
  setExternalLookupPolicyNote,
  externalLookupPolicyStatus,
  externalLookupPolicyUpdatedAtMs,
  externalLookupPolicyUpdatedByUid,
  externalLookupProbeQuery,
  setExternalLookupProbeQuery,
  externalLookupProbeBusy,
  externalLookupProbeStatus,
  externalLookupProbeProviders,
  runExternalLookupProviderProbe,
  saveExternalLookupProviderPolicy,
  libraryRolloutPhase,
  setLibraryRolloutPhase,
  libraryRolloutMemberWritesEnabled,
  libraryRolloutPhaseBusy,
  libraryRolloutNote,
  setLibraryRolloutNote,
  saveLibraryRolloutPhasePolicy,
  libraryRolloutPhaseStatus,
  libraryRolloutUpdatedAtMs,
  libraryRolloutUpdatedByUid,
  refreshLibraryPhaseMetricsSnapshot,
  libraryPhaseMetricsArtifact,
  libraryPhaseMetricsStatus,
  libraryPhaseMetricsSnapshot,
  lendingAdminItemSearch,
  setLendingAdminItemSearch,
  lendingAdminItemBusy,
  filteredLendingAdminItems,
  selectedAdminItemId,
  handleStartLendingAdminItemCreate,
  handleSelectLendingAdminItem,
  selectedAdminItem,
  lendingAdminItemDeleteConfirmInput,
  setLendingAdminItemDeleteConfirmInput,
  lendingAdminDeleteConfirmationPhrase,
  setLendingAdminItemDraft,
  lendingAdminItemDraft,
  handleLendingAdminResolveIsbn,
  lendingAdminIsbnResolveBusy,
  lendingAdminIsbnResolveStatus,
  lendingAdminItemError,
  lendingAdminItemStatus,
  handleLendingAdminSave,
  handleLendingAdminDelete,
  libraryAdminItems,
  libraryRequests,
  libraryLoans,
  lendingTriage,
  recommendationModerationKpis,
  tagModerationKpis,
  lendingSearch,
  setLendingSearch,
  lendingStatusFilter,
  setLendingStatusFilter,
  lendingStatusOptions,
  lendingFocusFilter,
  setLendingFocusFilter,
  lendingRecommendationFilter,
  setLendingRecommendationFilter,
  lendingRecommendationStatusOptions,
  selectedRequestId,
  setSelectedRequestId,
  selectedLoanId,
  setSelectedLoanId,
  overdueLoanIdsById,
  selectedRequest,
  selectedLoan,
  filteredRecommendations,
  recommendationModerationBusyById,
  recommendationModerationStatus,
  handleRecommendationModeration,
  filteredTagSubmissions,
  tagSubmissionApprovalDraftById,
  setTagSubmissionApprovalDraftById,
  tagModerationBusyById,
  tagModerationStatus,
  handleTagSubmissionApprove,
  tagMergeSourceId,
  setTagMergeSourceId,
  tagMergeTargetId,
  setTagMergeTargetId,
  tagMergeNote,
  setTagMergeNote,
  tagMergeBusy,
  handleTagMerge,
  coverReviewStatus,
  coverReviewBusyById,
  coverReviewDraftById,
  setCoverReviewDraftById,
  coverReviewErrorById,
  setCoverReviewErrorById,
  libraryCoverReviews,
  handleCoverReviewResolve,
  loanRecoveryBusy,
  loanRecoveryStatus,
  loanReplacementFeeAmountInput,
  setLoanReplacementFeeAmountInput,
  loanOverrideStatusDraft,
  setLoanOverrideStatusDraft,
  loanOverrideNoteDraft,
  setLoanOverrideNoteDraft,
  handleLoanMarkLost,
  handleLoanAssessReplacementFee,
  handleLoanItemStatusOverride,
}: Props) {
  return (
    <section className="card staff-console-card">
      <div className="card-title-row">
        <div className="card-title">Lending</div>
        <button className="btn btn-secondary" disabled={Boolean(busy)} onClick={() => void run("refreshLending", loadLending)}>
          Refresh lending
        </button>
      </div>
      {hasFunctionsAuthMismatch ? (
        <div className="staff-note">
          Local functions detected at <code>{fBaseUrl}</code> while Auth emulator is off. ISBN import, scanner check-in, provider policy/probe controls, and rollout phase controls are paused to prevent false auth failures.
        </div>
      ) : null}
      <div className="staff-module-grid">
        <section className="staff-column">
          <div className="staff-subtitle">ISBN bulk import</div>
          <label className="staff-field">
            Paste ISBNs
            <textarea
              value={isbnInput}
              onChange={(event) => setIsbnInput(event.target.value)}
              placeholder="9780596007126, 9780132350884"
            />
            <span className="helper">Comma or newline separated. ISBN-10 and ISBN-13 are supported.</span>
          </label>
          <label className="staff-field">
            Upload CSV
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                void handleLendingIsbnFile(file);
              }}
            />
          </label>
          {isbnImportError ? <div className="staff-note staff-note-error">{isbnImportError}</div> : null}
          {isbnImportStatus ? <div className="staff-note staff-note-ok">{isbnImportStatus}</div> : null}
          <div className="staff-actions-row">
            <button className="btn btn-primary" disabled={Boolean(busy) || isbnImportBusy || hasFunctionsAuthMismatch} onClick={() => void handleLendingIsbnImport()}>
              {isbnImportBusy ? "Importing..." : "Import ISBNs"}
            </button>
          </div>
        </section>
        <section className="staff-column">
          <div className="staff-subtitle">Scanner check-in</div>
          <label className="staff-field">
            Scan ISBN
            <input
              type="text"
              value={isbnScanInput}
              placeholder="Scan ISBN here"
              onChange={(event) => setIsbnScanInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleLendingIsbnScanSubmit();
                }
              }}
            />
            <span className="helper">Use a Bluetooth scanner then press Enter to submit one item instantly.</span>
          </label>
          {isbnScanStatus ? <div className="staff-note">{isbnScanStatus}</div> : null}
          <div className="staff-actions-row">
            <button className="btn btn-primary" onClick={() => void handleLendingIsbnScanSubmit()} disabled={Boolean(busy) || isbnScanBusy || hasFunctionsAuthMismatch}>
              {isbnScanBusy ? "Adding..." : "Add scanned ISBN"}
            </button>
          </div>
        </section>
        <section className="staff-column">
          <div className="staff-subtitle">External source provider diagnostics</div>
          <label className="staff-field">
            Provider policy
            <div className="staff-actions-row">
              <label>
                <input
                  type="checkbox"
                  checked={externalLookupPolicyOpenLibraryEnabled}
                  onChange={(event) => setExternalLookupPolicyOpenLibraryEnabled(event.target.checked)}
                  disabled={Boolean(busy) || externalLookupPolicyBusy || hasFunctionsAuthMismatch}
                />
                {" "}
                Open Library enabled
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={externalLookupPolicyGoogleBooksEnabled}
                  onChange={(event) => setExternalLookupPolicyGoogleBooksEnabled(event.target.checked)}
                  disabled={Boolean(busy) || externalLookupPolicyBusy || hasFunctionsAuthMismatch}
                />
                {" "}
                Google Books enabled
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={externalLookupPolicyCoverReviewGuardrailEnabled}
                  onChange={(event) => setExternalLookupPolicyCoverReviewGuardrailEnabled(event.target.checked)}
                  disabled={Boolean(busy) || externalLookupPolicyBusy || hasFunctionsAuthMismatch}
                />
                {" "}
                Require staff cover approval for imported covers
              </label>
            </div>
            <input
              type="text"
              value={externalLookupPolicyNote}
              onChange={(event) => setExternalLookupPolicyNote(event.target.value)}
              placeholder="Optional note for why this policy is set."
              disabled={Boolean(busy) || externalLookupPolicyBusy || hasFunctionsAuthMismatch}
            />
            <span className="helper">
              Use this to pause a provider when rate limits or reliability issues occur, and temporarily bypass manual cover approvals for trusted bulk ingestion.
              Cover approvals are handled in Staff / Lending / Cover review queue.
            </span>
          </label>
          <div className="staff-actions-row">
            <button
              className="btn btn-secondary"
              disabled={Boolean(busy) || externalLookupPolicyBusy || hasFunctionsAuthMismatch}
              onClick={() => void saveExternalLookupProviderPolicy()}
            >
              {externalLookupPolicyBusy ? "Saving..." : "Save provider policy"}
            </button>
          </div>
          {externalLookupPolicyStatus ? <div className="staff-note">{externalLookupPolicyStatus}</div> : null}
          {externalLookupPolicyUpdatedAtMs > 0 ? (
            <div className="staff-note">
              Policy updated {when(externalLookupPolicyUpdatedAtMs)}
              {externalLookupPolicyUpdatedByUid ? ` by ${externalLookupPolicyUpdatedByUid}` : ""}
            </div>
          ) : null}
          <label className="staff-field">
            Probe query
            <input
              type="text"
              value={externalLookupProbeQuery}
              onChange={(event) => setExternalLookupProbeQuery(event.target.value)}
              placeholder="ceramics glaze chemistry"
            />
            <span className="helper">Runs the same route members use for external fallback and reports provider health.</span>
          </label>
          {externalLookupProbeStatus ? <div className="staff-note">{externalLookupProbeStatus}</div> : null}
          <div className="staff-actions-row">
            <button
              className="btn btn-secondary"
              disabled={Boolean(busy) || externalLookupProbeBusy || hasFunctionsAuthMismatch}
              onClick={() => void runExternalLookupProviderProbe()}
            >
              {externalLookupProbeBusy ? "Probing..." : "Run provider probe"}
            </button>
          </div>
          <div className="staff-table-wrap">
            <table className="staff-table">
              <thead><tr><th>Provider</th><th>Healthy</th><th>Policy</th><th>Items</th><th>Cache</th></tr></thead>
              <tbody>
                {externalLookupProbeProviders.length === 0 ? (
                  <tr><td colSpan={5}>No probe results yet.</td></tr>
                ) : (
                  externalLookupProbeProviders.map((entry) => (
                    <tr key={entry.provider}>
                      <td>{entry.provider}</td>
                      <td>{entry.ok ? "yes" : "no"}</td>
                      <td>{entry.disabled ? "paused" : "active"}</td>
                      <td>{entry.itemCount}</td>
                      <td>{entry.cached ? "hit" : "miss"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
        <section className="staff-column">
          <div className="staff-subtitle">Library rollout phase</div>
          <label className="staff-field">
            Phase selector
            <select
              value={libraryRolloutPhase}
              onChange={(event) =>
                setLibraryRolloutPhase(normalizeLibraryRolloutPhase(event.target.value, libraryRolloutPhase))
              }
              disabled={Boolean(busy) || libraryRolloutPhaseBusy || hasFunctionsAuthMismatch}
            >
              <option value="phase_1_read_only">Phase 1 - Authenticated discovery (member writes paused)</option>
              <option value="phase_2_member_writes">Phase 2 - Member interactions enabled</option>
              <option value="phase_3_admin_full">Phase 3 - Admin management + cutover</option>
            </select>
            <span className="helper">
              Phase 1 pauses member interaction writes in the member library view while keeping browse/read available.
            </span>
          </label>
          <label className="staff-field">
            Rollout note
            <input
              type="text"
              value={libraryRolloutNote}
              onChange={(event) => setLibraryRolloutNote(event.target.value)}
              placeholder="Optional context shown to staff and surfaced in member pause notice."
              disabled={Boolean(busy) || libraryRolloutPhaseBusy || hasFunctionsAuthMismatch}
            />
          </label>
          <div className="staff-note">
            Member interactions are currently {libraryRolloutMemberWritesEnabled ? "enabled" : "paused"}.
          </div>
          <div className="staff-actions-row">
            <button
              className="btn btn-secondary"
              disabled={Boolean(busy) || libraryRolloutPhaseBusy || hasFunctionsAuthMismatch}
              onClick={() => void saveLibraryRolloutPhasePolicy()}
            >
              {libraryRolloutPhaseBusy ? "Saving..." : "Save rollout phase"}
            </button>
          </div>
          {libraryRolloutPhaseStatus ? <div className="staff-note">{libraryRolloutPhaseStatus}</div> : null}
          {libraryRolloutUpdatedAtMs > 0 ? (
            <div className="staff-note">
              Rollout updated {when(libraryRolloutUpdatedAtMs)}
              {libraryRolloutUpdatedByUid ? ` by ${libraryRolloutUpdatedByUid}` : ""}
            </div>
          ) : null}
          <div className="staff-subtitle">Phase metrics snapshot</div>
          <div className="staff-note">
            Tracks library route health over the last {libraryPhaseMetricsWindowMinutes} minutes for go/no-go checks.
          </div>
          <div className="staff-actions-row">
            <button
              className="btn btn-ghost btn-small"
              disabled={Boolean(busy)}
              onClick={() => void refreshLibraryPhaseMetricsSnapshot()}
            >
              Refresh phase metrics
            </button>
            <button
              className="btn btn-ghost btn-small"
              disabled={!libraryPhaseMetricsArtifact}
              onClick={() => void copy(libraryPhaseMetricsArtifact ? safeJsonStringify(libraryPhaseMetricsArtifact) : "")}
            >
              Copy phase metrics JSON
            </button>
          </div>
          {libraryPhaseMetricsStatus ? <div className="staff-note">{libraryPhaseMetricsStatus}</div> : null}
          <div className="staff-table-wrap">
            <table className="staff-table">
              <tbody>
                <tr>
                  <th>Requests</th>
                  <td>{libraryPhaseMetricsSnapshot?.requestCount ?? 0}</td>
                  <th>Errors</th>
                  <td>{libraryPhaseMetricsSnapshot?.errorCount ?? 0}</td>
                </tr>
                <tr>
                  <th>Conflicts</th>
                  <td>{libraryPhaseMetricsSnapshot?.conflictCount ?? 0}</td>
                  <th>Route errors</th>
                  <td>{libraryPhaseMetricsSnapshot?.routeErrorCount ?? 0}</td>
                </tr>
                <tr>
                  <th>Error rate</th>
                  <td>
                    {libraryPhaseMetricsSnapshot
                      ? `${(libraryPhaseMetricsSnapshot.errorRate * 100).toFixed(1)}%`
                      : "-"}
                  </td>
                  <th>Conflict rate</th>
                  <td>
                    {libraryPhaseMetricsSnapshot
                      ? `${(libraryPhaseMetricsSnapshot.conflictRate * 100).toFixed(1)}%`
                      : "-"}
                  </td>
                </tr>
                <tr>
                  <th>P50 latency</th>
                  <td>{formatLatencyMs(libraryPhaseMetricsSnapshot?.p50LatencyMs ?? null)}</td>
                  <th>P95 latency</th>
                  <td>{formatLatencyMs(libraryPhaseMetricsSnapshot?.p95LatencyMs ?? null)}</td>
                </tr>
                <tr>
                  <th>Max latency</th>
                  <td>{formatLatencyMs(libraryPhaseMetricsSnapshot?.maxLatencyMs ?? null)}</td>
                  <th>Generated</th>
                  <td>{libraryPhaseMetricsSnapshot ? when(Date.parse(libraryPhaseMetricsSnapshot.generatedAtIso)) : "-"}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="staff-table-wrap">
            <table className="staff-table">
              <thead>
                <tr>
                  <th>Endpoint</th>
                  <th>Requests</th>
                  <th>Errors</th>
                  <th>Conflicts</th>
                  <th>Route errors</th>
                  <th>P95 latency</th>
                </tr>
              </thead>
              <tbody>
                {(libraryPhaseMetricsSnapshot?.endpoints ?? []).slice(0, 12).map((entry) => (
                  <tr key={entry.route}>
                    <td><code>{entry.route}</code></td>
                    <td>{entry.requestCount}</td>
                    <td>{entry.errorCount}</td>
                    <td>{entry.conflictCount}</td>
                    <td>{entry.routeErrorCount}</td>
                    <td>{formatLatencyMs(entry.p95LatencyMs)}</td>
                  </tr>
                ))}
                {!libraryPhaseMetricsSnapshot || libraryPhaseMetricsSnapshot.endpoints.length === 0 ? (
                  <tr>
                    <td colSpan={6}>No library telemetry recorded in this browser session yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      <details className="staff-troubleshooting">
        <summary>Catalog admin (create/edit/delete + ISBN resolve)</summary>
        <div className="staff-note">
          Item save/delete dispatches to v1 admin routes when present and falls back to direct Firestore writes when routes are unavailable.
        </div>
        <div className="staff-module-grid">
          <section className="staff-column">
            <div className="staff-actions-row">
              <input
                className="staff-member-search"
                placeholder="Search library items by title, author, ISBN, ID"
                value={lendingAdminItemSearch}
                onChange={(event) => setLendingAdminItemSearch(event.target.value)}
              />
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() => handleStartLendingAdminItemCreate()}
                disabled={Boolean(busy) || lendingAdminItemBusy}
              >
                New item
              </button>
            </div>
            <div className="staff-table-wrap">
              <table className="staff-table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Status</th>
                    <th>Copies</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLendingAdminItems.length === 0 ? (
                    <tr><td colSpan={4}>No library items match this search.</td></tr>
                  ) : (
                    filteredLendingAdminItems.slice(0, 80).map((item) => (
                      <tr
                        key={item.id}
                        className={`staff-click-row ${selectedAdminItemId === item.id ? "active" : ""}`}
                        onClick={() => handleSelectLendingAdminItem(item)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            handleSelectLendingAdminItem(item);
                          }
                        }}
                        tabIndex={0}
                      >
                        <td>
                          <div>{item.title}</div>
                          <div className="staff-mini">{item.authorLine}</div>
                          <div className="staff-mini"><code>{item.id}</code></div>
                          {item.isbn ? <div className="staff-mini">ISBN {item.isbn}</div> : null}
                        </td>
                        <td><span className="pill">{item.status}</span></td>
                        <td>{item.availableCopies}/{item.totalCopies}</td>
                        <td>{when(item.updatedAtMs)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
          <section className="staff-column">
            <div className="staff-subtitle">
              {selectedAdminItem ? `Editing ${selectedAdminItem.title}` : "New library item"}
            </div>
            <label className="staff-field">
              Title
              <input
                type="text"
                value={lendingAdminItemDraft.title}
                onChange={(event) =>
                  setLendingAdminItemDraft((prev) => ({ ...prev, title: event.target.value }))
                }
                disabled={Boolean(busy) || lendingAdminItemBusy}
              />
            </label>
            <label className="staff-field">
              Authors (comma/newline)
              <textarea
                value={lendingAdminItemDraft.authorsCsv}
                onChange={(event) =>
                  setLendingAdminItemDraft((prev) => ({ ...prev, authorsCsv: event.target.value }))
                }
                disabled={Boolean(busy) || lendingAdminItemBusy}
              />
            </label>
            <div className="staff-actions-row">
              <label className="staff-field">
                ISBN
                <input
                  type="text"
                  value={lendingAdminItemDraft.isbn}
                  onChange={(event) =>
                    setLendingAdminItemDraft((prev) => ({ ...prev, isbn: event.target.value }))
                  }
                  disabled={Boolean(busy) || lendingAdminItemBusy || lendingAdminIsbnResolveBusy}
                />
              </label>
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={() => void handleLendingAdminResolveIsbn()}
                disabled={Boolean(busy) || lendingAdminItemBusy || lendingAdminIsbnResolveBusy}
              >
                {lendingAdminIsbnResolveBusy ? "Resolving..." : "Resolve ISBN"}
              </button>
            </div>
            <label className="staff-field">
              Subtitle
              <input
                type="text"
                value={lendingAdminItemDraft.subtitle}
                onChange={(event) =>
                  setLendingAdminItemDraft((prev) => ({ ...prev, subtitle: event.target.value }))
                }
                disabled={Boolean(busy) || lendingAdminItemBusy}
              />
            </label>
            <label className="staff-field">
              Description
              <textarea
                value={lendingAdminItemDraft.description}
                onChange={(event) =>
                  setLendingAdminItemDraft((prev) => ({ ...prev, description: event.target.value }))
                }
                disabled={Boolean(busy) || lendingAdminItemBusy}
              />
            </label>
            <div className="staff-actions-row">
              <label className="staff-field">
                Publisher
                <input
                  type="text"
                  value={lendingAdminItemDraft.publisher}
                  onChange={(event) =>
                    setLendingAdminItemDraft((prev) => ({ ...prev, publisher: event.target.value }))
                  }
                  disabled={Boolean(busy) || lendingAdminItemBusy}
                />
              </label>
              <label className="staff-field">
                Published date
                <input
                  type="text"
                  value={lendingAdminItemDraft.publishedDate}
                  placeholder="YYYY-MM-DD"
                  onChange={(event) =>
                    setLendingAdminItemDraft((prev) => ({ ...prev, publishedDate: event.target.value }))
                  }
                  disabled={Boolean(busy) || lendingAdminItemBusy}
                />
              </label>
            </div>
            <div className="staff-actions-row">
              <label className="staff-field">
                Media type
                <input
                  type="text"
                  value={lendingAdminItemDraft.mediaType}
                  onChange={(event) =>
                    setLendingAdminItemDraft((prev) => ({ ...prev, mediaType: event.target.value }))
                  }
                  disabled={Boolean(busy) || lendingAdminItemBusy}
                />
              </label>
              <label className="staff-field">
                Status
                <select
                  value={lendingAdminItemDraft.status}
                  onChange={(event) =>
                    setLendingAdminItemDraft((prev) => ({ ...prev, status: event.target.value }))
                  }
                  disabled={Boolean(busy) || lendingAdminItemBusy}
                >
                  <option value="available">available</option>
                  <option value="checked_out">checked_out</option>
                  <option value="overdue">overdue</option>
                  <option value="lost">lost</option>
                  <option value="unavailable">unavailable</option>
                  <option value="archived">archived</option>
                </select>
              </label>
              <label className="staff-field">
                Source
                <input
                  type="text"
                  value={lendingAdminItemDraft.source}
                  onChange={(event) =>
                    setLendingAdminItemDraft((prev) => ({ ...prev, source: event.target.value }))
                  }
                  disabled={Boolean(busy) || lendingAdminItemBusy}
                />
              </label>
            </div>
            <div className="staff-actions-row">
              <label className="staff-field">
                Total copies
                <input
                  type="number"
                  min={1}
                  value={lendingAdminItemDraft.totalCopies}
                  onChange={(event) =>
                    setLendingAdminItemDraft((prev) => ({ ...prev, totalCopies: event.target.value }))
                  }
                  disabled={Boolean(busy) || lendingAdminItemBusy}
                />
              </label>
              <label className="staff-field">
                Available copies
                <input
                  type="number"
                  min={0}
                  value={lendingAdminItemDraft.availableCopies}
                  onChange={(event) =>
                    setLendingAdminItemDraft((prev) => ({ ...prev, availableCopies: event.target.value }))
                  }
                  disabled={Boolean(busy) || lendingAdminItemBusy}
                />
              </label>
              <label className="staff-field">
                Format
                <input
                  type="text"
                  value={lendingAdminItemDraft.format}
                  onChange={(event) =>
                    setLendingAdminItemDraft((prev) => ({ ...prev, format: event.target.value }))
                  }
                  disabled={Boolean(busy) || lendingAdminItemBusy}
                />
              </label>
            </div>
            <label className="staff-field">
              Cover URL
              <input
                type="url"
                value={lendingAdminItemDraft.coverUrl}
                onChange={(event) =>
                  setLendingAdminItemDraft((prev) => ({ ...prev, coverUrl: event.target.value }))
                }
                disabled={Boolean(busy) || lendingAdminItemBusy}
              />
            </label>
            <div className="staff-actions-row">
              <label className="staff-field">
                Subjects
                <input
                  type="text"
                  value={lendingAdminItemDraft.subjectsCsv}
                  placeholder="glaze chemistry, kiln control"
                  onChange={(event) =>
                    setLendingAdminItemDraft((prev) => ({ ...prev, subjectsCsv: event.target.value }))
                  }
                  disabled={Boolean(busy) || lendingAdminItemBusy}
                />
              </label>
              <label className="staff-field">
                Techniques
                <input
                  type="text"
                  value={lendingAdminItemDraft.techniquesCsv}
                  placeholder="wheel, handbuilding"
                  onChange={(event) =>
                    setLendingAdminItemDraft((prev) => ({ ...prev, techniquesCsv: event.target.value }))
                  }
                  disabled={Boolean(busy) || lendingAdminItemBusy}
                />
              </label>
            </div>
            <div className="staff-actions-row">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleLendingAdminSave()}
                disabled={Boolean(busy) || lendingAdminItemBusy}
              >
                {lendingAdminItemBusy ? "Saving..." : selectedAdminItem ? "Save item" : "Create item"}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => handleStartLendingAdminItemCreate()}
                disabled={Boolean(busy) || lendingAdminItemBusy}
              >
                Reset draft
              </button>
            </div>
            {selectedAdminItem ? (
              <>
                <label className="staff-field">
                  Type <code>{lendingAdminDeleteConfirmationPhrase || "delete <itemId>"}</code> to enable delete
                  <input
                    type="text"
                    value={lendingAdminItemDeleteConfirmInput}
                    onChange={(event) => setLendingAdminItemDeleteConfirmInput(event.target.value)}
                    disabled={Boolean(busy) || lendingAdminItemBusy}
                  />
                </label>
                <div className="staff-actions-row">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => void handleLendingAdminDelete()}
                    disabled={Boolean(busy) || lendingAdminItemBusy}
                  >
                    {lendingAdminItemBusy ? "Deleting..." : "Delete item"}
                  </button>
                </div>
              </>
            ) : null}
            {lendingAdminIsbnResolveStatus ? <div className="staff-note">{lendingAdminIsbnResolveStatus}</div> : null}
            {lendingAdminItemError ? <div className="staff-note staff-note-error">{lendingAdminItemError}</div> : null}
            {lendingAdminItemStatus ? <div className="staff-note staff-note-ok">{lendingAdminItemStatus}</div> : null}
          </section>
        </div>
      </details>
      <div className="staff-kpi-grid">
        <div className="staff-kpi"><span>Catalog items</span><strong>{libraryAdminItems.length}</strong></div>
        <div className="staff-kpi"><span>Requests</span><strong>{libraryRequests.length}</strong></div>
        <div className="staff-kpi"><span>Loans</span><strong>{libraryLoans.length}</strong></div>
        <div className="staff-kpi"><span>Filtered requests</span><strong>{lendingTriage.requestView.length}</strong></div>
        <div className="staff-kpi"><span>Filtered loans</span><strong>{lendingTriage.loanView.length}</strong></div>
        <div className="staff-kpi"><span>Open requests</span><strong>{lendingTriage.openRequests.length}</strong></div>
        <div className="staff-kpi"><span>Active loans</span><strong>{lendingTriage.activeLoans.length}</strong></div>
        <div className="staff-kpi"><span>Overdue loans</span><strong>{lendingTriage.overdueLoans.length}</strong></div>
        <div className="staff-kpi"><span>Returned loans</span><strong>{lendingTriage.returnedLoans.length}</strong></div>
        <div className="staff-kpi"><span>Recommendations</span><strong>{recommendationModerationKpis.total}</strong></div>
        <div className="staff-kpi"><span>Pending review</span><strong>{recommendationModerationKpis.pendingReview}</strong></div>
        <div className="staff-kpi"><span>Approved recs</span><strong>{recommendationModerationKpis.approved}</strong></div>
        <div className="staff-kpi"><span>Hidden recs</span><strong>{recommendationModerationKpis.hidden}</strong></div>
        <div className="staff-kpi"><span>Tag queue</span><strong>{tagModerationKpis.pending}</strong></div>
        <div className="staff-kpi"><span>Total tag subs</span><strong>{tagModerationKpis.total}</strong></div>
        <div className="staff-kpi"><span>Cover review queue</span><strong>{libraryCoverReviews.length}</strong></div>
      </div>
      <div className="staff-actions-row">
        <input
          className="staff-member-search"
          placeholder="Search lending by title, member, email, UID, or ID"
          value={lendingSearch}
          onChange={(event) => setLendingSearch(event.target.value)}
        />
        <select
          className="staff-member-role-filter"
          value={lendingStatusFilter}
          onChange={(event) => setLendingStatusFilter(event.target.value)}
        >
          <option value="all">All statuses</option>
          {lendingStatusOptions.map((statusName) => (
            <option key={statusName} value={statusName}>{statusName}</option>
          ))}
        </select>
        <select
          className="staff-member-role-filter"
          value={lendingFocusFilter}
          onChange={(event) =>
            setLendingFocusFilter(
              event.target.value as "all" | "requests" | "active" | "overdue" | "returned"
            )
          }
        >
          <option value="all">All focus</option>
          <option value="requests">Open requests</option>
          <option value="active">Active loans</option>
          <option value="overdue">Overdue loans</option>
          <option value="returned">Returned loans</option>
        </select>
        <select
          className="staff-member-role-filter"
          value={lendingRecommendationFilter}
          onChange={(event) => setLendingRecommendationFilter(event.target.value)}
        >
          <option value="all">All recommendation states</option>
          {lendingRecommendationStatusOptions.map((statusName) => (
            <option key={statusName} value={statusName}>{statusName}</option>
          ))}
        </select>
      </div>
      <div className="staff-module-grid">
        <div className="staff-column">
          <div className="staff-subtitle">Requests</div>
          <div className="staff-table-wrap">
            <table className="staff-table">
              <thead><tr><th>Title</th><th>Status</th><th>Requester</th><th>Created</th></tr></thead>
              <tbody>
                {lendingTriage.requestView.length === 0 ? (
                  <tr><td colSpan={4}>No requests match current filters.</td></tr>
                ) : (
                  lendingTriage.requestView.map((request) => (
                    <tr
                      key={request.id}
                      className={`staff-click-row ${selectedRequestId === request.id ? "active" : ""}`}
                      onClick={() => setSelectedRequestId(request.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedRequestId(request.id);
                        }
                      }}
                      tabIndex={0}
                    >
                      <td>
                        <div>{request.title}</div>
                        <div className="staff-mini"><code>{request.id}</code></div>
                      </td>
                      <td><span className="pill">{request.status}</span></td>
                      <td>{request.requesterName}</td>
                      <td>{when(request.createdAtMs)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="staff-column">
          <div className="staff-subtitle">Loans</div>
          <div className="staff-table-wrap">
            <table className="staff-table">
              <thead><tr><th>Title</th><th>Status</th><th>Borrower</th><th>Created</th></tr></thead>
              <tbody>
                {lendingTriage.loanView.length === 0 ? (
                  <tr><td colSpan={4}>No loans match current filters.</td></tr>
                ) : (
                  lendingTriage.loanView.map((loan) => (
                    <tr
                      key={loan.id}
                      className={`staff-click-row ${selectedLoanId === loan.id ? "active" : ""}`}
                      onClick={() => setSelectedLoanId(loan.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedLoanId(loan.id);
                        }
                      }}
                      tabIndex={0}
                    >
                      <td>
                        <div>{loan.title}</div>
                        <div className="staff-mini"><code>{loan.id}</code></div>
                      </td>
                        <td>
                        <span className="pill">{loan.status}</span>
                        {(Object.prototype.hasOwnProperty.call(overdueLoanIdsById, loan.id)) && loan.returnedAtMs === 0 ? (
                          <span className="pill staff-pill-margin-left">overdue</span>
                        ) : null}
                      </td>
                      <td>{loan.borrowerName}</td>
                      <td>{when(loan.createdAtMs)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div className="staff-module-grid">
        <div className="staff-column">
          <div className="staff-subtitle">Selected request</div>
          <div className="staff-note">
            {selectedRequest ? (
              <>
                <strong>{selectedRequest.title}</strong><br />
                <span>{selectedRequest.status}</span><br />
                <span>{selectedRequest.requesterName} · {selectedRequest.requesterEmail}</span><br />
                <code>{selectedRequest.requesterUid || selectedRequest.id}</code><br />
                <span>Created: {when(selectedRequest.createdAtMs)}</span>
              </>
            ) : (
              "Select a request to inspect details."
            )}
          </div>
          {selectedRequest ? (
            <div className="staff-actions-row">
              <button type="button" className="btn btn-ghost btn-small" onClick={() => void copy(selectedRequest.requesterEmail || "")}>
                Copy email
              </button>
              <button type="button" className="btn btn-ghost btn-small" onClick={() => void copy(selectedRequest.requesterUid || selectedRequest.id)}>
                Copy UID
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() =>
                  void copy(
                    `Hi ${selectedRequest.requesterName || "there"} — your lending request for "${selectedRequest.title}" is in review. We'll update you with pickup timing soon.`
                  )
                }
              >
                Copy reply template
              </button>
            </div>
          ) : null}
          {selectedRequest ? (
            <details className="staff-troubleshooting">
              <summary>Raw request document</summary>
              <pre>{safeJsonStringify(selectedRequest.rawDoc)}</pre>
            </details>
          ) : null}
        </div>
        <div className="staff-column">
          <div className="staff-subtitle">Selected loan</div>
          <div className="staff-note">
            {selectedLoan ? (
              <>
                <strong>{selectedLoan.title}</strong><br />
                <span>{selectedLoan.status}</span><br />
                <span>{selectedLoan.borrowerName} · {selectedLoan.borrowerEmail}</span><br />
                <code>{selectedLoan.borrowerUid || selectedLoan.id}</code><br />
                <span>Created: {when(selectedLoan.createdAtMs)}</span><br />
                <span>Due: {when(selectedLoan.dueAtMs)} · Returned: {when(selectedLoan.returnedAtMs)}</span>
              </>
            ) : (
              "Select a loan to inspect details."
            )}
          </div>
          {selectedLoan ? (
            <div className="staff-actions-row">
              <button type="button" className="btn btn-ghost btn-small" onClick={() => void copy(selectedLoan.borrowerEmail || "")}>
                Copy borrower email
              </button>
              <button type="button" className="btn btn-ghost btn-small" onClick={() => void copy(selectedLoan.borrowerUid || selectedLoan.id)}>
                Copy borrower UID
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() =>
                  void copy(
                    `Hi ${selectedLoan.borrowerName || "there"} — reminder that "${selectedLoan.title}" is due ${when(selectedLoan.dueAtMs)}. Reply if you need an extension.`
                  )
                }
              >
                Copy due reminder
              </button>
            </div>
          ) : null}
          {selectedLoan ? (
            <>
              <div className="staff-subtitle">Loan recovery</div>
              <div className="staff-actions-row">
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  disabled={
                    Boolean(busy) ||
                    loanRecoveryBusy ||
                    selectedLoan.status.trim().toLowerCase() === "lost" ||
                    selectedLoan.status.trim().toLowerCase() === "returned"
                  }
                  onClick={() => void handleLoanMarkLost(selectedLoan)}
                >
                  {loanRecoveryBusy ? "Saving..." : "Mark lost"}
                </button>
                <input
                  className="staff-member-search"
                  placeholder="Replacement fee cents (optional)"
                  value={loanReplacementFeeAmountInput}
                  onChange={(event) => setLoanReplacementFeeAmountInput(event.target.value)}
                  disabled={Boolean(busy) || loanRecoveryBusy}
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  disabled={Boolean(busy) || loanRecoveryBusy || selectedLoan.status.trim().toLowerCase() !== "lost"}
                  onClick={() => void handleLoanAssessReplacementFee(selectedLoan)}
                >
                  {loanRecoveryBusy ? "Saving..." : "Assess replacement fee"}
                </button>
              </div>
              <div className="staff-actions-row">
                <select
                  className="staff-member-role-filter"
                  value={loanOverrideStatusDraft}
                  onChange={(event) =>
                    setLoanOverrideStatusDraft(
                      normalizeLibraryItemOverrideStatus(event.target.value)
                    )
                  }
                  disabled={Boolean(busy) || loanRecoveryBusy}
                >
                  <option value="available">available</option>
                  <option value="checked_out">checked_out</option>
                  <option value="overdue">overdue</option>
                  <option value="lost">lost</option>
                  <option value="unavailable">unavailable</option>
                  <option value="archived">archived</option>
                </select>
                <input
                  className="staff-member-search"
                  placeholder="Override note (optional)"
                  value={loanOverrideNoteDraft}
                  onChange={(event) => setLoanOverrideNoteDraft(event.target.value)}
                  disabled={Boolean(busy) || loanRecoveryBusy}
                />
                <button
                  type="button"
                  className="btn btn-ghost btn-small"
                  disabled={Boolean(busy) || loanRecoveryBusy}
                  onClick={() => void handleLoanItemStatusOverride(selectedLoan)}
                >
                  {loanRecoveryBusy ? "Saving..." : "Override item status"}
                </button>
              </div>
              {loanRecoveryStatus ? <div className="staff-note">{loanRecoveryStatus}</div> : null}
            </>
          ) : null}
          {selectedLoan ? (
            <details className="staff-troubleshooting">
              <summary>Raw loan document</summary>
              <pre>{safeJsonStringify(selectedLoan.rawDoc)}</pre>
            </details>
          ) : null}
        </div>
      </div>
      <div className="staff-subtitle">Recommendation moderation</div>
      {recommendationModerationStatus ? <div className="staff-note">{recommendationModerationStatus}</div> : null}
      <div className="staff-table-wrap">
        <table className="staff-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Recommender</th>
              <th>Status</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredRecommendations.length === 0 ? (
              <tr><td colSpan={5}>No recommendations match current filters.</td></tr>
            ) : (
              filteredRecommendations.map((row) => {
                const rowBusy = Boolean(recommendationModerationBusyById[row.id]);
                const statusLower = row.moderationStatus.toLowerCase();
                return (
                  <tr key={row.id}>
                    <td>
                      <div>{row.title}</div>
                      {row.author ? <div className="staff-mini">by {row.author}</div> : null}
                      {row.isbn ? <div className="staff-mini">ISBN {row.isbn}</div> : null}
                      {row.rationale ? <div className="staff-mini">{row.rationale}</div> : null}
                      <div className="staff-mini"><code>{row.id}</code></div>
                    </td>
                    <td>
                      <div>{row.recommenderName || "Unknown"}</div>
                      <div className="staff-mini"><code>{row.recommenderUid || "-"}</code></div>
                    </td>
                    <td><span className="pill">{row.moderationStatus || "pending_review"}</span></td>
                    <td>{when(row.createdAtMs)}</td>
                    <td>
                      <div className="staff-actions-row">
                        <button
                          type="button"
                          className="btn btn-ghost btn-small"
                          disabled={Boolean(busy) || rowBusy || statusLower === "approved"}
                          onClick={() => void handleRecommendationModeration(row, "approve")}
                        >
                          {rowBusy ? "Saving..." : "Approve"}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-small"
                          disabled={Boolean(busy) || rowBusy || statusLower === "hidden"}
                          onClick={() => void handleRecommendationModeration(row, "hide")}
                        >
                          {rowBusy ? "Saving..." : "Hide"}
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary btn-small"
                          disabled={Boolean(busy) || rowBusy || statusLower !== "hidden"}
                          onClick={() => void handleRecommendationModeration(row, "restore")}
                        >
                          {rowBusy ? "Saving..." : "Restore"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <div className="staff-subtitle">Tag moderation queue</div>
      {tagModerationStatus ? <div className="staff-note">{tagModerationStatus}</div> : null}
      <div className="staff-table-wrap">
        <table className="staff-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Suggested tag</th>
              <th>Member</th>
              <th>Created</th>
              <th>Approve</th>
            </tr>
          </thead>
          <tbody>
            {filteredTagSubmissions.length === 0 ? (
              <tr><td colSpan={5}>No pending tag submissions match current filters.</td></tr>
            ) : (
              filteredTagSubmissions.map((row) => {
                const rowBusy = Boolean(tagModerationBusyById[row.id]);
                const draftName = tagSubmissionApprovalDraftById[row.id] ?? row.tag;
                const canApprove = Boolean(normalizeLibraryTagLabel(draftName));
                return (
                  <tr key={row.id}>
                    <td>
                      <div>{row.itemTitle || "Library item"}</div>
                      <div className="staff-mini"><code>{row.itemId || row.id}</code></div>
                    </td>
                    <td>
                      <div>{row.tag || "(empty)"}</div>
                      <div className="staff-mini"><code>{row.normalizedTag || "-"}</code></div>
                    </td>
                    <td>
                      <div>{row.submittedByName || "Member"}</div>
                      <div className="staff-mini"><code>{row.submittedByUid || "-"}</code></div>
                    </td>
                    <td>{when(row.createdAtMs)}</td>
                    <td>
                      <div className="staff-actions-row">
                        <input
                          type="text"
                          className="staff-member-search"
                          value={draftName}
                          placeholder="Canonical tag name"
                          maxLength={80}
                          onChange={(event) =>
                            setTagSubmissionApprovalDraftById((prev) => ({
                              ...prev,
                              [row.id]: event.target.value,
                            }))
                          }
                          disabled={Boolean(busy) || rowBusy}
                        />
                        <button
                          type="button"
                          className="btn btn-primary btn-small"
                          disabled={Boolean(busy) || rowBusy || !canApprove}
                          onClick={() => void handleTagSubmissionApprove(row)}
                        >
                          {rowBusy ? "Saving..." : "Approve"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <div className="staff-subtitle">Tag merge</div>
      <div className="staff-note">
        Merge duplicate tags by canonical tag ID. Source is marked merged and item-tag links are migrated.
      </div>
      <div className="staff-actions-row">
        <input
          className="staff-member-search"
          placeholder="Source tag ID (tag_...)"
          value={tagMergeSourceId}
          onChange={(event) => setTagMergeSourceId(event.target.value)}
          disabled={Boolean(busy) || tagMergeBusy}
        />
        <input
          className="staff-member-search"
          placeholder="Target tag ID (tag_...)"
          value={tagMergeTargetId}
          onChange={(event) => setTagMergeTargetId(event.target.value)}
          disabled={Boolean(busy) || tagMergeBusy}
        />
        <input
          className="staff-member-search"
          placeholder="Merge note (optional)"
          value={tagMergeNote}
          onChange={(event) => setTagMergeNote(event.target.value)}
          disabled={Boolean(busy) || tagMergeBusy}
        />
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void handleTagMerge()}
          disabled={Boolean(busy) || tagMergeBusy}
        >
          {tagMergeBusy ? "Merging..." : "Merge tags"}
        </button>
      </div>
      <div className="staff-subtitle">Cover review queue</div>
      <div className="staff-note">
        Review and approve imported covers here. This queue is the manual approval workflow for cover guardrails.
      </div>
      {coverReviewStatus ? <div className="staff-note">{coverReviewStatus}</div> : null}
      <div className="staff-table-wrap">
        <table className="staff-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Status</th>
              <th>Reason</th>
              <th>Updated</th>
              <th>Resolve</th>
            </tr>
          </thead>
          <tbody>
            {libraryCoverReviews.length === 0 ? (
              <tr><td colSpan={5}>No items currently flagged for cover review.</td></tr>
            ) : (
              libraryCoverReviews.map((row) => {
                const rowBusy = Boolean(coverReviewBusyById[row.id]);
                const currentCoverValid = isValidHttpUrl((row.coverUrl ?? "").trim());
                const rowError = coverReviewErrorById[row.id] ?? "";
                return (
                  <tr key={row.id}>
                    <td>
                      <div>{row.title}</div>
                      <div className="staff-mini"><code>{row.id}</code></div>
                      {row.coverUrl ? (
                        <a className="staff-mini" href={row.coverUrl} target="_blank" rel="noreferrer">
                          Open current cover
                        </a>
                      ) : null}
                      {!currentCoverValid ? <div className="staff-mini">Current cover URL is missing or invalid.</div> : null}
                    </td>
                    <td><span className="pill">{row.coverQualityStatus || "needs_review"}</span></td>
                    <td>{row.coverQualityReason || "manual_review_required"}</td>
                    <td>{when(row.updatedAtMs)}</td>
                    <td>
                      <div className="staff-actions-row">
                        <input
                          type="url"
                          className="staff-member-search"
                          placeholder="https://cover-image-url"
                          value={coverReviewDraftById[row.id] ?? ""}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            setCoverReviewDraftById((prev) => ({ ...prev, [row.id]: nextValue }));
                            setCoverReviewErrorById((prev) => {
                              const next = { ...prev };
                              delete next[row.id];
                              return next;
                            });
                          }}
                        />
                        <button
                          type="button"
                          className="btn btn-ghost btn-small"
                          onClick={() => void handleCoverReviewResolve(row, "approve_existing")}
                          disabled={Boolean(busy) || rowBusy || !currentCoverValid}
                        >
                          {rowBusy ? "Saving..." : "Approve current"}
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary btn-small"
                          onClick={() => void handleCoverReviewResolve(row, "set_replacement")}
                          disabled={Boolean(busy) || rowBusy}
                        >
                          {rowBusy ? "Saving..." : "Use replacement URL"}
                        </button>
                      </div>
                      {rowError ? <div className="staff-note staff-note-error">{rowError}</div> : null}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
