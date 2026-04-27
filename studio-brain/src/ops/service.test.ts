import test from "node:test";
import assert from "node:assert/strict";
import { createHumanTaskSeed, createOpsService } from "./service";
import type { MemberOpsRecord, OpsCapability, OpsHumanRole } from "./contracts";
import { MemoryOpsStore } from "./store";

test("ops service claims, proofs, and completes a task", async () => {
  const store = new MemoryOpsStore();
  const service = createOpsService({ store });
  const kilnLead = {
    actorId: "staff-1",
    isStaff: true,
    portalRole: "staff" as const,
    opsRoles: ["kiln_lead"] as OpsHumanRole[],
    opsCapabilities: ["surface:hands", "tasks:claim:any", "tasks:escape", "proof:submit", "proof:accept", "reservations:view", "reservations:prepare", "overrides:request"] as OpsCapability[],
  };
  const task = createHumanTaskSeed({
    title: "Unload kiln 1",
    surface: "hands",
    role: "kiln_lead",
    zone: "Kiln Room",
    whyNow: "Kiln 1 is ready for unload.",
    whyYou: "Kiln lead owns physical kiln handling.",
    evidenceSummary: "The kiln overlay says the run is ready for unload.",
    consequenceIfDelayed: "The next firing cannot stage cleanly.",
    instructions: ["Open kiln 1 safely.", "Unload ware.", "Record proof."],
    proofModes: ["qr_scan", "manual_confirm"],
    preferredProofMode: "qr_scan",
    priority: "p0",
  });

  await service.upsertTask(task);
  const claimed = await service.claimTask(task.id, kilnLead);
  assert.ok(claimed);
  assert.equal(claimed.claimedBy, "staff-1");

  const proof = await service.addTaskProof(task.id, kilnLead, "qr_scan", "Scanned kiln QR.", []);
  assert.ok(proof);

  const completed = await service.completeTask(task.id, kilnLead);
  assert.ok(completed);
  assert.equal(completed.status, "proof_pending");

  const accepted = await service.acceptTaskProof({
    taskId: task.id,
    proofId: proof!.id,
    actorId: kilnLead.actorId,
    status: "accepted",
  }, kilnLead);
  assert.ok(accepted);

  const verifiedTask = await store.getTask(task.id);
  assert.equal(verifiedTask?.status, "verified");
});

test("ops service dedupes ingest receipts by source system and event id", async () => {
  const store = new MemoryOpsStore();
  const service = createOpsService({ store });
  const first = await service.ingestWorldEvent({
    eventType: "sensor.observed",
    entityKind: "kiln",
    entityId: "kiln-1",
    sourceSystem: "kilnaid",
    sourceEventId: "evt-1",
    actorKind: "machine",
    actorId: "kilnaid-bridge",
    payload: { observedAt: "2026-04-17T00:00:00.000Z" },
    authPrincipal: "machine:kilnaid",
    timestampSkewSeconds: 1,
  });
  const second = await service.ingestWorldEvent({
    eventType: "sensor.observed",
    entityKind: "kiln",
    entityId: "kiln-1",
    sourceSystem: "kilnaid",
    sourceEventId: "evt-1",
    actorKind: "machine",
    actorId: "kilnaid-bridge",
    payload: { observedAt: "2026-04-17T00:00:00.000Z" },
    authPrincipal: "machine:kilnaid",
    timestampSkewSeconds: 1,
  });
  assert.equal(first.accepted, true);
  assert.equal(second.accepted, false);
});

test("ops service records member audits and blocks self role changes", async () => {
  const store = new MemoryOpsStore();
  let member: {
    uid: string;
    email: string | null;
    displayName: string;
    membershipTier: string | null;
    kilnPreferences: string | null;
    staffNotes: string | null;
    billing?: MemberOpsRecord["billing"];
    portalRole: "member" | "staff" | "admin";
    opsRoles: OpsHumanRole[];
    opsCapabilities: OpsCapability[];
    createdAt: string | null;
    updatedAt: string | null;
    lastSeenAt: string | null;
    metadata: Record<string, unknown>;
  } = {
    uid: "member-1",
    email: "member@example.com",
    displayName: "Studio Member",
    membershipTier: "drop-in",
    kilnPreferences: null,
    staffNotes: null,
    portalRole: "member" as const,
    opsRoles: [] as OpsHumanRole[],
    opsCapabilities: [] as OpsCapability[],
    createdAt: "2026-04-17T00:00:00.000Z",
    updatedAt: "2026-04-17T00:00:00.000Z",
    lastSeenAt: null,
    metadata: {},
  };
  const service = createOpsService({
    store,
    staffDataSource: {
      async listMembers() { return [member]; },
      async getMember(uid) { return uid === member.uid ? member : null; },
      async createMember(input) {
        member = {
          ...member,
          uid: "member-created",
          email: input.email,
          displayName: input.displayName,
          membershipTier: input.membershipTier ?? null,
          portalRole: input.portalRole ?? "member",
          opsRoles: input.opsRoles ?? [],
          updatedAt: "2026-04-17T00:30:00.000Z",
        };
        return {
          member,
          created: {
            uid: member.uid,
            email: input.email,
            displayName: input.displayName,
            membershipTier: input.membershipTier ?? null,
            portalRole: input.portalRole ?? "member",
            opsRoles: input.opsRoles ?? [],
            reason: input.reason ?? null,
            createdAt: "2026-04-17T00:30:00.000Z",
          },
          audit: {
            id: "audit-create-1",
            uid: "member-created",
            kind: "create",
            actorId: input.actorId,
            summary: "Member created.",
            reason: input.reason ?? null,
            createdAt: "2026-04-17T00:30:00.000Z",
            payload: { email: input.email },
          },
        };
      },
      async updateMemberProfile(input) {
        member = {
          ...member,
          displayName: input.patch.displayName ?? member.displayName,
          kilnPreferences: input.patch.kilnPreferences ?? member.kilnPreferences,
          staffNotes: input.patch.staffNotes ?? member.staffNotes,
          updatedAt: "2026-04-17T01:00:00.000Z",
        };
        return {
          member,
          audit: {
            id: "audit-profile-1",
            uid: member.uid,
            kind: "profile",
            actorId: input.actorId,
            summary: "Profile updated.",
            reason: input.reason ?? null,
            createdAt: "2026-04-17T01:00:00.000Z",
            payload: input.patch,
          },
        };
      },
      async updateMemberMembership(input) {
        const beforeTier = member.membershipTier;
        member = {
          ...member,
          membershipTier: input.membershipTier,
          updatedAt: "2026-04-17T01:10:00.000Z",
        };
        return {
          member,
          audit: {
            id: "audit-membership-1",
            uid: member.uid,
            editedByUid: input.actorId,
            beforeTier,
            afterTier: input.membershipTier,
            reason: input.reason ?? null,
            createdAt: "2026-04-17T01:10:00.000Z",
            summary: "Membership updated.",
          },
        };
      },
      async updateMemberRole(input) {
        const beforeRoles = member.opsRoles;
        member = {
          ...member,
          portalRole: input.portalRole,
          opsRoles: input.opsRoles,
          opsCapabilities: [],
          updatedAt: "2026-04-17T01:15:00.000Z",
        };
        return {
          member,
          audit: {
            id: "audit-role-1",
            uid: member.uid,
            editedByUid: input.actorId,
            beforePortalRole: "member",
            afterPortalRole: input.portalRole,
            beforeOpsRoles: beforeRoles,
            afterOpsRoles: input.opsRoles,
            reason: input.reason ?? null,
            createdAt: "2026-04-17T01:15:00.000Z",
            summary: "Role updated.",
          },
        };
      },
      async getMemberActivity(uid) {
        return {
          uid,
          reservations: 1,
          libraryLoans: 0,
          supportThreads: 0,
          events: 2,
          lastReservationAt: null,
          lastLoanAt: null,
          lastEventAt: null,
        };
      },
      async listReservations() { return []; },
      async getReservationBundle() { return null; },
      async updateMemberBilling(input) {
        member = {
          ...member,
          billing: {
            stripeCustomerId: input.billing.stripeCustomerId ?? null,
            defaultPaymentMethodId: input.billing.defaultPaymentMethodId ?? null,
            cardBrand: input.billing.cardBrand ?? null,
            cardLast4: input.billing.cardLast4 ?? null,
            expMonth: input.billing.expMonth ?? null,
            expYear: input.billing.expYear ?? null,
            paymentMethodSummary: "Visa · •••• 4242 · exp 08/2030",
            billingContactName: input.billing.billingContactName ?? null,
            billingContactEmail: input.billing.billingContactEmail ?? null,
            billingContactPhone: input.billing.billingContactPhone ?? null,
            storageMode: "stripe_tokenized_only",
            updatedAt: "2026-04-17T01:12:00.000Z",
          },
          updatedAt: "2026-04-17T01:12:00.000Z",
        };
        return {
          member,
          audit: {
            id: "audit-billing-1",
            uid: member.uid,
            kind: "billing",
            actorId: input.actorId,
            summary: "Billing updated.",
            reason: input.reason ?? null,
            createdAt: "2026-04-17T01:12:00.000Z",
            payload: input.billing,
          },
        };
      },
      async listEvents() { return []; },
      async listReports() { return []; },
      async getLendingSnapshot() {
        return {
          requests: [],
          loans: [],
          recommendationCount: 0,
          tagSubmissionCount: 0,
          coverReviewCount: 0,
          generatedAt: "2026-04-17T00:00:00.000Z",
        };
      },
    },
  });
  const actor = {
    actorId: "staff-1",
    isStaff: true,
    portalRole: "staff" as const,
    opsRoles: ["support_ops"] as OpsHumanRole[],
    opsCapabilities: ["surface:internet", "members:view", "members:edit_profile", "members:edit_membership", "members:edit_role"] as OpsCapability[],
  };

  const membershipResult = await service.updateMemberMembership({
    uid: member.uid,
    membershipTier: "community",
    reason: "Promoted from the ops portal.",
  }, actor);
  assert.equal(membershipResult?.member?.membershipTier, "community");

  const audits = await store.listMemberAudits(member.uid, 10);
  assert.equal(audits.length, 1);
  assert.equal(audits[0]?.kind, "membership");

  await assert.rejects(
    () => service.updateMemberRole({
      uid: actor.actorId,
      portalRole: "staff",
      opsRoles: ["support_ops"],
      reason: "This should fail.",
    }, actor),
    /change your own role/i,
  );
});

test("ops service creates members and stores only billing-safe metadata", async () => {
  const store = new MemoryOpsStore();
  let member: MemberOpsRecord = {
    uid: "member-created",
    email: "newmember@example.com",
    displayName: "New Member",
    membershipTier: "community",
    kilnPreferences: null,
    staffNotes: "Created from test.",
    billing: null,
    portalRole: "member" as const,
    opsRoles: [] as OpsHumanRole[],
    opsCapabilities: [] as OpsCapability[],
    createdAt: "2026-04-17T02:00:00.000Z",
    updatedAt: "2026-04-17T02:00:00.000Z",
    lastSeenAt: null,
    metadata: {},
  };
  const service = createOpsService({
    store,
    staffDataSource: {
      async listMembers() { return [member]; },
      async getMember(uid) { return uid === member.uid ? member : null; },
      async createMember(input) {
        member = {
          ...member,
          email: input.email,
          displayName: input.displayName,
          membershipTier: input.membershipTier ?? null,
          portalRole: input.portalRole ?? "member",
          opsRoles: input.opsRoles ?? [],
        };
        return {
          member,
          created: {
            uid: member.uid,
            email: input.email,
            displayName: input.displayName,
            membershipTier: input.membershipTier ?? null,
            portalRole: input.portalRole ?? "member",
            opsRoles: input.opsRoles ?? [],
            reason: input.reason ?? null,
            createdAt: "2026-04-17T02:00:00.000Z",
          },
          audit: {
            id: "audit-create-2",
            uid: member.uid,
            kind: "create",
            actorId: input.actorId,
            summary: "Member created.",
            reason: input.reason ?? null,
            createdAt: "2026-04-17T02:00:00.000Z",
            payload: { email: input.email },
          },
        };
      },
      async updateMemberProfile() { throw new Error("not used"); },
      async updateMemberBilling(input) {
        member = {
          ...member,
          billing: {
            stripeCustomerId: input.billing.stripeCustomerId ?? null,
            defaultPaymentMethodId: input.billing.defaultPaymentMethodId ?? null,
            cardBrand: input.billing.cardBrand ?? null,
            cardLast4: input.billing.cardLast4 ?? null,
            expMonth: input.billing.expMonth ?? null,
            expYear: input.billing.expYear ?? null,
            paymentMethodSummary: "Visa · •••• 4242 · exp 08/2030",
            billingContactName: input.billing.billingContactName ?? null,
            billingContactEmail: input.billing.billingContactEmail ?? null,
            billingContactPhone: input.billing.billingContactPhone ?? null,
            storageMode: "stripe_tokenized_only",
            updatedAt: "2026-04-17T02:05:00.000Z",
          },
        };
        return {
          member,
          audit: {
            id: "audit-billing-2",
            uid: member.uid,
            kind: "billing",
            actorId: input.actorId,
            summary: "Billing updated.",
            reason: input.reason ?? null,
            createdAt: "2026-04-17T02:05:00.000Z",
            payload: input.billing,
          },
        };
      },
      async updateMemberMembership() { throw new Error("not used"); },
      async updateMemberRole() { throw new Error("not used"); },
      async getMemberActivity(uid) {
        return {
          uid,
          reservations: 0,
          libraryLoans: 0,
          supportThreads: 0,
          events: 0,
          lastReservationAt: null,
          lastLoanAt: null,
          lastEventAt: null,
        };
      },
      async listReservations() { return []; },
      async getReservationBundle() { return null; },
      async listEvents() { return []; },
      async listReports() { return []; },
      async getLendingSnapshot() {
        return {
          requests: [],
          loans: [],
          recommendationCount: 0,
          tagSubmissionCount: 0,
          coverReviewCount: 0,
          generatedAt: "2026-04-17T02:00:00.000Z",
        };
      },
    },
  });
  const actor = {
    actorId: "staff-2",
    isStaff: true,
    portalRole: "staff" as const,
    opsRoles: ["member_ops"] as OpsHumanRole[],
    opsCapabilities: ["surface:internet", "members:view", "members:create", "members:edit_billing"] as OpsCapability[],
  };

  const created = await service.createMember({
    email: "newmember@example.com",
    displayName: "New Member",
    membershipTier: "community",
    reason: "Onboarded from member ops.",
  }, actor);
  assert.equal(created?.member?.displayName, "New Member");

  const billing = await service.updateMemberBilling({
    uid: "member-created",
    reason: "Attached Stripe references only.",
    billing: {
      stripeCustomerId: "cus_123",
      defaultPaymentMethodId: "pm_123",
      cardBrand: "Visa",
      cardLast4: "4242",
      expMonth: "08",
      expYear: "2030",
      billingContactEmail: "billing@example.com",
    },
  }, actor);
  assert.equal(billing?.member?.billing?.stripeCustomerId, "cus_123");
  assert.equal(billing?.member?.billing?.cardLast4, "4242");

  const audits = await store.listMemberAudits("member-created", 10);
  assert.equal(audits.length, 2);
  assert.equal(audits[0]?.kind, "billing");
  assert.equal(audits[1]?.kind, "create");
  assert.equal(audits[0]?.payload.stripeCustomerId, "cu***");
  assert.equal(audits[0]?.payload.billingContactEmail, "b***g@example.com");
  assert.equal(audits[1]?.payload.emailMasked, "n***r@example.com");
  assert.match(audits[1]?.reason ?? "", /^stored securely \(\d+ chars\)$/);
});

test("ops service suppresses stale reservation bundles from the live handoff view", async () => {
  const store = new MemoryOpsStore();
  await store.upsertReservationBundle({
    id: "reservation:stale-1",
    reservationId: "stale-1",
    title: "Fixture Member · bisque firing",
    status: "REQUESTED",
    ownerUid: "member-1",
    displayName: "Fixture Member",
    firingType: "bisque firing",
    dueAt: "2026-04-16T08:00:00.000Z",
    itemCount: 4,
    shelfEquivalent: 1,
    notes: "Old QA fixture",
    arrival: {
      status: "expected",
      dueAt: "2026-04-16T08:00:00.000Z",
      arrivedAt: null,
      summary: "Fixture Member is expected.",
      confidence: 0.7,
      verificationClass: "planned",
    },
    prep: {
      summary: "Fixture prep",
      actions: ["Prepare shelf"],
      toolsNeeded: ["clipboard"],
      assignedRole: "floor_staff",
    },
    linkedTaskIds: [],
    verificationClass: "planned",
    freshestAt: "2026-04-16T07:45:00.000Z",
    sources: [],
    confidence: 0.7,
    degradeReason: null,
    metadata: {},
  });

  const service = createOpsService({
    store,
    now: () => "2026-04-18T20:45:00.000Z",
    stateStore: {
      async saveStudioState() {},
      async getLatestStudioState() {
        return {
          schemaVersion: "v3.0",
          snapshotDate: "2026-04-18",
          generatedAt: "2026-04-18T20:40:00.000Z",
          cloudSync: {
            firestoreReadAt: "2026-04-18T20:40:00.000Z",
            stripeReadAt: null,
          },
          counts: {
            batchesActive: 0,
            batchesClosed: 0,
            reservationsOpen: 0,
            firingsScheduled: 0,
            reportsOpen: 0,
          },
          ops: {
            agentRequestsPending: 0,
            highSeverityReports: 0,
          },
          finance: {
            pendingOrders: 0,
            unsettledPayments: 0,
          },
          sourceHashes: {
            firestore: "fixture",
            stripe: null,
          },
          diagnostics: {
            completeness: "partial",
            warnings: [],
          },
        };
      },
      async getPreviousStudioState() { return null; },
      async saveStudioStateDiff() {},
      async saveOverseerRun() {},
      async getLatestOverseerRun() { return null; },
      async listRecentOverseerRuns() { return []; },
      async listRecentJobRuns() { return []; },
      async startJobRun(jobName) {
        return {
          id: `${jobName}-1`,
          jobName,
          status: "running" as const,
          startedAt: "2026-04-18T20:40:00.000Z",
          completedAt: null,
          summary: null,
          errorMessage: null,
        };
      },
      async completeJobRun() {},
      async failJobRun() {},
    },
    staffDataSource: {
      async listMembers() { return []; },
      async getMember() { return null; },
      async createMember() { throw new Error("not used"); },
      async updateMemberProfile() { throw new Error("not used"); },
      async updateMemberMembership() { throw new Error("not used"); },
      async updateMemberBilling() { throw new Error("not used"); },
      async updateMemberRole() { throw new Error("not used"); },
      async getMemberActivity(uid) {
        return {
          uid,
          reservations: 0,
          libraryLoans: 0,
          supportThreads: 0,
          events: 0,
          lastReservationAt: null,
          lastLoanAt: null,
          lastEventAt: null,
        };
      },
      async listReservations() { return []; },
      async getReservationBundle() { return null; },
      async listEvents() { return []; },
      async listReports() { return []; },
      async getLendingSnapshot() {
        return {
          requests: [],
          loans: [],
          recommendationCount: 0,
          tagSubmissionCount: 0,
          coverReviewCount: 0,
          generatedAt: "2026-04-18T20:40:00.000Z",
        };
      },
    },
  });

  const snapshot = await service.getPortalSnapshot();
  assert.equal(snapshot.reservations.length, 0);
  assert.equal(snapshot.twin.currentRisk, null);
  assert.match(snapshot.twin.headline, /quiet/i);
  assert.ok(
    snapshot.truth.sources.some((row) =>
      row.source === "reservations" && /suppressed|active right now/i.test(String(row.reason || ""))
    ),
  );
});
