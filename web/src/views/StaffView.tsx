import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import {
  collection,
  getCountFromServer,
  getDocs,
  limit,
  orderBy,
  query,
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
  const [orders, setOrders] = useState<Array<{ id: string; status: string; totalCents: number; updatedAt: string }>>([]);
  const [libraryRequests, setLibraryRequests] = useState<LendingRequestRecord[]>([]);
  const [libraryLoans, setLibraryLoans] = useState<LendingLoanRecord[]>([]);

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
  const [selectedEventId, setSelectedEventId] = useState("");
  const [eventSearch, setEventSearch] = useState("");
  const [eventStatusFilter, setEventStatusFilter] = useState("all");
  const [signupSearch, setSignupSearch] = useState("");
  const [signupStatusFilter, setSignupStatusFilter] = useState("all");
  const [selectedSignupId, setSelectedSignupId] = useState("");
  const [isbnInput, setIsbnInput] = useState("");
  const [lendingSearch, setLendingSearch] = useState("");
  const [lendingStatusFilter, setLendingStatusFilter] = useState("all");
  const [selectedRequestId, setSelectedRequestId] = useState("");
  const [selectedLoanId, setSelectedLoanId] = useState("");

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
      return;
    }
    const resp = await client.postJson<{
      summary?: typeof summary;
      materialsOrders?: Array<Record<string, unknown>>;
    }>("listBillingSummary", { limit: 60 });
    setSummary(resp.summary ?? null);
    setOrders(
      (resp.materialsOrders ?? []).map((o) => ({
        id: str(o.id),
        status: str(o.status, "unknown"),
        totalCents: num(o.totalCents, 0),
        updatedAt: str(o.updatedAt, "-"),
      }))
    );
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

  const loadAll = useCallback(async () => {
    const tasks: Array<Promise<unknown>> = [loadUsers(), loadBatches(), loadFirings(), loadLending(), loadEvents()];
    if (!hasFunctionsAuthMismatch) {
      tasks.push(loadCommerce());
    } else {
      setSummary(null);
      setOrders([]);
    }
    await Promise.allSettled(tasks);
    if (selectedEventId) await loadSignups(selectedEventId);
  }, [hasFunctionsAuthMismatch, loadBatches, loadCommerce, loadEvents, loadFirings, loadLending, loadSignups, loadUsers, selectedEventId]);

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

  const batchAction = (
    name: "shelveBatch" | "kilnLoad" | "kilnUnload" | "readyForPickup" | "pickedUpAndClose" | "continueJourney"
  ) => {
    if (!selectedBatchId) return;
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
            <button className="btn btn-secondary" disabled={!selectedBatchId || !!busy} onClick={() => batchAction("shelveBatch")}>Shelve</button>
            <button className="btn btn-secondary" disabled={!selectedBatchId || !!busy} onClick={() => batchAction("kilnLoad")}>Kiln load</button>
            <button className="btn btn-secondary" disabled={!selectedBatchId || !!busy} onClick={() => batchAction("kilnUnload")}>Kiln unload</button>
            <button className="btn btn-secondary" disabled={!selectedBatchId || !!busy} onClick={() => batchAction("readyForPickup")}>Ready for pickup</button>
            <button className="btn btn-secondary" disabled={!selectedBatchId || !!busy} onClick={() => batchAction("pickedUpAndClose")}>Close picked up</button>
            <button className="btn btn-primary" disabled={!selectedBatchId || !!busy} onClick={() => batchAction("continueJourney")}>Continue journey</button>
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
        <div className="staff-kpi"><span>Active now</span><strong>{firings.filter((firing) => ["loading", "firing", "cooling", "unloading"].includes(firing.status)).length}</strong></div>
        <div className="staff-kpi"><span>Scheduled</span><strong>{firings.filter((firing) => firing.status === "scheduled").length}</strong></div>
        <div className="staff-kpi"><span>Completed</span><strong>{firings.filter((firing) => firing.status === "completed").length}</strong></div>
        <div className="staff-kpi"><span>In current filter</span><strong>{filteredFirings.length}</strong></div>
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
                {filteredFirings.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No firings match current filters.</td>
                  </tr>
                ) : (
                  filteredFirings.map((firing) => (
                    <tr
                      key={firing.id}
                      className={`staff-click-row ${selectedFiringId === firing.id ? "active" : ""}`}
                      onClick={() => setSelectedFiringId(firing.id)}
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
            <div className="staff-kpi"><span>Total events</span><strong>{events.length}</strong></div>
            <div className="staff-kpi"><span>Filtered events</span><strong>{filteredEvents.length}</strong></div>
            <div className="staff-kpi"><span>Signups loaded</span><strong>{signups.length}</strong></div>
            <div className="staff-kpi"><span>Checked in</span><strong>{signups.filter((signup) => signup.status === "checked_in").length}</strong></div>
            <div className="staff-kpi"><span>Paid</span><strong>{signups.filter((signup) => signup.paymentStatus === "paid").length}</strong></div>
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
                    <span>Price: {selectedEvent.priceCents > 0 ? dollars(selectedEvent.priceCents) : "Free / n/a"}</span>
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
                        >
                          <td>{signup.displayName}</td>
                          <td>{signup.email}</td>
                          <td><span className="pill">{signup.status}</span></td>
                          <td>{signup.paymentStatus}</td>
                          <td>
                            <button
                              className="btn btn-ghost btn-small"
                              disabled={!!busy || signup.status === "checked_in" || !selectedEventId || hasFunctionsAuthMismatch}
                              onClick={() =>
                                void run(`checkin-${signup.id}`, async () => {
                                  await client.postJson("checkInEvent", { signupId: signup.id, method: "staff" });
                                  await loadSignups(selectedEventId);
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
            <div className="staff-kpi"><span>Unpaid check-ins</span><strong>{summary?.unpaidCheckInsCount ?? 0}</strong></div>
            <div className="staff-kpi"><span>Unpaid check-ins</span><strong>{dollars(summary?.unpaidCheckInsAmountCents ?? 0)}</strong></div>
            <div className="staff-kpi"><span>Pending materials</span><strong>{summary?.materialsPendingCount ?? 0}</strong></div>
            <div className="staff-kpi"><span>Pending amount</span><strong>{dollars(summary?.materialsPendingAmountCents ?? 0)}</strong></div>
            <div className="staff-kpi"><span>Receipts</span><strong>{summary?.receiptsCount ?? 0}</strong></div>
            <div className="staff-kpi"><span>Receipts total</span><strong>{dollars(summary?.receiptsAmountCents ?? 0)}</strong></div>
          </div>
          <div className="staff-actions-row">
            <button className="btn btn-secondary" disabled={!!busy} onClick={() => void run("seedMaterialsCatalog", async () => { await client.postJson("seedMaterialsCatalog", {}); await loadCommerce(); setStatus("seedMaterialsCatalog completed"); })}>Seed materials catalog</button>
          </div>
          <div className="staff-table-wrap">
            <table className="staff-table">
              <thead><tr><th>Order</th><th>Status</th><th>Total</th><th>Updated</th></tr></thead>
              <tbody>{orders.map((o) => <tr key={o.id}><td><code>{o.id}</code></td><td><span className="pill">{o.status}</span></td><td>{dollars(o.totalCents)}</td><td>{o.updatedAt}</td></tr>)}</tbody>
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
        <div className="staff-kpi"><span>Filtered requests</span><strong>{filteredRequests.length}</strong></div>
        <div className="staff-kpi"><span>Filtered loans</span><strong>{filteredLoans.length}</strong></div>
        <div className="staff-kpi"><span>Open requests</span><strong>{libraryRequests.filter((request) => request.status === "open").length}</strong></div>
        <div className="staff-kpi"><span>Active loans</span><strong>{libraryLoans.filter((loan) => loan.status === "active").length}</strong></div>
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
      </div>
      <div className="staff-module-grid">
        <div className="staff-column">
          <div className="staff-subtitle">Requests</div>
          <div className="staff-table-wrap">
            <table className="staff-table">
              <thead><tr><th>Title</th><th>Status</th><th>Requester</th><th>Created</th></tr></thead>
              <tbody>
                {filteredRequests.length === 0 ? (
                  <tr><td colSpan={4}>No requests match current filters.</td></tr>
                ) : (
                  filteredRequests.map((request) => (
                    <tr
                      key={request.id}
                      className={`staff-click-row ${selectedRequestId === request.id ? "active" : ""}`}
                      onClick={() => setSelectedRequestId(request.id)}
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
                {filteredLoans.length === 0 ? (
                  <tr><td colSpan={4}>No loans match current filters.</td></tr>
                ) : (
                  filteredLoans.map((loan) => (
                    <tr
                      key={loan.id}
                      className={`staff-click-row ${selectedLoanId === loan.id ? "active" : ""}`}
                      onClick={() => setSelectedLoanId(loan.id)}
                    >
                      <td>
                        <div>{loan.title}</div>
                        <div className="staff-mini"><code>{loan.id}</code></div>
                      </td>
                      <td><span className="pill">{loan.status}</span></td>
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
            <details className="staff-troubleshooting">
              <summary>Raw loan document</summary>
              <pre>{safeJsonStringify(selectedLoan.rawDoc)}</pre>
            </details>
          ) : null}
        </div>
      </div>
    </section>
  );

  const systemContent = (
    <section className="card staff-console-card">
      <div className="card-title">System</div>
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
        {copyStatus ? <div className="staff-note">{copyStatus}</div> : null}
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
        {status ? <div className="staff-note">{status}</div> : null}
        {error ? <div className="staff-note staff-note-error">{error}</div> : null}
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
