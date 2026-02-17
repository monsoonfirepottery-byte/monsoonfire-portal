import type { AuditEvent, StudioStateSnapshot } from "../../stores/interfaces";

export type FinanceReconciliationDraft = {
  id: string;
  ruleId: "pending_orders_unsettled_mismatch" | "stripe_read_stale" | "unsettled_spike";
  severity: "low" | "medium" | "high";
  title: string;
  rationale: string;
  recommendation: string;
  snapshotDate: string;
  evidenceRefs: string[];
  confidence: number;
};

export type FinanceReconciliationSummary = {
  emitted: FinanceReconciliationDraft[];
  suppressedCount: number;
  ruleHits: Record<string, number>;
};

export type FinanceReconciliationOptions = {
  now: Date;
  recentEvents: AuditEvent[];
  cooldownMinutes?: number;
};

function recentlyEmitted(ruleId: string, nowMs: number, events: AuditEvent[], cooldownMinutes: number): boolean {
  const cutoff = nowMs - cooldownMinutes * 60_000;
  for (const row of events) {
    if (row.action !== "studio_finance.reconciliation_draft_created") continue;
    const atMs = Date.parse(row.at);
    if (!Number.isFinite(atMs) || atMs < cutoff) continue;
    const eventRuleId = typeof row.metadata.ruleId === "string" ? row.metadata.ruleId : "";
    if (eventRuleId === ruleId) return true;
  }
  return false;
}

function createDraft(
  snapshot: StudioStateSnapshot,
  ruleId: FinanceReconciliationDraft["ruleId"],
  severity: FinanceReconciliationDraft["severity"],
  title: string,
  rationale: string,
  recommendation: string,
  evidenceRefs: string[],
  confidence: number
): FinanceReconciliationDraft {
  return {
    id: `${ruleId}:${snapshot.snapshotDate}`,
    ruleId,
    severity,
    title,
    rationale,
    recommendation,
    snapshotDate: snapshot.snapshotDate,
    evidenceRefs,
    confidence,
  };
}

export function detectFinanceReconciliation(
  snapshot: StudioStateSnapshot,
  previous: StudioStateSnapshot | null,
  options: FinanceReconciliationOptions
): FinanceReconciliationSummary {
  const nowMs = options.now.getTime();
  const cooldownMinutes = Math.max(1, options.cooldownMinutes ?? 360);
  const emitted: FinanceReconciliationDraft[] = [];
  const ruleHits: Record<string, number> = {
    pending_orders_unsettled_mismatch: 0,
    stripe_read_stale: 0,
    unsettled_spike: 0,
  };
  let suppressedCount = 0;

  const pendingOrders = snapshot.finance.pendingOrders;
  const unsettled = snapshot.finance.unsettledPayments;
  if (pendingOrders > 0 || unsettled > 0) {
    const delta = Math.abs(pendingOrders - unsettled);
    if (delta >= 1) {
      ruleHits.pending_orders_unsettled_mismatch += 1;
      if (!recentlyEmitted("pending_orders_unsettled_mismatch", nowMs, options.recentEvents, cooldownMinutes)) {
        emitted.push(
          createDraft(
            snapshot,
            "pending_orders_unsettled_mismatch",
            delta >= 5 ? "high" : "medium",
            "Pending orders and unsettled payments mismatch",
            `Pending orders (${pendingOrders}) differ from unsettled payments (${unsettled}) by ${delta}.`,
            "Audit recent Stripe checkout sessions and ensure portal orders are reconciled.",
            [
              `finance.pendingOrders=${pendingOrders}`,
              `finance.unsettledPayments=${unsettled}`,
            ],
            delta >= 5 ? 0.78 : 0.64
          )
        );
      } else {
        suppressedCount += 1;
      }
    }
  }

  const stripeReadAt = snapshot.cloudSync.stripeReadAt;
  if (!stripeReadAt || nowMs - Date.parse(stripeReadAt) > 24 * 60 * 60 * 1000) {
    ruleHits.stripe_read_stale += 1;
    if (!recentlyEmitted("stripe_read_stale", nowMs, options.recentEvents, cooldownMinutes)) {
      emitted.push(
        createDraft(
          snapshot,
          "stripe_read_stale",
          "high",
          "Stripe read is stale or missing",
          stripeReadAt ? `Stripe read is older than 24h (${stripeReadAt}).` : "Stripe read timestamp is missing.",
          "Verify Stripe reconciliation pipeline and confirm last successful read.",
          [
            `stripeReadAt=${stripeReadAt ?? "null"}`,
            `snapshotDate=${snapshot.snapshotDate}`,
          ],
          0.82
        )
      );
    } else {
      suppressedCount += 1;
    }
  }

  const previousUnsettled = previous?.finance.unsettledPayments ?? unsettled;
  const unsettledDelta = unsettled - previousUnsettled;
  if (unsettledDelta >= 5) {
    ruleHits.unsettled_spike += 1;
    if (!recentlyEmitted("unsettled_spike", nowMs, options.recentEvents, cooldownMinutes)) {
      emitted.push(
        createDraft(
          snapshot,
          "unsettled_spike",
          "medium",
          "Unsettled payments spike",
          `Unsettled payments increased by ${unsettledDelta} since last snapshot.`,
          "Review recent Stripe payouts/refunds for delays or disputes.",
          [
            `finance.unsettledPayments=${unsettled}`,
            `previous.unsettledPayments=${previousUnsettled}`,
          ],
          0.7
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
