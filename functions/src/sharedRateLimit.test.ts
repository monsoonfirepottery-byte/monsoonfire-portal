import test from "node:test";
import assert from "node:assert/strict";

import { evaluateRateLimitWindow } from "./shared";

test("evaluateRateLimitWindow starts a new window when state is missing", () => {
  const nowMs = 1_700_000_000_000;
  const out = evaluateRateLimitWindow({
    state: null,
    nowMs,
    max: 5,
    windowMs: 60_000,
  });
  assert.equal(out.ok, true);
  assert.equal(out.retryAfterMs, 0);
  assert.equal(out.nextState.count, 1);
  assert.equal(out.nextState.resetAt, nowMs + 60_000);
});

test("evaluateRateLimitWindow increments within window under cap", () => {
  const nowMs = 1_700_000_010_000;
  const out = evaluateRateLimitWindow({
    state: { count: 2, resetAt: nowMs + 30_000 },
    nowMs,
    max: 5,
    windowMs: 60_000,
  });
  assert.equal(out.ok, true);
  assert.equal(out.nextState.count, 3);
  assert.equal(out.nextState.resetAt, nowMs + 30_000);
});

test("evaluateRateLimitWindow denies when request exceeds cap", () => {
  const nowMs = 1_700_000_020_000;
  const out = evaluateRateLimitWindow({
    state: { count: 5, resetAt: nowMs + 45_000 },
    nowMs,
    max: 5,
    windowMs: 60_000,
  });
  assert.equal(out.ok, false);
  assert.equal(out.nextState.count, 6);
  assert.equal(out.retryAfterMs, 45_000);
});

test("evaluateRateLimitWindow resets when window expired", () => {
  const nowMs = 1_700_000_030_000;
  const out = evaluateRateLimitWindow({
    state: { count: 99, resetAt: nowMs - 1 },
    nowMs,
    max: 5,
    windowMs: 120_000,
  });
  assert.equal(out.ok, true);
  assert.equal(out.nextState.count, 1);
  assert.equal(out.nextState.resetAt, nowMs + 120_000);
});
