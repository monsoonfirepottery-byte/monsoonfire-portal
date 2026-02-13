import type { StudioStateSnapshot } from "../stores/interfaces";

export type DriftThresholds = {
  absolute: number;
  ratio: number;
};

export type DriftEntry = {
  metric: string;
  expected: number;
  observed: number;
  delta: number;
  deltaRatio: number;
};

function toCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function detectSnapshotDrift(
  previous: StudioStateSnapshot | null,
  current: StudioStateSnapshot,
  thresholds: DriftThresholds
): DriftEntry[] {
  if (!previous) return [];

  const keys = [
    "counts.batchesActive",
    "counts.batchesClosed",
    "counts.reservationsOpen",
    "counts.firingsScheduled",
    "counts.reportsOpen",
    "ops.blockedTickets",
    "ops.agentRequestsPending",
    "ops.highSeverityReports",
    "finance.pendingOrders",
    "finance.unsettledPayments",
  ] as const;

  const getByPath = (snapshot: StudioStateSnapshot, path: string): number => {
    const [head, tail] = path.split(".");
    if (head === "counts") return toCount((snapshot.counts as Record<string, unknown>)[tail]);
    if (head === "ops") return toCount((snapshot.ops as Record<string, unknown>)[tail]);
    if (head === "finance") return toCount((snapshot.finance as Record<string, unknown>)[tail]);
    return 0;
  };

  const drift: DriftEntry[] = [];
  for (const key of keys) {
    const expected = getByPath(previous, key);
    const observed = getByPath(current, key);
    const delta = observed - expected;
    const deltaRatio = expected === 0 ? (observed === 0 ? 0 : 1) : Math.abs(delta) / Math.abs(expected);
    const overAbsolute = Math.abs(delta) >= thresholds.absolute;
    const overRatio = deltaRatio >= thresholds.ratio;
    if (overAbsolute || overRatio) {
      drift.push({
        metric: key,
        expected,
        observed,
        delta,
        deltaRatio,
      });
    }
  }

  return drift;
}
