import test from "node:test";
import assert from "node:assert/strict";
import { buildAuditExportBundle, verifyAuditExportBundle } from "./auditExport";
import type { AuditEvent } from "../stores/interfaces";

const sampleRows: AuditEvent[] = [
  {
    id: "a1",
    at: "2026-02-13T00:00:00.000Z",
    actorType: "staff",
    actorId: "staff-1",
    action: "capability.firestore.batch.close.proposal_created",
    rationale: "rationale",
    target: "local",
    approvalState: "approved",
    inputHash: "in-1",
    outputHash: null,
    metadata: { proposalId: "p1" },
  },
];

test("audit export bundle verifies payload integrity", () => {
  const bundle = buildAuditExportBundle(sampleRows, { generatedAt: "2026-02-13T01:00:00.000Z" });
  const verification = verifyAuditExportBundle(bundle);
  assert.equal(verification.ok, true);
});

test("audit export bundle verifies signature integrity", () => {
  const bundle = buildAuditExportBundle(sampleRows, { generatedAt: "2026-02-13T01:00:00.000Z", signingKey: "secret" });
  const verification = verifyAuditExportBundle(bundle, "secret");
  assert.equal(verification.ok, true);
  const bad = verifyAuditExportBundle(bundle, "wrong");
  assert.equal(bad.ok, false);
});
