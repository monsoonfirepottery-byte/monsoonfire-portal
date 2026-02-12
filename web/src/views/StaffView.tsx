import { useCallback, useEffect, useMemo, useState } from "react";
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
import { db } from "../firebase";
import { clearHandlerErrorLog, getHandlerErrorLog } from "../utils/handlerLog";
import PolicyModule from "./staff/PolicyModule";
import StripeSettingsModule from "./staff/StripeSettingsModule";
import ReportsModule from "./staff/ReportsModule";
import AgentOpsModule from "./staff/AgentOpsModule";

type Props = {
  user: User;
  isStaff: boolean;
  devAdminToken: string;
  onDevAdminTokenChange: (next: string) => void;
  devAdminEnabled: boolean;
  showEmulatorTools: boolean;
};

type ModuleKey =
  | "overview"
  | "members"
  | "pieces"
  | "firings"
  | "events"
  | "reports"
  | "governance"
  | "agentOps"
  | "stripe"
  | "commerce"
  | "lending"
  | "system";

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
type BatchActionName =
  | "shelveBatch"
  | "kilnLoad"
  | "kilnUnload"
  | "readyForPickup"
  | "pickedUpAndClose"
  | "continueJourney";

const MODULES: Array<{ key: ModuleKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "members", label: "Members" },
  { key: "pieces", label: "Pieces & batches" },
  { key: "firings", label: "Firings" },
  { key: "events", label: "Events" },
  { key: "reports", label: "Reports" },
  { key: "governance", label: "Governance" },
  { key: "agentOps", label: "Agent ops" },
  { key: "stripe", label: "Stripe settings" },
  { key: "commerce", label: "Store & billing" },
  { key: "lending", label: "Lending" },
  { key: "system", label: "System" },
];

const DEFAULT_FUNCTIONS_BASE_URL = "https://us-central1-monsoonfire-portal.cloudfunctions.net";
type ImportMetaEnvShape = { VITE_FUNCTIONS_BASE_URL?: string };
const ENV = (import.meta.env ?? {}) as ImportMetaEnvShape;

function functionsBaseUrl() {
  return typeof import.meta !== "undefined" && ENV.VITE_FUNCTIONS_BASE_URL
    ? String(ENV.VITE_FUNCTIONS_BASE_URL)
    : DEFAULT_FUNCTIONS_BASE_URL;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown): boolean {
  return value === true;
}

function toTsMs(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object") {
    const maybe = value as { toMillis?: () => number; seconds?: number; nanoseconds?: number };
    if (typeof maybe.toMillis === "function") return maybe.toMillis();
    if (typeof maybe.seconds === "number") {
      return Math.floor(maybe.seconds * 1000 + (typeof maybe.nanoseconds === "number" ? maybe.nanoseconds : 0) / 1_000_000);
    }
  }
  return 0;
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

function normalizeBatchState(status: string): string {
  return status.trim().toUpperCase().replace(/\s+/g, "_");
}

function memberRole(data: Record<string, unknown>): string {
  const claims = data.claims as Record<string, unknown> | undefined;
  if (claims?.staff === true) return "staff";
  if (claims?.admin === true) return "admin";
  const roles = Array.isArray(claims?.roles) ? claims?.roles : [];
  if (roles.includes("staff")) return "staff";
  if (roles.includes("admin")) return "admin";
  return str(data.role, "member");
}

function maxMs(...values: number[]): number {
  return values.reduce((acc, value) => (value > acc ? value : acc), 0);
}

export default function StaffView({
  user,
  isStaff,
  devAdminToken,
  onDevAdminTokenChange,
  devAdminEnabled,
  showEmulatorTools,
}: Props) {
  const [moduleKey, setModuleKey] = useState<ModuleKey>("overview");
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
  const [batchPieces, setBatchPieces] = useState<BatchPieceRecord[]>([]);
  const [batchTimeline, setBatchTimeline] = useState<BatchTimelineRecord[]>([]);
  const [batchDetailBusy, setBatchDetailBusy] = useState(false);
  const [batchDetailError, setBatchDetailError] = useState("");
  const [kilnId, setKilnId] = useState("studio-electric");
  const [selectedFiringId, setSelectedFiringId] = useState("");
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
  const [integrationTokenCount, setIntegrationTokenCount] = useState<number | null>(null);
  const [notificationMetricsSummary, setNotificationMetricsSummary] = useState<{
    totalSent?: number;
    totalFailed?: number;
    successRate?: number;
  } | null>(null);

  const fBaseUrl = useMemo(() => functionsBaseUrl(), []);
  const usingLocalFunctions = useMemo(
    () => fBaseUrl.includes("localhost") || fBaseUrl.includes("127.0.0.1"),
    [fBaseUrl]
  );
  const hasFunctionsAuthMismatch = usingLocalFunctions && !showEmulatorTools;

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
        if (!search) return true;
        const haystack = `${batch.title} ${batch.id} ${batch.ownerUid} ${batch.status}`.toLowerCase();
        return haystack.includes(search);
      })
      .sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  }, [batchSearch, batchStatusFilter, batches]);
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
        actionLabel: "Stay on overview",
        module: "overview",
      });
    }
    return alerts;
  }, [batches, events, firings, orders, reportOps.highOpen, reportOps.open, reportOps.slaBreaches, unpaidCheckIns.length]);

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
        const haystack = `${member.displayName} ${member.email} ${member.id}`.toLowerCase();
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
      return {
        id: uid,
        displayName: str(merged.displayName, "Unknown"),
        email: str(merged.email, "-"),
        role: memberRole(merged),
        createdAtMs,
        updatedAtMs,
        lastSeenAtMs,
        membershipTier: str(merged.membershipTier, "Studio Member"),
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
        membershipTier: "Studio Member",
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
    const snap = await getDocs(query(collection(db, "batches"), orderBy("updatedAt", "desc"), limit(80)));
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
  }, [client, hasFunctionsAuthMismatch, selectedEventId]);

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

  const loadAll = useCallback(async () => {
    const tasks: Array<Promise<unknown>> = [loadUsers(), loadBatches(), loadFirings(), loadLending(), loadEvents(), loadReportOps()];
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
  }, [hasFunctionsAuthMismatch, loadBatches, loadCommerce, loadEvents, loadFirings, loadLending, loadReportOps, loadSignups, loadSystemStats, loadUsers, selectedEventId]);

  useEffect(() => {
    void run("bootstrap", async () => {
      await loadAll();
      setStatus("Staff modules loaded.");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedEventId) return;
    void run("signups", async () => await loadSignups(selectedEventId));
  }, [loadSignups, selectedEventId, run]);

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

  const overviewContent = (
    <section className="card staff-console-card">
      <div className="card-title">Operations snapshot</div>
      <div className="staff-kpi-grid">
        <div className="staff-kpi"><span>Members</span><strong>{users.length}</strong></div>
        <div className="staff-kpi"><span>Open batches</span><strong>{batches.filter((b) => !b.isClosed).length}</strong></div>
        <div className="staff-kpi"><span>Firings</span><strong>{firings.length}</strong></div>
        <div className="staff-kpi"><span>Events</span><strong>{events.length}</strong></div>
        <div className="staff-kpi"><span>Pending orders</span><strong>{orders.filter((o) => o.status !== "paid").length}</strong></div>
        <div className="staff-kpi"><span>Lending requests</span><strong>{libraryRequests.length}</strong></div>
        <div className="staff-kpi"><span>Open reports</span><strong>{reportOps.open}</strong></div>
        <div className="staff-kpi"><span>Report SLA breaches</span><strong>{reportOps.slaBreaches}</strong></div>
      </div>
      <div className="staff-subtitle">Action queue</div>
      <div className="staff-log-list">
        {overviewAlerts.map((alert) => (
          <div key={alert.id} className="staff-log-entry">
            <div className="staff-log-meta">
              <span className="staff-log-label">{alert.severity.toUpperCase()}</span>
              <span>{new Date().toLocaleDateString()}</span>
            </div>
            <div className="staff-log-message">
              {alert.label}
              <div className="staff-actions-row" style={{ marginTop: 8 }}>
                <button
                  className="btn btn-ghost btn-small"
                  onClick={() => setModuleKey(alert.module)}
                >
                  {alert.actionLabel}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="staff-actions-row">
        <button className="btn btn-secondary" onClick={() => setModuleKey("pieces")}>
          Open pieces queue
        </button>
        <button className="btn btn-secondary" onClick={() => setModuleKey("firings")}>
          Open firings triage
        </button>
        <button className="btn btn-secondary" onClick={() => setModuleKey("events")}>
          Open events desk
        </button>
        <button className="btn btn-secondary" onClick={() => setModuleKey("commerce")}>
          Open billing queue
        </button>
        <button className="btn btn-secondary" onClick={() => setModuleKey("system")}>
          Open system health
        </button>
        <button className="btn btn-secondary" onClick={() => setModuleKey("reports")}>
          Open reports triage
        </button>
      </div>
    </section>
  );

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
                  <th>Email</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {filteredMembers.length === 0 ? (
                  <tr>
                    <td colSpan={4}>No members match current filters.</td>
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
        <div className="staff-kpi"><span>Total batches</span><strong>{batches.length}</strong></div>
        <div className="staff-kpi"><span>Open</span><strong>{batches.filter((batch) => !batch.isClosed).length}</strong></div>
        <div className="staff-kpi"><span>Closed</span><strong>{batches.filter((batch) => batch.isClosed).length}</strong></div>
        <div className="staff-kpi"><span>In current filter</span><strong>{filteredBatches.length}</strong></div>
        <div className="staff-kpi"><span>Pieces in selected</span><strong>{batchPieces.length}</strong></div>
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
          </div>
          <div className="staff-table-wrap">
            <table className="staff-table">
              <thead>
                <tr>
                  <th>Batch</th>
                  <th>Status</th>
                  <th>Owner UID</th>
                  <th>Kiln</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {filteredBatches.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No batches match current filters.</td>
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
                  <span key={entry.action} className="pill" style={{ marginRight: 6 }}>
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
              {selectedFiring.confidence.toLowerCase() === "low" ? <span className="pill" style={{ marginRight: 6 }}>low confidence</span> : null}
              {selectedFiring.startAtMs > 0 && selectedFiring.endAtMs === 0 ? <span className="pill" style={{ marginRight: 6 }}>missing end window</span> : null}
              {selectedFiring.updatedAtMs > 0 && Date.now() - selectedFiring.updatedAtMs > 12 * 60 * 60 * 1000 && ["loading", "firing", "cooling", "unloading", "loaded"].includes(selectedFiring.status.toLowerCase()) ? (
                <span className="pill" style={{ marginRight: 6 }}>stale active</span>
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
            <div className="staff-actions-row">
              <button className="btn btn-secondary" disabled={!!busy} onClick={() => void run("syncFiringsNow", async () => { await client.postJson("syncFiringsNow", {}); await loadFirings(); setStatus("syncFiringsNow requested"); })}>Sync now</button>
              <button className="btn btn-secondary" disabled={!!busy} onClick={() => void run("acceptFiringsCalendar", async () => { await client.postJson("acceptFiringsCalendar", {}); setStatus("acceptFiringsCalendar requested"); })}>Accept calendar</button>
              <button className="btn btn-secondary" disabled={!!busy} onClick={() => void run("debugCalendarId", async () => { await client.postJson("debugCalendarId", {}); setStatus("debugCalendarId requested"); })}>Debug calendar</button>
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
            <label className="staff-field" style={{ flex: 2 }}>
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
            <label className="staff-field" style={{ flex: 1 }}>
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
            <label className="staff-field" style={{ flex: 1 }}>
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
                  <thead><tr><th>Event</th><th>Status</th><th>Starts</th><th>Seats</th><th>Waitlist</th></tr></thead>
                  <tbody>
                    {filteredEvents.length === 0 ? (
                      <tr><td colSpan={5}>No events match current filters.</td></tr>
                    ) : (
                      filteredEvents.map((eventRow) => (
                        <tr
                          key={eventRow.id}
                          className={`staff-click-row ${selectedEventId === eventRow.id ? "active" : ""}`}
                          onClick={() => setSelectedEventId(eventRow.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setSelectedEventId(eventRow.id);
                            }
                          }}
                          tabIndex={0}
                        >
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
                  <thead><tr><th>Name</th><th>Email</th><th>Status</th><th>Payment</th><th>Action</th></tr></thead>
                  <tbody>
                    {filteredSignups.length === 0 ? (
                      <tr><td colSpan={5}>No signups match current filters.</td></tr>
                    ) : (
                      filteredSignups.map((signup) => (
                        <tr
                          key={signup.id}
                          className={`staff-click-row ${selectedSignupId === signup.id ? "active" : ""}`}
                          onClick={() => setSelectedSignupId(signup.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setSelectedSignupId(signup.id);
                            }
                          }}
                          tabIndex={0}
                        >
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
            <button className="btn btn-secondary" disabled={!!busy} onClick={() => void run("seedMaterialsCatalog", async () => { await client.postJson("seedMaterialsCatalog", {}); await loadCommerce(); setStatus("seedMaterialsCatalog completed"); })}>Seed materials catalog</button>
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

  const stripeContent = <StripeSettingsModule client={client} isStaff={isStaff} />;
  const reportsContent = (
    <ReportsModule client={client} active={moduleKey === "reports"} disabled={hasFunctionsAuthMismatch} />
  );
  const governanceContent = (
    <PolicyModule client={client} active={moduleKey === "governance"} disabled={hasFunctionsAuthMismatch} />
  );
  const agentOpsContent = (
    <AgentOpsModule client={client} active={moduleKey === "agentOps"} disabled={hasFunctionsAuthMismatch} />
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
                          <span className="pill" style={{ marginLeft: 6 }}>overdue</span>
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
        mode: "invalidToken",
        forceRunNow: true,
        channels: { inApp: false, email: false, push: true },
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
            <pre>{safeJsonStringify(lastReq)}</pre>
            <button className="btn btn-ghost" onClick={() => void copy(safeJsonStringify(lastReq))}>Copy call JSON</button>
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

  const moduleContent = {
    overview: overviewContent,
    members: membersContent,
    pieces: piecesContent,
    firings: firingsContent,
    events: eventsContent,
    reports: reportsContent,
    governance: governanceContent,
    agentOps: agentOpsContent,
    stripe: stripeContent,
    commerce: commerceContent,
    lending: lendingContent,
    system: systemContent,
  }[moduleKey];

  return (
    <div className="staff-console">
      <div className="staff-hero card card-3d">
        <div className="card-title-row">
          <div className="card-title">Staff Console</div>
          <button
            className="btn btn-secondary"
            disabled={Boolean(busy)}
            onClick={() => void run("refreshAll", async () => { await loadAll(); setStatus("Refreshed all modules"); })}
          >
            {busy ? "Working..." : "Refresh all"}
          </button>
        </div>
        <p className="card-subtitle">Portal administration for users, pieces, firings, events, store, lending, and system health.</p>
        <div className="staff-meta">
          <div><span className="label">Signed in</span><strong>{user.displayName ?? "Staff"}</strong></div>
          <div><span className="label">Role</span><strong>{isStaff ? "Staff claim" : "No staff claim"}</strong></div>
          <div><span className="label">Email</span><strong>{user.email ?? "-"}</strong></div>
          <div><span className="label">UID</span><strong>{user.uid}</strong></div>
        </div>
        {hasFunctionsAuthMismatch ? <div className="staff-note">Functions emulator is local, but Auth emulator is off. StaffView is running in Firestore-only safe mode for function-backed modules.</div> : null}
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

      <div className="staff-console-layout">
        <aside className="card staff-console-nav">
          <div className="staff-subtitle">Modules</div>
          <div className="staff-module-list">
            {MODULES.map((m) => (
              <button key={m.key} className={`staff-module-btn ${moduleKey === m.key ? "active" : ""}`} onClick={() => setModuleKey(m.key)}>
                {m.label}
              </button>
            ))}
          </div>
        </aside>
        <div className="staff-console-content">{moduleContent}</div>
      </div>
    </div>
  );
}
