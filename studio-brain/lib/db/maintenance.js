"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pruneOldRows = pruneOldRows;
const postgres_1 = require("./postgres");
function rowCountOrZero(value) {
    return typeof value === "number" ? value : 0;
}
async function pruneOldRows(retentionDays) {
    const pool = (0, postgres_1.getPgPool)();
    const [eventsResult, jobsResult, diffsResult] = await Promise.all([
        pool.query("DELETE FROM brain_event_log WHERE at < now() - ($1::int * interval '1 day')", [retentionDays]),
        pool.query("DELETE FROM brain_job_runs WHERE started_at < now() - ($1::int * interval '1 day')", [retentionDays]),
        pool.query("DELETE FROM studio_state_diff WHERE created_at < now() - ($1::int * interval '1 day')", [retentionDays]),
    ]);
    return {
        retentionDays,
        deletedEventRows: rowCountOrZero(eventsResult.rowCount),
        deletedJobRows: rowCountOrZero(jobsResult.rowCount),
        deletedDiffRows: rowCountOrZero(diffsResult.rowCount),
    };
}
