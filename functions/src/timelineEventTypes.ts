// functions/src/timelineEventTypes.ts
// C8: Canonical timeline event taxonomy (single source of truth)

export enum TimelineEventType {
  CREATE_BATCH = "CREATE_BATCH",
  SUBMIT_DRAFT = "SUBMIT_DRAFT",
  SHELVED = "SHELVED",
  KILN_LOAD = "KILN_LOAD",
  KILN_UNLOAD = "KILN_UNLOAD",
  ASSIGNED_FIRING = "ASSIGNED_FIRING",
  READY_FOR_PICKUP = "READY_FOR_PICKUP",
  PICKED_UP_AND_CLOSE = "PICKED_UP_AND_CLOSE",
  CONTINUE_JOURNEY = "CONTINUE_JOURNEY",
}

export const TIMELINE_EVENT_LABELS: Record<TimelineEventType, string> = {
  [TimelineEventType.CREATE_BATCH]: "Batch created",
  [TimelineEventType.SUBMIT_DRAFT]: "Draft submitted",
  [TimelineEventType.SHELVED]: "Shelved",
  [TimelineEventType.KILN_LOAD]: "Loaded into kiln",
  [TimelineEventType.KILN_UNLOAD]: "Unloaded from kiln",
  [TimelineEventType.ASSIGNED_FIRING]: "Firing assigned",
  [TimelineEventType.READY_FOR_PICKUP]: "Ready for pickup",
  [TimelineEventType.PICKED_UP_AND_CLOSE]: "Picked up & closed",
  [TimelineEventType.CONTINUE_JOURNEY]: "Journey continued",
};

export function isTimelineEventType(v: unknown): v is TimelineEventType {
  return Object.values(TimelineEventType).includes(v as TimelineEventType);
}
