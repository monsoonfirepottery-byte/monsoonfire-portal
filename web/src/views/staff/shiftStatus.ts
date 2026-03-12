export type ShiftStatusTone = "action" | "watch" | "clear";

export type ShiftStatusReason = {
  id: string;
  tone: Exclude<ShiftStatusTone, "clear">;
  label: string;
  actionLabel: string;
  actionTarget: string;
};

export type ShiftStatusSummary = {
  tone: ShiftStatusTone;
  label: "Action needed" | "Watch" | "On track";
  headline: string;
  reasons: ShiftStatusReason[];
};

type OverviewAlert = {
  id: string;
  severity: "high" | "medium" | "low";
  label: string;
  actionLabel: string;
  module: string;
};

type PaymentAlert = {
  id: string;
  severity: "P0" | "P1";
  title: string;
};

type Params = {
  overviewAlerts: ReadonlyArray<OverviewAlert>;
  paymentAlerts: ReadonlyArray<PaymentAlert>;
  messagesDegraded: boolean;
  messageThreadsError: string;
  announcementsError: string;
  paymentDegraded: boolean;
  commerceError: string;
  hasFunctionsAuthMismatch: boolean;
  failedChecks: number;
  recentErrors: number;
};

function pushReason(reasons: ShiftStatusReason[], next: ShiftStatusReason) {
  if (reasons.some((reason) => reason.id === next.id)) return;
  reasons.push(next);
}

function describeMessagesDegraded(messageThreadsError: string, announcementsError: string): string {
  if (messageThreadsError && announcementsError) {
    return "Messages and announcements are temporarily degraded.";
  }
  if (messageThreadsError) {
    return "Direct messages are temporarily degraded.";
  }
  if (announcementsError) {
    return "Announcements are temporarily degraded.";
  }
  return "Messages are temporarily degraded.";
}

export function resolveShiftStatusSummary({
  overviewAlerts,
  paymentAlerts,
  messagesDegraded,
  messageThreadsError,
  announcementsError,
  paymentDegraded,
  commerceError,
  hasFunctionsAuthMismatch,
  failedChecks,
  recentErrors,
}: Params): ShiftStatusSummary {
  const reasons: ShiftStatusReason[] = [];

  if (hasFunctionsAuthMismatch) {
    pushReason(reasons, {
      id: "platform-auth-mismatch",
      tone: "action",
      label: "Function-backed staff tools are paused by a local auth mismatch.",
      actionLabel: "Open platform diagnostics",
      actionTarget: "system",
    });
  }

  for (const alert of overviewAlerts) {
    if (alert.severity !== "high") continue;
    pushReason(reasons, {
      id: `overview-${alert.id}`,
      tone: "action",
      label: alert.label,
      actionLabel: alert.actionLabel,
      actionTarget: alert.module,
    });
  }

  const highestPaymentAlert =
    paymentAlerts.find((alert) => alert.severity === "P0") ??
    paymentAlerts.find((alert) => alert.severity === "P1") ??
    null;

  if (highestPaymentAlert) {
    pushReason(reasons, {
      id: `payment-${highestPaymentAlert.id}`,
      tone: highestPaymentAlert.severity === "P0" ? "action" : "watch",
      label: highestPaymentAlert.title,
      actionLabel: "Open commerce",
      actionTarget: "finance",
    });
  }

  if (messagesDegraded) {
    pushReason(reasons, {
      id: "messages-degraded",
      tone: "watch",
      label: describeMessagesDegraded(messageThreadsError, announcementsError),
      actionLabel: "Open messages",
      actionTarget: "messages",
    });
  }

  if (!hasFunctionsAuthMismatch && paymentDegraded && !highestPaymentAlert) {
    pushReason(reasons, {
      id: "commerce-degraded",
      tone: "watch",
      label: commerceError ? "Commerce tools are temporarily degraded." : "Billing tools need attention.",
      actionLabel: "Open commerce",
      actionTarget: "finance",
    });
  }

  if (!hasFunctionsAuthMismatch && failedChecks > 0) {
    pushReason(reasons, {
      id: "platform-checks",
      tone: "watch",
      label: `${failedChecks} platform check${failedChecks === 1 ? "" : "s"} failed recently.`,
      actionLabel: "Open platform diagnostics",
      actionTarget: "system",
    });
  }

  if (!hasFunctionsAuthMismatch && recentErrors > 0) {
    pushReason(reasons, {
      id: "platform-errors",
      tone: "watch",
      label: `${recentErrors} recent handler error${recentErrors === 1 ? "" : "s"} logged.`,
      actionLabel: "Open platform diagnostics",
      actionTarget: "system",
    });
  }

  for (const alert of overviewAlerts) {
    if (alert.severity !== "medium") continue;
    pushReason(reasons, {
      id: `overview-${alert.id}`,
      tone: "watch",
      label: alert.label,
      actionLabel: alert.actionLabel,
      actionTarget: alert.module,
    });
  }

  const visibleReasons = reasons.slice(0, 3);
  const tone: ShiftStatusTone = visibleReasons.some((reason) => reason.tone === "action")
    ? "action"
    : visibleReasons.length > 0
      ? "watch"
      : "clear";

  if (tone === "action") {
    return {
      tone,
      label: "Action needed",
      headline: "Resolve the top blocker before continuing routine shift work.",
      reasons: visibleReasons,
    };
  }

  if (tone === "watch") {
    return {
      tone,
      label: "Watch",
      headline: "Operations can continue, but one or more areas need attention.",
      reasons: visibleReasons,
    };
  }

  return {
    tone,
    label: "On track",
    headline: "No immediate blockers for today's shift.",
    reasons: [],
  };
}
