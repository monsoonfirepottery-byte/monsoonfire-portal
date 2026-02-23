import { safeString, type Timestamp } from "./shared";
import { TimelineEventType } from "./timelineEventTypes";

type ContinueJourneySourceBatch = {
  title: string;
  ownerDisplayName: string | null;
  intakeMode: string;
  journeyRootBatchId: string | null;
};

type ContinueJourneyContractInput = {
  uid: string;
  fromBatchId: string;
  requestedTitle: string;
  sourceBatch: ContinueJourneySourceBatch;
  at: Timestamp;
};

type ContinueJourneyTimelineEvent = {
  type: TimelineEventType;
  at: Timestamp;
  actorUid: string;
  actorName: string | null;
  notes: string;
  extra: { fromBatchId: string };
};

type ContinueJourneyContractOutput = {
  rootId: string;
  newBatchDocument: Record<string, unknown>;
  timelineEvent: ContinueJourneyTimelineEvent;
  integrationEventData: Record<string, unknown>;
  integrationEventSubject: Record<string, unknown>;
};

export function buildContinueJourneyContract(
  input: ContinueJourneyContractInput
): ContinueJourneyContractOutput {
  const sourceTitle = safeString(input.sourceBatch.title) || "Untitled batch";
  const requestedTitle = safeString(input.requestedTitle);
  const nextTitle = requestedTitle || `${sourceTitle} (resubmission)`;
  const rootId =
    safeString(input.sourceBatch.journeyRootBatchId) || safeString(input.fromBatchId);
  const integrationTitle = requestedTitle || sourceTitle;

  return {
    rootId,
    newBatchDocument: {
      ownerUid: safeString(input.uid),
      ownerDisplayName: input.sourceBatch.ownerDisplayName,
      title: nextTitle,
      intakeMode: safeString(input.sourceBatch.intakeMode) || "SELF_SERVICE",
      estimatedCostCents: 0,
      estimateNotes: null,
      state: "DRAFT",
      isClosed: false,
      createdAt: input.at,
      updatedAt: input.at,
      closedAt: null,
      journeyRootBatchId: rootId,
      journeyParentBatchId: safeString(input.fromBatchId),
    },
    timelineEvent: {
      type: TimelineEventType.CONTINUE_JOURNEY,
      at: input.at,
      actorUid: safeString(input.uid),
      actorName: input.sourceBatch.ownerDisplayName,
      notes: `Continued journey from ${safeString(input.fromBatchId)}`,
      extra: { fromBatchId: safeString(input.fromBatchId) },
    },
    integrationEventData: {
      state: "DRAFT",
      isClosed: false,
      title: integrationTitle,
      journeyRootBatchId: rootId,
    },
    integrationEventSubject: {
      fromBatchId: safeString(input.fromBatchId),
    },
  };
}
