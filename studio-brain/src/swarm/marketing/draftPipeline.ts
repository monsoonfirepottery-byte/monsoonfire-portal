import type { AuditEvent, StudioStateSnapshot } from "../../stores/interfaces";

export type MarketingDraftStatus = "draft" | "needs_review" | "approved_for_publish";

export type MarketingDraft = {
  draftId: string;
  status: MarketingDraftStatus;
  channel: "instagram" | "email";
  title: string;
  copy: string;
  sourceSnapshotDate: string;
  sourceRefs: string[];
  confidenceNotes: string;
  templateVersion: string;
};

export function buildMarketingDrafts(snapshot: StudioStateSnapshot): MarketingDraft[] {
  const refs = [
    `ops.blockedTickets=${snapshot.ops.blockedTickets}`,
    `ops.agentRequestsPending=${snapshot.ops.agentRequestsPending}`,
    `counts.batchesActive=${snapshot.counts.batchesActive}`,
    `counts.firingsScheduled=${snapshot.counts.firingsScheduled}`,
  ];

  return [
    {
      draftId: `mk-${snapshot.snapshotDate}-ig`,
      status: "draft",
      channel: "instagram",
      title: "Studio Pulse Update",
      copy: `Today in the studio: ${snapshot.counts.batchesActive} active batches, ${snapshot.counts.firingsScheduled} firings scheduled, and ${snapshot.ops.agentRequestsPending} incoming requests in queue.`,
      sourceSnapshotDate: snapshot.snapshotDate,
      sourceRefs: refs,
      confidenceNotes: "Derived from v3 StudioState snapshot metrics; human tone polish required.",
      templateVersion: "marketing-v1",
    },
    {
      draftId: `mk-${snapshot.snapshotDate}-email`,
      status: "draft",
      channel: "email",
      title: "Weekly Studio Operations Digest",
      copy: `We are tracking ${snapshot.counts.reservationsOpen} open reservations and ${snapshot.counts.reportsOpen} open reports. Team focus this week: reduce blockers and keep firing cadence predictable.`,
      sourceSnapshotDate: snapshot.snapshotDate,
      sourceRefs: refs,
      confidenceNotes: "Counts-only summary; requires staff validation before review escalation.",
      templateVersion: "marketing-v1",
    },
  ];
}

export function hasRecentMarketingDraft(
  recentEvents: AuditEvent[],
  snapshotDate: string,
  cooldownMinutes = 360,
  now: Date = new Date()
): boolean {
  const cutoff = now.getTime() - cooldownMinutes * 60_000;
  for (const row of recentEvents) {
    if (row.action !== "studio_marketing.draft_created") continue;
    const atMs = Date.parse(row.at);
    if (!Number.isFinite(atMs) || atMs < cutoff) continue;
    if (row.metadata && row.metadata.sourceSnapshotDate === snapshotDate) return true;
  }
  return false;
}

export function canTransitionDraftStatus(from: MarketingDraftStatus, to: MarketingDraftStatus): boolean {
  if (from === to) return true;
  if (from === "draft" && to === "needs_review") return true;
  if (from === "needs_review" && to === "approved_for_publish") return true;
  if (from === "needs_review" && to === "draft") return true;
  if (from === "approved_for_publish" && to === "needs_review") return true;
  return false;
}
