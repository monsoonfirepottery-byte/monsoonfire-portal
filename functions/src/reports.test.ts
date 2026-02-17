import test from "node:test";
import assert from "node:assert/strict";

import {
  isDuplicateReportWithinWindow,
  normalizeReportSeverity,
  shouldRaiseCoordinationSignal,
} from "./reports";

test("normalizeReportSeverity forces safety reports to high", () => {
  assert.equal(normalizeReportSeverity("safety", "low"), "high");
  assert.equal(normalizeReportSeverity("safety"), "high");
});

test("normalizeReportSeverity defaults non-safety to low", () => {
  assert.equal(normalizeReportSeverity("spam"), "low");
  assert.equal(normalizeReportSeverity("copyright", "medium"), "medium");
});

test("isDuplicateReportWithinWindow identifies duplicate within dedupe window", () => {
  const nowMs = Date.now();
  assert.equal(
    isDuplicateReportWithinWindow({
      existingCreatedAtMs: nowMs - 2 * 60 * 60 * 1000,
      nowMs,
    }),
    true
  );
  assert.equal(
    isDuplicateReportWithinWindow({
      existingCreatedAtMs: nowMs - 30 * 60 * 60 * 1000,
      nowMs,
    }),
    false
  );
});

test("shouldRaiseCoordinationSignal only triggers with enough reporters and reports in active window", () => {
  const nowMs = Date.now();
  const activeWindowStart = nowMs - 30 * 60 * 1000;
  const staleWindowStart = nowMs - 2 * 60 * 60 * 1000;

  assert.equal(
    shouldRaiseCoordinationSignal({
      windowStartMs: activeWindowStart,
      nowMs,
      reportCount: 6,
      uniqueReporterCount: 4,
    }),
    true
  );
  assert.equal(
    shouldRaiseCoordinationSignal({
      windowStartMs: activeWindowStart,
      nowMs,
      reportCount: 5,
      uniqueReporterCount: 4,
    }),
    false
  );
  assert.equal(
    shouldRaiseCoordinationSignal({
      windowStartMs: staleWindowStart,
      nowMs,
      reportCount: 12,
      uniqueReporterCount: 9,
    }),
    false
  );
});
