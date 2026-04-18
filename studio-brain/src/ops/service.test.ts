import test from "node:test";
import assert from "node:assert/strict";
import { createHumanTaskSeed, createOpsService } from "./service";
import type { OpsCapability, OpsHumanRole } from "./contracts";
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
