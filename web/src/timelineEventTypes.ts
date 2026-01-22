// web/src/timelineEventTypes.ts
// Re-export canonical timeline event taxonomy from portalContracts.

export {
  TIMELINE_EVENT_TYPES,
  TIMELINE_EVENT_LABELS,
  isTimelineEventType,
  normalizeTimelineEventType,
} from "./api/portalContracts";
export type { TimelineEventType } from "./api/portalContracts";
