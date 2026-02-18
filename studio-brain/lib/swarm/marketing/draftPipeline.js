"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildMarketingDrafts = buildMarketingDrafts;
exports.hasRecentMarketingDraft = hasRecentMarketingDraft;
exports.canTransitionDraftStatus = canTransitionDraftStatus;
function buildMarketingDrafts(snapshot) {
    const refs = [
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
function hasRecentMarketingDraft(recentEvents, snapshotDate, cooldownMinutes = 360, now = new Date()) {
    const cutoff = now.getTime() - cooldownMinutes * 60_000;
    for (const row of recentEvents) {
        if (row.action !== "studio_marketing.draft_created")
            continue;
        const atMs = Date.parse(row.at);
        if (!Number.isFinite(atMs) || atMs < cutoff)
            continue;
        if (row.metadata && row.metadata.sourceSnapshotDate === snapshotDate)
            return true;
    }
    return false;
}
function canTransitionDraftStatus(from, to) {
    if (from === to)
        return true;
    if (from === "draft" && to === "needs_review")
        return true;
    if (from === "needs_review" && to === "approved_for_publish")
        return true;
    if (from === "needs_review" && to === "draft")
        return true;
    if (from === "approved_for_publish" && to === "needs_review")
        return true;
    return false;
}
