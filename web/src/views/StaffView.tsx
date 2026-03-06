import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "firebase/auth";
import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  documentId,
  getCountFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type QueryConstraint,
} from "firebase/firestore";
import { connectStorageEmulator, getDownloadURL, getStorage, ref, uploadBytes } from "firebase/storage";
import { createFunctionsClient, safeJsonStringify, type LastRequest } from "../api/functionsClient";
import {
  type ImportLibraryIsbnsResponse,
  type LibraryExternalLookupResponse,
  type LibraryExternalLookupProviderConfigResponse,
  type LibraryExternalLookupProviderConfigSetRequest,
  type LibraryRolloutConfigResponse,
  type LibraryRolloutConfigSetRequest,
  type LibraryRolloutPhase,
  type LibraryItemOverrideStatusRequest,
  type LibraryItemOverrideStatusResponse,
  type LibraryLoanAssessReplacementFeeRequest,
  type LibraryLoanAssessReplacementFeeResponse,
  type LibraryLoanMarkLostRequest,
  type LibraryLoanMarkLostResponse,
  type LibraryRecommendationsListResponse,
  type LibraryTagMergeRequest,
  type LibraryTagMergeResponse,
  type LibraryTagSubmissionApproveRequest,
  type LibraryTagSubmissionApproveResponse,
  V1_LIBRARY_EXTERNAL_LOOKUP_FN,
  V1_LIBRARY_EXTERNAL_LOOKUP_PROVIDER_CONFIG_GET_FN,
  V1_LIBRARY_EXTERNAL_LOOKUP_PROVIDER_CONFIG_SET_FN,
  V1_LIBRARY_ITEMS_LIST_FN,
  V1_LIBRARY_ITEMS_OVERRIDE_STATUS_FN,
  V1_LIBRARY_ITEMS_IMPORT_ISBNS_FN,
  V1_LIBRARY_ROLLOUT_CONFIG_GET_FN,
  V1_LIBRARY_ROLLOUT_CONFIG_SET_FN,
  V1_LIBRARY_LOANS_ASSESS_REPLACEMENT_FEE_FN,
  V1_LIBRARY_LOANS_MARK_LOST_FN,
  V1_LIBRARY_RECOMMENDATIONS_LIST_FN,
  V1_LIBRARY_TAGS_MERGE_FN,
  V1_LIBRARY_TAG_SUBMISSIONS_APPROVE_FN,
} from "../api/portalContracts";
import { track } from "../lib/analytics";
import { getRecentRequestTelemetry, type RequestTelemetry } from "../lib/requestTelemetry";
import { db } from "../firebase";
import type { Announcement, DirectMessageThread } from "../types/messaging";
import { normalizeReservationRecord, type ReservationRecord } from "../lib/normalizers/reservations";
import { clearHandlerErrorLog, getHandlerErrorLog } from "../utils/handlerLog";
import { resolveFunctionsBaseUrlResolution } from "../utils/functionsBaseUrl";
import { resolveStudioBrainBaseUrlResolution } from "../utils/studioBrain";
import {
  formatMinutesAgo,
  minutesSinceIso,
  resolveStudioBrainFetchFailure,
  resolveUnavailableStudioBrainStatus,
} from "../utils/studioBrainHealth";
import {
  normalizeStaffPath,
  resolveStaffWorkspaceOpenTarget,
  resolveStaffWorkspaceMatch,
  resolveStaffWorkspaceRequestedPath,
  STAFF_COCKPIT_PATH,
  STAFF_PATH,
  resolveStaffCockpitWorkspaceTabSegment,
  resolveStaffCockpitWorkspaceModule,
} from "../utils/staffWorkspacePaths";
import { parseStaffRole } from "../auth/staffRole";
import PolicyModule from "./staff/PolicyModule";
import StripeSettingsModule from "./staff/StripeSettingsModule";
import ReportsModule from "./staff/ReportsModule";
import AgentOpsModule from "./staff/AgentOpsModule";
import CockpitModule from "./staff/CockpitModule";
import CockpitOpsPanel from "./staff/CockpitOpsPanel";
import CommerceModule from "./staff/CommerceModule";
import EventsModule from "./staff/EventsModule";
import LendingModule from "./staff/LendingModule";
import OperationsCockpitModule from "./staff/OperationsCockpitModule";
import { buildLendingAdminApiPayload } from "./staff/lendingAdminPayload";
import ReservationsView from "./ReservationsView";
import { formatDateTime } from "../utils/format";

type Props = {
  user: User;
  isStaff: boolean;
  devAdminToken: string;
  onDevAdminTokenChange: (next: string) => void;
  devAdminEnabled: boolean;
  showEmulatorTools: boolean;
  onOpenCheckin?: () => void;
  onOpenReservation?: (reservationId?: string) => void;
  onOpenMessages?: () => void;
  onOpenMessageThread?: (threadId: string) => void;
  onOpenFirings?: () => void;
  onStartFiring?: () => void;
  initialModule?: ModuleKey;
  forceCockpitWorkspace?: boolean;
  onOpenStaffWorkspace?: (target: string) => void;
  messageThreads?: DirectMessageThread[];
  messageThreadsLoading?: boolean;
  messageThreadsError?: string;
  announcements?: Announcement[];
  announcementsLoading?: boolean;
  announcementsError?: string;
  unreadAnnouncements?: number;
};

const MODULE_REGISTRY = {
  cockpit: { label: "Cockpit", owner: "Operations", testId: "staff-module-cockpit", nav: true },
  checkins: { label: "Check-ins", owner: "Queue Ops", testId: "staff-module-checkins", nav: false },
  members: { label: "Members", owner: "Member Ops", testId: "staff-module-members", nav: false },
  pieces: { label: "Pieces & batches", owner: "Production Ops", testId: "staff-module-pieces", nav: false },
  firings: { label: "Firings", owner: "Kiln Ops", testId: "staff-module-firings", nav: false },
  events: { label: "Events", owner: "Program Ops", testId: "staff-module-events", nav: false },
  reports: { label: "Reports", owner: "Trust & Safety", testId: "staff-module-reports", nav: true },
  stripe: { label: "Stripe settings", owner: "Finance Ops", testId: "staff-module-stripe", nav: false },
  commerce: { label: "Store & billing", owner: "Commerce Ops", testId: "staff-module-commerce", nav: false },
  lending: { label: "Lending", owner: "Library Ops", testId: "staff-module-lending", nav: false },
  system: { label: "System", owner: "Platform", testId: "staff-module-system", nav: false },
} as const;

type CockpitTabKey =
  | "triage"
  | "automation"
  | "platform"
  | "finance"
  | "operations"
  | "policyAgentOps"
  | "reports"
  | "moduleTelemetry";
const STAFF_MODULE_USAGE_STORAGE_KEY = "mf_staff_module_usage_v1";
const STAFF_MODULE_USAGE_STORAGE_VERSION = 2;
const STAFF_ADAPTIVE_NAV_STORAGE_KEY = "mf_staff_adaptive_nav_v1";
const V1_LIBRARY_RECOMMENDATIONS_MODERATE_FN = "apiV1/v1/library.recommendations.moderate";
const LEGACY_LIBRARY_RECOMMENDATIONS_MODERATE_FN = "moderateLibraryRecommendation";
const V1_LIBRARY_ITEMS_CREATE_FN = "apiV1/v1/library.items.create";
const V1_LIBRARY_ITEMS_UPDATE_FN = "apiV1/v1/library.items.update";
const V1_LIBRARY_ITEMS_DELETE_FN = "apiV1/v1/library.items.delete";
const V1_LIBRARY_ITEMS_RESOLVE_ISBN_FN = "apiV1/v1/library.items.resolveIsbn";
const LIBRARY_ITEMS_API_PAGE_SIZE = 100;
const LIBRARY_RECOMMENDATIONS_API_LIMIT = 100;

type ModuleKey = keyof typeof MODULE_REGISTRY;

const COCKPIT_MODULE_TAB_BY_KEY: Partial<Record<ModuleKey, CockpitTabKey>> = {
  checkins: "operations",
  members: "operations",
  pieces: "operations",
  firings: "operations",
  events: "operations",
  lending: "operations",
  reports: "reports",
  commerce: "finance",
  stripe: "finance",
  system: "platform",
};
const COCKPIT_FLOW_MODULE_KEYS = new Set<ModuleKey>(Object.keys(COCKPIT_MODULE_TAB_BY_KEY) as ModuleKey[]);

const COCKPIT_TAB_PATH_SEGMENT: Record<CockpitTabKey, string> = {
  triage: "triage",
  automation: "automation",
  platform: "platform",
  finance: "finance",
  operations: "operations",
  policyAgentOps: "policy-agent-ops",
  reports: "reports",
  moduleTelemetry: "module-telemetry",
};

const COCKPIT_PATH_TAB_BY_SEGMENT: Readonly<Record<string, CockpitTabKey>> = {
  commerce: "finance",
  stripe: "finance",
  operations: "operations",
  overview: "triage",
  governance: "policyAgentOps",
  policy: "policyAgentOps",
  "agent-ops": "policyAgentOps",
  "agent_ops": "policyAgentOps",
  agentops: "policyAgentOps",
  triage: "triage",
  automation: "automation",
  platform: "platform",
  finance: "finance",
  "policy-agent-ops": "policyAgentOps",
  "policy_agent_ops": "policyAgentOps",
  "module-telemetry": "moduleTelemetry",
};
type CockpitNavigationTarget = {
  moduleKey: ModuleKey;
  tab?: CockpitTabKey;
};

const COCKPIT_ACTION_TARGET_TAB_BY_KEY: Record<string, CockpitTabKey> = {
  ...COCKPIT_PATH_TAB_BY_SEGMENT,
  workshop: "operations",
  checkin: "operations",
  member: "operations",
  piece: "operations",
  firing: "operations",
  event: "operations",
  ops: "operations",
  triage: "triage",
  automation: "automation",
  platform: "platform",
  moduletelemetry: "moduleTelemetry",
  module_telemetry: "moduleTelemetry",
  policyagentops: "policyAgentOps",
  policy_agent_ops: "policyAgentOps",
  agentops: "policyAgentOps",
  billing: "finance",
  payments: "finance",
  commerce: "finance",
  stripe: "finance",
  finance: "finance",
  system: "platform",
  workshops: "operations",
  reports: "reports",
  ...COCKPIT_MODULE_TAB_BY_KEY,
};

const MODULE_KEY_SET = new Set<ModuleKey>(Object.keys(MODULE_REGISTRY) as ModuleKey[]);

function resolveCockpitNavigationTarget(target: string): CockpitNavigationTarget {
  const normalizedTarget = target.trim().toLowerCase();
  if (!normalizedTarget) {
    return { moduleKey: "cockpit" };
  }
  const mappedTab = COCKPIT_ACTION_TARGET_TAB_BY_KEY[normalizedTarget];
  if (mappedTab) {
    return { moduleKey: "cockpit", tab: mappedTab };
  }
  if (MODULE_KEY_SET.has(normalizedTarget as ModuleKey)) {
    return { moduleKey: normalizedTarget as ModuleKey };
  }
  return { moduleKey: "cockpit" };
}

function resolveCockpitNavigationTargetPath(target: CockpitNavigationTarget): string {
  if (target.tab) {
    return `${STAFF_COCKPIT_PATH}/${COCKPIT_TAB_PATH_SEGMENT[target.tab]}`;
  }
  if (target.moduleKey === "cockpit") {
    return STAFF_COCKPIT_PATH;
  }
  return `${STAFF_COCKPIT_PATH}/${target.moduleKey}`;
}

function isCockpitModuleNavigationTarget(moduleKey: ModuleKey): boolean {
  return moduleKey === "cockpit" || COCKPIT_FLOW_MODULE_KEYS.has(moduleKey);
}

function shouldLoadMemberStats(moduleKey: ModuleKey, cockpitTab: CockpitTabKey): boolean {
  return cockpitTab === "operations" && isCockpitModuleNavigationTarget(moduleKey);
}

function resolveStaffCockpitModuleFromPath(pathname: string): ModuleKey | null {
  const moduleKey = resolveStaffCockpitWorkspaceModule(pathname);
  if (!moduleKey) return null;
  return MODULE_KEY_SET.has(moduleKey as ModuleKey) ? (moduleKey as ModuleKey) : null;
}

function resolveStaffCockpitTabFromPath(pathname: string): CockpitTabKey | undefined {
  const segment = resolveStaffCockpitWorkspaceTabSegment(pathname);
  return segment ? COCKPIT_PATH_TAB_BY_SEGMENT[segment] : undefined;
}

type ModuleUsageStat = {
  visits: number;
  dwellMs: number;
  firstActionMs: number | null;
};

type QueryTrace = { atIso: string; collection: string; params: Record<string, unknown> };
type WriteTrace = { atIso: string; collection: string; docId: string; payload: Record<string, unknown> };
type MemberRoleFilter = "all" | "staff" | "admin" | "member";

type MemberOperationalStats = {
  batches: number | null;
  reservations: number | null;
  eventSignups: number | null;
  materialsOrders: number | null;
  directMessageThreads: number | null;
  libraryLoans: number | null;
};

type MemberSourceStats = {
  usersDocs: number;
  profilesDocs: number;
  inferredMembers: number;
  fallbackCollections: string[];
};

type LibraryPhaseRouteMetrics = {
  route: string;
  requestCount: number;
  errorCount: number;
  conflictCount: number;
  routeErrorCount: number;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
};

type LibraryPhaseMetricsSnapshot = {
  generatedAtIso: string;
  windowMinutes: number;
  requestCount: number;
  errorCount: number;
  conflictCount: number;
  routeErrorCount: number;
  errorRate: number;
  conflictRate: number;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  maxLatencyMs: number | null;
  endpoints: LibraryPhaseRouteMetrics[];
};

type LibraryPhaseMetricsArtifact = {
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
  endpoints: LibraryPhaseRouteMetrics[];
};

type MemberRecord = {
  id: string;
  displayName: string;
  email: string;
  role: string;
  createdAtMs: number;
  updatedAtMs: number;
  lastSeenAtMs: number;
  membershipTier: string;
  kilnPreferences: string;
  rawDoc: Record<string, unknown>;
};

type BatchRecord = {
  id: string;
  title: string;
  ownerUid: string;
  status: string;
  isClosed: boolean;
  updatedAtMs: number;
  currentKilnName: string;
  currentKilnId: string;
};

type BatchPieceRecord = {
  id: string;
  pieceCode: string;
  shortDesc: string;
  stage: string;
  wareCategory: string;
  isArchived: boolean;
  updatedAtMs: number;
};

type BatchTimelineRecord = {
  id: string;
  type: string;
  actorName: string;
  kilnName: string;
  notes: string;
  atMs: number;
};

type FiringRecord = {
  id: string;
  title: string;
  kilnName: string;
  kilnId: string;
  status: string;
  cycleType: string;
  confidence: string;
  startAtMs: number;
  endAtMs: number;
  unloadedAtMs: number;
  batchCount: number;
  pieceCount: number;
  notes: string;
  updatedAtMs: number;
};

type EventRecord = {
  id: string;
  title: string;
  status: string;
  startAt: string;
  startAtMs: number;
  endAtMs: number;
  remainingCapacity: number;
  capacity: number;
  waitlistCount: number;
  location: string;
  priceCents: number;
  lastStatusReason: string;
  lastStatusChangedAtMs: number;
};

type WorkshopProgrammingTechnique = {
  key: string;
  label: string;
  keywords: string[];
};

type WorkshopProgrammingCluster = {
  key: string;
  label: string;
  eventCount: number;
  upcomingCount: number;
  waitlistCount: number;
  openSeats: number;
  reviewRequiredCount: number;
  demandScore: number;
  gapScore: number;
  recommendedAction: string;
  topEventTitle: string;
};

type SignupRecord = {
  id: string;
  eventId: string;
  uid: string;
  displayName: string;
  email: string;
  status: string;
  paymentStatus: string;
  createdAtMs: number;
  checkedInAtMs: number;
};

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
  mediaType: string;
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

type LendingCoverReviewRecord = {
  id: string;
  title: string;
  coverUrl: string | null;
  coverQualityStatus: string;
  coverQualityReason: string | null;
  updatedAtMs: number;
  rawDoc: Record<string, unknown>;
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

type CommerceOrderRecord = {
  id: string;
  status: string;
  totalCents: number;
  currency: string;
  updatedAt: string;
  createdAt: string;
  checkoutUrl: string | null;
  pickupNotes: string | null;
  itemCount: number;
};

type UnpaidCheckInRecord = {
  signupId: string;
  eventId: string;
  eventTitle: string;
  amountCents: number | null;
  currency: string | null;
  paymentStatus: string | null;
  checkInMethod: string | null;
  createdAt: string | null;
  checkedInAt: string | null;
};

type ReceiptRecord = {
  id: string;
  type: string;
  title: string;
  amountCents: number;
  currency: string;
  createdAt: string | null;
  paidAt: string | null;
};

type SystemCheckRecord = {
  key: string;
  label: string;
  ok: boolean;
  atMs: number;
  details: string;
};
type AutomationWorkflowSource = {
  key: string;
  label: string;
  workflowFile: string;
  outputHint: string;
};
type AutomationIssueSource = {
  key: string;
  title: string;
  issueNumber: number;
  purpose: string;
};
type AutomationWorkflowRun = {
  key: string;
  label: string;
  workflowFile: string;
  outputHint: string;
  runId: number;
  runUrl: string;
  status: string;
  conclusion: string;
  createdAtMs: number;
  updatedAtMs: number;
  headSha: string;
  event: string;
  isStale: boolean;
  error: string;
};
type AutomationIssueThread = {
  key: string;
  title: string;
  issueNumber: number;
  issueUrl: string;
  purpose: string;
  state: string;
  updatedAtMs: number;
  latestCommentAtMs: number;
  latestCommentUrl: string;
  latestCommentPreview: string;
  error: string;
};
type AutomationDashboardState = {
  loading: boolean;
  loadedAtMs: number;
  error: string;
  workflows: AutomationWorkflowRun[];
  issues: AutomationIssueThread[];
};
type StudioBrainStatus = {
  checkedAt: string;
  mode: "healthy" | "degraded" | "offline" | "disabled" | "unknown";
  healthOk: boolean;
  readyOk: boolean;
  snapshotAgeMinutes: number | null;
  reasonCode: string;
  lastKnownGoodAt: string | null;
  signalAgeMinutes: number | null;
  reason: string;
};
type BatchArtifactCategory =
  | "fixture_like"
  | "stale_closed"
  | "orphan_owner"
  | "state_mismatch"
  | "active_recent"
  | "unclassified";
type BatchArtifactConfidence = "high" | "medium" | "low";
type BatchArtifactDispositionHint = "delete" | "archive" | "retain" | "merge" | "manual_review";
type BatchArtifactTriageRecord = {
  batchId: string;
  title: string;
  status: string;
  ownerUid: string;
  isClosed: boolean;
  updatedAtMs: number;
  ageDays: number | null;
  likelyArtifact: boolean;
  category: BatchArtifactCategory;
  confidence: BatchArtifactConfidence;
  dispositionHints: BatchArtifactDispositionHint[];
  rationale: string[];
  riskFlags: string[];
};
type BatchCleanupSelectionMode = "high_confidence_artifacts" | "all_likely_artifacts" | "current_filter_artifacts";
type BatchCleanupAudit = {
  runId: string;
  generatedAt: string;
  operatorUid: string;
  operatorEmail: string | null;
  operatorRole: string;
  source: "staff_console";
  reasonCode: string;
  reason: string;
  ticketRefs: string[];
  confirmationPhrase: string;
};
type BatchCleanupTarget = {
  batchId: string;
  title: string;
  status: string;
  ownerUid: string;
  isClosed: boolean;
  updatedAtMs: number;
  category: BatchArtifactCategory;
  confidence: BatchArtifactConfidence;
  dispositionHints: BatchArtifactDispositionHint[];
  rationale: string[];
  riskFlags: string[];
};
type BatchCleanupPayload = {
  mode: "preview" | "destructive";
  dryRun: boolean;
  backendDispatchRequested: boolean;
  previewOnly: boolean;
  selectionMode: BatchCleanupSelectionMode;
  selectedCount: number;
  selectedBatchIds: string[];
  countsByCategory: Record<string, number>;
  countsByConfidence: Record<string, number>;
  countsByDispositionHint: Record<string, number>;
  audit: BatchCleanupAudit;
  targets: BatchCleanupTarget[];
};
type BatchActionName =
  | "shelveBatch"
  | "kilnLoad"
  | "kilnUnload"
  | "readyForPickup"
  | "pickedUpAndClose"
  | "continueJourney";

type TodayReservationRow = {
  id: string;
  ownerUid: string;
  displayName: string;
  timeMs: number;
  status: string;
  itemCount: number;
  visitType: string;
  notes: string;
};

type TodayPaymentAlert = {
  id: string;
  severity: "P0" | "P1";
  title: string;
  detail: string;
};

const MODULES: Array<{ key: ModuleKey; label: string; owner: string; testId: string }> = (
  Object.keys(MODULE_REGISTRY) as ModuleKey[]
)
  .filter((key) => MODULE_REGISTRY[key].nav)
  .map((key) => ({
    key,
    label: MODULE_REGISTRY[key].label,
    owner: MODULE_REGISTRY[key].owner,
    testId: MODULE_REGISTRY[key].testId,
  }));

const GITHUB_REPO_OWNER = "monsoonfirepottery-byte";
const GITHUB_REPO_NAME = "monsoonfire-portal";
const GITHUB_REPO_SLUG = `${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}`;
const GITHUB_API_BASE = `https://api.github.com/repos/${GITHUB_REPO_SLUG}`;
const AUTOMATION_STALE_MS = 36 * 60 * 60 * 1000;
const TODAY_RESERVATION_LIMIT = 10;
const TODAY_MESSAGE_LIMIT = 8;
const TODAY_ALERT_LIMIT = 8;
const MAX_FIRING_PHOTO_BYTES = 10 * 1024 * 1024;
const BATCH_ARTIFACT_KEYWORD = /\b(test|qa|dev|seed|fixture|sample|demo|playwright|mock|canary|staging|tmp|temp)\b/i;
const BATCH_STALE_CLOSED_DAYS = 120;
const BATCH_STALE_OPEN_DAYS = 30;
const STUDIO_BRAIN_SIGNAL_STALE_MINUTES = 12;
const STUDIO_BRAIN_OFFLINE_CONFIRM_MINUTES = 45;
let storageEmulatorConnected = false;
const AUTOMATION_WORKFLOW_SOURCES: AutomationWorkflowSource[] = [
  {
    key: "automationHealth",
    label: "Automation Health Daily",
    workflowFile: "portal-automation-health-daily.yml",
    outputHint: "health dashboard + issue loop artifacts",
  },
  {
    key: "automationWeeklyDigest",
    label: "Automation Weekly Digest",
    workflowFile: "portal-automation-weekly-digest.yml",
    outputHint: "weekly trend markdown/json digest",
  },
  {
    key: "canary",
    label: "Daily Authenticated Canary",
    workflowFile: "portal-daily-authenticated-canary.yml",
    outputHint: "canary report + adaptive feedback profile",
  },
  {
    key: "indexGuard",
    label: "Firestore Index Guard",
    workflowFile: "firestore-index-contract-guard.yml",
    outputHint: "index guard + auto-remediation profile",
  },
  {
    key: "promotionGate",
    label: "Post-Deploy Promotion Gate",
    workflowFile: "portal-post-deploy-promotion-gate.yml",
    outputHint: "promotion gate + adaptive scope profile",
  },
  {
    key: "prodSmoke",
    label: "Production Smoke",
    workflowFile: "portal-prod-smoke.yml",
    outputHint: "smoke run + retry-memory profile",
  },
  {
    key: "prFunctional",
    label: "PR Functional Gate",
    workflowFile: "portal-pr-functional-gate.yml",
    outputHint: "emulator gate + remediation profile",
  },
];
const AUTOMATION_ISSUE_SOURCES: AutomationIssueSource[] = [
  {
    key: "thresholdTuning",
    title: "Portal Automation Threshold Tuning (Rolling)",
    issueNumber: 115,
    purpose: "loop threshold recommendations",
  },
  {
    key: "weeklyDigest",
    title: "Portal Automation Weekly Digest (Rolling)",
    issueNumber: 116,
    purpose: "weekly trend digest for loops",
  },
  {
    key: "canaryRolling",
    title: "Portal Authenticated Canary Failures (Rolling)",
    issueNumber: 85,
    purpose: "canary incident history and directives",
  },
];
const WORKSHOP_PROGRAMMING_TECHNIQUES: WorkshopProgrammingTechnique[] = [
  {
    key: "wheel-throwing",
    label: "Wheel throwing",
    keywords: ["wheel", "throw", "centering", "trim", "cylinder"],
  },
  {
    key: "handbuilding",
    label: "Handbuilding",
    keywords: ["handbuild", "slab", "coil", "pinch", "construction"],
  },
  {
    key: "surface-decoration",
    label: "Surface decoration",
    keywords: ["surface", "carv", "sgraffito", "underglaze", "texture", "slip"],
  },
  {
    key: "glazing-firing",
    label: "Glazing + firing",
    keywords: ["glaze", "firing", "kiln", "raku", "cone", "reduction"],
  },
  {
    key: "studio-practice",
    label: "Studio practice",
    keywords: ["studio", "workflow", "practice", "production", "critique"],
  },
];

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function firstNonBlankString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown): boolean {
  return value === true;
}

const LIBRARY_PHASE_METRICS_WINDOW_MINUTES = 180;
const LIBRARY_PHASE_METRICS_MAX_ENTRIES = 400;
const LIBRARY_PHASE_CRITICAL_ROUTES = [
  "/v1/library.items.list",
  "/v1/library.discovery.get",
  "/v1/library.items.get",
  "/v1/library.loans.checkout",
  "/v1/library.loans.checkIn",
  "/v1/library.reviews.create",
];

function telemetryRouteKey(endpoint: string): string | null {
  const raw = endpoint.trim();
  if (!raw) return null;
  const withoutQuery = raw.split("?")[0] ?? raw;
  const marker = "v1/library.";
  const lower = withoutQuery.toLowerCase();
  const markerIndex = lower.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = markerIndex > 0 && withoutQuery[markerIndex - 1] === "/" ? markerIndex - 1 : markerIndex;
  const route = withoutQuery.slice(start);
  return route.startsWith("/v1/library.") ? route : `/${route}`;
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const clamped = Math.max(0, Math.min(1, p));
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(clamped * sorted.length) - 1));
  const value = sorted[index];
  return Number.isFinite(value) ? value : null;
}

function buildLibraryPhaseMetricsSnapshot(
  rows: RequestTelemetry[],
  nowMs = Date.now(),
  windowMinutes = LIBRARY_PHASE_METRICS_WINDOW_MINUTES
): LibraryPhaseMetricsSnapshot {
  const cutoffMs = nowMs - windowMinutes * 60_000;
  const bucket = new Map<string, {
    requestCount: number;
    errorCount: number;
    conflictCount: number;
    routeErrorCount: number;
    latencies: number[];
  }>();
  let requestCount = 0;
  let errorCount = 0;
  let conflictCount = 0;
  let routeErrorCount = 0;
  const latencySamples: number[] = [];

  for (const row of rows) {
    const route = telemetryRouteKey(row.endpoint);
    if (!route) continue;
    const atMs = Date.parse(row.atIso);
    if (!Number.isFinite(atMs) || atMs < cutoffMs) continue;

    const status = typeof row.status === "number" && Number.isFinite(row.status) ? Math.trunc(row.status) : 0;
    const isError = row.ok === false || status >= 400;
    const isConflict = status === 409;
    const isRouteError = status === 404;
    const durationMs =
      typeof row.durationMs === "number" && Number.isFinite(row.durationMs) && row.durationMs >= 0
        ? Math.round(row.durationMs)
        : null;

    requestCount += 1;
    if (isError) errorCount += 1;
    if (isConflict) conflictCount += 1;
    if (isRouteError) routeErrorCount += 1;
    if (durationMs !== null) latencySamples.push(durationMs);

    const current = bucket.get(route) ?? {
      requestCount: 0,
      errorCount: 0,
      conflictCount: 0,
      routeErrorCount: 0,
      latencies: [],
    };
    current.requestCount += 1;
    if (isError) current.errorCount += 1;
    if (isConflict) current.conflictCount += 1;
    if (isRouteError) current.routeErrorCount += 1;
    if (durationMs !== null) current.latencies.push(durationMs);
    bucket.set(route, current);
  }

  const endpoints = Array.from(bucket.entries())
    .map(([route, value]) => ({
      route,
      requestCount: value.requestCount,
      errorCount: value.errorCount,
      conflictCount: value.conflictCount,
      routeErrorCount: value.routeErrorCount,
      p50LatencyMs: percentile(value.latencies, 0.5),
      p95LatencyMs: percentile(value.latencies, 0.95),
    }))
    .sort((a, b) => b.requestCount - a.requestCount);

  for (const route of LIBRARY_PHASE_CRITICAL_ROUTES) {
    if (endpoints.some((entry) => entry.route === route)) continue;
    endpoints.push({
      route,
      requestCount: 0,
      errorCount: 0,
      conflictCount: 0,
      routeErrorCount: 0,
      p50LatencyMs: null,
      p95LatencyMs: null,
    });
  }

  const denominator = requestCount > 0 ? requestCount : 1;
  return {
    generatedAtIso: new Date(nowMs).toISOString(),
    windowMinutes,
    requestCount,
    errorCount,
    conflictCount,
    routeErrorCount,
    errorRate: Number((errorCount / denominator).toFixed(4)),
    conflictRate: Number((conflictCount / denominator).toFixed(4)),
    p50LatencyMs: percentile(latencySamples, 0.5),
    p95LatencyMs: percentile(latencySamples, 0.95),
    maxLatencyMs: latencySamples.length > 0 ? Math.max(...latencySamples) : null,
    endpoints,
  };
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

function libraryRolloutPhaseLabel(phase: LibraryRolloutPhase): string {
  if (phase === "phase_1_read_only") return "Phase 1";
  if (phase === "phase_2_member_writes") return "Phase 2";
  return "Phase 3";
}

function libraryRolloutMemberWritesEnabledForPhase(phase: LibraryRolloutPhase): boolean {
  return phase !== "phase_1_read_only";
}

function shouldBlockLibraryFallback(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const row = error as {
    kind?: unknown;
    statusCode?: unknown;
    code?: unknown;
    message?: unknown;
    debugMessage?: unknown;
  };
  const kind = str(row.kind).toLowerCase();
  const statusCode =
    typeof row.statusCode === "number" && Number.isFinite(row.statusCode) ? Math.trunc(row.statusCode) : 0;
  const code = str(row.code).toLowerCase();
  const message = `${str(row.message)} ${str(row.debugMessage)}`.toLowerCase();

  if (kind === "auth") return true;
  if (statusCode === 401 || statusCode === 403) return true;
  if (code === "unauthenticated" || code === "permission_denied" || code === "forbidden" || code === "unauthorized") {
    return true;
  }
  if (code.includes("rollout") || code.includes("phase") || code.includes("writes_disabled")) {
    return true;
  }
  if (message.includes("rollout") && (message.includes("phase") || message.includes("disabled") || message.includes("paused"))) {
    return true;
  }
  return false;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function toTsMs(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (value && typeof value === "object") {
    const maybe = value as { toMillis?: () => number; seconds?: number; nanoseconds?: number };
    if (typeof maybe.toMillis === "function") return maybe.toMillis();
    if (typeof maybe.seconds === "number") {
      return Math.floor(maybe.seconds * 1000 + (typeof maybe.nanoseconds === "number" ? maybe.nanoseconds : 0) / 1_000_000);
    }
  }
  return 0;
}

function getLocalDayBoundsMs(reference = Date.now()) {
  const start = new Date(reference);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return {
    startMs: start.getTime(),
    endMs: end.getTime(),
    startDate: start,
    endDate: end,
  };
}

function reservationStatusLabel(value: unknown): string {
  const status = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!status) return "REQUESTED";
  if (status === "CONFIRMED" || status === "WAITLISTED" || status === "CANCELLED") return status;
  return status;
}

function reservationVisitTypeLabel(record: ReservationRecord): string {
  const mode = typeof record.intakeMode === "string" ? record.intakeMode.trim().toUpperCase() : "";
  if (mode === "WHOLE_KILN") return "Whole kiln";
  if (mode === "COMMUNITY_SHELF") return "Community shelf";
  if (mode === "SHELF_PURCHASE") return "Per-shelf purchase";
  return "Check-in";
}

function toShortTimeLabel(valueMs: number): string {
  if (!valueMs) return "Time TBD";
  try {
    return new Date(valueMs).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "Time TBD";
  }
}

function toFileExtension(file: File): string {
  const name = file.name || "";
  const idx = name.lastIndexOf(".");
  if (idx > -1 && idx < name.length - 1) {
    return name.slice(idx + 1).toLowerCase();
  }
  const type = file.type || "";
  if (type.includes("png")) return "png";
  if (type.includes("webp")) return "webp";
  return "jpg";
}

function readTimestampMs(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const candidate = value as { toMillis?: () => number; toDate?: () => Date; seconds?: number };
  if (typeof candidate.toMillis === "function") {
    const ms = candidate.toMillis();
    return Number.isFinite(ms) ? ms : 0;
  }
  if (typeof candidate.toDate === "function") {
    const date = candidate.toDate();
    const ms = date.getTime();
    return Number.isFinite(ms) ? ms : 0;
  }
  if (typeof candidate.seconds === "number" && Number.isFinite(candidate.seconds)) {
    return Math.floor(candidate.seconds * 1000);
  }
  return 0;
}

function isDirectMessageUnread(thread: DirectMessageThread, uid: string): boolean {
  const lastMessageMs = readTimestampMs(thread.lastMessageAt);
  if (!lastMessageMs) return false;
  const lastReadMs = readTimestampMs(thread.lastReadAtByUid?.[uid]);
  if (!lastReadMs) return true;
  return lastMessageMs > lastReadMs;
}

function resolveStorageForStaffToday() {
  const storage = getStorage();
  const env = (import.meta.env ?? {}) as {
    DEV?: boolean;
    VITE_USE_EMULATORS?: string;
    VITE_STORAGE_EMULATOR_HOST?: string;
    VITE_STORAGE_EMULATOR_PORT?: string;
  };
  const devMode = typeof import.meta !== "undefined" && Boolean(env.DEV);
  if (
    devMode &&
    env.VITE_USE_EMULATORS === "true" &&
    !storageEmulatorConnected
  ) {
    const host = env.VITE_STORAGE_EMULATOR_HOST || "127.0.0.1";
    const portRaw = env.VITE_STORAGE_EMULATOR_PORT || "9199";
    const port = Number(portRaw);
    if (Number.isFinite(port)) {
      connectStorageEmulator(storage, host, port);
      storageEmulatorConnected = true;
    }
  }
  return storage;
}

function toIsoMs(value: unknown): number {
  if (typeof value !== "string") return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function shortText(value: string, max = 220): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 3)).trim()}...`;
}

function commentPreview(body: string): string {
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("##"));
  if (lines.length === 0) return "";
  const bullet = lines.find((line) => line.startsWith("- "));
  return shortText((bullet || lines[0]).replace(/^-\s+/, ""));
}

function when(ms: number): string {
  if (!ms) return "-";
  return new Date(ms).toLocaleString();
}

function dollars(cents: number): string {
  return `$${(Math.max(cents, 0) / 100).toFixed(2)}`;
}

function parseList(input: string): string[] {
  return input
    .split(/[\n,]/g)
    .map((v) => v.trim())
    .filter(Boolean);
}

function cleanIsbnToken(raw: string): string {
  return raw.replace(/[^0-9xX]/g, "").toUpperCase();
}

function parseUniqueCsv(input: string): string[] {
  return Array.from(new Set(parseList(input).map((value) => value.trim()).filter(Boolean)));
}

function inferIsbnVariants(raw: string): { primary: string; isbn10: string | null; isbn13: string | null } {
  const cleaned = cleanIsbnToken(raw);
  if (!cleaned) return { primary: "", isbn10: null, isbn13: null };
  if (cleaned.length === 10) return { primary: cleaned, isbn10: cleaned, isbn13: null };
  if (cleaned.length === 13) return { primary: cleaned, isbn10: null, isbn13: cleaned };
  return { primary: cleaned, isbn10: null, isbn13: null };
}

function makeEmptyLendingAdminItemDraft(): LendingAdminItemDraft {
  return {
    title: "",
    subtitle: "",
    authorsCsv: "",
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
    subjectsCsv: "",
    techniquesCsv: "",
  };
}

function normalizeLendingAdminItemRecord(
  fallbackId: string,
  raw: Record<string, unknown>
): LendingAdminItemRecord {
  const identifiers = record(raw.identifiers);
  const authors = Array.isArray(raw.authors)
    ? raw.authors.filter((entry): entry is string => typeof entry === "string")
    : [];
  const authorLine =
    authors.length > 0
      ? authors.join(", ")
      : firstNonBlankString(raw.author, raw.authorName, raw.byline) || "Unknown author";
  const isbn10 = firstNonBlankString(raw.isbn10, identifiers.isbn10);
  const isbn13 = firstNonBlankString(raw.isbn13, identifiers.isbn13);
  const isbn = firstNonBlankString(raw.isbn, raw.isbn_normalized, isbn13, isbn10);
  const title = firstNonBlankString(raw.title, raw.itemTitle, raw.bookTitle);
  const id = firstNonBlankString(raw.id, raw.itemId, fallbackId) || fallbackId;
  const totalCopies = Math.max(
    0,
    num(raw.totalCopies, num(raw.total_copies, num(raw.copiesTotal, 1)))
  );
  const availableCopies = Math.max(
    0,
    num(raw.availableCopies, num(raw.available_copies, num(raw.copiesAvailable, totalCopies)))
  );
  return {
    id,
    title: title || "Library item",
    authorLine,
    isbn,
    isbn10,
    isbn13,
    mediaType: firstNonBlankString(raw.mediaType, raw.type) || "book",
    status: firstNonBlankString(raw.status) || "available",
    source: firstNonBlankString(raw.source) || "manual",
    totalCopies,
    availableCopies: Math.min(availableCopies, totalCopies),
    updatedAtMs: maxMs(toTsMs(raw.updatedAt), toTsMs(raw.updatedAtIso), toTsMs(raw.createdAt)),
    rawDoc: raw,
  };
}

function buildLendingAdminDraftFromItem(item: LendingAdminItemRecord): LendingAdminItemDraft {
  const raw = item.rawDoc;
  const identifiers = record(raw.identifiers);
  const authors = Array.isArray(raw.authors)
    ? raw.authors.filter((entry): entry is string => typeof entry === "string")
    : [];
  const subjects = Array.isArray(raw.subjects)
    ? raw.subjects.filter((entry): entry is string => typeof entry === "string")
    : [];
  const techniques = Array.isArray(raw.techniques)
    ? raw.techniques.filter((entry): entry is string => typeof entry === "string")
    : [];
  return {
    title: item.title,
    subtitle: firstNonBlankString(raw.subtitle),
    authorsCsv: authors.length > 0 ? authors.join(", ") : item.authorLine,
    description: firstNonBlankString(raw.description),
    publisher: firstNonBlankString(raw.publisher),
    publishedDate: firstNonBlankString(raw.publishedDate),
    isbn: firstNonBlankString(raw.isbn, raw.isbn_normalized, raw.isbn13, raw.isbn10, identifiers.isbn13, identifiers.isbn10),
    mediaType: firstNonBlankString(raw.mediaType, raw.type, item.mediaType) || "book",
    format: firstNonBlankString(raw.format),
    coverUrl: firstNonBlankString(raw.coverUrl),
    totalCopies: String(Math.max(1, item.totalCopies || 1)),
    availableCopies: String(Math.max(0, Math.min(item.availableCopies || 0, item.totalCopies || 1))),
    status: firstNonBlankString(raw.status, item.status) || "available",
    source: firstNonBlankString(raw.source, item.source) || "manual",
    subjectsCsv: subjects.join(", "),
    techniquesCsv: techniques.join(", "),
  };
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

function isValidHttpUrl(value: string): boolean {
  if (!value.trim()) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function inferWorkshopProgrammingTechnique(title: string): WorkshopProgrammingTechnique {
  const normalized = title.trim().toLowerCase();
  if (!normalized) return WORKSHOP_PROGRAMMING_TECHNIQUES[WORKSHOP_PROGRAMMING_TECHNIQUES.length - 1];
  const matched = WORKSHOP_PROGRAMMING_TECHNIQUES.find((technique) =>
    technique.keywords.some((keyword) => normalized.includes(keyword))
  );
  return matched ?? WORKSHOP_PROGRAMMING_TECHNIQUES[WORKSHOP_PROGRAMMING_TECHNIQUES.length - 1];
}

function normalizeBatchState(status: string): string {
  return status.trim().toUpperCase().replace(/\s+/g, "_");
}

function memberRole(data: Record<string, unknown>): string {
  const fallbackRole = [
    str(data.role),
    str(data.userRole),
    str(data.memberRole),
    str(data.staffRole),
    str(data.profileRole),
    str(data.accountRole),
  ].find((value) => value.trim().length > 0);

  return parseStaffRole({
    claims: data.claims ?? data.customClaims ?? data.authClaims,
    fallbackRole,
  }).role;
}

function deriveMembershipTier(data: Record<string, unknown>, role: string): string {
  if (role === "admin") return "Admin";
  if (role === "staff") return "Staff";
  const membership = record(data.membership);
  const membershipPlan = record(membership.plan);
  const subscription = record(data.subscription);
  const profile = record(data.profile);

  const explicit = [
    str(data.membershipTier),
    str(data.membership),
    str(data.membershipType),
    str(data.memberType),
    str(data.planTier),
    str(data.tier),
    str(membership.tier),
    str(membership.level),
    str(membership.type),
    str(membership.name),
    str(membershipPlan.tier),
    str(membershipPlan.name),
    str(subscription.tier),
    str(subscription.plan),
    str(subscription.planName),
    str(profile.membershipTier),
    str(profile.memberType),
  ].find((value) => value.trim().length > 0);
  if (explicit) return explicit;
  return "Studio Member";
}

function toReasonCode(input: string, fallback: string): string {
  const normalized = input
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || fallback;
}

function classifyBatchArtifact(batch: BatchRecord, nowMs: number): BatchArtifactTriageRecord {
  const normalizedStatus = normalizeBatchState(batch.status);
  const haystack = `${batch.title} ${batch.id} ${batch.ownerUid} ${batch.status}`.toLowerCase();
  const keywordMatch = BATCH_ARTIFACT_KEYWORD.test(haystack);
  const missingOwner = batch.ownerUid.trim().length === 0;
  const ageDays = batch.updatedAtMs > 0 ? Math.floor(Math.max(0, nowMs - batch.updatedAtMs) / (24 * 60 * 60 * 1000)) : null;
  const staleClosed = batch.isClosed && ageDays !== null && ageDays >= BATCH_STALE_CLOSED_DAYS;
  const staleOpen = !batch.isClosed && ageDays !== null && ageDays >= BATCH_STALE_OPEN_DAYS;
  const closedStatusMismatch =
    batch.isClosed &&
    !(
      normalizedStatus.includes("CLOSE") ||
      normalizedStatus.includes("PICKED") ||
      normalizedStatus.includes("COMPLETE") ||
      normalizedStatus.includes("DONE")
    );
  const openStatusMismatch = !batch.isClosed && (normalizedStatus.includes("CLOSE") || normalizedStatus.includes("COMPLETE"));
  const unknownStatus = normalizedStatus.length === 0 || normalizedStatus === "UNKNOWN";

  const rationale: string[] = [];
  const riskFlags: string[] = [];
  if (keywordMatch) rationale.push("Keyword signature matches fixture/test artifact patterns.");
  if (missingOwner) {
    rationale.push("Missing owner UID.");
    riskFlags.push("owner_missing");
  }
  if (staleClosed) {
    rationale.push(`Closed and stale for ${ageDays} day(s).`);
    riskFlags.push("stale_closed");
  }
  if (staleOpen) {
    rationale.push(`Open and stale for ${ageDays} day(s).`);
    riskFlags.push("stale_open");
  }
  if (closedStatusMismatch || openStatusMismatch) {
    rationale.push("Lifecycle status and isClosed flag are mismatched.");
    riskFlags.push("state_mismatch");
  }
  if (unknownStatus) {
    rationale.push("Status is unknown.");
    riskFlags.push("status_unknown");
  }
  if (ageDays === null) {
    rationale.push("Missing updated timestamp.");
    riskFlags.push("updated_missing");
  }

  let category: BatchArtifactCategory = "active_recent";
  let confidence: BatchArtifactConfidence = "low";
  let dispositionHints: BatchArtifactDispositionHint[] = ["retain"];

  if (keywordMatch && (staleClosed || missingOwner || unknownStatus)) {
    category = "fixture_like";
    confidence = "high";
    dispositionHints = ["delete", "archive", "manual_review"];
  } else if (missingOwner && staleClosed) {
    category = "orphan_owner";
    confidence = "high";
    dispositionHints = ["archive", "manual_review"];
  } else if (missingOwner) {
    category = "orphan_owner";
    confidence = "medium";
    dispositionHints = ["manual_review", "archive"];
  } else if (staleClosed) {
    category = "stale_closed";
    confidence = keywordMatch ? "high" : "medium";
    dispositionHints = ["archive", "retain", "manual_review"];
  } else if (closedStatusMismatch || openStatusMismatch || unknownStatus || staleOpen) {
    category = "state_mismatch";
    confidence = keywordMatch || staleOpen ? "medium" : "low";
    dispositionHints = ["manual_review", "merge", "retain"];
  } else if (keywordMatch) {
    category = "fixture_like";
    confidence = "medium";
    dispositionHints = ["manual_review", "retain", "archive"];
  } else if (ageDays === null) {
    category = "unclassified";
    confidence = "low";
    dispositionHints = ["manual_review", "retain"];
  }

  const likelyArtifact = category === "fixture_like" || category === "stale_closed" || category === "orphan_owner";
  return {
    batchId: batch.id,
    title: batch.title,
    status: batch.status,
    ownerUid: batch.ownerUid,
    isClosed: batch.isClosed,
    updatedAtMs: batch.updatedAtMs,
    ageDays,
    likelyArtifact,
    category,
    confidence,
    dispositionHints,
    rationale,
    riskFlags,
  };
}

function buildBatchCleanupPreviewLog(payload: BatchCleanupPayload): string {
  const lines: string[] = [];
  lines.push(`mode: ${payload.mode}`);
  lines.push(`dryRun: ${payload.dryRun ? "true" : "false"}`);
  lines.push(`previewOnly: ${payload.previewOnly ? "true" : "false"}`);
  lines.push(`backendDispatchRequested: ${payload.backendDispatchRequested ? "true" : "false"}`);
  lines.push(`selectionMode: ${payload.selectionMode}`);
  lines.push(`selectedCount: ${payload.selectedCount}`);
  lines.push(`reasonCode: ${payload.audit.reasonCode}`);
  lines.push(`reason: ${payload.audit.reason}`);
  lines.push(`operatorUid: ${payload.audit.operatorUid}`);
  lines.push(`operatorEmail: ${payload.audit.operatorEmail || "-"}`);
  lines.push(`ticketRefs: ${payload.audit.ticketRefs.join(", ") || "-"}`);
  lines.push(`generatedAt: ${payload.audit.generatedAt}`);
  lines.push("countsByCategory:");
  Object.entries(payload.countsByCategory)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([key, value]) => lines.push(`  ${key}: ${value}`));
  lines.push("countsByConfidence:");
  Object.entries(payload.countsByConfidence)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([key, value]) => lines.push(`  ${key}: ${value}`));
  lines.push("targets:");
  payload.targets.slice(0, 30).forEach((target) => {
    lines.push(
      `  - ${target.batchId} | ${target.category}/${target.confidence} | hints=${target.dispositionHints.join("+")} | status=${target.status} | owner=${target.ownerUid || "-"}`
    );
  });
  if (payload.targets.length > 30) {
    lines.push(`  ... ${payload.targets.length - 30} additional target(s) truncated`);
  }
  return lines.join("\n");
}

function maxMs(...values: number[]): number {
  return values.reduce((acc, value) => (value > acc ? value : acc), 0);
}

function moduleUsageSeed(): Record<ModuleKey, ModuleUsageStat> {
  return (Object.keys(MODULE_REGISTRY) as ModuleKey[]).reduce(
    (acc, key) => {
      acc[key] = { visits: 0, dwellMs: 0, firstActionMs: null };
      return acc;
    },
    {} as Record<ModuleKey, ModuleUsageStat>
  );
}

function loadModuleUsageSnapshot(): Record<ModuleKey, ModuleUsageStat> {
  const seed = moduleUsageSeed();
  if (typeof window === "undefined") return seed;
  try {
    const raw = window.localStorage.getItem(STAFF_MODULE_USAGE_STORAGE_KEY);
    if (!raw) return seed;
    const parsed = JSON.parse(raw) as unknown;
    let source: Record<string, Partial<ModuleUsageStat>> = {};
    let savedAtIso = "";
    if (parsed && typeof parsed === "object" && "moduleUsage" in parsed) {
      const next = parsed as { moduleUsage?: Record<string, Partial<ModuleUsageStat>>; savedAtIso?: string };
      source = next.moduleUsage && typeof next.moduleUsage === "object" ? next.moduleUsage : {};
      savedAtIso = typeof next.savedAtIso === "string" ? next.savedAtIso : "";
    } else if (parsed && typeof parsed === "object") {
      source = parsed as Record<string, Partial<ModuleUsageStat>>;
    }
    const savedAtMs = savedAtIso ? Date.parse(savedAtIso) : 0;
    const ageDays = savedAtMs > 0 ? Math.floor(Math.max(0, Date.now() - savedAtMs) / (24 * 60 * 60 * 1000)) : 0;
    const decay = ageDays > 0 ? Math.max(0.35, Math.pow(0.95, ageDays)) : 1;
    (Object.keys(seed) as ModuleKey[]).forEach((key) => {
      const next = source?.[key];
      if (!next) return;
      const visits = Number(next.visits);
      const dwellMs = Number(next.dwellMs);
      const firstActionMs = next.firstActionMs;
      seed[key] = {
        visits: Number.isFinite(visits) && visits > 0 ? Math.floor(visits * decay) : 0,
        dwellMs: Number.isFinite(dwellMs) && dwellMs > 0 ? Math.floor(dwellMs * decay) : 0,
        firstActionMs:
          typeof firstActionMs === "number" && Number.isFinite(firstActionMs) && firstActionMs >= 0
            ? Math.floor(firstActionMs)
            : null,
      };
    });
    return seed;
  } catch {
    return seed;
  }
}

function loadAdaptiveNavPreference(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(STAFF_ADAPTIVE_NAV_STORAGE_KEY);
    if (raw === "false" || raw === "0") return false;
    if (raw === "true" || raw === "1") return true;
    return true;
  } catch {
    return true;
  }
}

export default function StaffView({
  user,
  isStaff,
  devAdminToken,
  onDevAdminTokenChange,
  devAdminEnabled,
  showEmulatorTools,
  onOpenCheckin,
  onOpenReservation,
  onOpenMessages,
  onOpenMessageThread,
  onOpenFirings,
  onStartFiring,
  onOpenStaffWorkspace,
  initialModule = "cockpit",
  forceCockpitWorkspace = false,
  messageThreads = [],
  messageThreadsLoading = false,
  messageThreadsError = "",
  announcements = [],
  announcementsLoading = false,
  announcementsError = "",
  unreadAnnouncements = 0,
}: Props) {
  const initialCockpitModule = useMemo<ModuleKey | null>(() => {
    if (typeof window === "undefined") return null;
    const requestedPath =
      resolveStaffWorkspaceRequestedPath(window.location.pathname, window.location.hash) ??
      window.location.pathname;
    return resolveStaffCockpitModuleFromPath(requestedPath);
  }, []);
  const initialCockpitTab = useMemo<CockpitTabKey | undefined>(() => {
    if (typeof window === "undefined") return undefined;
    const requestedPath =
      resolveStaffWorkspaceRequestedPath(window.location.pathname, window.location.hash) ??
      window.location.pathname;
    return resolveStaffCockpitTabFromPath(requestedPath);
  }, []);
  const resolvedInitialCockpitModule = initialCockpitModule
    ? COCKPIT_MODULE_TAB_BY_KEY[initialCockpitModule]
      ? "cockpit"
      : initialCockpitModule
    : initialModule;
  const resolvedInitialCockpitTab = initialCockpitTab ?? (initialCockpitModule ? COCKPIT_MODULE_TAB_BY_KEY[initialCockpitModule] : undefined);
  const [moduleKey, setModuleKey] = useState<ModuleKey>(resolvedInitialCockpitModule);
  const [moduleUsage, setModuleUsage] = useState<Record<ModuleKey, ModuleUsageStat>>(() => loadModuleUsageSnapshot());
  const [adaptiveNavEnabled, setAdaptiveNavEnabled] = useState<boolean>(() => loadAdaptiveNavPreference());
  const moduleSessionRef = useRef<{ key: ModuleKey; enteredAtMs: number } | null>(null);
  const moduleContentRef = useRef<HTMLDivElement | null>(null);
  const hasDevAdminAuthority = devAdminEnabled && devAdminToken.trim().length > 0;
  const hasStaffAuthority = isStaff || hasDevAdminAuthority;
  const staffAuthorityLabel = isStaff
    ? "Staff claim"
    : hasDevAdminAuthority
      ? "Dev admin token"
      : "No staff authority";
  const isCockpitModule = isCockpitModuleNavigationTarget(moduleKey);
  const [cockpitWorkspaceMode, setCockpitWorkspaceMode] = useState(true);
  const [cockpitTab, setCockpitTab] = useState<CockpitTabKey>(resolvedInitialCockpitTab ?? "triage");
  const isWorkspaceFocused =
    forceCockpitWorkspace ||
    (isCockpitModule && cockpitWorkspaceMode);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [lastReq, setLastReq] = useState<LastRequest | null>(null);
  const [lastQuery, setLastQuery] = useState<QueryTrace | null>(null);
  const [lastWrite] = useState<WriteTrace | null>(null);
  const [lastErr, setLastErr] = useState<{ atIso: string; message: string; stack: string | null } | null>(null);
  const [handlerLog, setHandlerLog] = useState<Array<{ atIso: string; label: string; message: string }>>(() => getHandlerErrorLog());

  const [users, setUsers] = useState<MemberRecord[]>([]);
  const [batches, setBatches] = useState<BatchRecord[]>([]);
  const [firings, setFirings] = useState<FiringRecord[]>([]);
  const [firingsLoading, setFiringsLoading] = useState(false);
  const [firingsError, setFiringsError] = useState("");
  const [todayReservations, setTodayReservations] = useState<TodayReservationRow[]>([]);
  const [todayReservationsLoading, setTodayReservationsLoading] = useState(false);
  const [todayReservationsError, setTodayReservationsError] = useState("");
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [signups, setSignups] = useState<SignupRecord[]>([]);
  const [summary, setSummary] = useState<{
    unpaidCheckInsCount: number;
    unpaidCheckInsAmountCents: number;
    materialsPendingCount: number;
    materialsPendingAmountCents: number;
    receiptsCount: number;
    receiptsAmountCents: number;
  } | null>(null);
  const [commerceLoading, setCommerceLoading] = useState(false);
  const [commerceError, setCommerceError] = useState("");
  const [todayBootstrapAttempted, setTodayBootstrapAttempted] = useState(false);
  const [orders, setOrders] = useState<CommerceOrderRecord[]>([]);
  const [unpaidCheckIns, setUnpaidCheckIns] = useState<UnpaidCheckInRecord[]>([]);
  const [receipts, setReceipts] = useState<ReceiptRecord[]>([]);
  const [commerceSearch, setCommerceSearch] = useState("");
  const [commerceStatusFilter, setCommerceStatusFilter] = useState("all");
  const [libraryRequests, setLibraryRequests] = useState<LendingRequestRecord[]>([]);
  const [libraryLoans, setLibraryLoans] = useState<LendingLoanRecord[]>([]);
  const [libraryAdminItems, setLibraryAdminItems] = useState<LendingAdminItemRecord[]>([]);
  const [libraryCoverReviews, setLibraryCoverReviews] = useState<LendingCoverReviewRecord[]>([]);
  const [libraryRecommendations, setLibraryRecommendations] = useState<LendingRecommendationRecord[]>([]);
  const [libraryTagSubmissions, setLibraryTagSubmissions] = useState<LendingTagSubmissionRecord[]>([]);
  const [reportOps, setReportOps] = useState({ total: 0, open: 0, highOpen: 0, slaBreaches: 0 });

  const [memberSearch, setMemberSearch] = useState("");
  const [memberRoleFilter, setMemberRoleFilter] = useState<MemberRoleFilter>("all");
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [memberStats, setMemberStats] = useState<MemberOperationalStats | null>(null);
  const [memberStatsBusy, setMemberStatsBusy] = useState(false);
  const [memberStatsError, setMemberStatsError] = useState("");
  const [memberSourceStats, setMemberSourceStats] = useState<MemberSourceStats>({
    usersDocs: 0,
    profilesDocs: 0,
    inferredMembers: 0,
    fallbackCollections: [],
  });
  const [memberEditDraft, setMemberEditDraft] = useState({
    displayName: "",
    membershipTier: "",
    kilnPreferences: "",
    staffNotes: "",
    reason: "",
  });

  const [selectedBatchId, setSelectedBatchId] = useState("");
  const [batchNotes, setBatchNotes] = useState("");
  const [batchSearch, setBatchSearch] = useState("");
  const [batchStatusFilter, setBatchStatusFilter] = useState("all");
  const [batchArtifactFilter, setBatchArtifactFilter] = useState<"all" | "artifact" | "nonArtifact">("all");
  const [batchesTotalCount, setBatchesTotalCount] = useState<number | null>(null);
  const [batchPieces, setBatchPieces] = useState<BatchPieceRecord[]>([]);
  const [batchTimeline, setBatchTimeline] = useState<BatchTimelineRecord[]>([]);
  const [batchDetailBusy, setBatchDetailBusy] = useState(false);
  const [batchDetailError, setBatchDetailError] = useState("");
  const [batchCleanupSelectionMode, setBatchCleanupSelectionMode] = useState<BatchCleanupSelectionMode>(
    "high_confidence_artifacts"
  );
  const [batchCleanupReason, setBatchCleanupReason] = useState("Batch artifact hygiene run from Staff Console.");
  const [batchCleanupReasonCodeInput, setBatchCleanupReasonCodeInput] = useState("ARTIFACT_BATCH_TRIAGE");
  const [batchCleanupTicketRefsInput, setBatchCleanupTicketRefsInput] = useState(
    "P1-staff-console-batch-artifact-triage-and-safe-cleanup"
  );
  const [batchCleanupDispatchMode, setBatchCleanupDispatchMode] = useState<"preview_only" | "attempt_backend">("preview_only");
  const [batchCleanupConfirmPhraseInput, setBatchCleanupConfirmPhraseInput] = useState("");
  const [batchCleanupPreviewPayload, setBatchCleanupPreviewPayload] = useState<BatchCleanupPayload | null>(null);
  const [batchCleanupPreviewLog, setBatchCleanupPreviewLog] = useState("");
  const [kilnId, setKilnId] = useState("studio-electric");
  const [selectedFiringId, setSelectedFiringId] = useState("");
  const [firingPhotoBusy, setFiringPhotoBusy] = useState(false);
  const [firingPhotoStatus, setFiringPhotoStatus] = useState("");
  const [firingPhotoError, setFiringPhotoError] = useState("");
  const [showDeprecatedFiringControls, setShowDeprecatedFiringControls] = useState(false);
  const [firingSearch, setFiringSearch] = useState("");
  const [firingStatusFilter, setFiringStatusFilter] = useState("all");
  const [firingKilnFilter, setFiringKilnFilter] = useState("all");
  const [firingFocusFilter, setFiringFocusFilter] = useState<"all" | "active" | "attention" | "done">("all");
  const [selectedEventId, setSelectedEventId] = useState("");
  const [eventSearch, setEventSearch] = useState("");
  const [eventStatusFilter, setEventStatusFilter] = useState("all");
  const [eventCreateDraft, setEventCreateDraft] = useState({
    title: "",
    location: "Monsoon Fire Studio",
    startAt: "",
    durationMinutes: "120",
    capacity: "12",
    priceCents: "0",
  });
  const [publishOverrideReason, setPublishOverrideReason] = useState("");
  const [eventStatusReason, setEventStatusReason] = useState("");
  const [signupSearch, setSignupSearch] = useState("");
  const [signupStatusFilter, setSignupStatusFilter] = useState("all");
  const [selectedSignupId, setSelectedSignupId] = useState("");
  const [isbnInput, setIsbnInput] = useState("");
  const [isbnScanInput, setIsbnScanInput] = useState("");
  const [isbnImportBusy, setIsbnImportBusy] = useState(false);
  const [isbnImportStatus, setIsbnImportStatus] = useState("");
  const [isbnImportError, setIsbnImportError] = useState("");
  const [isbnScanBusy, setIsbnScanBusy] = useState(false);
  const [isbnScanStatus, setIsbnScanStatus] = useState("");
  const [lendingSearch, setLendingSearch] = useState("");
  const [lendingStatusFilter, setLendingStatusFilter] = useState("all");
  const [lendingFocusFilter, setLendingFocusFilter] = useState<"all" | "requests" | "active" | "overdue" | "returned">("all");
  const [lendingRecommendationFilter, setLendingRecommendationFilter] = useState("all");
  const [selectedRequestId, setSelectedRequestId] = useState("");
  const [selectedLoanId, setSelectedLoanId] = useState("");
  const [selectedAdminItemId, setSelectedAdminItemId] = useState("");
  const [lendingAdminItemSearch, setLendingAdminItemSearch] = useState("");
  const [lendingAdminItemDraft, setLendingAdminItemDraft] = useState<LendingAdminItemDraft>(() =>
    makeEmptyLendingAdminItemDraft()
  );
  const [lendingAdminItemBusy, setLendingAdminItemBusy] = useState(false);
  const [lendingAdminItemStatus, setLendingAdminItemStatus] = useState("");
  const [lendingAdminItemError, setLendingAdminItemError] = useState("");
  const [lendingAdminItemDeleteConfirmInput, setLendingAdminItemDeleteConfirmInput] = useState("");
  const [lendingAdminIsbnResolveBusy, setLendingAdminIsbnResolveBusy] = useState(false);
  const [lendingAdminIsbnResolveStatus, setLendingAdminIsbnResolveStatus] = useState("");
  const [coverReviewDraftById, setCoverReviewDraftById] = useState<Record<string, string>>({});
  const [coverReviewBusyById, setCoverReviewBusyById] = useState<Record<string, boolean>>({});
  const [coverReviewErrorById, setCoverReviewErrorById] = useState<Record<string, string>>({});
  const [coverReviewStatus, setCoverReviewStatus] = useState("");
  const [recommendationModerationBusyById, setRecommendationModerationBusyById] = useState<Record<string, boolean>>({});
  const [recommendationModerationStatus, setRecommendationModerationStatus] = useState("");
  const [tagSubmissionApprovalDraftById, setTagSubmissionApprovalDraftById] = useState<Record<string, string>>({});
  const [tagModerationBusyById, setTagModerationBusyById] = useState<Record<string, boolean>>({});
  const [tagModerationStatus, setTagModerationStatus] = useState("");
  const [tagMergeSourceId, setTagMergeSourceId] = useState("");
  const [tagMergeTargetId, setTagMergeTargetId] = useState("");
  const [tagMergeNote, setTagMergeNote] = useState("");
  const [tagMergeBusy, setTagMergeBusy] = useState(false);
  const [loanRecoveryBusy, setLoanRecoveryBusy] = useState(false);
  const [loanRecoveryStatus, setLoanRecoveryStatus] = useState("");
  const [loanReplacementFeeAmountInput, setLoanReplacementFeeAmountInput] = useState("");
  const [loanOverrideStatusDraft, setLoanOverrideStatusDraft] = useState<
    "available" | "checked_out" | "overdue" | "lost" | "unavailable" | "archived"
  >("available");
  const [loanOverrideNoteDraft, setLoanOverrideNoteDraft] = useState("");
  const [externalLookupProbeQuery, setExternalLookupProbeQuery] = useState("ceramics glaze chemistry");
  const [externalLookupProbeBusy, setExternalLookupProbeBusy] = useState(false);
  const [externalLookupProbeStatus, setExternalLookupProbeStatus] = useState("");
  const [externalLookupProbeProviders, setExternalLookupProbeProviders] = useState<
    Array<{ provider: string; ok: boolean; itemCount: number; cached: boolean; disabled: boolean }>
  >([]);
  const [externalLookupPolicyBusy, setExternalLookupPolicyBusy] = useState(false);
  const [externalLookupPolicyStatus, setExternalLookupPolicyStatus] = useState("");
  const [externalLookupPolicyOpenLibraryEnabled, setExternalLookupPolicyOpenLibraryEnabled] = useState(true);
  const [externalLookupPolicyGoogleBooksEnabled, setExternalLookupPolicyGoogleBooksEnabled] = useState(true);
  const [externalLookupPolicyCoverReviewGuardrailEnabled, setExternalLookupPolicyCoverReviewGuardrailEnabled] =
    useState(true);
  const [externalLookupPolicyNote, setExternalLookupPolicyNote] = useState("");
  const [externalLookupPolicyUpdatedAtMs, setExternalLookupPolicyUpdatedAtMs] = useState(0);
  const [externalLookupPolicyUpdatedByUid, setExternalLookupPolicyUpdatedByUid] = useState("");
  const [libraryRolloutPhaseBusy, setLibraryRolloutPhaseBusy] = useState(false);
  const [libraryRolloutPhaseStatus, setLibraryRolloutPhaseStatus] = useState("");
  const [libraryRolloutPhase, setLibraryRolloutPhase] = useState<LibraryRolloutPhase>("phase_3_admin_full");
  const [libraryRolloutMemberWritesEnabled, setLibraryRolloutMemberWritesEnabled] = useState(true);
  const [libraryRolloutNote, setLibraryRolloutNote] = useState("");
  const [libraryRolloutUpdatedAtMs, setLibraryRolloutUpdatedAtMs] = useState(0);
  const [libraryRolloutUpdatedByUid, setLibraryRolloutUpdatedByUid] = useState("");
  const [libraryPhaseMetricsSnapshot, setLibraryPhaseMetricsSnapshot] = useState<LibraryPhaseMetricsSnapshot | null>(null);
  const [libraryPhaseMetricsStatus, setLibraryPhaseMetricsStatus] = useState("");
  const [systemChecks, setSystemChecks] = useState<SystemCheckRecord[]>([]);
  const [studioBrainStatus, setStudioBrainStatus] = useState<StudioBrainStatus | null>(null);
  const lastStudioBrainModeRef = useRef<StudioBrainStatus["mode"] | null>(null);
  const lastStudioBrainHealthyAtRef = useRef<string | null>(null);
  const [integrationTokenCount, setIntegrationTokenCount] = useState<number | null>(null);
  const [notificationMetricsSummary, setNotificationMetricsSummary] = useState<{
    totalSent?: number;
    totalFailed?: number;
    successRate?: number;
  } | null>(null);
  const [automationDashboard, setAutomationDashboard] = useState<AutomationDashboardState>({
    loading: false,
    loadedAtMs: 0,
    error: "",
    workflows: [],
    issues: [],
  });

  const functionsBaseUrlResolution = useMemo(() => resolveFunctionsBaseUrlResolution(), []);
  const studioBrainResolution = useMemo(() => resolveStudioBrainBaseUrlResolution(), []);
  const fBaseUrl = functionsBaseUrlResolution.baseUrl;
  const sbBaseUrl = studioBrainResolution.baseUrl;
  const studioBrainUnreachableReason = studioBrainResolution.reason || "Studio Brain is disabled for this host.";

  const usingLocalFunctions = useMemo(
    () => fBaseUrl.includes("localhost") || fBaseUrl.includes("127.0.0.1"),
    [fBaseUrl]
  );
  const hasFunctionsAuthMismatch = usingLocalFunctions && !showEmulatorTools;

  useEffect(() => {
    const now = Date.now();
    const active = moduleSessionRef.current;
    if (!active) {
      moduleSessionRef.current = { key: moduleKey, enteredAtMs: now };
      setModuleUsage((prev) => ({
        ...prev,
        [moduleKey]: { ...prev[moduleKey], visits: prev[moduleKey].visits + 1 },
      }));
      track("staff_module_open", {
        module: moduleKey,
        owner: MODULE_REGISTRY[moduleKey].owner,
      });
      return;
    }
    if (active.key === moduleKey) return;
    const elapsed = Math.max(0, now - active.enteredAtMs);
    setModuleUsage((prev) => ({
      ...prev,
      [active.key]: { ...prev[active.key], dwellMs: prev[active.key].dwellMs + elapsed },
      [moduleKey]: { ...prev[moduleKey], visits: prev[moduleKey].visits + 1 },
    }));
    moduleSessionRef.current = { key: moduleKey, enteredAtMs: now };
    track("staff_module_open", {
      module: moduleKey,
      owner: MODULE_REGISTRY[moduleKey].owner,
    });
  }, [moduleKey]);

  useEffect(() => {
    const root = moduleContentRef.current;
    if (!root) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (!target.closest("button, a")) return;
      const active = moduleSessionRef.current;
      if (!active || active.key !== moduleKey) return;
      const elapsed = Math.max(0, Date.now() - active.enteredAtMs);
      setModuleUsage((prev) => {
        if (prev[moduleKey].firstActionMs !== null) return prev;
        return {
          ...prev,
          [moduleKey]: { ...prev[moduleKey], firstActionMs: elapsed },
        };
      });
    };
    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
  }, [moduleKey]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        STAFF_MODULE_USAGE_STORAGE_KEY,
        JSON.stringify({
          version: STAFF_MODULE_USAGE_STORAGE_VERSION,
          savedAtIso: new Date().toISOString(),
          moduleUsage,
        })
      );
    } catch {
      // Ignore storage failures; telemetry is supplemental.
    }
  }, [moduleUsage]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STAFF_ADAPTIVE_NAV_STORAGE_KEY, adaptiveNavEnabled ? "1" : "0");
    } catch {
      // Ignore storage failures; navigation still works with default order.
    }
  }, [adaptiveNavEnabled]);

  const client = useMemo(
    () =>
      createFunctionsClient({
        baseUrl: fBaseUrl,
        getIdToken: async () => await user.getIdToken(),
        getAdminToken: () => (devAdminEnabled ? devAdminToken.trim() : undefined),
        onLastRequest: setLastReq,
      }),
    [devAdminEnabled, devAdminToken, fBaseUrl, user]
  );

  const selectedBatch = useMemo(
    () => batches.find((b) => b.id === selectedBatchId) ?? null,
    [batches, selectedBatchId]
  );
  const selectedEvent = useMemo(
    () => events.find((e) => e.id === selectedEventId) ?? null,
    [events, selectedEventId]
  );
  const selectedSignup = useMemo(
    () => signups.find((signup) => signup.id === selectedSignupId) ?? null,
    [selectedSignupId, signups]
  );
  const selectedRequest = useMemo(
    () => libraryRequests.find((request) => request.id === selectedRequestId) ?? null,
    [libraryRequests, selectedRequestId]
  );
  const selectedLoan = useMemo(
    () => libraryLoans.find((loan) => loan.id === selectedLoanId) ?? null,
    [libraryLoans, selectedLoanId]
  );
  const selectedAdminItem = useMemo(
    () => libraryAdminItems.find((item) => item.id === selectedAdminItemId) ?? null,
    [libraryAdminItems, selectedAdminItemId]
  );
  const selectedFiring = useMemo(
    () => firings.find((firing) => firing.id === selectedFiringId) ?? null,
    [firings, selectedFiringId]
  );
  const selectedMember = useMemo(
    () => users.find((u) => u.id === selectedMemberId) ?? null,
    [selectedMemberId, users]
  );
  const studioBrainUiState = useMemo(() => {
    if (!studioBrainStatus) return null;
    const checkedAtMs = Date.parse(studioBrainStatus.checkedAt);
    const lastKnownGoodMs = studioBrainStatus.lastKnownGoodAt ? Date.parse(studioBrainStatus.lastKnownGoodAt) : 0;
    const checkedAtLabel = Number.isFinite(checkedAtMs) ? when(checkedAtMs) : studioBrainStatus.checkedAt;
    const lastKnownGoodLabel =
      studioBrainStatus.lastKnownGoodAt && Number.isFinite(lastKnownGoodMs)
        ? `${when(lastKnownGoodMs)} (${formatMinutesAgo(studioBrainStatus.signalAgeMinutes)} ago)`
        : "None yet";
    const snapshotAgeLabel =
      studioBrainStatus.snapshotAgeMinutes === null ? "n/a" : `${studioBrainStatus.snapshotAgeMinutes}m`;
    const base = {
      checkedAtLabel,
      lastKnownGoodLabel,
      snapshotAgeLabel,
      reasonCode: studioBrainStatus.reasonCode,
      reason: studioBrainStatus.reason,
    };
    if (studioBrainStatus.mode === "healthy") {
      return {
        ...base,
        tone: "ok" as const,
        title: "Studio Brain healthy",
        message: "Ready checks are passing and current telemetry is trusted.",
        alert: false,
      };
    }
    if (studioBrainStatus.mode === "disabled") {
      return {
        ...base,
        tone: "muted" as const,
        title: "Studio Brain disabled",
        message: "Integration is intentionally disabled for this host.",
        alert: false,
      };
    }
    if (studioBrainStatus.mode === "degraded") {
      return {
        ...base,
        tone: "warn" as const,
        title: "Studio Brain degraded",
        message: "Service is reachable but readiness checks are failing.",
        alert: true,
      };
    }
    if (studioBrainStatus.mode === "offline") {
      return {
        ...base,
        tone: "error" as const,
        title: "Studio Brain offline",
        message: "Service is unreachable and signal gap is long enough to confirm an outage.",
        alert: true,
      };
    }
    return {
      ...base,
      tone: "warn" as const,
      title: "Studio Brain signal unknown",
      message: "Telemetry is delayed or partial; this is not yet confirmed as offline.",
      alert: true,
    };
  }, [studioBrainStatus]);
  const latestErrors = useMemo(() => [...handlerLog].reverse().slice(0, 20), [handlerLog]);
  const firingStatusOptions = useMemo(() => {
    const next = new Set<string>();
    firings.forEach((firing) => {
      if (firing.status) next.add(firing.status);
    });
    return Array.from(next).sort((a, b) => a.localeCompare(b));
  }, [firings]);
  const firingKilnOptions = useMemo(() => {
    const next = new Set<string>();
    firings.forEach((firing) => {
      const label = firing.kilnName || firing.kilnId;
      if (label) next.add(label);
    });
    return Array.from(next).sort((a, b) => a.localeCompare(b));
  }, [firings]);
  const filteredFirings = useMemo(() => {
    const search = firingSearch.trim().toLowerCase();
    return firings
      .filter((firing) => {
        if (firingStatusFilter !== "all" && firing.status !== firingStatusFilter) return false;
        const kilnLabel = firing.kilnName || firing.kilnId;
        if (firingKilnFilter !== "all" && kilnLabel !== firingKilnFilter) return false;
        if (!search) return true;
        const haystack = `${firing.title} ${firing.id} ${firing.kilnName} ${firing.kilnId} ${firing.status} ${firing.cycleType}`.toLowerCase();
        return haystack.includes(search);
      })
      .sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  }, [firingKilnFilter, firingSearch, firingStatusFilter, firings]);
  const firingTriage = useMemo(() => {
    const now = Date.now();
    const activeStatuses = new Set(["loading", "firing", "cooling", "unloading", "loaded"]);
    const doneStatuses = new Set(["completed", "done", "closed"]);
    const active = filteredFirings.filter((firing) => activeStatuses.has(firing.status.toLowerCase()));
    const done = filteredFirings.filter((firing) => doneStatuses.has(firing.status.toLowerCase()));
    const attention = filteredFirings.filter((firing) => {
      const statusLower = firing.status.toLowerCase();
      const isActive = activeStatuses.has(statusLower);
      const staleActive = isActive && firing.updatedAtMs > 0 && now - firing.updatedAtMs > 12 * 60 * 60 * 1000;
      const missingWindow = firing.startAtMs > 0 && firing.endAtMs === 0;
      const lowConfidence = firing.confidence.toLowerCase() === "low";
      return staleActive || missingWindow || lowConfidence;
    });
    return {
      active,
      attention,
      done,
      view:
        firingFocusFilter === "active"
          ? active
          : firingFocusFilter === "attention"
            ? attention
            : firingFocusFilter === "done"
              ? done
              : filteredFirings,
    };
  }, [filteredFirings, firingFocusFilter]);
  const eventStatusOptions = useMemo(() => {
    const next = new Set<string>();
    events.forEach((event) => {
      if (event.status) next.add(event.status);
    });
    return Array.from(next).sort((a, b) => a.localeCompare(b));
  }, [events]);
  const filteredEvents = useMemo(() => {
    const search = eventSearch.trim().toLowerCase();
    return events
      .filter((event) => {
        if (eventStatusFilter !== "all" && event.status !== eventStatusFilter) return false;
        if (!search) return true;
        const haystack = `${event.title} ${event.id} ${event.status} ${event.location}`.toLowerCase();
        return haystack.includes(search);
      })
      .sort((a, b) => b.startAtMs - a.startAtMs);
  }, [eventSearch, eventStatusFilter, events]);
  const signupStatusOptions = useMemo(() => {
    const next = new Set<string>();
    signups.forEach((signup) => {
      if (signup.status) next.add(signup.status);
    });
    return Array.from(next).sort((a, b) => a.localeCompare(b));
  }, [signups]);
  const filteredSignups = useMemo(() => {
    const search = signupSearch.trim().toLowerCase();
    return signups
      .filter((signup) => {
        if (signupStatusFilter !== "all" && signup.status !== signupStatusFilter) return false;
        if (!search) return true;
        const haystack = `${signup.displayName} ${signup.email} ${signup.uid} ${signup.id}`.toLowerCase();
        return haystack.includes(search);
      })
      .sort((a, b) => b.createdAtMs - a.createdAtMs);
  }, [signupSearch, signupStatusFilter, signups]);
  const eventKpis = useMemo(() => {
    const now = Date.now();
    const total = events.length;
    const upcoming = events.filter((event) => event.startAtMs > now).length;
    const reviewRequired = events.filter((event) => event.status === "review_required").length;
    const published = events.filter((event) => event.status === "published").length;
    const openSeats = events.reduce(
      (sum, event) => sum + Math.max(event.remainingCapacity, 0),
      0
    );
    const waitlisted = events.reduce(
      (sum, event) => sum + Math.max(event.waitlistCount, 0),
      0
    );
    return { total, upcoming, reviewRequired, published, openSeats, waitlisted };
  }, [events]);
  const workshopProgrammingClusters = useMemo<WorkshopProgrammingCluster[]>(() => {
    const now = Date.now();
    const aggregate = new Map<
      string,
      Omit<WorkshopProgrammingCluster, "gapScore" | "recommendedAction"> & { bestPressure: number }
    >();

    for (const event of events) {
      const technique = inferWorkshopProgrammingTechnique(event.title);
      const existing = aggregate.get(technique.key) ?? {
        key: technique.key,
        label: technique.label,
        eventCount: 0,
        upcomingCount: 0,
        waitlistCount: 0,
        openSeats: 0,
        reviewRequiredCount: 0,
        demandScore: 0,
        topEventTitle: "",
        bestPressure: -1,
      };

      const waitlist = Math.max(event.waitlistCount, 0);
      const remaining = Math.max(event.remainingCapacity, 0);
      const capacity = Math.max(event.capacity, 0);
      const filled = Math.max(capacity - remaining, 0);
      const isUpcoming = event.startAtMs > now && event.status !== "cancelled";
      const pressure = waitlist * 3 + Math.max(0, 2 - remaining) + (event.status === "review_required" ? 2 : 0);

      existing.eventCount += 1;
      existing.waitlistCount += waitlist;
      existing.openSeats += remaining;
      existing.demandScore += filled + waitlist * 2;
      if (isUpcoming) existing.upcomingCount += 1;
      if (event.status === "review_required") existing.reviewRequiredCount += 1;
      if (pressure > existing.bestPressure) {
        existing.topEventTitle = event.title;
        existing.bestPressure = pressure;
      }
      aggregate.set(technique.key, existing);
    }

    return Array.from(aggregate.values())
      .map((entry) => {
        const shortage = Math.max(0, 2 - entry.upcomingCount);
        const seatSaturation = entry.openSeats === 0 ? 2 : entry.openSeats < 8 ? 1 : 0;
        const gapScore = entry.waitlistCount * 2 + shortage * 3 + seatSaturation + entry.reviewRequiredCount;
        let recommendedAction = "Monitor trend";
        if (entry.waitlistCount >= 5) {
          recommendedAction = "Add second session";
        } else if (entry.upcomingCount === 0) {
          recommendedAction = "Schedule first session";
        } else if (entry.openSeats <= 4) {
          recommendedAction = "Expand seats or add date";
        } else if (entry.reviewRequiredCount > 0) {
          recommendedAction = "Resolve review gate";
        }
        return {
          ...entry,
          gapScore,
          recommendedAction,
        };
      })
      .sort((left, right) => {
        const byGap = right.gapScore - left.gapScore;
        if (byGap !== 0) return byGap;
        return right.demandScore - left.demandScore;
      });
  }, [events]);
  const workshopProgrammingKpis = useMemo(() => {
    const totalClusters = workshopProgrammingClusters.length;
    const highPressure = workshopProgrammingClusters.filter((cluster) => cluster.gapScore >= 8).length;
    const totalWaitlist = workshopProgrammingClusters.reduce((sum, cluster) => sum + cluster.waitlistCount, 0);
    const totalDemandScore = workshopProgrammingClusters.reduce((sum, cluster) => sum + cluster.demandScore, 0);
    const noUpcomingCoverage = workshopProgrammingClusters.filter((cluster) => cluster.upcomingCount === 0).length;
    return {
      totalClusters,
      highPressure,
      totalWaitlist,
      totalDemandScore,
      noUpcomingCoverage,
    };
  }, [workshopProgrammingClusters]);
  const handleExportWorkshopProgrammingBrief = useCallback(() => {
    const dateLabel = new Date().toISOString().slice(0, 10);
    const lines = [
      `Workshop programming brief (${dateLabel})`,
      "",
      `Technique clusters tracked: ${workshopProgrammingKpis.totalClusters}`,
      `High-pressure clusters: ${workshopProgrammingKpis.highPressure}`,
      `Total waitlist pressure: ${workshopProgrammingKpis.totalWaitlist}`,
      `Demand score total: ${workshopProgrammingKpis.totalDemandScore}`,
      `Clusters without upcoming coverage: ${workshopProgrammingKpis.noUpcomingCoverage}`,
      "",
      "Technique clusters:",
      ...workshopProgrammingClusters.map((cluster) =>
        `- ${cluster.label}: gap ${cluster.gapScore}, demand ${cluster.demandScore}, waitlist ${cluster.waitlistCount}, upcoming ${cluster.upcomingCount}, action ${cluster.recommendedAction}`
      ),
    ];
    const blob = new Blob([`${lines.join("\n")}\n`], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `workshop-programming-brief-${dateLabel}.txt`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setStatus("Exported workshop programming brief.");
    track("staff_workshops_programming_brief_exported", {
      clusters: workshopProgrammingClusters.length,
      highPressure: workshopProgrammingKpis.highPressure,
    });
  }, [workshopProgrammingClusters, workshopProgrammingKpis.highPressure, workshopProgrammingKpis.noUpcomingCoverage, workshopProgrammingKpis.totalClusters, workshopProgrammingKpis.totalDemandScore, workshopProgrammingKpis.totalWaitlist]);
  const lendingStatusOptions = useMemo(() => {
    const next = new Set<string>();
    [...libraryRequests, ...libraryLoans].forEach((item) => {
      if (item.status) next.add(item.status);
    });
    return Array.from(next).sort((a, b) => a.localeCompare(b));
  }, [libraryLoans, libraryRequests]);
  const lendingRecommendationStatusOptions = useMemo(() => {
    const next = new Set<string>();
    libraryRecommendations.forEach((entry) => {
      if (entry.moderationStatus) next.add(entry.moderationStatus);
    });
    return Array.from(next).sort((a, b) => a.localeCompare(b));
  }, [libraryRecommendations]);
  const filteredRequests = useMemo(() => {
    const search = lendingSearch.trim().toLowerCase();
    return libraryRequests
      .filter((request) => {
        if (lendingStatusFilter !== "all" && request.status !== lendingStatusFilter) return false;
        if (!search) return true;
        const haystack = `${request.title} ${request.id} ${request.requesterName} ${request.requesterEmail} ${request.requesterUid}`.toLowerCase();
        return haystack.includes(search);
      })
      .sort((a, b) => b.createdAtMs - a.createdAtMs);
  }, [lendingSearch, lendingStatusFilter, libraryRequests]);
  const filteredLoans = useMemo(() => {
    const search = lendingSearch.trim().toLowerCase();
    return libraryLoans
      .filter((loan) => {
        if (lendingStatusFilter !== "all" && loan.status !== lendingStatusFilter) return false;
        if (!search) return true;
        const haystack = `${loan.title} ${loan.id} ${loan.borrowerName} ${loan.borrowerEmail} ${loan.borrowerUid}`.toLowerCase();
        return haystack.includes(search);
      })
      .sort((a, b) => b.createdAtMs - a.createdAtMs);
  }, [lendingSearch, lendingStatusFilter, libraryLoans]);
  const filteredLendingAdminItems = useMemo(() => {
    const search = lendingAdminItemSearch.trim().toLowerCase();
    return libraryAdminItems
      .filter((item) => {
        if (!search) return true;
        const haystack =
          `${item.title} ${item.authorLine} ${item.id} ${item.status} ${item.mediaType} ${item.source} ${item.isbn} ${item.isbn10} ${item.isbn13}`
            .toLowerCase();
        return haystack.includes(search);
      })
      .sort((a, b) => b.updatedAtMs - a.updatedAtMs || a.title.localeCompare(b.title));
  }, [lendingAdminItemSearch, libraryAdminItems]);
  const lendingAdminDeleteConfirmationPhrase = useMemo(
    () => (selectedAdminItem ? `delete ${selectedAdminItem.id}` : ""),
    [selectedAdminItem]
  );
  const filteredRecommendations = useMemo(() => {
    const search = lendingSearch.trim().toLowerCase();
    return libraryRecommendations
      .filter((entry) => {
        if (lendingRecommendationFilter !== "all" && entry.moderationStatus !== lendingRecommendationFilter) return false;
        if (!search) return true;
        const haystack = `${entry.title} ${entry.author} ${entry.isbn} ${entry.id} ${entry.recommenderName} ${entry.recommenderUid}`.toLowerCase();
        return haystack.includes(search);
      })
      .sort((a, b) => b.createdAtMs - a.createdAtMs || b.updatedAtMs - a.updatedAtMs);
  }, [lendingRecommendationFilter, lendingSearch, libraryRecommendations]);
  const filteredTagSubmissions = useMemo(() => {
    const search = lendingSearch.trim().toLowerCase();
    return libraryTagSubmissions
      .filter((entry) => entry.status === "pending")
      .filter((entry) => {
        if (!search) return true;
        const haystack =
          `${entry.itemTitle} ${entry.itemId} ${entry.tag} ${entry.submittedByName} ${entry.submittedByUid}`.toLowerCase();
        return haystack.includes(search);
      })
      .sort((a, b) => b.createdAtMs - a.createdAtMs || b.updatedAtMs - a.updatedAtMs);
  }, [lendingSearch, libraryTagSubmissions]);
  const recommendationModerationKpis = useMemo(() => {
    const pendingReview = libraryRecommendations.filter((entry) => entry.moderationStatus === "pending_review").length;
    const hidden = libraryRecommendations.filter((entry) => entry.moderationStatus === "hidden").length;
    const approved = libraryRecommendations.filter((entry) => entry.moderationStatus === "approved").length;
    return {
      total: libraryRecommendations.length,
      pendingReview,
      hidden,
      approved,
    };
  }, [libraryRecommendations]);
  const tagModerationKpis = useMemo(() => {
    const statusToken = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, "_");
    const pending = libraryTagSubmissions.filter((entry) => statusToken(entry.status || "pending") === "pending").length;
    const approved = libraryTagSubmissions.filter((entry) => statusToken(entry.status) === "approved").length;
    return {
      total: libraryTagSubmissions.length,
      pending,
      approved,
    };
  }, [libraryTagSubmissions]);
  const lendingTriage = useMemo(() => {
    const now = Date.now();
    const activeLoans = filteredLoans.filter((loan) => {
      const status = loan.status.toLowerCase();
      return status === "active" || status === "checked_out" || status === "borrowed";
    });
    const overdueLoans = activeLoans.filter((loan) => loan.dueAtMs > 0 && loan.dueAtMs < now && loan.returnedAtMs === 0);
    const returnedLoans = filteredLoans.filter((loan) => {
      const status = loan.status.toLowerCase();
      return status === "returned" || loan.returnedAtMs > 0;
    });
    const openRequests = filteredRequests.filter((request) => request.status.toLowerCase() === "open");
    const requestView = lendingFocusFilter === "requests" ? openRequests : filteredRequests;
    const loanView =
      lendingFocusFilter === "active"
        ? activeLoans
        : lendingFocusFilter === "overdue"
          ? overdueLoans
          : lendingFocusFilter === "returned"
            ? returnedLoans
            : filteredLoans;
    return {
      openRequests,
      activeLoans,
      overdueLoans,
      returnedLoans,
      requestView,
      loanView,
    };
  }, [filteredLoans, filteredRequests, lendingFocusFilter]);
  const batchStatusOptions = useMemo(() => {
    const next = new Set<string>();
    batches.forEach((batch) => {
      if (batch.status) next.add(batch.status);
    });
    return Array.from(next).sort((a, b) => a.localeCompare(b));
  }, [batches]);
  const batchArtifactInventory = useMemo(
    () => {
      const evaluatedAtMs = Date.now();
      return batches
        .map((batch) => classifyBatchArtifact(batch, evaluatedAtMs))
        .sort((a, b) => {
          const confidenceRank = (value: BatchArtifactConfidence): number =>
            value === "high" ? 3 : value === "medium" ? 2 : 1;
          const byLikely = Number(b.likelyArtifact) - Number(a.likelyArtifact);
          if (byLikely !== 0) return byLikely;
          const byConfidence = confidenceRank(b.confidence) - confidenceRank(a.confidence);
          if (byConfidence !== 0) return byConfidence;
          return b.updatedAtMs - a.updatedAtMs;
        });
    },
    [batches]
  );
  const batchArtifactInventoryById = useMemo(
    () => new Map(batchArtifactInventory.map((entry) => [entry.batchId, entry])),
    [batchArtifactInventory]
  );
  const batchArtifactIdSet = useMemo(
    () => new Set(batchArtifactInventory.filter((entry) => entry.likelyArtifact).map((entry) => entry.batchId)),
    [batchArtifactInventory]
  );
  const batchArtifactCandidates = useMemo(
    () => batches.filter((batch) => batchArtifactIdSet.has(batch.id)),
    [batchArtifactIdSet, batches]
  );
  const filteredBatches = useMemo(() => {
    const search = batchSearch.trim().toLowerCase();
    return batches
      .filter((batch) => {
        if (batchStatusFilter === "open" && batch.isClosed) return false;
        if (batchStatusFilter === "closed" && !batch.isClosed) return false;
        if (
          batchStatusFilter !== "all" &&
          batchStatusFilter !== "open" &&
          batchStatusFilter !== "closed" &&
          batch.status !== batchStatusFilter
        ) {
          return false;
        }
        const likelyArtifact = batchArtifactIdSet.has(batch.id);
        if (batchArtifactFilter === "artifact" && !likelyArtifact) return false;
        if (batchArtifactFilter === "nonArtifact" && likelyArtifact) return false;
        if (!search) return true;
        const haystack = `${batch.title} ${batch.id} ${batch.ownerUid} ${batch.status}`.toLowerCase();
        return haystack.includes(search);
      })
      .sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  }, [batchArtifactFilter, batchArtifactIdSet, batchSearch, batchStatusFilter, batches]);
  const batchLikelyArtifactInventory = useMemo(
    () => batchArtifactInventory.filter((entry) => entry.likelyArtifact),
    [batchArtifactInventory]
  );
  const batchArtifactSummary = useMemo(() => {
    const countsByCategory: Record<string, number> = {};
    const countsByConfidence: Record<string, number> = {};
    const countsByDispositionHint: Record<string, number> = {};
    let manualReview = 0;
    batchLikelyArtifactInventory.forEach((entry) => {
      countsByCategory[entry.category] = (countsByCategory[entry.category] || 0) + 1;
      countsByConfidence[entry.confidence] = (countsByConfidence[entry.confidence] || 0) + 1;
      if (entry.dispositionHints.includes("manual_review")) manualReview += 1;
      entry.dispositionHints.forEach((hint) => {
        countsByDispositionHint[hint] = (countsByDispositionHint[hint] || 0) + 1;
      });
    });
    return {
      totalLikelyArtifacts: batchLikelyArtifactInventory.length,
      highConfidence: countsByConfidence.high || 0,
      mediumConfidence: countsByConfidence.medium || 0,
      lowConfidence: countsByConfidence.low || 0,
      manualReview,
      countsByCategory,
      countsByConfidence,
      countsByDispositionHint,
    };
  }, [batchLikelyArtifactInventory]);
  const batchCleanupSelectionCandidates = useMemo(() => {
    if (batchCleanupSelectionMode === "all_likely_artifacts") return batchLikelyArtifactInventory;
    if (batchCleanupSelectionMode === "current_filter_artifacts") {
      return filteredBatches
        .map((batch) => batchArtifactInventoryById.get(batch.id) ?? null)
        .filter((entry): entry is BatchArtifactTriageRecord => Boolean(entry?.likelyArtifact));
    }
    return batchLikelyArtifactInventory.filter((entry) => entry.confidence === "high");
  }, [batchArtifactInventoryById, batchCleanupSelectionMode, batchLikelyArtifactInventory, filteredBatches]);
  const expectedBatchCleanupConfirmationPhrase = useMemo(
    () => `DELETE ${batchCleanupSelectionCandidates.length} BATCHES`,
    [batchCleanupSelectionCandidates.length]
  );
  const canConfirmDestructiveCleanup = useMemo(
    () => batchCleanupConfirmPhraseInput.trim() === expectedBatchCleanupConfirmationPhrase,
    [batchCleanupConfirmPhraseInput, expectedBatchCleanupConfirmationPhrase]
  );
  const selectedBatchTriage = useMemo(
    () => (selectedBatch ? batchArtifactInventoryById.get(selectedBatch.id) ?? null : null),
    [batchArtifactInventoryById, selectedBatch]
  );
  const selectedBatchState = useMemo(
    () => normalizeBatchState(selectedBatch?.status ?? ""),
    [selectedBatch?.status]
  );
  const batchActionAvailability = useMemo(() => {
    const closed = selectedBatch?.isClosed === true || selectedBatchState.startsWith("CLOSED");
    const canShelve = !closed && selectedBatchState !== "READY_FOR_PICKUP";
    const canKilnLoad =
      !closed &&
      (selectedBatchState === "SHELVED" ||
        selectedBatchState === "SUBMITTED" ||
        selectedBatchState === "DRAFT" ||
        selectedBatchState === "UNKNOWN");
    const canKilnUnload = !closed && selectedBatchState === "LOADED";
    const canReady = !closed && (selectedBatchState === "LOADED" || selectedBatchState === "FIRED");
    const canClose = !closed && selectedBatchState === "READY_FOR_PICKUP";
    const canContinue =
      selectedBatchState === "READY_FOR_PICKUP" ||
      selectedBatchState.startsWith("CLOSED");

    const out: Record<BatchActionName, boolean> = {
      shelveBatch: canShelve,
      kilnLoad: canKilnLoad,
      kilnUnload: canKilnUnload,
      readyForPickup: canReady,
      pickedUpAndClose: canClose,
      continueJourney: canContinue,
    };
    return out;
  }, [selectedBatch?.isClosed, selectedBatchState]);
  const recommendedBatchActions = useMemo(() => {
    if (!selectedBatch) return [] as Array<{ action: BatchActionName; label: string }>;
    const options: Array<{ action: BatchActionName; label: string }> = [
      { action: "shelveBatch", label: "Shelve" },
      { action: "kilnLoad", label: "Kiln load" },
      { action: "kilnUnload", label: "Kiln unload" },
      { action: "readyForPickup", label: "Ready for pickup" },
      { action: "pickedUpAndClose", label: "Close picked up" },
      { action: "continueJourney", label: "Continue journey" },
    ];
    return options.filter((entry) => batchActionAvailability[entry.action]);
  }, [batchActionAvailability, selectedBatch]);
  const commerceStatusOptions = useMemo(() => {
    const next = new Set<string>();
    orders.forEach((order) => {
      if (order.status) next.add(order.status);
    });
    return Array.from(next).sort((a, b) => a.localeCompare(b));
  }, [orders]);
  const filteredOrders = useMemo(() => {
    const search = commerceSearch.trim().toLowerCase();
    return orders
      .filter((order) => {
        if (commerceStatusFilter !== "all" && order.status !== commerceStatusFilter) return false;
        if (!search) return true;
        const haystack = `${order.id} ${order.status} ${order.pickupNotes || ""}`.toLowerCase();
        return haystack.includes(search);
      })
      .sort((a, b) => Date.parse(b.updatedAt || "1970-01-01") - Date.parse(a.updatedAt || "1970-01-01"));
  }, [commerceSearch, commerceStatusFilter, orders]);
  const commerceKpis = useMemo(() => {
    const pendingOrders = orders.filter((order) => order.status !== "paid");
    const paidOrders = orders.filter((order) => order.status === "paid");
    const pendingAmount = pendingOrders.reduce((sum, order) => sum + Math.max(order.totalCents, 0), 0);
    return {
      ordersTotal: orders.length,
      pendingOrders: pendingOrders.length,
      paidOrders: paidOrders.length,
      pendingAmount,
      unpaidCheckIns: unpaidCheckIns.length,
      receiptsTotal: receipts.length,
    };
  }, [orders, receipts.length, unpaidCheckIns.length]);
  const overviewAlerts = useMemo(() => {
    const nowMs = Date.now();
    const alerts: Array<{
      id: string;
      createdAtMs: number;
      severity: "high" | "medium" | "low";
      label: string;
      actionLabel: string;
      module: ModuleKey;
    }> = [];
    const openBatches = batches.filter((batch) => !batch.isClosed).length;
    const staleOpenBatches = batches.filter(
      (batch) => !batch.isClosed && batch.updatedAtMs > 0 && Date.now() - batch.updatedAtMs > 7 * 24 * 60 * 60 * 1000
    ).length;
    const pendingOrders = orders.filter((order) => order.status !== "paid").length;
    const unresolvedReports = reportOps.open;
    const reportSlaBreaches = reportOps.slaBreaches;
    const highSeverityReports = reportOps.highOpen;
    const activeFirings = firings.filter((firing) =>
      ["loading", "firing", "cooling", "unloading", "loaded"].includes(firing.status.toLowerCase())
    ).length;
    const attentionFirings = firings.filter((firing) => {
      const statusLower = firing.status.toLowerCase();
      const isActive = ["loading", "firing", "cooling", "unloading", "loaded"].includes(statusLower);
      const stale = isActive && firing.updatedAtMs > 0 && Date.now() - firing.updatedAtMs > 12 * 60 * 60 * 1000;
      const lowConfidence = firing.confidence.toLowerCase() === "low";
      return stale || lowConfidence;
    }).length;

    if (attentionFirings > 0) {
      alerts.push({
        id: "firings-attention",
        createdAtMs: nowMs,
        severity: "high",
        label: `${attentionFirings} firing${attentionFirings === 1 ? "" : "s"} need attention`,
        actionLabel: "Review firings",
        module: "firings",
      });
    }
    if (pendingOrders > 0) {
      alerts.push({
        id: "orders-pending",
        createdAtMs: nowMs,
        severity: "medium",
        label: `${pendingOrders} store order${pendingOrders === 1 ? "" : "s"} pending payment`,
        actionLabel: "Open store & billing",
        module: "commerce",
      });
    }
    if (unpaidCheckIns.length > 0) {
      alerts.push({
        id: "checkins-unpaid",
        createdAtMs: nowMs,
        severity: "medium",
        label: `${unpaidCheckIns.length} checked-in event signup${unpaidCheckIns.length === 1 ? "" : "s"} still unpaid`,
        actionLabel: "Open store & billing",
        module: "commerce",
      });
    }
    if (staleOpenBatches > 0) {
      alerts.push({
        id: "batches-stale",
        createdAtMs: nowMs,
        severity: "medium",
        label: `${staleOpenBatches} open batch${staleOpenBatches === 1 ? "" : "es"} stale for 7+ days`,
        actionLabel: "Review pieces & batches",
        module: "pieces",
      });
    }
    if (highSeverityReports > 0) {
      alerts.push({
        id: "reports-high-open",
        createdAtMs: nowMs,
        severity: "high",
        label: `${highSeverityReports} high-severity report${highSeverityReports === 1 ? "" : "s"} still open`,
        actionLabel: "Open reports triage",
        module: "reports",
      });
    }
    if (reportSlaBreaches > 0) {
      alerts.push({
        id: "reports-sla",
        createdAtMs: nowMs,
        severity: "high",
        label: `${reportSlaBreaches} report SLA breach${reportSlaBreaches === 1 ? "" : "es"} need review`,
        actionLabel: "Open reports triage",
        module: "reports",
      });
    } else if (unresolvedReports > 0) {
      alerts.push({
        id: "reports-open",
        createdAtMs: nowMs,
        severity: "medium",
        label: `${unresolvedReports} moderation report${unresolvedReports === 1 ? "" : "s"} pending`,
        actionLabel: "Open reports triage",
        module: "reports",
      });
    }
    if (events.filter((event) => event.status === "review_required").length > 0) {
      const count = events.filter((event) => event.status === "review_required").length;
      alerts.push({
        id: "events-review",
        createdAtMs: nowMs,
        severity: "high",
        label: `${count} event${count === 1 ? "" : "s"} blocked for review`,
        actionLabel: "Open events",
        module: "events",
      });
    }
    if (openBatches === 0 && activeFirings === 0 && pendingOrders === 0 && unresolvedReports === 0) {
      alerts.push({
        id: "all-clear",
        createdAtMs: nowMs,
        severity: "low",
        label: "No immediate operational alerts.",
        actionLabel: "Stay on cockpit",
        module: "cockpit",
      });
    }
    return alerts;
  }, [batches, events, firings, orders, reportOps.highOpen, reportOps.open, reportOps.slaBreaches, unpaidCheckIns.length]);
  const cockpitKpis = useMemo(() => {
    const highAlerts = overviewAlerts.filter((alert) => alert.severity === "high").length;
    const mediumAlerts = overviewAlerts.filter((alert) => alert.severity === "medium").length;
    const failedChecks = systemChecks.filter((check) => !check.ok).length;
    return {
      highAlerts,
      mediumAlerts,
      openReports: reportOps.open,
      failedChecks,
      totalChecks: systemChecks.length,
      recentErrors: latestErrors.length,
      authMismatch: hasFunctionsAuthMismatch,
    };
  }, [hasFunctionsAuthMismatch, latestErrors.length, overviewAlerts, reportOps.open, systemChecks]);
  const automationKpis = useMemo(() => {
    const workflowRows = automationDashboard.workflows;
    const monitored = workflowRows.length;
    const healthy = workflowRows.filter((item) => item.conclusion === "success").length;
    const failing = workflowRows.filter((item) => item.conclusion === "failure").length;
    const inProgress = workflowRows.filter((item) => item.status === "in_progress" || item.status === "queued").length;
    const stale = workflowRows.filter((item) => item.isStale).length;
    const threads = automationDashboard.issues.length;
    const threadErrors = automationDashboard.issues.filter((item) => Boolean(item.error)).length;
    return {
      monitored,
      healthy,
      failing,
      inProgress,
      stale,
      threads,
      threadErrors,
      loadedAtMs: automationDashboard.loadedAtMs,
    };
  }, [automationDashboard]);
  const moduleUsageRows = useMemo(() => {
    const now = Date.now();
    const active = moduleSessionRef.current;
    return (Object.keys(MODULE_REGISTRY) as ModuleKey[])
      .map((key) => {
        const base = moduleUsage[key];
        const liveDwellMs =
          active?.key === key
            ? base.dwellMs + Math.max(0, now - active.enteredAtMs)
            : base.dwellMs;
        return {
          key,
          label: MODULE_REGISTRY[key].label,
          owner: MODULE_REGISTRY[key].owner,
          visits: base.visits,
          dwellMs: liveDwellMs,
          firstActionMs: base.firstActionMs,
        };
      })
      .filter((row) => row.visits > 0 || row.dwellMs > 0 || row.firstActionMs !== null)
      .sort((a, b) => b.visits - a.visits || b.dwellMs - a.dwellMs);
  }, [moduleUsage]);
  const lowEngagementModules = useMemo(() => {
    return MODULES
      .map((moduleItem) => ({
        key: moduleItem.key,
        label: moduleItem.label,
        usage: moduleUsage[moduleItem.key],
      }))
      .filter((row) => row.key !== "cockpit")
      .filter((row) => row.usage.visits <= 1 && row.usage.dwellMs < 20_000 && row.usage.firstActionMs === null)
      .map((row) => row.label);
  }, [moduleUsage]);
  const lowEngagementModuleKeys = useMemo(() => {
    return new Set(
      MODULES
        .map((moduleItem) => ({
          key: moduleItem.key,
          usage: moduleUsage[moduleItem.key],
        }))
        .filter((row) => row.key !== "cockpit")
        .filter((row) => row.usage.visits <= 1 && row.usage.dwellMs < 20_000 && row.usage.firstActionMs === null)
        .map((row) => row.key)
    );
  }, [moduleUsage]);
  const moduleNavRows = useMemo(() => {
    const rows = MODULES.map((moduleItem) => ({
      ...moduleItem,
      usage: moduleUsage[moduleItem.key],
    }));
    if (!adaptiveNavEnabled) return rows;
    const cockpitRow = rows.find((row) => row.key === "cockpit");
    const nonCockpit = rows
      .filter((row) => row.key !== "cockpit")
      .sort((a, b) => {
        const byVisits = b.usage.visits - a.usage.visits;
        if (byVisits !== 0) return byVisits;
        const byDwell = b.usage.dwellMs - a.usage.dwellMs;
        if (byDwell !== 0) return byDwell;
        const aFirstAction = a.usage.firstActionMs === null ? Number.POSITIVE_INFINITY : a.usage.firstActionMs;
        const bFirstAction = b.usage.firstActionMs === null ? Number.POSITIVE_INFINITY : b.usage.firstActionMs;
        if (aFirstAction !== bFirstAction) return aFirstAction - bFirstAction;
        return a.label.localeCompare(b.label);
      });
    return cockpitRow ? [cockpitRow, ...nonCockpit] : nonCockpit;
  }, [adaptiveNavEnabled, moduleUsage]);
  const navLayout = useMemo(() => {
    if (!adaptiveNavEnabled) {
      return { primary: moduleNavRows, overflow: [] as typeof moduleNavRows };
    }
    const overflowKeys = new Set(
      moduleNavRows
        .filter((row) => lowEngagementModuleKeys.has(row.key))
        .filter((row) => row.key !== "cockpit")
        .filter((row) => row.key !== moduleKey)
        .map((row) => row.key)
    );
    return {
      primary: moduleNavRows.filter((row) => !overflowKeys.has(row.key)),
      overflow: moduleNavRows.filter((row) => overflowKeys.has(row.key)),
    };
  }, [adaptiveNavEnabled, lowEngagementModuleKeys, moduleKey, moduleNavRows]);
  const moduleTelemetrySnapshot = useMemo(
    () => ({
      capturedAtIso: new Date().toISOString(),
      adaptiveNavEnabled,
      navPrimaryCount: navLayout.primary.length,
      navOverflowCount: navLayout.overflow.length,
      lowEngagementModules,
      usageRows: moduleUsageRows,
    }),
    [adaptiveNavEnabled, lowEngagementModules, moduleUsageRows, navLayout.overflow.length, navLayout.primary.length]
  );

  const resetModuleTelemetry = useCallback(() => {
    setModuleUsage(moduleUsageSeed());
    moduleSessionRef.current = { key: moduleKey, enteredAtMs: Date.now() };
    setStatus("Reset module telemetry for local rolling profile.");
  }, [moduleKey]);

  const memberRoleCounts = useMemo(() => {
    const staffCount = users.filter((u) => u.role === "staff").length;
    const adminCount = users.filter((u) => u.role === "admin").length;
    const memberCount = users.length - staffCount - adminCount;
    return {
      all: users.length,
      staff: staffCount,
      admin: adminCount,
      member: Math.max(memberCount, 0),
    };
  }, [users]);

  const filteredMembers = useMemo(() => {
    const search = memberSearch.trim().toLowerCase();
    return users
      .filter((member) => {
        if (memberRoleFilter !== "all" && member.role !== memberRoleFilter) return false;
        if (!search) return true;
        const haystack = `${member.displayName} ${member.email} ${member.id} ${member.membershipTier}`.toLowerCase();
        return haystack.includes(search);
      })
      .sort((a, b) => b.lastSeenAtMs - a.lastSeenAtMs);
  }, [memberRoleFilter, memberSearch, users]);

  const markErr = useCallback(
    (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      if (hasFunctionsAuthMismatch && message.toLowerCase().includes("invalid authorization token")) {
        setError(
          "Functions emulator auth mismatch: local Functions is enabled but Auth emulator is off. Set VITE_USE_AUTH_EMULATOR=true or point VITE_FUNCTIONS_BASE_URL to production."
        );
      } else {
        setError(message);
      }
      setLastErr({ atIso: new Date().toISOString(), message, stack: err instanceof Error ? err.stack ?? null : null });
    },
    [hasFunctionsAuthMismatch]
  );

  const run = useCallback(
    async (key: string, fn: () => Promise<void>) => {
      if (busy) return;
      setBusy(key);
      setError("");
      setStatus("");
      try {
        await fn();
      } catch (err) {
        markErr(err);
      } finally {
        setBusy("");
      }
    },
    [busy, markErr]
  );

  const qTrace = useCallback((collectionName: string, params: Record<string, unknown>) => {
    setLastQuery({ atIso: new Date().toISOString(), collection: collectionName, params });
  }, []);

  const copy = useCallback(async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus("Copied");
    } catch (err) {
      setCopyStatus(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const upsertSystemCheck = useCallback((entry: SystemCheckRecord) => {
    setSystemChecks((prev) => {
      const next = [entry, ...prev.filter((row) => row.key !== entry.key)];
      return next.slice(0, 16);
    });
  }, []);

  const postStudioBrainDegradedEvent = useCallback(
    async (status: "entered" | "exited", mode: "degraded" | "offline", reason: string) => {
      if (!sbBaseUrl) return;
      try {
        const idToken = await user.getIdToken();
        const headers: Record<string, string> = {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        };
        if (devAdminEnabled && devAdminToken.trim()) {
          headers["x-studio-brain-admin-token"] = devAdminToken.trim();
        }
        await fetch(`${sbBaseUrl}/api/ops/degraded`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            status,
            mode,
            reason,
            rationale: "Staff console detected Studio Brain degraded state.",
          }),
        });
      } catch {
        // Silent: degraded logging should not block staff console operations.
      }
    },
    [devAdminEnabled, devAdminToken, sbBaseUrl, user]
  );

  const loadStudioBrainStatus = useCallback(async () => {
    const checkedAt = new Date().toISOString();
    const nowMs = Date.now();
    if (!sbBaseUrl) {
      const lastKnownGoodAt = lastStudioBrainHealthyAtRef.current;
      const unavailable = resolveUnavailableStudioBrainStatus({
        enabled: studioBrainResolution.enabled,
        reason: studioBrainUnreachableReason,
        lastKnownGoodAt,
        nowMs,
      });
      setStudioBrainStatus({
        checkedAt,
        mode: unavailable.mode,
        healthOk: unavailable.mode === "disabled",
        readyOk: false,
        snapshotAgeMinutes: null,
        reasonCode: unavailable.reasonCode,
        lastKnownGoodAt,
        signalAgeMinutes: unavailable.signalAgeMinutes,
        reason: unavailable.reason,
      });
      upsertSystemCheck({
        key: "studio_brain_ready",
        label: "Studio Brain ready",
        ok: unavailable.mode === "disabled",
        atMs: Date.now(),
        details: `${unavailable.reasonCode}: ${unavailable.reason}`,
      });
      return;
    }

    try {
      const readyResp = await fetch(`${sbBaseUrl}/readyz`, { method: "GET" });
      const payload = (await readyResp.json()) as {
        ok?: boolean;
        checks?: {
          postgres?: { ok?: boolean; error?: string };
          snapshot?: {
            exists?: boolean;
            ageMinutes?: number | null;
            maxAgeMinutes?: number | null;
            requireFresh?: boolean;
            fresh?: boolean;
          };
        };
      };
      const readyOk = readyResp.ok && payload.ok === true;
      const snapshot = payload.checks?.snapshot;
      const snapshotAgeMinutes = typeof snapshot?.ageMinutes === "number" ? snapshot.ageMinutes : null;
      const snapshotExists = snapshot?.exists === true;
      const snapshotFresh = snapshot?.fresh === true;
      const snapshotRequiresFresh = snapshot?.requireFresh === true;
      const snapshotMaxAgeMinutes = typeof snapshot?.maxAgeMinutes === "number" ? snapshot.maxAgeMinutes : null;
      const postgresOk = payload.checks?.postgres?.ok !== false;
      const postgresError = str(payload.checks?.postgres?.error);
      const mode: StudioBrainStatus["mode"] = readyOk ? "healthy" : "degraded";
      let reasonCode = readyOk ? "HEALTHY" : "READY_CHECK_FAILED";
      let reason = readyOk ? "Studio Brain healthy." : `Ready check failed (HTTP ${readyResp.status}).`;

      if (readyOk) {
        if (snapshotAgeMinutes !== null) {
          reason = `Studio Brain healthy (snapshot age ${snapshotAgeMinutes}m).`;
        }
        lastStudioBrainHealthyAtRef.current = checkedAt;
      } else if (!postgresOk) {
        reasonCode = "POSTGRES_UNHEALTHY";
        reason = postgresError
          ? `Dependencies degraded: postgres check failed (${postgresError}).`
          : "Dependencies degraded: postgres check failed.";
      } else if (snapshotRequiresFresh && !snapshotExists) {
        reasonCode = "SNAPSHOT_MISSING";
        reason = "Ready check failed: required snapshot is missing.";
      } else if (snapshotRequiresFresh && !snapshotFresh) {
        reasonCode = "SNAPSHOT_STALE";
        reason = `Ready check failed: snapshot stale${
          snapshotAgeMinutes !== null ? ` (${snapshotAgeMinutes}m old` : ""
        }${snapshotMaxAgeMinutes !== null ? `${snapshotAgeMinutes !== null ? ", " : " ("}max ${snapshotMaxAgeMinutes}m` : ""}${
          snapshotAgeMinutes !== null || snapshotMaxAgeMinutes !== null ? ")" : ""
        }.`;
      }

      const lastKnownGoodAt = lastStudioBrainHealthyAtRef.current;
      const signalAgeMinutes = minutesSinceIso(lastKnownGoodAt, nowMs);

      setStudioBrainStatus({
        checkedAt,
        mode,
        healthOk: readyResp.ok,
        readyOk,
        snapshotAgeMinutes,
        reasonCode,
        lastKnownGoodAt,
        signalAgeMinutes,
        reason,
      });
      upsertSystemCheck({
        key: "studio_brain_ready",
        label: "Studio Brain ready",
        ok: mode === "healthy",
        atMs: Date.now(),
        details: `${reasonCode}: ${reason}`,
      });
    } catch (err: unknown) {
      const details = err instanceof Error ? err.message : String(err);
      const lastKnownGoodAt = lastStudioBrainHealthyAtRef.current;
      const failure = resolveStudioBrainFetchFailure({
        details: details || "Studio Brain ready check unreachable.",
        lastKnownGoodAt,
        signalStaleMinutes: STUDIO_BRAIN_SIGNAL_STALE_MINUTES,
        offlineConfirmMinutes: STUDIO_BRAIN_OFFLINE_CONFIRM_MINUTES,
        nowMs,
      });
      setStudioBrainStatus({
        checkedAt,
        mode: failure.mode,
        healthOk: false,
        readyOk: false,
        snapshotAgeMinutes: null,
        reasonCode: failure.reasonCode,
        lastKnownGoodAt,
        signalAgeMinutes: failure.signalAgeMinutes,
        reason: failure.reason,
      });
      upsertSystemCheck({
        key: "studio_brain_ready",
        label: "Studio Brain ready",
        ok: false,
        atMs: Date.now(),
        details: `${failure.reasonCode}: ${failure.reason}`,
      });
    }
  }, [sbBaseUrl, studioBrainResolution.enabled, studioBrainUnreachableReason, upsertSystemCheck]);

  const loadUsers = useCallback(async () => {
    qTrace("users", { limit: 240 });
    qTrace("profiles", { limit: 240 });
    const [usersResult, profilesResult] = await Promise.allSettled([
      getDocs(query(collection(db, "users"), limit(240))),
      getDocs(query(collection(db, "profiles"), limit(240))),
    ]);

    const byUid = new Map<string, { userData: Record<string, unknown>; profileData: Record<string, unknown> }>();
    const usersDocsCount = usersResult.status === "fulfilled" ? usersResult.value.docs.length : 0;
    const profilesDocsCount = profilesResult.status === "fulfilled" ? profilesResult.value.docs.length : 0;
    const fallbackCollections: string[] = [];
    let inferredMembers = 0;

    if (usersResult.status === "fulfilled") {
      usersResult.value.docs.forEach((docSnap) => {
        const row = byUid.get(docSnap.id) ?? { userData: {}, profileData: {} };
        row.userData = (docSnap.data() ?? {}) as Record<string, unknown>;
        byUid.set(docSnap.id, row);
      });
    }

    if (profilesResult.status === "fulfilled") {
      profilesResult.value.docs.forEach((docSnap) => {
        const row = byUid.get(docSnap.id) ?? { userData: {}, profileData: {} };
        row.profileData = (docSnap.data() ?? {}) as Record<string, unknown>;
        byUid.set(docSnap.id, row);
      });
    }

    const loadWarnings: string[] = [];
    if (usersResult.status === "rejected") {
      loadWarnings.push(`users query failed: ${usersResult.reason instanceof Error ? usersResult.reason.message : String(usersResult.reason)}`);
    }
    if (profilesResult.status === "rejected") {
      loadWarnings.push(`profiles query failed: ${profilesResult.reason instanceof Error ? profilesResult.reason.message : String(profilesResult.reason)}`);
    }
    if (loadWarnings.length) {
      setError(`Members data is partially unavailable. ${loadWarnings.join(" | ")}`);
    }

    if (byUid.size === 0) {
      const sources = [
        { name: "batches", uidKeys: ["ownerUid", "uid", "userUid"], displayKeys: ["ownerName", "displayName", "authorName"], emailKeys: ["ownerEmail", "email"] },
        { name: "reservations", uidKeys: ["ownerUid", "uid", "userUid"], displayKeys: ["ownerName", "displayName"], emailKeys: ["ownerEmail", "email"] },
        { name: "eventSignups", uidKeys: ["uid", "ownerUid", "userUid"], displayKeys: ["displayName", "ownerName"], emailKeys: ["email", "ownerEmail"] },
        { name: "materialsOrders", uidKeys: ["uid", "ownerUid", "userUid"], displayKeys: ["displayName", "ownerName"], emailKeys: ["email", "ownerEmail"] },
        { name: "libraryRequests", uidKeys: ["uid", "requesterUid", "ownerUid"], displayKeys: ["requesterName", "displayName"], emailKeys: ["requesterEmail", "email"] },
        { name: "libraryLoans", uidKeys: ["uid", "borrowerUid", "ownerUid"], displayKeys: ["borrowerName", "displayName"], emailKeys: ["borrowerEmail", "email"] },
      ] as const;

      const fallbackResults = await Promise.allSettled(
        sources.map((source) => getDocs(query(collection(db, source.name), limit(240))))
      );

      fallbackResults.forEach((result, index) => {
        if (result.status !== "fulfilled") return;
        const source = sources[index];
        fallbackCollections.push(source.name);
        result.value.docs.forEach((docSnap) => {
          const data = (docSnap.data() ?? {}) as Record<string, unknown>;
          const uid = source.uidKeys.map((key) => str(data[key])).find((value) => value.trim().length > 0);
          if (!uid) return;
          const row = byUid.get(uid) ?? { userData: {}, profileData: {} };
          const inferredName = source.displayKeys.map((key) => str(data[key])).find((value) => value.trim().length > 0);
          const inferredEmail = source.emailKeys.map((key) => str(data[key])).find((value) => value.trim().length > 0);
          const inferredUpdatedAt = maxMs(
            toTsMs(data.updatedAt),
            toTsMs(data.createdAt),
            toTsMs(data.lastSeenAt),
            toTsMs(data.lastLoginAt)
          );
          row.userData = {
            ...row.userData,
            ...(inferredName ? { displayName: inferredName } : {}),
            ...(inferredEmail ? { email: inferredEmail } : {}),
            ...(inferredUpdatedAt ? { updatedAt: inferredUpdatedAt } : {}),
          };
          byUid.set(uid, row);
        });
      });
      inferredMembers = byUid.size;
    }

    const rows = Array.from(byUid.entries()).map(([uid, pair]) => {
      const u = pair.userData;
      const p = pair.profileData;
      const createdAtMs = maxMs(toTsMs(u.createdAt), toTsMs(p.createdAt));
      const updatedAtMs = maxMs(toTsMs(u.updatedAt), toTsMs(p.updatedAt));
      const lastSeenAtMs = maxMs(
        toTsMs(u.lastSeenAt),
        toTsMs(u.lastLoginAt),
        toTsMs(u.lastSignInAt),
        toTsMs(p.lastSeenAt),
        toTsMs(p.lastLoginAt),
        updatedAtMs
      );
      const merged = { ...u, ...p };
      const role = memberRole(merged);
      return {
        id: uid,
        displayName: str(merged.displayName, "Unknown"),
        email: str(merged.email, "-"),
        role,
        createdAtMs,
        updatedAtMs,
        lastSeenAtMs,
        membershipTier: deriveMembershipTier(merged, role),
        kilnPreferences: str(merged.kilnPreferences, str(merged.preferredKilns, "-")),
        rawDoc: merged,
      } satisfies MemberRecord;
    });

    if (rows.length === 0) {
      rows.push({
        id: user.uid,
        displayName: user.displayName ?? "Current user",
        email: user.email ?? "-",
        role: isStaff ? "staff" : "member",
        createdAtMs: 0,
        updatedAtMs: 0,
        lastSeenAtMs: Date.now(),
        membershipTier: isStaff ? "Staff" : "Studio Member",
        kilnPreferences: "-",
        rawDoc: {},
      });
    }

    if (usersResult.status === "rejected" && profilesResult.status === "rejected") {
      throw new Error("Unable to load members from users or profiles collections.");
    }
    setMemberSourceStats({
      usersDocs: usersDocsCount,
      profilesDocs: profilesDocsCount,
      inferredMembers,
      fallbackCollections,
    });
    setUsers(rows);
    if (!selectedMemberId && rows[0]) setSelectedMemberId(rows[0].id);
  }, [isStaff, qTrace, selectedMemberId, user.displayName, user.email, user.uid]);

  const countFor = useCallback(
    async (collectionName: string, ...constraints: QueryConstraint[]): Promise<number> => {
      qTrace(collectionName, { constraints: constraints.length });
      const snap = await getCountFromServer(query(collection(db, collectionName), ...constraints));
      return snap.data().count;
    },
    [qTrace]
  );

  const loadMemberOperationalStats = useCallback(
    async (uid: string) => {
      setMemberStatsBusy(true);
      setMemberStatsError("");
      setMemberStats(null);
      try {
        const [batchesCount, reservationsCount, eventSignupsCount, materialsOrdersCount, threadsCount, loansCount] =
          await Promise.all([
            countFor("batches", where("ownerUid", "==", uid)),
            countFor("reservations", where("ownerUid", "==", uid)),
            countFor("eventSignups", where("uid", "==", uid)),
            countFor("materialsOrders", where("uid", "==", uid)),
            countFor("directMessages", where("participants", "array-contains", uid)),
            countFor("libraryLoans", where("uid", "==", uid)),
          ]);

        setMemberStats({
          batches: batchesCount,
          reservations: reservationsCount,
          eventSignups: eventSignupsCount,
          materialsOrders: materialsOrdersCount,
          directMessageThreads: threadsCount,
          libraryLoans: loansCount,
        });
      } catch (err) {
        setMemberStatsError(err instanceof Error ? err.message : String(err));
      } finally {
        setMemberStatsBusy(false);
      }
    },
    [countFor]
  );

  const loadBatches = useCallback(async () => {
    qTrace("batches", { orderBy: "updatedAt:desc", limit: 80 });
    qTrace("batches", { countOnly: true });
    const [batchesResult, countResult] = await Promise.allSettled([
      getDocs(query(collection(db, "batches"), orderBy("updatedAt", "desc"), limit(80))),
      getCountFromServer(query(collection(db, "batches"))),
    ]);
    if (batchesResult.status !== "fulfilled") {
      throw batchesResult.reason;
    }
    const snap = batchesResult.value;
    if (countResult.status === "fulfilled") {
      setBatchesTotalCount(countResult.value.data().count);
    } else {
      setBatchesTotalCount(null);
    }
    const next = snap.docs.map((d) => {
      const data = d.data();
      const status = str(data.state, str(data.status, "UNKNOWN"));
      return {
        id: d.id,
        title: str(data.collectionName, str(data.title, "Untitled batch")),
        ownerUid: str(data.ownerUid),
        status,
        isClosed: bool(data.isClosed),
        updatedAtMs: toTsMs(data.updatedAt),
        currentKilnName: str(data.currentKilnName),
        currentKilnId: str(data.currentKilnId),
      } satisfies BatchRecord;
    });
    setBatches(next);
    if (!selectedBatchId && next[0]) setSelectedBatchId(next[0].id);
  }, [qTrace, selectedBatchId]);

  const loadTodayReservations = useCallback(async () => {
    const { startDate, endDate } = getLocalDayBoundsMs();
    setTodayReservationsLoading(true);
    setTodayReservationsError("");
    try {
      qTrace("reservations", {
        todayStartIso: startDate.toISOString(),
        todayEndIso: endDate.toISOString(),
        orderBy: "preferredWindow.latestDate:asc",
        limit: TODAY_RESERVATION_LIMIT,
      });
      const reservationsQuery = query(
        collection(db, "reservations"),
        where("preferredWindow.latestDate", ">=", startDate),
        where("preferredWindow.latestDate", "<", endDate),
        orderBy("preferredWindow.latestDate", "asc"),
        limit(TODAY_RESERVATION_LIMIT)
      );
      const snap = await getDocs(reservationsQuery);
      const ownerUids = Array.from(
        new Set(
          snap.docs
            .map((docSnap) => firstNonBlankString((docSnap.data() as { ownerUid?: unknown }).ownerUid))
            .filter(Boolean)
        )
      ).slice(0, 10);
      const ownerNameByUid = new Map<string, string>();
      if (ownerUids.length > 0) {
        try {
          const usersSnap = await getDocs(
            query(collection(db, "users"), where(documentId(), "in", ownerUids), limit(ownerUids.length))
          );
          usersSnap.docs.forEach((docSnap) => {
            const data = docSnap.data();
            const displayName = firstNonBlankString(data.displayName, data.name, data.fullName);
            if (displayName) ownerNameByUid.set(docSnap.id, displayName);
          });
        } catch {
          // Name lookup is best-effort; reservation rows still render with uid fallback.
        }
      }
      const rows: TodayReservationRow[] = snap.docs
        .map((docSnap) => {
          const raw = (docSnap.data() ?? {}) as Record<string, unknown>;
          const reservation = normalizeReservationRecord(docSnap.id, raw as Partial<ReservationRecord>);
          const preferredAtMs = toTsMs(reservation.preferredWindow?.latestDate);
          const createdAtMs = toTsMs(reservation.createdAt);
          const updatedAtMs = toTsMs(reservation.updatedAt);
          const timeMs = preferredAtMs || createdAtMs || updatedAtMs || 0;
          const ownerUid = firstNonBlankString(raw.ownerUid);
          const pieceCount = Array.isArray(reservation.pieces)
            ? reservation.pieces.reduce((sum, piece) => {
                const next =
                  typeof piece.pieceCount === "number" && Number.isFinite(piece.pieceCount)
                    ? Math.max(1, Math.round(piece.pieceCount))
                    : 1;
                return sum + next;
              }, 0)
            : 0;
          const shelfCount =
            typeof reservation.estimatedHalfShelves === "number" && Number.isFinite(reservation.estimatedHalfShelves)
              ? Math.max(1, Math.round(reservation.estimatedHalfShelves))
              : 1;
          const itemCount = pieceCount > 0 ? pieceCount : shelfCount;
          const displayName =
            firstNonBlankString(raw.displayName, raw.ownerName, raw.clientName, raw.name) ||
            ownerNameByUid.get(ownerUid) ||
            (ownerUid ? `Member ${ownerUid.slice(0, 6)}` : "Member");
          const notes = firstNonBlankString(reservation.notes?.general, reservation.staffNotes, raw.staffNotes, raw.notes);
          return {
            id: reservation.id,
            ownerUid,
            displayName,
            timeMs,
            status: reservationStatusLabel(reservation.status),
            itemCount,
            visitType: reservationVisitTypeLabel(reservation),
            notes,
          } satisfies TodayReservationRow;
        })
        .sort((a, b) => a.timeMs - b.timeMs || a.displayName.localeCompare(b.displayName));
      setTodayReservations(rows);
    } catch (err: unknown) {
      setTodayReservations([]);
      setTodayReservationsError(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      setTodayReservationsLoading(false);
    }
  }, [qTrace]);

  const loadSelectedBatchDetails = useCallback(
    async (batchId: string) => {
      if (!batchId) {
        setBatchPieces([]);
        setBatchTimeline([]);
        setBatchDetailError("");
        setBatchDetailBusy(false);
        return;
      }
      setBatchDetailBusy(true);
      setBatchDetailError("");
      try {
        qTrace("batches/{batchId}/pieces", { batchId, orderBy: "updatedAt:desc", limit: 120 });
        qTrace("batches/{batchId}/timeline", { batchId, orderBy: "at:desc", limit: 80 });
        const [piecesSnap, timelineSnap] = await Promise.all([
          getDocs(query(collection(db, "batches", batchId, "pieces"), orderBy("updatedAt", "desc"), limit(120))),
          getDocs(query(collection(db, "batches", batchId, "timeline"), orderBy("at", "desc"), limit(80))),
        ]);
        setBatchPieces(
          piecesSnap.docs.map((docSnap) => {
            const data = docSnap.data();
            return {
              id: docSnap.id,
              pieceCode: str(data.pieceCode, docSnap.id),
              shortDesc: str(data.shortDesc, "-"),
              stage: str(data.stage, "-"),
              wareCategory: str(data.wareCategory, "-"),
              isArchived: bool(data.isArchived),
              updatedAtMs: toTsMs(data.updatedAt),
            } satisfies BatchPieceRecord;
          })
        );
        setBatchTimeline(
          timelineSnap.docs.map((docSnap) => {
            const data = docSnap.data();
            return {
              id: docSnap.id,
              type: str(data.type, "event"),
              actorName: str(data.actorName, str(data.actorUid, "-")),
              kilnName: str(data.kilnName, "-"),
              notes: str(data.notes, ""),
              atMs: toTsMs(data.at),
            } satisfies BatchTimelineRecord;
          })
        );
      } catch (err) {
        setBatchDetailError(err instanceof Error ? err.message : String(err));
        setBatchPieces([]);
        setBatchTimeline([]);
      } finally {
        setBatchDetailBusy(false);
      }
    },
    [qTrace]
  );

  const loadFirings = useCallback(async () => {
    setFiringsLoading(true);
    setFiringsError("");
    try {
      qTrace("kilnFirings", { orderBy: "updatedAt:desc", limit: 50 });
      const snap = await getDocs(query(collection(db, "kilnFirings"), orderBy("updatedAt", "desc"), limit(50)));
      const next = snap.docs.map((d) => {
        const data = d.data();
        const batchIds = Array.isArray(data.batchIds) ? data.batchIds : [];
        const pieceIds = Array.isArray(data.pieceIds) ? data.pieceIds : [];
        return {
          id: d.id,
          title: str(data.title, "Kiln firing"),
          kilnName: str(data.kilnName, str(data.kilnId, "Kiln")),
          kilnId: str(data.kilnId),
          status: str(data.status, "scheduled"),
          cycleType: str(data.cycleType, "unknown"),
          confidence: str(data.confidence, "estimated"),
          startAtMs: toTsMs(data.startAt),
          endAtMs: toTsMs(data.endAt),
          unloadedAtMs: toTsMs(data.unloadedAt),
          batchCount: batchIds.length,
          pieceCount: pieceIds.length,
          notes: str(data.notes, ""),
          updatedAtMs: toTsMs(data.updatedAt),
        } satisfies FiringRecord;
      });
      setFirings(next);
      if (!selectedFiringId && next[0]) {
        setSelectedFiringId(next[0].id);
      }
    } catch (err: unknown) {
      setFirings([]);
      setFiringsError(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      setFiringsLoading(false);
    }
  }, [qTrace, selectedFiringId]);

const loadEvents = useCallback(async () => {
    let next: EventRecord[] = [];
    if (hasFunctionsAuthMismatch) {
      qTrace("events", { limit: 200, fallback: "firestore" });
      const snap = await getDocs(query(collection(db, "events"), limit(200)));
      next = snap.docs.map((d) => {
        const e = d.data();
        return {
          id: d.id,
          title: str(e.title, "Untitled event"),
          status: str(e.status, "draft"),
          startAt: str(e.startAt, "-"),
          startAtMs: toTsMs(e.startAt),
          endAtMs: toTsMs(e.endAt),
          remainingCapacity: num(e.remainingCapacity, 0),
          capacity: num(e.capacity, 0),
          waitlistCount: num(e.waitlistCount, 0),
          location: str(e.location, "-"),
          priceCents: num(e.priceCents, 0),
          lastStatusReason: str(e.lastStatusReason, ""),
          lastStatusChangedAtMs: toTsMs(e.lastStatusChangedAt),
        } satisfies EventRecord;
      });
    } else {
      const resp = await client.postJson<{ events?: Array<Record<string, unknown>> }>("listEvents", {
        includeDrafts: true,
        includeCancelled: true,
      });
      next = (resp.events ?? []).map((e) => ({
        id: str(e.id),
        title: str(e.title, "Untitled event"),
        status: str(e.status, "draft"),
        startAt: str(e.startAt, "-"),
        startAtMs: toTsMs(e.startAt),
        endAtMs: toTsMs(e.endAt),
        remainingCapacity: num(e.remainingCapacity, 0),
        capacity: num(e.capacity, 0),
        waitlistCount: num(e.waitlistCount, 0),
        location: str(e.location, "-"),
        priceCents: num(e.priceCents, 0),
        lastStatusReason: str(e.lastStatusReason, ""),
        lastStatusChangedAtMs: toTsMs(e.lastStatusChangedAt),
      } satisfies EventRecord));
    }
    setEvents(next);
    if (!selectedEventId && next[0]) setSelectedEventId(next[0].id);
  }, [client, hasFunctionsAuthMismatch, qTrace, selectedEventId]);

  const loadSignups = useCallback(
    async (eventId: string) => {
      if (!eventId) {
        setSignups([]);
        return;
      }
      let next: SignupRecord[] = [];
      if (hasFunctionsAuthMismatch) {
        qTrace("eventSignups", { eventId, limit: 250, fallback: "firestore" });
        const snap = await getDocs(query(collection(db, "eventSignups"), where("eventId", "==", eventId), limit(250)));
        next = snap.docs.map((d) => {
          const s = d.data();
          return {
            id: d.id,
            eventId: str(s.eventId, eventId),
            uid: str(s.uid),
            displayName: str(s.displayName, "Unknown"),
            email: str(s.email, "-"),
            status: str(s.status, "unknown"),
            paymentStatus: str(s.paymentStatus, "-"),
            createdAtMs: toTsMs(s.createdAt),
            checkedInAtMs: toTsMs(s.checkedInAt),
          } satisfies SignupRecord;
        });
      } else {
        const resp = await client.postJson<{ signups?: Array<Record<string, unknown>> }>("listEventSignups", {
          eventId,
          includeCancelled: true,
          includeExpired: true,
          limit: 200,
        });
        next = (resp.signups ?? []).map((s) => ({
          id: str(s.id),
          eventId: str(s.eventId, eventId),
          uid: str(s.uid),
          displayName: str(s.displayName, "Unknown"),
          email: str(s.email, "-"),
          status: str(s.status, "unknown"),
          paymentStatus: str(s.paymentStatus, "-"),
          createdAtMs: toTsMs(s.createdAt),
          checkedInAtMs: toTsMs(s.checkedInAt),
        } satisfies SignupRecord));
      }
      setSignups(next);
    },
    [client, hasFunctionsAuthMismatch, qTrace]
  );

  const loadCommerce = useCallback(async () => {
    setCommerceLoading(true);
    setCommerceError("");
    if (hasFunctionsAuthMismatch) {
      setSummary(null);
      setOrders([]);
      setUnpaidCheckIns([]);
      setReceipts([]);
      setCommerceError("Payment services are running in degraded mode while Functions/Auth emulators are mismatched.");
      setCommerceLoading(false);
      return;
    }
    try {
      const resp = await client.postJson<{
        summary?: typeof summary;
        unpaidCheckIns?: Array<Record<string, unknown>>;
        materialsOrders?: Array<Record<string, unknown>>;
        receipts?: Array<Record<string, unknown>>;
      }>("listBillingSummary", { limit: 60 });
      setSummary(resp.summary ?? null);
      setOrders(
        (resp.materialsOrders ?? []).map((o) => ({
          id: str(o.id),
          status: str(o.status, "unknown"),
          totalCents: num(o.totalCents, 0),
          currency: str(o.currency, "USD"),
          updatedAt: str(o.updatedAt, "-"),
          createdAt: str(o.createdAt, "-"),
          checkoutUrl: (() => {
            const raw = str(o.checkoutUrl, "");
            return raw || null;
          })(),
          pickupNotes: (() => {
            const raw = str(o.pickupNotes, "");
            return raw || null;
          })(),
          itemCount: Array.isArray(o.items) ? o.items.length : 0,
        }))
      );
      setUnpaidCheckIns(
        (resp.unpaidCheckIns ?? []).map((entry) => ({
          signupId: str(entry.signupId),
          eventId: str(entry.eventId),
          eventTitle: str(entry.eventTitle, "Event"),
          amountCents:
            typeof entry.amountCents === "number" && Number.isFinite(entry.amountCents)
              ? entry.amountCents
              : null,
          currency: (() => {
            const raw = str(entry.currency, "");
            return raw || null;
          })(),
          paymentStatus: (() => {
            const raw = str(entry.paymentStatus, "");
            return raw || null;
          })(),
          checkInMethod: (() => {
            const raw = str(entry.checkInMethod, "");
            return raw || null;
          })(),
          createdAt: (() => {
            const raw = str(entry.createdAt, "");
            return raw || null;
          })(),
          checkedInAt: (() => {
            const raw = str(entry.checkedInAt, "");
            return raw || null;
          })(),
        }))
      );
      setReceipts(
        (resp.receipts ?? []).map((entry) => ({
          id: str(entry.id),
          type: str(entry.type, "unknown"),
          title: str(entry.title, "Receipt"),
          amountCents: num(entry.amountCents, 0),
          currency: str(entry.currency, "USD"),
          createdAt: (() => {
            const raw = str(entry.createdAt, "");
            return raw || null;
          })(),
          paidAt: (() => {
            const raw = str(entry.paidAt, "");
            return raw || null;
          })(),
        }))
      );
    } catch (err: unknown) {
      setSummary(null);
      setOrders([]);
      setUnpaidCheckIns([]);
      setReceipts([]);
      setCommerceError(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      setCommerceLoading(false);
    }
  }, [client, hasFunctionsAuthMismatch]);

  const loadSystemStats = useCallback(async () => {
    if (hasFunctionsAuthMismatch) {
      setIntegrationTokenCount(null);
      return;
    }
    const tokensResp = await client.postJson<{ tokens?: Array<Record<string, unknown>> }>(
      "listIntegrationTokens",
      {}
    );
    const tokens = Array.isArray(tokensResp.tokens) ? tokensResp.tokens : [];
    setIntegrationTokenCount(tokens.length);
  }, [client, hasFunctionsAuthMismatch]);

  const loadLending = useCallback(async () => {
    const loadAdminItemsFromFirestore = async (): Promise<LendingAdminItemRecord[]> => {
      qTrace("libraryItems", { orderBy: "updatedAt:desc", limit: 200, fallback: "firestore_admin_items" });
      const snap = await getDocs(query(collection(db, "libraryItems"), orderBy("updatedAt", "desc"), limit(200)));
      return snap.docs
        .map((docSnap) =>
          normalizeLendingAdminItemRecord(
            docSnap.id,
            (docSnap.data() ?? {}) as Record<string, unknown>
          )
        )
        .filter((entry) => {
          const deleted = entry.rawDoc.deleted === true || entry.rawDoc.isDeleted === true || entry.rawDoc.softDeleted === true;
          const deletedAt = toTsMs(entry.rawDoc.deletedAt);
          return !deleted && deletedAt === 0;
        })
        .slice(0, 120);
    };

    let adminItems: LendingAdminItemRecord[] = [];
    if (hasFunctionsAuthMismatch) {
      adminItems = await loadAdminItemsFromFirestore();
    } else {
      try {
        qTrace("libraryItems", {
          route: V1_LIBRARY_ITEMS_LIST_FN,
          sort: "recently_added",
          page: 1,
          pageSize: LIBRARY_ITEMS_API_PAGE_SIZE,
        });
        const response = await client.postJson<{ data?: { items?: unknown[] }; items?: unknown[] }>(
          V1_LIBRARY_ITEMS_LIST_FN,
          {
            sort: "recently_added",
            page: 1,
            pageSize: LIBRARY_ITEMS_API_PAGE_SIZE,
          }
        );
        const apiItems = Array.isArray(response?.data?.items)
          ? response.data.items
          : Array.isArray(response?.items)
            ? response.items
            : null;
        if (apiItems) {
          adminItems = apiItems
            .map((entry, index) => {
              if (!entry || typeof entry !== "object") return null;
              return normalizeLendingAdminItemRecord(
                `library-item-api-${index + 1}`,
                entry as Record<string, unknown>
              );
            })
            .filter((entry): entry is LendingAdminItemRecord => Boolean(entry));
        } else {
          adminItems = await loadAdminItemsFromFirestore();
        }
      } catch {
        adminItems = await loadAdminItemsFromFirestore();
      }
    }
    setLibraryAdminItems(adminItems);
    setSelectedAdminItemId((current) => {
      if (current && adminItems.some((item) => item.id === current)) return current;
      return "";
    });

    qTrace("libraryRequests", { orderBy: "createdAt:desc", limit: 60 });
    const reqSnap = await getDocs(query(collection(db, "libraryRequests"), orderBy("createdAt", "desc"), limit(60)));
    setLibraryRequests(
      reqSnap.docs.map((d) => {
        const data = d.data();
        const title = firstNonBlankString(data.itemTitle, data.title, data.bookTitle);
        return {
          id: d.id,
          title: title || "Request",
          status: str(data.status, "open"),
          requesterUid: str(data.requesterUid, str(data.uid)),
          requesterName: str(data.requesterName, str(data.displayName, "Unknown")),
          requesterEmail: str(data.requesterEmail, str(data.email, "-")),
          createdAtMs: toTsMs(data.createdAt),
          rawDoc: (data ?? {}) as Record<string, unknown>,
        } satisfies LendingRequestRecord;
      })
    );

    qTrace("libraryLoans", { orderBy: "createdAt:desc", limit: 60 });
    const loanSnap = await getDocs(query(collection(db, "libraryLoans"), orderBy("createdAt", "desc"), limit(60)));
    setLibraryLoans(
      loanSnap.docs.map((d) => {
        const data = d.data();
        const title = firstNonBlankString(data.itemTitle, data.title, data.bookTitle);
        return {
          id: d.id,
          title: title || "Loan",
          status: str(data.status, "active"),
          borrowerUid: str(data.borrowerUid, str(data.uid)),
          borrowerName: str(data.borrowerName, str(data.displayName, "Unknown")),
          borrowerEmail: str(data.borrowerEmail, str(data.email, "-")),
          createdAtMs: toTsMs(data.createdAt),
          dueAtMs: toTsMs(data.dueAt),
          returnedAtMs: toTsMs(data.returnedAt),
          rawDoc: (data ?? {}) as Record<string, unknown>,
        } satisfies LendingLoanRecord;
      })
    );

    let coverSnap;
    try {
      qTrace("libraryItems", { where: "needsCoverReview==true", limit: 80 });
      coverSnap = await getDocs(
        query(collection(db, "libraryItems"), where("needsCoverReview", "==", true), limit(80))
      );
    } catch {
      qTrace("libraryItems", { orderBy: "updatedAt:desc", limit: 160, fallback: "client_filter_cover_review" });
      coverSnap = await getDocs(query(collection(db, "libraryItems"), orderBy("updatedAt", "desc"), limit(160)));
    }

    const coverRows = coverSnap.docs
      .map((d) => {
        const data = d.data();
        const title = firstNonBlankString(data.itemTitle, data.title, data.bookTitle);
        return {
          id: d.id,
          title: title || "Library item",
          coverUrl: (() => {
            const raw = str(data.coverUrl, "");
            return raw || null;
          })(),
          coverQualityStatus: str(data.coverQualityStatus, "needs_review"),
          coverQualityReason: (() => {
            const raw = str(data.coverQualityReason, "");
            return raw || null;
          })(),
          updatedAtMs: toTsMs(data.updatedAt),
          rawDoc: (data ?? {}) as Record<string, unknown>,
        } satisfies LendingCoverReviewRecord;
      })
      .filter((entry) => {
        const rawNeedsReview = entry.rawDoc.needsCoverReview === true;
        return rawNeedsReview || entry.coverQualityStatus === "needs_review" || entry.coverQualityStatus === "missing";
      })
      .slice(0, 80);
    setLibraryCoverReviews(coverRows);

    const normalizeRecommendationRow = (
      data: Record<string, unknown>,
      fallbackId: string
    ): LendingRecommendationRecord => {
      const firstAuthorFromArray =
        Array.isArray(data.authors) && data.authors.length > 0 ? firstNonBlankString(data.authors[0]) : "";
      const title = firstNonBlankString(data.itemTitle, data.title, data.bookTitle);
      const recommendationId = firstNonBlankString(data.id, data.recommendationId, fallbackId) || fallbackId;
      return {
        id: recommendationId,
        title: title || "Untitled recommendation",
        author: firstNonBlankString(data.author, firstAuthorFromArray),
        isbn: firstNonBlankString(data.isbn, data.isbn13, data.isbn10),
        moderationStatus: firstNonBlankString(data.moderationStatus, data.status) || "pending_review",
        recommenderUid: firstNonBlankString(data.recommenderUid, data.recommendedByUid, data.uid),
        recommenderName: firstNonBlankString(data.recommenderName, data.recommendedByName, data.displayName),
        rationale: firstNonBlankString(data.rationale, data.reason, data.note),
        createdAtMs: maxMs(toTsMs(data.createdAt), toTsMs(data.createdAtIso)),
        updatedAtMs: maxMs(toTsMs(data.updatedAt), toTsMs(data.updatedAtIso), toTsMs(data.moderatedAt)),
        rawDoc: data,
      };
    };

    const loadRecommendationsFromFirestore = async (): Promise<LendingRecommendationRecord[]> => {
      qTrace("libraryRecommendations", { orderBy: "createdAt:desc", limit: 120, fallback: "firestore" });
      const snap = await getDocs(
        query(collection(db, "libraryRecommendations"), orderBy("createdAt", "desc"), limit(120))
      );
      return snap.docs.map((docSnap) => {
        const data = (docSnap.data() ?? {}) as Record<string, unknown>;
        return normalizeRecommendationRow(data, docSnap.id);
      });
    };

    let recommendationRows: LendingRecommendationRecord[] = [];
    if (hasFunctionsAuthMismatch) {
      recommendationRows = await loadRecommendationsFromFirestore();
    } else {
      try {
        qTrace("libraryRecommendations", { route: V1_LIBRARY_RECOMMENDATIONS_LIST_FN, limit: LIBRARY_RECOMMENDATIONS_API_LIMIT });
        const response = await client.postJson<LibraryRecommendationsListResponse>(
          V1_LIBRARY_RECOMMENDATIONS_LIST_FN,
          { limit: LIBRARY_RECOMMENDATIONS_API_LIMIT }
        );
        const apiRows = Array.isArray(response?.data?.recommendations)
          ? response.data.recommendations
          : Array.isArray((response as { recommendations?: unknown }).recommendations)
            ? ((response as { recommendations?: unknown[] }).recommendations ?? [])
            : null;
        if (apiRows) {
          recommendationRows = apiRows
            .map((entry, index) => {
              if (!entry || typeof entry !== "object") return null;
              return normalizeRecommendationRow(
                entry as Record<string, unknown>,
                `recommendation-api-${index + 1}`
              );
            })
            .filter((entry): entry is LendingRecommendationRecord => Boolean(entry));
        } else {
          recommendationRows = await loadRecommendationsFromFirestore();
        }
      } catch {
        recommendationRows = await loadRecommendationsFromFirestore();
      }
    }
    setLibraryRecommendations(recommendationRows.slice(0, 120));

    const normalizeTagSubmissionRow = (
      data: Record<string, unknown>,
      fallbackId: string
    ): LendingTagSubmissionRecord => {
      const itemTitle = firstNonBlankString(data.itemTitle, data.title, data.bookTitle);
      return {
        id: fallbackId,
        itemId: firstNonBlankString(data.itemId),
        itemTitle: itemTitle || "Library item",
        tag: firstNonBlankString(data.tag),
        normalizedTag: firstNonBlankString(data.normalizedTag),
        status: firstNonBlankString(data.status) || "pending",
        submittedByUid: firstNonBlankString(data.submittedByUid, data.uid),
        submittedByName: firstNonBlankString(data.submittedByName, data.displayName),
        createdAtMs: maxMs(toTsMs(data.createdAt), toTsMs(data.createdAtIso)),
        updatedAtMs: maxMs(toTsMs(data.updatedAt), toTsMs(data.updatedAtIso)),
        rawDoc: data,
      };
    };

    qTrace("libraryTagSubmissions", { orderBy: "createdAt:desc", limit: 160 });
    const tagSubmissionSnap = await getDocs(
      query(collection(db, "libraryTagSubmissions"), orderBy("createdAt", "desc"), limit(160))
    );
    const tagSubmissionRows = tagSubmissionSnap.docs
      .map((docSnap) =>
        normalizeTagSubmissionRow((docSnap.data() ?? {}) as Record<string, unknown>, docSnap.id)
      )
      .slice(0, 160);
    setLibraryTagSubmissions(tagSubmissionRows);

    const snapshot = buildLibraryPhaseMetricsSnapshot(
      getRecentRequestTelemetry(LIBRARY_PHASE_METRICS_MAX_ENTRIES),
      Date.now(),
      LIBRARY_PHASE_METRICS_WINDOW_MINUTES
    );
    setLibraryPhaseMetricsSnapshot(snapshot);
    setLibraryPhaseMetricsStatus(
      `Phase metrics snapshot refreshed ${when(Date.parse(snapshot.generatedAtIso))}.`
    );

    if (hasFunctionsAuthMismatch) {
      setExternalLookupPolicyStatus(
        "Provider policy controls require function auth. Enable `VITE_USE_AUTH_EMULATOR=true` or point `VITE_FUNCTIONS_BASE_URL` to production."
      );
      setLibraryRolloutPhaseStatus(
        "Rollout phase controls require function auth. Enable `VITE_USE_AUTH_EMULATOR=true` or point `VITE_FUNCTIONS_BASE_URL` to production."
      );
    } else {
      try {
        const response = await client.postJson<LibraryExternalLookupProviderConfigResponse>(
          V1_LIBRARY_EXTERNAL_LOOKUP_PROVIDER_CONFIG_GET_FN,
          {}
        );
        const data = response?.data ?? {};
        setExternalLookupPolicyOpenLibraryEnabled(data.openlibraryEnabled !== false);
        setExternalLookupPolicyGoogleBooksEnabled(data.googlebooksEnabled !== false);
        setExternalLookupPolicyCoverReviewGuardrailEnabled(data.coverReviewGuardrailEnabled !== false);
        setExternalLookupPolicyNote(str(data.note, ""));
        setExternalLookupPolicyUpdatedAtMs(num(data.updatedAtMs, 0));
        setExternalLookupPolicyUpdatedByUid(str(data.updatedByUid, ""));
        setExternalLookupPolicyStatus("");
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        setExternalLookupPolicyStatus(`Provider policy load failed: ${message}`);
      }

      try {
        const response = await client.postJson<LibraryRolloutConfigResponse>(
          V1_LIBRARY_ROLLOUT_CONFIG_GET_FN,
          {}
        );
        const data = response?.data ?? {};
        const nextPhase = normalizeLibraryRolloutPhase(data.phase, "phase_3_admin_full");
        setLibraryRolloutPhase(nextPhase);
        setLibraryRolloutMemberWritesEnabled(
          typeof data.memberWritesEnabled === "boolean"
            ? data.memberWritesEnabled
            : libraryRolloutMemberWritesEnabledForPhase(nextPhase)
        );
        setLibraryRolloutNote(str(data.note, ""));
        setLibraryRolloutUpdatedAtMs(num(data.updatedAtMs, 0));
        setLibraryRolloutUpdatedByUid(str(data.updatedByUid, ""));
        setLibraryRolloutPhaseStatus("");
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        setLibraryRolloutPhaseStatus(`Rollout phase load failed: ${message}`);
      }
    }
  }, [client, hasFunctionsAuthMismatch, qTrace]);

  const refreshLibraryPhaseMetricsSnapshot = useCallback(() => {
    const snapshot = buildLibraryPhaseMetricsSnapshot(
      getRecentRequestTelemetry(LIBRARY_PHASE_METRICS_MAX_ENTRIES),
      Date.now(),
      LIBRARY_PHASE_METRICS_WINDOW_MINUTES
    );
    setLibraryPhaseMetricsSnapshot(snapshot);
    setLibraryPhaseMetricsStatus(`Phase metrics snapshot refreshed ${when(Date.parse(snapshot.generatedAtIso))}.`);
  }, []);

  const libraryPhaseMetricsArtifact = useMemo<LibraryPhaseMetricsArtifact | null>(() => {
    if (!libraryPhaseMetricsSnapshot) return null;
    return {
      rolloutPhase: libraryRolloutPhase,
      rolloutLabel: libraryRolloutPhaseLabel(libraryRolloutPhase),
      memberWritesEnabled: libraryRolloutMemberWritesEnabled,
      generatedAtIso: libraryPhaseMetricsSnapshot.generatedAtIso,
      windowMinutes: libraryPhaseMetricsSnapshot.windowMinutes,
      summary: {
        requestCount: libraryPhaseMetricsSnapshot.requestCount,
        errorCount: libraryPhaseMetricsSnapshot.errorCount,
        conflictCount: libraryPhaseMetricsSnapshot.conflictCount,
        routeErrorCount: libraryPhaseMetricsSnapshot.routeErrorCount,
        errorRate: libraryPhaseMetricsSnapshot.errorRate,
        conflictRate: libraryPhaseMetricsSnapshot.conflictRate,
        p50LatencyMs: libraryPhaseMetricsSnapshot.p50LatencyMs,
        p95LatencyMs: libraryPhaseMetricsSnapshot.p95LatencyMs,
        maxLatencyMs: libraryPhaseMetricsSnapshot.maxLatencyMs,
      },
      endpoints: libraryPhaseMetricsSnapshot.endpoints,
    };
  }, [libraryPhaseMetricsSnapshot, libraryRolloutMemberWritesEnabled, libraryRolloutPhase]);

  const importLibraryIsbns = useCallback(
    async (isbns: string[], source: "csv" | "scanner"): Promise<ImportLibraryIsbnsResponse> => {
      let response: ImportLibraryIsbnsResponse | null = null;
      try {
        const v1Response = await client.postJson<{ data?: ImportLibraryIsbnsResponse }>(
          V1_LIBRARY_ITEMS_IMPORT_ISBNS_FN,
          {
            isbns,
            source,
          }
        );
        if (v1Response?.data) {
          response = v1Response.data;
        }
      } catch {
        response = null;
      }
      if (!response) {
        response = await client.postJson<ImportLibraryIsbnsResponse>("importLibraryIsbns", {
          isbns,
          source,
        });
      }
      return response;
    },
    [client]
  );

  const handleLendingIsbnFile = useCallback(async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      setIsbnInput(text);
      setIsbnImportError("");
      setIsbnImportStatus(`Loaded ${file.name}. Review and import when ready.`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setIsbnImportError(`Failed to read file: ${message}`);
    }
  }, []);

  const handleLendingIsbnImport = useCallback(async () => {
    if (isbnImportBusy) return;
    setIsbnImportStatus("");
    setIsbnImportError("");
    if (hasFunctionsAuthMismatch) {
      setIsbnImportError(
        "ISBN import requires function auth. Enable `VITE_USE_AUTH_EMULATOR=true` or point `VITE_FUNCTIONS_BASE_URL` to production."
      );
      return;
    }
    const isbns = parseList(isbnInput);
    if (isbns.length === 0) {
      setIsbnImportError("Paste at least one ISBN (comma or newline separated).");
      return;
    }
    setIsbnImportBusy(true);
    try {
      const response = await importLibraryIsbns(isbns, "csv");
      const errorCount = response.errors?.length ?? 0;
      setIsbnImportStatus(`Imported ${response.created} new, updated ${response.updated}. ${errorCount} errors.`);
      setIsbnInput("");
      track("staff_lending_isbn_import", {
        source: "csv",
        requested: isbns.length,
        created: response.created,
        updated: response.updated,
        errors: errorCount,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setIsbnImportError(message);
    } finally {
      await loadLending();
      setIsbnImportBusy(false);
    }
  }, [hasFunctionsAuthMismatch, importLibraryIsbns, isbnImportBusy, isbnInput, loadLending]);

  const handleLendingIsbnScanSubmit = useCallback(async () => {
    if (isbnScanBusy) return;
    setIsbnScanStatus("");
    if (hasFunctionsAuthMismatch) {
      setIsbnScanStatus(
        "Scanner check-in requires function auth. Enable `VITE_USE_AUTH_EMULATOR=true` or point `VITE_FUNCTIONS_BASE_URL` to production."
      );
      return;
    }
    const raw = isbnScanInput.trim();
    if (!raw) {
      setIsbnScanStatus("Scan an ISBN first.");
      return;
    }
    setIsbnScanBusy(true);
    try {
      const response = await importLibraryIsbns([raw], "scanner");
      const errorCount = response.errors?.length ?? 0;
      setIsbnScanStatus(`Imported ${response.created} new, updated ${response.updated}. ${errorCount} errors.`);
      setIsbnScanInput("");
      track("staff_lending_isbn_import", {
        source: "scanner",
        requested: 1,
        created: response.created,
        updated: response.updated,
        errors: errorCount,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setIsbnScanStatus(message);
    } finally {
      await loadLending();
      setIsbnScanBusy(false);
    }
  }, [hasFunctionsAuthMismatch, importLibraryIsbns, isbnScanBusy, isbnScanInput, loadLending]);

  const handleSelectLendingAdminItem = useCallback((item: unknown) => {
    if (!item || typeof item !== "object") return;
    const lendingItem = item as LendingAdminItemRecord;
    setSelectedAdminItemId(lendingItem.id);
    setLendingAdminItemDraft(buildLendingAdminDraftFromItem(lendingItem));
    setLendingAdminItemDeleteConfirmInput("");
    setLendingAdminItemError("");
    setLendingAdminItemStatus("");
    setLendingAdminIsbnResolveStatus("");
  }, []);

  const handleStartLendingAdminItemCreate = useCallback(() => {
    setSelectedAdminItemId("");
    setLendingAdminItemDraft(makeEmptyLendingAdminItemDraft());
    setLendingAdminItemDeleteConfirmInput("");
    setLendingAdminItemError("");
    setLendingAdminItemStatus("Creating a new library item draft.");
    setLendingAdminIsbnResolveStatus("");
  }, []);

  const handleLendingAdminResolveIsbn = useCallback(async () => {
    if (lendingAdminIsbnResolveBusy) return;
    setLendingAdminIsbnResolveStatus("");
    setLendingAdminItemError("");
    const cleaned = cleanIsbnToken(lendingAdminItemDraft.isbn);
    if (!cleaned) {
      setLendingAdminIsbnResolveStatus("Enter an ISBN first.");
      return;
    }

    if (hasFunctionsAuthMismatch) {
      setLendingAdminIsbnResolveStatus(
        "ISBN resolve requires function auth. Enable `VITE_USE_AUTH_EMULATOR=true` or point `VITE_FUNCTIONS_BASE_URL` to production."
      );
      return;
    }

    setLendingAdminIsbnResolveBusy(true);
    try {
      const tryApplyMetadata = (candidate: Record<string, unknown> | null, sourceHint: string): boolean => {
        if (!candidate) return false;
        const identifiers = record(candidate.identifiers);
        const authors = Array.isArray(candidate.authors)
          ? candidate.authors.filter((entry): entry is string => typeof entry === "string")
          : [];
        const authorFallback = firstNonBlankString(candidate.author);
        const resolvedIsbn13 = firstNonBlankString(candidate.isbn13, identifiers.isbn13);
        const resolvedIsbn10 = firstNonBlankString(candidate.isbn10, identifiers.isbn10);
        const resolvedIsbn = firstNonBlankString(candidate.isbn, resolvedIsbn13, resolvedIsbn10, cleaned) || cleaned;
        setLendingAdminItemDraft((prev) => ({
          ...prev,
          title: firstNonBlankString(candidate.title, prev.title),
          subtitle: firstNonBlankString(candidate.subtitle, prev.subtitle),
          authorsCsv:
            authors.length > 0 ? authors.join(", ") : authorFallback ? authorFallback : prev.authorsCsv,
          description: firstNonBlankString(candidate.description, prev.description),
          publisher: firstNonBlankString(candidate.publisher, prev.publisher),
          publishedDate: firstNonBlankString(candidate.publishedDate, prev.publishedDate),
          isbn: resolvedIsbn,
          format: firstNonBlankString(candidate.format, prev.format),
          coverUrl: firstNonBlankString(candidate.coverUrl, prev.coverUrl),
          source: firstNonBlankString(candidate.source, sourceHint, prev.source),
        }));
        const normalizedResolved = cleanIsbnToken(resolvedIsbn);
        const duplicateIds = libraryAdminItems
          .filter((item) => item.id !== selectedAdminItemId)
          .filter((item) => {
            const existing = [item.isbn, item.isbn10, item.isbn13]
              .map((value) => cleanIsbnToken(value))
              .filter(Boolean);
            return normalizedResolved ? existing.includes(normalizedResolved) : false;
          })
          .map((item) => item.id);
        const duplicateNote =
          duplicateIds.length > 0
            ? ` Possible duplicate ISBN on ${duplicateIds.slice(0, 3).join(", ")}${duplicateIds.length > 3 ? "..." : ""}.`
            : "";
        setLendingAdminIsbnResolveStatus(
          `Resolved metadata from ${sourceHint || "ISBN provider"} for ${resolvedIsbn}.${duplicateNote}`
        );
        track("staff_lending_admin_isbn_resolve", {
          source: sourceHint || "unknown",
          isbn: resolvedIsbn,
          duplicateCount: duplicateIds.length,
        });
        return true;
      };

      let resolved = false;
      try {
        const response = await client.postJson<Record<string, unknown>>(
          V1_LIBRARY_ITEMS_RESOLVE_ISBN_FN,
          { isbn: cleaned }
        );
        const data = record((response as { data?: unknown }).data);
        resolved =
          tryApplyMetadata(
            (() => {
              const candidates = [data.item, data.resolvedItem, data.lookup, data.result, data.metadata];
              for (const value of candidates) {
                if (value && typeof value === "object") return value as Record<string, unknown>;
              }
              return null;
            })(),
            firstNonBlankString(data.source, record(data.item).source, record(data.lookup).source) ||
              "v1/library.items.resolveIsbn"
          ) || false;
      } catch {
        resolved = false;
      }

      if (!resolved) {
        const response = await client.postJson<LibraryExternalLookupResponse>(
          V1_LIBRARY_EXTERNAL_LOOKUP_FN,
          { q: cleaned, limit: 6 }
        );
        const items = Array.isArray(response?.data?.items)
          ? response.data.items.map((entry) => record(entry))
          : [];
        const normalizedSearch = cleanIsbnToken(cleaned);
        const best =
          items.find((entry) => {
            const identifiers = record(entry.identifiers);
            const candidates = [
              firstNonBlankString(entry.isbn13, identifiers.isbn13),
              firstNonBlankString(entry.isbn10, identifiers.isbn10),
            ]
              .map((value) => cleanIsbnToken(value))
              .filter(Boolean);
            return normalizedSearch ? candidates.includes(normalizedSearch) : false;
          }) ?? items[0];
        if (!best || !tryApplyMetadata(best, firstNonBlankString(best.source, best.sourceLabel, "external_lookup"))) {
          setLendingAdminIsbnResolveStatus(`No metadata results for ISBN ${cleaned}.`);
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setLendingAdminIsbnResolveStatus(`ISBN resolve failed: ${message}`);
    } finally {
      setLendingAdminIsbnResolveBusy(false);
    }
  }, [
    client,
    hasFunctionsAuthMismatch,
    lendingAdminIsbnResolveBusy,
    lendingAdminItemDraft.isbn,
    libraryAdminItems,
    selectedAdminItemId,
  ]);

  const handleLendingAdminSave = useCallback(async () => {
    if (lendingAdminItemBusy) return;
    setLendingAdminItemError("");
    setLendingAdminItemStatus("");
    const editing = Boolean(selectedAdminItemId);
    const title = lendingAdminItemDraft.title.trim();
    if (!title) {
      setLendingAdminItemError("Title is required.");
      return;
    }
    const authors = parseUniqueCsv(lendingAdminItemDraft.authorsCsv);
    if (authors.length === 0) {
      setLendingAdminItemError("Provide at least one author.");
      return;
    }
    const totalCopies = Number.parseInt(lendingAdminItemDraft.totalCopies.trim(), 10);
    if (!Number.isFinite(totalCopies) || totalCopies < 1) {
      setLendingAdminItemError("Total copies must be a whole number greater than 0.");
      return;
    }
    const availableCopies = Number.parseInt(lendingAdminItemDraft.availableCopies.trim(), 10);
    if (!Number.isFinite(availableCopies) || availableCopies < 0) {
      setLendingAdminItemError("Available copies must be a non-negative whole number.");
      return;
    }
    if (availableCopies > totalCopies) {
      setLendingAdminItemError("Available copies cannot exceed total copies.");
      return;
    }

    const isbn = inferIsbnVariants(lendingAdminItemDraft.isbn);
    const subjects = parseUniqueCsv(lendingAdminItemDraft.subjectsCsv);
    const techniques = parseUniqueCsv(lendingAdminItemDraft.techniquesCsv);
    const payload = buildLendingAdminApiPayload({
      draft: lendingAdminItemDraft,
      authors,
      subjects,
      techniques,
      isbn,
    });

    setLendingAdminItemBusy(true);
    let savedItemId = selectedAdminItemId;
    let usedFirestoreFallback = hasFunctionsAuthMismatch;
    let routeErrorMessage = "";
    try {
      if (!usedFirestoreFallback) {
        try {
          if (editing) {
            const response = await client.postJson<Record<string, unknown>>(
              V1_LIBRARY_ITEMS_UPDATE_FN,
              {
                itemId: selectedAdminItemId,
                ...payload,
              }
            );
            const data = record((response as { data?: unknown }).data);
            savedItemId =
              firstNonBlankString(
                data.itemId,
                record(data.item).id,
                (response as { itemId?: unknown }).itemId,
                record((response as { item?: unknown }).item).id,
                selectedAdminItemId
              ) || selectedAdminItemId;
          } else {
            const response = await client.postJson<Record<string, unknown>>(
              V1_LIBRARY_ITEMS_CREATE_FN,
              payload
            );
            const data = record((response as { data?: unknown }).data);
            savedItemId = firstNonBlankString(
              data.itemId,
              record(data.item).id,
              (response as { itemId?: unknown }).itemId,
              record((response as { item?: unknown }).item).id
            );
          }
        } catch (error: unknown) {
          routeErrorMessage = error instanceof Error ? error.message : String(error);
          if (shouldBlockLibraryFallback(error)) throw error;
          usedFirestoreFallback = true;
        }
      }

      if (usedFirestoreFallback) {
        const firestorePayload: Record<string, unknown> = {
          ...payload,
          techniques,
          updatedAt: serverTimestamp(),
          updatedByUid: user.uid,
        };
        if (isbn.primary) {
          firestorePayload.isbn = isbn.primary;
          firestorePayload.isbn_normalized = isbn.primary;
          firestorePayload.identifiers = {
            isbn10: isbn.isbn10,
            isbn13: isbn.isbn13,
          };
          if (isbn.isbn10) firestorePayload.isbn10 = isbn.isbn10;
          if (isbn.isbn13) firestorePayload.isbn13 = isbn.isbn13;
        }
        if (editing && selectedAdminItemId) {
          await setDoc(doc(db, "libraryItems", selectedAdminItemId), firestorePayload, { merge: true });
          savedItemId = selectedAdminItemId;
        } else {
          const fallbackId = isbn.primary ? `isbn-${isbn.primary}` : "";
          if (fallbackId) {
            await setDoc(
              doc(db, "libraryItems", fallbackId),
              {
                ...firestorePayload,
                createdAt: serverTimestamp(),
                createdByUid: user.uid,
              },
              { merge: true }
            );
            savedItemId = fallbackId;
          } else {
            const createdRef = await addDoc(collection(db, "libraryItems"), {
              ...firestorePayload,
              createdAt: serverTimestamp(),
              createdByUid: user.uid,
            });
            savedItemId = createdRef.id;
          }
        }
      }

      await loadLending();
      if (savedItemId) {
        const savedItem = libraryAdminItems.find((item) => item.id === savedItemId);
        if (savedItem) {
          handleSelectLendingAdminItem(savedItem);
        } else {
          setSelectedAdminItemId(savedItemId);
        }
      }
      setLendingAdminItemStatus(
        `${editing ? "Updated" : "Created"} library item "${title}". ${usedFirestoreFallback ? "Saved via Firestore fallback." : "Saved via API."}${
          routeErrorMessage ? ` API fallback reason: ${shortText(routeErrorMessage, 140)}.` : ""
        }`
      );
      track("staff_lending_admin_item_saved", {
        mode: editing ? "edit" : "create",
        usedFirestoreFallback,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setLendingAdminItemError(`Save failed: ${message}`);
    } finally {
      setLendingAdminItemBusy(false);
    }
  }, [
    client,
    handleSelectLendingAdminItem,
    hasFunctionsAuthMismatch,
    lendingAdminItemBusy,
    lendingAdminItemDraft,
    libraryAdminItems,
    loadLending,
    selectedAdminItemId,
    user.uid,
  ]);

  const handleLendingAdminDelete = useCallback(async () => {
    if (lendingAdminItemBusy || !selectedAdminItem) return;
    const expectedPhrase = `delete ${selectedAdminItem.id}`;
    if (lendingAdminItemDeleteConfirmInput.trim().toLowerCase() !== expectedPhrase) {
      setLendingAdminItemError(`Type "${expectedPhrase}" to confirm delete.`);
      return;
    }
    const ok = window.confirm(
      `Archive "${selectedAdminItem.title}" (${selectedAdminItem.id})? This removes it from active catalog listings.`
    );
    if (!ok) {
      setLendingAdminItemStatus("Delete cancelled.");
      return;
    }

    setLendingAdminItemBusy(true);
    setLendingAdminItemError("");
    setLendingAdminItemStatus("");
    let usedFirestoreFallback = hasFunctionsAuthMismatch;
    let routeErrorMessage = "";
    try {
      if (!usedFirestoreFallback) {
        try {
          await client.postJson<Record<string, unknown>>(
            V1_LIBRARY_ITEMS_DELETE_FN,
            {
              itemId: selectedAdminItem.id,
              note: "Archived from Staff -> Lending catalog admin.",
            }
          );
        } catch (error: unknown) {
          routeErrorMessage = error instanceof Error ? error.message : String(error);
          if (shouldBlockLibraryFallback(error)) throw error;
          usedFirestoreFallback = true;
        }
      }

      if (usedFirestoreFallback) {
        await setDoc(
          doc(db, "libraryItems", selectedAdminItem.id),
          {
            deleted: true,
            deletedAt: serverTimestamp(),
            deletedByUid: user.uid,
            status: "archived",
            updatedAt: serverTimestamp(),
            updatedByUid: user.uid,
          },
          { merge: true }
        );
      }

      await loadLending();
      setSelectedAdminItemId("");
      setLendingAdminItemDraft(makeEmptyLendingAdminItemDraft());
      setLendingAdminItemDeleteConfirmInput("");
      setLendingAdminItemStatus(
        `Deleted library item "${selectedAdminItem.title}". ${
          usedFirestoreFallback ? "Applied via Firestore fallback." : "Applied via API."
        }${routeErrorMessage ? ` API fallback reason: ${shortText(routeErrorMessage, 140)}.` : ""}`
      );
      track("staff_lending_admin_item_deleted", {
        usedFirestoreFallback,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setLendingAdminItemError(`Delete failed: ${message}`);
    } finally {
      setLendingAdminItemBusy(false);
    }
  }, [
    client,
    hasFunctionsAuthMismatch,
    lendingAdminItemBusy,
    lendingAdminItemDeleteConfirmInput,
    loadLending,
    selectedAdminItem,
    user.uid,
  ]);

  const handleCoverReviewResolve = useCallback(
    async (row: LendingCoverReviewRecord, mode: "approve_existing" | "set_replacement") => {
      if (coverReviewBusyById[row.id]) return;
      const draftUrl = (coverReviewDraftById[row.id] ?? "").trim();
      const currentCoverUrl = (row.coverUrl ?? "").trim();
      const currentCoverValid = isValidHttpUrl(currentCoverUrl);
      const draftCoverValid = isValidHttpUrl(draftUrl);
      if (mode === "approve_existing" && !currentCoverValid) {
        setCoverReviewErrorById((prev) => ({
          ...prev,
          [row.id]: "Current cover URL is missing or invalid. Add a replacement URL and use \"Use replacement URL\".",
        }));
        setCoverReviewStatus("Resolve blocked: replacement URL is required when the current cover is missing or invalid.");
        return;
      }
      if (mode === "set_replacement" && !draftUrl) {
        setCoverReviewErrorById((prev) => ({ ...prev, [row.id]: "Paste a replacement cover URL before submitting." }));
        setCoverReviewStatus("Paste a replacement cover URL before submitting.");
        return;
      }
      if (mode === "set_replacement" && !draftCoverValid) {
        setCoverReviewErrorById((prev) => ({ ...prev, [row.id]: "Replacement cover URL must be a valid http(s) URL." }));
        setCoverReviewStatus("Replacement cover URL is invalid. Use a full http(s) URL.");
        return;
      }

      setCoverReviewStatus("");
      setCoverReviewErrorById((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
      setCoverReviewBusyById((prev) => ({ ...prev, [row.id]: true }));
      try {
        const payload: Record<string, unknown> = {
          needsCoverReview: false,
          coverQualityStatus: "approved",
          coverQualityReason: null,
          coverQualityReviewedAt: serverTimestamp(),
          coverQualityReviewedByUid: user.uid,
          updatedAt: serverTimestamp(),
        };
        if (mode === "set_replacement") {
          payload.coverUrl = draftUrl;
        }
        await setDoc(doc(db, "libraryItems", row.id), payload, { merge: true });
        setCoverReviewStatus(
          mode === "set_replacement"
            ? `Cover updated and approved for ${row.title}.`
            : `Cover approved for ${row.title}.`
        );
        setCoverReviewDraftById((prev) => {
          const next = { ...prev };
          delete next[row.id];
          return next;
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        setCoverReviewStatus(`Cover review update failed: ${message}`);
      } finally {
        await loadLending();
        setCoverReviewBusyById((prev) => {
          const next = { ...prev };
          delete next[row.id];
          return next;
        });
      }
    },
    [coverReviewBusyById, coverReviewDraftById, loadLending, user.uid]
  );

  const handleRecommendationModeration = useCallback(
    async (row: LendingRecommendationRecord, action: "approve" | "hide" | "restore") => {
      if (recommendationModerationBusyById[row.id]) return;
      setRecommendationModerationStatus("");
      setRecommendationModerationBusyById((prev) => ({ ...prev, [row.id]: true }));

      const nextStatus = action === "hide" ? "hidden" : "approved";
      const actionLabel = action === "hide" ? "Hidden" : action === "restore" ? "Restored" : "Approved";
      const titleLabel = row.title || row.id;
      let usedFirestoreFallback = false;

      const applyFirestoreFallback = async () => {
        usedFirestoreFallback = true;
        await setDoc(
          doc(db, "libraryRecommendations", row.id),
          {
            moderationStatus: nextStatus,
            moderatedAt: serverTimestamp(),
            moderatedByUid: user.uid,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      };

      try {
        const payload = {
          recommendationId: row.id,
          action,
        };
        if (hasFunctionsAuthMismatch) {
          await applyFirestoreFallback();
        } else {
          try {
            await client.postJson<Record<string, unknown>>(
              V1_LIBRARY_RECOMMENDATIONS_MODERATE_FN,
              payload
            );
          } catch (error: unknown) {
            if (shouldBlockLibraryFallback(error)) throw error;
            try {
              await client.postJson<Record<string, unknown>>(
                LEGACY_LIBRARY_RECOMMENDATIONS_MODERATE_FN,
                payload
              );
            } catch (legacyError: unknown) {
              if (shouldBlockLibraryFallback(legacyError)) throw legacyError;
              await applyFirestoreFallback();
            }
          }
        }

        setLibraryRecommendations((prev) =>
          prev.map((entry) =>
            entry.id === row.id
              ? {
                  ...entry,
                  moderationStatus: nextStatus,
                  updatedAtMs: Date.now(),
                }
              : entry
          )
        );
        setRecommendationModerationStatus(
          `${actionLabel} recommendation "${titleLabel}". ${usedFirestoreFallback ? "Saved via Firestore fallback." : "Saved via API."}`
        );
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        setRecommendationModerationStatus(`Recommendation moderation failed: ${message}`);
      } finally {
        await loadLending();
        setRecommendationModerationBusyById((prev) => {
          const next = { ...prev };
          delete next[row.id];
          return next;
        });
      }
    },
    [client, hasFunctionsAuthMismatch, loadLending, recommendationModerationBusyById, user.uid]
  );

  const handleTagSubmissionApprove = useCallback(
    async (row: LendingTagSubmissionRecord) => {
      if (tagModerationBusyById[row.id]) return;
      const canonicalTagName = normalizeLibraryTagLabel(tagSubmissionApprovalDraftById[row.id] ?? row.tag);
      if (!canonicalTagName) {
        setTagModerationStatus("Canonical tag name is required.");
        return;
      }

      setTagModerationBusyById((prev) => ({ ...prev, [row.id]: true }));
      setTagModerationStatus("");
      try {
        let usedFirestoreFallback = false;
        if (hasFunctionsAuthMismatch) {
          usedFirestoreFallback = true;
          const now = serverTimestamp();
          await setDoc(
            doc(db, "libraryTagSubmissions", row.id),
            {
              status: "approved",
              canonicalTag: canonicalTagName,
              normalizedTag: canonicalTagName.replace(/[^a-z0-9]+/g, "-"),
              moderatedAt: now,
              moderatedByUid: user.uid,
              updatedAt: now,
            },
            { merge: true }
          );
        } else {
          const payload: LibraryTagSubmissionApproveRequest = {
            submissionId: row.id,
            canonicalTagName,
          };
          await client.postJson<LibraryTagSubmissionApproveResponse>(
            V1_LIBRARY_TAG_SUBMISSIONS_APPROVE_FN,
            payload
          );
        }

        setLibraryTagSubmissions((prev) =>
          prev.map((entry) =>
            entry.id === row.id
              ? {
                  ...entry,
                  status: "approved",
                  updatedAtMs: Date.now(),
                }
              : entry
          )
        );
        setTagSubmissionApprovalDraftById((prev) => {
          const next = { ...prev };
          delete next[row.id];
          return next;
        });
        setTagModerationStatus(
          `Approved tag suggestion "${row.tag}" for ${row.itemTitle}.${usedFirestoreFallback ? " Saved via Firestore fallback." : ""}`
        );
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        setTagModerationStatus(`Tag approval failed: ${message}`);
      } finally {
        await loadLending();
        setTagModerationBusyById((prev) => {
          const next = { ...prev };
          delete next[row.id];
          return next;
        });
      }
    },
    [client, hasFunctionsAuthMismatch, loadLending, tagModerationBusyById, tagSubmissionApprovalDraftById, user.uid]
  );

  const handleTagMerge = useCallback(async () => {
    if (tagMergeBusy) return;
    const sourceTagId = tagMergeSourceId.trim();
    const targetTagId = tagMergeTargetId.trim();
    if (!sourceTagId || !targetTagId) {
      setTagModerationStatus("Provide source and target tag IDs before merging.");
      return;
    }
    if (sourceTagId === targetTagId) {
      setTagModerationStatus("Source and target tag IDs must be different.");
      return;
    }

    setTagMergeBusy(true);
    setTagModerationStatus("");
    try {
      if (hasFunctionsAuthMismatch) {
        setTagModerationStatus(
          "Tag merge requires function auth. Enable `VITE_USE_AUTH_EMULATOR=true` or point `VITE_FUNCTIONS_BASE_URL` to production."
        );
        return;
      }
      const payload: LibraryTagMergeRequest = {
        sourceTagId,
        targetTagId,
        note: tagMergeNote.trim() || null,
      };
      const response = await client.postJson<LibraryTagMergeResponse>(
        V1_LIBRARY_TAGS_MERGE_FN,
        payload
      );
      const migratedItemTags = num(response?.data?.migratedItemTags, 0);
      const retargetedSubmissions = num(response?.data?.retargetedSubmissions, 0);
      setTagModerationStatus(
        `Merged ${sourceTagId} -> ${targetTagId}. Migrated ${migratedItemTags} item tags and retargeted ${retargetedSubmissions} submissions.`
      );
      setTagMergeSourceId("");
      setTagMergeTargetId("");
      setTagMergeNote("");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setTagModerationStatus(`Tag merge failed: ${message}`);
    } finally {
      await loadLending();
      setTagMergeBusy(false);
    }
  }, [client, hasFunctionsAuthMismatch, loadLending, tagMergeBusy, tagMergeNote, tagMergeSourceId, tagMergeTargetId]);

  const handleLoanMarkLost = useCallback(
    async (row: LendingLoanRecord) => {
      if (loanRecoveryBusy) return;
      if (hasFunctionsAuthMismatch) {
        setLoanRecoveryStatus(
          "Loan recovery actions require function auth. Enable `VITE_USE_AUTH_EMULATOR=true` or point `VITE_FUNCTIONS_BASE_URL` to production."
        );
        return;
      }
      const confirmMarkLost = window.confirm(
        `Mark "${row.title}" as lost? This updates loan recovery state and can trigger replacement workflows.`
      );
      if (!confirmMarkLost) {
        setLoanRecoveryStatus("Mark-lost cancelled.");
        return;
      }

      setLoanRecoveryBusy(true);
      setLoanRecoveryStatus("");
      try {
        const payload: LibraryLoanMarkLostRequest = {
          loanId: row.id,
          note: "Marked lost from Staff -> Lending recovery tools.",
        };
        const response = await client.postJson<LibraryLoanMarkLostResponse>(
          V1_LIBRARY_LOANS_MARK_LOST_FN,
          payload
        );
        const replacementValueCents = num(response?.data?.loan?.replacementValueCents, 0);
        setLoanRecoveryStatus(
          replacementValueCents > 0
            ? `Marked "${row.title}" as lost. Replacement value set to ${dollars(replacementValueCents)}.`
            : `Marked "${row.title}" as lost.`
        );
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        setLoanRecoveryStatus(`Mark-lost failed: ${message}`);
      } finally {
        await loadLending();
        setLoanRecoveryBusy(false);
      }
    },
    [client, hasFunctionsAuthMismatch, loadLending, loanRecoveryBusy]
  );

  const handleLoanAssessReplacementFee = useCallback(
    async (row: LendingLoanRecord) => {
      if (loanRecoveryBusy) return;
      if (hasFunctionsAuthMismatch) {
        setLoanRecoveryStatus(
          "Replacement-fee assessment requires function auth. Enable `VITE_USE_AUTH_EMULATOR=true` or point `VITE_FUNCTIONS_BASE_URL` to production."
        );
        return;
      }

      const amountDraft = loanReplacementFeeAmountInput.trim();
      let amountCents: number | null = null;
      if (amountDraft) {
        if (!/^\d+$/.test(amountDraft)) {
          setLoanRecoveryStatus("Replacement fee amount must be whole-number cents.");
          return;
        }
        amountCents = Number.parseInt(amountDraft, 10);
      }
      const amountLabel = amountCents !== null ? dollars(amountCents) : "the default replacement value";
      const confirmAssessment = window.confirm(
        `Assess replacement fee for "${row.title}" using ${amountLabel}?`
      );
      if (!confirmAssessment) {
        setLoanRecoveryStatus("Replacement fee assessment cancelled.");
        return;
      }

      setLoanRecoveryBusy(true);
      setLoanRecoveryStatus("");
      try {
        const payload: LibraryLoanAssessReplacementFeeRequest = {
          loanId: row.id,
          confirm: true,
          amountCents,
          note: null,
        };
        const response = await client.postJson<LibraryLoanAssessReplacementFeeResponse>(
          V1_LIBRARY_LOANS_ASSESS_REPLACEMENT_FEE_FN,
          payload
        );
        const assessedCents = num(response?.data?.fee?.amountCents, amountCents ?? 0);
        setLoanRecoveryStatus(
          assessedCents > 0
            ? `Replacement fee assessed for "${row.title}" at ${dollars(assessedCents)} (pending charge).`
            : `Replacement fee assessment recorded for "${row.title}".`
        );
        setLoanReplacementFeeAmountInput("");
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        setLoanRecoveryStatus(`Replacement fee assessment failed: ${message}`);
      } finally {
        await loadLending();
        setLoanRecoveryBusy(false);
      }
    },
    [client, hasFunctionsAuthMismatch, loanRecoveryBusy, loanReplacementFeeAmountInput, loadLending]
  );

  const handleLoanItemStatusOverride = useCallback(
    async (row: LendingLoanRecord) => {
      if (loanRecoveryBusy) return;
      if (hasFunctionsAuthMismatch) {
        setLoanRecoveryStatus(
          "Item status override requires function auth. Enable `VITE_USE_AUTH_EMULATOR=true` or point `VITE_FUNCTIONS_BASE_URL` to production."
        );
        return;
      }

      const itemId = firstNonBlankString(row.rawDoc.itemId, row.rawDoc.item_id, row.rawDoc.libraryItemId);
      if (!itemId) {
        setLoanRecoveryStatus("Selected loan is missing linked item ID.");
        return;
      }
      const confirmOverride = window.confirm(
        `Override item ${itemId} to "${loanOverrideStatusDraft}"? This may affect lending availability immediately.`
      );
      if (!confirmOverride) {
        setLoanRecoveryStatus("Item status override cancelled.");
        return;
      }

      setLoanRecoveryBusy(true);
      setLoanRecoveryStatus("");
      try {
        const payload: LibraryItemOverrideStatusRequest = {
          itemId,
          status: loanOverrideStatusDraft,
          note: loanOverrideNoteDraft.trim() || null,
        };
        const response = await client.postJson<LibraryItemOverrideStatusResponse>(
          V1_LIBRARY_ITEMS_OVERRIDE_STATUS_FN,
          payload
        );
        const nextStatus = firstNonBlankString(response?.data?.item?.status, loanOverrideStatusDraft);
        setLoanRecoveryStatus(`Overrode item ${itemId} to status "${nextStatus}".`);
        setLoanOverrideNoteDraft("");
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        setLoanRecoveryStatus(`Item status override failed: ${message}`);
      } finally {
        await loadLending();
        setLoanRecoveryBusy(false);
      }
    },
    [client, hasFunctionsAuthMismatch, loanOverrideNoteDraft, loanOverrideStatusDraft, loanRecoveryBusy, loadLending]
  );

  const runExternalLookupProviderProbe = useCallback(async () => {
    if (externalLookupProbeBusy) return;
    if (hasFunctionsAuthMismatch) {
      setExternalLookupProbeProviders([]);
      setExternalLookupProbeStatus(
        "Provider probe requires function auth. Enable `VITE_USE_AUTH_EMULATOR=true` or point `VITE_FUNCTIONS_BASE_URL` to production."
      );
      return;
    }
    const q = externalLookupProbeQuery.trim();
    if (!q) {
      setExternalLookupProbeStatus("Enter a probe query first.");
      return;
    }

    setExternalLookupProbeBusy(true);
    setExternalLookupProbeStatus("");
    try {
      const response = await client.postJson<LibraryExternalLookupResponse>(
        V1_LIBRARY_EXTERNAL_LOOKUP_FN,
        {
          q,
          limit: 6,
        }
      );
      const providers = Array.isArray(response?.data?.providers)
        ? response.data.providers.map((entry) => ({
            provider: str(entry.provider, "unknown"),
            ok: entry.ok === true,
            itemCount: num(entry.itemCount, 0),
            cached: entry.cached === true,
            disabled: entry.disabled === true,
          }))
        : [];
      const degraded = response?.data?.degraded === true;
      const policyLimited = response?.data?.policyLimited === true;
      setExternalLookupProbeProviders(providers);
      setExternalLookupProbeStatus(
        policyLimited
          ? "Probe completed with policy limits enabled (one or more providers are paused by staff controls)."
          : degraded
          ? "Probe completed in degraded mode (one or more providers failed or timed out)."
          : "Probe completed. Provider health looks normal."
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setExternalLookupProbeStatus(`Provider probe failed: ${message}`);
    } finally {
      setExternalLookupProbeBusy(false);
    }
  }, [client, externalLookupProbeBusy, externalLookupProbeQuery, hasFunctionsAuthMismatch]);

  const saveExternalLookupProviderPolicy = useCallback(async () => {
    if (externalLookupPolicyBusy) return;
    if (hasFunctionsAuthMismatch) {
      setExternalLookupPolicyStatus(
        "Provider policy update requires function auth. Enable `VITE_USE_AUTH_EMULATOR=true` or point `VITE_FUNCTIONS_BASE_URL` to production."
      );
      return;
    }

    setExternalLookupPolicyBusy(true);
    setExternalLookupPolicyStatus("");
    try {
      const payload: LibraryExternalLookupProviderConfigSetRequest = {
        openlibraryEnabled: externalLookupPolicyOpenLibraryEnabled,
        googlebooksEnabled: externalLookupPolicyGoogleBooksEnabled,
        coverReviewGuardrailEnabled: externalLookupPolicyCoverReviewGuardrailEnabled,
        note: externalLookupPolicyNote.trim() || null,
      };
      const response = await client.postJson<LibraryExternalLookupProviderConfigResponse>(
        V1_LIBRARY_EXTERNAL_LOOKUP_PROVIDER_CONFIG_SET_FN,
        payload
      );
      const data = response?.data ?? {};
      setExternalLookupPolicyOpenLibraryEnabled(data.openlibraryEnabled !== false);
      setExternalLookupPolicyGoogleBooksEnabled(data.googlebooksEnabled !== false);
      setExternalLookupPolicyCoverReviewGuardrailEnabled(data.coverReviewGuardrailEnabled !== false);
      setExternalLookupPolicyNote(str(data.note, ""));
      setExternalLookupPolicyUpdatedAtMs(num(data.updatedAtMs, Date.now()));
      setExternalLookupPolicyUpdatedByUid(str(data.updatedByUid, user.uid));
      setExternalLookupPolicyStatus("External lookup provider policy updated.");
      setExternalLookupProbeProviders([]);
      setExternalLookupProbeStatus("Run a provider probe to verify the new policy.");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setExternalLookupPolicyStatus(`Provider policy update failed: ${message}`);
    } finally {
      setExternalLookupPolicyBusy(false);
    }
  }, [
    client,
    externalLookupPolicyBusy,
    externalLookupPolicyCoverReviewGuardrailEnabled,
    externalLookupPolicyGoogleBooksEnabled,
    externalLookupPolicyNote,
    externalLookupPolicyOpenLibraryEnabled,
    hasFunctionsAuthMismatch,
    user.uid,
  ]);

  const saveLibraryRolloutPhasePolicy = useCallback(async () => {
    if (libraryRolloutPhaseBusy) return;
    if (hasFunctionsAuthMismatch) {
      setLibraryRolloutPhaseStatus(
        "Rollout phase update requires function auth. Enable `VITE_USE_AUTH_EMULATOR=true` or point `VITE_FUNCTIONS_BASE_URL` to production."
      );
      return;
    }

    setLibraryRolloutPhaseBusy(true);
    setLibraryRolloutPhaseStatus("");
    try {
      const payload: LibraryRolloutConfigSetRequest = {
        phase: libraryRolloutPhase,
        note: libraryRolloutNote.trim() || null,
      };
      const response = await client.postJson<LibraryRolloutConfigResponse>(
        V1_LIBRARY_ROLLOUT_CONFIG_SET_FN,
        payload
      );
      const data = response?.data ?? {};
      const nextPhase = normalizeLibraryRolloutPhase(data.phase, libraryRolloutPhase);
      const memberWritesEnabled =
        typeof data.memberWritesEnabled === "boolean"
          ? data.memberWritesEnabled
          : libraryRolloutMemberWritesEnabledForPhase(nextPhase);
      const phaseLabel = libraryRolloutPhaseLabel(nextPhase);
      setLibraryRolloutPhase(nextPhase);
      setLibraryRolloutMemberWritesEnabled(memberWritesEnabled);
      setLibraryRolloutNote(str(data.note, libraryRolloutNote.trim()));
      setLibraryRolloutUpdatedAtMs(num(data.updatedAtMs, Date.now()));
      setLibraryRolloutUpdatedByUid(str(data.updatedByUid, user.uid));
      setLibraryRolloutPhaseStatus(
        memberWritesEnabled
          ? `Library rollout phase updated to ${phaseLabel}. Member interactions are enabled.`
          : `Library rollout phase updated to ${phaseLabel}. Member interactions are paused.`
      );
      const snapshot = buildLibraryPhaseMetricsSnapshot(
        getRecentRequestTelemetry(LIBRARY_PHASE_METRICS_MAX_ENTRIES),
        Date.now(),
        LIBRARY_PHASE_METRICS_WINDOW_MINUTES
      );
      setLibraryPhaseMetricsSnapshot(snapshot);
      setLibraryPhaseMetricsStatus(
        `Phase metrics snapshot refreshed ${when(Date.parse(snapshot.generatedAtIso))}.`
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setLibraryRolloutPhaseStatus(`Rollout phase update failed: ${message}`);
    } finally {
      setLibraryRolloutPhaseBusy(false);
    }
  }, [
    client,
    hasFunctionsAuthMismatch,
    libraryRolloutNote,
    libraryRolloutPhase,
    libraryRolloutPhaseBusy,
    user.uid,
  ]);

  const loadReportOps = useCallback(async () => {
    qTrace("communityReports", { orderBy: "createdAt:desc", limit: 250 });
    const snap = await getDocs(query(collection(db, "communityReports"), orderBy("createdAt", "desc"), limit(250)));
    const now = Date.now();
    let open = 0;
    let highOpen = 0;
    let slaBreaches = 0;
    for (const row of snap.docs) {
      const data = row.data();
      const statusName = str(data.status, "open").toLowerCase();
      if (statusName !== "open") continue;
      open += 1;
      const severity = str(data.severity, "low").toLowerCase();
      const createdAtMs = toTsMs(data.createdAt);
      const ageMs = createdAtMs > 0 ? now - createdAtMs : 0;
      if (severity === "high") {
        highOpen += 1;
        if (ageMs > 24 * 60 * 60 * 1000) slaBreaches += 1;
      } else if (ageMs > 48 * 60 * 60 * 1000) {
        slaBreaches += 1;
      }
    }
    setReportOps({
      total: snap.size,
      open,
      highOpen,
      slaBreaches,
    });
  }, [qTrace]);

  const loadAutomationHealthDashboard = useCallback(async () => {
    type GithubWorkflowRunsResponse = {
      workflow_runs?: Array<{
        id?: number;
        html_url?: string;
        status?: string;
        conclusion?: string | null;
        created_at?: string;
        updated_at?: string;
        head_sha?: string;
        event?: string;
      }>;
    };
    type GithubIssueResponse = {
      number?: number;
      title?: string;
      html_url?: string;
      state?: string;
      updated_at?: string;
    };
    type GithubIssueComment = {
      body?: string;
      html_url?: string;
      created_at?: string;
    };

    setAutomationDashboard((prev) => ({
      ...prev,
      loading: true,
      error: "",
    }));

    const headers = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    const readJson = async <T,>(url: string): Promise<T> => {
      const response = await fetch(url, { headers });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`GitHub API ${response.status}: ${shortText(detail, 120) || response.statusText || "request failed"}`);
      }
      return (await response.json()) as T;
    };

    const now = Date.now();
    try {
      const workflows = await Promise.all(
        AUTOMATION_WORKFLOW_SOURCES.map(async (source): Promise<AutomationWorkflowRun> => {
          try {
            const url = `${GITHUB_API_BASE}/actions/workflows/${encodeURIComponent(source.workflowFile)}/runs?branch=main&per_page=1`;
            const payload = await readJson<GithubWorkflowRunsResponse>(url);
            const run = Array.isArray(payload.workflow_runs) ? payload.workflow_runs[0] : null;
            const createdAtMs = toIsoMs(run?.created_at);
            const updatedAtMs = toIsoMs(run?.updated_at);
            const status = str(run?.status, "unknown");
            const conclusion = str(run?.conclusion, "");
            return {
              key: source.key,
              label: source.label,
              workflowFile: source.workflowFile,
              outputHint: source.outputHint,
              runId: num(run?.id, 0),
              runUrl: str(run?.html_url, ""),
              status,
              conclusion,
              createdAtMs,
              updatedAtMs,
              headSha: str(run?.head_sha, ""),
              event: str(run?.event, ""),
              isStale: createdAtMs > 0 ? now - createdAtMs > AUTOMATION_STALE_MS : true,
              error: "",
            };
          } catch (error: unknown) {
            return {
              key: source.key,
              label: source.label,
              workflowFile: source.workflowFile,
              outputHint: source.outputHint,
              runId: 0,
              runUrl: "",
              status: "error",
              conclusion: "",
              createdAtMs: 0,
              updatedAtMs: 0,
              headSha: "",
              event: "",
              isStale: true,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        })
      );

      const issues = await Promise.all(
        AUTOMATION_ISSUE_SOURCES.map(async (source): Promise<AutomationIssueThread> => {
          try {
            const issueUrl = `${GITHUB_API_BASE}/issues/${source.issueNumber}`;
            const issue = await readJson<GithubIssueResponse>(issueUrl);
            const comments = await readJson<GithubIssueComment[]>(
              `${GITHUB_API_BASE}/issues/${source.issueNumber}/comments?per_page=100`
            );
            const latestComment = Array.isArray(comments) && comments.length > 0 ? comments[comments.length - 1] : null;
            return {
              key: source.key,
              title: source.title,
              issueNumber: num(issue.number, source.issueNumber),
              issueUrl: str(issue.html_url, ""),
              purpose: source.purpose,
              state: str(issue.state, "unknown"),
              updatedAtMs: toIsoMs(issue.updated_at),
              latestCommentAtMs: toIsoMs(latestComment?.created_at),
              latestCommentUrl: str(latestComment?.html_url, ""),
              latestCommentPreview: commentPreview(str(latestComment?.body, "")),
              error: "",
            };
          } catch (error: unknown) {
            return {
              key: source.key,
              title: source.title,
              issueNumber: source.issueNumber,
              issueUrl: "",
              purpose: source.purpose,
              state: "error",
              updatedAtMs: 0,
              latestCommentAtMs: 0,
              latestCommentUrl: "",
              latestCommentPreview: "",
              error: error instanceof Error ? error.message : String(error),
            };
          }
        })
      );

      setAutomationDashboard({
        loading: false,
        loadedAtMs: Date.now(),
        error: "",
        workflows,
        issues,
      });
    } catch (error: unknown) {
      setAutomationDashboard((prev) => ({
        ...prev,
        loading: false,
        loadedAtMs: Date.now(),
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, []);

  const loadAll = useCallback(async () => {
    const tasks: Array<Promise<unknown>> = [
      loadTodayReservations(),
      loadUsers(),
      loadBatches(),
      loadFirings(),
      loadLending(),
      loadEvents(),
      loadReportOps(),
      loadStudioBrainStatus(),
      loadAutomationHealthDashboard(),
    ];
    if (!hasFunctionsAuthMismatch) {
      tasks.push(loadCommerce(), loadSystemStats());
    } else {
      setSummary(null);
      setOrders([]);
      setUnpaidCheckIns([]);
      setReceipts([]);
      setIntegrationTokenCount(null);
    }
    await Promise.allSettled(tasks);
    if (selectedEventId) await loadSignups(selectedEventId);
  }, [hasFunctionsAuthMismatch, loadAutomationHealthDashboard, loadBatches, loadCommerce, loadEvents, loadFirings, loadLending, loadReportOps, loadSignups, loadStudioBrainStatus, loadSystemStats, loadTodayReservations, loadUsers, selectedEventId]);

  const loadCockpitModule = useCallback(async () => {
    await Promise.allSettled([
      loadTodayReservations(),
      loadUsers(),
      loadBatches(),
      loadFirings(),
      loadEvents(),
      loadLending(),
      loadReportOps(),
      loadStudioBrainStatus(),
      loadAutomationHealthDashboard(),
    ]);
    if (!hasFunctionsAuthMismatch) {
      await Promise.allSettled([loadCommerce(), loadSystemStats()]);
    }
  }, [
    hasFunctionsAuthMismatch,
    loadAutomationHealthDashboard,
    loadBatches,
    loadCommerce,
    loadEvents,
    loadFirings,
    loadLending,
    loadReportOps,
    loadStudioBrainStatus,
    loadSystemStats,
    loadTodayReservations,
    loadUsers,
  ]);

  const loadSystemModule = useCallback(async () => {
    if (!hasFunctionsAuthMismatch) {
      await loadSystemStats();
    }
    await loadStudioBrainStatus();
  }, [hasFunctionsAuthMismatch, loadStudioBrainStatus, loadSystemStats]);

  const loadModule = useCallback(async (target: ModuleKey) => {
    if (target === "reports") {
      await loadReportOps();
      return;
    }
    if (target === "cockpit" && cockpitTab === "reports") {
      await loadReportOps();
      return;
    }
    if (target === "system") {
      await loadSystemModule();
      return;
    }
    if (target === "events") {
      if (selectedEventId) {
        await loadSignups(selectedEventId);
      }
      await loadCockpitModule();
      return;
    }
    await loadCockpitModule();
  }, [cockpitTab, loadCockpitModule, loadReportOps, loadSignups, loadSystemModule, selectedEventId]);

  useEffect(() => {
    setStatus("Today Console loads key shift data automatically. Use Load current module for deeper module refreshes.");
  }, []);

  useEffect(() => {
    if (!selectedEventId) return;
    void run("signups", async () => await loadSignups(selectedEventId));
  }, [loadSignups, selectedEventId, run]);

  useEffect(() => {
    if (!studioBrainStatus) return;
    const previous = lastStudioBrainModeRef.current;
    const current = studioBrainStatus.mode;
    if (current === "disabled" || previous === "disabled") {
      lastStudioBrainModeRef.current = current;
      return;
    }
    const wasDegraded = previous === "degraded" || previous === "offline";
    const isDegraded = current === "degraded" || current === "offline";
    if (previous && previous !== current) {
      if (wasDegraded && !isDegraded) {
        void postStudioBrainDegradedEvent("exited", "degraded", "Studio Brain recovered.");
      } else if (isDegraded) {
        void postStudioBrainDegradedEvent(
          "entered",
          current === "offline" ? "offline" : "degraded",
          `${studioBrainStatus.reasonCode}: ${studioBrainStatus.reason}`
        );
      }
    }
    lastStudioBrainModeRef.current = current;
  }, [postStudioBrainDegradedEvent, studioBrainStatus]);

  useEffect(() => {
    if (!filteredEvents.length) {
      setSelectedEventId("");
      return;
    }
    if (selectedEventId && filteredEvents.some((event) => event.id === selectedEventId)) return;
    setSelectedEventId(filteredEvents[0].id);
  }, [filteredEvents, selectedEventId]);

  useEffect(() => {
    if (!filteredSignups.length) {
      setSelectedSignupId("");
      return;
    }
    if (selectedSignupId && filteredSignups.some((signup) => signup.id === selectedSignupId)) return;
    setSelectedSignupId(filteredSignups[0].id);
  }, [filteredSignups, selectedSignupId]);

  useEffect(() => {
    if (!filteredRequests.length) {
      setSelectedRequestId("");
      return;
    }
    if (selectedRequestId && filteredRequests.some((request) => request.id === selectedRequestId)) return;
    setSelectedRequestId(filteredRequests[0].id);
  }, [filteredRequests, selectedRequestId]);

  useEffect(() => {
    if (!filteredLoans.length) {
      setSelectedLoanId("");
      return;
    }
    if (selectedLoanId && filteredLoans.some((loan) => loan.id === selectedLoanId)) return;
    setSelectedLoanId(filteredLoans[0].id);
  }, [filteredLoans, selectedLoanId]);

  useEffect(() => {
    if (!selectedLoan) {
      setLoanOverrideStatusDraft("available");
      setLoanOverrideNoteDraft("");
      setLoanReplacementFeeAmountInput("");
      return;
    }
    const normalizedLoanStatus = normalizeLibraryItemOverrideStatus(selectedLoan.status || "");
    setLoanOverrideStatusDraft(
      normalizedLoanStatus === "archived" ? "available" : normalizedLoanStatus
    );
    setLoanOverrideNoteDraft("");
    setLoanReplacementFeeAmountInput("");
  }, [selectedLoan]);

  useEffect(() => {
    if (!selectedAdminItemId) return;
    if (libraryAdminItems.some((item) => item.id === selectedAdminItemId)) return;
    setSelectedAdminItemId("");
    setLendingAdminItemDraft(makeEmptyLendingAdminItemDraft());
    setLendingAdminItemDeleteConfirmInput("");
  }, [libraryAdminItems, selectedAdminItemId]);

  useEffect(() => {
    if (!selectedAdminItem) return;
    setLendingAdminItemDraft(buildLendingAdminDraftFromItem(selectedAdminItem));
    setLendingAdminItemDeleteConfirmInput("");
    setLendingAdminItemError("");
    setLendingAdminIsbnResolveStatus("");
  }, [selectedAdminItem]);

  useEffect(() => {
    if (!selectedMemberId || !shouldLoadMemberStats(moduleKey, cockpitTab)) return;
    void loadMemberOperationalStats(selectedMemberId);
  }, [cockpitTab, loadMemberOperationalStats, moduleKey, selectedMemberId]);

  useEffect(() => {
    if (!selectedMember) {
      setMemberEditDraft({
        displayName: "",
        membershipTier: "",
        kilnPreferences: "",
        staffNotes: "",
        reason: "",
      });
      return;
    }
    setMemberEditDraft({
      displayName: selectedMember.displayName || "",
      membershipTier: selectedMember.membershipTier || "",
      kilnPreferences: selectedMember.kilnPreferences || "",
      staffNotes: str(selectedMember.rawDoc.staffNotes, ""),
      reason: "",
    });
  }, [selectedMember]);

  const handleSaveMemberProfile = () => {
    if (!selectedMember) return;
    if (hasFunctionsAuthMismatch) {
      setError("Cannot save profile while local Functions/Auth emulators are mismatched.");
      return;
    }

    const nextDisplayName = memberEditDraft.displayName.trim();
    const nextMembershipTier = memberEditDraft.membershipTier.trim();
    const nextKilnPreferences = memberEditDraft.kilnPreferences.trim();
    const nextStaffNotes = memberEditDraft.staffNotes.trim();

    const patch: Record<string, string | null> = {};
    if (nextDisplayName !== selectedMember.displayName) patch.displayName = nextDisplayName || null;
    if (nextMembershipTier !== selectedMember.membershipTier) patch.membershipTier = nextMembershipTier || null;
    if (nextKilnPreferences !== selectedMember.kilnPreferences) patch.kilnPreferences = nextKilnPreferences || null;
    if (nextStaffNotes !== str(selectedMember.rawDoc.staffNotes, "")) patch.staffNotes = nextStaffNotes || null;

    if (Object.keys(patch).length === 0) {
      setStatus("No profile changes to save.");
      return;
    }

    void run("saveMemberProfile", async () => {
      await client.postJson("staffUpdateUserProfile", {
        uid: selectedMember.id,
        reason: memberEditDraft.reason.trim() || null,
        patch,
      });
      setStatus("Member profile updated.");
      await loadUsers();
      await loadMemberOperationalStats(selectedMember.id);
      setMemberEditDraft((prev) => ({ ...prev, reason: "" }));
    });
  };

  const createBatchCleanupPayload = useCallback(
    (mode: "preview" | "destructive", backendDispatchRequested: boolean): BatchCleanupPayload => {
      const generatedAt = new Date().toISOString();
      const runId = `staff-batch-cleanup-${generatedAt.replace(/\D/g, "").slice(0, 14)}-${batchCleanupSelectionCandidates.length}`;
      const reason = batchCleanupReason.trim() || "No cleanup reason provided.";
      const reasonCode = toReasonCode(batchCleanupReasonCodeInput, "ARTIFACT_BATCH_TRIAGE");
      const ticketRefs = parseList(batchCleanupTicketRefsInput);
      const targets = batchCleanupSelectionCandidates.map((entry) => ({
        batchId: entry.batchId,
        title: entry.title,
        status: entry.status,
        ownerUid: entry.ownerUid,
        isClosed: entry.isClosed,
        updatedAtMs: entry.updatedAtMs,
        category: entry.category,
        confidence: entry.confidence,
        dispositionHints: entry.dispositionHints,
        rationale: entry.rationale,
        riskFlags: entry.riskFlags,
      }));
      const countsByCategory: Record<string, number> = {};
      const countsByConfidence: Record<string, number> = {};
      const countsByDispositionHint: Record<string, number> = {};
      targets.forEach((target) => {
        countsByCategory[target.category] = (countsByCategory[target.category] || 0) + 1;
        countsByConfidence[target.confidence] = (countsByConfidence[target.confidence] || 0) + 1;
        target.dispositionHints.forEach((hint) => {
          countsByDispositionHint[hint] = (countsByDispositionHint[hint] || 0) + 1;
        });
      });
      return {
        mode,
        dryRun: mode !== "destructive",
        backendDispatchRequested: mode === "destructive" && backendDispatchRequested,
        previewOnly: mode !== "destructive" || !backendDispatchRequested,
        selectionMode: batchCleanupSelectionMode,
        selectedCount: targets.length,
        selectedBatchIds: targets.map((target) => target.batchId),
        countsByCategory,
        countsByConfidence,
        countsByDispositionHint,
        audit: {
          runId,
          generatedAt,
          operatorUid: user.uid,
          operatorEmail: user.email ?? null,
          operatorRole: staffAuthorityLabel,
          source: "staff_console",
          reasonCode,
          reason,
          ticketRefs,
          confirmationPhrase: batchCleanupConfirmPhraseInput.trim(),
        },
        targets,
      };
    },
    [
      batchCleanupConfirmPhraseInput,
      batchCleanupReason,
      batchCleanupReasonCodeInput,
      batchCleanupSelectionCandidates,
      batchCleanupSelectionMode,
      batchCleanupTicketRefsInput,
      staffAuthorityLabel,
      user.email,
      user.uid,
    ]
  );

  const handleGenerateBatchCleanupPreview = useCallback(() => {
    const payload = createBatchCleanupPayload("preview", false);
    setBatchCleanupPreviewPayload(payload);
    setBatchCleanupPreviewLog(buildBatchCleanupPreviewLog(payload));
    setStatus(
      `Generated dry-run cleanup preview for ${payload.selectedCount} triaged artifact batch${payload.selectedCount === 1 ? "" : "es"}.`
    );
  }, [createBatchCleanupPayload]);

  const handleRunBatchCleanupDestructive = useCallback(() => {
    if (batchCleanupSelectionCandidates.length === 0) {
      setError("No triaged artifact batches are selected for cleanup.");
      return;
    }
    if (!batchCleanupReason.trim()) {
      setError("Cleanup reason is required before preview/destructive actions.");
      return;
    }
    if (!canConfirmDestructiveCleanup) {
      setError(`Type "${expectedBatchCleanupConfirmationPhrase}" to confirm destructive cleanup payload generation.`);
      return;
    }
    void run("batchArtifactCleanup", async () => {
      const backendDispatchRequested = batchCleanupDispatchMode === "attempt_backend" && !hasFunctionsAuthMismatch;
      const payload = createBatchCleanupPayload("destructive", backendDispatchRequested);
      const previewLog = buildBatchCleanupPreviewLog(payload);
      setBatchCleanupPreviewPayload(payload);
      setBatchCleanupPreviewLog(previewLog);
      if (!backendDispatchRequested) {
        setStatus(
          `Preview mode: destructive payload prepared for ${payload.selectedCount} batch${payload.selectedCount === 1 ? "" : "es"}, but no record changes were executed.`
        );
        return;
      }
      try {
        const response = await client.postJson<Record<string, unknown>>("staffBatchArtifactCleanup", payload);
        setStatus(`Backend cleanup request submitted for ${payload.selectedCount} batch${payload.selectedCount === 1 ? "" : "es"}.`);
        setBatchCleanupPreviewLog(`${previewLog}\n\nbackendResponse:\n${safeJsonStringify(response)}`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const lowered = message.toLowerCase();
        const endpointMissing =
          lowered.includes("404") ||
          lowered.includes("not found") ||
          lowered.includes("missing") ||
          lowered.includes("cannot post");
        if (endpointMissing) {
          setBatchCleanupDispatchMode("preview_only");
          setStatus(
            `Preview mode fallback: backend endpoint staffBatchArtifactCleanup is unavailable. No destructive action was executed.`
          );
          setBatchCleanupPreviewLog(`${previewLog}\n\nbackendDispatchUnavailable:\n${message}`);
          return;
        }
        throw err;
      }
    });
  }, [
    batchCleanupDispatchMode,
    batchCleanupReason,
    batchCleanupSelectionCandidates.length,
    canConfirmDestructiveCleanup,
    client,
    createBatchCleanupPayload,
    expectedBatchCleanupConfirmationPhrase,
    hasFunctionsAuthMismatch,
    run,
  ]);

  const batchAction = (name: BatchActionName) => {
    if (!selectedBatchId) return;
    if (!batchActionAvailability[name]) {
      setError(`Action ${name} is not valid for current batch status (${selectedBatch?.status || "-"})`);
      return;
    }
    if (name === "pickedUpAndClose") {
      const ok = window.confirm("Close this batch as picked up? This is typically a terminal action.");
      if (!ok) return;
    }
    if (name === "continueJourney") {
      const ok = window.confirm(
        "Create a follow-up batch and continue this journey? This should be used after pickup/closure."
      );
      if (!ok) return;
    }
    void run(name, async () => {
      if (name === "continueJourney") {
        const resp = await client.postJson<{ batchId?: string; newBatchId?: string; existingBatchId?: string }>(name, {
          uid: selectedBatch?.ownerUid || user.uid,
          fromBatchId: selectedBatchId,
        });
        const maybeNewBatchId = str(resp.batchId) || str(resp.newBatchId) || str(resp.existingBatchId);
        if (maybeNewBatchId) {
          setSelectedBatchId(maybeNewBatchId);
        }
      } else if (name === "kilnLoad") {
        await client.postJson(name, {
          batchId: selectedBatchId,
          kilnId: kilnId.trim() || "studio-electric",
          notes: batchNotes.trim() || null,
        });
      } else {
        await client.postJson(name, { batchId: selectedBatchId, notes: batchNotes.trim() || null });
      }
      setStatus(`${name} succeeded`);
      await loadBatches();
      await loadFirings();
      await loadSelectedBatchDetails(selectedBatchId);
    });
  };

  useEffect(() => {
    void loadSelectedBatchDetails(selectedBatchId);
  }, [loadSelectedBatchDetails, selectedBatchId]);

  useEffect(() => {
    if (!selectedFiringId) return;
    if (firings.some((firing) => firing.id === selectedFiringId)) return;
    if (filteredFirings[0]) {
      setSelectedFiringId(filteredFirings[0].id);
      return;
    }
    setSelectedFiringId("");
  }, [filteredFirings, firings, selectedFiringId]);

  const membersContent = (
    <section className="card staff-console-card">
      <div className="card-title-row">
        <div className="card-title">Members</div>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={Boolean(busy)}
          onClick={() => void run("refreshMembers", loadUsers)}
        >
          Refresh members
        </button>
      </div>
      <div className="staff-kpi-grid">
        <div className="staff-kpi"><span>Total</span><strong>{memberRoleCounts.all}</strong></div>
        <div className="staff-kpi"><span>Staff</span><strong>{memberRoleCounts.staff}</strong></div>
        <div className="staff-kpi"><span>Admin</span><strong>{memberRoleCounts.admin}</strong></div>
        <div className="staff-kpi"><span>Client</span><strong>{memberRoleCounts.member}</strong></div>
      </div>
      <div className="staff-note">
        Sources: users {memberSourceStats.usersDocs}, profiles {memberSourceStats.profilesDocs}
        {memberSourceStats.inferredMembers > 0
          ? `, inferred ${memberSourceStats.inferredMembers} from ${memberSourceStats.fallbackCollections.join(", ")}`
          : ""}
      </div>
      <div className="staff-module-grid">
        <div className="staff-column">
          <div className="staff-actions-row">
            <input
              className="staff-member-search"
              placeholder="Search by name, email, or UID"
              value={memberSearch}
              onChange={(event) => setMemberSearch(event.target.value)}
            />
            <select
              className="staff-member-role-filter"
              value={memberRoleFilter}
              onChange={(event) => setMemberRoleFilter(event.target.value as MemberRoleFilter)}
            >
              <option value="all">All roles</option>
              <option value="staff">Staff</option>
              <option value="admin">Admin</option>
              <option value="member">Client</option>
            </select>
          </div>
          <div className="staff-table-wrap">
            <table className="staff-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Membership</th>
                  <th>Email</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {filteredMembers.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No members match current filters.</td>
                  </tr>
                ) : (
                  filteredMembers.map((member) => (
                    <tr
                      key={member.id}
                      className={`staff-click-row ${selectedMemberId === member.id ? "active" : ""}`}
                      onClick={() => setSelectedMemberId(member.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedMemberId(member.id);
                        }
                      }}
                      tabIndex={0}
                    >
                      <td>{member.displayName}</td>
                      <td><span className="pill">{member.role}</span></td>
                      <td><span className="pill">{member.membershipTier}</span></td>
                      <td>{member.email}</td>
                      <td>{when(member.lastSeenAtMs)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="staff-column">
          <div className="staff-note">
            {selectedMember ? (
              <>
                <strong>{selectedMember.displayName}</strong><br />
                <span>{selectedMember.email}</span><br />
                <code>{selectedMember.id}</code>
              </>
            ) : (
              "Select a member to inspect details."
            )}
          </div>
          {selectedMember ? (
            <>
              <div className="staff-actions-row">
                <button type="button" className="btn btn-ghost" onClick={() => void copy(selectedMember.id)}>
                  Copy UID
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => void copy(selectedMember.email)}>
                  Copy email
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() =>
                    void copy(
                      `node functions/scripts/setStaffClaim.js --uid ${selectedMember.id}`
                    )
                  }
                >
                  Copy promote command
                </button>
              </div>
              <div className="staff-subtitle">Edit profile</div>
              <div className="staff-module-grid">
                <label className="staff-field">
                  Display name
                  <input
                    value={memberEditDraft.displayName}
                    onChange={(event) => setMemberEditDraft((prev) => ({ ...prev, displayName: event.target.value }))}
                  />
                </label>
                <label className="staff-field">
                  Membership tier
                  <input
                    value={memberEditDraft.membershipTier}
                    onChange={(event) => setMemberEditDraft((prev) => ({ ...prev, membershipTier: event.target.value }))}
                  />
                </label>
                <label className="staff-field">
                  Kiln preferences
                  <input
                    value={memberEditDraft.kilnPreferences}
                    onChange={(event) => setMemberEditDraft((prev) => ({ ...prev, kilnPreferences: event.target.value }))}
                  />
                </label>
                <label className="staff-field">
                  Staff notes
                  <textarea
                    value={memberEditDraft.staffNotes}
                    onChange={(event) => setMemberEditDraft((prev) => ({ ...prev, staffNotes: event.target.value }))}
                    placeholder="Internal note (staff-only)"
                  />
                </label>
              </div>
              <label className="staff-field">
                Edit reason (audit log)
                <input
                  value={memberEditDraft.reason}
                  onChange={(event) => setMemberEditDraft((prev) => ({ ...prev, reason: event.target.value }))}
                  placeholder="Why this change was made"
                />
              </label>
              <div className="staff-actions-row">
                <button type="button" className="btn btn-primary" disabled={Boolean(busy)} onClick={handleSaveMemberProfile}>
                  {busy === "saveMemberProfile" ? "Saving..." : "Save profile changes"}
                </button>
              </div>
              <div className="staff-kpi-grid">
                <div className="staff-kpi"><span>Membership</span><strong>{selectedMember.membershipTier}</strong></div>
                <div className="staff-kpi"><span>Created</span><strong>{when(selectedMember.createdAtMs)}</strong></div>
                <div className="staff-kpi"><span>Updated</span><strong>{when(selectedMember.updatedAtMs)}</strong></div>
                <div className="staff-kpi"><span>Last seen</span><strong>{when(selectedMember.lastSeenAtMs)}</strong></div>
                <div className="staff-kpi"><span>Kiln prefs</span><strong>{selectedMember.kilnPreferences || "-"}</strong></div>
              </div>
              <div className="staff-subtitle">Operational footprint</div>
              {memberStatsBusy ? (
                <div className="staff-note">Loading member usage stats...</div>
              ) : memberStatsError ? (
                <div className="staff-note staff-note-error">{memberStatsError}</div>
              ) : (
                <div className="staff-kpi-grid">
                  <div className="staff-kpi"><span>Batches</span><strong>{memberStats?.batches ?? 0}</strong></div>
                  <div className="staff-kpi"><span>Reservations</span><strong>{memberStats?.reservations ?? 0}</strong></div>
                  <div className="staff-kpi"><span>Event signups</span><strong>{memberStats?.eventSignups ?? 0}</strong></div>
                  <div className="staff-kpi"><span>Store orders</span><strong>{memberStats?.materialsOrders ?? 0}</strong></div>
                  <div className="staff-kpi"><span>Message threads</span><strong>{memberStats?.directMessageThreads ?? 0}</strong></div>
                  <div className="staff-kpi"><span>Library loans</span><strong>{memberStats?.libraryLoans ?? 0}</strong></div>
                </div>
              )}
              <details className="staff-troubleshooting">
                <summary>Raw member document</summary>
                <pre>{safeJsonStringify(selectedMember.rawDoc)}</pre>
              </details>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );

  const piecesContent = (
    <section className="card staff-console-card">
      <div className="card-title-row">
        <div className="card-title">Pieces & batches</div>
        <button
          className="btn btn-secondary"
          disabled={Boolean(busy)}
          onClick={() =>
            void run("refreshBatches", async () => {
              await loadBatches();
              await loadSelectedBatchDetails(selectedBatchId);
            })
          }
        >
          Refresh batches
        </button>
      </div>
      <div className="staff-kpi-grid">
        <div className="staff-kpi"><span>Loaded batches</span><strong>{batches.length}</strong></div>
        <div className="staff-kpi"><span>Total batches (all)</span><strong>{batchesTotalCount ?? "-"}</strong></div>
        <div className="staff-kpi"><span>Open</span><strong>{batches.filter((batch) => !batch.isClosed).length}</strong></div>
        <div className="staff-kpi"><span>Closed</span><strong>{batches.filter((batch) => batch.isClosed).length}</strong></div>
        <div className="staff-kpi"><span>Likely artifacts</span><strong>{batchArtifactCandidates.length}</strong></div>
        <div className="staff-kpi"><span>High-confidence artifacts</span><strong>{batchArtifactSummary.highConfidence}</strong></div>
        <div className="staff-kpi"><span>Manual review hints</span><strong>{batchArtifactSummary.manualReview}</strong></div>
        <div className="staff-kpi"><span>Cleanup preview scope</span><strong>{batchCleanupSelectionCandidates.length}</strong></div>
        <div className="staff-kpi"><span>In current filter</span><strong>{filteredBatches.length}</strong></div>
        <div className="staff-kpi"><span>Pieces in selected</span><strong>{batchPieces.length}</strong></div>
      </div>
      <div className="staff-note">
        Batch table loads the most recent 80 records for operator speed.
        {batchesTotalCount !== null && batchesTotalCount > batches.length
          ? ` ${batchesTotalCount - batches.length} older batch record(s) are outside the current sample.`
          : ""}
      </div>
      <div className="staff-module-grid">
        <div className="staff-column">
          <div className="staff-actions-row">
            <input
              className="staff-member-search"
              placeholder="Search batch by title, owner UID, status, or ID"
              value={batchSearch}
              onChange={(event) => setBatchSearch(event.target.value)}
            />
            <select
              className="staff-member-role-filter"
              value={batchStatusFilter}
              onChange={(event) => setBatchStatusFilter(event.target.value)}
            >
              <option value="all">All statuses</option>
              <option value="open">Open only</option>
              <option value="closed">Closed only</option>
              {batchStatusOptions.map((statusName) => (
                <option key={statusName} value={statusName}>
                  {statusName}
                </option>
              ))}
            </select>
            <select
              className="staff-member-role-filter"
              value={batchArtifactFilter}
              onChange={(event) => setBatchArtifactFilter(event.target.value as "all" | "artifact" | "nonArtifact")}
            >
              <option value="all">All batches</option>
              <option value="artifact">Likely artifacts</option>
              <option value="nonArtifact">Likely production</option>
            </select>
            <button
              className="btn btn-ghost btn-small"
              disabled={batchArtifactCandidates.length === 0}
              onClick={() => void copy(batchArtifactCandidates.map((batch) => batch.id).join("\n"))}
            >
              Copy artifact IDs
            </button>
          </div>
          <div className="staff-table-wrap">
            <table className="staff-table">
              <thead>
                <tr>
                  <th>Batch</th>
                  <th>Status</th>
                  <th>Triage</th>
                  <th>Owner UID</th>
                  <th>Kiln</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {filteredBatches.length === 0 ? (
                  <tr>
                    <td colSpan={6}>No batches match current filters.</td>
                  </tr>
                ) : (
                  filteredBatches.map((batch) => (
                    <tr
                      key={batch.id}
                      className={`staff-click-row ${selectedBatchId === batch.id ? "active" : ""}`}
                      onClick={() => setSelectedBatchId(batch.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedBatchId(batch.id);
                        }
                      }}
                      tabIndex={0}
                    >
                      <td>
                        <div>{batch.title}</div>
                        <div className="staff-mini">
                          <code>{batch.id}</code>
                        </div>
                      </td>
                      <td><span className="pill">{batch.status}</span></td>
                      <td>
                        {(() => {
                          const triage = batchArtifactInventoryById.get(batch.id);
                          if (!triage) return <span className="staff-mini">-</span>;
                          return (
                            <>
                              <span className={`pill staff-triage-pill staff-triage-pill-${triage.confidence}`}>
                                {triage.category}
                              </span>
                              <div className="staff-mini">
                                {triage.confidence} confidence · {triage.dispositionHints.join(", ")}
                              </div>
                            </>
                          );
                        })()}
                      </td>
                      <td><code>{batch.ownerUid || "-"}</code></td>
                      <td>{batch.currentKilnName || batch.currentKilnId || "-"}</td>
                      <td>{when(batch.updatedAtMs)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="staff-column">
          <div className="staff-note">
            {selectedBatch ? (
              <>
                <strong>{selectedBatch.title}</strong><br />
                <span>Status: {selectedBatch.status}</span><br />
                <span>
                  Owner: <code>{selectedBatch.ownerUid || "-"}</code>
                </span>
                <br />
                <span>Kiln: {selectedBatch.currentKilnName || selectedBatch.currentKilnId || "-"}</span>
                {selectedBatchTriage ? (
                  <>
                    <br />
                    <span>
                      Triage: <strong>{selectedBatchTriage.category}</strong> · {selectedBatchTriage.confidence} confidence ·{" "}
                      {selectedBatchTriage.dispositionHints.join(", ")}
                    </span>
                  </>
                ) : null}
              </>
            ) : (
              "Select a batch to inspect and run actions."
            )}
          </div>
          {selectedBatch ? (
            <div className="staff-note">
              Recommended next actions:{" "}
              {recommendedBatchActions.length ? (
                recommendedBatchActions.map((entry) => (
                  <span key={entry.action} className="pill staff-pill-margin-right">
                    {entry.label}
                  </span>
                ))
              ) : (
                <span className="staff-mini">No lifecycle actions available for this status.</span>
              )}
            </div>
          ) : null}
          <label className="staff-field">
            Notes
            <textarea
              value={batchNotes}
              onChange={(event) => setBatchNotes(event.target.value)}
              placeholder="Optional staff note for timeline event"
            />
          </label>
          <label className="staff-field">
            Kiln ID
            <input value={kilnId} onChange={(event) => setKilnId(event.target.value)} placeholder="studio-electric" />
          </label>
          <div className="staff-actions-row">
            <button className="btn btn-secondary" disabled={!selectedBatchId || !!busy || !batchActionAvailability.shelveBatch} onClick={() => batchAction("shelveBatch")}>Shelve</button>
            <button className="btn btn-secondary" disabled={!selectedBatchId || !!busy || !batchActionAvailability.kilnLoad} onClick={() => batchAction("kilnLoad")}>Kiln load</button>
            <button className="btn btn-secondary" disabled={!selectedBatchId || !!busy || !batchActionAvailability.kilnUnload} onClick={() => batchAction("kilnUnload")}>Kiln unload</button>
            <button className="btn btn-secondary" disabled={!selectedBatchId || !!busy || !batchActionAvailability.readyForPickup} onClick={() => batchAction("readyForPickup")}>Ready for pickup</button>
            <button className="btn btn-secondary" disabled={!selectedBatchId || !!busy || !batchActionAvailability.pickedUpAndClose} onClick={() => batchAction("pickedUpAndClose")}>Close picked up</button>
            <button className="btn btn-primary" disabled={!selectedBatchId || !!busy || !batchActionAvailability.continueJourney} onClick={() => batchAction("continueJourney")}>Continue journey</button>
          </div>
          {batchDetailBusy ? <div className="staff-note">Loading selected batch details...</div> : null}
          {batchDetailError ? <div className="staff-note staff-note-error">{batchDetailError}</div> : null}
        </div>
      </div>
      <div className="staff-module-grid">
        <div className="staff-column">
          <div className="staff-subtitle">Artifact triage inventory (deterministic)</div>
          <div className="staff-note">
            Triage inventory is deterministic for the current sample and includes category, confidence, and disposition hints.
          </div>
          <div className="staff-table-wrap">
            <table className="staff-table">
              <thead>
                <tr>
                  <th>Batch</th>
                  <th>Category</th>
                  <th>Confidence</th>
                  <th>Disposition hints</th>
                  <th>Evidence</th>
                </tr>
              </thead>
              <tbody>
                {batchLikelyArtifactInventory.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No likely artifacts detected in the current loaded sample.</td>
                  </tr>
                ) : (
                  batchLikelyArtifactInventory.map((entry) => (
                    <tr key={entry.batchId}>
                      <td>
                        <div>{entry.title}</div>
                        <div className="staff-mini"><code>{entry.batchId}</code></div>
                      </td>
                      <td><span className="pill">{entry.category}</span></td>
                      <td>
                        <span className={`pill staff-triage-pill staff-triage-pill-${entry.confidence}`}>{entry.confidence}</span>
                      </td>
                      <td>{entry.dispositionHints.join(", ")}</td>
                      <td>
                        <div className="staff-mini">{entry.rationale.join(" ") || "-"}</div>
                        {entry.ageDays !== null ? <div className="staff-mini">Age: {entry.ageDays}d</div> : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="staff-column">
          <div className="staff-subtitle">Safe cleanup path</div>
          <div className="staff-note staff-note-warning">
            Cleanup defaults to dry-run preview. Destructive cleanup requires an explicit confirmation phrase and is preview-only
            unless backend dispatch is explicitly enabled.
          </div>
          <div className="staff-module-grid">
            <label className="staff-field">
              Cleanup selection scope
              <select
                value={batchCleanupSelectionMode}
                onChange={(event) =>
                  setBatchCleanupSelectionMode(event.target.value as BatchCleanupSelectionMode)
                }
              >
                <option value="high_confidence_artifacts">High-confidence artifacts only</option>
                <option value="all_likely_artifacts">All likely artifacts</option>
                <option value="current_filter_artifacts">Current filter (artifact-only)</option>
              </select>
            </label>
            <label className="staff-field">
              Dispatch mode
              <select
                value={batchCleanupDispatchMode}
                onChange={(event) => setBatchCleanupDispatchMode(event.target.value as "preview_only" | "attempt_backend")}
              >
                <option value="preview_only">Preview only (offline-safe default)</option>
                <option value="attempt_backend">Attempt backend endpoint dispatch</option>
              </select>
            </label>
            <label className="staff-field">
              Reason code
              <input
                value={batchCleanupReasonCodeInput}
                onChange={(event) => setBatchCleanupReasonCodeInput(event.target.value)}
                placeholder="ARTIFACT_BATCH_TRIAGE"
              />
            </label>
            <label className="staff-field">
              Ticket refs (comma/newline)
              <input
                value={batchCleanupTicketRefsInput}
                onChange={(event) => setBatchCleanupTicketRefsInput(event.target.value)}
                placeholder="P1-staff-console-batch-artifact-triage-and-safe-cleanup"
              />
            </label>
          </div>
          <label className="staff-field">
            Operator reason (audit required)
            <textarea
              value={batchCleanupReason}
              onChange={(event) => setBatchCleanupReason(event.target.value)}
              placeholder="Why this cleanup is safe and needed"
            />
          </label>
          <div className="staff-actions-row">
            <button
              className="btn btn-secondary"
              disabled={Boolean(busy) || batchCleanupSelectionCandidates.length === 0}
              onClick={handleGenerateBatchCleanupPreview}
            >
              Generate dry-run preview
            </button>
            <button
              className="btn btn-ghost"
              disabled={!batchCleanupPreviewPayload}
              onClick={() => void copy(batchCleanupPreviewPayload ? safeJsonStringify(batchCleanupPreviewPayload) : "")}
            >
              Copy preview JSON
            </button>
          </div>
          <label className="staff-field">
            Confirmation phrase for destructive cleanup
            <input
              value={batchCleanupConfirmPhraseInput}
              onChange={(event) => setBatchCleanupConfirmPhraseInput(event.target.value)}
              placeholder={expectedBatchCleanupConfirmationPhrase}
            />
            <span className="helper">
              Type <code>{expectedBatchCleanupConfirmationPhrase}</code> to enable destructive payload dispatch.
            </span>
          </label>
          <div className="staff-actions-row">
            <button
              className="btn btn-primary"
              disabled={Boolean(busy) || !canConfirmDestructiveCleanup || batchCleanupSelectionCandidates.length === 0}
              onClick={handleRunBatchCleanupDestructive}
            >
              {batchCleanupDispatchMode === "attempt_backend"
                ? "Dispatch destructive cleanup (gated)"
                : "Prepare destructive cleanup payload (preview-only)"}
            </button>
          </div>
          {batchCleanupDispatchMode === "preview_only" ? (
            <div className="staff-note">
              Preview mode is active: no destructive writes occur from this console flow. Use script{" "}
              <code>scripts/staff-batch-artifact-cleanup.mjs</code> for offline artifact logging and handoff.
            </div>
          ) : null}
          {batchCleanupPreviewLog ? (
            <details className="staff-troubleshooting" open>
              <summary>Cleanup preview log</summary>
              <pre>{batchCleanupPreviewLog}</pre>
            </details>
          ) : (
            <div className="staff-note">Generate dry-run preview to inspect payload, scope, and audit metadata.</div>
          )}
        </div>
      </div>
      <div className="staff-module-grid">
        <div className="staff-column">
          <div className="staff-subtitle">Pieces in selected batch</div>
          <div className="staff-table-wrap">
            <table className="staff-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Description</th>
                  <th>Stage</th>
                  <th>Ware</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {batchPieces.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No pieces found for selected batch.</td>
                  </tr>
                ) : (
                  batchPieces.map((piece) => (
                    <tr key={piece.id}>
                      <td>
                        <div>{piece.pieceCode}</div>
                        {piece.isArchived ? <div className="staff-mini">Archived</div> : null}
                      </td>
                      <td>{piece.shortDesc}</td>
                      <td><span className="pill">{piece.stage}</span></td>
                      <td>{piece.wareCategory}</td>
                      <td>{when(piece.updatedAtMs)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="staff-column">
          <div className="staff-subtitle">Timeline</div>
          <div className="staff-list-compact">
            {batchTimeline.length === 0 ? (
              <div className="staff-note">No timeline events found for selected batch.</div>
            ) : (
              batchTimeline.map((eventRow) => (
                <div key={eventRow.id} className="staff-list-item">
                  <div>
                    <strong>{eventRow.type}</strong>
                    <div className="staff-mini">
                      {eventRow.actorName} · {eventRow.kilnName !== "-" ? eventRow.kilnName : "no kiln"}
                    </div>
                    {eventRow.notes ? <div className="staff-mini">{eventRow.notes}</div> : null}
                  </div>
                  <div className="staff-mini">{when(eventRow.atMs)}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );

  const firingsContent = (
    <section className="card staff-console-card">
      <div className="card-title-row">
        <div className="card-title">Firings</div>
        <button
          className="btn btn-secondary"
          disabled={Boolean(busy)}
          onClick={() => void run("refreshFirings", async () => { await loadFirings(); setStatus("Firings refreshed"); })}
        >
          Refresh firings
        </button>
      </div>
      <div className="staff-kpi-grid">
        <div className="staff-kpi"><span>Total firings</span><strong>{firings.length}</strong></div>
        <div className="staff-kpi"><span>Active now</span><strong>{firingTriage.active.length}</strong></div>
        <div className="staff-kpi"><span>Needs attention</span><strong>{firingTriage.attention.length}</strong></div>
        <div className="staff-kpi"><span>Scheduled</span><strong>{firings.filter((firing) => firing.status === "scheduled").length}</strong></div>
        <div className="staff-kpi"><span>Completed</span><strong>{firingTriage.done.length}</strong></div>
        <div className="staff-kpi"><span>In current filter</span><strong>{firingTriage.view.length}</strong></div>
      </div>
      <div className="staff-module-grid">
        <div className="staff-column">
          <div className="staff-actions-row">
            <input
              className="staff-member-search"
              placeholder="Search firing by title, kiln, status, cycle, or ID"
              value={firingSearch}
              onChange={(event) => setFiringSearch(event.target.value)}
            />
            <select
              className="staff-member-role-filter"
              value={firingStatusFilter}
              onChange={(event) => setFiringStatusFilter(event.target.value)}
            >
              <option value="all">All statuses</option>
              {firingStatusOptions.map((statusName) => (
                <option key={statusName} value={statusName}>{statusName}</option>
              ))}
            </select>
            <select
              className="staff-member-role-filter"
              value={firingKilnFilter}
              onChange={(event) => setFiringKilnFilter(event.target.value)}
            >
              <option value="all">All kilns</option>
              {firingKilnOptions.map((kilnName) => (
                <option key={kilnName} value={kilnName}>{kilnName}</option>
              ))}
            </select>
            <select
              className="staff-member-role-filter"
              value={firingFocusFilter}
              onChange={(event) =>
                setFiringFocusFilter(event.target.value as "all" | "active" | "attention" | "done")
              }
            >
              <option value="all">All focus</option>
              <option value="active">Active only</option>
              <option value="attention">Needs attention</option>
              <option value="done">Done only</option>
            </select>
            <button
              className="btn btn-ghost"
              disabled={Boolean(busy) || firingTriage.active.length === 0}
              onClick={() => setSelectedFiringId(firingTriage.active[0].id)}
            >
              Jump to next active
            </button>
          </div>
          <div className="staff-table-wrap">
            <table className="staff-table">
              <thead>
                <tr>
                  <th>Firing</th>
                  <th>Kiln</th>
                  <th>Status</th>
                  <th>Cycle</th>
                  <th>Window</th>
                </tr>
              </thead>
              <tbody>
                {firingTriage.view.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No firings match current filters.</td>
                  </tr>
                ) : (
                  firingTriage.view.map((firing) => (
                    <tr
                      key={firing.id}
                      className={`staff-click-row ${selectedFiringId === firing.id ? "active" : ""}`}
                      onClick={() => setSelectedFiringId(firing.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedFiringId(firing.id);
                        }
                      }}
                      tabIndex={0}
                    >
                      <td>
                        <div>{firing.title}</div>
                        <div className="staff-mini"><code>{firing.id}</code></div>
                      </td>
                      <td>{firing.kilnName || firing.kilnId || "-"}</td>
                      <td><span className="pill">{firing.status}</span></td>
                      <td>{firing.cycleType}</td>
                      <td>{when(firing.startAtMs)} - {when(firing.endAtMs)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="staff-column">
          <div className="staff-note">
            {selectedFiring ? (
              <>
                <strong>{selectedFiring.title}</strong><br />
                <span>{selectedFiring.kilnName || selectedFiring.kilnId || "Kiln unknown"}</span><br />
                <span>Status: {selectedFiring.status} · Cycle: {selectedFiring.cycleType}</span><br />
                <span>Confidence: {selectedFiring.confidence}</span><br />
                <span>Batches: {selectedFiring.batchCount} · Pieces: {selectedFiring.pieceCount}</span>
              </>
            ) : (
              "Select a firing to inspect details."
            )}
          </div>
          {selectedFiring ? (
            <div className="staff-kpi-grid">
              <div className="staff-kpi"><span>Start</span><strong>{when(selectedFiring.startAtMs)}</strong></div>
              <div className="staff-kpi"><span>End</span><strong>{when(selectedFiring.endAtMs)}</strong></div>
              <div className="staff-kpi"><span>Unloaded</span><strong>{when(selectedFiring.unloadedAtMs)}</strong></div>
              <div className="staff-kpi"><span>Updated</span><strong>{when(selectedFiring.updatedAtMs)}</strong></div>
            </div>
          ) : null}
          {selectedFiring ? (
            <div className="staff-note">
              Flags:{" "}
              {selectedFiring.confidence.toLowerCase() === "low" ? <span className="pill staff-pill-margin-right">low confidence</span> : null}
              {selectedFiring.startAtMs > 0 && selectedFiring.endAtMs === 0 ? <span className="pill staff-pill-margin-right">missing end window</span> : null}
              {selectedFiring.updatedAtMs > 0 && Date.now() - selectedFiring.updatedAtMs > 12 * 60 * 60 * 1000 && ["loading", "firing", "cooling", "unloading", "loaded"].includes(selectedFiring.status.toLowerCase()) ? (
                <span className="pill staff-pill-margin-right">stale active</span>
              ) : null}
              {selectedFiring.confidence.toLowerCase() !== "low" && !(selectedFiring.startAtMs > 0 && selectedFiring.endAtMs === 0) && !(selectedFiring.updatedAtMs > 0 && Date.now() - selectedFiring.updatedAtMs > 12 * 60 * 60 * 1000 && ["loading", "firing", "cooling", "unloading", "loaded"].includes(selectedFiring.status.toLowerCase())) ? (
                <span className="staff-mini">No triage flags.</span>
              ) : null}
            </div>
          ) : null}
          {selectedFiring?.notes ? <div className="staff-note">{selectedFiring.notes}</div> : null}
          {hasFunctionsAuthMismatch ? (
            <div className="staff-note">
              Calendar sync actions require function auth. Enable auth emulator (`VITE_USE_AUTH_EMULATOR=true`) or point Functions to production.
            </div>
          ) : (
            <div className="staff-note">
              Calendar sync/debug controls are deprecated for day-to-day staff operations.
              <div className="staff-actions-row staff-actions-row--mt8">
                <button
                  className="btn btn-ghost btn-small"
                  type="button"
                  onClick={() => setShowDeprecatedFiringControls((prev) => !prev)}
                >
                  {showDeprecatedFiringControls ? "Hide deprecated controls" : "Show deprecated controls"}
                </button>
              </div>
              {showDeprecatedFiringControls ? (
                <div className="staff-actions-row staff-actions-row--mt8">
                  <button className="btn btn-secondary" disabled={!!busy} onClick={() => void run("syncFiringsNow", async () => { await client.postJson("syncFiringsNow", {}); await loadFirings(); setStatus("syncFiringsNow requested"); })}>Sync now</button>
                  <button className="btn btn-secondary" disabled={!!busy} onClick={() => void run("acceptFiringsCalendar", async () => { await client.postJson("acceptFiringsCalendar", {}); setStatus("acceptFiringsCalendar requested"); })}>Accept calendar</button>
                  <button className="btn btn-secondary" disabled={!!busy} onClick={() => void run("debugCalendarId", async () => { await client.postJson("debugCalendarId", {}); setStatus("debugCalendarId requested"); })}>Debug calendar</button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </section>
  );

  const createQuickEvent = async () => {
    const title = eventCreateDraft.title.trim();
    if (!title) throw new Error("Event title is required.");
    if (!eventCreateDraft.startAt) throw new Error("Start date/time is required.");

    const start = new Date(eventCreateDraft.startAt);
    if (Number.isNaN(start.getTime())) throw new Error("Start date/time is invalid.");

    const durationMinutes = Math.max(Number(eventCreateDraft.durationMinutes) || 120, 30);
    const end = new Date(start.getTime() + durationMinutes * 60_000);
    const capacity = Math.max(Number(eventCreateDraft.capacity) || 0, 0);
    const priceCents = Math.max(Number(eventCreateDraft.priceCents) || 0, 0);
    const location = eventCreateDraft.location.trim() || "Monsoon Fire Studio";

    if (hasFunctionsAuthMismatch) {
      const now = new Date();
      await addDoc(collection(db, "events"), {
        title,
        summary: "Staff-created event draft",
        description: "Complete details in the Events module when function auth is available.",
        location,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Phoenix",
        startAt: start,
        endAt: end,
        capacity,
        remainingCapacity: capacity,
        priceCents,
        currency: "USD",
        includesFiring: false,
        status: "draft",
        waitlistEnabled: true,
        offerClaimWindowHours: 24,
        cancelCutoffHours: 24,
        ticketedCount: 0,
        offeredCount: 0,
        checkedInCount: 0,
        waitlistCount: 0,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      await client.postJson("createEvent", {
        title,
        summary: "Staff-created quick draft",
        description: "Quick draft from Staff console. Expand details in Events module.",
        location,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Phoenix",
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        capacity,
        priceCents,
        currency: "USD",
        includesFiring: false,
        firingDetails: null,
        policyCopy: null,
        addOns: [],
        waitlistEnabled: true,
        offerClaimWindowHours: 24,
        cancelCutoffHours: 24,
      });
    }

    setEventCreateDraft((prev) => ({ ...prev, title: "" }));
    await loadEvents();
    setStatus("Quick event draft created.");
  };

  const publishSelectedEvent = async () => {
    if (!selectedEvent) throw new Error("Select an event first.");
    const alreadyPublished = selectedEvent.status === "published";
    if (alreadyPublished) throw new Error("Selected event is already published.");

    if (hasFunctionsAuthMismatch) {
      await setDoc(
        doc(db, "events", selectedEvent.id),
        {
          status: "published",
          publishedAt: new Date(),
          updatedAt: new Date(),
        },
        { merge: true }
      );
    } else {
      const forcePublish = publishOverrideReason.trim().length > 0;
      await client.postJson("publishEvent", {
        eventId: selectedEvent.id,
        forcePublish,
        overrideReason: forcePublish ? publishOverrideReason.trim() : null,
      });
    }

    setPublishOverrideReason("");
    await loadEvents();
    if (selectedEventId) await loadSignups(selectedEventId);
    setStatus(`Event ${selectedEvent.id} published.`);
  };

  const setSelectedEventStatus = async (nextStatus: "draft" | "cancelled") => {
    if (!selectedEvent) throw new Error("Select an event first.");
    if (selectedEvent.status === nextStatus) {
      throw new Error(`Selected event is already ${nextStatus}.`);
    }
    const reason = eventStatusReason.trim();
    if (nextStatus === "cancelled" && !reason) {
      throw new Error("Reason is required when cancelling an event.");
    }

    if (hasFunctionsAuthMismatch) {
      const now = new Date();
      const patch: Record<string, unknown> = {
        status: nextStatus,
        updatedAt: now,
        lastStatusReason: reason || null,
        lastStatusChangedAt: now,
      };
      if (nextStatus === "cancelled") {
        patch.cancelledAt = now;
      } else if (nextStatus === "draft") {
        patch.cancelledAt = null;
      }
      await setDoc(doc(db, "events", selectedEvent.id), patch, { merge: true });
    } else {
      await client.postJson("staffSetEventStatus", {
        eventId: selectedEvent.id,
        status: nextStatus,
        reason: reason || null,
      });
    }

    setEventStatusReason("");
    await loadEvents();
    if (selectedEventId) await loadSignups(selectedEventId);
    setStatus(`Event ${selectedEvent.id} moved to ${nextStatus}.`);
  };

  const checkInSignupFallback = async (signup: SignupRecord) => {
    if (!selectedEventId) throw new Error("Select an event first.");
    if (signup.status === "checked_in") return;

    const now = new Date();
    await setDoc(
      doc(db, "eventSignups", signup.id),
      {
        status: "checked_in",
        checkedInAt: now,
        updatedAt: now,
      },
      { merge: true }
    );

    qTrace("eventSignups", { eventId: selectedEventId, limit: 500, fallback: "recount" });
    const signupsSnap = await getDocs(
      query(collection(db, "eventSignups"), where("eventId", "==", selectedEventId), limit(500))
    );

    let ticketedCount = 0;
    let offeredCount = 0;
    let checkedInCount = 0;
    let waitlistCount = 0;

    for (const row of signupsSnap.docs) {
      const data = row.data();
      const status = str(data.status, "").toLowerCase();
      if (status === "ticketed" || status === "checked_in") ticketedCount += 1;
      if (status === "offered") offeredCount += 1;
      if (status === "checked_in") checkedInCount += 1;
      if (status === "waitlisted") waitlistCount += 1;
    }

    const eventRow = events.find((row) => row.id === selectedEventId);
    const payload: Record<string, unknown> = {
      ticketedCount,
      offeredCount,
      checkedInCount,
      waitlistCount,
      updatedAt: now,
    };
    if (eventRow) {
      payload.remainingCapacity = Math.max(eventRow.capacity - ticketedCount, 0);
    }

    await setDoc(doc(db, "events", selectedEventId), payload, { merge: true });
  };

  const checkInSignup = useCallback(
    async (signup: SignupRecord) => {
      if (!selectedEventId) throw new Error("Select an event first.");
      if (signup.status === "checked_in") return;
      await client.postJson("checkInEvent", { signupId: signup.id, method: "staff" });
    },
    [client, selectedEventId]
  );

  const openStaffWorkspace = useCallback((target: string) => {
    if (onOpenStaffWorkspace) {
      onOpenStaffWorkspace(target);
      return;
    }
    if (typeof window !== "undefined") {
      const currentPath = normalizeStaffPath(window.location.pathname);
      const match = resolveStaffWorkspaceOpenTarget(target);
      if (!match) return;
      const targetPath = match.canonicalPath;
      if (currentPath === targetPath) return;
      const isCurrentlyInStaffWorkspace = Boolean(resolveStaffWorkspaceMatch(currentPath));
      if (isCurrentlyInStaffWorkspace) {
        window.history.replaceState({}, "", targetPath);
      } else {
        window.history.pushState({}, "", targetPath);
      }
    }
  }, [onOpenStaffWorkspace]);

  const openCockpitWorkspace = useCallback(() => {
    openStaffWorkspace(STAFF_COCKPIT_PATH);
  }, [openStaffWorkspace]);

  useEffect(() => {
    if (!forceCockpitWorkspace) return;
    if (moduleKey !== "cockpit") {
      setModuleKey("cockpit");
      setStatus("Dedicated cockpit page keeps focus on cockpit workspace. Open /staff for full module navigation.");
    }
    if (!cockpitWorkspaceMode) {
      setCockpitWorkspaceMode(true);
    }
  }, [cockpitWorkspaceMode, forceCockpitWorkspace, moduleKey]);

  const openModuleFromCockpit = useCallback(
    (target: string) => {
      const destination = resolveCockpitNavigationTarget(target);
      if (forceCockpitWorkspace && !destination.tab) {
        if (destination.moduleKey !== "cockpit") {
          setModuleKey("cockpit");
        }
        setCockpitWorkspaceMode(false);
        setStatus("Returned to full staff console workspace.");
        openStaffWorkspace(STAFF_PATH);
        return;
      }
      if (destination.tab) {
        setModuleKey("cockpit");
        setCockpitTab(destination.tab);
      } else {
        setModuleKey(destination.moduleKey);
      }
      if (typeof window !== "undefined") {
        const targetPath = resolveCockpitNavigationTargetPath(destination);
        openStaffWorkspace(targetPath);
      }
    },
    [forceCockpitWorkspace, openStaffWorkspace]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const syncWorkspaceStateFromUrl = () => {
      const requestedPath =
        resolveStaffWorkspaceRequestedPath(window.location.pathname, window.location.hash) ?? null;

      if (!requestedPath) return;
      if (requestedPath === STAFF_PATH) {
        setModuleKey("cockpit");
        setCockpitTab("triage");
        return;
      }
      if (requestedPath === STAFF_COCKPIT_PATH) {
        setModuleKey("cockpit");
        setCockpitTab((prev) => prev);
        return;
      }

      const requestedModule = resolveStaffCockpitModuleFromPath(requestedPath);
      const requestedTab = resolveStaffCockpitTabFromPath(requestedPath);

      if (requestedModule) {
        const mappedTab = COCKPIT_MODULE_TAB_BY_KEY[requestedModule];
        if (mappedTab) {
          setModuleKey("cockpit");
          setCockpitTab(mappedTab);
          return;
        }
        setModuleKey(requestedModule);
        return;
      }
      if (!requestedTab) return;

      setModuleKey("cockpit");
      setCockpitTab(requestedTab);
    };

    syncWorkspaceStateFromUrl();
    window.addEventListener("popstate", syncWorkspaceStateFromUrl);
    window.addEventListener("hashchange", syncWorkspaceStateFromUrl);
    return () => {
      window.removeEventListener("popstate", syncWorkspaceStateFromUrl);
      window.removeEventListener("hashchange", syncWorkspaceStateFromUrl);
    };
  }, []);

  useEffect(() => {
    if (!isCockpitModule) return;
    if (todayBootstrapAttempted) return;
    setTodayBootstrapAttempted(true);
    const tasks: Array<Promise<unknown>> = [
      loadTodayReservations(),
      loadFirings(),
      loadAutomationHealthDashboard(),
    ];
    if (!hasFunctionsAuthMismatch) {
      tasks.push(loadCommerce());
    }
    void Promise.allSettled(tasks);
  }, [
    hasFunctionsAuthMismatch,
    loadAutomationHealthDashboard,
    loadCommerce,
    loadFirings,
    loadTodayReservations,
    todayBootstrapAttempted,
    isCockpitModule,
  ]);

  const todayMessageRows = useMemo(
    () =>
      [...messageThreads]
        .sort((a, b) => readTimestampMs(b.lastMessageAt) - readTimestampMs(a.lastMessageAt))
        .slice(0, TODAY_MESSAGE_LIMIT),
    [messageThreads]
  );
  const cockpitTodayMessageRows = useMemo(
    () =>
      todayMessageRows.map((thread) => ({
        id: thread.id,
        sender: firstNonBlankString(thread.lastSenderName, thread.lastSenderEmail, thread.subject, "Conversation"),
        snippet: firstNonBlankString(thread.lastMessagePreview, thread.subject, "Open thread"),
        kind: thread.kind || "direct",
        atMs: readTimestampMs(thread.lastMessageAt),
        unread: isDirectMessageUnread(thread, user.uid),
      })),
    [todayMessageRows, user.uid]
  );
  const unreadMessageCount = useMemo(
    () => messageThreads.reduce((sum, thread) => sum + (isDirectMessageUnread(thread, user.uid) ? 1 : 0), 0),
    [messageThreads, user.uid]
  );
  const activeFiring = useMemo(() => {
    const activeStatuses = new Set(["loading", "loaded", "firing", "cooling", "unloading", "in-progress"]);
    return firings.find((firing) => activeStatuses.has(firing.status.toLowerCase())) ?? null;
  }, [firings]);
  const cockpitActiveFiring = useMemo(
    () =>
      activeFiring
        ? {
            label: `${activeFiring.kilnName || activeFiring.kilnId || "Kiln unknown"} · ${activeFiring.status}`,
            startedLabel: activeFiring.startAtMs ? formatDateTime(activeFiring.startAtMs) : "time pending",
            updatedLabel: activeFiring.updatedAtMs ? when(activeFiring.updatedAtMs) : "-",
          }
        : null,
    [activeFiring]
  );
  const messagesDegraded = Boolean(messageThreadsError) || Boolean(announcementsError);
  const paymentAlerts = useMemo(() => {
    const alerts: TodayPaymentAlert[] = [];
    const failedOrderStatuses = new Set([
      "failed",
      "payment_failed",
      "declined",
      "past_due",
      "requires_payment_method",
      "error",
    ]);
    const failedOrders = orders.filter((order) => failedOrderStatuses.has(order.status.toLowerCase()));
    if (failedOrders.length > 0) {
      alerts.push({
        id: "payments-failed-orders",
        severity: "P0",
        title: `${failedOrders.length} failed payment${failedOrders.length === 1 ? "" : "s"}`,
        detail: "Orders are blocked and need immediate payment review.",
      });
    }
    if (unpaidCheckIns.length > 0) {
      alerts.push({
        id: "payments-unpaid-checkins",
        severity: "P1",
        title: `${unpaidCheckIns.length} unpaid check-in${unpaidCheckIns.length === 1 ? "" : "s"}`,
        detail: "Customers are checked in but payment follow-up is still required.",
      });
    }
    const smokeCanaryFailures = automationDashboard.workflows.filter((workflow) => {
      const label = `${workflow.label} ${workflow.workflowFile}`.toLowerCase();
      const smokeLike = label.includes("smoke") || label.includes("canary");
      return smokeLike && workflow.conclusion === "failure";
    });
    if (smokeCanaryFailures.length > 0) {
      alerts.push({
        id: "payments-smoke-canary-failures",
        severity: "P0",
        title: `${smokeCanaryFailures.length} smoke/canary workflow failure${smokeCanaryFailures.length === 1 ? "" : "s"}`,
        detail: "Production health checks are failing and may impact payment reliability.",
      });
    }
    const paymentHandlerErrors = latestErrors.filter((entry) =>
      /(payment|billing|stripe|kilnfire)/i.test(`${entry.label} ${entry.message}`)
    );
    if (paymentHandlerErrors.length > 0) {
      alerts.push({
        id: "payments-handler-errors",
        severity: "P1",
        title: `${paymentHandlerErrors.length} recent payment-related handler error${paymentHandlerErrors.length === 1 ? "" : "s"}`,
        detail: "Recent backend logs indicate payment or billing instability.",
      });
    }
    return alerts.slice(0, TODAY_ALERT_LIMIT);
  }, [automationDashboard.workflows, latestErrors, orders, unpaidCheckIns.length]);
  const paymentDegraded = hasFunctionsAuthMismatch || Boolean(commerceError) || Boolean(automationDashboard.error);
  const systemSummaryTone = useMemo<"green" | "amber" | "red">(() => {
    if (cockpitKpis.highAlerts > 0 || paymentAlerts.some((alert) => alert.severity === "P0")) return "red";
    if (cockpitKpis.mediumAlerts > 0 || paymentDegraded || messagesDegraded) return "amber";
    return "green";
  }, [cockpitKpis.highAlerts, cockpitKpis.mediumAlerts, messagesDegraded, paymentAlerts, paymentDegraded]);
  const systemSummaryToneLabel = useMemo(() => {
    if (systemSummaryTone === "red") return "Action needed";
    if (systemSummaryTone === "amber") return "Watch";
    return "Healthy";
  }, [systemSummaryTone]);
  const systemSummaryMessage = useMemo(() => {
    if (systemSummaryTone === "red") {
      return "Immediate attention needed. Resolve critical operational alerts first.";
    }
    if (systemSummaryTone === "amber") {
      return "Some services are degraded. Continue operations with caution and follow fallback links.";
    }
    return "Systems are stable for routine shift operations.";
  }, [systemSummaryTone]);

  const openReservationsToday = useCallback(() => {
    if (onOpenCheckin) {
      onOpenCheckin();
      return;
    }
    openModuleFromCockpit("checkins");
  }, [onOpenCheckin, openModuleFromCockpit]);

  const openReservationDetail = useCallback(
    (reservationId: string) => {
      if (onOpenReservation) {
        onOpenReservation(reservationId);
        return;
      }
      openReservationsToday();
    },
    [onOpenReservation, openReservationsToday]
  );

  const openMessagesInbox = useCallback(() => {
    if (onOpenMessages) {
      onOpenMessages();
      return;
    }
    setStatus("Messages route is unavailable in this surface. Use main navigation to open Messages.");
  }, [onOpenMessages]);

  const openMessageThread = useCallback(
    (threadId: string) => {
      if (onOpenMessageThread) {
        onOpenMessageThread(threadId);
        return;
      }
      openMessagesInbox();
    },
    [onOpenMessageThread, openMessagesInbox]
  );

  const openFiringsWorkspace = useCallback(() => {
    if (onOpenFirings) {
      onOpenFirings();
      return;
    }
    openModuleFromCockpit("firings");
  }, [onOpenFirings, openModuleFromCockpit]);

  const startFiringFlow = useCallback(() => {
    if (onStartFiring) {
      onStartFiring();
      return;
    }
    openFiringsWorkspace();
  }, [onStartFiring, openFiringsWorkspace]);

  const handleFiringPhotoFile = useCallback(
    async (file: File | null) => {
      if (!file) return;
      if (file.size > MAX_FIRING_PHOTO_BYTES) {
        setFiringPhotoError("Photo is too large. Use an image under 10 MB.");
        return;
      }
      setFiringPhotoBusy(true);
      setFiringPhotoStatus("");
      setFiringPhotoError("");
      const target = activeFiring ?? firings[0] ?? null;
      const targetFiringId = target?.id || "unassigned";
      try {
        const storage = resolveStorageForStaffToday();
        const extension = toFileExtension(file);
        const path = `firings/${user.uid}/${targetFiringId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
        const uploadRef = ref(storage, path);
        await uploadBytes(uploadRef, file, { contentType: file.type || "image/jpeg" });
        const url = await getDownloadURL(uploadRef);
        if (target) {
          try {
            await updateDoc(doc(db, "kilnFirings", target.id), {
              evidencePhotos: arrayUnion({
                url,
                path,
                uploadedByUid: user.uid,
                uploadedAtIso: new Date().toISOString(),
                source: "staff_today_console",
              }),
              updatedAt: serverTimestamp(),
            });
            setFiringPhotoStatus("Photo uploaded and attached to the active firing record.");
          } catch (attachError: unknown) {
            setFiringPhotoStatus(
              `Photo uploaded to portal storage, but firing attachment failed: ${
                attachError instanceof Error ? attachError.message : String(attachError)
              }`
            );
          }
        } else {
          setFiringPhotoStatus("Photo uploaded to portal storage.");
        }
        await loadFirings();
      } catch (err: unknown) {
        setFiringPhotoError(err instanceof Error ? err.message : String(err));
      } finally {
        setFiringPhotoBusy(false);
      }
    },
    [activeFiring, firings, loadFirings, user.uid]
  );

  const stripeContent = <StripeSettingsModule client={client} isStaff={isStaff} />;
  const commerceContent = (
    <CommerceModule
      client={client}
      run={run}
      busy={busy}
      hasFunctionsAuthMismatch={hasFunctionsAuthMismatch}
      setStatus={setStatus}
      loadCommerce={loadCommerce}
      commerceSearch={commerceSearch}
      setCommerceSearch={setCommerceSearch}
      commerceStatusFilter={commerceStatusFilter}
      setCommerceStatusFilter={setCommerceStatusFilter}
      commerceStatusOptions={commerceStatusOptions}
      commerceKpis={commerceKpis}
      unpaidCheckIns={unpaidCheckIns}
      filteredOrders={filteredOrders}
      summary={summary}
      receipts={receipts}
      copy={copy}
    />
  );
  const reportsContent = (
    <ReportsModule
      client={client}
      active={moduleKey === "reports" || (isCockpitModule && cockpitTab === "reports")}
      disabled={hasFunctionsAuthMismatch}
      user={user}
      studioBrainAdminToken={devAdminToken}
    />
  );
  const governanceContent = (
    <PolicyModule client={client} active={isCockpitModule} disabled={hasFunctionsAuthMismatch} />
  );
  const agentOpsContent = (
    <AgentOpsModule client={client} active={isCockpitModule} disabled={hasFunctionsAuthMismatch} />
  );

  const eventsContent = (
    <EventsModule
      run={run}
      busy={busy}
      hasFunctionsAuthMismatch={hasFunctionsAuthMismatch}
      fBaseUrl={fBaseUrl}
      loadEvents={loadEvents}
      setStatus={setStatus}
      handleExportWorkshopProgrammingBrief={handleExportWorkshopProgrammingBrief}
      workshopProgrammingKpis={workshopProgrammingKpis}
      workshopProgrammingClusters={workshopProgrammingClusters}
      eventKpis={eventKpis}
      filteredEvents={filteredEvents}
      filteredSignups={filteredSignups}
      selectedEventId={selectedEventId}
      selectedSignupId={selectedSignupId}
      selectedEvent={selectedEvent}
      selectedSignup={selectedSignup}
      setSelectedEventId={setSelectedEventId}
      setSelectedSignupId={setSelectedSignupId}
      eventSearch={eventSearch}
      setEventSearch={setEventSearch}
      eventStatusFilter={eventStatusFilter}
      setEventStatusFilter={setEventStatusFilter}
      eventStatusOptions={eventStatusOptions}
      signupSearch={signupSearch}
      setSignupSearch={setSignupSearch}
      signupStatusFilter={signupStatusFilter}
      setSignupStatusFilter={setSignupStatusFilter}
      signupStatusOptions={signupStatusOptions}
      eventCreateDraft={eventCreateDraft}
      setEventCreateDraft={setEventCreateDraft}
      publishOverrideReason={publishOverrideReason}
      setPublishOverrideReason={setPublishOverrideReason}
      eventStatusReason={eventStatusReason}
      setEventStatusReason={setEventStatusReason}
      createQuickEvent={createQuickEvent}
      publishSelectedEvent={publishSelectedEvent}
      setSelectedEventStatus={setSelectedEventStatus}
      checkInSignupFallback={checkInSignupFallback}
      onCheckinSignup={checkInSignup}
      loadSignups={loadSignups}
    />
  );
  const lendingContent = (
    <LendingModule
      run={run}
      busy={busy}
      hasFunctionsAuthMismatch={hasFunctionsAuthMismatch}
      fBaseUrl={fBaseUrl}
      copy={copy}
      safeJsonStringify={safeJsonStringify}
      libraryPhaseMetricsWindowMinutes={LIBRARY_PHASE_METRICS_WINDOW_MINUTES}
      loadLending={loadLending}
      isbnInput={isbnInput}
      setIsbnInput={setIsbnInput}
      isbnImportBusy={isbnImportBusy}
      isbnImportStatus={isbnImportStatus}
      isbnImportError={isbnImportError}
      handleLendingIsbnFile={(file) => {
        void handleLendingIsbnFile(file);
      }}
      handleLendingIsbnImport={handleLendingIsbnImport}
      isbnScanInput={isbnScanInput}
      setIsbnScanInput={setIsbnScanInput}
      isbnScanBusy={isbnScanBusy}
      isbnScanStatus={isbnScanStatus}
      handleLendingIsbnScanSubmit={handleLendingIsbnScanSubmit}
      externalLookupPolicyOpenLibraryEnabled={externalLookupPolicyOpenLibraryEnabled}
      setExternalLookupPolicyOpenLibraryEnabled={setExternalLookupPolicyOpenLibraryEnabled}
      externalLookupPolicyGoogleBooksEnabled={externalLookupPolicyGoogleBooksEnabled}
      setExternalLookupPolicyGoogleBooksEnabled={setExternalLookupPolicyGoogleBooksEnabled}
      externalLookupPolicyCoverReviewGuardrailEnabled={externalLookupPolicyCoverReviewGuardrailEnabled}
      setExternalLookupPolicyCoverReviewGuardrailEnabled={setExternalLookupPolicyCoverReviewGuardrailEnabled}
      externalLookupPolicyBusy={externalLookupPolicyBusy}
      externalLookupPolicyNote={externalLookupPolicyNote}
      setExternalLookupPolicyNote={setExternalLookupPolicyNote}
      externalLookupPolicyStatus={externalLookupPolicyStatus}
      externalLookupPolicyUpdatedAtMs={externalLookupPolicyUpdatedAtMs}
      externalLookupPolicyUpdatedByUid={externalLookupPolicyUpdatedByUid}
      externalLookupProbeQuery={externalLookupProbeQuery}
      setExternalLookupProbeQuery={setExternalLookupProbeQuery}
      externalLookupProbeBusy={externalLookupProbeBusy}
      externalLookupProbeStatus={externalLookupProbeStatus}
      externalLookupProbeProviders={externalLookupProbeProviders}
      runExternalLookupProviderProbe={runExternalLookupProviderProbe}
      saveExternalLookupProviderPolicy={saveExternalLookupProviderPolicy}
      libraryRolloutPhase={libraryRolloutPhase}
      setLibraryRolloutPhase={setLibraryRolloutPhase}
      libraryRolloutMemberWritesEnabled={libraryRolloutMemberWritesEnabled}
      libraryRolloutPhaseBusy={libraryRolloutPhaseBusy}
      libraryRolloutNote={libraryRolloutNote}
      setLibraryRolloutNote={setLibraryRolloutNote}
      saveLibraryRolloutPhasePolicy={saveLibraryRolloutPhasePolicy}
      libraryRolloutPhaseStatus={libraryRolloutPhaseStatus}
      libraryRolloutUpdatedAtMs={libraryRolloutUpdatedAtMs}
      libraryRolloutUpdatedByUid={libraryRolloutUpdatedByUid}
      refreshLibraryPhaseMetricsSnapshot={refreshLibraryPhaseMetricsSnapshot}
      libraryPhaseMetricsArtifact={libraryPhaseMetricsArtifact}
      libraryPhaseMetricsStatus={libraryPhaseMetricsStatus}
      libraryPhaseMetricsSnapshot={libraryPhaseMetricsSnapshot}
      lendingAdminItemSearch={lendingAdminItemSearch}
      setLendingAdminItemSearch={setLendingAdminItemSearch}
      lendingAdminItemBusy={lendingAdminItemBusy}
      filteredLendingAdminItems={filteredLendingAdminItems}
      selectedAdminItemId={selectedAdminItemId}
      handleStartLendingAdminItemCreate={handleStartLendingAdminItemCreate}
      handleSelectLendingAdminItem={handleSelectLendingAdminItem}
      selectedAdminItem={selectedAdminItem}
      lendingAdminItemDeleteConfirmInput={lendingAdminItemDeleteConfirmInput}
      setLendingAdminItemDeleteConfirmInput={setLendingAdminItemDeleteConfirmInput}
      lendingAdminDeleteConfirmationPhrase={lendingAdminDeleteConfirmationPhrase}
      setLendingAdminItemDraft={setLendingAdminItemDraft}
      lendingAdminItemDraft={lendingAdminItemDraft}
      handleLendingAdminResolveIsbn={handleLendingAdminResolveIsbn}
      lendingAdminIsbnResolveBusy={lendingAdminIsbnResolveBusy}
      lendingAdminIsbnResolveStatus={lendingAdminIsbnResolveStatus}
      lendingAdminIsbnResolveNote={lendingAdminIsbnResolveStatus}
      lendingAdminItemError={lendingAdminItemError}
      lendingAdminItemStatus={lendingAdminItemStatus}
      handleLendingAdminSave={handleLendingAdminSave}
      handleLendingAdminDelete={handleLendingAdminDelete}
      libraryAdminItems={libraryAdminItems}
      libraryRequests={libraryRequests}
      libraryLoans={libraryLoans}
      lendingTriage={lendingTriage}
      recommendationModerationKpis={recommendationModerationKpis}
      tagModerationKpis={tagModerationKpis}
      lendingSearch={lendingSearch}
      setLendingSearch={setLendingSearch}
      lendingStatusFilter={lendingStatusFilter}
      setLendingStatusFilter={setLendingStatusFilter}
      lendingStatusOptions={lendingStatusOptions}
      lendingFocusFilter={lendingFocusFilter}
      setLendingFocusFilter={setLendingFocusFilter}
      lendingRecommendationFilter={lendingRecommendationFilter}
      setLendingRecommendationFilter={setLendingRecommendationFilter}
      lendingRecommendationStatusOptions={lendingRecommendationStatusOptions}
      selectedRequestId={selectedRequestId}
      setSelectedRequestId={setSelectedRequestId}
      selectedLoanId={selectedLoanId}
      setSelectedLoanId={setSelectedLoanId}
      overdueLoanIdsById={Object.fromEntries(lendingTriage.overdueLoans.map((loan) => [loan.id, true]))}
      selectedRequest={selectedRequest}
      selectedLoan={selectedLoan}
      filteredRequests={filteredRequests}
      filteredLoans={filteredLoans}
      filteredRecommendations={filteredRecommendations}
      recommendationModerationBusyById={recommendationModerationBusyById}
      recommendationModerationStatus={recommendationModerationStatus}
      handleRecommendationModeration={handleRecommendationModeration}
      filteredTagSubmissions={filteredTagSubmissions}
      tagSubmissionApprovalDraftById={tagSubmissionApprovalDraftById}
      setTagSubmissionApprovalDraftById={setTagSubmissionApprovalDraftById}
      tagModerationBusyById={tagModerationBusyById}
      tagModerationStatus={tagModerationStatus}
      handleTagSubmissionApprove={handleTagSubmissionApprove}
      tagMergeSourceId={tagMergeSourceId}
      setTagMergeSourceId={setTagMergeSourceId}
      tagMergeTargetId={tagMergeTargetId}
      setTagMergeTargetId={setTagMergeTargetId}
      tagMergeNote={tagMergeNote}
      setTagMergeNote={setTagMergeNote}
      tagMergeBusy={tagMergeBusy}
      handleTagMerge={handleTagMerge}
      coverReviewStatus={coverReviewStatus}
      coverReviewBusyById={coverReviewBusyById}
      coverReviewDraftById={coverReviewDraftById}
      setCoverReviewDraftById={setCoverReviewDraftById}
      coverReviewErrorById={coverReviewErrorById}
      setCoverReviewErrorById={setCoverReviewErrorById}
      libraryCoverReviews={libraryCoverReviews}
      handleCoverReviewResolve={handleCoverReviewResolve}
      loanRecoveryBusy={loanRecoveryBusy}
      loanRecoveryStatus={loanRecoveryStatus}
      loanReplacementFeeAmountInput={loanReplacementFeeAmountInput}
      setLoanReplacementFeeAmountInput={setLoanReplacementFeeAmountInput}
      loanOverrideStatusDraft={loanOverrideStatusDraft}
      setLoanOverrideStatusDraft={setLoanOverrideStatusDraft}
      loanOverrideNoteDraft={loanOverrideNoteDraft}
      setLoanOverrideNoteDraft={setLoanOverrideNoteDraft}
      handleLoanMarkLost={handleLoanMarkLost}
      handleLoanAssessReplacementFee={handleLoanAssessReplacementFee}
      handleLoanItemStatusOverride={handleLoanItemStatusOverride}
    />
  );
  const runSystemPing = async () => {
    const atMs = Date.now();
    try {
      const resp = await client.postJson<{ ok?: boolean; message?: string }>("hello", {});
      upsertSystemCheck({
        key: "functions_ping",
        label: "Functions ping",
        ok: resp.ok === true,
        atMs,
        details: resp.message ?? (resp.ok ? "ok" : "unexpected response"),
      });
      setStatus("Functions ping completed.");
    } catch (err: unknown) {
      upsertSystemCheck({
        key: "functions_ping",
        label: "Functions ping",
        ok: false,
        atMs,
        details: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  };

  const runCalendarProbe = async () => {
    const atMs = Date.now();
    try {
      const resp = await client.postJson<{ ok?: boolean; calendarId?: string }>("debugCalendarId", {});
      const calendarId = str(resp.calendarId, "");
      upsertSystemCheck({
        key: "calendar_probe",
        label: "Calendar probe",
        ok: resp.ok === true,
        atMs,
        details: calendarId ? `calendarId: ${calendarId}` : "debugCalendarId returned",
      });
      setStatus("Calendar probe completed.");
    } catch (err: unknown) {
      upsertSystemCheck({
        key: "calendar_probe",
        label: "Calendar probe",
        ok: false,
        atMs,
        details: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  };

  const runNotificationMetricsProbe = async () => {
    const atMs = Date.now();
    try {
      const resp = await client.postJson<{ ok?: boolean; totalSent?: number; totalFailed?: number; successRate?: number }>(
        "runNotificationMetricsAggregationNow",
        {}
      );
      setNotificationMetricsSummary({
        totalSent: num(resp.totalSent, 0),
        totalFailed: num(resp.totalFailed, 0),
        successRate: num(resp.successRate, 0),
      });
      upsertSystemCheck({
        key: "notification_metrics",
        label: "Notification metrics",
        ok: resp.ok === true,
        atMs,
        details: `sent=${num(resp.totalSent, 0)} failed=${num(resp.totalFailed, 0)} success=${num(resp.successRate, 0)}%`,
      });
      setStatus("Notification metrics refreshed.");
    } catch (err: unknown) {
      upsertSystemCheck({
        key: "notification_metrics",
        label: "Notification metrics",
        ok: false,
        atMs,
        details: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  };

  const runNotificationFailureDrillNow = async () => {
    const atMs = Date.now();
    try {
      const resp = await client.postJson<{ ok?: boolean; jobId?: string }>("runNotificationFailureDrill", {
        uid: user.uid,
        mode: "auth",
        forceRunNow: true,
        channels: { inApp: false, email: false, push: true, sms: false },
      });
      upsertSystemCheck({
        key: "notification_drill",
        label: "Notification drill",
        ok: resp.ok === true,
        atMs,
        details: resp.jobId ? `job=${resp.jobId}` : "queued",
      });
      setStatus("Notification failure drill queued.");
    } catch (err: unknown) {
      upsertSystemCheck({
        key: "notification_drill",
        label: "Notification drill",
        ok: false,
        atMs,
        details: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  };

  const checkinsContent = (
    <section className="staff-module-grid">
      <div className="staff-column">
        <div className="card-title-row">
          <div className="card-title">Check-ins queue</div>
        </div>
        <div className="staff-note">
          Queue and lifecycle operations moved out of Ware Check-in so intake stays fast for both clients and staff.
        </div>
        <ReservationsView
          user={user}
          isStaff={hasStaffAuthority}
          adminToken={devAdminToken}
          viewMode="listOnly"
        />
      </div>
    </section>
  );
  const operationsContent = (
    <OperationsCockpitModule
      checkinsContent={checkinsContent}
      membersContent={membersContent}
      piecesContent={piecesContent}
      firingsContent={firingsContent}
      eventsContent={eventsContent}
      lendingContent={lendingContent}
    />
  );

  const cockpitOpsContent = (
    <CockpitOpsPanel
      busy={busy}
      cockpitTab={cockpitTab}
      setCockpitTab={setCockpitTab}
      overviewAlerts={overviewAlerts}
      cockpitKpis={cockpitKpis}
      automationKpis={automationKpis}
      automationDashboard={automationDashboard}
      hasFunctionsAuthMismatch={hasFunctionsAuthMismatch}
      onRefreshCockpit={() => setStatus("Refreshed cockpit telemetry")}
      run={run}
      openModuleFromCockpit={openModuleFromCockpit}
      loadReportOps={loadReportOps}
      loadSystemStats={loadSystemStats}
      loadAutomationHealthDashboard={loadAutomationHealthDashboard}
      usingLocalFunctions={usingLocalFunctions}
      showEmulatorTools={showEmulatorTools}
      integrationTokenCount={integrationTokenCount}
      notificationMetricsSummary={notificationMetricsSummary}
      runSystemPing={runSystemPing}
      runCalendarProbe={runCalendarProbe}
      runNotificationMetricsProbe={runNotificationMetricsProbe}
      runNotificationFailureDrillNow={runNotificationFailureDrillNow}
      fBaseUrl={fBaseUrl}
      devAdminEnabled={devAdminEnabled}
      devAdminToken={devAdminToken}
      onDevAdminTokenChange={onDevAdminTokenChange}
      onOpenEmulatorUi={() => window.open("http://127.0.0.1:4000/", "_blank")}
      onRefreshHandlerLog={() => setHandlerLog(getHandlerErrorLog())}
      onClearHandlerLog={() => {
        clearHandlerErrorLog();
        setHandlerLog([]);
      }}
      latestErrors={latestErrors}
      systemChecks={systemChecks}
      lastWrite={lastWrite}
      lastQuery={lastQuery}
      lastReq={lastReq}
      lastErr={lastErr}
      copy={copy}
      copyStatus={copyStatus}
      resetModuleTelemetry={resetModuleTelemetry}
      moduleUsageRows={moduleUsageRows}
      lowEngagementModules={lowEngagementModules}
      operationsContent={operationsContent}
      moduleTelemetrySnapshot={moduleTelemetrySnapshot}
      commerceContent={commerceContent}
      stripeContent={stripeContent}
      agentOpsContent={agentOpsContent}
      governanceContent={governanceContent}
      reportsContent={reportsContent}
      githubRepoSlug={GITHUB_REPO_SLUG}
    />
  );

  const cockpitContent = (
    <CockpitModule
      busy={busy}
      cockpitOpsContent={cockpitOpsContent}
      shortText={shortText}
      toShortTimeLabel={toShortTimeLabel}
      openReservationsToday={openReservationsToday}
      openMessagesInbox={openMessagesInbox}
      startFiringFlow={startFiringFlow}
      onOpenMessage={openMessageThread}
      refreshTodayReservations={() => run("refreshTodayReservations", loadTodayReservations)}
      refreshTodayFirings={() => run("refreshTodayFirings", loadFirings)}
      retryTodayReservations={() => run("retryTodayReservations", loadTodayReservations)}
      retryTodayFirings={() => run("retryTodayFirings", loadFirings)}
      refreshTodayPayments={() =>
        run("refreshTodayPayments", async () => {
          await Promise.allSettled([loadCommerce(), loadAutomationHealthDashboard()]);
        })
      }
      openReservationDetail={openReservationDetail}
      handleFiringPhotoFile={handleFiringPhotoFile}
      todayReservations={todayReservations}
      todayReservationsLoading={todayReservationsLoading}
      todayReservationsError={todayReservationsError}
      unreadMessageCount={unreadMessageCount}
      announcementsCount={announcements.length}
      unreadAnnouncements={unreadAnnouncements}
      messageThreadsLoading={messageThreadsLoading}
      announcementsLoading={announcementsLoading}
      messagesDegraded={messagesDegraded}
      messageThreadsError={messageThreadsError}
      announcementsError={announcementsError}
      todayMessageRows={cockpitTodayMessageRows}
      firingsLoading={firingsLoading}
      firingsError={firingsError}
      activeFiring={cockpitActiveFiring}
      firingPhotoBusy={firingPhotoBusy}
      firingPhotoStatus={firingPhotoStatus}
      firingPhotoError={firingPhotoError}
      commerceLoading={commerceLoading}
      paymentDegraded={paymentDegraded}
      commerceError={commerceError}
      paymentAlerts={paymentAlerts}
      systemSummaryToneLabel={systemSummaryToneLabel}
      systemSummaryMessage={systemSummaryMessage}
    />
  );

  const moduleContent = cockpitContent;

  if (!hasStaffAuthority) {
    return (
      <section className="card staff-console-card" role="alert" aria-live="assertive">
        <div className="card-title">Staff Console Access Required</div>
        <p className="card-subtitle">
          Staff actions are disabled because this session has no staff/admin claim and no dev admin token.
        </p>
        <div className="staff-note">
          Sign in with a staff account, or in emulator-only mode provide a dev admin token.
        </div>
      </section>
    );
  }

  return (
    <div className="staff-console">
      <section className="staff-console-toolbar">
        <div className="staff-console-title">Staff console</div>
        <p className="staff-console-description">
          Manage members, pieces, firings, events, billing, lending, and system health.
        </p>
        <div className="staff-actions-row">
          <button
            className="btn btn-secondary"
            disabled={Boolean(busy)}
            onClick={() =>
              void run("refreshModule", async () => {
                await loadModule(moduleKey);
                setStatus(`Loaded ${moduleKey} module.`);
              })
            }
          >
            {busy ? "Working..." : "Load current module"}
          </button>
          <button
            className="btn btn-ghost"
            disabled={Boolean(busy)}
            onClick={() =>
              void run("refreshAll", async () => {
                await loadAll();
                setStatus("Refreshed all modules");
              })
            }
          >
            Refresh all
          </button>
          {onOpenCheckin ? (
            <button className="btn btn-ghost" type="button" onClick={onOpenCheckin}>
              Open ware check-in
            </button>
          ) : null}
          {isCockpitModule && !forceCockpitWorkspace ? (
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => setCockpitWorkspaceMode((prev) => !prev)}
            >
              {cockpitWorkspaceMode ? "Show module rail" : "Focus cockpit workspace"}
            </button>
          ) : null}
          {(isCockpitModule || forceCockpitWorkspace) ? (
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => {
                if (typeof window === "undefined") return;
                openCockpitWorkspace();
              }}
            >
              {forceCockpitWorkspace ? "Return staff console" : "Open cockpit home"}
            </button>
          ) : null}
        </div>
        <div className="staff-mini">
          Data loads lazily. Start with <strong>Load current module</strong> when you want focused refreshes.
        </div>
        {hasFunctionsAuthMismatch ? <div className="staff-note">Functions emulator is local, but Auth emulator is off. StaffView is running in Firestore-only safe mode for function-backed modules.</div> : null}
        {studioBrainUiState ? (
          <div
            className={`staff-note ${studioBrainUiState.tone === "error" ? "staff-note-error" : `staff-note-${studioBrainUiState.tone}`}`}
            role={studioBrainUiState.alert ? "alert" : "status"}
          >
            <strong>{studioBrainUiState.title}</strong> - {studioBrainUiState.message}
            <div className="staff-mini">Reason code: <code>{studioBrainUiState.reasonCode}</code></div>
            <div className="staff-mini">Reason: {studioBrainUiState.reason}</div>
            <div className="staff-mini">Checked: {studioBrainUiState.checkedAtLabel}</div>
            <div className="staff-mini">Last known good: {studioBrainUiState.lastKnownGoodLabel}</div>
            <div className="staff-mini">Snapshot age: {studioBrainUiState.snapshotAgeLabel}</div>
          </div>
        ) : null}
        {status ? (
          <div className="staff-note" role="status" aria-live="polite">
            {status}
          </div>
        ) : null}
        {error ? (
          <div className="staff-note staff-note-error" role="alert" aria-live="assertive">
            {error}
          </div>
        ) : null}
      </section>

      <div className={`staff-console-layout ${isWorkspaceFocused ? "staff-console-layout-cockpit" : ""}`}>
        {!isWorkspaceFocused ? (
          <aside className="card staff-console-nav">
          <div className="staff-subtitle">Modules</div>
          <div className="staff-actions-row staff-actions-row--mt8">
            <button
              className="btn btn-ghost btn-small"
              onClick={() =>
                setAdaptiveNavEnabled((prev) => {
                  const next = !prev;
                  track("staff_adaptive_nav_toggle", { enabled: next });
                  return next;
                })
              }
              type="button"
            >
              {adaptiveNavEnabled ? "Adaptive order: on" : "Adaptive order: off"}
            </button>
          </div>
          <div className="staff-mini">
            {adaptiveNavEnabled
              ? "Modules are sorted by engagement (Cockpit pinned first)."
              : "Modules use default static order."}
          </div>
          <div className="staff-module-list">
            {navLayout.primary.map((m) => (
              <button
                key={m.key}
                className={`staff-module-btn ${moduleKey === m.key ? "active" : ""}`}
                onClick={() => openModuleFromCockpit(m.key)}
                data-testid={m.testId}
                title={`Owner: ${m.owner}`}
              >
                <span>{m.label}</span>
                {lowEngagementModuleKeys.has(m.key) ? <span className="staff-module-hint">Low use</span> : null}
              </button>
            ))}
          </div>
          {navLayout.overflow.length > 0 ? (
            <details className="staff-module-overflow">
              <summary>Low-use modules ({navLayout.overflow.length})</summary>
              <div className="staff-module-list">
                {navLayout.overflow.map((m) => (
                <button
                  key={m.key}
                  className={`staff-module-btn ${moduleKey === m.key ? "active" : ""}`}
                  onClick={() => openModuleFromCockpit(m.key)}
                  data-testid={m.testId}
                  title={`Owner: ${m.owner}`}
                >
                    <span>{m.label}</span>
                    <span className="staff-module-hint">Low use</span>
                  </button>
                ))}
              </div>
            </details>
          ) : null}
          </aside>
        ) : null}
        <div
          className={`staff-console-content ${isWorkspaceFocused ? "staff-console-content-focused" : ""}`}
          ref={moduleContentRef}
        >
          {moduleContent}
        </div>
      </div>
      <div className="staff-identity-statusline staff-identity-statusline-footer">
        Signed in as <strong>{user.displayName ?? "Staff"}</strong> · Role <strong>{staffAuthorityLabel}</strong> · Email{" "}
        <strong>{user.email ?? "-"}</strong> · UID <strong>{user.uid}</strong>
      </div>
    </div>
  );
}
