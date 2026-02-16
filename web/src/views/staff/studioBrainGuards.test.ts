import { describe, expect, it } from "vitest";
import {
  buildPilotExecutePayload,
  buildPilotRollbackPayload,
  buildProposalIdempotencyKey,
  canApproveProposalAction,
  canExecuteProposalAction,
  canRollbackProposalAction,
} from "./studioBrainGuards";

describe("studioBrainGuards", () => {
  it("gates approve action by busy state, token state, and rationale", () => {
    expect(
      canApproveProposalAction({
        busy: false,
        disabledByToken: false,
        approvalRationale: "Approved after review.",
      })
    ).toBe(true);
    expect(
      canApproveProposalAction({
        busy: true,
        disabledByToken: false,
        approvalRationale: "Approved after review.",
      })
    ).toBe(false);
    expect(
      canApproveProposalAction({
        busy: false,
        disabledByToken: true,
        approvalRationale: "Approved after review.",
      })
    ).toBe(false);
    expect(
      canApproveProposalAction({
        busy: false,
        disabledByToken: false,
        approvalRationale: "   ",
      })
    ).toBe(false);
  });

  it("gates execute action by busy and token state", () => {
    expect(canExecuteProposalAction({ busy: false, disabledByToken: false })).toBe(true);
    expect(canExecuteProposalAction({ busy: true, disabledByToken: false })).toBe(false);
    expect(canExecuteProposalAction({ busy: false, disabledByToken: true })).toBe(false);
  });

  it("gates rollback action by status, rationale length, and idempotency key", () => {
    expect(
      canRollbackProposalAction({
        busy: false,
        disabledByToken: false,
        proposalStatus: "executed",
        rollbackReason: "Rollback requested after duplicate note.",
        idempotencyKey: "pilot-1234",
      })
    ).toBe(true);
    expect(
      canRollbackProposalAction({
        busy: false,
        disabledByToken: false,
        proposalStatus: "approved",
        rollbackReason: "Rollback requested after duplicate note.",
        idempotencyKey: "pilot-1234",
      })
    ).toBe(false);
    expect(
      canRollbackProposalAction({
        busy: false,
        disabledByToken: false,
        proposalStatus: "executed",
        rollbackReason: "short",
        idempotencyKey: "pilot-1234",
      })
    ).toBe(false);
    expect(
      canRollbackProposalAction({
        busy: false,
        disabledByToken: false,
        proposalStatus: "executed",
        rollbackReason: "Rollback requested after duplicate note.",
        idempotencyKey: "short",
      })
    ).toBe(false);
  });

  it("builds idempotency key from manual key or generated fallback", () => {
    expect(
      buildProposalIdempotencyKey({
        manualKey: "manual-key-01",
        proposalId: "proposal-abc-123",
        nowMs: 12345,
      })
    ).toBe("manual-key-01");
    expect(
      buildProposalIdempotencyKey({
        manualKey: "   ",
        proposalId: "proposal-abc-123",
        nowMs: 12345,
      })
    ).toBe("pilot-proposal-12345");
  });

  it("builds execute and rollback payloads with trimmed values", () => {
    expect(
      buildPilotExecutePayload({
        userUid: "staff-uid",
        tenantContext: "  ",
        idempotencyKey: " pilot-key-01 ",
      })
    ).toEqual({
      actorType: "staff",
      actorId: "staff-uid",
      ownerUid: "staff-uid",
      tenantId: "staff-uid",
      idempotencyKey: "pilot-key-01",
      output: { executedFrom: "staff-console" },
    });

    expect(
      buildPilotRollbackPayload({
        idempotencyKey: " pilot-key-01 ",
        reason: " Rollback requested after duplicate note. ",
      })
    ).toEqual({
      idempotencyKey: "pilot-key-01",
      reason: "Rollback requested after duplicate note.",
    });
  });
});
