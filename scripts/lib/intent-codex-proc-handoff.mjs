import { normalizeContinuityEnvelope, normalizeHandoffArtifact, normalizeResumeHints } from "./codex-session-memory-utils.mjs";

function cleanText(value) {
  return String(value || "").trim();
}

function buildCurrentShellId(env = process.env) {
  return cleanText(env.CODEX_OPEN_MEMORY_SESSION_ID || env.CODEX_SHELL_RUN_ID || env.CODEX_OPEN_MEMORY_RUN_ID);
}

function buildChildBlockers(report, nextRecommendedAction) {
  if (cleanText(report?.status).toLowerCase() === "pass") return [];
  const summary = cleanText(report?.result?.stderrPreview || report?.result?.stdoutPreview || "Child intent run failed.");
  return [
    {
      summary,
      reason: "child-intent-failure",
      unblockStep: nextRecommendedAction,
    },
  ];
}

function buildArtifactPointers(report) {
  return {
    reportPath: cleanText(report?.artifacts?.reportPath),
    stdoutPath: cleanText(report?.artifacts?.stdoutPath),
    stderrPath: cleanText(report?.artifacts?.stderrPath),
    lastMessagePath: cleanText(report?.artifacts?.lastMessagePath),
  };
}

function buildResumeHints({
  args,
  report,
  artifactPointers,
  nextRecommendedAction,
  inheritedHints,
}) {
  const hints = [];
  const activeGoal = cleanText(args?.title || args?.taskId || args?.intentId);
  if (artifactPointers.reportPath) {
    hints.push({
      summary: `Review the latest child intent report for ${activeGoal || "this task"}.`,
      nextStep: nextRecommendedAction,
      path: artifactPointers.reportPath,
    });
  }
  if (artifactPointers.lastMessagePath) {
    hints.push({
      summary: "Open the child run last-message artifact before resuming.",
      nextStep: nextRecommendedAction,
      path: artifactPointers.lastMessagePath,
    });
  }
  if (cleanText(report?.status).toLowerCase() !== "pass") {
    hints.push({
      summary: "Rerun the child intent task with the same continuity lineage after fixing the failure.",
      nextStep: nextRecommendedAction,
    });
  } else {
    hints.push({
      summary: `Resume follow-up work for ${activeGoal || "the child intent task"} from the latest child-run report.`,
      nextStep: nextRecommendedAction,
    });
  }
  return normalizeResumeHints([...(Array.isArray(inheritedHints) ? inheritedHints : []), ...hints], 8);
}

function buildActiveGoal(args, continuityEnvelope, parentHandoff) {
  return cleanText(
    args?.title ||
      args?.taskId ||
      args?.intentId ||
      continuityEnvelope?.currentGoal ||
      parentHandoff?.activeGoal
  );
}

export function buildIntentProcHandoff(args, report, inheritedContinuity = {}, options = {}) {
  const env = options.env || process.env;
  const now = options.now || new Date().toISOString();
  const threadId = cleanText(
    options.threadId ||
      inheritedContinuity?.threadId ||
      env.STUDIO_BRAIN_BOOTSTRAP_THREAD_ID ||
      inheritedContinuity?.bootstrapMetadata?.threadId ||
      inheritedContinuity?.continuityEnvelope?.threadId ||
      inheritedContinuity?.handoff?.threadId
  );
  const parentHandoff = normalizeHandoffArtifact(inheritedContinuity?.handoff, { threadId, now });
  const continuityEnvelope = normalizeContinuityEnvelope(inheritedContinuity?.continuityEnvelope, {
    threadId,
    cwd: cleanText(inheritedContinuity?.bootstrapMetadata?.cwd),
    now,
  });
  const runId = cleanText(options.runId || inheritedContinuity?.runId);
  const currentShellId = buildCurrentShellId(env);
  const sourceShellId = cleanText(options.sourceShellId || parentHandoff.targetShellId || parentHandoff.sourceShellId || currentShellId);
  const targetShellId = cleanText(options.targetShellId || currentShellId || parentHandoff.targetShellId || parentHandoff.sourceShellId);
  const nextRecommendedAction =
    cleanText(report?.status).toLowerCase() === "pass"
      ? "Resume from the latest child-run report if more work is needed."
      : "Resolve the child intent failure and rerun with the same continuity lineage.";
  const artifactPointers = buildArtifactPointers(report);
  const summary = cleanText(report?.result?.lastMessage || report?.result?.stderrPreview || report?.result?.stdoutPreview);
  const workCompleted = cleanText(
    report?.result?.lastMessage ||
      summary ||
      (cleanText(report?.status).toLowerCase() === "pass"
        ? "Child intent run completed."
        : "Child intent run failed.")
  );

  return normalizeHandoffArtifact({
    createdAt: now,
    threadId,
    runId,
    agentId: cleanText(options.agentId || "agent:intent-codex-proc"),
    startupProvenance: {
      ...parentHandoff.startupProvenance,
      satisfiedBy: cleanText(
        options.satisfiedBy ||
          env.STUDIO_BRAIN_BOOTSTRAP_SATISFIED_BY ||
          inheritedContinuity?.satisfiedBy ||
          parentHandoff.startupProvenance?.satisfiedBy
      ),
      continuityEnvelopePath: cleanText(inheritedContinuity?.continuityEnvelopePath),
      bootstrapContextPath: cleanText(inheritedContinuity?.bootstrapContextPath),
      bootstrapMetadataPath: cleanText(inheritedContinuity?.bootstrapMetadataPath),
    },
    completionStatus: cleanText(report?.status || "complete"),
    activeGoal: buildActiveGoal(args, continuityEnvelope, parentHandoff),
    summary,
    workCompleted,
    blockers: buildChildBlockers(report, nextRecommendedAction),
    nextRecommendedAction,
    artifactPointers,
    parentRunId: cleanText(options.parentRunId || parentHandoff.runId || parentHandoff.parentRunId),
    handoffOwner: cleanText(options.handoffOwner || "agent:intent-codex-proc"),
    sourceShellId,
    targetShellId,
    resumeHints: buildResumeHints({
      args,
      report,
      artifactPointers,
      nextRecommendedAction,
      inheritedHints: parentHandoff.resumeHints,
    }),
  }, {
    threadId,
    now,
  });
}
