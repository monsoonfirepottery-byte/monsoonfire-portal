import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { User } from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getCountFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  where,
  type QueryConstraint,
} from "firebase/firestore";
import { createFunctionsClient, safeJsonStringify, type LastRequest } from "../api/functionsClient";
import { track } from "../lib/analytics";
import { db } from "../firebase";
import { clearHandlerErrorLog, getHandlerErrorLog } from "../utils/handlerLog";
import { resolveFunctionsBaseUrlResolution } from "../utils/functionsBaseUrl";
import { resolveStudioBrainBaseUrlResolution } from "../utils/studioBrain";
import {
  formatMinutesAgo,
  minutesSinceIso,
  resolveStudioBrainFetchFailure,
  resolveUnavailableStudioBrainStatus,
} from "../utils/studioBrainHealth";
import { parseStaffRole } from "../auth/staffRole";
import PolicyModule from "./staff/PolicyModule";
import StripeSettingsModule from "./staff/StripeSettingsModule";
import ReportsModule from "./staff/ReportsModule";
import AgentOpsModule from "./staff/AgentOpsModule";
import StudioBrainModule from "./staff/StudioBrainModule";
import ReservationsView from "./ReservationsView";

type Props = {
  user: User;
  isStaff: boolean;
  devAdminToken: string;
  onDevAdminTokenChange: (next: string) => void;
  devAdminEnabled: boolean;
  showEmulatorTools: boolean;
  onOpenCheckin?: () => void;
  initialModule?: ModuleKey;
  forceCockpitWorkspace?: boolean;
  forceEventsWorkspace?: boolean;
};

const MODULE_REGISTRY = {
  cockpit: { label: "Cockpit", owner: "Operations", testId: "staff-module-cockpit", nav: true },
  checkins: { label: "Check-ins", owner: "Queue Ops", testId: "staff-module-checkins", nav: true },
  members: { label: "Members", owner: "Member Ops", testId: "staff-module-members", nav: true },
  pieces: { label: "Pieces & batches", owner: "Production Ops", testId: "staff-module-pieces", nav: true },
  firings: { label: "Firings", owner: "Kiln Ops", testId: "staff-module-firings", nav: true },
  events: { label: "Events", owner: "Program Ops", testId: "staff-module-events", nav: true },
  reports: { label: "Reports", owner: "Trust & Safety", testId: "staff-module-reports", nav: true },
  studioBrain: { label: "Studio Brain", owner: "Platform", testId: "staff-module-studiobrain", nav: false },
  stripe: { label: "Stripe settings", owner: "Finance Ops", testId: "staff-module-stripe", nav: true },
  commerce: { label: "Store & billing", owner: "Commerce Ops", testId: "staff-module-commerce", nav: true },
  lending: { label: "Lending", owner: "Library Ops", testId: "staff-module-lending", nav: true },
  system: { label: "System", owner: "Platform", testId: "staff-module-system", nav: false },
} as const;

const COCKPIT_SECTION_IDS = {
  triage: "staff-cockpit-triage",
  automation: "staff-cockpit-automation",
  platform: "staff-cockpit-platform",
  policyAgentOps: "staff-cockpit-policy-agent-ops",
  reports: "staff-cockpit-reports",
  moduleTelemetry: "staff-cockpit-module-telemetry",
} as const;
const STAFF_MODULE_USAGE_STORAGE_KEY = "mf_staff_module_usage_v1";
const STAFF_MODULE_USAGE_STORAGE_VERSION = 2;
const STAFF_ADAPTIVE_NAV_STORAGE_KEY = "mf_staff_adaptive_nav_v1";

type ModuleKey = keyof typeof MODULE_REGISTRY;
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
const BATCH_ARTIFACT_KEYWORD = /\b(test|qa|dev|seed|fixture|sample|demo|playwright|mock|canary|staging|tmp|temp)\b/i;
const BATCH_STALE_CLOSED_DAYS = 120;
const BATCH_STALE_OPEN_DAYS = 30;
const STUDIO_BRAIN_SIGNAL_STALE_MINUTES = 12;
const STUDIO_BRAIN_OFFLINE_CONFIRM_MINUTES = 45;
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

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown): boolean {
  return value === true;
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

function formatDurationMs(ms: number): string {
  if (ms <= 0) return "0s";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

function formatLatencyMs(ms: number | null): string {
  if (ms === null) return "-";
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
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

function sanitizeLastRequest(request: LastRequest | null): LastRequest | null {
  if (!request) return null;
  return {
    ...request,
    payload: (request as { payloadRedacted?: unknown }).payloadRedacted ?? request.payload,
  };
}

export default function StaffView({
  user,
  isStaff,
  devAdminToken,
  onDevAdminTokenChange,
  devAdminEnabled,
  showEmulatorTools,
  onOpenCheckin,
  initialModule = "cockpit",
  forceCockpitWorkspace = false,
  forceEventsWorkspace = false,
}: Props) {
  const [moduleKey, setModuleKey] = useState<ModuleKey>(initialModule);
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
  const isCockpitModule = moduleKey === "cockpit";
  const [cockpitWorkspaceMode, setCockpitWorkspaceMode] = useState(true);
  const isWorkspaceFocused =
    forceCockpitWorkspace ||
    forceEventsWorkspace ||
    (moduleKey === "cockpit" && cockpitWorkspaceMode);
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
  const [orders, setOrders] = useState<CommerceOrderRecord[]>([]);
  const [unpaidCheckIns, setUnpaidCheckIns] = useState<UnpaidCheckInRecord[]>([]);
  const [receipts, setReceipts] = useState<ReceiptRecord[]>([]);
  const [commerceSearch, setCommerceSearch] = useState("");
  const [commerceStatusFilter, setCommerceStatusFilter] = useState("all");
  const [libraryRequests, setLibraryRequests] = useState<LendingRequestRecord[]>([]);
  const [libraryLoans, setLibraryLoans] = useState<LendingLoanRecord[]>([]);
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
  const [lendingSearch, setLendingSearch] = useState("");
  const [lendingStatusFilter, setLendingStatusFilter] = useState("all");
  const [lendingFocusFilter, setLendingFocusFilter] = useState<"all" | "requests" | "active" | "overdue" | "returned">("all");
  const [selectedRequestId, setSelectedRequestId] = useState("");
  const [selectedLoanId, setSelectedLoanId] = useState("");
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
    const alerts: Array<{ id: string; severity: "high" | "medium" | "low"; label: string; actionLabel: string; module: ModuleKey }> = [];
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
        severity: "high",
        label: `${attentionFirings} firing${attentionFirings === 1 ? "" : "s"} need attention`,
        actionLabel: "Review firings",
        module: "firings",
      });
    }
    if (pendingOrders > 0) {
      alerts.push({
        id: "orders-pending",
        severity: "medium",
        label: `${pendingOrders} store order${pendingOrders === 1 ? "" : "s"} pending payment`,
        actionLabel: "Open store & billing",
        module: "commerce",
      });
    }
    if (unpaidCheckIns.length > 0) {
      alerts.push({
        id: "checkins-unpaid",
        severity: "medium",
        label: `${unpaidCheckIns.length} checked-in event signup${unpaidCheckIns.length === 1 ? "" : "s"} still unpaid`,
        actionLabel: "Open store & billing",
        module: "commerce",
      });
    }
    if (staleOpenBatches > 0) {
      alerts.push({
        id: "batches-stale",
        severity: "medium",
        label: `${staleOpenBatches} open batch${staleOpenBatches === 1 ? "" : "es"} stale for 7+ days`,
        actionLabel: "Review pieces & batches",
        module: "pieces",
      });
    }
    if (highSeverityReports > 0) {
      alerts.push({
        id: "reports-high-open",
        severity: "high",
        label: `${highSeverityReports} high-severity report${highSeverityReports === 1 ? "" : "s"} still open`,
        actionLabel: "Open reports triage",
        module: "reports",
      });
    }
    if (reportSlaBreaches > 0) {
      alerts.push({
        id: "reports-sla",
        severity: "high",
        label: `${reportSlaBreaches} report SLA breach${reportSlaBreaches === 1 ? "" : "es"} need review`,
        actionLabel: "Open reports triage",
        module: "reports",
      });
    } else if (unresolvedReports > 0) {
      alerts.push({
        id: "reports-open",
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
        severity: "high",
        label: `${count} event${count === 1 ? "" : "s"} blocked for review`,
        actionLabel: "Open events",
        module: "events",
      });
    }
    if (openBatches === 0 && activeFirings === 0 && pendingOrders === 0 && unresolvedReports === 0) {
      alerts.push({
        id: "all-clear",
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

  const scrollToCockpitSection = useCallback((sectionId: string) => {
    const target = document.getElementById(sectionId);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);
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
    if (hasFunctionsAuthMismatch) {
      setSummary(null);
      setOrders([]);
      setUnpaidCheckIns([]);
      setReceipts([]);
      return;
    }
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
    qTrace("libraryRequests", { orderBy: "createdAt:desc", limit: 60 });
    const reqSnap = await getDocs(query(collection(db, "libraryRequests"), orderBy("createdAt", "desc"), limit(60)));
    setLibraryRequests(
      reqSnap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          title: str(data.title, str(data.bookTitle, "Request")),
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
        return {
          id: d.id,
          title: str(data.title, str(data.bookTitle, "Loan")),
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
  }, [qTrace]);

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
  }, [hasFunctionsAuthMismatch, loadAutomationHealthDashboard, loadBatches, loadCommerce, loadEvents, loadFirings, loadLending, loadReportOps, loadSignups, loadStudioBrainStatus, loadSystemStats, loadUsers, selectedEventId]);

  const loadCockpitModule = useCallback(async () => {
    await Promise.allSettled([
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
    loadUsers,
  ]);

  const loadEventsModule = useCallback(async () => {
    await loadEvents();
    if (selectedEventId) await loadSignups(selectedEventId);
  }, [loadEvents, loadSignups, selectedEventId]);

  const loadCommerceModule = useCallback(async () => {
    if (hasFunctionsAuthMismatch) {
      setStatus("Commerce module requires matching Functions + Auth emulator settings.");
      return;
    }
    await loadCommerce();
  }, [hasFunctionsAuthMismatch, loadCommerce]);

  const loadSystemModule = useCallback(async () => {
    if (!hasFunctionsAuthMismatch) {
      await loadSystemStats();
    }
    await loadStudioBrainStatus();
  }, [hasFunctionsAuthMismatch, loadStudioBrainStatus, loadSystemStats]);

  const moduleLoaders = useMemo<Record<ModuleKey, () => Promise<void>>>(
    () => ({
      cockpit: loadCockpitModule,
      checkins: async () => {},
      members: loadUsers,
      pieces: loadBatches,
      firings: loadFirings,
      events: loadEventsModule,
      reports: loadReportOps,
      studioBrain: loadStudioBrainStatus,
      stripe: loadStudioBrainStatus,
      commerce: loadCommerceModule,
      lending: loadLending,
      system: loadSystemModule,
    }),
    [
      loadBatches,
      loadCockpitModule,
      loadCommerceModule,
      loadEventsModule,
      loadFirings,
      loadLending,
      loadReportOps,
      loadStudioBrainStatus,
      loadSystemModule,
      loadUsers,
    ]
  );

  const loadModule = useCallback(
    async (target: ModuleKey) => {
      await moduleLoaders[target]();
    },
    [moduleLoaders]
  );

  useEffect(() => {
    setStatus("Select a module and click Load current module to fetch data.");
  }, []);

  useEffect(() => {
    if (!selectedEventId) return;
    void run("signups", async () => await loadSignups(selectedEventId));
  }, [loadSignups, selectedEventId, run]);

  useEffect(() => {
    if (moduleKey !== "system") return;
    setModuleKey("cockpit");
    setStatus("System module moved to Cockpit > Platform diagnostics.");
  }, [moduleKey]);

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
    if (!selectedMemberId || moduleKey !== "members") return;
    void loadMemberOperationalStats(selectedMemberId);
  }, [loadMemberOperationalStats, moduleKey, selectedMemberId]);

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

  const eventsContent = (
    <section className="card staff-console-card">
      <div className="card-title-row">
        <div className="card-title">Events</div>
        <button
          className="btn btn-secondary"
          disabled={Boolean(busy)}
          onClick={() =>
            void run("refreshEvents", async () => {
              await loadEvents();
              if (selectedEventId) await loadSignups(selectedEventId);
              setStatus("Events refreshed");
            })
          }
        >
          Refresh events
        </button>
      </div>
      {hasFunctionsAuthMismatch ? (
        <div className="staff-note">
          Events are running in Firestore fallback mode. Function actions like check-in are disabled until auth emulator is enabled.
        </div>
      ) : null}
      <>
          {forceEventsWorkspace ? (
            <div className="staff-note">
              Dedicated workshops workspace is active. Use this view for weekly programming triage and demand planning.
            </div>
          ) : null}
          <div className="staff-subtitle">Workshop programming intelligence</div>
          <div className="staff-kpi-grid">
            <div className="staff-kpi"><span>Technique clusters</span><strong>{workshopProgrammingKpis.totalClusters}</strong></div>
            <div className="staff-kpi"><span>High pressure</span><strong>{workshopProgrammingKpis.highPressure}</strong></div>
            <div className="staff-kpi"><span>Waitlist pressure</span><strong>{workshopProgrammingKpis.totalWaitlist}</strong></div>
            <div className="staff-kpi"><span>Demand score</span><strong>{workshopProgrammingKpis.totalDemandScore}</strong></div>
            <div className="staff-kpi"><span>No upcoming coverage</span><strong>{workshopProgrammingKpis.noUpcomingCoverage}</strong></div>
          </div>
          <div className="staff-actions-row">
            <button className="btn btn-ghost" onClick={handleExportWorkshopProgrammingBrief}>
              Export programming brief
            </button>
            {!forceEventsWorkspace ? (
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => {
                  if (typeof window === "undefined") return;
                  window.open("/staff/workshops", "_blank", "noopener");
                }}
              >
                Open dedicated workshops page
              </button>
            ) : null}
          </div>
          <div className="staff-table-wrap">
            <table className="staff-table">
              <thead><tr><th>Technique</th><th>Gap</th><th>Demand</th><th>Waitlist</th><th>Upcoming</th><th>Suggested action</th></tr></thead>
              <tbody>
                {workshopProgrammingClusters.length === 0 ? (
                  <tr><td colSpan={6}>No workshop clusters yet. Publish events to start demand modeling.</td></tr>
                ) : (
                  workshopProgrammingClusters.map((cluster) => (
                    <tr key={cluster.key}>
                      <td>
                        <strong>{cluster.label}</strong>
                        <div className="staff-mini">{cluster.topEventTitle || "-"}</div>
                      </td>
                      <td>{cluster.gapScore}</td>
                      <td>{cluster.demandScore}</td>
                      <td>{cluster.waitlistCount}</td>
                      <td>{cluster.upcomingCount}</td>
                      <td>{cluster.recommendedAction}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="staff-kpi-grid">
            <div className="staff-kpi"><span>Total events</span><strong>{eventKpis.total}</strong></div>
            <div className="staff-kpi"><span>Upcoming</span><strong>{eventKpis.upcoming}</strong></div>
            <div className="staff-kpi"><span>Published</span><strong>{eventKpis.published}</strong></div>
            <div className="staff-kpi"><span>Needs review</span><strong>{eventKpis.reviewRequired}</strong></div>
            <div className="staff-kpi"><span>Open seats</span><strong>{eventKpis.openSeats}</strong></div>
            <div className="staff-kpi"><span>Waitlisted</span><strong>{eventKpis.waitlisted}</strong></div>
            <div className="staff-kpi"><span>Signups loaded</span><strong>{signups.length}</strong></div>
            <div className="staff-kpi"><span>Checked in</span><strong>{signups.filter((signup) => signup.status === "checked_in").length}</strong></div>
            <div className="staff-kpi"><span>Paid</span><strong>{signups.filter((signup) => signup.paymentStatus === "paid").length}</strong></div>
          </div>
          <div className="staff-actions-row">
            <label className="staff-field staff-field-flex-2">
              Quick title
              <input
                value={eventCreateDraft.title}
                onChange={(event) => setEventCreateDraft((prev) => ({ ...prev, title: event.target.value }))}
                placeholder="Wheel Lab: Production Sprint"
              />
            </label>
            <label className="staff-field">
              Starts
              <input
                type="datetime-local"
                value={eventCreateDraft.startAt}
                onChange={(event) => setEventCreateDraft((prev) => ({ ...prev, startAt: event.target.value }))}
              />
            </label>
            <label className="staff-field">
              Duration (min)
              <input
                value={eventCreateDraft.durationMinutes}
                onChange={(event) => setEventCreateDraft((prev) => ({ ...prev, durationMinutes: event.target.value }))}
              />
            </label>
            <label className="staff-field">
              Capacity
              <input
                value={eventCreateDraft.capacity}
                onChange={(event) => setEventCreateDraft((prev) => ({ ...prev, capacity: event.target.value }))}
              />
            </label>
            <button
              className="btn btn-secondary"
              disabled={Boolean(busy)}
              onClick={() => void run("createQuickEvent", createQuickEvent)}
            >
              Create quick event
            </button>
          </div>
          <div className="staff-actions-row">
            <label className="staff-field staff-field-flex-1">
              Publish override reason (optional)
              <input
                value={publishOverrideReason}
                onChange={(event) => setPublishOverrideReason(event.target.value)}
                placeholder="Required only for review-gated events"
              />
            </label>
            <button
              className="btn btn-secondary"
              disabled={Boolean(busy) || !selectedEvent || selectedEvent.status === "published"}
              onClick={() => void run("publishSelectedEvent", publishSelectedEvent)}
            >
              Publish selected
            </button>
          </div>
          <div className="staff-actions-row">
            <label className="staff-field staff-field-flex-1">
              Status change reason {selectedEvent?.status !== "cancelled" ? "(required for cancel)" : "(optional)"}
              <input
                value={eventStatusReason}
                onChange={(event) => setEventStatusReason(event.target.value)}
                placeholder="Staff reason for lifecycle move"
              />
            </label>
            <button
              className="btn btn-secondary"
              disabled={Boolean(busy) || !selectedEvent || selectedEvent.status === "draft"}
              onClick={() => void run("setEventDraft", async () => setSelectedEventStatus("draft"))}
            >
              Move to draft
            </button>
            <button
              className="btn btn-secondary"
              disabled={Boolean(busy) || !selectedEvent || selectedEvent.status === "cancelled"}
              onClick={() => void run("setEventCancelled", async () => setSelectedEventStatus("cancelled"))}
            >
              Cancel event
            </button>
          </div>
          <div className="staff-note">
            Use quick create for same-day ops. Full event copy and add-ons still live in the main Events view.
          </div>
          <div className="staff-module-grid">
            <div className="staff-column">
              <div className="staff-actions-row">
                <input
                  className="staff-member-search"
                  placeholder="Search events by title, status, or location"
                  value={eventSearch}
                  onChange={(event) => setEventSearch(event.target.value)}
                />
                <select
                  className="staff-member-role-filter"
                  value={eventStatusFilter}
                  onChange={(event) => setEventStatusFilter(event.target.value)}
                >
                  <option value="all">All statuses</option>
                  {eventStatusOptions.map((statusName) => (
                    <option key={statusName} value={statusName}>{statusName}</option>
                  ))}
                </select>
              </div>
              <div className="staff-table-wrap">
                <table className="staff-table">
                  <thead><tr><th>Select</th><th>Event</th><th>Status</th><th>Starts</th><th>Seats</th><th>Waitlist</th></tr></thead>
                  <tbody>
                    {filteredEvents.length === 0 ? (
                      <tr><td colSpan={6}>No events match current filters.</td></tr>
                    ) : (
                      filteredEvents.map((eventRow) => (
                        <tr
                          key={eventRow.id}
                          className={selectedEventId === eventRow.id ? "staff-selected-row" : undefined}
                        >
                          <td>
                            <button
                              type="button"
                              className="btn btn-ghost btn-small"
                              aria-pressed={selectedEventId === eventRow.id}
                              onClick={() => setSelectedEventId(eventRow.id)}
                            >
                              {selectedEventId === eventRow.id ? "Selected" : "View"}
                            </button>
                          </td>
                          <td>
                            <div>{eventRow.title}</div>
                            <div className="staff-mini"><code>{eventRow.id}</code></div>
                          </td>
                          <td><span className="pill">{eventRow.status}</span></td>
                          <td>{eventRow.startAt || when(eventRow.startAtMs)}</td>
                          <td>{eventRow.remainingCapacity}/{eventRow.capacity}</td>
                          <td>{eventRow.waitlistCount}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="staff-column">
              <div className="staff-note">
                {selectedEvent ? (
                  <>
                    <strong>{selectedEvent.title}</strong><br />
                    <span>{selectedEvent.status} · {selectedEvent.location}</span><br />
                    <span>Starts: {selectedEvent.startAt || when(selectedEvent.startAtMs)}</span><br />
                    <span>Ends: {when(selectedEvent.endAtMs)}</span><br />
                    <span>Seats: {selectedEvent.remainingCapacity}/{selectedEvent.capacity} · Waitlist: {selectedEvent.waitlistCount}</span><br />
                    <span>Price: {selectedEvent.priceCents > 0 ? dollars(selectedEvent.priceCents) : "Free / n/a"}</span><br />
                    <span>Last status note: {selectedEvent.lastStatusReason || "-"}</span><br />
                    <span>Status changed: {when(selectedEvent.lastStatusChangedAtMs)}</span>
                  </>
                ) : (
                  "Select an event to inspect signups."
                )}
              </div>
            </div>
          </div>
          <div className="staff-module-grid">
            <div className="staff-column">
              <div className="staff-actions-row">
                <input
                  className="staff-member-search"
                  placeholder="Search signups by name, email, or UID"
                  value={signupSearch}
                  onChange={(event) => setSignupSearch(event.target.value)}
                />
                <select
                  className="staff-member-role-filter"
                  value={signupStatusFilter}
                  onChange={(event) => setSignupStatusFilter(event.target.value)}
                >
                  <option value="all">All signup statuses</option>
                  {signupStatusOptions.map((statusName) => (
                    <option key={statusName} value={statusName}>{statusName}</option>
                  ))}
                </select>
              </div>
              <div className="staff-table-wrap">
                <table className="staff-table">
                  <thead><tr><th>Select</th><th>Name</th><th>Email</th><th>Status</th><th>Payment</th><th>Action</th></tr></thead>
                  <tbody>
                    {filteredSignups.length === 0 ? (
                      <tr><td colSpan={6}>No signups match current filters.</td></tr>
                    ) : (
                      filteredSignups.map((signup) => (
                        <tr
                          key={signup.id}
                          className={selectedSignupId === signup.id ? "staff-selected-row" : undefined}
                        >
                          <td>
                            <button
                              type="button"
                              className="btn btn-ghost btn-small"
                              aria-pressed={selectedSignupId === signup.id}
                              onClick={() => setSelectedSignupId(signup.id)}
                            >
                              {selectedSignupId === signup.id ? "Selected" : "View"}
                            </button>
                          </td>
                          <td>{signup.displayName}</td>
                          <td>{signup.email}</td>
                          <td><span className="pill">{signup.status}</span></td>
                          <td>{signup.paymentStatus}</td>
                          <td>
                            <button
                              className="btn btn-ghost btn-small"
                              disabled={!!busy || signup.status === "checked_in" || !selectedEventId}
                              onClick={() =>
                                void run(`checkin-${signup.id}`, async () => {
                                  if (hasFunctionsAuthMismatch) {
                                    await checkInSignupFallback(signup);
                                  } else {
                                    await client.postJson("checkInEvent", { signupId: signup.id, method: "staff" });
                                  }
                                  await loadSignups(selectedEventId);
                                  await loadEvents();
                                  setStatus("Signup checked in");
                                })
                              }
                            >
                              {signup.status === "checked_in" ? "Checked in" : "Check in"}
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="staff-column">
              <div className="staff-note">
                {selectedSignup ? (
                  <>
                    <strong>{selectedSignup.displayName}</strong><br />
                    <span>{selectedSignup.email}</span><br />
                    <span>Status: {selectedSignup.status} · Payment: {selectedSignup.paymentStatus}</span><br />
                    <span>Created: {when(selectedSignup.createdAtMs)}</span><br />
                    <span>Checked in: {when(selectedSignup.checkedInAtMs)}</span><br />
                    <code>{selectedSignup.uid || selectedSignup.id}</code>
                  </>
                ) : (
                  "Select a signup to inspect details."
                )}
              </div>
            </div>
          </div>
      </>
    </section>
  );

  const commerceContent = (
    <section className="card staff-console-card">
      <div className="card-title">Store & billing</div>
      {hasFunctionsAuthMismatch ? (
        <div className="staff-note">
          Billing summary comes from Cloud Functions. Enable auth emulator (`VITE_USE_AUTH_EMULATOR=true`) or use production Functions URL.
        </div>
      ) : (
        <>
          <div className="staff-kpi-grid">
            <div className="staff-kpi"><span>Order queue</span><strong>{commerceKpis.ordersTotal}</strong></div>
            <div className="staff-kpi"><span>Pending orders</span><strong>{commerceKpis.pendingOrders}</strong></div>
            <div className="staff-kpi"><span>Pending value</span><strong>{dollars(commerceKpis.pendingAmount)}</strong></div>
            <div className="staff-kpi"><span>Unpaid check-ins</span><strong>{commerceKpis.unpaidCheckIns}</strong></div>
            <div className="staff-kpi"><span>Receipts</span><strong>{commerceKpis.receiptsTotal}</strong></div>
            <div className="staff-kpi"><span>Receipts total</span><strong>{dollars(summary?.receiptsAmountCents ?? 0)}</strong></div>
          </div>
          <div className="staff-actions-row">
            <button className="btn btn-secondary" disabled={!!busy} onClick={() => void run("seedMaterialsCatalog", async () => { await client.postJson("seedMaterialsCatalog", { force: true, acknowledge: "ALLOW_NON_DEV_SAMPLE_SEEDING", reason: "staff_console_commerce_seed" }); await loadCommerce(); setStatus("seedMaterialsCatalog completed"); })}>Seed materials catalog</button>
            <input
              className="staff-member-search"
              placeholder="Search orders by id, status, notes"
              value={commerceSearch}
              onChange={(event) => setCommerceSearch(event.target.value)}
            />
            <select
              className="staff-member-role-filter"
              value={commerceStatusFilter}
              onChange={(event) => setCommerceStatusFilter(event.target.value)}
            >
              <option value="all">All order statuses</option>
              {commerceStatusOptions.map((statusName) => (
                <option key={statusName} value={statusName}>{statusName}</option>
              ))}
            </select>
          </div>
          <div className="staff-subtitle">Unpaid check-ins</div>
          <div className="staff-table-wrap">
            <table className="staff-table">
              <thead><tr><th>Event</th><th>Signup</th><th>Amount</th><th>Status</th><th>Checked in</th></tr></thead>
              <tbody>
                {unpaidCheckIns.length === 0 ? (
                  <tr><td colSpan={5}>No unpaid check-ins.</td></tr>
                ) : (
                  unpaidCheckIns.slice(0, 40).map((entry) => (
                    <tr key={entry.signupId}>
                      <td>{entry.eventTitle}<div className="staff-mini"><code>{entry.eventId || "-"}</code></div></td>
                      <td><code>{entry.signupId}</code></td>
                      <td>{entry.amountCents !== null ? dollars(entry.amountCents) : "-"}</td>
                      <td>{entry.paymentStatus || "pending"}</td>
                      <td>{entry.checkedInAt || entry.createdAt || "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="staff-subtitle">Material orders</div>
          <div className="staff-table-wrap">
            <table className="staff-table">
              <thead><tr><th>Order</th><th>Status</th><th>Total</th><th>Items</th><th>Updated</th><th>Action</th></tr></thead>
              <tbody>
                {filteredOrders.length === 0 ? (
                  <tr><td colSpan={6}>No orders match current filters.</td></tr>
                ) : (
                  filteredOrders.map((o) => (
                    <tr key={o.id}>
                      <td><code>{o.id}</code></td>
                      <td><span className="pill">{o.status}</span></td>
                      <td>{dollars(o.totalCents)}</td>
                      <td>{o.itemCount}</td>
                      <td>{o.updatedAt}</td>
                      <td>
                        {o.checkoutUrl ? (
                          <button
                            className="btn btn-ghost btn-small"
                            onClick={() => void copy(o.checkoutUrl ?? "")}
                          >
                            Copy checkout link
                          </button>
                        ) : (
                          <span className="staff-mini">-</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="staff-subtitle">Recent receipts</div>
          <div className="staff-table-wrap">
            <table className="staff-table">
              <thead><tr><th>Receipt</th><th>Type</th><th>Amount</th><th>Paid</th></tr></thead>
              <tbody>
                {receipts.length === 0 ? (
                  <tr><td colSpan={4}>No receipts yet.</td></tr>
                ) : (
                  receipts.slice(0, 40).map((entry) => (
                    <tr key={entry.id}>
                      <td>{entry.title}<div className="staff-mini"><code>{entry.id}</code></div></td>
                      <td>{entry.type}</td>
                      <td>{dollars(entry.amountCents)}</td>
                      <td>{entry.paidAt || entry.createdAt || "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );

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

  useEffect(() => {
    if (!forceEventsWorkspace) return;
    if (moduleKey !== "events") {
      setModuleKey("events");
      setStatus("Dedicated workshops page keeps focus on programming workspace. Open /staff for full module navigation.");
    }
  }, [forceEventsWorkspace, moduleKey]);

  const openModuleFromCockpit = useCallback(
    (target: ModuleKey) => {
      if (forceCockpitWorkspace || forceEventsWorkspace) {
        if (typeof window !== "undefined") {
          window.location.assign("/staff");
        }
        return;
      }
      setModuleKey(target);
    },
    [forceCockpitWorkspace, forceEventsWorkspace]
  );

  const stripeContent = <StripeSettingsModule client={client} isStaff={isStaff} />;
  const reportsContent = (
    <ReportsModule
      client={client}
      active={moduleKey === "reports" || isCockpitModule}
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
  const studioBrainContent = (
    <StudioBrainModule
      user={user}
      active={moduleKey === "studioBrain" || isCockpitModule}
      disabled={false}
      adminToken={devAdminToken}
    />
  );
  const cockpitContent = (
    <section className="staff-module-grid">
      <section className="card staff-console-card">
        <div className="card-title-row">
          <div className="card-title">Ops Cockpit</div>
          <button
            className="btn btn-secondary"
            disabled={Boolean(busy)}
            onClick={() =>
              void run("refreshCockpit", async () => {
                await Promise.allSettled([loadReportOps(), loadSystemStats(), loadAutomationHealthDashboard()]);
                setStatus("Refreshed cockpit telemetry");
              })
            }
          >
            Refresh cockpit
          </button>
        </div>
        <div className="staff-kpi-grid">
          <div className="staff-kpi"><span>High alerts</span><strong>{cockpitKpis.highAlerts}</strong></div>
          <div className="staff-kpi"><span>Medium alerts</span><strong>{cockpitKpis.mediumAlerts}</strong></div>
          <div className="staff-kpi"><span>Open reports</span><strong>{cockpitKpis.openReports}</strong></div>
          <div className="staff-kpi"><span>Failed checks</span><strong>{cockpitKpis.failedChecks}</strong></div>
          <div className="staff-kpi"><span>Checks loaded</span><strong>{cockpitKpis.totalChecks}</strong></div>
          <div className="staff-kpi"><span>Recent handler errors</span><strong>{cockpitKpis.recentErrors}</strong></div>
        </div>
        {cockpitKpis.authMismatch ? (
          <div className="staff-note">
            Local Functions is active while Auth emulator is disabled. Cockpit data may be partial for function-backed operations.
          </div>
        ) : null}
        <nav className="staff-cockpit-nav" aria-label="Cockpit sections">
          <button className="btn btn-ghost btn-small" onClick={() => scrollToCockpitSection(COCKPIT_SECTION_IDS.triage)}>
            Triage
          </button>
          <button className="btn btn-ghost btn-small" onClick={() => scrollToCockpitSection(COCKPIT_SECTION_IDS.automation)}>
            Automation
          </button>
          <button className="btn btn-ghost btn-small" onClick={() => scrollToCockpitSection(COCKPIT_SECTION_IDS.platform)}>
            Platform
          </button>
          <button className="btn btn-ghost btn-small" onClick={() => scrollToCockpitSection(COCKPIT_SECTION_IDS.policyAgentOps)}>
            Policy and Agent Ops
          </button>
          <button className="btn btn-ghost btn-small" onClick={() => scrollToCockpitSection(COCKPIT_SECTION_IDS.reports)}>
            Reports
          </button>
          <button className="btn btn-ghost btn-small" onClick={() => scrollToCockpitSection(COCKPIT_SECTION_IDS.moduleTelemetry)}>
            Module telemetry
          </button>
        </nav>
        <div className="staff-subtitle staff-cockpit-anchor" id={COCKPIT_SECTION_IDS.triage}>Action queue</div>
        <div className="staff-log-list">
          {overviewAlerts.map((alert) => (
            <div key={alert.id} className="staff-log-entry">
              <div className="staff-log-meta">
                <span className="staff-log-label">{alert.severity.toUpperCase()}</span>
                <span>{new Date().toLocaleDateString()}</span>
              </div>
              <div className="staff-log-message">
                {alert.label}
                <div className="staff-actions-row staff-actions-row--mt8">
                  <button className="btn btn-ghost btn-small" onClick={() => openModuleFromCockpit(alert.module)}>
                    {forceCockpitWorkspace ? "Open in full staff console" : alert.actionLabel}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="staff-actions-row">
          <button className="btn btn-secondary" onClick={() => openModuleFromCockpit("pieces")}>
            Open pieces queue
          </button>
          <button className="btn btn-secondary" onClick={() => openModuleFromCockpit("firings")}>
            Open firings triage
          </button>
          <button className="btn btn-secondary" onClick={() => openModuleFromCockpit("events")}>
            Open events desk
          </button>
          <button className="btn btn-secondary" onClick={() => openModuleFromCockpit("commerce")}>
            Open billing queue
          </button>
          <button className="btn btn-secondary" onClick={() => openModuleFromCockpit("reports")}>
            Open reports triage
          </button>
        </div>
        <div className="staff-subtitle staff-cockpit-anchor" id={COCKPIT_SECTION_IDS.automation}>Automation health dashboard</div>
        <div className="staff-kpi-grid">
          <div className="staff-kpi"><span>Monitored workflows</span><strong>{automationKpis.monitored}</strong></div>
          <div className="staff-kpi"><span>Healthy</span><strong>{automationKpis.healthy}</strong></div>
          <div className="staff-kpi"><span>Failing</span><strong>{automationKpis.failing}</strong></div>
          <div className="staff-kpi"><span>In progress</span><strong>{automationKpis.inProgress}</strong></div>
          <div className="staff-kpi"><span>Stale workflows</span><strong>{automationKpis.stale}</strong></div>
          <div className="staff-kpi"><span>Rolling threads</span><strong>{automationKpis.threads}</strong></div>
        </div>
        <div className="staff-actions-row">
          <button
            className="btn btn-secondary btn-small"
            disabled={Boolean(busy) || automationDashboard.loading}
            onClick={() => void run("refreshAutomationHealth", loadAutomationHealthDashboard)}
          >
            {automationDashboard.loading ? "Refreshing..." : "Refresh automation dashboard"}
          </button>
          <a
            className="btn btn-ghost btn-small"
            href={`https://github.com/${GITHUB_REPO_SLUG}/actions/workflows/portal-automation-health-daily.yml`}
            target="_blank"
            rel="noreferrer"
          >
            Open daily workflow
          </a>
          <a
            className="btn btn-ghost btn-small"
            href={`https://github.com/${GITHUB_REPO_SLUG}/actions/workflows/portal-automation-weekly-digest.yml`}
            target="_blank"
            rel="noreferrer"
          >
            Open weekly digest
          </a>
        </div>
        {automationDashboard.error ? (
          <div className="staff-note staff-note-error">
            Automation dashboard fetch error: {automationDashboard.error}
          </div>
        ) : null}
        <div className="staff-mini">
          Source: GitHub Actions + rolling issues for <code>{GITHUB_REPO_SLUG}</code>.
          {automationKpis.loadedAtMs ? ` Last refresh ${when(automationKpis.loadedAtMs)}.` : " Not loaded yet."}
        </div>
        <div className="staff-table-wrap">
          <table className="staff-table">
            <thead>
              <tr>
                <th>Workflow</th>
                <th>Status</th>
                <th>Conclusion</th>
                <th>Last run</th>
                <th>Output</th>
              </tr>
            </thead>
            <tbody>
              {automationDashboard.workflows.length === 0 ? (
                <tr><td colSpan={5}>No automation workflow status loaded yet.</td></tr>
              ) : (
                automationDashboard.workflows.map((workflow) => (
                  <tr key={workflow.key}>
                    <td>
                      <div>{workflow.label}</div>
                      <div className="staff-mini"><code>{workflow.workflowFile}</code></div>
                      <div className="staff-mini">{workflow.outputHint}</div>
                      {workflow.error ? <div className="staff-mini">{workflow.error}</div> : null}
                    </td>
                    <td><span className="pill">{workflow.status || "-"}</span></td>
                    <td>
                      <span className="pill">
                        {workflow.conclusion || (workflow.status === "queued" || workflow.status === "in_progress" ? "running" : "unknown")}
                      </span>
                    </td>
                    <td>
                      {workflow.createdAtMs ? when(workflow.createdAtMs) : "-"}
                      {workflow.isStale ? <div className="staff-mini">stale</div> : null}
                    </td>
                    <td>
                      {workflow.runUrl ? (
                        <a href={workflow.runUrl} target="_blank" rel="noreferrer">Run</a>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="staff-subtitle">Rolling output threads</div>
        <div className="staff-table-wrap">
          <table className="staff-table">
            <thead>
              <tr>
                <th>Thread</th>
                <th>State</th>
                <th>Updated</th>
                <th>Latest output preview</th>
              </tr>
            </thead>
            <tbody>
              {automationDashboard.issues.length === 0 ? (
                <tr><td colSpan={4}>No rolling issue threads loaded yet.</td></tr>
              ) : (
                automationDashboard.issues.map((issue) => (
                  <tr key={issue.key}>
                    <td>
                      {issue.issueUrl ? (
                        <a href={issue.issueUrl} target="_blank" rel="noreferrer">{issue.title}</a>
                      ) : (
                        issue.title
                      )}
                      <div className="staff-mini">#{issue.issueNumber} · {issue.purpose}</div>
                      {issue.error ? <div className="staff-mini">{issue.error}</div> : null}
                    </td>
                    <td><span className="pill">{issue.state || "-"}</span></td>
                    <td>{issue.updatedAtMs ? when(issue.updatedAtMs) : "-"}</td>
                    <td>
                      {issue.latestCommentPreview || "-"}
                      {issue.latestCommentUrl ? (
                        <div className="staff-mini">
                          <a href={issue.latestCommentUrl} target="_blank" rel="noreferrer">Open latest comment</a>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="staff-subtitle staff-cockpit-anchor" id={COCKPIT_SECTION_IDS.platform}>Platform diagnostics</div>
        <div className="staff-note">
          Legacy System-tab diagnostics are now folded into Cockpit for one-place operations.
        </div>
        <div className="staff-kpi-grid">
          <div className="staff-kpi"><span>Functions base</span><strong>{usingLocalFunctions ? "Local" : "Remote"}</strong></div>
          <div className="staff-kpi"><span>Auth mode</span><strong>{showEmulatorTools ? "Emulator" : "Production"}</strong></div>
          <div className="staff-kpi"><span>Integration tokens</span><strong>{integrationTokenCount ?? 0}</strong></div>
          <div className="staff-kpi"><span>System checks</span><strong>{systemChecks.length}</strong></div>
          <div className="staff-kpi"><span>Notif success</span><strong>{notificationMetricsSummary ? `${num(notificationMetricsSummary.successRate, 0)}%` : "-"}</strong></div>
          <div className="staff-kpi"><span>Notif failed</span><strong>{notificationMetricsSummary ? num(notificationMetricsSummary.totalFailed, 0) : "-"}</strong></div>
        </div>
        <div className="staff-actions-row">
          <button
            className="btn btn-secondary"
            disabled={Boolean(busy) || hasFunctionsAuthMismatch}
            onClick={() => void run("cockpitSystemPing", runSystemPing)}
          >
            Ping functions
          </button>
          <button
            className="btn btn-secondary"
            disabled={Boolean(busy) || hasFunctionsAuthMismatch}
            onClick={() => void run("cockpitCalendarProbe", runCalendarProbe)}
          >
            Probe calendar
          </button>
          <button
            className="btn btn-secondary"
            disabled={Boolean(busy) || hasFunctionsAuthMismatch}
            onClick={() => void run("cockpitNotificationMetricsProbe", runNotificationMetricsProbe)}
          >
            Refresh notif metrics
          </button>
          <button
            className="btn btn-secondary"
            disabled={Boolean(busy) || hasFunctionsAuthMismatch}
            onClick={() => void run("cockpitNotificationDrill", runNotificationFailureDrillNow)}
          >
            Run push failure drill
          </button>
          <button
            className="btn btn-secondary"
            disabled={Boolean(busy) || hasFunctionsAuthMismatch}
            onClick={() => void run("cockpitRefreshSystemStats", loadSystemStats)}
          >
            Refresh token stats
          </button>
        </div>
        {hasFunctionsAuthMismatch ? (
          <div className="staff-note">
            Local functions detected at <code>{fBaseUrl}</code> while auth emulator is disabled.
            Function-backed modules are paused to avoid false 401 errors.
          </div>
        ) : null}
        <div className="card-title-row">
          <div className="staff-subtitle">Recent handler errors</div>
          <div className="staff-log-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setHandlerLog(getHandlerErrorLog())}>Refresh</button>
            <button type="button" className="btn btn-ghost" onClick={() => { clearHandlerErrorLog(); setHandlerLog([]); }}>Clear</button>
          </div>
        </div>
        <div className="staff-log-list">
          {latestErrors.length === 0 ? <div className="staff-note">No handler errors logged.</div> : latestErrors.map((entry, idx) => <div key={`${entry.atIso}-${idx}`} className="staff-log-entry"><div className="staff-log-meta"><span className="staff-log-label">{entry.label}</span><span>{new Date(entry.atIso).toLocaleString()}</span></div><div className="staff-log-message">{entry.message}</div></div>)}
        </div>
        <details className="staff-troubleshooting">
          <summary>Developer troubleshooting and raw diagnostics</summary>
          <div className="staff-module-grid">
            <div className="staff-column">
              <div className="staff-subtitle">System checks</div>
              <div className="staff-table-wrap">
                <table className="staff-table">
                  <thead><tr><th>Check</th><th>Status</th><th>Ran at</th><th>Details</th></tr></thead>
                  <tbody>
                    {systemChecks.length === 0 ? (
                      <tr><td colSpan={4}>No checks run yet.</td></tr>
                    ) : (
                      systemChecks.map((entry) => (
                        <tr key={`${entry.key}-${entry.atMs}`}>
                          <td>{entry.label}</td>
                          <td><span className="pill">{entry.ok ? "ok" : "failed"}</span></td>
                          <td>{when(entry.atMs)}</td>
                          <td>{entry.details}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="staff-column">
              {devAdminEnabled ? (
                <label className="staff-field">Dev admin token<input type="password" value={devAdminToken} onChange={(e) => onDevAdminTokenChange(e.target.value)} /></label>
              ) : (
                <div className="staff-note">Dev admin token disabled outside emulator mode.</div>
              )}
              {showEmulatorTools ? <button type="button" className="btn btn-secondary" onClick={() => window.open("http://127.0.0.1:4000/", "_blank")}>Open Emulator UI</button> : null}
              <div className="staff-subtitle">Last Firestore write</div>
              <pre>{safeJsonStringify(lastWrite)}</pre>
              <button className="btn btn-ghost" onClick={() => void copy(safeJsonStringify(lastWrite))}>Copy write JSON</button>
            </div>
            <div className="staff-column">
              <div className="staff-subtitle">Last query params</div>
              <pre>{safeJsonStringify(lastQuery)}</pre>
              <button className="btn btn-ghost" onClick={() => void copy(safeJsonStringify(lastQuery))}>Copy query JSON</button>
              <div className="staff-subtitle">Last GitHub/Functions call</div>
              <pre>{safeJsonStringify(sanitizeLastRequest(lastReq))}</pre>
              <button className="btn btn-ghost" onClick={() => void copy(safeJsonStringify(sanitizeLastRequest(lastReq)))}>Copy call JSON</button>
              <div className="staff-mini">curl hint</div>
              <pre>{lastReq?.curlExample ?? "(none)"}</pre>
              <button className="btn btn-ghost" onClick={() => void copy(lastReq?.curlExample ?? "")} disabled={!lastReq?.curlExample}>Copy curl hint</button>
            </div>
            <div className="staff-column">
              <div className="staff-subtitle">Last error stack/message</div>
              <pre>{safeJsonStringify(lastErr)}</pre>
              {copyStatus ? (
                <div className="staff-note" role="status" aria-live="polite">
                  {copyStatus}
                </div>
              ) : null}
            </div>
          </div>
        </details>
        <div className="staff-subtitle staff-cockpit-anchor" id={COCKPIT_SECTION_IDS.moduleTelemetry}>Module engagement telemetry (rolling local)</div>
        <div className="staff-actions-row">
          <button className="btn btn-ghost btn-small" onClick={resetModuleTelemetry}>
            Reset telemetry
          </button>
          <button className="btn btn-ghost btn-small" onClick={() => void copy(safeJsonStringify(moduleTelemetrySnapshot))}>
            Copy telemetry JSON
          </button>
        </div>
        <div className="staff-note">
          {lowEngagementModules.length === 0
            ? "No low-engagement modules detected in current telemetry."
            : `Low-engagement modules in current telemetry: ${lowEngagementModules.join(", ")}`}
        </div>
        <div className="staff-table-wrap">
          <table className="staff-table">
            <thead>
              <tr>
                <th>Module</th>
                <th>Owner</th>
                <th>Visits</th>
                <th>Dwell</th>
                <th>First action</th>
              </tr>
            </thead>
            <tbody>
              {moduleUsageRows.length === 0 ? (
                <tr><td colSpan={5}>No module activity captured yet.</td></tr>
              ) : (
                moduleUsageRows.map((row) => (
                  <tr key={row.key}>
                    <td>{row.label}</td>
                    <td>{row.owner}</td>
                    <td>{row.visits}</td>
                    <td>{formatDurationMs(row.dwellMs)}</td>
                    <td>{formatLatencyMs(row.firstActionMs)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
      <div className="card staff-console-card staff-cockpit-anchor" id={COCKPIT_SECTION_IDS.policyAgentOps}>{agentOpsContent}</div>
      <div className="card staff-console-card">{governanceContent}</div>
      <div className="card staff-console-card staff-cockpit-anchor" id={COCKPIT_SECTION_IDS.reports}>{reportsContent}</div>
    </section>
  );

const lendingContent = (
    <section className="card staff-console-card">
      <div className="card-title-row">
        <div className="card-title">Lending</div>
        <button className="btn btn-secondary" disabled={Boolean(busy)} onClick={() => void run("refreshLending", loadLending)}>
          Refresh lending
        </button>
      </div>
      <label className="staff-field">
        ISBN import
        <textarea value={isbnInput} onChange={(e) => setIsbnInput(e.target.value)} placeholder="9780596007126, 9780132350884" />
      </label>
      <div className="staff-actions-row">
        <button className="btn btn-primary" disabled={!!busy} onClick={() => {
          const isbns = parseList(isbnInput);
          if (!isbns.length) {
            setError("Paste at least one ISBN.");
            return;
          }
          void run("importLibraryIsbns", async () => {
            await client.postJson("importLibraryIsbns", { isbns });
            setStatus(`Imported ${isbns.length} ISBN(s)`);
            setIsbnInput("");
            await loadLending();
          });
        }}>Import ISBNs</button>
      </div>
      <div className="staff-kpi-grid">
        <div className="staff-kpi"><span>Requests</span><strong>{libraryRequests.length}</strong></div>
        <div className="staff-kpi"><span>Loans</span><strong>{libraryLoans.length}</strong></div>
        <div className="staff-kpi"><span>Filtered requests</span><strong>{lendingTriage.requestView.length}</strong></div>
        <div className="staff-kpi"><span>Filtered loans</span><strong>{lendingTriage.loanView.length}</strong></div>
        <div className="staff-kpi"><span>Open requests</span><strong>{lendingTriage.openRequests.length}</strong></div>
        <div className="staff-kpi"><span>Active loans</span><strong>{lendingTriage.activeLoans.length}</strong></div>
        <div className="staff-kpi"><span>Overdue loans</span><strong>{lendingTriage.overdueLoans.length}</strong></div>
        <div className="staff-kpi"><span>Returned loans</span><strong>{lendingTriage.returnedLoans.length}</strong></div>
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
                        {loan.dueAtMs > 0 && loan.dueAtMs < Date.now() && loan.returnedAtMs === 0 ? (
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
            <details className="staff-troubleshooting">
              <summary>Raw loan document</summary>
              <pre>{safeJsonStringify(selectedLoan.rawDoc)}</pre>
            </details>
          ) : null}
        </div>
      </div>
    </section>
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

  const systemContent = (
    <section className="card staff-console-card">
      <div className="card-title">System</div>
      <div className="staff-kpi-grid">
        <div className="staff-kpi"><span>Functions base</span><strong>{usingLocalFunctions ? "Local" : "Remote"}</strong></div>
        <div className="staff-kpi"><span>Auth mode</span><strong>{showEmulatorTools ? "Emulator" : "Production"}</strong></div>
        <div className="staff-kpi"><span>Integration tokens</span><strong>{integrationTokenCount ?? 0}</strong></div>
        <div className="staff-kpi"><span>System checks</span><strong>{systemChecks.length}</strong></div>
        <div className="staff-kpi"><span>Notif success</span><strong>{notificationMetricsSummary ? `${num(notificationMetricsSummary.successRate, 0)}%` : "-"}</strong></div>
        <div className="staff-kpi"><span>Notif failed</span><strong>{notificationMetricsSummary ? num(notificationMetricsSummary.totalFailed, 0) : "-"}</strong></div>
      </div>
      <div className="staff-actions-row">
        <button
          className="btn btn-secondary"
          disabled={Boolean(busy) || hasFunctionsAuthMismatch}
          onClick={() => void run("systemPing", runSystemPing)}
        >
          Ping functions
        </button>
        <button
          className="btn btn-secondary"
          disabled={Boolean(busy) || hasFunctionsAuthMismatch}
          onClick={() => void run("calendarProbe", runCalendarProbe)}
        >
          Probe calendar
        </button>
        <button
          className="btn btn-secondary"
          disabled={Boolean(busy) || hasFunctionsAuthMismatch}
          onClick={() => void run("notificationMetricsProbe", runNotificationMetricsProbe)}
        >
          Refresh notif metrics
        </button>
        <button
          className="btn btn-secondary"
          disabled={Boolean(busy) || hasFunctionsAuthMismatch}
          onClick={() => void run("notificationDrill", runNotificationFailureDrillNow)}
        >
          Run push failure drill
        </button>
        <button
          className="btn btn-secondary"
          disabled={Boolean(busy) || hasFunctionsAuthMismatch}
          onClick={() => void run("refreshSystemStats", loadSystemStats)}
        >
          Refresh token stats
        </button>
        <button className="btn btn-secondary" disabled>
          Studio Brain checks retired
        </button>
      </div>
      {hasFunctionsAuthMismatch ? (
        <div className="staff-note">
          Local functions detected at <code>{fBaseUrl}</code> while auth emulator is disabled.
          Function-backed modules are paused to avoid false 401 errors.
        </div>
      ) : null}
      {devAdminEnabled ? (
        <label className="staff-field">Dev admin token<input type="password" value={devAdminToken} onChange={(e) => onDevAdminTokenChange(e.target.value)} /></label>
      ) : (
        <div className="staff-note">Dev admin token disabled outside emulator mode.</div>
      )}
      {showEmulatorTools ? <button type="button" className="btn btn-secondary" onClick={() => window.open("http://127.0.0.1:4000/", "_blank")}>Open Emulator UI</button> : null}
      <div className="card-title-row">
        <div className="staff-subtitle">Handler errors</div>
        <div className="staff-log-actions">
          <button type="button" className="btn btn-ghost" onClick={() => setHandlerLog(getHandlerErrorLog())}>Refresh</button>
          <button type="button" className="btn btn-ghost" onClick={() => { clearHandlerErrorLog(); setHandlerLog([]); }}>Clear</button>
        </div>
      </div>
      <div className="staff-log-list">
        {latestErrors.length === 0 ? <div className="staff-note">No handler errors logged.</div> : latestErrors.map((entry, idx) => <div key={`${entry.atIso}-${idx}`} className="staff-log-entry"><div className="staff-log-meta"><span className="staff-log-label">{entry.label}</span><span>{new Date(entry.atIso).toLocaleString()}</span></div><div className="staff-log-message">{entry.message}</div></div>)}
      </div>
      <div className="card-title-row">
        <div className="staff-subtitle">System checks</div>
      </div>
      <div className="staff-table-wrap">
        <table className="staff-table">
          <thead><tr><th>Check</th><th>Status</th><th>Ran at</th><th>Details</th></tr></thead>
          <tbody>
            {systemChecks.length === 0 ? (
              <tr><td colSpan={4}>No checks run yet.</td></tr>
            ) : (
              systemChecks.map((entry) => (
                <tr key={`${entry.key}-${entry.atMs}`}>
                  <td>{entry.label}</td>
                  <td><span className="pill">{entry.ok ? "ok" : "failed"}</span></td>
                  <td>{when(entry.atMs)}</td>
                  <td>{entry.details}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <details className="staff-troubleshooting">
        <summary>Troubleshooting drawer</summary>
        <div className="staff-module-grid">
          <div className="staff-column">
            <div className="staff-subtitle">Last Firestore write</div>
            <pre>{safeJsonStringify(lastWrite)}</pre>
            <button className="btn btn-ghost" onClick={() => void copy(safeJsonStringify(lastWrite))}>Copy write JSON</button>
          </div>
          <div className="staff-column">
            <div className="staff-subtitle">Last query params</div>
            <pre>{safeJsonStringify(lastQuery)}</pre>
            <button className="btn btn-ghost" onClick={() => void copy(safeJsonStringify(lastQuery))}>Copy query JSON</button>
          </div>
          <div className="staff-column">
            <div className="staff-subtitle">Last GitHub/Functions call</div>
            <pre>{safeJsonStringify(sanitizeLastRequest(lastReq))}</pre>
            <button className="btn btn-ghost" onClick={() => void copy(safeJsonStringify(sanitizeLastRequest(lastReq)))}>Copy call JSON</button>
            <div className="staff-mini">curl hint</div>
            <pre>{lastReq?.curlExample ?? "(none)"}</pre>
            <button className="btn btn-ghost" onClick={() => void copy(lastReq?.curlExample ?? "")} disabled={!lastReq?.curlExample}>Copy curl hint</button>
          </div>
          <div className="staff-column">
            <div className="staff-subtitle">Last error stack/message</div>
            <pre>{safeJsonStringify(lastErr)}</pre>
          </div>
        </div>
        {copyStatus ? (
          <div className="staff-note" role="status" aria-live="polite">
            {copyStatus}
          </div>
        ) : null}
      </details>
    </section>
  );

  const moduleContentByKey: Record<ModuleKey, ReactNode> = {
    cockpit: cockpitContent,
    checkins: (
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
    ),
    members: membersContent,
    pieces: piecesContent,
    firings: firingsContent,
    events: eventsContent,
    reports: reportsContent,
    studioBrain: studioBrainContent,
    stripe: stripeContent,
    commerce: commerceContent,
    lending: lendingContent,
    system: systemContent,
  };
  const moduleContent = moduleContentByKey[moduleKey];

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
      <div className="staff-hero card card-3d">
        <div className="card-title-row">
          <div className="card-title">Staff Console</div>
          <div className="staff-hero-actions">
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
            {moduleKey === "cockpit" && !forceCockpitWorkspace ? (
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => setCockpitWorkspaceMode((prev) => !prev)}
              >
                {cockpitWorkspaceMode ? "Show module rail" : "Focus cockpit workspace"}
              </button>
            ) : null}
            {moduleKey === "cockpit" ? (
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => {
                  if (typeof window === "undefined") return;
                  if (forceCockpitWorkspace) {
                    window.location.assign("/staff");
                    return;
                  }
                  window.open("/staff/cockpit", "_blank", "noopener");
                }}
              >
                {forceCockpitWorkspace ? "Open full staff console" : "Open dedicated cockpit page"}
              </button>
            ) : null}
            {moduleKey === "events" ? (
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => {
                  if (typeof window === "undefined") return;
                  if (forceEventsWorkspace) {
                    window.location.assign("/staff");
                    return;
                  }
                  window.open("/staff/workshops", "_blank", "noopener");
                }}
              >
                {forceEventsWorkspace ? "Open full staff console" : "Open dedicated workshops page"}
              </button>
            ) : null}
          </div>
        </div>
        <p className="card-subtitle">Portal administration for users, pieces, firings, events, store, lending, and system health.</p>
        <div className="staff-note">Data is lazy-loaded. Start with <strong>Load current module</strong> to keep reads controlled.</div>
        <div className="staff-meta">
          <div><span className="label">Signed in</span><strong>{user.displayName ?? "Staff"}</strong></div>
          <div><span className="label">Role</span><strong>{staffAuthorityLabel}</strong></div>
          <div><span className="label">Email</span><strong>{user.email ?? "-"}</strong></div>
          <div><span className="label">UID</span><strong>{user.uid}</strong></div>
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
      </div>

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
                onClick={() => setModuleKey(m.key)}
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
                    onClick={() => setModuleKey(m.key)}
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
        <div className="staff-console-content" ref={moduleContentRef}>{moduleContent}</div>
      </div>
    </div>
  );
}
