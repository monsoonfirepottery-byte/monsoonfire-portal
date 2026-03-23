import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyExecutionAuthority,
  hashIdentifier,
  POSTURE_MODES,
  redactSharedIdentifier,
} from "./studiobrain-posture-policy.mjs";

test("classifyExecutionAuthority marks fallback env as advisory evidence only", () => {
  const result = classifyExecutionAuthority({
    mode: POSTURE_MODES.LIVE_HOST_AUTHORITATIVE,
    envMode: "fallback",
    approvedRemoteRunner: false,
  });

  assert.equal(result.authoritative, false);
  assert.equal(result.status, "advisory_evidence_only");
});

test("classifyExecutionAuthority marks approved remote runner as authoritative", () => {
  const result = classifyExecutionAuthority({
    mode: POSTURE_MODES.LIVE_HOST_AUTHORITATIVE,
    envMode: "default",
    approvedRemoteRunner: true,
  });

  assert.equal(result.authoritative, true);
  assert.equal(result.status, "authoritative_live_host");
});

test("redactSharedIdentifier hashes shared actor identifiers only", () => {
  const actor = redactSharedIdentifier("actorId", "staff-user-123");
  const untouched = redactSharedIdentifier("summary", "staff-user-123");

  assert.match(actor, /^sha256:/);
  assert.notEqual(actor, "staff-user-123");
  assert.equal(untouched, "staff-user-123");
  assert.equal(hashIdentifier(""), "");
});
