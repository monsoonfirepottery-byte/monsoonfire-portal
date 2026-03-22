import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const LIVE_SWARM_PROMPT_VERSION = "planning-council.live.v1";
export const LIVE_SWARM_DEFAULT_MODEL = process.env.PLANNING_COUNCIL_MODEL || process.env.CODEX_MODEL || process.env.OPENAI_MODEL || "gpt-5.4";
export const LIVE_SWARM_SECTION_NAMES = [
  "Summary",
  "Ordered Execution Sequence",
  "Validation Gates",
  "Failure Modes",
  "Required Human Decisions",
  "Open Questions",
  "Assumptions",
  "Dissent",
];

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function toObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function toList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => clean(entry)).filter(Boolean);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function isoNow() {
  return new Date().toISOString();
}

function stableHash(value) {
  return crypto.createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

function clip(value, max = 12_000) {
  const normalized = String(value ?? "");
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}\n…`;
}

function defaultCodexExecutable() {
  return process.platform === "win32" ? "codex.cmd" : "codex";
}

function defaultCodexExecutionRoot() {
  const override = clean(process.env.PLANNING_COUNCIL_CODEX_EXEC_ROOT || process.env.CODEX_EXEC_ROOT);
  if (override) return resolve(override);
  if (process.platform === "win32") {
    return resolve(process.env.SystemRoot || "C:\\Windows", "Temp");
  }
  return "/tmp";
}

function resolveDepthProfile(value) {
  const normalized = clean(value).toLowerCase();
  if (normalized === "fast" || normalized === "balanced" || normalized === "deepest") return normalized;
  return "balanced";
}

function resolveCodexReasoningEffort(depthProfile) {
  const override = clean(process.env.PLANNING_COUNCIL_CODEX_REASONING_EFFORT || process.env.CODEX_REASONING_EFFORT);
  if (override) return override;
  switch (resolveDepthProfile(depthProfile)) {
    case "fast":
      return "low";
    case "deepest":
      return "medium";
    default:
      return "low";
  }
}

function resolveCodexRoleConcurrency(depthProfile, preferCodexCli) {
  if (!preferCodexCli) return 6;
  const override = Number(process.env.PLANNING_COUNCIL_CODEX_CONCURRENCY || "");
  if (Number.isFinite(override) && override > 0) {
    return Math.max(1, Math.min(6, Math.trunc(override)));
  }
  switch (resolveDepthProfile(depthProfile)) {
    case "deepest":
      return 1;
    case "balanced":
      return 2;
    case "fast":
    default:
      return 2;
  }
}

function buildPromptInput(prompt) {
  const normalized = String(prompt ?? "");
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}

async function mapWithConcurrency(items, limit, iteratee) {
  const rows = Array.isArray(items) ? items : [];
  const concurrency = Math.max(1, Number(limit) || 1);
  const results = new Array(rows.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, rows.length) }, async () => {
    while (cursor < rows.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await iteratee(rows[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function normalizeSectionName(value) {
  const normalized = clean(value).toLowerCase();
  if (!normalized) return "Summary";
  const match = LIVE_SWARM_SECTION_NAMES.find((section) => section.toLowerCase() === normalized);
  if (match) return match;
  if (normalized.includes("validation")) return "Validation Gates";
  if (normalized.includes("failure")) return "Failure Modes";
  if (normalized.includes("human")) return "Required Human Decisions";
  if (normalized.includes("assumption")) return "Assumptions";
  if (normalized.includes("dissent")) return "Dissent";
  if (normalized.includes("open")) return "Open Questions";
  if (normalized.includes("ordered") || normalized.includes("sequence")) return "Ordered Execution Sequence";
  return "Summary";
}

function parseMarkdownSections(markdown) {
  const sections = new Map();
  let current = "Summary";
  sections.set(current, []);
  for (const rawLine of String(markdown ?? "").split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const headerMatch = /^##\s+(.+)$/.exec(line.trim());
    if (headerMatch) {
      current = normalizeSectionName(headerMatch[1]);
      if (!sections.has(current)) sections.set(current, []);
      continue;
    }
    if (!sections.has(current)) sections.set(current, []);
    sections.get(current).push(line);
  }
  return sections;
}

function diffSectionNames(beforeMarkdown, afterMarkdown) {
  const before = parseMarkdownSections(beforeMarkdown);
  const after = parseMarkdownSections(afterMarkdown);
  return LIVE_SWARM_SECTION_NAMES.filter((section) => {
    const beforeText = (before.get(section) ?? []).join("\n").trim();
    const afterText = (after.get(section) ?? []).join("\n").trim();
    return beforeText !== afterText && afterText;
  });
}

function buildRoundSummaryId(runId, roundType, cycle = 0) {
  return `round_summary_${stableHash(`${runId}|${roundType}|${cycle}`).slice(0, 18)}`;
}

function buildAgentRunId(runId, roleId, roundType, cycle = 0) {
  return `agent_run_${stableHash(`${runId}|${roleId}|${roundType}|${cycle}`).slice(0, 18)}`;
}

function buildPlanRevisionId(councilId, stage, cycle = 0) {
  return `plan_revision_${stableHash(`${councilId}|${stage}|${cycle}`).slice(0, 18)}`;
}

function buildRoleNoteId(councilId, roleId, roundType, cycle = 0) {
  return `role_note_${stableHash(`${councilId}|${roleId}|${roundType}|${cycle}`).slice(0, 18)}`;
}

function buildAddressEntryId(councilId, findingId, cycle = 0) {
  return `address_matrix_${stableHash(`${councilId}|${findingId}|${cycle}`).slice(0, 18)}`;
}

function extractOutputText(payload) {
  if (clean(payload?.output_text)) return clean(payload.output_text);
  const output = Array.isArray(payload?.output) ? payload.output : [];
  return clean(
    output
      .flatMap((entry) => (Array.isArray(entry?.content) ? entry.content : []))
      .map((entry) => clean(entry?.text))
      .filter(Boolean)
      .join("\n")
  );
}

function stripMarkdownFences(value) {
  const trimmed = clean(value);
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```[a-zA-Z0-9_-]*\s*/, "")
    .replace(/\s*```$/, "")
    .trim();
}

function extractJson(value) {
  const stripped = stripMarkdownFences(value);
  try {
    return JSON.parse(stripped);
  } catch {}
  const firstObject = stripped.indexOf("{");
  const lastObject = stripped.lastIndexOf("}");
  if (firstObject >= 0 && lastObject > firstObject) {
    return JSON.parse(stripped.slice(firstObject, lastObject + 1));
  }
  throw new Error("Model response did not contain valid JSON.");
}

function formatMemoryRefs(refs) {
  const rows = Array.isArray(refs) ? refs.slice(0, 6) : [];
  if (rows.length === 0) return "- none";
  return rows.map((ref) => {
    const label = clean(ref.label) || clean(ref.kind) || "memory";
    const kind = clean(ref.kind) || "context";
    const summary = clean(ref.summary) || "No summary.";
    return `- [${clean(ref.refId) || "unknown"}] ${label} (${kind}): ${summary}`;
  }).join("\n");
}

function formatFindings(findings) {
  const rows = Array.isArray(findings) ? findings : [];
  if (rows.length === 0) return "- none";
  return rows.map((finding) => {
    const claim = clean(finding.claim) || clean(finding.statement) || "No claim recorded.";
    const section = normalizeSectionName(finding.affectedPlanSection);
    const severity = clean(finding.severity) || "medium";
    const status = clean(finding.status) || "open";
    return `- ${clean(finding.findingId) || "finding"} [${severity}/${status}] ${section}: ${claim}`;
  }).join("\n");
}

function formatAddressMatrix(entries) {
  const rows = Array.isArray(entries) ? entries : [];
  if (rows.length === 0) return "- none";
  return rows.map((entry) => {
    const findingId = clean(entry.findingId) || "finding";
    const status = clean(entry.status) || "accepted";
    const reason = clean(entry.reason) || clean(entry.resolution) || "No rationale recorded.";
    return `- ${findingId}: ${status}. ${reason}`;
  }).join("\n");
}

function buildRoleHeader(role) {
  return [
    `Role: ${clean(role.roleName) || clean(role.roleId)}`,
    `Purpose: ${clean(role.purpose) || "Review the plan from this seat's perspective."}`,
    `Goal: ${clean(role.goal) || "Produce useful planning feedback."}`,
    `Instructions: ${toList(role.instructions).join(" | ") || "Use concrete, planning-only feedback."}`,
    `Objection classes: ${toList(role.objectionClasses).join(", ") || "general planning risk"}`,
    `Evidence standards: ${toList(role.evidenceStandards).join(" | ") || "Tie claims to the plan or supplied precedent."}`,
    `Merge rules: ${toList(role.mergeRules).join(" | ") || "Preserve dissent and required human decisions."}`,
  ].join("\n");
}

export function buildCritiquePrompt({ role, cycle, draftMarkdown, sharedRefs, roleRefs, priorFindings }) {
  const priorDigest = priorFindings.length > 0
    ? `Already raised findings to avoid repeating unless you materially deepen them:\n${formatFindings(priorFindings.slice(0, 10))}`
    : "Already raised findings to avoid repeating unless you materially deepen them:\n- none";
  return [
    `You are participating in a live planning council swarm.`,
    buildRoleHeader(role),
    `Round: parallel_critique`,
    `Cycle: ${cycle}`,
    `Task: critique the current plan draft and return structured findings, not prose commentary.`,
    `Rules:`,
    `- Return JSON only.`,
    `- Do not use tools, shell commands, web search, or file reads. Use only the supplied draft, role instructions, and memory excerpts.`,
    `- Either produce 2 to 6 substantive findings or abstain with a specific reason tied to your role.`,
    `- Each finding must name one affectedPlanSection from: ${LIVE_SWARM_SECTION_NAMES.join(", ")}.`,
    `- Each finding must include claim, whyItMatters, proposedChange, severity, findingType, requiresHumanDecision, and noveltyScore.`,
    `- Prefer non-obvious issues, not generic reminders.`,
    `- Use evidenceRefs with supplied refIds when memory or precedent changes your critique.`,
    `- Stay planning-only. Do not suggest implementation steps beyond planning or validation gates.`,
    priorDigest,
    `Shared memory excerpts:\n${formatMemoryRefs(sharedRefs)}`,
    `Role-specific memory excerpts:\n${formatMemoryRefs(roleRefs)}`,
    `Current plan draft:\n${clip(draftMarkdown, 14_000)}`,
    `Return exactly this JSON shape:`,
    `{"summary":"...","abstain":false,"abstainReason":"","findings":[{"severity":"high","findingType":"objection","affectedPlanSection":"Validation Gates","claim":"...","whyItMatters":"...","evidenceRefs":["ref-id"],"proposedChange":"...","requiresHumanDecision":false,"noveltyScore":0.82}]}`,
  ].join("\n\n");
}

function buildDraftCapturePrompt({ role, preparation }) {
  return [
    `You are participating in a live planning council swarm.`,
    buildRoleHeader(role),
    `Round: draft_capture`,
    `Task: upgrade the canonical draft into the best first-pass planning draft before specialists critique it.`,
    `Rules:`,
    `- Return JSON only.`,
    `- Do not use tools, shell commands, web search, or file reads. Use only the supplied draft, role instructions, and memory excerpts.`,
    `- Keep the draft planning-only and preserve the canonical section headings.`,
    `- Produce one clean markdown draft under draftMarkdown.`,
    `Shared memory excerpts:\n${formatMemoryRefs(preparation.sharedMemoryPack?.refs ?? [])}`,
    `Canonical draft:\n${clip(preparation.canonicalDraftMarkdown, 14_000)}`,
    `Return exactly this JSON shape:`,
    `{"summary":"...","draftMarkdown":"# Upgraded Council Plan\\n\\n## Summary\\n- ...","changedSections":["Summary","Validation Gates"]}`,
  ].join("\n\n");
}

export function buildPlannerRevisionPrompt({ role, cycle, draftMarkdown, findings, sharedRefs, roleRefs, previousAddressMatrix }) {
  return [
    `You are participating in a live planning council swarm.`,
    buildRoleHeader(role),
    `Round: planner_revision`,
    `Cycle: ${cycle}`,
    `Task: produce the next revised draft and an explicit address matrix for every supplied finding.`,
    `Rules:`,
    `- Return JSON only.`,
    `- Do not use tools, shell commands, web search, or file reads. Use only the supplied draft, findings, and memory excerpts.`,
    `- Preserve the canonical section headings.`,
    `- The revision must stay planning-only.`,
    `- Every supplied finding must appear once in addresses with status accepted, partially_accepted, or rejected.`,
    `- Use addressedFindingIds and rejectedFindingIds consistently.`,
    `Shared memory excerpts:\n${formatMemoryRefs(sharedRefs)}`,
    `Role-specific memory excerpts:\n${formatMemoryRefs(roleRefs)}`,
    `Current draft:\n${clip(draftMarkdown, 14_000)}`,
    `Findings to address:\n${formatFindings(findings)}`,
    `Previous address matrix:\n${formatAddressMatrix(previousAddressMatrix)}`,
    `Return exactly this JSON shape:`,
    `{"summary":"...","plannerRationale":"...","changedSections":["Validation Gates"],"addresses":[{"findingId":"finding-1","status":"accepted","resolution":"...","reason":"..."}],"revisionMarkdown":"# Upgraded Council Plan\\n\\n## Summary\\n- ..."}`,
  ].join("\n\n");
}

function buildRebuttalPrompt({ role, cycle, beforeDraft, afterDraft, ownFindings, addressEntries, sharedRefs, roleRefs }) {
  return [
    `You are participating in a live planning council swarm.`,
    buildRoleHeader(role),
    `Round: rebuttal`,
    `Cycle: ${cycle}`,
    `Task: evaluate the planner revision against your own findings. Review the diff and planner responses, not the whole problem from scratch.`,
    `Rules:`,
    `- Return JSON only.`,
    `- Do not use tools, shell commands, web search, or file reads. Use only the supplied drafts, findings, and memory excerpts.`,
    `- For each supplied finding, mark resolved, partially_resolved, or still_blocked.`,
    `- You may add up to 2 newFindings only if the revision introduced a new regression.`,
    `- Keep rebuttal findings concrete and tied to the changed draft.`,
    `Shared memory excerpts:\n${formatMemoryRefs(sharedRefs)}`,
    `Role-specific memory excerpts:\n${formatMemoryRefs(roleRefs)}`,
    `Your original findings:\n${formatFindings(ownFindings)}`,
    `Planner address matrix entries:\n${formatAddressMatrix(addressEntries)}`,
    `Before draft:\n${clip(beforeDraft, 10_000)}`,
    `After draft:\n${clip(afterDraft, 10_000)}`,
    `Return exactly this JSON shape:`,
    `{"summary":"...","abstain":false,"abstainReason":"","verdicts":[{"findingId":"finding-1","status":"resolved","reason":"..."}],"newFindings":[]}`,
  ].join("\n\n");
}

function buildSynthesisPrompt({ role, draftMarkdown, findings, addressMatrix, sharedRefs }) {
  return [
    `You are participating in a live planning council swarm.`,
    buildRoleHeader(role),
    `Round: synthesis`,
    `Task: produce the final upgraded plan draft, preserving unresolved dissent and required human decisions.`,
    `Rules:`,
    `- Return JSON only.`,
    `- Do not use tools, shell commands, web search, or file reads. Use only the supplied draft, findings, and memory excerpts.`,
    `- Keep the canonical section headings.`,
    `- Do not silently merge away unresolved blockers.`,
    `- Prefer clarity over verbosity.`,
    `Shared memory excerpts:\n${formatMemoryRefs(sharedRefs)}`,
    `Final working draft:\n${clip(draftMarkdown, 14_000)}`,
    `Findings:\n${formatFindings(findings)}`,
    `Address matrix:\n${formatAddressMatrix(addressMatrix)}`,
    `Return exactly this JSON shape:`,
    `{"summary":"...","finalDraftMarkdown":"# Upgraded Council Plan\\n\\n## Summary\\n- ...","topObjectionsOrDissent":["..."],"requiredHumanDecisions":["..."]}`,
  ].join("\n\n");
}

function buildLegitimacyPrompt({ role, draftMarkdown, findings, addressMatrix }) {
  return [
    `You are participating in a live planning council swarm.`,
    buildRoleHeader(role),
    `Round: legitimacy_check`,
    `Task: confirm whether dissent, blockers, and required human decisions remain visible in the final draft.`,
    `Rules:`,
    `- Return JSON only.`,
    `- Do not use tools, shell commands, web search, or file reads. Use only the supplied final draft and unresolved findings.`,
    `- Do not rewrite the plan.`,
    `- If legitimacy still fails, say so explicitly in stance and objections.`,
    `Current final draft:\n${clip(draftMarkdown, 12_000)}`,
    `Unresolved findings:\n${formatFindings(findings.filter((finding) => clean(finding.status) === "still_blocked" || finding.requiresHumanDecision))}`,
    `Address matrix:\n${formatAddressMatrix(addressMatrix)}`,
    `Return exactly this JSON shape:`,
    `{"summary":"...","stance":"support","objections":[],"proposedEdits":[]}`,
  ].join("\n\n");
}

function runProcess({ command, args, cwd, input = "", spawnImpl = spawn }) {
  return new Promise((resolvePromise, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawnImpl(command, args, {
      cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: process.platform === "win32",
    });
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolvePromise({
        exitCode: Number.isFinite(exitCode) ? exitCode : 1,
        stdout,
        stderr,
      });
    });
    child.stdin.end(buildPromptInput(input));
  });
}

export function buildCodexExecArgs({ executionRoot, model, outputPath, reasoningEffort = "low" }) {
  const args = [
    "exec",
    "--skip-git-repo-check",
    "--ephemeral",
    "--sandbox",
    "read-only",
    "--color",
    "never",
    "--disable",
    "apps",
    "--disable",
    "multi_agent",
    "--disable",
    "shell_snapshot",
    "-c",
    `model_reasoning_effort="${clean(reasoningEffort) || "low"}"`,
    "-c",
    "web_search=\"disabled\"",
    "-c",
    "mcp_servers.open_memory.enabled=false",
    "-C",
    resolve(executionRoot || defaultCodexExecutionRoot()),
    "-m",
    clean(model) || LIVE_SWARM_DEFAULT_MODEL,
    "-o",
    resolve(outputPath),
    "-",
  ];
  return args;
}

async function callResponsesJson({ apiKey, model, prompt, fetchImpl = fetch, maxOutputTokens = 2400 }) {
  const startedAt = isoNow();
  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: prompt,
      max_output_tokens: maxOutputTokens,
    }),
  });
  const completedAt = isoNow();
  const responseText = await response.text();
  let payload = {};
  try {
    payload = JSON.parse(responseText);
  } catch {
    payload = { output_text: responseText };
  }
  if (!response.ok) {
    throw new Error(`OpenAI Responses API failed (${response.status}): ${clip(responseText, 600)}`);
  }
  const outputText = extractOutputText(payload) || clean(responseText);
  const parsed = extractJson(outputText);
  return {
    parsed,
    outputText,
    provider: "openai.responses",
    promptHash: stableHash(prompt),
    outputHash: stableHash(outputText),
    startedAt,
    completedAt,
  };
}

async function callCodexExecJson({
  model,
  prompt,
  executionRoot = defaultCodexExecutionRoot(),
  reasoningEffort = "low",
  codexExecutable = defaultCodexExecutable(),
  spawnImpl = spawn,
}) {
  const startedAt = isoNow();
  const tempRoot = mkdtempSync(join(resolve(executionRoot || defaultCodexExecutionRoot()), "planning-live-swarm-"));
  const outputPath = join(tempRoot, "last-message.txt");
  try {
    const result = await runProcess({
      command: codexExecutable,
      args: buildCodexExecArgs({ executionRoot, model, outputPath, reasoningEffort }),
      cwd: resolve(executionRoot || defaultCodexExecutionRoot()),
      input: prompt,
      spawnImpl,
    });
    if (result.exitCode !== 0) {
      throw new Error(
        `codex exec failed (${result.exitCode}): ${clip(result.stderr || result.stdout || "No output captured.", 900)}`
      );
    }
    const outputText = existsSync(outputPath) ? readFileSync(outputPath, "utf8") : "";
    if (!clean(outputText)) {
      throw new Error(`codex exec completed without a final message. stderr: ${clip(result.stderr, 700)}`);
    }
    const parsed = extractJson(outputText);
    return {
      parsed,
      outputText,
      provider: "codex.exec",
      promptHash: stableHash(prompt),
      outputHash: stableHash(outputText),
      startedAt,
      completedAt: isoNow(),
    };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function callLiveModelJson({
  apiKey,
  model,
  prompt,
  fetchImpl = fetch,
  executionRoot = defaultCodexExecutionRoot(),
  reasoningEffort = "low",
  codexExecutable = defaultCodexExecutable(),
  spawnImpl = spawn,
  preferCodexCli = true,
  maxOutputTokens = 2400,
}) {
  const failures = [];
  const attemptCodex = async () => callCodexExecJson({ model, prompt, executionRoot, reasoningEffort, codexExecutable, spawnImpl });
  const attemptResponses = async () => {
    if (!clean(apiKey)) {
      throw new Error("OPENAI_API_KEY is not available.");
    }
    return callResponsesJson({ apiKey, model, prompt, fetchImpl, maxOutputTokens });
  };
  const attempts = preferCodexCli ? [attemptCodex, attemptResponses] : [attemptResponses, attemptCodex];
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(failures.join(" | ") || "No live model execution path was available.");
}

function getRoleMemorySlice(preparation, roleId) {
  const slices = Array.isArray(preparation.roleMemorySlices) ? preparation.roleMemorySlices : [];
  return slices.find((entry) => clean(entry.roleId) === clean(roleId)) ?? { refs: [], memoryRefIds: [] };
}

function getRolesForRound(preparation, roundType) {
  const roles = Array.isArray(preparation.roleManifests) ? preparation.roleManifests : [];
  return roles.filter((role) => toList(role.roundAssignments).includes(roundType));
}

function createAgentRun({ preparation, role, roundType, cycle, result, status, memoryRefIds, inputSections, abstained = false, abstainReason = "" }) {
  return {
    agentRunId: buildAgentRunId(preparation.swarmRun.runId, clean(role.roleId), roundType, cycle),
    runId: preparation.swarmRun.runId,
    councilId: preparation.council.councilId,
    roleId: clean(role.roleId),
    roleName: clean(role.roleName),
    roundType,
    cycle,
    status,
    provider: clean(result?.provider) || "live.model",
    promptVersion: LIVE_SWARM_PROMPT_VERSION,
    startedAt: result?.startedAt || isoNow(),
    completedAt: result?.completedAt || isoNow(),
    inputSections,
    memoryRefIds,
    abstained,
    abstainReason,
    promptHash: result?.promptHash || "",
    outputHash: result?.outputHash || "",
    mergeRules: toList(role.mergeRules),
    revisionPermissions: toObject(role.revisionPermissions),
  };
}

function createRoleNote({ preparation, role, roundType, cycle, summary, stance = "changes_requested", objections = [], proposedEdits = [], memoryRefIds = [], severity = "medium" }) {
  return {
    noteId: buildRoleNoteId(preparation.council.councilId, clean(role.roleId), roundType, cycle),
    councilId: preparation.council.councilId,
    runId: preparation.swarmRun.runId,
    roleId: clean(role.roleId),
    roleName: clean(role.roleName),
    roundType,
    cycle,
    status: "completed",
    stance,
    summary: clean(summary),
    objections: toList(objections),
    proposedEdits: toList(proposedEdits),
    memoryRefIds: toList(memoryRefIds),
    affectedPlanSections: [],
    severity,
  };
}

function normalizeFinding({ preparation, role, cycle, roundType, finding, memoryRefIds, index }) {
  const evidenceRefs = toList(finding.evidenceRefs);
  return {
    findingId: clean(finding.findingId) || `finding_${stableHash(`${preparation.council.councilId}|${role.roleId}|${roundType}|${cycle}|${index}|${clean(finding.claim)}`).slice(0, 18)}`,
    councilId: preparation.council.councilId,
    runId: preparation.swarmRun.runId,
    roleId: clean(role.roleId),
    roleName: clean(role.roleName),
    roundType,
    cycle,
    severity: clean(finding.severity) || "medium",
    findingType: clean(finding.findingType) || "objection",
    affectedPlanSection: normalizeSectionName(finding.affectedPlanSection),
    claim: clean(finding.claim),
    whyItMatters: clean(finding.whyItMatters),
    evidenceRefs: unique(evidenceRefs),
    proposedChange: clean(finding.proposedChange),
    requiresHumanDecision: Boolean(finding.requiresHumanDecision),
    noveltyScore: Number.isFinite(Number(finding.noveltyScore)) ? Number(finding.noveltyScore) : 0.75,
    status: clean(finding.status) || "open",
    summary: clean(finding.summary),
    memoryRefIds: unique([...memoryRefIds, ...toList(finding.memoryRefIds)]),
  };
}

function createRoundSummary({ preparation, roundType, cycle = null, summary, participatingRoleIds = [], findings = [] }) {
  const findingRows = Array.isArray(findings) ? findings : [];
  return {
    summaryId: buildRoundSummaryId(preparation.swarmRun.runId, roundType, cycle ?? 0),
    runId: preparation.swarmRun.runId,
    councilId: preparation.council.councilId,
    roundType,
    cycle,
    ordinal: 0,
    status: "completed",
    participatingRoleIds: unique(participatingRoleIds),
    noteIds: [],
    summary: clean(summary),
    unresolvedBlockers: findingRows.filter((finding) => clean(finding.status) === "still_blocked" || finding.requiresHumanDecision).map((finding) => finding.findingId),
    novelFindingsCount: findingRows.filter((finding) => Number(finding.noveltyScore ?? 0) >= 0.75).length,
    conflictClusters: [],
    stillBlockedFindingIds: findingRows.filter((finding) => clean(finding.status) === "still_blocked").map((finding) => finding.findingId),
  };
}

async function runRoleCritique({
  preparation,
  role,
  cycle,
  draftMarkdown,
  priorFindings,
  apiKey,
  model,
  fetchImpl,
  executionRoot,
  reasoningEffort,
  codexExecutable,
  spawnImpl,
  preferCodexCli,
}) {
  const roleMemorySlice = getRoleMemorySlice(preparation, role.roleId);
  const memoryRefIds = toList(roleMemorySlice.memoryRefIds);
  const prompt = buildCritiquePrompt({
    role,
    cycle,
    draftMarkdown,
    sharedRefs: preparation.sharedMemoryPack?.refs ?? [],
    roleRefs: roleMemorySlice.refs ?? [],
    priorFindings,
  });
  try {
    const result = await callLiveModelJson({
      apiKey,
      model,
      prompt,
      fetchImpl,
      executionRoot,
      reasoningEffort,
      codexExecutable,
      spawnImpl,
      preferCodexCli,
      maxOutputTokens: 2200,
    });
    const parsed = toObject(result.parsed);
    const abstain = Boolean(parsed.abstain);
    const findings = abstain
      ? []
      : (Array.isArray(parsed.findings) ? parsed.findings : []).slice(0, 6).map((finding, index) => normalizeFinding({
          preparation,
          role,
          cycle,
          roundType: "parallel_critique",
          finding,
          memoryRefIds,
          index,
        }));
    const severity = findings.some((finding) => clean(finding.severity) === "critical") ? "critical" : findings.some((finding) => clean(finding.severity) === "high") ? "high" : "medium";
    return {
      findings,
      roleNote: createRoleNote({
        preparation,
        role,
        roundType: "parallel_critique",
        cycle,
        summary: clean(parsed.summary) || `${clean(role.roleName)} reviewed the draft.`,
        stance: abstain ? "support" : findings.some((finding) => clean(finding.status) === "still_blocked" || finding.requiresHumanDecision) ? "blocker" : "changes_requested",
        objections: findings.map((finding) => finding.claim),
        proposedEdits: findings.map((finding) => finding.proposedChange),
        memoryRefIds,
        severity,
      }),
      agentRun: createAgentRun({
        preparation,
        role,
        roundType: "parallel_critique",
        cycle,
        result,
        status: "completed",
        memoryRefIds,
        inputSections: LIVE_SWARM_SECTION_NAMES,
        abstained: abstain,
        abstainReason: clean(parsed.abstainReason),
      }),
      failed: false,
    };
  } catch (error) {
    return {
      findings: [],
      roleNote: createRoleNote({
        preparation,
        role,
        roundType: "parallel_critique",
        cycle,
        summary: `${clean(role.roleName)} could not complete its critique pass.`,
        stance: "changes_requested",
        objections: [error instanceof Error ? error.message : String(error)],
        proposedEdits: [],
        memoryRefIds,
        severity: "medium",
      }),
      agentRun: createAgentRun({
        preparation,
        role,
        roundType: "parallel_critique",
        cycle,
        result: null,
        status: "failed",
        memoryRefIds,
        inputSections: LIVE_SWARM_SECTION_NAMES,
        abstained: true,
        abstainReason: error instanceof Error ? error.message : String(error),
      }),
      failed: true,
    };
  }
}

async function runDraftCapture({ preparation, apiKey, model, fetchImpl, executionRoot, reasoningEffort, codexExecutable, spawnImpl, preferCodexCli }) {
  const role = getRolesForRound(preparation, "draft_capture").find((entry) => clean(entry.roleId) === "lead-planner.v1");
  if (!role || clean(preparation.docket?.sourceType) === "draft-plan") {
    return {
      draftMarkdown: preparation.canonicalDraftMarkdown,
      roleNote: createRoleNote({
        preparation,
        role: role ?? { roleId: "lead-planner.v1", roleName: "Lead Planner" },
        roundType: "draft_capture",
        cycle: null,
        summary: clean(preparation.docket?.sourceType) === "draft-plan"
          ? "Used the existing draft plan as the initial council draft."
          : "Used the canonical prepared draft as the initial council draft.",
        stance: "support",
        memoryRefIds: [],
      }),
      agentRun: null,
      degraded: false,
    };
  }
  const roleMemorySlice = getRoleMemorySlice(preparation, role.roleId);
  const memoryRefIds = toList(roleMemorySlice.memoryRefIds);
  const prompt = buildDraftCapturePrompt({ role, preparation });
  try {
    const result = await callLiveModelJson({
      apiKey,
      model,
      prompt,
      fetchImpl,
      executionRoot,
      reasoningEffort,
      codexExecutable,
      spawnImpl,
      preferCodexCli,
      maxOutputTokens: 2600,
    });
    const parsed = toObject(result.parsed);
    const draftMarkdown = clean(parsed.draftMarkdown) || preparation.canonicalDraftMarkdown;
    return {
      draftMarkdown,
      roleNote: createRoleNote({
        preparation,
        role,
        roundType: "draft_capture",
        cycle: null,
        summary: clean(parsed.summary) || "Lead planner upgraded the canonical draft before critique.",
        stance: "support",
        proposedEdits: toList(parsed.changedSections),
        memoryRefIds,
      }),
      agentRun: createAgentRun({
        preparation,
        role,
        roundType: "draft_capture",
        cycle: null,
        result,
        status: "completed",
        memoryRefIds,
        inputSections: LIVE_SWARM_SECTION_NAMES,
      }),
      degraded: false,
    };
  } catch {
    return {
      draftMarkdown: preparation.canonicalDraftMarkdown,
      roleNote: createRoleNote({
        preparation,
        role,
        roundType: "draft_capture",
        cycle: null,
        summary: "Lead planner draft capture fell back to the canonical prepared draft.",
        stance: "changes_requested",
        memoryRefIds,
      }),
      agentRun: null,
      degraded: true,
    };
  }
}

async function runPlannerRevision({
  preparation,
  cycle,
  draftMarkdown,
  findings,
  previousAddressMatrix,
  apiKey,
  model,
  fetchImpl,
  executionRoot,
  reasoningEffort,
  codexExecutable,
  spawnImpl,
  preferCodexCli,
}) {
  const role = (Array.isArray(preparation.roleManifests) ? preparation.roleManifests : []).find((entry) => clean(entry.roleId) === "lead-planner.v1");
  if (!role) throw new Error("Lead planner role is missing from the prepared council.");
  const roleMemorySlice = getRoleMemorySlice(preparation, role.roleId);
  const memoryRefIds = toList(roleMemorySlice.memoryRefIds);
  const prompt = buildPlannerRevisionPrompt({
    role,
    cycle,
    draftMarkdown,
    findings,
    sharedRefs: preparation.sharedMemoryPack?.refs ?? [],
    roleRefs: roleMemorySlice.refs ?? [],
    previousAddressMatrix,
  });
  const result = await callLiveModelJson({
    apiKey,
    model,
    prompt,
    fetchImpl,
    executionRoot,
    reasoningEffort,
    codexExecutable,
    spawnImpl,
    preferCodexCli,
    maxOutputTokens: 3600,
  });
  const parsed = toObject(result.parsed);
  const revisionMarkdown = clean(parsed.revisionMarkdown) || draftMarkdown;
  const addresses = (Array.isArray(parsed.addresses) ? parsed.addresses : []).map((entry, index) => ({
    entryId: buildAddressEntryId(preparation.council.councilId, clean(entry.findingId) || `finding-${index}`, cycle),
    councilId: preparation.council.councilId,
    findingId: clean(entry.findingId),
    status: clean(entry.status) || "accepted",
    resolution: clean(entry.resolution),
    reason: clean(entry.reason),
    cycle,
  }));
  const revisionId = buildPlanRevisionId(preparation.council.councilId, "planner_revision", cycle);
  return {
    revision: {
      revisionId,
      councilId: preparation.council.councilId,
      stage: "planner_revision",
      cycle,
      authorRoleId: clean(role.roleId),
      summary: clean(parsed.summary) || `Planner revision cycle ${cycle} updated the draft.`,
      beforePlanHash: stableHash(draftMarkdown),
      afterPlanHash: stableHash(revisionMarkdown),
      changedSections: toList(parsed.changedSections).length > 0 ? toList(parsed.changedSections).map(normalizeSectionName) : diffSectionNames(draftMarkdown, revisionMarkdown),
      appliedNoteIds: [],
      unresolvedNoteIds: [],
      addressedFindingIds: unique(addresses.filter((entry) => clean(entry.status) !== "rejected").map((entry) => entry.findingId)),
      rejectedFindingIds: unique(addresses.filter((entry) => clean(entry.status) === "rejected").map((entry) => entry.findingId)),
      plannerRationale: clean(parsed.plannerRationale),
      markdown: revisionMarkdown,
    },
    addresses,
    roleNote: createRoleNote({
      preparation,
      role,
      roundType: "planner_revision",
      cycle,
      summary: clean(parsed.summary) || `Planner revision cycle ${cycle} updated the draft.`,
      stance: addresses.some((entry) => clean(entry.status) === "rejected") ? "changes_requested" : "support",
      proposedEdits: diffSectionNames(draftMarkdown, revisionMarkdown),
      memoryRefIds,
    }),
    agentRun: createAgentRun({
      preparation,
      role,
      roundType: "planner_revision",
      cycle,
      result,
      status: "completed",
      memoryRefIds,
      inputSections: LIVE_SWARM_SECTION_NAMES,
    }),
  };
}

async function runRoleRebuttal({
  preparation,
  role,
  cycle,
  beforeDraft,
  afterDraft,
  ownFindings,
  addressEntries,
  apiKey,
  model,
  fetchImpl,
  executionRoot,
  reasoningEffort,
  codexExecutable,
  spawnImpl,
  preferCodexCli,
}) {
  const roleMemorySlice = getRoleMemorySlice(preparation, role.roleId);
  const memoryRefIds = toList(roleMemorySlice.memoryRefIds);
  const prompt = buildRebuttalPrompt({
    role,
    cycle,
    beforeDraft,
    afterDraft,
    ownFindings,
    addressEntries,
    sharedRefs: preparation.sharedMemoryPack?.refs ?? [],
    roleRefs: roleMemorySlice.refs ?? [],
  });
  try {
    const result = await callLiveModelJson({
      apiKey,
      model,
      prompt,
      fetchImpl,
      executionRoot,
      reasoningEffort,
      codexExecutable,
      spawnImpl,
      preferCodexCli,
      maxOutputTokens: 2000,
    });
    const parsed = toObject(result.parsed);
    const verdicts = (Array.isArray(parsed.verdicts) ? parsed.verdicts : []).map((entry) => ({
      findingId: clean(entry.findingId),
      status: clean(entry.status) || "still_blocked",
      reason: clean(entry.reason),
    }));
    const newFindings = (Array.isArray(parsed.newFindings) ? parsed.newFindings : []).slice(0, 2).map((finding, index) => normalizeFinding({
      preparation,
      role,
      cycle,
      roundType: "rebuttal",
      finding,
      memoryRefIds,
      index,
    }));
    const blocker = verdicts.some((entry) => clean(entry.status) === "still_blocked");
    return {
      verdicts,
      newFindings,
      roleNote: createRoleNote({
        preparation,
        role,
        roundType: "rebuttal",
        cycle,
        summary: clean(parsed.summary) || `${clean(role.roleName)} evaluated the planner diff.`,
        stance: blocker ? "blocker" : verdicts.some((entry) => clean(entry.status) === "partially_resolved") ? "changes_requested" : "support",
        objections: [...verdicts.filter((entry) => clean(entry.status) === "still_blocked").map((entry) => entry.reason), ...newFindings.map((finding) => finding.claim)],
        proposedEdits: newFindings.map((finding) => finding.proposedChange),
        memoryRefIds,
        severity: blocker ? "critical" : "medium",
      }),
      agentRun: createAgentRun({
        preparation,
        role,
        roundType: "rebuttal",
        cycle,
        result,
        status: "completed",
        memoryRefIds,
        inputSections: diffSectionNames(beforeDraft, afterDraft),
      }),
      failed: false,
    };
  } catch (error) {
    return {
      verdicts: ownFindings.map((finding) => ({
        findingId: finding.findingId,
        status: clean(finding.status) || "still_blocked",
        reason: error instanceof Error ? error.message : String(error),
      })),
      newFindings: [],
      roleNote: createRoleNote({
        preparation,
        role,
        roundType: "rebuttal",
        cycle,
        summary: `${clean(role.roleName)} could not complete rebuttal; prior blockers remain visible.`,
        stance: "blocker",
        objections: [error instanceof Error ? error.message : String(error)],
        memoryRefIds,
        severity: "critical",
      }),
      agentRun: createAgentRun({
        preparation,
        role,
        roundType: "rebuttal",
        cycle,
        result: null,
        status: "failed",
        memoryRefIds,
        inputSections: diffSectionNames(beforeDraft, afterDraft),
        abstained: true,
        abstainReason: error instanceof Error ? error.message : String(error),
      }),
      failed: true,
    };
  }
}

async function runSynthesis({
  preparation,
  draftMarkdown,
  findings,
  addressMatrix,
  apiKey,
  model,
  fetchImpl,
  executionRoot,
  reasoningEffort,
  codexExecutable,
  spawnImpl,
  preferCodexCli,
}) {
  const role = (Array.isArray(preparation.roleManifests) ? preparation.roleManifests : []).find((entry) => clean(entry.roleId) === "synthesizer.v1");
  if (!role) throw new Error("Synthesizer role is missing from the prepared council.");
  const roleMemorySlice = getRoleMemorySlice(preparation, role.roleId);
  const memoryRefIds = toList(roleMemorySlice.memoryRefIds);
  const prompt = buildSynthesisPrompt({
    role,
    draftMarkdown,
    findings,
    addressMatrix,
    sharedRefs: preparation.sharedMemoryPack?.refs ?? [],
  });
  const result = await callLiveModelJson({
    apiKey,
    model,
    prompt,
    fetchImpl,
    executionRoot,
    reasoningEffort,
    codexExecutable,
    spawnImpl,
    preferCodexCli,
    maxOutputTokens: 3400,
  });
  const parsed = toObject(result.parsed);
  const finalDraftMarkdown = clean(parsed.finalDraftMarkdown) || draftMarkdown;
  return {
    revision: {
      revisionId: buildPlanRevisionId(preparation.council.councilId, "synthesis", 0),
      councilId: preparation.council.councilId,
      stage: "synthesis",
      cycle: null,
      authorRoleId: clean(role.roleId),
      summary: clean(parsed.summary) || "Synthesizer produced the final upgraded plan draft.",
      beforePlanHash: stableHash(draftMarkdown),
      afterPlanHash: stableHash(finalDraftMarkdown),
      changedSections: diffSectionNames(draftMarkdown, finalDraftMarkdown),
      appliedNoteIds: [],
      unresolvedNoteIds: [],
      addressedFindingIds: [],
      rejectedFindingIds: [],
      plannerRationale: "Synthesized accepted revisions while preserving dissent and required human decisions.",
      markdown: finalDraftMarkdown,
    },
    roleNote: createRoleNote({
      preparation,
      role,
      roundType: "synthesis",
      cycle: null,
      summary: clean(parsed.summary) || "Synthesizer produced the final upgraded plan draft.",
      stance: findings.some((finding) => clean(finding.status) === "still_blocked" || finding.requiresHumanDecision) ? "blocker" : "support",
      objections: toList(parsed.topObjectionsOrDissent),
      proposedEdits: [],
      memoryRefIds,
    }),
    agentRun: createAgentRun({
      preparation,
      role,
      roundType: "synthesis",
      cycle: null,
      result,
      status: "completed",
      memoryRefIds,
      inputSections: LIVE_SWARM_SECTION_NAMES,
    }),
    finalDraftMarkdown,
  };
}

async function runLegitimacy({
  preparation,
  role,
  finalDraftMarkdown,
  findings,
  addressMatrix,
  apiKey,
  model,
  fetchImpl,
  executionRoot,
  reasoningEffort,
  codexExecutable,
  spawnImpl,
  preferCodexCli,
}) {
  const roleMemorySlice = getRoleMemorySlice(preparation, role.roleId);
  const memoryRefIds = toList(roleMemorySlice.memoryRefIds);
  const prompt = buildLegitimacyPrompt({
    role,
    draftMarkdown: finalDraftMarkdown,
    findings,
    addressMatrix,
  });
  try {
    const result = await callLiveModelJson({
      apiKey,
      model,
      prompt,
      fetchImpl,
      executionRoot,
      reasoningEffort,
      codexExecutable,
      spawnImpl,
      preferCodexCli,
      maxOutputTokens: 1400,
    });
    const parsed = toObject(result.parsed);
    return {
      roleNote: createRoleNote({
        preparation,
        role,
        roundType: "legitimacy_check",
        cycle: null,
        summary: clean(parsed.summary) || `${clean(role.roleName)} completed legitimacy review.`,
        stance: clean(parsed.stance) || "support",
        objections: toList(parsed.objections),
        proposedEdits: toList(parsed.proposedEdits),
        memoryRefIds,
        severity: clean(parsed.stance) === "blocker" ? "critical" : "medium",
      }),
      agentRun: createAgentRun({
        preparation,
        role,
        roundType: "legitimacy_check",
        cycle: null,
        result,
        status: "completed",
        memoryRefIds,
        inputSections: ["Dissent", "Required Human Decisions", "Validation Gates"],
      }),
      failed: false,
    };
  } catch (error) {
    return {
      roleNote: createRoleNote({
        preparation,
        role,
        roundType: "legitimacy_check",
        cycle: null,
        summary: `${clean(role.roleName)} could not complete legitimacy review.`,
        stance: "changes_requested",
        objections: [error instanceof Error ? error.message : String(error)],
        memoryRefIds,
      }),
      agentRun: createAgentRun({
        preparation,
        role,
        roundType: "legitimacy_check",
        cycle: null,
        result: null,
        status: "failed",
        memoryRefIds,
        inputSections: ["Dissent", "Required Human Decisions", "Validation Gates"],
        abstained: true,
        abstainReason: error instanceof Error ? error.message : String(error),
      }),
      failed: true,
    };
  }
}

export async function orchestratePlanningLiveSwarm({
  preparation,
  apiKey,
  model = LIVE_SWARM_DEFAULT_MODEL,
  fetchImpl = fetch,
  repoRoot = process.cwd(),
  executionRoot = defaultCodexExecutionRoot(),
  codexExecutable = defaultCodexExecutable(),
  spawnImpl = spawn,
  preferCodexCli = true,
}) {
  const roleFindings = [];
  const roleNotes = [];
  const agentRuns = [];
  const planRevisions = [];
  const roundSummaries = [];
  const addressMatrix = [];
  let degradedFallbackUsed = false;
  const depthProfile = resolveDepthProfile(preparation.swarmRun?.depthProfile);
  const reasoningEffort = resolveCodexReasoningEffort(depthProfile);
  const roleExecutionConcurrency = resolveCodexRoleConcurrency(depthProfile, preferCodexCli);

  const draftCapture = await runDraftCapture({
    preparation,
    apiKey,
    model,
    fetchImpl,
    executionRoot,
    reasoningEffort,
    codexExecutable,
    spawnImpl,
    preferCodexCli,
  });
  let currentDraft = draftCapture.draftMarkdown;
  if (draftCapture.roleNote) roleNotes.push(draftCapture.roleNote);
  if (draftCapture.agentRun) agentRuns.push(draftCapture.agentRun);
  degradedFallbackUsed ||= Boolean(draftCapture.degraded);
  roundSummaries.push(createRoundSummary({
    preparation,
    roundType: "draft_capture",
    cycle: null,
    summary: draftCapture.roleNote?.summary || "Draft capture completed.",
    participatingRoleIds: draftCapture.agentRun ? [draftCapture.agentRun.roleId] : ["lead-planner.v1"],
    findings: [],
  }));

  roundSummaries.push(createRoundSummary({
    preparation,
    roundType: "memory_pack",
    cycle: null,
    summary: clean(preparation.sharedMemoryPack?.summary) || `Memory pack status: ${clean(preparation.sharedMemoryPack?.status) || "missing"}.`,
    participatingRoleIds: getRolesForRound(preparation, "memory_pack").map((role) => clean(role.roleId)),
    findings: [],
  }));

  const maxCycles = Math.max(1, Number(preparation.swarmRun?.maxCritiqueCycles ?? 1));
  for (let cycle = 1; cycle <= maxCycles; cycle += 1) {
    const critiqueRoles = getRolesForRound(preparation, "parallel_critique");
    const priorFindings = roleFindings.map((finding) => ({ findingId: finding.findingId, claim: finding.claim, severity: finding.severity, affectedPlanSection: finding.affectedPlanSection, status: finding.status }));
    const critiqueResults = await mapWithConcurrency(critiqueRoles, roleExecutionConcurrency, (role) => runRoleCritique({
      preparation,
      role,
      cycle,
      draftMarkdown: currentDraft,
      priorFindings,
      apiKey,
      model,
      fetchImpl,
      executionRoot,
      reasoningEffort,
      codexExecutable,
      spawnImpl,
      preferCodexCli,
    }));
    for (const result of critiqueResults) {
      roleFindings.push(...result.findings);
      roleNotes.push(result.roleNote);
      agentRuns.push(result.agentRun);
      degradedFallbackUsed ||= Boolean(result.failed);
    }
    const critiqueRoundFindings = roleFindings.filter((finding) => clean(finding.roundType) === "parallel_critique" && Number(finding.cycle ?? 0) === cycle);
    roundSummaries.push(createRoundSummary({
      preparation,
      roundType: "parallel_critique",
      cycle,
      summary: `Parallel critique cycle ${cycle} produced ${critiqueRoundFindings.length} findings across ${critiqueRoles.length} active roles.`,
      participatingRoleIds: critiqueRoles.map((role) => clean(role.roleId)),
      findings: critiqueRoundFindings,
    }));

    const findingsForCycle = roleFindings.filter((finding) => Number(finding.cycle ?? 0) === cycle && ["open", "partially_resolved", "still_blocked", ""].includes(clean(finding.status) || "open"));
    const plannerRevision = await runPlannerRevision({
      preparation,
      cycle,
      draftMarkdown: currentDraft,
      findings: findingsForCycle,
      previousAddressMatrix: addressMatrix,
      apiKey,
      model,
      fetchImpl,
      executionRoot,
      reasoningEffort,
      codexExecutable,
      spawnImpl,
      preferCodexCli,
    });
    const beforeDraft = currentDraft;
    currentDraft = plannerRevision.revision.markdown;
    planRevisions.push(plannerRevision.revision);
    roleNotes.push(plannerRevision.roleNote);
    agentRuns.push(plannerRevision.agentRun);
    addressMatrix.push(...plannerRevision.addresses);
    roundSummaries.push(createRoundSummary({
      preparation,
      roundType: "planner_revision",
      cycle,
      summary: plannerRevision.revision.summary,
      participatingRoleIds: [clean(plannerRevision.agentRun.roleId)],
      findings: findingsForCycle,
    }));

    const rebuttalRoles = getRolesForRound(preparation, "rebuttal").filter((role) => roleFindings.some((finding) => clean(finding.roleId) === clean(role.roleId) && Number(finding.cycle ?? 0) === cycle));
    const rebuttalResults = await mapWithConcurrency(rebuttalRoles, roleExecutionConcurrency, (role) => runRoleRebuttal({
      preparation,
      role,
      cycle,
      beforeDraft,
      afterDraft: currentDraft,
      ownFindings: roleFindings.filter((finding) => clean(finding.roleId) === clean(role.roleId) && Number(finding.cycle ?? 0) === cycle),
      addressEntries: addressMatrix.filter((entry) => Number(entry.cycle ?? 0) === cycle),
      apiKey,
      model,
      fetchImpl,
      executionRoot,
      reasoningEffort,
      codexExecutable,
      spawnImpl,
      preferCodexCli,
    }));
    for (const result of rebuttalResults) {
      roleNotes.push(result.roleNote);
      agentRuns.push(result.agentRun);
      degradedFallbackUsed ||= Boolean(result.failed);
      for (const verdict of result.verdicts) {
        const finding = roleFindings.find((entry) => clean(entry.findingId) === clean(verdict.findingId));
        if (finding) {
          finding.status = clean(verdict.status) || clean(finding.status) || "still_blocked";
          if (!clean(finding.summary)) finding.summary = result.roleNote.summary;
        }
      }
      roleFindings.push(...result.newFindings);
    }
    roundSummaries.push(createRoundSummary({
      preparation,
      roundType: "rebuttal",
      cycle,
      summary: `Rebuttal cycle ${cycle} reviewed planner changes for ${rebuttalRoles.length} active roles.`,
      participatingRoleIds: rebuttalRoles.map((role) => clean(role.roleId)),
      findings: roleFindings.filter((finding) => Number(finding.cycle ?? 0) === cycle && (clean(finding.roundType) === "rebuttal" || clean(finding.status) === "still_blocked")),
    }));
  }

  const synthesis = await runSynthesis({
    preparation,
    draftMarkdown: currentDraft,
    findings: roleFindings,
    addressMatrix,
    apiKey,
    model,
    fetchImpl,
    executionRoot,
    reasoningEffort,
    codexExecutable,
    spawnImpl,
    preferCodexCli,
  });
  currentDraft = synthesis.finalDraftMarkdown;
  planRevisions.push(synthesis.revision);
  roleNotes.push(synthesis.roleNote);
  agentRuns.push(synthesis.agentRun);
  roundSummaries.push(createRoundSummary({
    preparation,
    roundType: "synthesis",
    cycle: null,
    summary: synthesis.revision.summary,
    participatingRoleIds: [clean(synthesis.agentRun.roleId)],
    findings: roleFindings,
  }));

  const legitimacyRoles = getRolesForRound(preparation, "legitimacy_check");
  const legitimacyResults = await mapWithConcurrency(legitimacyRoles, roleExecutionConcurrency, (role) => runLegitimacy({
    preparation,
    role,
    finalDraftMarkdown: currentDraft,
    findings: roleFindings,
    addressMatrix,
    apiKey,
    model,
    fetchImpl,
    executionRoot,
    reasoningEffort,
    codexExecutable,
    spawnImpl,
    preferCodexCli,
  }));
  for (const result of legitimacyResults) {
    roleNotes.push(result.roleNote);
    agentRuns.push(result.agentRun);
    degradedFallbackUsed ||= Boolean(result.failed);
  }
  roundSummaries.push(createRoundSummary({
    preparation,
    roundType: "legitimacy_check",
    cycle: null,
    summary: `Legitimacy check completed with ${legitimacyRoles.length} role reviews.`,
    participatingRoleIds: legitimacyRoles.map((role) => clean(role.roleId)),
    findings: roleFindings.filter((finding) => clean(finding.status) === "still_blocked" || finding.requiresHumanDecision),
  }));

  return {
    swarmRun: {
      runId: `${clean(preparation.swarmRun.runId) || "council_swarm"}:live`,
      createdAt: clean(preparation.swarmRun.createdAt) || isoNow(),
      completedAt: isoNow(),
      runtime: agentRuns.some((entry) => clean(entry.provider) === "codex.exec") ? "codex-cli" : "openai-responses",
      executionMode: "live",
      depthProfile: clean(preparation.swarmRun.depthProfile) || "deepest",
      maxCritiqueCycles: maxCycles,
      degradedFallbackUsed,
    },
    agentRuns,
    roleFindings,
    roleNotes,
    planRevisions,
    roundSummaries,
    finalDraftMarkdown: currentDraft,
    addressMatrix,
    memoryRefsUsed: unique(roleFindings.flatMap((finding) => toList(finding.evidenceRefs)).concat(roleNotes.flatMap((note) => toList(note.memoryRefIds)))),
  };
}
