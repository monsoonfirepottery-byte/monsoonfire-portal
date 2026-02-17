"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoryEventStore = exports.MemoryStateStore = void 0;
const node_crypto_1 = __importDefault(require("node:crypto"));
class MemoryStateStore {
    snapshots = [];
    jobRuns = new Map();
    diffs = [];
    async saveStudioState(snapshot) {
        const existing = this.snapshots.findIndex((s) => s.snapshotDate === snapshot.snapshotDate);
        if (existing >= 0) {
            this.snapshots[existing] = snapshot;
        }
        else {
            this.snapshots.push(snapshot);
            this.snapshots.sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
        }
    }
    async getLatestStudioState() {
        if (!this.snapshots.length)
            return null;
        return this.snapshots[this.snapshots.length - 1] ?? null;
    }
    async getPreviousStudioState(beforeDate) {
        const prior = this.snapshots.filter((s) => s.snapshotDate < beforeDate);
        if (!prior.length)
            return null;
        return prior[prior.length - 1] ?? null;
    }
    async saveStudioStateDiff(diff) {
        this.diffs.push(diff);
    }
    async listRecentJobRuns(limit) {
        const bounded = Math.max(1, limit);
        return [...this.jobRuns.values()]
            .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
            .slice(0, bounded);
    }
    async startJobRun(jobName) {
        const job = {
            id: node_crypto_1.default.randomUUID(),
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
    async completeJobRun(id, summary) {
        const current = this.jobRuns.get(id);
        if (!current)
            return;
        this.jobRuns.set(id, { ...current, status: "succeeded", completedAt: new Date().toISOString(), summary, errorMessage: null });
    }
    async failJobRun(id, errorMessage) {
        const current = this.jobRuns.get(id);
        if (!current)
            return;
        this.jobRuns.set(id, {
            ...current,
            status: "failed",
            completedAt: new Date().toISOString(),
            errorMessage,
        });
    }
}
exports.MemoryStateStore = MemoryStateStore;
class MemoryEventStore {
    events = [];
    async append(event) {
        const created = {
            ...event,
            id: node_crypto_1.default.randomUUID(),
            at: new Date().toISOString(),
        };
        this.events.unshift(created);
        return created;
    }
    async listRecent(limit) {
        return this.events.slice(0, Math.max(1, limit));
    }
}
exports.MemoryEventStore = MemoryEventStore;
