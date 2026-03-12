import { describe, expect, it } from "vitest";

import { resolveShiftStatusSummary } from "./shiftStatus";

describe("resolveShiftStatusSummary", () => {
  it("returns action needed for high-priority operational alerts", () => {
    const summary = resolveShiftStatusSummary({
      overviewAlerts: [
        {
          id: "firings-attention",
          severity: "high",
          label: "2 firings need attention",
          actionLabel: "Review firings",
          module: "firings",
        },
      ],
      paymentAlerts: [],
      messagesDegraded: false,
      messageThreadsError: "",
      announcementsError: "",
      paymentDegraded: false,
      commerceError: "",
      hasFunctionsAuthMismatch: false,
      failedChecks: 0,
      recentErrors: 0,
    });

    expect(summary.label).toBe("Action needed");
    expect(summary.reasons[0]).toMatchObject({
      label: "2 firings need attention",
      actionLabel: "Review firings",
      actionTarget: "firings",
    });
  });

  it("returns watch for degraded messages", () => {
    const summary = resolveShiftStatusSummary({
      overviewAlerts: [],
      paymentAlerts: [],
      messagesDegraded: true,
      messageThreadsError: "timeout",
      announcementsError: "",
      paymentDegraded: false,
      commerceError: "",
      hasFunctionsAuthMismatch: false,
      failedChecks: 0,
      recentErrors: 0,
    });

    expect(summary.label).toBe("Watch");
    expect(summary.reasons[0]).toMatchObject({
      label: "Direct messages are temporarily degraded.",
      actionLabel: "Open messages",
      actionTarget: "messages",
    });
  });

  it("uses platform mismatch as an action-needed fallback reason", () => {
    const summary = resolveShiftStatusSummary({
      overviewAlerts: [],
      paymentAlerts: [],
      messagesDegraded: false,
      messageThreadsError: "",
      announcementsError: "",
      paymentDegraded: false,
      commerceError: "",
      hasFunctionsAuthMismatch: true,
      failedChecks: 2,
      recentErrors: 5,
    });

    expect(summary.label).toBe("Action needed");
    expect(summary.reasons[0]).toMatchObject({
      label: "Function-backed staff tools are paused by a local auth mismatch.",
      actionTarget: "system",
    });
  });

  it("caps reasons at three items in severity order", () => {
    const summary = resolveShiftStatusSummary({
      overviewAlerts: [
        {
          id: "reports-high-open",
          severity: "high",
          label: "1 high-severity report still open",
          actionLabel: "Open reports triage",
          module: "reports",
        },
        {
          id: "events-review",
          severity: "high",
          label: "2 events blocked for review",
          actionLabel: "Open events",
          module: "events",
        },
        {
          id: "orders-pending",
          severity: "medium",
          label: "3 store orders pending payment",
          actionLabel: "Open store & billing",
          module: "commerce",
        },
      ],
      paymentAlerts: [
        {
          id: "payments-p0",
          severity: "P0",
          title: "Payment canary is failing",
        },
      ],
      messagesDegraded: true,
      messageThreadsError: "",
      announcementsError: "stale",
      paymentDegraded: true,
      commerceError: "billing delayed",
      hasFunctionsAuthMismatch: false,
      failedChecks: 1,
      recentErrors: 1,
    });

    expect(summary.label).toBe("Action needed");
    expect(summary.reasons).toHaveLength(3);
    expect(summary.reasons.map((reason) => reason.label)).toEqual([
      "1 high-severity report still open",
      "2 events blocked for review",
      "Payment canary is failing",
    ]);
  });

  it("returns on-track when there are no active reasons", () => {
    const summary = resolveShiftStatusSummary({
      overviewAlerts: [
        {
          id: "all-clear",
          severity: "low",
          label: "No immediate operational alerts.",
          actionLabel: "Stay on cockpit",
          module: "cockpit",
        },
      ],
      paymentAlerts: [],
      messagesDegraded: false,
      messageThreadsError: "",
      announcementsError: "",
      paymentDegraded: false,
      commerceError: "",
      hasFunctionsAuthMismatch: false,
      failedChecks: 0,
      recentErrors: 0,
    });

    expect(summary).toMatchObject({
      label: "On track",
      reasons: [],
      headline: "No immediate blockers for today's shift.",
    });
  });
});
