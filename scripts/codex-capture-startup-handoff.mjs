import {
  refreshLocalBootstrapArtifacts,
  loadBootstrapArtifacts,
  normalizeContinuityEnvelope,
  normalizeHandoffArtifact,
  resolveCodexThreadContext,
  writeContinuityEnvelope,
  writeHandoffArtifact,
} from "./lib/codex-session-memory-utils.mjs";
import { rememberWithStudioBrain } from "./lib/studio-brain-memory-write.mjs";

function clean(value) {
  return String(value ?? "").trim();
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args.set(key, "true");
      continue;
    }
    args.set(key, next);
    index += 1;
  }
  return args;
}

function boolFlag(value) {
  return ["1", "true", "yes", "on"].includes(clean(value).toLowerCase());
}

function blockerRows(blocker) {
  const summary = clean(blocker);
  return summary ? [{ summary }] : [];
}

async function main() {
  const args = parseArgs();
  const cwd = clean(args.get("cwd")) || process.cwd();
  const resolvedThread = resolveCodexThreadContext({
    threadId: clean(args.get("thread-id")),
    cwd,
  });
  const threadId = clean(args.get("thread-id")) || clean(resolvedThread?.threadId);
  if (!threadId) {
    throw new Error("Unable to resolve a Codex thread. Pass --thread-id explicitly.");
  }

  const threadTitle = clean(args.get("title")) || clean(resolvedThread?.title);
  const firstUserMessage = clean(args.get("first-user-message")) || clean(resolvedThread?.firstUserMessage);
  const summary = clean(args.get("summary"));
  const activeGoal = clean(args.get("goal")) || firstUserMessage || threadTitle;
  const nextRecommendedAction = clean(args.get("next-action"));
  const blocker = clean(args.get("blocker"));
  const completionStatus = clean(args.get("status")) || (blocker ? "degraded" : "pass");
  const emitJson = boolFlag(args.get("json"));

  if (!summary) {
    throw new Error("Missing required --summary.");
  }

  const payload = {
    kind: "handoff",
    content: summary,
    rememberForStartup: true,
    metadata: {
      activeGoal,
      nextRecommendedAction,
      blockers: blockerRows(blocker),
      completionStatus,
      capturedFrom: "codex-startup-handoff-cli",
    },
  };

  let mode = "remote";
  let result = null;
  try {
    result = await rememberWithStudioBrain(payload, {
      threadId,
      cwd,
      threadTitle,
      firstUserMessage,
      capturedFrom: "codex-startup-handoff-cli",
    });
  } catch (error) {
    mode = "local-repair";
    const priorArtifacts = loadBootstrapArtifacts(threadId);
    const handoff = normalizeHandoffArtifact(
      {
        threadId,
        summary,
        activeGoal,
        workCompleted: summary,
        nextRecommendedAction,
        blockers: blockerRows(blocker),
        completionStatus,
      },
      {
        threadId,
        existing: priorArtifacts?.handoff,
      }
    );
    writeHandoffArtifact(threadId, handoff);
    writeContinuityEnvelope(
      threadId,
      normalizeContinuityEnvelope(
        {
          continuityState: blocker ? "continuity_degraded" : "ready",
          startupSatisfiedBy: "validated-local-continuity",
          currentGoal: activeGoal,
          lastHandoffSummary: summary,
          nextRecommendedAction,
          blockers: blockerRows(blocker),
          fallbackOnly: false,
          startupSourceQuality: "thread-scoped-dominant",
          laneSourceQuality: "thread-scoped-dominant",
          threadScopedItemCount: 1,
          startup: {
            satisfiedBy: "validated-local-continuity",
            threadScopedItemCount: 1,
            startupSourceQuality: "thread-scoped-dominant",
          },
        },
        {
          threadId,
          cwd,
          existing: priorArtifacts?.continuityEnvelope,
        }
      )
    );
    refreshLocalBootstrapArtifacts({
      threadId,
      cwd,
      threadTitle,
      firstUserMessage,
      metadata: {
        startupGateSatisfiedBy: "validated-local-continuity",
        continuityState: blocker ? "continuity_degraded" : "ready",
        threadScopedItemCount: 1,
        startupSourceQuality: "thread-scoped-dominant",
      },
    });
    result = {
      ok: true,
      verified: false,
      saved: 1,
      failed: 0,
      memoryIds: [],
      error: clean(error?.message),
    };
  }

  const output = {
    ok: true,
    mode,
    threadId,
    cwd,
    threadTitle,
    firstUserMessage,
    summary,
    activeGoal,
    nextRecommendedAction,
    blocker,
    completionStatus,
    result,
  };

  if (emitJson) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }
  process.stdout.write(`Captured startup handoff via ${mode} for ${threadId}.\n`);
}

main().catch((error) => {
  process.stderr.write(`${clean(error?.message || error)}\n`);
  process.exitCode = 1;
});
