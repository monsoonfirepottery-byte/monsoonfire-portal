import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import test from "node:test";
import { runtimePathsForThread } from "./lib/codex-session-memory-utils.mjs";
import { readJson, readJsonl } from "./lib/pst-memory-utils.mjs";
import { rememberWithStudioBrain } from "./lib/studio-brain-memory-write.mjs";

function cleanupThreadRuntime(threadId) {
  const paths = runtimePathsForThread(threadId);
  rmSync(paths.runtimeDir, { recursive: true, force: true });
  return paths;
}

test("rememberWithStudioBrain routes single saves through capture and writes a local audit row", async () => {
  const threadId = "remember-single-test";
  const paths = cleanupThreadRuntime(threadId);
  const calls = [];

  try {
    const result = await rememberWithStudioBrain(
      {
        kind: "fact",
        content: "Micah's birthday is March 14.",
        subjectKey: "person:micah-wyenn",
      },
      {
        threadId,
        cwd: "C:\\Users\\micah",
        threadTitle: "what's my bday",
        firstUserMessage: "what's my bday",
        requestJson: async (request) => {
          calls.push(request);
          return {
            ok: true,
            memory: { id: "mem_req_single_1" },
          };
        },
      }
    );

    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, "/api/memory/capture");
    assert.equal(calls[0].body.source, "manual");
    assert.equal(calls[0].body.status, "accepted");
    assert.equal(calls[0].body.memoryType, "semantic");
    assert.equal(calls[0].body.metadata.threadId, threadId);
    assert.equal(calls[0].body.metadata.scopeClass, "personal");
    assert.equal(calls[0].body.metadata.subjectKey, "person:micah-wyenn");
    assert.equal(calls[0].body.metadata.profileClass, "birthday");
    assert.equal(calls[0].body.metadata.startupEligible, true);
    assert.equal(calls[0].body.metadata.threadEvidence, "explicit");
    assert.equal(result.saved, 1);
    assert.equal(result.usedBatch, false);
    assert.equal(result.verified, true);
    assert.equal(result.threadLinked, true);
    assert.deepEqual(result.memoryIds, ["mem_req_single_1"]);

    const audit = readJsonl(paths.writesJsonlPath);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].memoryId, "mem_req_single_1");
    assert.equal(audit[0].kind, "fact");
  } finally {
    cleanupThreadRuntime(threadId);
  }
});

test("rememberWithStudioBrain batches multiple saves through import and updates continuity state", async () => {
  const threadId = "remember-batch-test";
  const paths = cleanupThreadRuntime(threadId);
  const calls = [];

  try {
    const result = await rememberWithStudioBrain(
      {
        items: [
          {
            kind: "decision",
            content: "Decision: route new thread memory writes through studio_brain_remember.",
            rememberForStartup: true,
          },
          {
            kind: "blocker",
            content: "Blocker: old threads still have ad hoc memory write habits.",
            metadata: {
              nextRecommendedAction: "Ship the home instruction update.",
            },
          },
        ],
      },
      {
        threadId,
        cwd: "D:\\monsoonfire-portal",
        threadTitle: "memory write overhaul",
        firstUserMessage: "make writes intuitive",
        requestJson: async (request) => {
          calls.push(request);
          return {
            ok: true,
            result: {
              imported: 2,
              failed: 0,
              results: [
                { index: 0, ok: true, id: "mem_req_batch_1" },
                { index: 1, ok: true, id: "mem_req_batch_2" },
              ],
            },
          };
        },
      }
    );

    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, "/api/memory/import");
    assert.equal(Array.isArray(calls[0].body.items), true);
    assert.equal(calls[0].body.items.length, 2);
    assert.equal(calls[0].body.items[0].source, "codex");
    assert.equal(calls[0].body.items[1].source, "codex-handoff");
    assert.equal(calls[0].body.items[0].metadata.scopeClass, "work");
    assert.equal(calls[0].body.items[0].metadata.startupEligible, true);
    assert.equal(calls[0].body.items[1].metadata.startupEligible, true);
    assert.equal(result.usedBatch, true);
    assert.equal(result.saved, 2);
    assert.equal(result.failed, 0);
    assert.deepEqual(result.memoryIds, ["mem_req_batch_1", "mem_req_batch_2"]);

    const audit = readJsonl(paths.writesJsonlPath);
    assert.equal(audit.length, 2);

    const envelope = readJson(paths.continuityEnvelopePath, {});
    assert.equal(envelope.schema, "codex-continuity-envelope.v1");
    assert.equal(envelope.continuityState, "ready");
    assert.equal(envelope.presentationProjectLane, "monsoonfire-portal");
    assert.equal(envelope.threadScopedItemCount, 2);
    assert.equal(envelope.startupSourceQuality, "thread-scoped-dominant");
    assert.equal(envelope.laneSourceQuality, "thread-scoped-dominant");
    assert.equal(envelope.startup.threadScopedItemCount, 2);
    assert.equal(
      String(envelope.bootstrapSummary || "").includes("route new thread memory writes"),
      true
    );
    assert.equal(Array.isArray(envelope.blockers), true);
    assert.equal(envelope.blockers[0].summary, "Blocker: old threads still have ad hoc memory write habits.");
    assert.equal(envelope.nextRecommendedAction, "Ship the home instruction update.");

    const handoff = readJson(paths.handoffPath, {});
    assert.equal(handoff.schema, "codex-handoff.v1");
    assert.equal(
      String(handoff.summary || "").includes("Decision: route new thread memory writes through studio_brain_remember."),
      true
    );

    const bootstrapContext = readJson(paths.bootstrapContextJsonPath, {});
    assert.equal(bootstrapContext.schema, "codex-startup-bootstrap-context.v1");
    assert.equal(Array.isArray(bootstrapContext.items), true);
    assert.equal(bootstrapContext.items.some((item) => item.source === "codex-handoff"), true);

    const bootstrapMetadata = readJson(paths.bootstrapMetadataPath, {});
    assert.equal(bootstrapMetadata.threadId, threadId);
    assert.equal(bootstrapMetadata.startupGateSatisfiedBy, "validated-local-continuity");
    assert.equal(bootstrapMetadata.continuityState, "ready");
    assert.equal(bootstrapMetadata.presentationProjectLane, "monsoonfire-portal");
    assert.equal(bootstrapMetadata.threadScopedItemCount, 2);
    assert.equal(bootstrapMetadata.artifactPointers.handoffPath, paths.handoffPath);
    assert.equal(bootstrapMetadata.artifactPointers.startupContextCachePath, paths.startupContextCachePath);
  } finally {
    cleanupThreadRuntime(threadId);
  }
});

test("rememberWithStudioBrain writes handoff artifacts and keeps request ids stable across retries", async () => {
  const threadId = "remember-handoff-test";
  const paths = cleanupThreadRuntime(threadId);
  const calls = [];

  try {
    const input = {
      kind: "handoff",
      content: "Handoff: implement the smart memory write tool and update the home instructions.",
      rememberForStartup: true,
      metadata: {
        activeGoal: "Make new threads write memories intuitively.",
        nextRecommendedAction: "Open a new desktop thread and test a single write.",
        completionStatus: "pass",
        parentRunId: "run-parent-1",
        handoffOwner: "memory-pipeline",
        sourceShellId: "shell-source",
        targetShellId: "shell-target",
        resumeHints: [
          "Open the new desktop thread first.",
          { summary: "Verify the handoff artifact was written.", nextStep: "Read handoff.json." },
        ],
      },
    };

    const requestJson = async (request) => {
      calls.push(request);
      return {
        ok: true,
        memory: { id: "mem_req_handoff_1" },
      };
    };

    const first = await rememberWithStudioBrain(input, {
      threadId,
      cwd: "D:\\monsoonfire-portal",
      threadTitle: "memory write handoff",
      firstUserMessage: "make writes intuitive",
      requestJson,
    });
    const second = await rememberWithStudioBrain(input, {
      threadId,
      cwd: "D:\\monsoonfire-portal",
      threadTitle: "memory write handoff",
      firstUserMessage: "make writes intuitive",
      requestJson,
    });

    assert.equal(first.memoryIds[0], "mem_req_handoff_1");
    assert.equal(second.memoryIds[0], "mem_req_handoff_1");
    assert.equal(calls.length, 2);
    assert.equal(calls[0].body.clientRequestId, calls[1].body.clientRequestId);

    const handoff = readJson(paths.handoffPath, {});
    assert.equal(handoff.schema, "codex-handoff.v1");
    assert.equal(handoff.summary, input.content);
    assert.equal(handoff.activeGoal, "Make new threads write memories intuitively.");
    assert.equal(handoff.parentRunId, "run-parent-1");
    assert.equal(handoff.handoffOwner, "memory-pipeline");
    assert.equal(handoff.sourceShellId, "shell-source");
    assert.equal(handoff.targetShellId, "shell-target");
    assert.equal(Array.isArray(handoff.resumeHints), true);
    assert.equal(handoff.resumeHints.length, 2);

    const audit = readJsonl(paths.writesJsonlPath);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].requestId, calls[0].body.clientRequestId);
  } finally {
    cleanupThreadRuntime(threadId);
  }
});

test("rememberWithStudioBrain prefers an explicit handoff over startup-eligible checkpoints when both are present", async () => {
  const threadId = "remember-handoff-priority-test";
  const paths = cleanupThreadRuntime(threadId);

  try {
    await rememberWithStudioBrain(
      {
        items: [
          {
            kind: "checkpoint",
            content: "Checkpoint: startup guardrails landed.",
            rememberForStartup: true,
            metadata: {
              activeGoal: "Finish the startup guardrail rollout.",
              nextRecommendedAction: "Verify preflight.",
            },
          },
          {
            kind: "handoff",
            content: "Handoff: verify the startup guardrails end to end.",
            rememberForStartup: true,
            metadata: {
              activeGoal: "Verify the startup guardrails end to end.",
              nextRecommendedAction: "Run codex-doctor and startup-preflight.",
            },
          },
        ],
      },
      {
        threadId,
        cwd: "D:\\monsoonfire-portal",
        threadTitle: "startup handoff priority",
        firstUserMessage: "tighten startup guardrails",
        requestJson: async () => ({
          ok: true,
          result: {
            imported: 2,
            failed: 0,
            results: [
              { index: 0, ok: true, id: "mem_req_priority_1" },
              { index: 1, ok: true, id: "mem_req_priority_2" },
            ],
          },
        }),
      }
    );

    const handoff = readJson(paths.handoffPath, {});
    assert.equal(handoff.summary, "Handoff: verify the startup guardrails end to end.");
    assert.equal(handoff.activeGoal, "Verify the startup guardrails end to end.");
  } finally {
    cleanupThreadRuntime(threadId);
  }
});
