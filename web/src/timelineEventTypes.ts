// web/src/timelineEventTypes.ts
// C8 (UI): Canonical timeline event taxonomy (mirrors backend)

export enum TimelineEventType {
  CREATE_BATCH = "CREATE_BATCH",
  SUBMIT_DRAFT = "SUBMIT_DRAFT",
  PICKED_UP_AND_CLOSE = "PICKED_UP_AND_CLOSE",
  CONTINUE_JOURNEY = "CONTINUE_JOURNEY",
  KILN_LOAD = "KILN_LOAD",
  KILN_UNLOAD = "KILN_UNLOAD",
  READY_FOR_PICKUP = "READY_FOR_PICKUP",
}

export const TIMELINE_EVENT_LABELS: Record<TimelineEventType, string> = {
  [TimelineEventType.CREATE_BATCH]: "Batch created",
  [TimelineEventType.SUBMIT_DRAFT]: "Draft submitted",
  [TimelineEventType.PICKED_UP_AND_CLOSE]: "Picked up & closed",
  [TimelineEventType.CONTINUE_JOURNEY]: "Journey continued",
  [TimelineEventType.KILN_LOAD]: "Loaded into kiln",
  [TimelineEventType.KILN_UNLOAD]: "Unloaded from kiln",
  [TimelineEventType.READY_FOR_PICKUP]: "Ready for pickup",
};

export function isTimelineEventType(v: unknown): v is TimelineEventType {
  return Object.values(TimelineEventType).includes(v as TimelineEventType);
}
