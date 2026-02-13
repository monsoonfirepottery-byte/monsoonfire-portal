import type { Logger } from "../config/logger";
import type { EventStore, StateStore } from "../stores/interfaces";
import { stableHashDeep } from "../stores/hash";

export type JobContext = {
  stateStore: StateStore;
  eventStore: EventStore;
  logger: Logger;
};

export type JobHandler = (ctx: JobContext) => Promise<{ summary: string }>;

export type JobExecutionStats = {
  running: boolean;
  successCount: number;
  failureCount: number;
  skipCount: number;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastStatus: "succeeded" | "failed" | "skipped" | null;
  lastDurationMs: number | null;
  lastError: string | null;
};

export class JobRunner {
  private readonly runningJobs = new Set<string>();
  private readonly stats = new Map<string, JobExecutionStats>();

  constructor(
    private readonly ctx: JobContext,
    private readonly handlers: Record<string, JobHandler>
  ) {}

  private ensureStats(jobName: string): JobExecutionStats {
    const existing = this.stats.get(jobName);
    if (existing) return existing;
    const created: JobExecutionStats = {
      running: false,
      successCount: 0,
      failureCount: 0,
      skipCount: 0,
      lastStartedAt: null,
      lastCompletedAt: null,
      lastStatus: null,
      lastDurationMs: null,
      lastError: null,
    };
    this.stats.set(jobName, created);
    return created;
  }

  getStats(): Record<string, JobExecutionStats> {
    const output: Record<string, JobExecutionStats> = {};
    for (const [jobName, stats] of this.stats.entries()) {
      output[jobName] = { ...stats };
    }
    return output;
  }

  async run(jobName: string): Promise<void> {
    const handler = this.handlers[jobName];
    if (!handler) {
      throw new Error(`Unknown job: ${jobName}`);
    }

    const stats = this.ensureStats(jobName);

    if (this.runningJobs.has(jobName)) {
      const completedAt = new Date().toISOString();
      stats.skipCount += 1;
      stats.lastCompletedAt = completedAt;
      stats.lastStatus = "skipped";
      stats.lastDurationMs = 0;
      stats.lastError = "already_running";
      this.ctx.logger.warn("job_skipped_already_running", { jobName });
      await this.ctx.eventStore.append({
        actorType: "system",
        actorId: "studio-brain",
        action: `job.${jobName}.skipped`,
        rationale: "Skipped run because previous invocation is still in progress.",
        target: "local",
        approvalState: "exempt",
        inputHash: stableHashDeep({ jobName, skippedAt: new Date().toISOString() }),
        outputHash: null,
        metadata: { reason: "already_running" },
      });
      return;
    }

    this.runningJobs.add(jobName);
    const run = await this.ctx.stateStore.startJobRun(jobName);
    const startedAtMs = Date.now();
    stats.running = true;
    stats.lastStartedAt = new Date(startedAtMs).toISOString();
    stats.lastError = null;
    this.ctx.logger.info("job_started", { jobName, runId: run.id });

    try {
      const result = await handler(this.ctx);
      await this.ctx.stateStore.completeJobRun(run.id, result.summary);
      await this.ctx.eventStore.append({
        actorType: "system",
        actorId: "studio-brain",
        action: `job.${jobName}.succeeded`,
        rationale: "Scheduled studio brain job completed.",
        target: "local",
        approvalState: "exempt",
        inputHash: run.id,
        outputHash: result.summary,
        metadata: { runId: run.id, summary: result.summary },
      });
      stats.successCount += 1;
      stats.lastCompletedAt = new Date().toISOString();
      stats.lastStatus = "succeeded";
      stats.lastDurationMs = Date.now() - startedAtMs;
      stats.lastError = null;
      this.ctx.logger.info("job_succeeded", { jobName, runId: run.id, summary: result.summary });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.ctx.stateStore.failJobRun(run.id, message);
      await this.ctx.eventStore.append({
        actorType: "system",
        actorId: "studio-brain",
        action: `job.${jobName}.failed`,
        rationale: "Scheduled studio brain job failed.",
        target: "local",
        approvalState: "exempt",
        inputHash: run.id,
        outputHash: null,
        metadata: { runId: run.id, error: message },
      });
      stats.failureCount += 1;
      stats.lastCompletedAt = new Date().toISOString();
      stats.lastStatus = "failed";
      stats.lastDurationMs = Date.now() - startedAtMs;
      stats.lastError = message;
      this.ctx.logger.error("job_failed", { jobName, runId: run.id, error: message });
      throw error;
    } finally {
      this.runningJobs.delete(jobName);
      stats.running = false;
    }
  }
}
