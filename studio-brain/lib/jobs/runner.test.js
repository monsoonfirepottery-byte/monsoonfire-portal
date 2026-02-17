"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const runner_1 = require("./runner");
const memoryStores_1 = require("../stores/memoryStores");
const logger = {
    debug: () => { },
    info: () => { },
    warn: () => { },
    error: () => { },
};
(0, node_test_1.default)("JobRunner executes successful handler", async () => {
    const stateStore = new memoryStores_1.MemoryStateStore();
    const eventStore = new memoryStores_1.MemoryEventStore();
    const runner = new runner_1.JobRunner({ stateStore, eventStore, logger }, {
        ping: async () => ({ summary: "pong" }),
    });
    await runner.run("ping");
    const events = await eventStore.listRecent(10);
    strict_1.default.ok(events.some((e) => e.action === "job.ping.succeeded"));
});
(0, node_test_1.default)("JobRunner records failure and rethrows", async () => {
    const stateStore = new memoryStores_1.MemoryStateStore();
    const eventStore = new memoryStores_1.MemoryEventStore();
    const runner = new runner_1.JobRunner({ stateStore, eventStore, logger }, {
        explode: async () => {
            throw new Error("boom");
        },
    });
    await strict_1.default.rejects(async () => runner.run("explode"), /boom/);
    const events = await eventStore.listRecent(10);
    strict_1.default.ok(events.some((e) => e.action === "job.explode.failed"));
});
(0, node_test_1.default)("JobRunner skips duplicate overlapping run", async () => {
    const stateStore = new memoryStores_1.MemoryStateStore();
    const eventStore = new memoryStores_1.MemoryEventStore();
    let release;
    const blocker = new Promise((resolve) => {
        release = resolve;
    });
    const runner = new runner_1.JobRunner({ stateStore, eventStore, logger }, {
        long: async () => {
            await blocker;
            return { summary: "done" };
        },
    });
    const first = runner.run("long");
    const second = runner.run("long");
    await second;
    release();
    await first;
    const events = await eventStore.listRecent(20);
    strict_1.default.ok(events.some((e) => e.action === "job.long.skipped"));
    strict_1.default.ok(events.some((e) => e.action === "job.long.succeeded"));
    const stats = runner.getStats();
    strict_1.default.equal(stats.long?.skipCount, 1);
    strict_1.default.equal(stats.long?.successCount, 1);
    strict_1.default.equal(stats.long?.failureCount, 0);
});
