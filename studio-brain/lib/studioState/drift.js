"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectSnapshotDrift = detectSnapshotDrift;
function toCount(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function detectSnapshotDrift(previous, current, thresholds) {
    if (!previous)
        return [];
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
    ];
    const getByPath = (snapshot, path) => {
        const [head, tail] = path.split(".");
        if (head === "counts")
            return toCount(snapshot.counts[tail]);
        if (head === "ops")
            return toCount(snapshot.ops[tail]);
        if (head === "finance")
            return toCount(snapshot.finance[tail]);
        return 0;
    };
    const drift = [];
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
