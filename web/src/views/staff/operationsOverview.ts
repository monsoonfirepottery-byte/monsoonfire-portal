export type OperationsAreaKey = "checkins" | "members" | "pieces" | "firings" | "events" | "lending";

export type OperationsAreaTone = "action" | "watch" | "clear" | "reference";

export type OperationsSummaryTone = Exclude<OperationsAreaTone, "reference">;

export type OperationsMetric = {
  label: string;
  value: string;
};

export type OperationsPriorityItem = {
  id: string;
  tone: "action" | "watch";
  title: string;
  detail: string;
  actionLabel: string;
  actionTarget: OperationsAreaKey;
};

export type OperationsAreaCard = {
  key: OperationsAreaKey;
  title: string;
  owner: string;
  tone: OperationsAreaTone;
  label: string;
  headline: string;
  note: string;
  actionLabel: string;
  actionTarget: OperationsAreaKey;
  metrics: OperationsMetric[];
};

export type OperationsOverviewModel = {
  tone: OperationsSummaryTone;
  label: string;
  headline: string;
  priorityItems: OperationsPriorityItem[];
  areaCards: OperationsAreaCard[];
};

export type ResolveOperationsOverviewInput = {
  todayReservationsCount: number;
  nextReservationTimeLabel: string;
  reservationsWithNotesCount: number;
  memberTotalCount: number;
  memberStaffCount: number;
  memberAdminCount: number;
  memberInferredCount: number;
  memberFallbackSources: string[];
  openBatchesCount: number;
  likelyArtifactsCount: number;
  highConfidenceArtifactsCount: number;
  manualReviewHintsCount: number;
  firingActiveCount: number;
  firingAttentionCount: number;
  firingScheduledCount: number;
  eventUpcomingCount: number;
  eventReviewRequiredCount: number;
  eventWaitlistedCount: number;
  eventHighPressureCount: number;
  lendingOpenRequestsCount: number;
  lendingActiveLoansCount: number;
  lendingOverdueCount: number;
  lendingPendingReviewCount: number;
  lendingTagQueueCount: number;
  lendingCoverReviewCount: number;
};

const AREA_OWNER_LABEL: Record<OperationsAreaKey, string> = {
  checkins: "Queue Ops",
  members: "Member Ops",
  pieces: "Production Ops",
  firings: "Kiln Ops",
  events: "Program Ops",
  lending: "Library Ops",
};

const TONE_LABEL: Record<OperationsAreaTone, string> = {
  action: "Action needed",
  watch: "Watch",
  clear: "On track",
  reference: "Reference",
};

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatSources(sources: string[]): string {
  return sources.length > 0 ? sources.join(", ") : "fallback collections";
}

function buildCheckinsCard(input: ResolveOperationsOverviewInput): OperationsAreaCard {
  const hasReservations = input.todayReservationsCount > 0;
  const headline = hasReservations
    ? `${pluralize(input.todayReservationsCount, "reservation")} due today${input.nextReservationTimeLabel ? `. Next arrival ${input.nextReservationTimeLabel}.` : "."}`
    : "No reservations are due today.";
  const note =
    input.reservationsWithNotesCount > 0
      ? `${pluralize(input.reservationsWithNotesCount, "reservation")} include staff notes or prep context.`
      : "Open Check-ins for the full calendar and intake queue.";

  return {
    key: "checkins",
    title: "Check-ins",
    owner: AREA_OWNER_LABEL.checkins,
    tone: hasReservations ? "watch" : "clear",
    label: TONE_LABEL[hasReservations ? "watch" : "clear"],
    headline,
    note,
    actionLabel: hasReservations ? "Open check-ins" : "View calendar",
    actionTarget: "checkins",
    metrics: [
      { label: "Due today", value: String(input.todayReservationsCount) },
      { label: "Next arrival", value: input.nextReservationTimeLabel || "-" },
      { label: "With notes", value: String(input.reservationsWithNotesCount) },
    ],
  };
}

function buildMembersCard(input: ResolveOperationsOverviewInput): OperationsAreaCard {
  const hasSourceAnomaly = input.memberInferredCount > 0;

  return {
    key: "members",
    title: "Members",
    owner: AREA_OWNER_LABEL.members,
    tone: hasSourceAnomaly ? "watch" : "reference",
    label: TONE_LABEL[hasSourceAnomaly ? "watch" : "reference"],
    headline: hasSourceAnomaly
      ? `${pluralize(input.memberInferredCount, "member record")} inferred from fallback sources.`
      : "Member roster is loaded for quick lookup and follow-up.",
    note: hasSourceAnomaly
      ? `Fallback sources in play: ${formatSources(input.memberFallbackSources)}.`
      : "Use Members for profile edits, permissions, and member activity trails.",
    actionLabel: "Open members",
    actionTarget: "members",
    metrics: [
      { label: "Total", value: String(input.memberTotalCount) },
      { label: "Staff", value: String(input.memberStaffCount) },
      { label: "Admins", value: String(input.memberAdminCount) },
    ],
  };
}

function buildPiecesCard(input: ResolveOperationsOverviewInput): OperationsAreaCard {
  const tone =
    input.highConfidenceArtifactsCount > 0
      ? "action"
      : input.manualReviewHintsCount > 0 || input.likelyArtifactsCount > 0
        ? "watch"
        : "clear";

  let headline = "No artifact triage blockers in the current batch sample.";
  if (input.highConfidenceArtifactsCount > 0) {
    headline = `${pluralize(input.highConfidenceArtifactsCount, "high-confidence artifact batch", "high-confidence artifact batches")} need cleanup review.`;
  } else if (input.manualReviewHintsCount > 0) {
    headline = `${pluralize(input.manualReviewHintsCount, "batch")} still need manual artifact review.`;
  } else if (input.likelyArtifactsCount > 0) {
    headline = `${pluralize(input.likelyArtifactsCount, "likely artifact")} are already below the high-confidence threshold.`;
  }

  return {
    key: "pieces",
    title: "Pieces & batches",
    owner: AREA_OWNER_LABEL.pieces,
    tone,
    label: TONE_LABEL[tone],
    headline,
    note:
      tone === "clear"
        ? "Open Pieces & batches for lifecycle changes, inventory, and timelines."
        : "Artifact cleanup tools stay in the focused Pieces workspace so the overview stays readable.",
    actionLabel: input.highConfidenceArtifactsCount > 0 ? "Open artifact triage" : "Open pieces & batches",
    actionTarget: "pieces",
    metrics: [
      { label: "Open batches", value: String(input.openBatchesCount) },
      { label: "High-confidence", value: String(input.highConfidenceArtifactsCount) },
      { label: "Manual review", value: String(input.manualReviewHintsCount) },
    ],
  };
}

function buildFiringsCard(input: ResolveOperationsOverviewInput): OperationsAreaCard {
  const tone =
    input.firingAttentionCount > 0
      ? "action"
      : input.firingActiveCount > 0 || input.firingScheduledCount > 0
        ? "watch"
        : "clear";

  let headline = "No active or scheduled firing blockers right now.";
  if (input.firingAttentionCount > 0) {
    headline = `${pluralize(input.firingAttentionCount, "firing")} need attention before normal shift work continues.`;
  } else if (input.firingActiveCount > 0) {
    headline = `${pluralize(input.firingActiveCount, "firing")} are currently in motion.`;
  } else if (input.firingScheduledCount > 0) {
    headline = `${pluralize(input.firingScheduledCount, "firing")} are scheduled next.`;
  }

  return {
    key: "firings",
    title: "Firings",
    owner: AREA_OWNER_LABEL.firings,
    tone,
    label: TONE_LABEL[tone],
    headline,
    note:
      tone === "clear"
        ? "Open Firings for schedule changes, logs, and handoff detail."
        : "Use Firings to inspect stale runs, missing windows, and low-confidence state changes.",
    actionLabel: "Open firings",
    actionTarget: "firings",
    metrics: [
      { label: "Active now", value: String(input.firingActiveCount) },
      { label: "Needs attention", value: String(input.firingAttentionCount) },
      { label: "Scheduled", value: String(input.firingScheduledCount) },
    ],
  };
}

function buildEventsCard(input: ResolveOperationsOverviewInput): OperationsAreaCard {
  const tone =
    input.eventReviewRequiredCount > 0
      ? "action"
      : input.eventWaitlistedCount > 0 || input.eventHighPressureCount > 0
        ? "watch"
        : "clear";

  let headline = "No event scheduling blockers in the current lineup.";
  if (input.eventReviewRequiredCount > 0) {
    headline = `${pluralize(input.eventReviewRequiredCount, "event")} are blocked for review.`;
  } else if (input.eventWaitlistedCount > 0) {
    headline = `${pluralize(input.eventWaitlistedCount, "waitlisted seat")} signal demand pressure across upcoming events.`;
  } else if (input.eventUpcomingCount > 0) {
    headline = `${pluralize(input.eventUpcomingCount, "upcoming event")} are already on the calendar.`;
  }

  return {
    key: "events",
    title: "Events",
    owner: AREA_OWNER_LABEL.events,
    tone,
    label: TONE_LABEL[tone],
    headline,
    note:
      tone === "clear"
        ? "Open Events for publishing, roster check-ins, and programming edits."
        : input.eventHighPressureCount > 0
          ? `${pluralize(input.eventHighPressureCount, "high-pressure cluster")} are pushing on capacity or programming coverage.`
          : "Waitlist pressure is building even without a high-pressure programming cluster yet.",
    actionLabel: "Open events",
    actionTarget: "events",
    metrics: [
      { label: "Upcoming", value: String(input.eventUpcomingCount) },
      { label: "Needs review", value: String(input.eventReviewRequiredCount) },
      { label: "Waitlisted", value: String(input.eventWaitlistedCount) },
    ],
  };
}

function buildLendingCard(input: ResolveOperationsOverviewInput): OperationsAreaCard {
  const reviewQueueCount =
    input.lendingPendingReviewCount + input.lendingTagQueueCount + input.lendingCoverReviewCount;
  const tone =
    input.lendingOverdueCount > 0
      ? "action"
      : input.lendingOpenRequestsCount > 0 || reviewQueueCount > 0
        ? "watch"
        : "clear";

  let headline = "No overdue loans or library review blockers right now.";
  if (input.lendingOverdueCount > 0) {
    headline = `${pluralize(input.lendingOverdueCount, "loan")} are overdue and need follow-up.`;
  } else if (reviewQueueCount > 0) {
    headline = `${pluralize(reviewQueueCount, "review item")} are waiting across recommendations, tags, or covers.`;
  } else if (input.lendingOpenRequestsCount > 0) {
    headline = `${pluralize(input.lendingOpenRequestsCount, "request")} are open in the lending queue.`;
  }

  return {
    key: "lending",
    title: "Lending",
    owner: AREA_OWNER_LABEL.lending,
    tone,
    label: TONE_LABEL[tone],
    headline,
    note:
      tone === "clear"
        ? "Open Lending for borrower detail, inventory, and moderation tools."
        : input.lendingActiveLoansCount > 0
          ? `${pluralize(input.lendingActiveLoansCount, "active loan")} are currently out with members.`
          : "Open Lending for request review, moderation queues, and borrower follow-up.",
    actionLabel: "Open lending",
    actionTarget: "lending",
    metrics: [
      { label: "Open requests", value: String(input.lendingOpenRequestsCount) },
      { label: "Overdue", value: String(input.lendingOverdueCount) },
      { label: "Review queues", value: String(reviewQueueCount) },
    ],
  };
}

export function resolveOperationsOverview(input: ResolveOperationsOverviewInput): OperationsOverviewModel {
  const priorityItems: OperationsPriorityItem[] = [];

  if (input.firingAttentionCount > 0) {
    priorityItems.push({
      id: "firings-attention",
      tone: "action",
      title: `${pluralize(input.firingAttentionCount, "firing")} need attention`,
      detail: "Open Firings to inspect stale runs, missing windows, or low-confidence states.",
      actionLabel: "Open firings",
      actionTarget: "firings",
    });
  }
  if (input.lendingOverdueCount > 0) {
    priorityItems.push({
      id: "lending-overdue",
      tone: "action",
      title: `${pluralize(input.lendingOverdueCount, "loan")} are overdue`,
      detail: "Prioritize borrower follow-up and recovery steps from the Lending workspace.",
      actionLabel: "Open lending",
      actionTarget: "lending",
    });
  }
  if (input.eventReviewRequiredCount > 0) {
    priorityItems.push({
      id: "events-review",
      tone: "action",
      title: `${pluralize(input.eventReviewRequiredCount, "event")} blocked for review`,
      detail: "Publish or resolve review gates before the event schedule slips.",
      actionLabel: "Open events",
      actionTarget: "events",
    });
  }
  if (input.highConfidenceArtifactsCount > 0) {
    priorityItems.push({
      id: "pieces-artifacts",
      tone: "action",
      title: `${pluralize(input.highConfidenceArtifactsCount, "high-confidence artifact batch", "high-confidence artifact batches")} need triage`,
      detail: "Confirm cleanup handoff from the focused Pieces & batches workspace.",
      actionLabel: "Open pieces & batches",
      actionTarget: "pieces",
    });
  }
  if (input.todayReservationsCount > 0) {
    priorityItems.push({
      id: "checkins-today",
      tone: "watch",
      title: `${pluralize(input.todayReservationsCount, "reservation")} due today`,
      detail: input.nextReservationTimeLabel
        ? `Next arrival is ${input.nextReservationTimeLabel}.`
        : "Open Check-ins for the live intake queue.",
      actionLabel: "Open check-ins",
      actionTarget: "checkins",
    });
  }
  if (input.eventWaitlistedCount > 0) {
    priorityItems.push({
      id: "events-waitlist",
      tone: "watch",
      title: `${pluralize(input.eventWaitlistedCount, "waitlisted seat")} are building up`,
      detail: "Demand pressure may need a second session, more seats, or scheduling changes.",
      actionLabel: "Open events",
      actionTarget: "events",
    });
  }
  const lendingQueueCount =
    input.lendingOpenRequestsCount +
    input.lendingPendingReviewCount +
    input.lendingTagQueueCount +
    input.lendingCoverReviewCount;
  if (lendingQueueCount > 0) {
    priorityItems.push({
      id: "lending-queue",
      tone: "watch",
      title: `${pluralize(lendingQueueCount, "library queue item")} are waiting`,
      detail: "Requests and moderation queues are ready for staff review in Lending.",
      actionLabel: "Open lending",
      actionTarget: "lending",
    });
  }
  if (input.memberInferredCount > 0) {
    priorityItems.push({
      id: "members-sources",
      tone: "watch",
      title: `${pluralize(input.memberInferredCount, "member record")} need source confirmation`,
      detail: `Fallback sources in play: ${formatSources(input.memberFallbackSources)}.`,
      actionLabel: "Open members",
      actionTarget: "members",
    });
  }

  const trimmedPriorityItems = priorityItems.slice(0, 5);
  const tone: OperationsSummaryTone =
    trimmedPriorityItems.some((item) => item.tone === "action")
      ? "action"
      : trimmedPriorityItems.length > 0
        ? "watch"
        : "clear";

  return {
    tone,
    label: TONE_LABEL[tone],
    headline:
      tone === "action"
        ? "Resolve the first blocker, then work down the queue."
        : tone === "watch"
          ? "Operations can continue, but a few areas need attention."
          : "No urgent operational blockers right now.",
    priorityItems: trimmedPriorityItems,
    areaCards: [
      buildCheckinsCard(input),
      buildMembersCard(input),
      buildPiecesCard(input),
      buildFiringsCard(input),
      buildEventsCard(input),
      buildLendingCard(input),
    ],
  };
}
