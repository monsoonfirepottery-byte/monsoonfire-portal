import test from "node:test";
import assert from "node:assert/strict";

import {
  STARTUP_REASON_CODES,
  buildStartupContract,
  classifyStartupReason,
  evaluateStartupLatency,
  inspectTokenFreshness,
} from "./codex-startup-reliability.mjs";

function makeJwt(expSecondsFromNow) {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expSecondsFromNow })).toString(
    "base64url"
  );
  return `${header}.${payload}.`;
}

test("inspectTokenFreshness classifies missing and expired tokens", () => {
  assert.equal(inspectTokenFreshness("").state, "missing");
  assert.equal(inspectTokenFreshness(makeJwt(-30)).state, "expired");
  assert.equal(inspectTokenFreshness(makeJwt(600)).state, "fresh");
});

test("classifyStartupReason normalizes common failure families", () => {
  assert.equal(
    classifyStartupReason({ attempted: false, reason: "missing-auth-token", tokenFreshness: { state: "missing" } }),
    STARTUP_REASON_CODES.MISSING_TOKEN
  );
  assert.equal(
    classifyStartupReason({ attempted: true, reason: "context-request-failed", error: "AbortError: signal timed out" }),
    STARTUP_REASON_CODES.TIMEOUT
  );
  assert.equal(
    classifyStartupReason({ attempted: true, reason: "context-request-failed", status: 0, error: "fetch failed: ECONNREFUSED" }),
    STARTUP_REASON_CODES.TRANSPORT_UNREACHABLE
  );
  assert.equal(
    classifyStartupReason({ attempted: true, reason: "empty-context", itemCount: 0 }),
    STARTUP_REASON_CODES.EMPTY_CONTEXT
  );
});

test("evaluateStartupLatency reports budget pressure", () => {
  assert.equal(evaluateStartupLatency(100).state, "healthy");
  assert.equal(evaluateStartupLatency(2000).state, "at_risk");
  assert.equal(evaluateStartupLatency(5000).state, "over_budget");
});

test("buildStartupContract treats trusted local validated startup as pass even when transcript ordering is unproven", () => {
  const contract = buildStartupContract({
    reasonCode: STARTUP_REASON_CODES.OK,
    continuityState: "ready",
    diagnostics: {
      presentationProjectLane: "monsoonfire-portal",
      threadScopedItemCount: 4,
      groundingAuthority: "validated-local",
      startupContextStage: "local-validated-short-circuit",
      startupCache: {
        shortCircuitLocal: true,
      },
    },
    telemetry: {
      transcriptOrderingProven: false,
      groundingLineEmitted: true,
      repoReadsBeforeStartupContext: 0,
    },
    tokenFreshness: {
      state: "fresh",
    },
    studioBrainReachable: true,
    mcpBridgeOk: true,
  });

  assert.equal(contract.status, "pass");
  assert.equal(contract.transcriptOrderingProven, false);
  assert.equal(contract.orderingSatisfied, true);
  assert.equal(contract.trustedLocalFastPath, true);
  assert.deepEqual(contract.degradationBuckets, []);
});
