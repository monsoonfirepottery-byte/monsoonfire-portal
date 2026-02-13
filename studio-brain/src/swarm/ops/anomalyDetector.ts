import type { AuditEvent, StudioStateSnapshot } from "../../stores/interfaces";

export type RecommendationSeverity = "low" | "medium" | "high";

export type OpsRecommendationDraft = {
  id: string;
  ruleId: "stalled_batches" | "queue_spike" | "overdue_reservations";
  severity: RecommendationSeverity;
  title: string;
  rationale: string;
  recommendation: string;
  snapshotDate: string;
};

export type DetectorSummary = {
  emitted: OpsRecommendationDraft[];
  suppressedCount: number;
  ruleHits: Record<string, number>;
};

export type DetectorOptions = {
  now: Date;
  recentEvents: AuditEvent[];
  cooldownMinutes?: number;
};

function recentlyEmitted(ruleId: string, nowMs: number, events: AuditEvent[], cooldownMinutes: number): boolean {
  const cutoff = nowMs - cooldownMinutes * 60_000;
  for (const row of events) {
    if (row.action !== "studio_ops.recommendation_draft_created") continue;
    const atMs = Date.parse(row.at);
    if (!Number.isFinite(atMs) || atMs < cutoff) continue;
    const eventRuleId = typeof row.metadata.ruleId === "string" ? row.metadata.ruleId : "";
    if (eventRuleId === ruleId) return true;
  }
  return false;
}

function createDraft(snapshot: StudioStateSnapshot, ruleId: OpsRecommendationDraft["ruleId"], severity: RecommendationSeverity, title: string, rationale: string, recommendation: string): OpsRecommendationDraft {
  return {
    id: `${ruleId}:${snapshot.snapshotDate}`,
    ruleId,
    severity,
    title,
    rationale,
    recommendation,
    snapshotDate: snapshot.snapshotDate,
  };
}

export function detectOpsRecommendations(
  snapshot: StudioStateSnapshot,
  previous: StudioStateSnapshot | null,
  options: DetectorOptions
): DetectorSummary {
  const nowMs = options.now.getTime();
  const cooldownMinutes = Math.max(1, options.cooldownMinutes ?? 120);
  const emitted: OpsRecommendationDraft[] = [];
  const ruleHits: Record<string, number> = {
    stalled_batches: 0,
    queue_spike: 0,
    overdue_reservations: 0,
  };
  let suppressedCount = 0;

  if (snapshot.counts.batchesActive >= 25 && snapshot.counts.firingsScheduled <= 2) {
    ruleHits.stalled_batches += 1;
    if (!recentlyEmitted("stalled_batches", nowMs, options.recentEvents, cooldownMinutes)) {
      emitted.push(
        createDraft(
          snapshot,
          "stalled_batches",
          "high",
          "Potential stalled batch backlog",
          `Active batches (${snapshot.counts.batchesActive}) are high while firings scheduled (${snapshot.counts.firingsScheduled}) are low.`,
          "Review kiln schedule and staff queue for blocked closeout work."
        )
      );
    } else {
      suppressedCount += 1;
    }
  }

  const previousPending = previous?.ops.agentRequestsPending ?? snapshot.ops.agentRequestsPending;
  const pendingDelta = snapshot.ops.agentRequestsPending - previousPending;
  if (snapshot.ops.agentRequestsPending >= 20 || pendingDelta >= 8) {
    ruleHits.queue_spike += 1;
    if (!recentlyEmitted("queue_spike", nowMs, options.recentEvents, cooldownMinutes)) {
      emitted.push(
        createDraft(
          snapshot,
          "queue_spike",
          "medium",
          "Agent request queue spike",
          `Agent requests pending is ${snapshot.ops.agentRequestsPending} (delta ${pendingDelta >= 0 ? `+${pendingDelta}` : pendingDelta}).`,
          "Triage agent request queue and confirm staffing coverage for request handling."
        )
      );
    } else {
      suppressedCount += 1;
    }
  }

  const previousReservations = previous?.counts.reservationsOpen ?? snapshot.counts.reservationsOpen;
  const reservationDelta = snapshot.counts.reservationsOpen - previousReservations;
  if (snapshot.counts.reservationsOpen >= 30 && reservationDelta > 0) {
    ruleHits.overdue_reservations += 1;
    if (!recentlyEmitted("overdue_reservations", nowMs, options.recentEvents, cooldownMinutes)) {
      emitted.push(
        createDraft(
          snapshot,
          "overdue_reservations",
          "medium",
          "Reservations accumulating without closure",
          `Open reservations is ${snapshot.counts.reservationsOpen} with upward trend (delta +${reservationDelta}).`,
          "Audit reservation lifecycle blockers and clear oldest open reservations first."
        )
      );
    } else {
      suppressedCount += 1;
    }
  }

  return {
    emitted,
    suppressedCount,
    ruleHits,
  };
}
