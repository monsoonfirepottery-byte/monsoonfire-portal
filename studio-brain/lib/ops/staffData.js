"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.derivePortalRoleFromClaims = derivePortalRoleFromClaims;
exports.deriveOpsRolesFromClaims = deriveOpsRolesFromClaims;
exports.deriveOpsCapabilitiesFromClaims = deriveOpsCapabilitiesFromClaims;
exports.buildClaimsForOpsRoles = buildClaimsForOpsRoles;
exports.createOpsStaffDataSource = createOpsStaffDataSource;
const app_1 = require("firebase-admin/app");
const auth_1 = require("firebase-admin/auth");
const firestore_1 = require("firebase-admin/firestore");
const firebaseProject_1 = require("../cloud/firebaseProject");
const contracts_1 = require("./contracts");
const pii_1 = require("./pii");
function ensureFirebaseAdmin() {
    if ((0, app_1.getApps)().length > 0)
        return;
    (0, app_1.initializeApp)({ projectId: (0, firebaseProject_1.resolveFirebaseProjectId)() });
}
function firestore() {
    ensureFirebaseAdmin();
    return (0, firestore_1.getFirestore)();
}
function auth() {
    ensureFirebaseAdmin();
    return (0, auth_1.getAuth)();
}
function cleanString(value) {
    return typeof value === "string" ? value.trim() : "";
}
function cleanNullableString(value) {
    const normalized = cleanString(value);
    return normalized.length ? normalized : null;
}
function toFiniteNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
function toIso(value) {
    if (!value)
        return null;
    if (typeof value === "string") {
        const parsed = Date.parse(value);
        return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value;
    }
    if (value instanceof Date && Number.isFinite(value.getTime()))
        return value.toISOString();
    if (typeof value === "object" && value !== null && "toDate" in value && typeof value.toDate === "function") {
        const date = value.toDate();
        return Number.isFinite(date.getTime()) ? date.toISOString() : null;
    }
    return null;
}
function toPortalRole(value) {
    if (typeof value !== "string")
        return null;
    const normalized = value.trim().toLowerCase();
    if (normalized === "admin" || normalized === "owner")
        return "admin";
    if (normalized === "staff")
        return "staff";
    if (normalized === "member" || normalized === "client" || normalized === "user")
        return "member";
    return null;
}
function derivePortalRoleFromClaims(claims) {
    if (claims.admin === true)
        return "admin";
    if (claims.staff === true)
        return "staff";
    const claimsRole = toPortalRole(claims.role);
    if (claimsRole)
        return claimsRole;
    const roles = Array.isArray(claims.roles) ? claims.roles.map((entry) => cleanString(entry).toLowerCase()) : [];
    if (roles.includes("admin"))
        return "admin";
    if (roles.includes("staff"))
        return "staff";
    return "member";
}
function deriveOpsRolesFromClaims(claims) {
    const direct = (0, contracts_1.normalizeOpsHumanRoles)(claims.opsRoles);
    if (direct.length > 0)
        return direct;
    const portalRole = derivePortalRoleFromClaims(claims);
    if (portalRole === "admin") {
        return ["owner", "member_ops", "support_ops", "kiln_lead", "floor_staff", "events_ops", "library_ops", "finance_ops"];
    }
    if (portalRole === "staff") {
        return ["member_ops", "support_ops", "kiln_lead", "floor_staff", "events_ops", "library_ops"];
    }
    return [];
}
function deriveOpsCapabilitiesFromClaims(claims) {
    const direct = Array.isArray(claims.opsCapabilities)
        ? claims.opsCapabilities
            .map((entry) => cleanString(entry))
            .filter((entry) => entry.length > 0)
        : [];
    if (direct.length > 0)
        return direct;
    return (0, contracts_1.deriveOpsCapabilities)(deriveOpsRolesFromClaims(claims));
}
function buildClaimsForOpsRoles(existingClaims, portalRole, opsRoles) {
    const nextOpsRoles = (0, contracts_1.normalizeOpsHumanRoles)(opsRoles);
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
        opsCapabilities: (0, contracts_1.deriveOpsCapabilities)(nextOpsRoles),
    };
}
function buildDisplayName(uid, row) {
    return (cleanString(row.displayName)
        || cleanString(row.name)
        || cleanString(row.fullName)
        || cleanString(row.ownerName)
        || `Member ${uid.slice(0, 6)}`);
}
function readCollectionRole(raw) {
    return [
        raw.role,
        raw.userRole,
        raw.memberRole,
        raw.staffRole,
        raw.profileRole,
        raw.accountRole,
    ]
        .map((value) => toPortalRole(value))
        .find((value) => value !== null) ?? null;
}
function memberRecordFromSource(input) {
    const merged = {
        ...(input.profileData ?? {}),
        ...input.userData,
    };
    const claims = input.claims ?? {};
    const portalRole = derivePortalRoleFromClaims(claims) ?? readCollectionRole(merged) ?? "member";
    const opsRoles = deriveOpsRolesFromClaims(claims);
    const decryptedStaffNotes = (0, pii_1.decryptOpsPiiJson)(merged.staffNotesEncrypted)?.value ?? null;
    return {
        uid: input.uid,
        email: cleanNullableString(merged.email),
        displayName: buildDisplayName(input.uid, merged),
        membershipTier: cleanNullableString(merged.membershipTier),
        kilnPreferences: cleanNullableString(merged.kilnPreferences),
        staffNotes: cleanNullableString(decryptedStaffNotes ?? merged.staffNotes),
        billing: memberBillingFromSource(merged),
        portalRole,
        opsRoles,
        opsCapabilities: (0, contracts_1.deriveOpsCapabilities)(opsRoles),
        createdAt: toIso(merged.createdAt),
        updatedAt: toIso(merged.updatedAt),
        lastSeenAt: toIso(merged.lastSeenAt),
        metadata: {
            sourceCollections: ["users", ...(input.profileData ? ["profiles"] : [])],
        },
    };
}
function billingSummaryFromSource(input) {
    const parts = [
        cleanNullableString(input.cardBrand),
        input.cardLast4 ? `•••• ${cleanString(input.cardLast4)}` : null,
        input.expMonth && input.expYear ? `exp ${cleanString(input.expMonth)}/${cleanString(input.expYear)}` : null,
    ].filter(Boolean);
    return parts.length ? parts.join(" · ") : null;
}
function memberBillingFromSource(merged) {
    const safeProfile = typeof merged.billingProfile === "object" && merged.billingProfile !== null
        ? merged.billingProfile
        : {};
    const encryptedProfile = (0, pii_1.decryptOpsPiiJson)(merged.billingProfileEncrypted) ?? {};
    const profile = {
        ...safeProfile,
        ...encryptedProfile,
    };
    const stripeCustomerId = cleanNullableString(profile.stripeCustomerId ?? merged.stripeCustomerId);
    const defaultPaymentMethodId = cleanNullableString(profile.defaultPaymentMethodId ?? merged.defaultPaymentMethodId);
    const cardBrand = cleanNullableString(profile.cardBrand);
    const cardLast4 = cleanNullableString(profile.cardLast4);
    const expMonth = cleanNullableString(profile.expMonth);
    const expYear = cleanNullableString(profile.expYear);
    const billingContactName = cleanNullableString(profile.billingContactName);
    const billingContactEmail = cleanNullableString(profile.billingContactEmail);
    const billingContactPhone = cleanNullableString(profile.billingContactPhone);
    const updatedAt = toIso(profile.updatedAt) ?? toIso(merged.updatedAt);
    const paymentMethodSummary = billingSummaryFromSource({ cardBrand, cardLast4, expMonth, expYear });
    const hasSafeSummaryOnly = Boolean(cardBrand || cardLast4 || expMonth || expYear);
    if (!stripeCustomerId
        && !defaultPaymentMethodId
        && !cardBrand
        && !cardLast4
        && !billingContactName
        && !billingContactEmail
        && !billingContactPhone) {
        return null;
    }
    return {
        stripeCustomerId,
        defaultPaymentMethodId,
        cardBrand,
        cardLast4,
        expMonth,
        expYear,
        paymentMethodSummary,
        billingContactName,
        billingContactEmail,
        billingContactPhone,
        storageMode: encryptedProfile && Object.keys(encryptedProfile).length > 0
            ? "stripe_tokenized_only"
            : hasSafeSummaryOnly
                ? "stripe_tokenized_only"
                : "plaintext_fallback",
        updatedAt,
    };
}
function protectStaffNotes(value) {
    const normalized = cleanNullableString(value);
    if (!normalized) {
        return {
            plaintext: null,
            encrypted: null,
            protectedAtRest: false,
        };
    }
    const encrypted = (0, pii_1.encryptOpsPiiJson)({ value: normalized });
    if (encrypted) {
        return {
            plaintext: null,
            encrypted,
            protectedAtRest: true,
        };
    }
    return {
        plaintext: normalized,
        encrypted: null,
        protectedAtRest: false,
    };
}
function buildBillingStorage(input, updatedAt) {
    const sensitiveProfile = {
        stripeCustomerId: cleanNullableString(input.stripeCustomerId),
        defaultPaymentMethodId: cleanNullableString(input.defaultPaymentMethodId),
        billingContactName: cleanNullableString(input.billingContactName),
        billingContactEmail: cleanNullableString(input.billingContactEmail),
        billingContactPhone: cleanNullableString(input.billingContactPhone),
    };
    const hasSensitiveFields = Object.values(sensitiveProfile).some((value) => value !== null);
    const encryptedProfile = hasSensitiveFields ? (0, pii_1.encryptOpsPiiJson)(sensitiveProfile) : null;
    const safeProfile = {
        cardBrand: cleanNullableString(input.cardBrand),
        cardLast4: cleanNullableString(input.cardLast4),
        expMonth: cleanNullableString(input.expMonth),
        expYear: cleanNullableString(input.expYear),
        storageMode: encryptedProfile || !hasSensitiveFields ? "stripe_tokenized_only" : "plaintext_fallback",
        updatedAt,
    };
    if (!encryptedProfile) {
        safeProfile.stripeCustomerId = sensitiveProfile.stripeCustomerId;
        safeProfile.defaultPaymentMethodId = sensitiveProfile.defaultPaymentMethodId;
        safeProfile.billingContactName = sensitiveProfile.billingContactName;
        safeProfile.billingContactEmail = sensitiveProfile.billingContactEmail;
        safeProfile.billingContactPhone = sensitiveProfile.billingContactPhone;
    }
    return {
        publicProfile: safeProfile,
        encryptedProfile,
        protectedAtRest: encryptedProfile !== null,
        fullProfile: memberBillingFromSource({
            billingProfile: safeProfile,
            billingProfileEncrypted: encryptedProfile,
        }),
    };
}
async function countCollection(collectionName, field, value) {
    const snapshot = await firestore().collection(collectionName).where(field, "==", value).count().get();
    const data = snapshot.data();
    return typeof data.count === "number" ? data.count : 0;
}
async function countArrayContains(collectionName, field, value) {
    const snapshot = await firestore().collection(collectionName).where(field, "array-contains", value).count().get();
    const data = snapshot.data();
    return typeof data.count === "number" ? data.count : 0;
}
async function latestTimestampForCollection(collectionName, field, value, orderField) {
    const snapshot = await firestore()
        .collection(collectionName)
        .where(field, "==", value)
        .orderBy(orderField, "desc")
        .limit(1)
        .get();
    const row = snapshot.docs[0]?.data();
    return row ? toIso(row[orderField]) : null;
}
function reservationBundleFromDoc(id, raw) {
    const preferredLatest = toIso(raw.preferredWindow?.latestDate);
    const createdAt = toIso(raw.createdAt);
    const updatedAt = toIso(raw.updatedAt);
    const dueAt = preferredLatest ?? createdAt ?? updatedAt;
    const notesBlock = raw.notes;
    const notes = cleanNullableString(notesBlock?.general) || cleanNullableString(raw.staffNotes) || cleanNullableString(raw.notes);
    const pieces = Array.isArray(raw.pieces) ? raw.pieces : [];
    const pieceCount = pieces.reduce((sum, entry) => {
        if (!entry || typeof entry !== "object")
            return sum + 1;
        const next = Math.max(1, Math.round(toFiniteNumber(entry.pieceCount) ?? 1));
        return sum + next;
    }, 0);
    const shelfEquivalent = Math.max(1, Math.round(toFiniteNumber(raw.estimatedHalfShelves) ?? toFiniteNumber(raw.shelfEquivalent) ?? 1));
    const itemCount = pieceCount > 0 ? pieceCount : shelfEquivalent;
    const displayName = cleanString(raw.displayName)
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
function createOpsStaffDataSource() {
    return {
        async listMembers(limit = 240) {
            const db = firestore();
            const [usersSnap, profilesSnap] = await Promise.all([
                db.collection("users").limit(Math.max(1, limit)).get(),
                db.collection("profiles").limit(Math.max(1, limit)).get().catch(() => null),
            ]);
            const profilesByUid = new Map();
            for (const doc of profilesSnap?.docs ?? []) {
                profilesByUid.set(doc.id, (doc.data() ?? {}));
            }
            const rows = await Promise.all(usersSnap.docs.map(async (doc) => {
                const userData = (doc.data() ?? {});
                let claims = {};
                try {
                    const user = await auth().getUser(doc.id);
                    claims = (user.customClaims ?? {});
                }
                catch {
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
        async getMember(uid) {
            const db = firestore();
            const [userSnap, profileSnap] = await Promise.all([
                db.collection("users").doc(uid).get(),
                db.collection("profiles").doc(uid).get().catch(() => null),
            ]);
            if (!userSnap.exists && !profileSnap?.exists)
                return null;
            let claims = {};
            try {
                const user = await auth().getUser(uid);
                claims = (user.customClaims ?? {});
            }
            catch {
                claims = {};
            }
            return memberRecordFromSource({
                uid,
                userData: (userSnap.data() ?? {}),
                profileData: profileSnap?.exists ? (profileSnap.data() ?? {}) : undefined,
                claims,
            });
        },
        async createMember(input) {
            const db = firestore();
            const now = new Date();
            const opsRoles = (0, contracts_1.normalizeOpsHumanRoles)(input.opsRoles);
            const portalRole = input.portalRole ?? (opsRoles.length > 0 ? "staff" : "member");
            const protectedNotes = protectStaffNotes(input.staffNotes);
            const createdUser = await auth().createUser({
                email: cleanString(input.email),
                displayName: cleanString(input.displayName),
            });
            const claims = buildClaimsForOpsRoles({}, portalRole, opsRoles);
            await auth().setCustomUserClaims(createdUser.uid, claims);
            const memberPatch = {
                email: cleanString(input.email),
                displayName: cleanString(input.displayName),
                membershipTier: input.membershipTier ?? null,
                kilnPreferences: input.kilnPreferences ?? null,
                role: claims.role ?? portalRole,
                staffRole: claims.role ?? portalRole,
                opsRoles,
                opsCapabilities: (0, contracts_1.deriveOpsCapabilities)(opsRoles),
                customClaims: claims,
                claims,
                createdAt: now,
                updatedAt: now,
                createdByUid: input.actorId,
                source: "studio-brain-ops",
            };
            if (protectedNotes.encrypted) {
                memberPatch.staffNotesEncrypted = protectedNotes.encrypted;
            }
            else {
                memberPatch.staffNotes = protectedNotes.plaintext;
            }
            await Promise.all([
                db.collection("users").doc(createdUser.uid).set(memberPatch, { merge: true }),
                db.collection("profiles").doc(createdUser.uid).set({
                    email: cleanString(input.email),
                    displayName: cleanString(input.displayName),
                    updatedAt: now,
                    createdAt: now,
                    source: "studio-brain-ops",
                }, { merge: true }),
            ]);
            const created = {
                uid: createdUser.uid,
                email: cleanString(input.email),
                displayName: cleanString(input.displayName),
                membershipTier: input.membershipTier ?? null,
                portalRole,
                opsRoles,
                reason: cleanNullableString(input.reason),
                createdAt: now.toISOString(),
            };
            const audit = {
                id: (0, contracts_1.makeId)("ops_member_create"),
                uid: createdUser.uid,
                kind: "create",
                actorId: input.actorId,
                summary: `Created ${created.displayName} in the ops portal.`,
                reason: created.reason,
                createdAt: created.createdAt,
                payload: {
                    ...created,
                    staffNotes: input.staffNotes ?? null,
                    piiProtection: protectedNotes.protectedAtRest ? "encrypted_at_rest" : "plaintext_fallback",
                },
            };
            const safeAudit = (0, pii_1.redactMemberAuditPayload)(audit);
            await db.collection("staffMemberCreates").doc(audit.id).set({
                uid: createdUser.uid,
                payload: safeAudit.payload,
                createdByUid: input.actorId,
                reason: safeAudit.reason,
                at: now,
                source: "studio-brain-ops",
            });
            return {
                member: await this.getMember(createdUser.uid),
                audit: safeAudit,
                created,
            };
        },
        async updateMemberProfile(input) {
            const db = firestore();
            const now = new Date();
            const patch = {
                updatedAt: now,
                staffProfileUpdatedBy: input.actorId,
            };
            if ("displayName" in input.patch)
                patch.displayName = input.patch.displayName ?? null;
            if ("membershipTier" in input.patch)
                patch.membershipTier = input.patch.membershipTier ?? null;
            if ("kilnPreferences" in input.patch)
                patch.kilnPreferences = input.patch.kilnPreferences ?? null;
            if ("staffNotes" in input.patch) {
                const protectedNotes = protectStaffNotes(input.patch.staffNotes);
                patch.staffNotes = protectedNotes.plaintext ?? null;
                patch.staffNotesEncrypted = protectedNotes.encrypted ?? firestore_1.FieldValue.delete();
                if (protectedNotes.encrypted) {
                    patch.staffNotes = firestore_1.FieldValue.delete();
                }
            }
            await db.collection("users").doc(input.uid).set(patch, { merge: true });
            const audit = {
                id: (0, contracts_1.makeId)("ops_member_audit"),
                uid: input.uid,
                kind: "profile",
                actorId: input.actorId,
                summary: "Profile fields were updated from the ops portal.",
                reason: cleanNullableString(input.reason),
                createdAt: now.toISOString(),
                payload: input.patch,
            };
            const safeAudit = (0, pii_1.redactMemberAuditPayload)(audit);
            await db.collection("staffProfileEdits").doc(audit.id).set({
                uid: input.uid,
                editedByUid: input.actorId,
                reason: safeAudit.reason,
                patch: safeAudit.payload,
                at: now,
                source: "studio-brain-ops",
            });
            return {
                member: await this.getMember(input.uid),
                audit: safeAudit,
            };
        },
        async updateMemberBilling(input) {
            const db = firestore();
            const now = new Date();
            const billingStorage = buildBillingStorage(input.billing, now);
            const billingPatch = {
                billingProfile: billingStorage.publicProfile,
                billingProfileEncrypted: billingStorage.encryptedProfile ?? firestore_1.FieldValue.delete(),
                updatedAt: now,
                billingUpdatedByUid: input.actorId,
                stripeCustomerId: firestore_1.FieldValue.delete(),
                defaultPaymentMethodId: firestore_1.FieldValue.delete(),
            };
            await db.collection("users").doc(input.uid).set(billingPatch, { merge: true });
            const audit = {
                id: (0, contracts_1.makeId)("ops_member_billing"),
                uid: input.uid,
                kind: "billing",
                actorId: input.actorId,
                summary: "Billing-safe metadata was updated from the ops portal.",
                reason: cleanNullableString(input.reason),
                createdAt: now.toISOString(),
                payload: {
                    ...(billingStorage.fullProfile ?? {}),
                    paymentMethodSummary: billingStorage.fullProfile?.paymentMethodSummary ?? null,
                    storageMode: billingStorage.protectedAtRest ? "encrypted_at_rest" : "plaintext_fallback",
                },
            };
            const safeAudit = (0, pii_1.redactMemberAuditPayload)(audit);
            await db.collection("staffBillingEdits").doc(audit.id).set({
                uid: input.uid,
                editedByUid: input.actorId,
                reason: safeAudit.reason,
                billingProfile: safeAudit.payload,
                at: now,
                source: "studio-brain-ops",
            });
            return {
                member: await this.getMember(input.uid),
                audit: safeAudit,
            };
        },
        async updateMemberMembership(input) {
            const db = firestore();
            const now = new Date();
            await db.collection("users").doc(input.uid).set({
                membershipTier: input.membershipTier ?? null,
                updatedAt: now,
                membershipUpdatedByUid: input.actorId,
            }, { merge: true });
            const audit = {
                id: (0, contracts_1.makeId)("ops_membership_change"),
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
            const existingClaims = (currentUser.customClaims ?? {});
            const beforePortalRole = derivePortalRoleFromClaims(existingClaims);
            const beforeOpsRoles = deriveOpsRolesFromClaims(existingClaims);
            const nextClaims = buildClaimsForOpsRoles(existingClaims, input.portalRole, input.opsRoles);
            await auth().setCustomUserClaims(input.uid, nextClaims);
            const now = new Date();
            await firestore().collection("users").doc(input.uid).set({
                customClaims: nextClaims,
                claims: nextClaims,
                role: nextClaims.role ?? null,
                staffRole: nextClaims.role ?? null,
                opsRoles: input.opsRoles,
                opsCapabilities: (0, contracts_1.deriveOpsCapabilities)(input.opsRoles),
                roleUpdatedByUid: input.actorId,
                roleUpdatedAt: now,
                updatedAt: now,
            }, { merge: true });
            const audit = {
                id: (0, contracts_1.makeId)("ops_role_change"),
                uid: input.uid,
                editedByUid: input.actorId,
                beforePortalRole,
                afterPortalRole: input.portalRole,
                beforeOpsRoles,
                afterOpsRoles: (0, contracts_1.normalizeOpsHumanRoles)(input.opsRoles),
                reason: cleanNullableString(input.reason),
                createdAt: now.toISOString(),
                summary: `Role access changed to ${input.portalRole} with ${(0, contracts_1.normalizeOpsHumanRoles)(input.opsRoles).join(", ") || "no"} ops roles.`,
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
        async getMemberActivity(uid) {
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
        async listReservations(limit = 60) {
            const snapshot = await firestore().collection("reservations").limit(Math.max(1, limit)).get();
            const rows = snapshot.docs.map((doc) => reservationBundleFromDoc(doc.id, (doc.data() ?? {})));
            return rows.sort((a, b) => String(a.dueAt ?? "9999").localeCompare(String(b.dueAt ?? "9999")));
        },
        async getReservationBundle(id) {
            const snapshot = await firestore().collection("reservations").doc(id).get();
            if (!snapshot.exists)
                return null;
            return reservationBundleFromDoc(snapshot.id, (snapshot.data() ?? {}));
        },
        async listEvents(limit = 120) {
            const snapshot = await firestore().collection("events").limit(Math.max(1, limit)).get();
            return snapshot.docs
                .map((doc) => {
                const row = (doc.data() ?? {});
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
                };
            })
                .sort((a, b) => String(a.startAt ?? "9999").localeCompare(String(b.startAt ?? "9999")));
        },
        async listReports(limit = 120) {
            const snapshot = await firestore()
                .collection("communityReports")
                .orderBy("createdAt", "desc")
                .limit(Math.max(1, limit))
                .get();
            return snapshot.docs.map((doc) => {
                const row = (doc.data() ?? {});
                return {
                    id: doc.id,
                    status: cleanString(row.status) || "open",
                    severity: cleanString(row.severity) || "low",
                    summary: cleanString(row.summary) || cleanString(row.notes) || "Community report",
                    createdAt: toIso(row.createdAt),
                    ownerUid: cleanNullableString(row.ownerUid),
                };
            });
        },
        async getLendingSnapshot() {
            const db = firestore();
            const [requestsSnap, loansSnap, recommendationsSnap, tagsSnap, itemsSnap] = await Promise.all([
                db.collection("libraryRequests").limit(60).get(),
                db.collection("libraryLoans").limit(60).get(),
                db.collection("libraryRecommendations").limit(120).get(),
                db.collection("libraryTagSubmissions").limit(160).get(),
                db.collection("libraryItems").limit(400).get().catch(() => null),
            ]);
            const requests = requestsSnap.docs.map((doc) => {
                const row = (doc.data() ?? {});
                return {
                    id: doc.id,
                    status: cleanString(row.status) || "open",
                    requesterUid: cleanNullableString(row.requesterUid ?? row.uid ?? row.ownerUid),
                    requesterName: cleanNullableString(row.requesterName ?? row.displayName),
                    title: cleanString(row.title) || "Library request",
                    createdAt: toIso(row.createdAt),
                };
            });
            const loans = loansSnap.docs.map((doc) => {
                const row = (doc.data() ?? {});
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
                const row = (doc.data() ?? {});
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
