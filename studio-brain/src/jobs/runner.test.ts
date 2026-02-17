import test from "node:test";
import assert from "node:assert/strict";
import { JobRunner } from "./runner";
import { MemoryEventStore, MemoryStateStore } from "../stores/memoryStores";

const logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

test("JobRunner executes successful handler", async () => {
  const stateStore = new MemoryStateStore();
  const eventStore = new MemoryEventStore();

  const runner = new JobRunner(
    { stateStore, eventStore, logger },
    {
      ping: async () => ({ summary: "pong" }),
    }
  );

  await runner.run("ping");
  const events = await eventStore.listRecent(10);
  assert.ok(events.some((e) => e.action === "job.ping.succeeded"));
});

test("JobRunner records failure and rethrows", async () => {
  const stateStore = new MemoryStateStore();
  const eventStore = new MemoryEventStore();

  const runner = new JobRunner(
    { stateStore, eventStore, logger },
    {
      explode: async () => {
        throw new Error("boom");
      },
    }
  );

  await assert.rejects(async () => runner.run("explode"), /boom/);
  const events = await eventStore.listRecent(10);
  assert.ok(events.some((e) => e.action === "job.explode.failed"));
});

test("JobRunner skips duplicate overlapping run", async () => {
  const stateStore = new MemoryStateStore();
  const eventStore = new MemoryEventStore();

  let release!: () => void;
  const blocker = new Promise<void>((resolve) => {
    release = resolve;
  });

  const runner = new JobRunner(
    { stateStore, eventStore, logger },
    {
      long: async () => {
        await blocker;
        return { summary: "done" };
      },
    }
  );

  const first = runner.run("long");
  const second = runner.run("long");

  await second;
  release();
  await first;

  const events = await eventStore.listRecent(20);
  assert.ok(events.some((e) => e.action === "job.long.skipped"));
  assert.ok(events.some((e) => e.action === "job.long.succeeded"));
  const stats = runner.getStats();
  assert.equal(stats.long?.skipCount, 1);
  assert.equal(stats.long?.successCount, 1);
  assert.equal(stats.long?.failureCount, 0);
});
