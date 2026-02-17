import { getPgPool } from "./postgres";

export type PruneResult = {
  retentionDays: number;
  deletedEventRows: number;
  deletedJobRows: number;
  deletedDiffRows: number;
};

function rowCountOrZero(value: number | null): number {
  return typeof value === "number" ? value : 0;
}

export async function pruneOldRows(retentionDays: number): Promise<PruneResult> {
  const pool = getPgPool();
  const [eventsResult, jobsResult, diffsResult] = await Promise.all([
    pool.query(
      "DELETE FROM brain_event_log WHERE at < now() - ($1::int * interval '1 day')",
      [retentionDays]
    ),
    pool.query(
      "DELETE FROM brain_job_runs WHERE started_at < now() - ($1::int * interval '1 day')",
      [retentionDays]
    ),
    pool.query(
      "DELETE FROM studio_state_diff WHERE created_at < now() - ($1::int * interval '1 day')",
      [retentionDays]
    ),
  ]);

  return {
    retentionDays,
    deletedEventRows: rowCountOrZero(eventsResult.rowCount),
    deletedJobRows: rowCountOrZero(jobsResult.rowCount),
    deletedDiffRows: rowCountOrZero(diffsResult.rowCount),
  };
}
