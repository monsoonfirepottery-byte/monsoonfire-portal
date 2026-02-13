import type { AuditEvent, EventStore, JobRunRecord, StateStore, StudioStateDiff, StudioStateSnapshot } from "./interfaces";
import crypto from "node:crypto";

export class MemoryStateStore implements StateStore {
  private snapshots: StudioStateSnapshot[] = [];
  private jobRuns = new Map<string, JobRunRecord>();
  private diffs: StudioStateDiff[] = [];

  async saveStudioState(snapshot: StudioStateSnapshot): Promise<void> {
    const existing = this.snapshots.findIndex((s) => s.snapshotDate === snapshot.snapshotDate);
    if (existing >= 0) {
      this.snapshots[existing] = snapshot;
    } else {
      this.snapshots.push(snapshot);
      this.snapshots.sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
    }
  }

  async getLatestStudioState(): Promise<StudioStateSnapshot | null> {
    if (!this.snapshots.length) return null;
    return this.snapshots[this.snapshots.length - 1] ?? null;
  }

  async getPreviousStudioState(beforeDate: string): Promise<StudioStateSnapshot | null> {
    const prior = this.snapshots.filter((s) => s.snapshotDate < beforeDate);
    if (!prior.length) return null;
    return prior[prior.length - 1] ?? null;
  }

  async saveStudioStateDiff(diff: StudioStateDiff): Promise<void> {
    this.diffs.push(diff);
  }

  async listRecentJobRuns(limit: number): Promise<JobRunRecord[]> {
    const bounded = Math.max(1, limit);
    return [...this.jobRuns.values()]
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, bounded);
  }

  async startJobRun(jobName: string): Promise<JobRunRecord> {
    const job: JobRunRecord = {
      id: crypto.randomUUID(),
      jobName,
      status: "running",
      startedAt: new Date().toISOString(),
      completedAt: null,
      summary: null,
      errorMessage: null,
    };
    this.jobRuns.set(job.id, job);
    return job;
  }

  async completeJobRun(id: string, summary: string): Promise<void> {
    const current = this.jobRuns.get(id);
    if (!current) return;
    this.jobRuns.set(id, { ...current, status: "succeeded", completedAt: new Date().toISOString(), summary, errorMessage: null });
  }

  async failJobRun(id: string, errorMessage: string): Promise<void> {
    const current = this.jobRuns.get(id);
    if (!current) return;
    this.jobRuns.set(id, {
      ...current,
      status: "failed",
      completedAt: new Date().toISOString(),
      errorMessage,
    });
  }
}

export class MemoryEventStore implements EventStore {
  private events: AuditEvent[] = [];

  async append(event: Omit<AuditEvent, "id" | "at">): Promise<AuditEvent> {
    const created: AuditEvent = {
      ...event,
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
    };
    this.events.unshift(created);
    return created;
  }

  async listRecent(limit: number): Promise<AuditEvent[]> {
    return this.events.slice(0, Math.max(1, limit));
  }
}
