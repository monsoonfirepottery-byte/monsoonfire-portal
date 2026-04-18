import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { resolveFirebaseProjectId } from "../cloud/firebaseProject";
import {
  deriveOpsCapabilities,
  makeId,
  normalizeOpsHumanRole,
  normalizeOpsHumanRoles,
  type MemberActivityRecord,
  type MemberOpsRecord,
  type OpsCapability,
  type OpsEventRecord,
  type OpsHumanRole,
  type OpsLendingLoanRecord,
  type OpsLendingRequestRecord,
  type OpsLendingSnapshot,
  type OpsMemberAuditRecord,
  type OpsPortalRole,
  type OpsReportRecord,
  type ReservationBundle,
  type RoleChangeRecord,
  type MembershipChangeRecord,
} from "./contracts";

function ensureFirebaseAdmin(): void {
  if (getApps().length > 0) return;
  initializeApp({ projectId: resolveFirebaseProjectId() });
}

function firestore() {
  ensureFirebaseAdmin();
  return getFirestore();
}

function auth() {
  ensureFirebaseAdmin();
  return getAuth();
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanNullableString(value: unknown): string | null {
  const normalized = cleanString(value);
  return normalized.length ? normalized : null;
}

function toFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value;
  }
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === "object" && value !== null && "toDate" in value && typeof (value as { toDate?: unknown }).toDate === "function") {
    const date = (value as { toDate: () => Date }).toDate();
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  return null;
}

function toPortalRole(value: unknown): OpsPortalRole | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "admin" || normalized === "owner") return "admin";
  if (normalized === "staff") return "staff";
  if (normalized === "member" || normalized === "client" || normalized === "user") return "member";
  return null;
}

export function derivePortalRoleFromClaims(claims: Record<string, unknown>): OpsPortalRole {
  if (claims.admin === true) return "admin";
  if (claims.staff === true) return "staff";
  const claimsRole = toPortalRole(claims.role);
  if (claimsRole) return claimsRole;
  const roles = Array.isArray(claims.roles) ? claims.roles.map((entry) => cleanString(entry).toLowerCase()) : [];
  if (roles.includes("admin")) return "admin";
  if (roles.includes("staff")) return "staff";
  return "member";
}

export function deriveOpsRolesFromClaims(claims: Record<string, unknown>): OpsHumanRole[] {
  const direct = normalizeOpsHumanRoles(claims.opsRoles);
  if (direct.length > 0) return direct;
  const portalRole = derivePortalRoleFromClaims(claims);
  if (portalRole === "admin") {
    return ["owner", "member_ops", "support_ops", "kiln_lead", "floor_staff", "events_ops", "library_ops", "finance_ops"];
  }
  if (portalRole === "staff") {
    return ["member_ops", "support_ops", "kiln_lead", "floor_staff", "events_ops", "library_ops"];
  }
  return [];
}

export function deriveOpsCapabilitiesFromClaims(claims: Record<string, unknown>): OpsCapability[] {
  const direct = Array.isArray(claims.opsCapabilities)
    ? claims.opsCapabilities
        .map((entry) => cleanString(entry))
        .filter((entry): entry is OpsCapability => entry.length > 0)
    : [];
  if (direct.length > 0) return direct;
  return deriveOpsCapabilities(deriveOpsRolesFromClaims(claims));
}

export function buildClaimsForOpsRoles(
  existingClaims: Record<string, unknown>,
  portalRole: OpsPortalRole,
  opsRoles: OpsHumanRole[],
): Record<string, unknown> {
  const nextOpsRoles = normalizeOpsHumanRoles(opsRoles);
  const nextPortalRole = portalRole === "admin" && !nextOpsRoles.includes("owner") ? "staff" : portalRole;
  const staff = nextOpsRoles.length > 0 || nextPortalRole === "staff" || nextPortalRole === "admin";
  const admin = nextOpsRoles.includes("owner") || nextPortalRole === "admin";
  const existingRoleEntries = Array.isArray(existingClaims.roles)
    ? existingClaims.roles.map((entry) => cleanString(entry)).filter(Boolean)
    : [];
  const preserved = existingRoleEntries.filter((entry) => entry !== "staff" && entry !== "admin");
  const roles = [
    ...preserved,
    ...(staff ? ["staff"] : []),
    ...(admin ? ["admin"] : []),
  ];
  return {
    ...existingClaims,
    role: admin ? "admin" : staff ? "staff" : "member",
    staff,
    admin,
    roles: [...new Set(roles)],
    opsRoles: nextOpsRoles,
    opsCapabilities: deriveOpsCapabilities(nextOpsRoles),
  };
}

function buildDisplayName(uid: string, row: Record<string, unknown>): string {
  return (
    cleanString(row.displayName)
    || cleanString(row.name)
    || cleanString(row.fullName)
    || cleanString(row.ownerName)
    || `Member ${uid.slice(0, 6)}`
  );
}

function readCollectionRole(raw: Record<string, unknown>): OpsPortalRole | null {
  return [
    raw.role,
    raw.userRole,
    raw.memberRole,
    raw.staffRole,
    raw.profileRole,
    raw.accountRole,
  ]
    .map((value) => toPortalRole(value))
    .find((value): value is OpsPortalRole => value !== null) ?? null;
}

function memberRecordFromSource(input: {
  uid: string;
  userData: Record<string, unknown>;
  profileData?: Record<string, unknown>;
  claims?: Record<string, unknown>;
}): MemberOpsRecord {
  const merged = {
    ...(input.profileData ?? {}),
    ...input.userData,
  };
  const claims = input.claims ?? {};
  const portalRole = derivePortalRoleFromClaims(claims) ?? readCollectionRole(merged) ?? "member";
  const opsRoles = deriveOpsRolesFromClaims(claims);
  return {
    uid: input.uid,
    email: cleanNullableString(merged.email),
    displayName: buildDisplayName(input.uid, merged),
    membershipTier: cleanNullableString(merged.membershipTier),
    kilnPreferences: cleanNullableString(merged.kilnPreferences),
    staffNotes: cleanNullableString(merged.staffNotes),
    portalRole,
    opsRoles,
    opsCapabilities: deriveOpsCapabilities(opsRoles),
    createdAt: toIso(merged.createdAt),
    updatedAt: toIso(merged.updatedAt),
    lastSeenAt: toIso(merged.lastSeenAt),
    metadata: {
      sourceCollections: ["users", ...(input.profileData ? ["profiles"] : [])],
    },
  };
}

async function countCollection(collectionName: string, field: string, value: string): Promise<number> {
  const snapshot = await firestore().collection(collectionName).where(field, "==", value).count().get();
  const data = snapshot.data();
  return typeof data.count === "number" ? data.count : 0;
}

async function countArrayContains(collectionName: string, field: string, value: string): Promise<number> {
  const snapshot = await firestore().collection(collectionName).where(field, "array-contains", value).count().get();
  const data = snapshot.data();
  return typeof data.count === "number" ? data.count : 0;
}

async function latestTimestampForCollection(collectionName: string, field: string, value: string, orderField: string): Promise<string | null> {
  const snapshot = await firestore()
    .collection(collectionName)
    .where(field, "==", value)
    .orderBy(orderField, "desc")
    .limit(1)
    .get();
  const row = snapshot.docs[0]?.data() as Record<string, unknown> | undefined;
  return row ? toIso(row[orderField]) : null;
}

function reservationBundleFromDoc(id: string, raw: Record<string, unknown>): ReservationBundle {
  const preferredLatest = toIso((raw.preferredWindow as { latestDate?: unknown } | null | undefined)?.latestDate);
  const createdAt = toIso(raw.createdAt);
  const updatedAt = toIso(raw.updatedAt);
  const dueAt = preferredLatest ?? createdAt ?? updatedAt;
  const notesBlock = raw.notes as { general?: unknown; clayBody?: unknown; glazeNotes?: unknown } | null | undefined;
  const notes = cleanNullableString(notesBlock?.general) || cleanNullableString(raw.staffNotes) || cleanNullableString(raw.notes);
  const pieces = Array.isArray(raw.pieces) ? raw.pieces : [];
  const pieceCount = pieces.reduce((sum, entry) => {
    if (!entry || typeof entry !== "object") return sum + 1;
    const next = Math.max(1, Math.round(toFiniteNumber((entry as Record<string, unknown>).pieceCount) ?? 1));
    return sum + next;
  }, 0);
  const shelfEquivalent = Math.max(1, Math.round(toFiniteNumber(raw.estimatedHalfShelves) ?? toFiniteNumber(raw.shelfEquivalent) ?? 1));
  const itemCount = pieceCount > 0 ? pieceCount : shelfEquivalent;
  const displayName =
    cleanString(raw.displayName)
    || cleanString(raw.ownerName)
    || cleanString(raw.clientName)
    || "Studio member";
  const arrivalStatus = cleanString(raw.arrivalStatus).toLowerCase() || "expected";
  const arrivedAt = toIso(raw.arrivedAt);
  const firingType = cleanString(raw.firingType) || "kiln service";
  const prepActions = [
    "Confirm shelf space and kiln profile.",
    "Review member notes and special handling before intake.",
    notes ? "Read the prep notes before checking the work in." : "If anything looks unusual at intake, route it to the studio manager.",
  ];
  return {
    id: `reservation:${id}`,
    reservationId: id,
    title: `${displayName} · ${firingType}`,
    status: cleanString(raw.status) || "REQUESTED",
    ownerUid: cleanNullableString(raw.ownerUid),
    displayName,
    firingType,
    dueAt,
    itemCount,
    shelfEquivalent,
    notes,
    arrival: {
      status: arrivalStatus || "expected",
      dueAt,
      arrivedAt,
      summary: arrivedAt
        ? `${displayName} has already arrived for this reservation.`
        : dueAt
          ? `${displayName} is expected around ${new Date(dueAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.`
          : `${displayName} has an open reservation without a precise arrival window.`,
      confidence: arrivedAt ? 1 : 0.66,
      verificationClass: arrivedAt ? "confirmed" : "planned",
    },
    prep: {
      summary: notes ? "Prep notes and intake context are available." : "Standard intake prep is likely enough.",
      actions: prepActions,
      toolsNeeded: ["intake station", "reservation queue", "kiln board"],
      assignedRole: "floor_staff",
    },
    linkedTaskIds: [],
    verificationClass: dueAt ? "planned" : "inferred",
    freshestAt: updatedAt ?? createdAt ?? dueAt,
    sources: [
      {
        id: `reservation:${id}`,
        system: "firestore",
        label: "Reservation",
        kind: "reservation",
        observedAt: updatedAt ?? createdAt,
        freshnessMs: null,
      },
    ],
    confidence: 0.72,
    degradeReason: dueAt ? null : "Reservation is missing a preferred arrival window.",
    metadata: {
      queuePositionHint: toFiniteNumber(raw.queuePositionHint),
      loadStatus: cleanNullableString(raw.loadStatus),
      kilnId: cleanNullableString(raw.kilnId),
    },
  };
}

export type OpsStaffDataSource = {
  listMembers(limit?: number): Promise<MemberOpsRecord[]>;
  getMember(uid: string): Promise<MemberOpsRecord | null>;
  updateMemberProfile(input: {
    uid: string;
    actorId: string;
    patch: {
      displayName?: string | null;
      membershipTier?: string | null;
      kilnPreferences?: string | null;
      staffNotes?: string | null;
    };
    reason?: string | null;
  }): Promise<{ member: MemberOpsRecord | null; audit: OpsMemberAuditRecord }>;
  updateMemberMembership(input: {
    uid: string;
    actorId: string;
    membershipTier: string | null;
    reason?: string | null;
  }): Promise<{ member: MemberOpsRecord | null; audit: MembershipChangeRecord & { summary: string } }>;
  updateMemberRole(input: {
    uid: string;
    actorId: string;
    portalRole: OpsPortalRole;
    opsRoles: OpsHumanRole[];
    reason?: string | null;
  }): Promise<{ member: MemberOpsRecord | null; audit: RoleChangeRecord & { summary: string } }>;
  getMemberActivity(uid: string): Promise<MemberActivityRecord>;
  listReservations(limit?: number): Promise<ReservationBundle[]>;
  getReservationBundle(id: string): Promise<ReservationBundle | null>;
  listEvents(limit?: number): Promise<OpsEventRecord[]>;
  listReports(limit?: number): Promise<OpsReportRecord[]>;
  getLendingSnapshot(): Promise<OpsLendingSnapshot>;
};

export function createOpsStaffDataSource(): OpsStaffDataSource {
  return {
    async listMembers(limit = 240): Promise<MemberOpsRecord[]> {
      const db = firestore();
      const [usersSnap, profilesSnap] = await Promise.all([
        db.collection("users").limit(Math.max(1, limit)).get(),
        db.collection("profiles").limit(Math.max(1, limit)).get().catch(() => null),
      ]);
      const profilesByUid = new Map<string, Record<string, unknown>>();
      for (const doc of profilesSnap?.docs ?? []) {
        profilesByUid.set(doc.id, (doc.data() ?? {}) as Record<string, unknown>);
      }
      const rows = await Promise.all(usersSnap.docs.map(async (doc) => {
        const userData = (doc.data() ?? {}) as Record<string, unknown>;
        let claims: Record<string, unknown> = {};
        try {
          const user = await auth().getUser(doc.id);
          claims = (user.customClaims ?? {}) as Record<string, unknown>;
        } catch {
          claims = {};
        }
        return memberRecordFromSource({
          uid: doc.id,
          userData,
          profileData: profilesByUid.get(doc.id),
          claims,
        });
      }));
      return rows.sort((a, b) => a.displayName.localeCompare(b.displayName));
    },

    async getMember(uid: string): Promise<MemberOpsRecord | null> {
      const db = firestore();
      const [userSnap, profileSnap] = await Promise.all([
        db.collection("users").doc(uid).get(),
        db.collection("profiles").doc(uid).get().catch(() => null),
      ]);
      if (!userSnap.exists && !profileSnap?.exists) return null;
      let claims: Record<string, unknown> = {};
      try {
        const user = await auth().getUser(uid);
        claims = (user.customClaims ?? {}) as Record<string, unknown>;
      } catch {
        claims = {};
      }
      return memberRecordFromSource({
        uid,
        userData: ((userSnap.data() ?? {}) as Record<string, unknown>),
        profileData: profileSnap?.exists ? (profileSnap.data() ?? {}) as Record<string, unknown> : undefined,
        claims,
      });
    },

    async updateMemberProfile(input) {
      const db = firestore();
      const now = new Date();
      const patch: Record<string, unknown> = {
        updatedAt: now,
        staffProfileUpdatedBy: input.actorId,
      };
      if ("displayName" in input.patch) patch.displayName = input.patch.displayName ?? null;
      if ("membershipTier" in input.patch) patch.membershipTier = input.patch.membershipTier ?? null;
      if ("kilnPreferences" in input.patch) patch.kilnPreferences = input.patch.kilnPreferences ?? null;
      if ("staffNotes" in input.patch) patch.staffNotes = input.patch.staffNotes ?? null;
      await db.collection("users").doc(input.uid).set(patch, { merge: true });
      const audit: OpsMemberAuditRecord = {
        id: makeId("ops_member_audit"),
        uid: input.uid,
        kind: "profile",
        actorId: input.actorId,
        summary: "Profile fields were updated from the ops portal.",
        reason: cleanNullableString(input.reason),
        createdAt: now.toISOString(),
        payload: { patch },
      };
      await db.collection("staffProfileEdits").doc(audit.id).set({
        uid: input.uid,
        editedByUid: input.actorId,
        reason: audit.reason,
        patch,
        at: now,
        source: "studio-brain-ops",
      });
      return {
        member: await this.getMember(input.uid),
        audit,
      };
    },

    async updateMemberMembership(input) {
      const db = firestore();
      const now = new Date();
      await db.collection("users").doc(input.uid).set(
        {
          membershipTier: input.membershipTier ?? null,
          updatedAt: now,
          membershipUpdatedByUid: input.actorId,
        },
        { merge: true },
      );
      const audit: MembershipChangeRecord & { summary: string } = {
        id: makeId("ops_membership_change"),
        uid: input.uid,
        editedByUid: input.actorId,
        beforeTier: null,
        afterTier: input.membershipTier ?? null,
        reason: cleanNullableString(input.reason),
        createdAt: now.toISOString(),
        summary: `Membership tier changed to ${input.membershipTier ?? "none"}.`,
      };
      await db.collection("staffMembershipEdits").doc(audit.id).set({
        uid: input.uid,
        editedByUid: input.actorId,
        reason: audit.reason,
        afterTier: audit.afterTier,
        at: now,
        source: "studio-brain-ops",
      });
      return {
        member: await this.getMember(input.uid),
        audit,
      };
    },

    async updateMemberRole(input) {
      const currentUser = await auth().getUser(input.uid);
      const existingClaims = (currentUser.customClaims ?? {}) as Record<string, unknown>;
      const beforePortalRole = derivePortalRoleFromClaims(existingClaims);
      const beforeOpsRoles = deriveOpsRolesFromClaims(existingClaims);
      const nextClaims = buildClaimsForOpsRoles(existingClaims, input.portalRole, input.opsRoles);
      await auth().setCustomUserClaims(input.uid, nextClaims);
      const now = new Date();
      await firestore().collection("users").doc(input.uid).set(
        {
          customClaims: nextClaims,
          claims: nextClaims,
          role: nextClaims.role ?? null,
          staffRole: nextClaims.role ?? null,
          opsRoles: input.opsRoles,
          opsCapabilities: deriveOpsCapabilities(input.opsRoles),
          roleUpdatedByUid: input.actorId,
          roleUpdatedAt: now,
          updatedAt: now,
        },
        { merge: true },
      );
      const audit: RoleChangeRecord & { summary: string } = {
        id: makeId("ops_role_change"),
        uid: input.uid,
        editedByUid: input.actorId,
        beforePortalRole,
        afterPortalRole: input.portalRole,
        beforeOpsRoles,
        afterOpsRoles: normalizeOpsHumanRoles(input.opsRoles),
        reason: cleanNullableString(input.reason),
        createdAt: now.toISOString(),
        summary: `Role access changed to ${input.portalRole} with ${normalizeOpsHumanRoles(input.opsRoles).join(", ") || "no"} ops roles.`,
      };
      await firestore().collection("staffRoleEdits").doc(audit.id).set({
        uid: input.uid,
        editedByUid: input.actorId,
        reason: audit.reason,
        beforeRole: beforePortalRole,
        afterRole: input.portalRole,
        beforeOpsRoles,
        afterOpsRoles: audit.afterOpsRoles,
        afterClaims: nextClaims,
        at: now,
        source: "studio-brain-ops",
      });
      return {
        member: await this.getMember(input.uid),
        audit,
      };
    },

    async getMemberActivity(uid: string): Promise<MemberActivityRecord> {
      const [reservations, libraryLoans, supportThreads, events, lastReservationAt, lastLoanAt, lastEventAt] = await Promise.all([
        countCollection("reservations", "ownerUid", uid),
        countCollection("libraryLoans", "uid", uid).catch(() => 0),
        countArrayContains("directMessages", "participants", uid).catch(() => 0),
        countCollection("eventSignups", "uid", uid).catch(() => 0),
        latestTimestampForCollection("reservations", "ownerUid", uid, "updatedAt").catch(() => null),
        latestTimestampForCollection("libraryLoans", "uid", uid, "updatedAt").catch(() => null),
        latestTimestampForCollection("eventSignups", "uid", uid, "updatedAt").catch(() => null),
      ]);
      return {
        uid,
        reservations,
        libraryLoans,
        supportThreads,
        events,
        lastReservationAt,
        lastLoanAt,
        lastEventAt,
      };
    },

    async listReservations(limit = 60): Promise<ReservationBundle[]> {
      const snapshot = await firestore().collection("reservations").limit(Math.max(1, limit)).get();
      const rows = snapshot.docs.map((doc) => reservationBundleFromDoc(doc.id, (doc.data() ?? {}) as Record<string, unknown>));
      return rows.sort((a, b) => String(a.dueAt ?? "9999").localeCompare(String(b.dueAt ?? "9999")));
    },

    async getReservationBundle(id: string): Promise<ReservationBundle | null> {
      const snapshot = await firestore().collection("reservations").doc(id).get();
      if (!snapshot.exists) return null;
      return reservationBundleFromDoc(snapshot.id, (snapshot.data() ?? {}) as Record<string, unknown>);
    },

    async listEvents(limit = 120): Promise<OpsEventRecord[]> {
      const snapshot = await firestore().collection("events").limit(Math.max(1, limit)).get();
      return snapshot.docs
        .map((doc) => {
          const row = (doc.data() ?? {}) as Record<string, unknown>;
          return {
            id: doc.id,
            title: cleanString(row.title) || "Untitled event",
            status: cleanString(row.status) || "draft",
            startAt: toIso(row.startAt),
            endAt: toIso(row.endAt),
            remainingCapacity: toFiniteNumber(row.remainingCapacity),
            capacity: toFiniteNumber(row.capacity),
            waitlistCount: toFiniteNumber(row.waitlistCount),
            location: cleanNullableString(row.location),
            priceCents: toFiniteNumber(row.priceCents),
            lastStatusReason: cleanNullableString(row.lastStatusReason),
            lastStatusChangedAt: toIso(row.lastStatusChangedAt),
          } satisfies OpsEventRecord;
        })
        .sort((a, b) => String(a.startAt ?? "9999").localeCompare(String(b.startAt ?? "9999")));
    },

    async listReports(limit = 120): Promise<OpsReportRecord[]> {
      const snapshot = await firestore()
        .collection("communityReports")
        .orderBy("createdAt", "desc")
        .limit(Math.max(1, limit))
        .get();
      return snapshot.docs.map((doc) => {
        const row = (doc.data() ?? {}) as Record<string, unknown>;
        return {
          id: doc.id,
          status: cleanString(row.status) || "open",
          severity: cleanString(row.severity) || "low",
          summary: cleanString(row.summary) || cleanString(row.notes) || "Community report",
          createdAt: toIso(row.createdAt),
          ownerUid: cleanNullableString(row.ownerUid),
        } satisfies OpsReportRecord;
      });
    },

    async getLendingSnapshot(): Promise<OpsLendingSnapshot> {
      const db = firestore();
      const [requestsSnap, loansSnap, recommendationsSnap, tagsSnap, itemsSnap] = await Promise.all([
        db.collection("libraryRequests").limit(60).get(),
        db.collection("libraryLoans").limit(60).get(),
        db.collection("libraryRecommendations").limit(120).get(),
        db.collection("libraryTagSubmissions").limit(160).get(),
        db.collection("libraryItems").limit(400).get().catch(() => null),
      ]);
      const requests: OpsLendingRequestRecord[] = requestsSnap.docs.map((doc) => {
        const row = (doc.data() ?? {}) as Record<string, unknown>;
        return {
          id: doc.id,
          status: cleanString(row.status) || "open",
          requesterUid: cleanNullableString(row.requesterUid ?? row.uid ?? row.ownerUid),
          requesterName: cleanNullableString(row.requesterName ?? row.displayName),
          title: cleanString(row.title) || "Library request",
          createdAt: toIso(row.createdAt),
        };
      });
      const loans: OpsLendingLoanRecord[] = loansSnap.docs.map((doc) => {
        const row = (doc.data() ?? {}) as Record<string, unknown>;
        return {
          id: doc.id,
          status: cleanString(row.status) || "active",
          borrowerUid: cleanNullableString(row.borrowerUid ?? row.uid ?? row.ownerUid),
          borrowerName: cleanNullableString(row.borrowerName ?? row.displayName),
          title: cleanString(row.title) || "Library loan",
          createdAt: toIso(row.createdAt),
          dueAt: toIso(row.dueAt),
        };
      });
      const coverReviewCount = (itemsSnap?.docs ?? []).reduce((sum, doc) => {
        const row = (doc.data() ?? {}) as Record<string, unknown>;
        const status = cleanString(row.coverQualityStatus).toLowerCase();
        return sum + (row.needsCoverReview === true || status === "needs_review" || status === "missing" ? 1 : 0);
      }, 0);
      return {
        requests,
        loans,
        recommendationCount: recommendationsSnap.size,
        tagSubmissionCount: tagsSnap.size,
        coverReviewCount,
      };
    },
  };
}
