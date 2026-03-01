import { describe, expect, it } from "vitest";
import {
  formatMinutesAgo,
  isStudioBrainDegradedMode,
  resolveStudioBrainFetchFailure,
  resolveUnavailableStudioBrainStatus,
} from "./studioBrainHealth";

describe("studioBrainHealth", () => {
  describe("isStudioBrainDegradedMode", () => {
    it("flags degraded and offline modes", () => {
      expect(isStudioBrainDegradedMode("degraded")).toBe(true);
      expect(isStudioBrainDegradedMode("offline")).toBe(true);
    });

    it("does not flag healthy, disabled, or unknown modes", () => {
      expect(isStudioBrainDegradedMode("healthy")).toBe(false);
      expect(isStudioBrainDegradedMode("disabled")).toBe(false);
      expect(isStudioBrainDegradedMode("unknown")).toBe(false);
      expect(isStudioBrainDegradedMode(null)).toBe(false);
      expect(isStudioBrainDegradedMode(undefined)).toBe(false);
    });
  });

  describe("resolveUnavailableStudioBrainStatus", () => {
    it("marks disabled integrations as disabled, not offline", () => {
      const result = resolveUnavailableStudioBrainStatus({
        enabled: false,
        reason: "Studio Brain base URL is not configured.",
        lastKnownGoodAt: null,
        nowMs: Date.parse("2026-02-28T00:00:00.000Z"),
      });
      expect(result.mode).toBe("disabled");
      expect(result.reasonCode).toBe("INTEGRATION_DISABLED");
    });

    it("marks missing base URL with enabled integration as unknown", () => {
      const result = resolveUnavailableStudioBrainStatus({
        enabled: true,
        reason: "Studio Brain base URL is not configured.",
        lastKnownGoodAt: null,
        nowMs: Date.parse("2026-02-28T00:00:00.000Z"),
      });
      expect(result.mode).toBe("unknown");
      expect(result.reasonCode).toBe("STUDIO_BRAIN_BASE_URL_UNAVAILABLE");
    });
  });

  describe("resolveStudioBrainFetchFailure", () => {
    it("holds as unknown when last-known-good is recent", () => {
      const nowMs = Date.parse("2026-02-28T00:30:00.000Z");
      const result = resolveStudioBrainFetchFailure({
        details: "network timeout",
        lastKnownGoodAt: "2026-02-28T00:24:00.000Z",
        signalStaleMinutes: 12,
        offlineConfirmMinutes: 45,
        nowMs,
      });
      expect(result.mode).toBe("unknown");
      expect(result.reasonCode).toBe("SIGNAL_DELAY_UNCONFIRMED_OFFLINE");
    });

    it("escalates to offline when signal age passes confirmation threshold", () => {
      const nowMs = Date.parse("2026-02-28T01:30:00.000Z");
      const result = resolveStudioBrainFetchFailure({
        details: "network timeout",
        lastKnownGoodAt: "2026-02-28T00:00:00.000Z",
        signalStaleMinutes: 12,
        offlineConfirmMinutes: 45,
        nowMs,
      });
      expect(result.mode).toBe("offline");
      expect(result.reasonCode).toBe("OFFLINE_CONFIRMED_BY_SIGNAL_GAP");
    });

    it("uses baseline-unavailable reason when no known-good signal exists", () => {
      const result = resolveStudioBrainFetchFailure({
        details: "network timeout",
        lastKnownGoodAt: null,
        signalStaleMinutes: 12,
        offlineConfirmMinutes: 45,
        nowMs: Date.parse("2026-02-28T00:30:00.000Z"),
      });
      expect(result.mode).toBe("unknown");
      expect(result.reasonCode).toBe("SIGNAL_UNAVAILABLE_NO_BASELINE");
    });
  });

  describe("formatMinutesAgo", () => {
    it("formats minute/hour/day buckets", () => {
      expect(formatMinutesAgo(0)).toBe("just now");
      expect(formatMinutesAgo(42)).toBe("42m");
      expect(formatMinutesAgo(125)).toBe("2h 5m");
      expect(formatMinutesAgo(1560)).toBe("1d 2h");
    });
  });
});
