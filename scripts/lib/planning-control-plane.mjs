import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";

export const DEFAULT_PLANNING_SCHEMA_PATH = "contracts/planning.schema.json";
export const DEFAULT_PLANNING_GOVERNANCE_DIR = ".governance/planning";

const TOUCHPOINT_PATTERNS = {
  security: [/\bsecurity\b/i, /\bsecret/i, /\bcredential/i, /\btoken\b/i],
  auth: [/\bauth/i, /\bpermission/i, /\bauthori[sz]/i, /\bprivilege/i],
  privacy: [/\bprivacy\b/i, /\bpii\b/i, /\bretention\b/i, /\bsensitive data\b/i, /\bpersonal data\b/i, /\buser data\b/i],
  data: [/\bdata\b/i, /\bdatabase\b/i, /\bschema\b/i, /\bprovenance\b/i],
  payments: [/\bpayment/i, /\bbilling/i, /\bcharge/i, /\brefund/i, /\bstripe\b/i],
  compliance: [/\bcompliance\b/i, /\bpolicy\b/i, /\blegal\b/i, /\bapproval\b/i],
  cost: [/\bcost\b/i, /\bbudget\b/i, /\bspend\b/i, /\bfinance\b/i],
  operations: [/\bops\b/i, /\boperator/i, /\brunbook\b/i, /\bincident\b/i],
  reliability: [/\breliab/i, /\brollback\b/i, /\brecovery\b/i, /\bfailure\b/i, /\bpartial/i],
  platform: [/\bplatform\b/i, /\bshared\b/i, /\binfra/i, /\bdeployment\b/i],
  infra: [/\binfra/i, /\bmigration\b/i, /\bpostgres\b/i, /\bredis\b/i],
  customer: [/\bcustomer\b/i, /\bend[- ]user\b/i, /\bsupport\b/i, /\bux\b/i],
  support: [/\bsupport\b/i, /\bescalation\b/i, /\bhelp desk\b/i],
  process: [/\bworkflow\b/i, /\bprocess\b/i, /\bhandoff\b/i, /\bowner\b/i],
  "trust-safety": [/\btrust[- ]?safety\b/i, /\bsafety\b/i, /\babuse\b/i, /\bmoderation\b/i, /\bharm\b/i],
  domain: [/\bdomain\b/i, /\bsubject matter\b/i, /\bnovel\b/i],
  novelty: [/\bnovel\b/i, /\bgreenfield\b/i, /\bnew surface\b/i]
};

const IMPACT_ORDER = ["low", "medium", "high", "critical"];
const COUNCIL_SWARM_ROUND_ORDER = ["draft_capture", "memory_pack", "parallel_critique", "planner_revision", "rebuttal", "synthesis", "legitimacy_check"];
const PLANNING_STOPWORDS = new Set([
  "plan",
  "plans",
  "planning",
  "review",
  "packet",
  "packets",
  "council",
  "councils",
  "draft",
  "drafts",
  "build",
  "create",
  "make",
  "help",
  "this",
  "that",
  "thing",
  "things",
  "workflow",
  "workflows",
  "feature",
  "features",
  "project",
  "projects",
  "execution",
  "upgrade",
  "upgraded",
  "improve",
  "refine"
]);
const DEFAULT_SWARM_CONFIG = {
  runtime: "hybrid",
  executionMode: "deterministic",
  depthProfile: "balanced",
  maxCritiqueCycles: 1,
  roundOrder: COUNCIL_SWARM_ROUND_ORDER,
  maxAgents: 12,
  allowSpecialists: true,
  specialistRoleIds: []
};
const DEFAULT_MEMORY_POLICY = {
  mode: "detailed_role_notes",
  writeback: true,
  includePriorPackets: true,
  includeRoleNotes: true,
  maxSharedItems: 8,
  maxRoleItems: 4
};
const DEFAULT_PACKET_ARTIFACT_LIMITS = Object.freeze({
  agentRuns: 24,
  roleFindings: 48,
  roleNotes: 32,
  planRevisions: 12,
  roundSummaries: 16,
  memoryRefs: 24,
  addressMatrix: 48
});
const CONTINUITY_MEMORY_SOURCES = new Set(["codex-handoff", "codex-continuity-envelope", "codex-startup-blocker"]);
const CONTINUITY_MEMORY_SCHEMAS = new Set([
  "codex-handoff.v1",
  "codex-continuity-envelope.v1",
  "codex-startup-blocker.v1",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  const keys = Object.keys(value).sort((left, right) => left.localeCompare(right));
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function buildId(prefix, payload) {
  return `${prefix}_${sha256(stableStringify(payload)).slice(0, 12)}`;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function clipText(value, max = 320) {
  const text = normalizeString(value);
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

function countWords(value) {
  return normalizeString(value).split(/\s+/).filter(Boolean).length;
}

function tokenizeRelevantText(value) {
  return normalizeString(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length >= 4 && !PLANNING_STOPWORDS.has(token));
}

function normalizeStringList(value, maxItems = 64) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizeString(entry))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeAssumptions(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
      const statement = normalizeString(entry.statement);
      const evidenceLabel = normalizeString(entry.evidenceLabel) || "inferred";
      if (!statement) return null;
      return { statement, evidenceLabel };
    })
    .filter(Boolean);
}

function toObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

function mergeStringLists(...values) {
  return [...new Set(values.flatMap((value) => {
    if (Array.isArray(value)) return normalizeStringList(value, 128);
    const single = normalizeString(value);
    return single ? [single] : [];
  }))];
}

function extractDraftPlanText(draftPlan) {
  if (typeof draftPlan === "string") return draftPlan.trim();
  const draftPlanObject = toObject(draftPlan);
  return (
    normalizeString(draftPlanObject.markdown) ||
    normalizeString(draftPlanObject.text) ||
    normalizeString(draftPlanObject.body) ||
    normalizeString(draftPlanObject.plan) ||
    normalizeString(draftPlanObject.content) ||
    ""
  );
}

function normalizeMarkdownHeading(line) {
  const withoutHashes = line.replace(/^#{1,6}\s+/, "").replace(/:$/, "").trim().toLowerCase();
  return withoutHashes;
}

function extractMarkdownItem(line) {
  const itemMatch = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/);
  if (itemMatch?.[1]) return itemMatch[1].trim();
  return "";
}

function routeDraftPlanLine(section, candidate, buckets) {
  if (!candidate) return;
  if (/success|acceptance/.test(section)) buckets.successCriteria.push(candidate);
  else if (/constraint|non-negotiable|guardrail/.test(section)) buckets.constraints.push(candidate);
  else if (/known fact|facts|context/.test(section)) buckets.knownFacts.push(candidate);
  else if (/unknown|question|open question/.test(section)) buckets.openQuestions.push(candidate);
  else if (/decision|approval|go\/no-go/.test(section)) buckets.requiredHumanDecisions.push(candidate);
  else if (/validation|gate|test|check/.test(section)) buckets.validationGates.push(candidate);
  else if (/risk|failure|rollback|recovery|dissent/.test(section)) buckets.risks.push(candidate);
  else if (/step|sequence|approach|implementation|plan/.test(section)) buckets.steps.push(candidate);
  else if (/why now|urgency|timing/.test(section)) buckets.whyNow.push(candidate);
  else if (/objective|summary/.test(section)) buckets.summary.push(candidate);
  else if (/priority/.test(section)) buckets.humanPriorities.push(candidate);
}

function extractAffectedSystemsFromText(text) {
  const matches = text.match(/\b[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+\b/g) ?? [];
  return [...new Set(matches)];
}

function analyzeDraftPlan(draftPlan) {
  const text = extractDraftPlanText(draftPlan);
  const draftPlanObject = toObject(draftPlan);
  const buckets = {
    summary: [],
    whyNow: [],
    steps: normalizeStringList(draftPlanObject.steps),
    risks: mergeStringLists(draftPlanObject.risks, draftPlanObject.failureModes),
    validationGates: mergeStringLists(draftPlanObject.validationGates, draftPlanObject.gates),
    requiredHumanDecisions: mergeStringLists(draftPlanObject.requiredHumanDecisions, draftPlanObject.decisions),
    openQuestions: mergeStringLists(draftPlanObject.openQuestions, draftPlanObject.questions, draftPlanObject.unknowns),
    constraints: normalizeStringList(draftPlanObject.constraints),
    successCriteria: normalizeStringList(draftPlanObject.successCriteria),
    knownFacts: normalizeStringList(draftPlanObject.knownFacts),
    humanPriorities: normalizeStringList(draftPlanObject.humanPriorities),
    affectedSystems: normalizeStringList(draftPlanObject.affectedSystems)
  };
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let currentSection = "";
  for (const line of lines) {
    if (/^#{1,6}\s+/.test(line)) {
      currentSection = normalizeMarkdownHeading(line);
      continue;
    }
    const inlineSection = line.match(/^([A-Za-z][A-Za-z0-9 /&_-]{2,80}):\s+(.+)$/);
    if (inlineSection?.[1] && inlineSection?.[2]) {
      currentSection = normalizeMarkdownHeading(`${inlineSection[1]}:`);
      routeDraftPlanLine(currentSection, inlineSection[2].trim(), buckets);
      continue;
    }
    if (/^[A-Za-z][A-Za-z0-9 /&_-]{2,80}:$/.test(line)) {
      currentSection = normalizeMarkdownHeading(line);
      continue;
    }
    const listItem = extractMarkdownItem(line);
    const candidate = listItem || line;
    if (!currentSection && listItem) currentSection = "steps";
    if (!currentSection && !listItem && !buckets.summary.length) buckets.summary.push(candidate);
    routeDraftPlanLine(currentSection, candidate, buckets);
  }
  return {
    text,
    objective:
      normalizeString(draftPlanObject.objective) ||
      normalizeString(draftPlanObject.title) ||
      buckets.summary[0] ||
      "",
    whyNow: buckets.whyNow[0] || normalizeString(draftPlanObject.whyNow),
    steps: mergeStringLists(buckets.steps),
    risks: mergeStringLists(buckets.risks),
    validationGates: mergeStringLists(buckets.validationGates),
    requiredHumanDecisions: mergeStringLists(buckets.requiredHumanDecisions),
    openQuestions: mergeStringLists(buckets.openQuestions),
    constraints: mergeStringLists(buckets.constraints),
    successCriteria: mergeStringLists(buckets.successCriteria),
    knownFacts: mergeStringLists(buckets.knownFacts),
    humanPriorities: mergeStringLists(buckets.humanPriorities),
    affectedSystems: mergeStringLists(buckets.affectedSystems, extractAffectedSystemsFromText(text)),
    summary: mergeStringLists(buckets.summary).join(" ")
  };
}

function normalizeRoundOrder(value) {
  const rounds = normalizeStringList(value, 16).filter((entry) => COUNCIL_SWARM_ROUND_ORDER.includes(entry));
  return rounds.length > 0 ? rounds : [...COUNCIL_SWARM_ROUND_ORDER];
}

function normalizeSwarmConfig(input) {
  const raw = toObject(input?.swarmConfig);
  const depthProfile = normalizeString(raw.depthProfile) || DEFAULT_SWARM_CONFIG.depthProfile;
  const derivedCycles = depthProfile === "deepest" ? 2 : 1;
  return {
    runtime: normalizeString(raw.runtime) || DEFAULT_SWARM_CONFIG.runtime,
    executionMode: normalizeString(raw.executionMode) || DEFAULT_SWARM_CONFIG.executionMode,
    depthProfile,
    maxCritiqueCycles: Number.isFinite(Number(raw.maxCritiqueCycles)) && Number(raw.maxCritiqueCycles) > 0 ? Math.min(4, Math.max(1, Math.floor(Number(raw.maxCritiqueCycles)))) : derivedCycles,
    roundOrder: normalizeRoundOrder(raw.roundOrder),
    maxAgents: Number.isFinite(Number(raw.maxAgents)) && Number(raw.maxAgents) > 0 ? Math.min(32, Math.max(1, Math.floor(Number(raw.maxAgents)))) : DEFAULT_SWARM_CONFIG.maxAgents,
    allowSpecialists: raw.allowSpecialists !== false,
    specialistRoleIds: mergeStringLists(DEFAULT_SWARM_CONFIG.specialistRoleIds, raw.specialistRoleIds)
  };
}

function normalizeMemoryPolicy(input) {
  const raw = toObject(input?.memoryPolicy);
  return {
    mode: normalizeString(raw.mode) || DEFAULT_MEMORY_POLICY.mode,
    writeback: raw.writeback !== false,
    includePriorPackets: raw.includePriorPackets !== false,
    includeRoleNotes: raw.includeRoleNotes !== false,
    maxSharedItems: Number.isFinite(Number(raw.maxSharedItems)) && Number(raw.maxSharedItems) > 0 ? Math.min(16, Math.max(1, Math.floor(Number(raw.maxSharedItems)))) : DEFAULT_MEMORY_POLICY.maxSharedItems,
    maxRoleItems: Number.isFinite(Number(raw.maxRoleItems)) && Number(raw.maxRoleItems) > 0 ? Math.min(8, Math.max(1, Math.floor(Number(raw.maxRoleItems)))) : DEFAULT_MEMORY_POLICY.maxRoleItems
  };
}

function hashPlanText(markdown) {
  return sha256(normalizeString(markdown)).slice(0, 16);
}

function listToMarkdown(items) {
  return items.filter(Boolean).map((item) => `- ${item}`).join("\n");
}

function buildGeneratedDraftPlanMarkdown(docket, fingerprint) {
  const summary = docket.whyNow
    ? `${docket.objective} because ${docket.whyNow}`
    : `Refine a planning-only path for ${docket.objective}.`;
  const orderedExecutionSequence = [
    `Clarify scope and affected systems for ${docket.objective}.`,
    ...docket.affectedSystems.slice(0, 3).map((system) => `Verify dependency and ownership assumptions for ${system}.`),
    "Add validation gates before any implementation work.",
    fingerprint.stakes === "critical"
      ? "Isolate high-stakes objections and required human approvals."
      : "Capture the highest-risk objections and fallback paths.",
    "Hand off the upgraded plan for explicit human arbitration."
  ];
  const failureModes = mergeStringLists(
    fingerprint.failureSurfaces.map((surface) => `Failure surface: ${surface}`),
    docket.unknowns.slice(0, 4).map((unknown) => `Unknown dependency: ${unknown}`)
  );
  const validationGates = mergeStringLists(
    docket.successCriteria.map((criterion) => `Validate: ${criterion}`),
    fingerprint.humanApprovalsLikelyRequired.map((approval) => `Human approval: ${approval}`)
  );
  const requiredHumanDecisions = mergeStringLists(
    docket.unknowns.slice(0, 3).map((unknown) => `Confirm unresolved planning decision: ${unknown}`),
    fingerprint.humanApprovalsLikelyRequired.map((approval) => `Approve ${approval} before implementation starts.`)
  );
  const assumptions = docket.assumptions.map((entry) => `${entry.statement} (${entry.evidenceLabel})`);
  return [
    "# Upgraded Draft Plan",
    "",
    "## Summary",
    summary,
    "",
    "## Ordered Execution Sequence",
    listToMarkdown(orderedExecutionSequence),
    "",
    "## Validation Gates",
    listToMarkdown(validationGates),
    "",
    "## Failure Modes",
    listToMarkdown(failureModes),
    "",
    "## Required Human Decisions",
    listToMarkdown(requiredHumanDecisions),
    "",
    "## Open Questions",
    listToMarkdown(docket.unknowns),
    "",
    "## Assumptions",
    listToMarkdown(assumptions.length > 0 ? assumptions : ["No explicit assumptions were captured in the intake."])
  ].join("\n");
}

function hasStructuredPlanMarkdown(markdown) {
  return (normalizeString(markdown).match(/^##\s+/gm) ?? []).length >= 3;
}

function buildCanonicalDraftPlanMarkdown(docket, fingerprint) {
  const draftPlanAnalysis = toObject(docket?.draftPlan?.analysis);
  const summary = normalizeString(draftPlanAnalysis.summary)
    || normalizeString(draftPlanAnalysis.objective)
    || (docket.whyNow ? `${docket.objective} because ${docket.whyNow}` : `Normalize the provided draft for ${docket.objective}.`);
  const orderedExecutionSequence = mergeStringLists(
    draftPlanAnalysis.steps,
    docket.affectedSystems.slice(0, 2).map((system) => `Verify scope, dependencies, and ownership for ${system}.`),
    [
      "Clarify unresolved sequencing or scope assumptions before execution handoff.",
      "Lock explicit validation gates and fallback paths.",
      "Route unresolved policy or value choices to human arbitration."
    ]
  );
  const validationGates = mergeStringLists(
    draftPlanAnalysis.validationGates,
    docket.successCriteria.map((criterion) => `Validate: ${criterion}`),
    fingerprint.humanApprovalsLikelyRequired.map((approval) => `Human approval: ${approval}`)
  );
  const failureModes = mergeStringLists(
    draftPlanAnalysis.risks,
    fingerprint.failureSurfaces.map((surface) => `Failure surface: ${surface}`),
    docket.unknowns.slice(0, 3).map((unknown) => `Unknown dependency: ${unknown}`)
  );
  const requiredHumanDecisions = mergeStringLists(
    draftPlanAnalysis.requiredHumanDecisions,
    fingerprint.humanApprovalsLikelyRequired.map((approval) => `Approve ${approval} before implementation starts.`),
    docket.unknowns.slice(0, 2).map((unknown) => `Clarify unresolved planning choice: ${unknown}`)
  );
  const openQuestions = mergeStringLists(draftPlanAnalysis.openQuestions, docket.unknowns);
  const assumptions = docket.assumptions.map((entry) => `${entry.statement} (${entry.evidenceLabel})`);
  return [
    "# Upgraded Draft Plan",
    "",
    "## Summary",
    summary,
    "",
    "## Ordered Execution Sequence",
    listToMarkdown(orderedExecutionSequence.length > 0 ? orderedExecutionSequence : ["Capture a clearer ordered sequence before execution handoff."]),
    "",
    "## Validation Gates",
    listToMarkdown(validationGates.length > 0 ? validationGates : ["Add explicit validation gates before implementation begins."]),
    "",
    "## Failure Modes",
    listToMarkdown(failureModes.length > 0 ? failureModes : ["No failure modes were captured in the original draft."]),
    "",
    "## Required Human Decisions",
    listToMarkdown(requiredHumanDecisions.length > 0 ? requiredHumanDecisions : ["Decide whether the normalized draft is specific enough to proceed."]),
    "",
    "## Open Questions",
    listToMarkdown(openQuestions.length > 0 ? openQuestions : ["No open questions were extracted from the original draft."]),
    "",
    "## Assumptions",
    listToMarkdown(assumptions.length > 0 ? assumptions : ["No explicit assumptions were captured in the intake."])
  ].join("\n");
}

function buildInitialPlanMarkdown(docket, fingerprint) {
  const draftMarkdown = normalizeString(docket?.draftPlan?.analysis?.text);
  if (!draftMarkdown) return buildGeneratedDraftPlanMarkdown(docket, fingerprint);
  return hasStructuredPlanMarkdown(draftMarkdown) ? draftMarkdown : buildCanonicalDraftPlanMarkdown(docket, fingerprint);
}

function parsePlanSections(markdown) {
  const sections = new Map();
  let current = "Summary";
  const lines = normalizeString(markdown).split(/\r?\n/);
  for (const line of lines) {
    if (/^#\s+/.test(line)) continue;
    const heading = line.match(/^##\s+(.+)$/);
    if (heading?.[1]) {
      current = heading[1].trim();
      if (!sections.has(current)) sections.set(current, []);
      continue;
    }
    if (!sections.has(current)) sections.set(current, []);
    sections.get(current).push(line);
  }
  return sections;
}

function renderPlanFromSections(sections) {
  const orderedSectionNames = ["Summary", "Ordered Execution Sequence", "Validation Gates", "Failure Modes", "Required Human Decisions", "Open Questions", "Assumptions", "Dissent"];
  return [
    "# Upgraded Council Plan",
    "",
    ...orderedSectionNames.flatMap((sectionName) => {
      const lines = sections.get(sectionName);
      if (!lines || lines.length === 0) return [];
      return [`## ${sectionName}`, ...lines, ""];
    })
  ].join("\n").trim();
}

function inferSourceType(input) {
  if (normalizeString(input?.sourceType)) return normalizeString(input.sourceType);
  if (input?.draftPlan) return "draft-plan";
  if (input?.planningBrief) return "planning-brief";
  return "raw-request";
}

function inferObjective(input, docketInput, request, draftPlanAnalysis = {}) {
  return (
    normalizeString(docketInput.objective) ||
    normalizeString(input.objective) ||
    normalizeString(docketInput.title) ||
    normalizeString(input.title) ||
    normalizeString(draftPlanAnalysis.objective) ||
    request ||
    "Unspecified planning objective"
  );
}

function inferWhyNow(input, docketInput, draftPlanAnalysis = {}) {
  return normalizeString(docketInput.whyNow) || normalizeString(input.whyNow) || normalizeString(draftPlanAnalysis.whyNow) || "";
}

function inferDomainFromText(text) {
  const normalized = text.toLowerCase();
  if (/payment|billing|finance|charge|refund/.test(normalized)) return "finance";
  if (/security|auth|privacy|secret|permission/.test(normalized)) return "security";
  if (/migration|infra|postgres|redis|deployment|rollback/.test(normalized)) return "platform";
  if (/customer|support|ux|community/.test(normalized)) return "customer";
  if (/role|agent|planning council|governance/.test(normalized)) return "governance";
  return "general";
}

function inferReversibility(constraints, text) {
  const haystack = `${constraints.join(" ")} ${text}`.toLowerCase();
  if (/irreversible|destructive|one-way/.test(haystack)) return "hard_to_reverse";
  if (/rollback|read-only|staged|reversible/.test(haystack)) return "reversible";
  return "partially_reversible";
}

function ensureGovernanceFile(repoRoot, governanceDir, fileName) {
  return resolve(repoRoot, governanceDir, fileName);
}

export function loadPlanningGovernance(repoRoot, governanceDir = DEFAULT_PLANNING_GOVERNANCE_DIR) {
  return {
    planningDir: resolve(repoRoot, governanceDir),
    schemaPath: resolve(repoRoot, DEFAULT_PLANNING_SCHEMA_PATH),
    stakeholderOntology: readJson(ensureGovernanceFile(repoRoot, governanceDir, "stakeholder-ontology.json")),
    seatRules: readJson(ensureGovernanceFile(repoRoot, governanceDir, "council-seat-rules.json")),
    auditorRules: readJson(ensureGovernanceFile(repoRoot, governanceDir, "council-auditor-rules.json")),
    evidenceGrading: readJson(ensureGovernanceFile(repoRoot, governanceDir, "evidence-grading.json")),
    roleQualityRubric: readJson(ensureGovernanceFile(repoRoot, governanceDir, "role-quality-rubric.json")),
    stopConditions: readJson(ensureGovernanceFile(repoRoot, governanceDir, "stop-conditions.json")),
    roleSources: readJson(ensureGovernanceFile(repoRoot, governanceDir, "role-sources.allowlist.json")),
    curatedRoleManifests: readJson(ensureGovernanceFile(repoRoot, governanceDir, "curated-role-manifests.json"))
  };
}

export function validatePlanningGovernance(repoRoot, governance) {
  const findings = [];
  const schemaExists = existsSync(governance.schemaPath);
  if (!schemaExists) {
    findings.push({
      severity: "error",
      type: "missing-schema",
      file: relative(repoRoot, governance.schemaPath).replaceAll("\\", "/"),
      message: "Planning schema contract is missing."
    });
  }

  const stakeholderClasses = new Set(
    (governance.stakeholderOntology?.stakeholders ?? []).map((entry) => normalizeString(entry.stakeholderClass)).filter(Boolean)
  );
  const roleIds = new Set(
    (governance.curatedRoleManifests?.roles ?? []).map((entry) => normalizeString(entry.roleId)).filter(Boolean)
  );

  for (const seat of [...(governance.seatRules?.baselineSeats ?? []), ...(governance.seatRules?.conditionalSeats ?? [])]) {
    if (!roleIds.has(normalizeString(seat.roleId))) {
      findings.push({
        severity: "error",
        type: "missing-role",
        file: ".governance/planning/council-seat-rules.json",
        message: `Seat ${seat.seatName} references missing role ${seat.roleId}.`
      });
    }
    if (!stakeholderClasses.has(normalizeString(seat.stakeholderClass))) {
      findings.push({
        severity: "error",
        type: "missing-stakeholder",
        file: ".governance/planning/council-seat-rules.json",
        message: `Seat ${seat.seatName} references missing stakeholder ${seat.stakeholderClass}.`
      });
    }
  }

  for (const role of governance.curatedRoleManifests?.roles ?? []) {
    const missing = ["roleId", "roleName", "purpose", "goal", "instructions", "tools", "memoryAccess", "collaborationBehavior", "stakeholderLenses", "activationTriggers", "abstentionConditions", "objectionClasses", "evidenceStandards", "provenance"]
      .filter((field) => {
        const value = role[field];
        if (Array.isArray(value)) return value.length === 0;
        if (value && typeof value === "object") return Object.keys(value).length === 0;
        return !normalizeString(value);
      });
    if (missing.length > 0) {
      findings.push({
        severity: "error",
        type: "invalid-role-manifest",
        file: ".governance/planning/curated-role-manifests.json",
        message: `Role ${role.roleId} is missing required fields: ${missing.join(", ")}.`
      });
    }
  }

  const errors = findings.filter((finding) => finding.severity === "error").length;
  const warnings = findings.filter((finding) => finding.severity === "warning").length;
  return {
    status: errors > 0 ? "fail" : "pass",
    summary: {
      schemaExists,
      stakeholderCount: stakeholderClasses.size,
      curatedRoleCount: roleIds.size,
      sourceCount: (governance.roleSources?.sources ?? []).length,
      errors,
      warnings
    },
    findings
  };
}

function scorePresence(fieldValue) {
  if (Array.isArray(fieldValue)) return fieldValue.length > 0 ? 1 : 0;
  if (fieldValue && typeof fieldValue === "object") return Object.keys(fieldValue).length > 0 ? 1 : 0;
  return normalizeString(fieldValue) ? 1 : 0;
}

export function computeRoleQualityScores(manifest, rubric) {
  const structuralChecks = rubric?.structuralChecks ?? [];
  const governanceChecks = rubric?.governanceChecks ?? [];
  const swarmChecks = rubric?.swarmUsabilityChecks ?? [];

  const structuralQualityScore =
    structuralChecks.reduce((sum, field) => sum + scorePresence(manifest[field]), 0) / Math.max(1, structuralChecks.length);
  const governanceQualityScore =
    governanceChecks.reduce((sum, field) => sum + scorePresence(manifest[field]), 0) / Math.max(1, governanceChecks.length);
  const swarmSignals = [
    Array.isArray(manifest.instructions) && manifest.instructions.length > 0 ? 1 : 0,
    Array.isArray(manifest.expectedOutputs) && manifest.expectedOutputs.length > 0 ? 1 : 0,
    Array.isArray(manifest.abstentionConditions) && manifest.abstentionConditions.length > 0 ? 1 : 0,
    Array.isArray(manifest.objectionClasses) && manifest.objectionClasses.length > 0 ? 1 : 0
  ];
  const swarmUsabilityScore = swarmSignals.reduce((sum, value) => sum + value, 0) / Math.max(1, swarmChecks.length || swarmSignals.length);

  return {
    structuralQualityScore: Number(structuralQualityScore.toFixed(3)),
    governanceQualityScore: Number(governanceQualityScore.toFixed(3)),
    swarmUsabilityScore: Number(swarmUsabilityScore.toFixed(3))
  };
}

export function buildRoleSourceSync(governance, options = {}) {
  const generatedAt = options.now ?? new Date().toISOString();
  const snapshots = [];
  const extractedCandidates = [];

  for (const source of governance.roleSources?.sources ?? []) {
    const snapshotId = buildId("role_snapshot", { sourceId: source.sourceId, ref: source?.provenance?.ref, generatedAt });
    snapshots.push({
      snapshotId,
      sourceId: source.sourceId,
      capturedAt: generatedAt,
      status: source.status,
      extractionMode: source?.extraction?.mode ?? "catalog",
      provenance: source.provenance,
      notes: source?.extraction?.notes ?? ""
    });

    for (const signal of source.sampleRoleSignals ?? []) {
      extractedCandidates.push({
        candidateId: buildId("role_candidate", { sourceId: source.sourceId, roleName: signal.roleName }),
        snapshotId,
        sourceId: source.sourceId,
        roleName: signal.roleName,
        purpose: signal.purpose,
        stakeholderLenses: normalizeStringList(signal.stakeholderLenses),
        domainTags: normalizeStringList(signal.domainTags),
        status: source.status === "allowlisted" ? "candidate" : "reference",
        provenance: {
          repoUrl: source?.provenance?.repoUrl ?? "",
          ref: source?.provenance?.ref ?? "",
          extractionMode: source?.extraction?.mode ?? "catalog"
        }
      });
    }
  }

  return {
    generatedAt,
    sources: governance.roleSources?.sources ?? [],
    snapshots,
    extractedCandidates
  };
}

export function buildRoleScoreReport(governance, extractedCandidates = [], options = {}) {
  const generatedAt = options.now ?? new Date().toISOString();
  const rubric = governance.roleQualityRubric ?? {};
  const curatedScores = (governance.curatedRoleManifests?.roles ?? []).map((role) => ({
    scoreId: buildId("role_score", { roleId: role.roleId, generatedAt }),
    subjectType: "role-manifest",
    roleId: role.roleId,
    ...computeRoleQualityScores(role, rubric)
  }));

  const candidateScores = extractedCandidates.map((candidate) => {
    const candidateManifestLike = {
      purpose: candidate.purpose,
      goal: candidate.purpose,
      instructions: [candidate.purpose],
      tools: [],
      memoryAccess: { mode: "bounded" },
      collaborationBehavior: { style: "reference" },
      expectedInputs: ["source-corpus"],
      expectedOutputs: ["role candidate"],
      stakeholderLenses: candidate.stakeholderLenses,
      activationTriggers: candidate.domainTags,
      abstentionConditions: ["uncurated_candidate"],
      objectionClasses: ["source-material-only"],
      evidenceStandards: ["requires curation"],
      provenance: candidate.provenance
    };
    return {
      scoreId: buildId("role_score", { candidateId: candidate.candidateId, generatedAt }),
      subjectType: "role-candidate",
      candidateId: candidate.candidateId,
      ...computeRoleQualityScores(candidateManifestLike, rubric)
    };
  });

  return { generatedAt, curatedScores, candidateScores };
}

export function normalizePlanningDocket(input, options = {}) {
  const sourceType = inferSourceType(input);
  const docketInput = toObject(input?.docket);
  const request = normalizeString(input?.request);
  const draftPlanAnalysis = analyzeDraftPlan(input?.draftPlan);
  const objective = inferObjective(input, docketInput, request, draftPlanAnalysis);
  const successCriteria = mergeStringLists(docketInput.successCriteria, input?.successCriteria, draftPlanAnalysis.successCriteria, [
    "Objective is translated into an explicit ordered plan",
    "Major risks are surfaced",
    "Required human decisions are isolated"
  ]);
  const constraints = mergeStringLists(docketInput.constraints, input?.constraints, draftPlanAnalysis.constraints, ["Planning-only"]);
  const knownFacts = mergeStringLists(docketInput.knownFacts, input?.knownFacts, draftPlanAnalysis.knownFacts);
  const unknowns = mergeStringLists(docketInput.unknowns, input?.unknowns, draftPlanAnalysis.openQuestions);
  const assumptions = normalizeAssumptions(docketInput.assumptions ?? input?.assumptions);
  const affectedSystems = mergeStringLists(docketInput.affectedSystems, input?.affectedSystems, draftPlanAnalysis.affectedSystems);
  const whyNow = inferWhyNow(input, docketInput, draftPlanAnalysis);
  const draftPlanText = normalizeString(draftPlanAnalysis.text);
  const domain = normalizeString(docketInput.domain) || inferDomainFromText(`${objective} ${whyNow} ${request} ${draftPlanText}`);
  const humanPriorities = mergeStringLists(docketInput.humanPriorities, input?.humanPriorities, draftPlanAnalysis.humanPriorities);
  const initialEvidence = normalizeStringList(docketInput.initialEvidence ?? input?.initialEvidence);
  const budgetTimeSensitivity = normalizeString(docketInput.budgetTimeSensitivity ?? input?.budgetTimeSensitivity) || "medium";
  const reversibility = normalizeString(docketInput.reversibility ?? input?.reversibility) || inferReversibility(constraints, `${objective} ${whyNow} ${request} ${draftPlanText}`);
  const createdAt = options.now ?? new Date().toISOString();
  const swarmConfig = normalizeSwarmConfig(input);
  const memoryPolicy = normalizeMemoryPolicy(input);
  const reviewMode = normalizeString(input?.reviewMode) || "auto";
  const draftSource = normalizeString(input?.draftSource) || (input?.draftPlan ? "explicit_draft" : "prompt_generated");
  const priorPacketIds = normalizeStringList(input?.priorPacketIds);

  return {
    docketId: buildId("planning_docket", { sourceType, objective, affectedSystems, createdAt }),
    createdAt,
    requestedBy: normalizeString(input?.requestedBy) || "unknown-requestor",
    tenantId: normalizeString(input?.tenantId) || "monsoonfire-main",
    sourceType,
    objective,
    whyNow,
    successCriteria,
    constraints,
    knownFacts,
    unknowns,
    assumptions,
    budgetTimeSensitivity,
    reversibility,
    domain,
    affectedSystems,
    humanPriorities,
    requestedDeadline: normalizeString(docketInput.requestedDeadline ?? input?.requestedDeadline) || null,
    initialEvidence,
    reviewMode,
    draftSource,
    swarmConfig,
    memoryPolicy,
    memoryPolicyMode: memoryPolicy.mode,
    priorPacketIds,
    rawRequest: request || draftPlanText,
    draftPlan: input?.draftPlan ? {
      raw: input.draftPlan,
      analysis: draftPlanAnalysis
    } : null,
    metadata: toObject(input?.metadata)
  };
}

function detectTouchpoints(docket) {
  const text = [
    docket.rawRequest,
    docket.objective,
    docket.whyNow,
    ...docket.constraints,
    ...docket.knownFacts,
    ...docket.unknowns,
    ...docket.affectedSystems
  ].join(" ");
  const touchpoints = [];
  for (const [touchpoint, patterns] of Object.entries(TOUCHPOINT_PATTERNS)) {
    if (patterns.some((pattern) => pattern.test(text))) touchpoints.push(touchpoint);
  }
  return [...new Set(touchpoints)];
}

export function fingerprintPlanningDocket(docket, options = {}) {
  const touchpoints = detectTouchpoints(docket);
  const rawRequest = normalizeString(docket.rawRequest).toLowerCase();
  const requestWordCount = countWords(docket.rawRequest);
  const genericRequest = /\b(help me plan|plan this|need a plan|figure this out)\b/.test(rawRequest)
    || (/\b(this|thing|something|stuff)\b/.test(rawRequest) && requestWordCount <= 8);
  const explicitContextCount = docket.knownFacts.length
    + docket.affectedSystems.length
    + docket.initialEvidence.length
    + docket.unknowns.length
    + docket.assumptions.length
    + (docket.whyNow ? 1 : 0)
    + (docket.draftPlan ? 2 : 0);
  const intakeCompleteness = !docket.draftPlan && explicitContextCount === 0 && genericRequest && requestWordCount <= 8
    ? "thin"
    : explicitContextCount >= 5
      ? "rich"
      : explicitContextCount >= 2
        ? "moderate"
        : "light";
  const stakes = touchpoints.some((entry) => ["security", "auth", "payments", "compliance", "privacy", "trust-safety"].includes(entry))
    ? "critical"
    : touchpoints.some((entry) => ["reliability", "infra", "customer", "platform"].includes(entry))
      ? "high"
      : docket.unknowns.length > 4
        ? "medium"
        : "low";
  const ambiguityLevel = intakeCompleteness === "thin" || docket.unknowns.length > 4 || docket.assumptions.length > 5
    ? "high"
    : docket.unknowns.length > 1 || (intakeCompleteness === "light" && genericRequest)
      ? "medium"
      : "low";
  const noveltyLevel = touchpoints.includes("novelty") || docket.knownFacts.length === 0 ? "high" : docket.knownFacts.length < 3 ? "medium" : "low";
  const safetySecuritySensitivity = touchpoints.some((entry) => ["security", "auth", "privacy", "trust-safety"].includes(entry)) ? "critical" : "low";
  const costSensitivity = touchpoints.some((entry) => ["payments", "cost"].includes(entry)) ? "high" : "medium";
  const operationalImpact = touchpoints.some((entry) => ["operations", "reliability", "platform", "infra"].includes(entry)) ? "high" : "medium";
  const userCustomerImpact = touchpoints.some((entry) => ["customer", "support", "trust-safety"].includes(entry)) ? "high" : "low";
  const highRiskHumanImpact = touchpoints.includes("trust-safety") || (touchpoints.includes("privacy") && userCustomerImpact === "high");
  const dependencies = [...new Set(docket.affectedSystems.map((entry) => entry.split("/")[0]).filter(Boolean))];
  const failureSurfaces = [...new Set([
    touchpoints.includes("reliability") ? "rollback-or-recovery" : "",
    touchpoints.includes("auth") ? "authorization-regression" : "",
    touchpoints.includes("payments") ? "billing-or-cost-drift" : "",
    touchpoints.includes("privacy") ? "data-handling-mismatch" : "",
    touchpoints.includes("customer") ? "support-or-customer-confusion" : "",
    dependencies.length > 1 ? "cross-system-coordination" : ""
  ].filter(Boolean))];
  const humanApprovalsLikelyRequired = [...new Set([
    touchpoints.includes("compliance") ? "compliance-owner" : "",
    touchpoints.includes("security") ? "security-owner" : "",
    touchpoints.includes("payments") ? "finance-owner" : "",
    stakes === "critical" ? "final-human-arbitration" : ""
  ].filter(Boolean))];
  const evidenceDepthRequired = stakes === "critical" || ambiguityLevel === "high" ? "deep" : stakes === "high" ? "standard" : "light";
  const createdAt = options.now ?? docket.createdAt ?? new Date().toISOString();

  return {
    fingerprintId: buildId("plan_fingerprint", { docketId: docket.docketId, touchpoints, createdAt }),
    docketId: docket.docketId,
    createdAt,
    planType: docket.sourceType === "draft-plan" ? "review-existing" : "greenfield",
    domain: docket.domain,
    stakes,
    reversibility: docket.reversibility,
    ambiguityLevel,
    intakeCompleteness,
    genericRequest,
    requestWordCount,
    noveltyLevel,
    safetySecuritySensitivity,
    costSensitivity,
    operationalImpact,
    userCustomerImpact,
    highRiskHumanImpact,
    touchpoints,
    affectedSystems: docket.affectedSystems,
    dependencies,
    failureSurfaces,
    humanApprovalsLikelyRequired,
    evidenceDepthRequired
  };
}

function stakeholderTriggerMatches(stakeholder, fingerprint) {
  const triggers = normalizeStringList(stakeholder.triggerTouchpoints);
  if (triggers.includes("always")) return { matched: true, basis: ["always"] };
  const basis = triggers.filter((entry) => fingerprint.touchpoints.includes(entry));
  return { matched: basis.length > 0, basis };
}

export function inferStakeholders(docket, fingerprint, governance, options = {}) {
  const now = options.now ?? docket.createdAt ?? new Date().toISOString();
  const inferences = [];
  const pushStakeholder = (stakeholderClass, relevanceReason, triggerBasis, omissionRisk, mandatoryOrConditional, directness = "direct", confidenceScore = 0.85) => {
    inferences.push({
      inferenceId: buildId("stakeholder", { docketId: docket.docketId, stakeholderClass, triggerBasis }),
      docketId: docket.docketId,
      fingerprintId: fingerprint.fingerprintId,
      createdAt: now,
      stakeholderClass,
      relevanceReason,
      triggerBasis,
      omissionRisk,
      confidenceScore,
      mandatoryOrConditional,
      directness
    });
  };

  for (const stakeholder of governance.stakeholderOntology?.stakeholders ?? []) {
    const match = stakeholderTriggerMatches(stakeholder, fingerprint);
    if (!match.matched) continue;
    const mandatory = ["requester-sponsor", "future-executor"].includes(stakeholder.stakeholderClass)
      || (fingerprint.stakes === "critical" && ["security-owner", "privacy-data-owner", "compliance-legal-owner"].includes(stakeholder.stakeholderClass));
    pushStakeholder(
      stakeholder.stakeholderClass,
      `Triggered by ${match.basis.join(", ")} touchpoints in the planning docket.`,
      match.basis,
      stakeholder.omissionRisk,
      mandatory ? "mandatory" : "conditional",
      match.basis.includes("always") ? "direct" : "indirect",
      mandatory ? 0.95 : 0.78
    );
  }

  if (fingerprint.userCustomerImpact === "high" && !inferences.some((row) => row.stakeholderClass === "support-owner")) {
    pushStakeholder("support-owner", "If this fails badly, support will be asked to explain it even if they were not consulted.", ["failure-challenge"], "Customer-facing fallout may land on support without a preparation plan.", "conditional", "missing-likely", 0.72);
  }

  if (fingerprint.stakes === "high" && !inferences.some((row) => row.stakeholderClass === "rollback-recovery-owner")) {
    pushStakeholder("rollback-recovery-owner", "High-stakes or infra-heavy work needs an explicit recovery perspective.", ["failure-challenge"], "The plan may be unable to stop safely when assumptions fail.", "conditional", "missing-likely", 0.76);
  }

  return inferences;
}

function selectRole(roleId, governance) {
  return (governance.curatedRoleManifests?.roles ?? []).find((entry) => entry.roleId === roleId) ?? null;
}

export function buildCouncilAssembly(docket, fingerprint, governance, options = {}) {
  const now = options.now ?? docket.createdAt ?? new Date().toISOString();
  const stakeholders = inferStakeholders(docket, fingerprint, governance, { now });
  const scores = buildRoleScoreReport(governance, [], { now }).curatedScores;
  const scoreByRoleId = new Map(scores.map((entry) => [entry.roleId, entry]));
  const seats = [];
  const seenSeatNames = new Set();
  const councilId = buildId("planning_council", { docketId: docket.docketId, fingerprintId: fingerprint.fingerprintId, now });

  const pushSeat = (seatRule, triggerBasis) => {
    if (seenSeatNames.has(seatRule.seatName)) return;
    const role = selectRole(seatRule.roleId, governance);
    if (!role) return;
    const score = scoreByRoleId.get(seatRule.roleId) ?? {
      structuralQualityScore: 0.7,
      governanceQualityScore: 0.7,
      swarmUsabilityScore: 0.7
    };
    seenSeatNames.add(seatRule.seatName);
    seats.push({
      seatId: buildId("council_seat", { councilId, seatName: seatRule.seatName }),
      councilId,
      createdAt: now,
      seatName: seatRule.seatName,
      stakeholderRepresented: seatRule.stakeholderClass,
      selectedRoleId: seatRule.roleId,
      selectionRationale: `Selected from curated manifests to represent ${seatRule.stakeholderClass}.`,
      triggerBasis,
      confidenceScore: Number(((score.structuralQualityScore + score.governanceQualityScore + score.swarmUsabilityScore) / 3).toFixed(3)),
      mandatoryOrConditional: seatRule.mandatory ? "mandatory" : "conditional",
      overlapNotes: []
    });
  };

  for (const baseline of governance.seatRules?.baselineSeats ?? []) pushSeat(baseline, ["baseline"]);
  for (const seatRule of governance.seatRules?.conditionalSeats ?? []) {
    const triggerBasis = normalizeStringList(seatRule.whenAnyTouchpoints).filter((entry) => fingerprint.touchpoints.includes(entry));
    if (triggerBasis.length > 0) pushSeat(seatRule, triggerBasis);
  }

  const stakeholderClasses = new Set(stakeholders.filter((row) => row.mandatoryOrConditional === "mandatory").map((row) => row.stakeholderClass));
  for (const stakeholderClass of stakeholderClasses) {
    if (seats.some((seat) => seat.stakeholderRepresented === stakeholderClass)) continue;
    const candidate = [...(governance.seatRules?.conditionalSeats ?? []), ...(governance.seatRules?.baselineSeats ?? [])].find((seat) => seat.stakeholderClass === stakeholderClass);
    if (candidate) pushSeat(candidate, ["auditor:auto-added"]);
  }

  const redundantStakeholders = [];
  for (const seat of seats) {
    const duplicates = seats.filter((row) => row.stakeholderRepresented === seat.stakeholderRepresented).length;
    if (duplicates > (governance.auditorRules?.flagRedundantStakeholderSeatCountAbove ?? 2)) {
      redundantStakeholders.push(seat.stakeholderRepresented);
    }
  }

  const missingCriticalStakeholders = normalizeStringList(governance.auditorRules?.criticalStakeholderClasses).filter((stakeholderClass) => {
    if (!fingerprint.touchpoints.some((entry) => ["security", "privacy", "compliance", "reliability", "infra"].includes(entry))) return false;
    return !seats.some((seat) => seat.stakeholderRepresented === stakeholderClass);
  });

  return {
    stakeholders,
    council: {
      councilId,
      docketId: docket.docketId,
      fingerprintId: fingerprint.fingerprintId,
      createdAt: now,
      status: "under_review",
      seatCount: seats.length,
      audit: {
        missingCriticalStakeholders,
        redundantStakeholders: [...new Set(redundantStakeholders)],
        overSeatLimit: seats.length > (governance.auditorRules?.maxRecommendedSeats ?? 10),
        legitimacyStatus: missingCriticalStakeholders.length === 0 ? "pass" : "needs-attention"
      }
    },
    seats,
    scores
  };
}

function buildReviewRounds(councilId, now, roundOrder = COUNCIL_SWARM_ROUND_ORDER) {
  const types = normalizeRoundOrder(roundOrder);
  return types.map((roundType, index) => ({
    roundId: buildId("review_round", { councilId, roundType }),
    councilId,
    createdAt: now,
    ordinal: index + 1,
    roundType,
    status: "completed",
    summary: `${roundType} round completed for council swarm planning review.`
  }));
}

function buildRoundPlan(docket, councilId, now, status = "pending") {
  const critiqueCycles = Math.max(1, Number(docket?.swarmConfig?.maxCritiqueCycles ?? DEFAULT_SWARM_CONFIG.maxCritiqueCycles));
  const plan = [];
  let ordinal = 1;
  const pushRound = (roundType, cycle = null) => {
    plan.push({
      roundId: buildId("review_round", { councilId, roundType, cycle: cycle ?? 0, ordinal }),
      councilId,
      createdAt: now,
      ordinal,
      roundType,
      cycle,
      status,
      summary: `${roundType}${cycle ? ` cycle ${cycle}` : ""} round ${status}.`
    });
    ordinal += 1;
  };

  pushRound("draft_capture");
  pushRound("memory_pack");
  for (let cycle = 1; cycle <= critiqueCycles; cycle += 1) {
    pushRound("parallel_critique", cycle);
    pushRound("planner_revision", cycle);
    pushRound("rebuttal", cycle);
  }
  pushRound("synthesis");
  pushRound("legitimacy_check");
  return plan;
}

function findSeat(seats, roleId, fallbackNames = []) {
  return seats.find((seat) => seat.selectedRoleId === roleId)
    ?? seats.find((seat) => fallbackNames.includes(seat.seatName))
    ?? seats[0]
    ?? null;
}

function pushReviewItem(reviewItems, council, seat, round, type, severity, statement, rationale, affectedPlanSection, requiredAction, triggerBasis) {
  if (!seat || !round) return;
  reviewItems.push({
    itemId: buildId("review_item", { councilId: council.councilId, seatId: seat.seatId, roundId: round.roundId, statement }),
    councilId: council.councilId,
    roundId: round.roundId,
    seatId: seat.seatId,
    seat: seat.seatName,
    stakeholderRepresented: seat.stakeholderRepresented,
    type,
    severity,
    statement,
    rationale,
    sourceBasis: triggerBasis,
    affectedPlanSection,
    requiredAction,
    confidenceScore: severity === "critical" ? 0.92 : severity === "high" ? 0.85 : 0.74
  });
}

function generateReviewItems(docket, fingerprint, councilBundle, now) {
  const reviewRounds = buildRoundPlan(docket, councilBundle.council.councilId, now, "completed");
  const reviewItems = [];
  const seats = councilBundle.seats;
  const findRound = (roundType, cycle = null) =>
    reviewRounds.find((entry) => entry.roundType === roundType && Number(entry.cycle ?? 0) === Number(cycle ?? 0))
    ?? reviewRounds.find((entry) => entry.roundType === roundType)
    ?? null;

  pushReviewItem(reviewItems, councilBundle.council, findSeat(seats, "lead-planner.v1"), findRound("draft_capture"), "required_revision", "medium", "Turn the objective into an explicit staged plan with validation gates.", "Non-trivial plans need a sequence that an implementer can follow without inventing order-of-operations decisions.", "recommended_plan", "Add phased sequencing with named gates before execution handoff.", ["baseline", docket.objective]);
  pushReviewItem(reviewItems, councilBundle.council, findSeat(seats, "skeptic-red-team.v1"), findRound("parallel_critique", 1), "objection", fingerprint.stakes === "critical" ? "critical" : "high", "The preferred path may be too optimistic about hidden dependencies and failure surfaces.", "High-stakes plans need an explicit challenge of the default path before they are trusted.", "options_considered", "Document a safer fallback or staged alternative for the highest-risk path.", ["stakes", ...fingerprint.failureSurfaces]);
  pushReviewItem(reviewItems, councilBundle.council, findSeat(seats, "evidence-marshal.v1"), findRound("memory_pack"), "evidence_gap", docket.unknowns.length > 2 ? "high" : "medium", "Major assumptions require explicit evidence labels and confidence notes.", "Unsupported assumptions should be visible before a human trusts the packet.", "assumptions_and_unknowns", "Label each assumption and isolate which ones need human confirmation.", ["unknowns", "assumptions"]);
  pushReviewItem(reviewItems, councilBundle.council, findSeat(seats, "reliability-reviewer.v1", ["Constraint Guardian"]), findRound("rebuttal", 1), "risk_note", fingerprint.reversibility === "hard_to_reverse" ? "critical" : "high", "Failure-path handling, rollback, and partial completion need to be explicit.", "A plan that cannot stop or recover safely is not execution-ready.", "failure_modes", "Define early warning signals plus rollback or recovery steps.", ["reliability", ...fingerprint.failureSurfaces]);
  pushReviewItem(reviewItems, councilBundle.council, findSeat(seats, "human-intent-interpreter.v1"), findRound("planner_revision", 1), "approval_with_conditions", "medium", "The packet is directionally correct if it keeps the human priorities visible and isolates final choices.", "Intent drift is most likely during cleanup and synthesis.", "required_human_decisions", "Keep unresolved value or policy choices in a separate human-decision section.", ["human_priorities"]);
  pushReviewItem(reviewItems, councilBundle.council, findSeat(seats, "synthesizer.v1"), findRound("synthesis"), "approval_with_conditions", "low", "Synthesis should preserve dissent and avoid smoothing over critical objections.", "The final packet must show both the plan and the legitimacy of the review process.", "dissent_and_process_legitimacy", "Carry unresolved objections and their resolution states into the final packet.", ["dissent", "ledger"]);

  if (fingerprint.intakeCompleteness === "thin") {
    pushReviewItem(reviewItems, councilBundle.council, findSeat(seats, "human-intent-interpreter.v1"), findRound("planner_revision", 1), "required_revision", "critical", "The intake is too ambiguous to turn into a trustworthy execution-ready plan yet.", "The swarm should not convert a placeholder request into an authoritative packet without clarified scope, stakeholders, and success criteria.", "required_human_decisions", "Request objective, scope, success criteria, and affected-system clarification before treating the packet as ready.", ["intake-thin", "ambiguity"]);
  }
  if (fingerprint.touchpoints.includes("security") || fingerprint.touchpoints.includes("auth")) {
    pushReviewItem(reviewItems, councilBundle.council, findSeat(seats, "security-reviewer.v1"), findRound("parallel_critique", 1), "objection", "critical", "Security-sensitive paths need explicit validation gates before implementation work begins.", "Auth, privilege, and secret handling are high-blast-radius surfaces.", "validation_gates", "Define security validation and required human signoff for sensitive paths.", ["security", "auth"]);
  }
  if (fingerprint.touchpoints.includes("privacy") || fingerprint.touchpoints.includes("data")) {
    pushReviewItem(reviewItems, councilBundle.council, findSeat(seats, "privacy-reviewer.v1"), findRound("memory_pack"), "evidence_gap", fingerprint.highRiskHumanImpact ? "critical" : "high", "Data provenance and retention assumptions require explicit handling.", "Unknown data handling creates durable plan risk.", "assumptions_and_unknowns", "Document data provenance, retention, and human confirmation points.", ["privacy", "data"]);
  }
  if (fingerprint.touchpoints.includes("trust-safety")) {
    pushReviewItem(reviewItems, councilBundle.council, findSeat(seats, "trust-safety-reviewer.v1"), findRound("parallel_critique", 1), "required_revision", "critical", "Trust-and-safety plans need explicit abuse-handling thresholds, escalation ownership, and human review gates.", "Sensitive user-impact paths should not rely on implicit moderation or escalation policy.", "validation_gates", "Define harm-review gates, escalation owners, and moderation boundaries before execution starts.", ["trust-safety", "customer"]);
  }
  if (fingerprint.touchpoints.includes("compliance")) {
    pushReviewItem(reviewItems, councilBundle.council, findSeat(seats, "compliance-reviewer.v1"), findRound("planner_revision", 1), "required_revision", "high", "Required policy or compliance approvals must be isolated before the packet is marked ready.", "Planning legitimacy depends on identifying approvals before execution starts.", "required_human_decisions", "List all required approvals and the exact human decision needed.", ["compliance"]);
  }
  if (fingerprint.touchpoints.includes("customer")) {
    pushReviewItem(reviewItems, councilBundle.council, findSeat(seats, "customer-reviewer.v1"), findRound("rebuttal", 1), "risk_note", "medium", "Customer-facing impact and support burden need explicit messaging and support prep.", "Support and customer confusion often show up after rollout unless planned for upfront.", "failure_modes", "Add customer-facing failure modes and support readiness notes.", ["customer", "support"]);
  }
  if (fingerprint.touchpoints.includes("payments") || fingerprint.touchpoints.includes("cost")) {
    pushReviewItem(reviewItems, councilBundle.council, findSeat(seats, "cost-scope-reviewer.v1"), findRound("planner_revision", 1), "alternative_proposal", "high", "Consider a smaller, lower-spend first slice if cost assumptions remain weak.", "Cost-sensitive plans should prefer a narrow reversible first move when uncertainty is high.", "options_considered", "Add a scoped alternative with lower cost or blast radius.", ["payments", "cost"]);
  }

  return { reviewRounds, reviewItems };
}

function buildObjectionLedger(reviewItems) {
  return reviewItems.map((item) => {
    let resolutionState = "adopted";
    if (normalizeString(item.findingStatus) === "still_blocked") {
      resolutionState = "requires_human_decision";
    } else if (item.requiresHumanDecision) {
      resolutionState = "requires_human_decision";
    } else if (normalizeString(item.findingStatus) === "partially_resolved") {
      resolutionState = "deferred";
    } else if (item.severity === "critical" && ["objection", "required_revision", "evidence_gap"].includes(item.type)) {
      resolutionState = "requires_human_decision";
    } else if (item.type === "risk_note") {
      resolutionState = "deferred";
    }
    return {
      ledgerId: buildId("objection_ledger", { itemId: item.itemId }),
      itemId: item.itemId,
      councilId: item.councilId,
      resolutionState,
      resolutionRationale:
        resolutionState === "requires_human_decision"
          ? "Critical objection preserved for human arbitration."
          : resolutionState === "deferred"
            ? "Risk recorded for downstream execution and monitoring."
            : "Planned to be incorporated into the synthesized packet."
    };
  });
}

function sectionNameForAffectedPlanSection(sectionName) {
  if (sectionName === "recommended_plan" || sectionName === "options_considered") return "Ordered Execution Sequence";
  if (sectionName === "validation_gates") return "Validation Gates";
  if (sectionName === "failure_modes") return "Failure Modes";
  if (sectionName === "required_human_decisions") return "Required Human Decisions";
  if (sectionName === "assumptions_and_unknowns") return "Assumptions";
  if (sectionName === "dissent_and_process_legitimacy") return "Dissent";
  return "Summary";
}

function buildRoleManifestMap(governance) {
  return new Map((governance.curatedRoleManifests?.roles ?? []).map((role) => [role.roleId, role]));
}

function normalizeContinuityState(value, fallback = "") {
  const normalized = normalizeString(value).toLowerCase();
  if (["ready", "blocked", "missing"].includes(normalized)) return normalized;
  return fallback;
}

function normalizeContinuityBlockers(value, maxItems = 6) {
  const rows = Array.isArray(value)
    ? value
    : normalizeString(value)
      ? [{ summary: normalizeString(value) }]
      : [];
  return rows
    .map((entry) => {
      const record = toObject(entry);
      const summary = clipText(
        normalizeString(record.summary || record.firstSignal || record.blocker || record.reason || entry),
        220
      );
      if (!summary) return null;
      const normalized = { summary };
      const reason = clipText(normalizeString(record.reason), 160);
      const unblockStep = clipText(normalizeString(record.unblockStep), 200);
      if (reason) normalized.reason = reason;
      if (unblockStep) normalized.unblockStep = unblockStep;
      return normalized;
    })
    .filter(Boolean)
    .slice(0, maxItems);
}

function continuitySourceKind(entry, metadata = toObject(entry?.metadata)) {
  const explicit = normalizeString(entry?.memoryKind || entry?.kind || metadata.kind).toLowerCase();
  const source = normalizeString(entry?.source).toLowerCase();
  const schema = normalizeString(metadata.schema).toLowerCase();
  const tags = normalizeStringList(entry?.tags).map((tag) => tag.toLowerCase());
  if (explicit === "continuity-summary") return "continuity-summary";
  if (CONTINUITY_MEMORY_SOURCES.has(source)) return source;
  if (CONTINUITY_MEMORY_SCHEMAS.has(schema)) return schema;
  if (explicit === "handoff" || explicit === "startup-blocker") return explicit;
  if (tags.includes("handoff")) return "handoff";
  if (tags.includes("startup-blocker")) return "startup-blocker";
  if (tags.includes("continuity")) return "continuity";
  return "";
}

function isContinuityMemoryEntry(entry) {
  return Boolean(continuitySourceKind(entry));
}

function buildContinuityLineage(entry, metadata = toObject(entry?.metadata)) {
  return Object.fromEntries(
    Object.entries({
      threadId: normalizeString(metadata.threadId || entry?.threadId),
      runId: normalizeString(metadata.runId),
      parentRunId: normalizeString(metadata.parentRunId),
      agentId: normalizeString(metadata.agentId),
      handoffOwner: normalizeString(metadata.handoffOwner || metadata.owner),
    }).filter(([, value]) => value)
  );
}

function buildContinuityProjection(ref) {
  const metadata = toObject(ref?.metadata);
  const sourceKind = continuitySourceKind(ref, metadata) || normalizeString(ref?.source).toLowerCase();
  const blockedSource = sourceKind.includes("startup-blocker");
  const handoffSource = sourceKind.includes("handoff");
  const blockers = normalizeContinuityBlockers(metadata.blockers ?? metadata.blocker);
  const continuityState = normalizeContinuityState(
    metadata.continuityState || metadata.startup?.continuityState || (blockedSource ? metadata.status : ""),
    blockedSource ? "blocked" : handoffSource ? "ready" : ""
  );
  return {
    kind: "continuity-summary",
    continuityState,
    activeGoal: clipText(normalizeString(metadata.currentGoal || metadata.activeGoal), 200),
    lastHandoffSummary: clipText(
      normalizeString(metadata.lastHandoffSummary || metadata.summary || ref?.summary),
      240
    ),
    blockers,
    nextRecommendedAction: clipText(
      normalizeString(metadata.nextRecommendedAction || metadata.unblockStep),
      220
    ),
    lineage: buildContinuityLineage(ref, metadata),
    sourceKind: clipText(sourceKind, 80),
  };
}

function buildContinuitySummary(ref, projection) {
  const parts = [];
  if (projection.continuityState) parts.push(`continuity ${projection.continuityState}`);
  if (projection.activeGoal) parts.push(`goal: ${projection.activeGoal}`);
  if (projection.lastHandoffSummary) parts.push(`handoff: ${projection.lastHandoffSummary}`);
  if (projection.blockers.length > 0) parts.push(`blocker: ${projection.blockers[0].summary}`);
  if (projection.nextRecommendedAction) parts.push(`next: ${projection.nextRecommendedAction}`);
  return clipText(parts.join(" | ") || normalizeString(ref?.summary) || "Continuity context available.", 360);
}

function projectCouncilSafeMemoryRef(refInput) {
  const ref = toObject(refInput);
  const metadata = toObject(ref.metadata);
  const tags = normalizeStringList(ref.tags);
  if (!isContinuityMemoryEntry({ ...ref, metadata, tags })) {
    return {
      ...ref,
      tags,
      metadata,
    };
  }
  const projection = buildContinuityProjection({ ...ref, metadata, tags });
  const continuityTags = [
    "continuity-summary",
    projection.continuityState ? `continuity-${projection.continuityState}` : "",
  ];
  return {
    ...ref,
    kind: normalizeString(ref.kind) || "memory-pack-item",
    memoryKind: "continuity-summary",
    label: normalizeString(ref.label) || (projection.activeGoal ? `Continuity: ${projection.activeGoal}` : "Continuity context"),
    summary: buildContinuitySummary(ref, projection),
    tags: mergeStringLists(tags, continuityTags),
    metadata: projection,
  };
}

function inferMemoryKind(entry) {
  const metadata = toObject(entry?.metadata);
  const explicit = normalizeString(entry?.memoryKind) || normalizeString(entry?.kind) || normalizeString(metadata.kind);
  if (isContinuityMemoryEntry(entry)) return "continuity-summary";
  if (explicit) return explicit;
  const tags = normalizeStringList(entry?.tags).map((tag) => tag.toLowerCase());
  if (tags.includes("role-note")) return "role-note";
  if (tags.includes("decision")) return "decision";
  if (tags.includes("upgraded-plan")) return "upgraded-plan";
  return "context";
}

function memoryRefPriority(ref) {
  if (ref.kind === "prior-packet") return 5;
  if (ref.kind === "prior-role-note") return 3;
  if (ref.kind === "memory-pack-item") {
    const memoryKind = inferMemoryKind(ref);
    if (["upgraded-plan", "decision", "required-human-decisions", "next-action", "dissent-summary"].includes(memoryKind)) return 4;
    if (memoryKind === "continuity-summary") return 3;
    if (["role-note", "role-note-summary", "council-summary"].includes(memoryKind)) return 1;
    return 2;
  }
  if (ref.kind === "memory-pack-summary") return 0;
  if (ref.kind === "memory-pack-status") return -1;
  return 0;
}

function selectPlanSummaryContextRefs(memoryRefs, docket, fingerprint) {
  const relevantTokens = [...new Set([...tokenizeRelevantText(docket.objective), ...fingerprint.touchpoints])];
  return memoryRefs
    .map((ref) => {
      const memoryKind = inferMemoryKind(ref);
      const eligible = ref.kind === "prior-packet"
        || (ref.kind === "memory-pack-item" && ["upgraded-plan", "decision", "required-human-decisions", "next-action", "dissent-summary", "continuity-summary"].includes(memoryKind));
      if (!eligible) return null;
      const haystack = `${normalizeString(ref.label)} ${normalizeString(ref.summary)} ${normalizeString(memoryKind)} ${normalizeStringList(ref.tags).join(" ")}`.toLowerCase();
      const overlap = relevantTokens.reduce((score, token) => score + (haystack.includes(token.toLowerCase()) ? 1 : 0), 0);
      return { ref, score: overlap + memoryRefPriority(ref) };
    })
    .filter(Boolean)
    .filter((entry) => entry.score > 3)
    .sort((left, right) => right.score - left.score || normalizeString(right.ref.summary).length - normalizeString(left.ref.summary).length)
    .filter((entry, index, rows) => rows.findIndex((candidate) => normalizeString(candidate.ref.summary) === normalizeString(entry.ref.summary)) === index)
    .slice(0, 2)
    .map((entry) => entry.ref);
}

function defaultRoundAssignmentsForRole(roleId) {
  if (roleId === "lead-planner.v1") return ["draft_capture", "planner_revision", "legitimacy_check"];
  if (roleId === "synthesizer.v1") return ["synthesis", "legitimacy_check"];
  if (roleId === "evidence-marshal.v1") return ["memory_pack", "parallel_critique", "rebuttal"];
  if (roleId === "human-intent-interpreter.v1") return ["parallel_critique", "planner_revision", "legitimacy_check"];
  return ["parallel_critique", "rebuttal"];
}

function defaultMemoryQueriesForRole(roleId) {
  if (roleId === "security-reviewer.v1") return ["security", "auth", "validation gates"];
  if (roleId === "privacy-reviewer.v1") return ["privacy", "data provenance", "retention"];
  if (roleId === "reliability-reviewer.v1") return ["rollback", "recovery", "failure modes"];
  if (roleId === "platform-reviewer.v1") return ["platform", "infra", "deployment"];
  if (roleId === "cost-scope-reviewer.v1") return ["cost", "scope", "payments"];
  if (roleId === "customer-reviewer.v1") return ["customer", "support", "messaging"];
  if (roleId === "trust-safety-reviewer.v1") return ["trust", "safety", "abuse"];
  if (roleId === "domain-specialist.v1") return ["domain", "novelty", "specialized constraints"];
  if (roleId === "lead-planner.v1") return ["objective", "sequence", "validation"];
  if (roleId === "synthesizer.v1") return ["dissent", "required human decisions", "merge"];
  return ["objective", "constraints", "failure modes"];
}

function buildSharedMemoryRefs(docket, fingerprint, options = {}) {
  const refs = [];
  const memoryPack = toObject(options.memoryPack);
  const memoryPackRefs = Array.isArray(memoryPack.refs) ? memoryPack.refs : [];
  const alreadyNormalizedMemoryRefs = memoryPackRefs.every((row) => normalizeString(row?.refId) && normalizeString(row?.scope) && normalizeString(row?.kind));
  if (memoryPackRefs.length > 0 && alreadyNormalizedMemoryRefs) {
    return memoryPackRefs.map((row) => projectCouncilSafeMemoryRef({
      refId: normalizeString(row.refId),
      scope: normalizeString(row.scope) || "shared",
      kind: normalizeString(row.kind) || "memory-pack-item",
      source: normalizeString(row.source) || "planning-council",
      label: normalizeString(row.label) || "Memory context",
      summary: normalizeString(row.summary),
      status: normalizeString(row.status),
      query: normalizeString(row.query),
      memoryKind: normalizeString(row.memoryKind),
      score: Number(row.score ?? 0),
      matchedBy: normalizeStringList(row.matchedBy),
      tags: normalizeStringList(row.tags),
      metadata: toObject(row.metadata),
      packetId: normalizeString(row.packetId),
      goNoGoRecommendation: normalizeString(row.goNoGoRecommendation),
      overlap: Number(row.overlap ?? 0),
      roleId: normalizeString(row.roleId),
      roundType: normalizeString(row.roundType),
    }));
  }
  const objectiveTokens = [...new Set([...tokenizeRelevantText(docket.objective), ...fingerprint.touchpoints])];
  if (normalizeString(memoryPack.summary)) {
    refs.push({
      refId: buildId("memory_ref", { docketId: docket.docketId, kind: "memory-pack-summary" }),
      scope: "shared",
      kind: "memory-pack-summary",
      source: "studio-brain",
      label: "Shared Studio Brain council context",
      summary: normalizeString(memoryPack.summary),
      status: normalizeString(memoryPack.status) || "available",
      query: normalizeString(memoryPack.query)
    });
  }
  const rankedMemoryPackRefs = memoryPackRefs
    .map((row, index) => {
      const memoryKind = inferMemoryKind(row);
      const haystack = `${normalizeString(row.label)} ${normalizeString(row.summary)} ${normalizeStringList(row.tags).join(" ")} ${normalizeString(memoryKind)}`.toLowerCase();
      const overlap = objectiveTokens.reduce((score, token) => score + (haystack.includes(token.toLowerCase()) ? 1 : 0), 0);
      const score = Number(row.score ?? 0) + overlap + (["role-note", "role-note-summary", "council-summary"].includes(memoryKind) ? -0.5 : 1.25);
      return { row, index, memoryKind, score };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, docket.memoryPolicy?.maxSharedItems ?? DEFAULT_MEMORY_POLICY.maxSharedItems);
  for (const { row, index, memoryKind } of rankedMemoryPackRefs) {
    refs.push(projectCouncilSafeMemoryRef({
      refId: normalizeString(row.refId) || buildId("memory_ref", { docketId: docket.docketId, kind: "memory-pack-item", index }),
      scope: "shared",
      kind: "memory-pack-item",
      memoryKind,
      source: normalizeString(row.source) || "studio-brain",
      label: normalizeString(row.label) || `Memory context ${index + 1}`,
      summary: normalizeString(row.summary),
      score: Number(row.score ?? 0),
      matchedBy: normalizeStringList(row.matchedBy),
      tags: normalizeStringList(row.tags),
      metadata: toObject(row.metadata)
    }));
  }

  const priorPackets = Array.isArray(options.priorPackets) ? options.priorPackets : [];
  const rankedPriorPackets = priorPackets
    .map((packet) => {
      const haystack = `${normalizeString(packet.objective)} ${normalizeStringList(packet.failureModes).join(" ")} ${normalizeStringList(packet.requiredHumanDecisions).join(" ")}`.toLowerCase();
      const overlap = objectiveTokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
      return { packet, overlap };
    })
    .filter((entry) => entry.overlap > 0)
    .sort((left, right) => right.overlap - left.overlap || String(right.packet.createdAt ?? "").localeCompare(String(left.packet.createdAt ?? "")))
    .slice(0, 4);
  for (const entry of rankedPriorPackets) {
    refs.push({
      refId: normalizeString(entry.packet.packetId) || buildId("memory_ref", { docketId: docket.docketId, kind: "prior-packet", objective: entry.packet.objective }),
      scope: "shared",
      kind: "prior-packet",
      source: "planning-packet",
      label: `Prior packet: ${normalizeString(entry.packet.objective) || "untitled"}`,
      summary: normalizeString(entry.packet.goNoGoWhy) || normalizeString(entry.packet.why) || normalizeString(entry.packet.objective),
      packetId: entry.packet.packetId,
      goNoGoRecommendation: normalizeString(entry.packet.goNoGoRecommendation),
      overlap: entry.overlap
    });
    if (Array.isArray(entry.packet.roleNotes)) {
      for (const note of entry.packet.roleNotes.slice(0, 2)) {
        refs.push({
          refId: normalizeString(note.noteId) || buildId("memory_ref", { packetId: entry.packet.packetId, roleId: note.roleId, roundType: note.roundType }),
          scope: "shared",
          kind: "prior-role-note",
          source: "planning-council",
          label: `Prior role note: ${normalizeString(note.roleName) || normalizeString(note.roleId)}`,
          summary: normalizeString(note.summary),
          packetId: entry.packet.packetId,
          roleId: normalizeString(note.roleId),
          roundType: normalizeString(note.roundType)
        });
      }
    }
  }

  if (refs.length === 0) {
    refs.push({
      refId: buildId("memory_ref", { docketId: docket.docketId, kind: "no-context" }),
      scope: "shared",
      kind: "memory-pack-status",
      source: "planning-council",
      label: "No historical council context",
      summary: "No prior packet or Studio Brain memory context was available for this council run.",
      status: normalizeString(memoryPack.status) || "missing"
    });
  }

  return refs;
}

function selectRoleMemoryRefIds(role, memoryRefs, maxRoleItems = DEFAULT_MEMORY_POLICY.maxRoleItems) {
  const queries = mergeStringLists(role.memoryQueries, defaultMemoryQueriesForRole(role.roleId));
  const scored = memoryRefs
    .map((ref) => {
      const haystack = `${normalizeString(ref.label)} ${normalizeString(ref.summary)} ${normalizeString(ref.kind)} ${normalizeString(ref.source)} ${normalizeStringList(ref.tags).join(" ")}`.toLowerCase();
      const score = queries.reduce((acc, query) => acc + (haystack.includes(query.toLowerCase()) ? 1 : 0), 0) + memoryRefPriority(ref);
      return { ref, score };
    })
    .sort((left, right) => right.score - left.score || normalizeString(right.ref.kind).localeCompare(normalizeString(left.ref.kind)));
  return scored
    .filter((entry) => entry.score > 0 || entry.ref.scope === "shared")
    .slice(0, Math.max(1, maxRoleItems))
    .map((entry) => entry.ref.refId);
}

export function buildPlanningPreparation(input, governance, options = {}) {
  const now = options.now ?? new Date().toISOString();
  const docket = normalizePlanningDocket(input, { now });
  const fingerprint = fingerprintPlanningDocket(docket, { now });
  const councilBundle = buildCouncilAssembly(docket, fingerprint, governance, { now });
  const roleManifestMap = buildRoleManifestMap(governance);
  const canonicalDraftMarkdown = buildInitialPlanMarkdown(docket, fingerprint);
  const memoryRefs = buildSharedMemoryRefs(docket, fingerprint, options);
  const reviewRounds = buildRoundPlan(docket, councilBundle.council.councilId, now, "pending");
  const roleManifests = councilBundle.seats.map((seat) => roleManifestMap.get(seat.selectedRoleId)).filter(Boolean);
  const roleMemorySlices = councilBundle.seats.map((seat) => {
    const role = roleManifestMap.get(seat.selectedRoleId) ?? { roleId: seat.selectedRoleId, roleName: seat.seatName };
    const selectedRefs = selectRoleMemoryRefIds(role, memoryRefs, docket.memoryPolicy?.maxRoleItems ?? DEFAULT_MEMORY_POLICY.maxRoleItems);
    return {
      roleId: role.roleId,
      roleName: normalizeString(role.roleName) || seat.seatName,
      memoryRefIds: selectedRefs,
      refs: memoryRefs.filter((entry) => selectedRefs.includes(entry.refId)),
      whyTheseMatter: `Selected for ${normalizeString(role.roleName) || role.roleId} based on role memory queries and objective overlap.`,
    };
  });
  const sharedMemoryPack = {
    status: normalizeString(options.memoryPack?.status) || "missing",
    query: normalizeString(options.memoryPack?.query) || null,
    summary: normalizeString(options.memoryPack?.summary) || "",
    refs: memoryRefs,
  };
  const swarmRun = {
    runId: buildId("council_swarm", { councilId: councilBundle.council.councilId, now, stage: "prepare" }),
    councilId: councilBundle.council.councilId,
    createdAt: now,
    completedAt: null,
    runtime: normalizeString(docket.swarmConfig?.runtime) || DEFAULT_SWARM_CONFIG.runtime,
    executionMode: normalizeString(docket.swarmConfig?.executionMode) || DEFAULT_SWARM_CONFIG.executionMode,
    depthProfile: normalizeString(docket.swarmConfig?.depthProfile) || DEFAULT_SWARM_CONFIG.depthProfile,
    maxCritiqueCycles: Number(docket.swarmConfig?.maxCritiqueCycles ?? DEFAULT_SWARM_CONFIG.maxCritiqueCycles),
    reviewMode: normalizeString(docket.reviewMode) || "auto",
    draftSource: normalizeString(docket.draftSource) || "prompt_generated",
    status: "prepared",
    degradedFallbackUsed: false,
    roundOrder: normalizeRoundOrder(docket.swarmConfig?.roundOrder),
    memoryPackStatus: sharedMemoryPack.status,
    memoryPolicyMode: normalizeString(docket.memoryPolicy?.mode) || DEFAULT_MEMORY_POLICY.mode,
  };

  return {
    preparedRunId: councilBundle.council.councilId,
    generatedAt: now,
    docket,
    fingerprint,
    council: {
      ...councilBundle.council,
      status: "prepared",
    },
    seats: councilBundle.seats,
    reviewRounds,
    swarmRun,
    roleManifests,
    canonicalDraftMarkdown,
    roundPlan: reviewRounds,
    memoryRefs,
    sharedMemoryPack,
    roleMemorySlices,
    fallbackInstructions: [
      "If live role execution fails, resubmit the same draft with submissionStage=single_pass and reviewMode=deterministic.",
      "Do not lose required human decisions or dissent when degrading to deterministic packet generation.",
    ],
  };
}

function normalizeLiveRoundType(value) {
  const normalized = normalizeString(value);
  return COUNCIL_SWARM_ROUND_ORDER.includes(normalized) ? normalized : "parallel_critique";
}

function normalizeLiveSectionName(value) {
  const normalized = normalizeString(value);
  if (!normalized) return "Summary";
  if (["summary", "ordered execution sequence", "validation gates", "failure modes", "required human decisions", "open questions", "assumptions", "dissent"].includes(normalized.toLowerCase())) {
    return normalized
      .split(/\s+/)
      .map((entry) => entry.charAt(0).toUpperCase() + entry.slice(1))
      .join(" ")
      .replace("Execution Sequence", "Execution Sequence");
  }
  return sectionNameForAffectedPlanSection(normalized.toLowerCase().replace(/\s+/g, "_"));
}

function normalizeLiveFindingStatus(value) {
  const normalized = normalizeString(value);
  return normalized || "open";
}

function buildLiveReviewItemFromFinding(finding, seat, roundId, councilId) {
  return {
    itemId: buildId("review_item", { councilId, findingId: finding.findingId }),
    findingId: finding.findingId,
    councilId,
    roundId,
    seatId: seat?.seatId ?? "",
    seat: seat?.seatName ?? normalizeString(finding.roleName) ?? normalizeString(finding.roleId),
    stakeholderRepresented: seat?.stakeholderRepresented ?? "",
    type: normalizeString(finding.findingType) || "objection",
    severity: normalizeString(finding.severity) || "medium",
    statement: normalizeString(finding.claim),
    rationale: normalizeString(finding.whyItMatters),
    sourceBasis: normalizeStringList(finding.evidenceRefs),
    affectedPlanSection: normalizeLiveSectionName(finding.affectedPlanSection),
    requiredAction: normalizeString(finding.proposedChange),
    confidenceScore: Number.isFinite(Number(finding.noveltyScore)) ? Math.max(0.5, Math.min(0.99, Number(finding.noveltyScore))) : 0.8,
    findingStatus: normalizeLiveFindingStatus(finding.status),
    requiresHumanDecision: Boolean(finding.requiresHumanDecision),
    cycle: Number(finding.cycle ?? 0) || null,
    roleId: normalizeString(finding.roleId),
  };
}

function buildDerivedRoleNotesFromFindings(roleFindings, councilId, runId) {
  const grouped = new Map();
  for (const finding of roleFindings) {
    const key = `${finding.roleId}:${finding.roundType}:${finding.cycle ?? 0}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(finding);
  }
  return [...grouped.entries()].map(([key, findings]) => {
    const [roleId, roundType] = key.split(":");
    const first = findings[0] ?? {};
    const blockerCount = findings.filter((entry) => entry.requiresHumanDecision || entry.status === "still_blocked").length;
    const severity = findings.reduce((highest, item) => IMPACT_ORDER.indexOf(item.severity) > IMPACT_ORDER.indexOf(highest) ? item.severity : highest, "low");
    return {
      noteId: buildId("role_note", { councilId, roleId, roundType, key }),
      councilId,
      runId,
      roleId,
      roleName: normalizeString(first.roleName) || roleId,
      roundType,
      status: "completed",
      stance: blockerCount > 0 || severity === "critical" ? "blocker" : findings.length > 0 ? "changes_requested" : "support",
      summary: normalizeString(first.summary) || `${normalizeString(first.roleName) || roleId} produced ${findings.length} structured findings during ${roundType}.`,
      objections: findings.map((entry) => entry.claim),
      proposedEdits: findings.map((entry) => entry.proposedChange).filter(Boolean),
      memoryRefIds: normalizeStringList(first.memoryRefIds),
      affectedPlanSections: [...new Set(findings.map((entry) => normalizeLiveSectionName(entry.affectedPlanSection)))],
      severity,
      cycle: first.cycle ?? null,
    };
  });
}

function buildDerivedRoundSummaries(roundPlan, roleFindings, roleNotes, councilId, runId) {
  return roundPlan.map((round) => {
    const relevantFindings = roleFindings.filter((finding) => finding.roundType === round.roundType && Number(finding.cycle ?? 0) === Number(round.cycle ?? 0));
    const relevantNotes = roleNotes.filter((note) => note.roundType === round.roundType && Number(note.cycle ?? 0) === Number(round.cycle ?? 0));
    return {
      summaryId: buildId("round_summary", { runId, roundType: round.roundType, cycle: round.cycle ?? 0 }),
      runId,
      councilId,
      roundType: round.roundType,
      cycle: round.cycle ?? null,
      ordinal: round.ordinal,
      status: "completed",
      participatingRoleIds: [...new Set(relevantFindings.map((entry) => entry.roleId).concat(relevantNotes.map((entry) => entry.roleId)))],
      noteIds: relevantNotes.map((entry) => entry.noteId),
      summary: relevantFindings.length > 0 ? `${round.roundType}${round.cycle ? ` cycle ${round.cycle}` : ""} produced ${relevantFindings.length} structured findings.` : `${round.roundType}${round.cycle ? ` cycle ${round.cycle}` : ""} completed without material findings.`,
      unresolvedBlockers: relevantFindings.filter((entry) => entry.status === "still_blocked" || entry.requiresHumanDecision).map((entry) => entry.findingId),
      novelFindingsCount: relevantFindings.filter((entry) => Number(entry.noveltyScore ?? 0) >= 0.75).length,
      conflictClusters: [],
      stillBlockedFindingIds: relevantFindings.filter((entry) => entry.status === "still_blocked").map((entry) => entry.findingId),
    };
  });
}

function buildLiveCouncilSwarmArtifacts(docket, fingerprint, governance, councilBundle, options = {}) {
  const now = options.now ?? docket.createdAt ?? new Date().toISOString();
  const external = toObject(options.externalSwarmArtifacts);
  const memoryRefs = buildSharedMemoryRefs(docket, fingerprint, options);
  const roleManifestMap = buildRoleManifestMap(governance);
  const seatByRoleId = new Map(councilBundle.seats.map((seat) => [seat.selectedRoleId, seat]));
  const roundPlan = buildRoundPlan(docket, councilBundle.council.councilId, now, "completed");
  const roundByKey = new Map(roundPlan.map((round) => [`${round.roundType}:${round.cycle ?? 0}`, round]));
  const initialPlanMarkdown = buildInitialPlanMarkdown(docket, fingerprint);
  const swarmRun = {
    runId: normalizeString(external.swarmRun?.runId) || buildId("council_swarm", { councilId: councilBundle.council.councilId, now, stage: "live" }),
    councilId: councilBundle.council.councilId,
    createdAt: normalizeString(external.swarmRun?.createdAt) || now,
    completedAt: normalizeString(external.swarmRun?.completedAt) || now,
    runtime: normalizeString(external.swarmRun?.runtime) || normalizeString(docket.swarmConfig?.runtime) || DEFAULT_SWARM_CONFIG.runtime,
    executionMode: normalizeString(external.swarmRun?.executionMode) || normalizeString(docket.swarmConfig?.executionMode) || "live",
    depthProfile: normalizeString(external.swarmRun?.depthProfile) || normalizeString(docket.swarmConfig?.depthProfile) || DEFAULT_SWARM_CONFIG.depthProfile,
    maxCritiqueCycles: Number(external.swarmRun?.maxCritiqueCycles ?? docket.swarmConfig?.maxCritiqueCycles ?? DEFAULT_SWARM_CONFIG.maxCritiqueCycles),
    reviewMode: normalizeString(docket.reviewMode) || "swarm",
    draftSource: normalizeString(docket.draftSource) || "prompt_generated",
    status: "completed",
    degradedFallbackUsed: Boolean(external.swarmRun?.degradedFallbackUsed),
    roundOrder: normalizeRoundOrder(docket.swarmConfig?.roundOrder),
    memoryPackStatus: normalizeString(options.memoryPack?.status) || "missing",
    memoryPolicyMode: normalizeString(docket.memoryPolicy?.mode) || DEFAULT_MEMORY_POLICY.mode,
  };

  const roleFindings = (Array.isArray(external.roleFindings) ? external.roleFindings : []).map((entry, index) => {
    const roleId = normalizeString(entry.roleId);
    const role = roleManifestMap.get(roleId) ?? {};
    return {
      findingId: normalizeString(entry.findingId) || buildId("role_finding", { councilId: councilBundle.council.councilId, roleId, index, claim: entry.claim }),
      councilId: councilBundle.council.councilId,
      runId: swarmRun.runId,
      roleId,
      roleName: normalizeString(entry.roleName) || normalizeString(role.roleName) || roleId,
      roundType: normalizeLiveRoundType(entry.roundType),
      cycle: Number(entry.cycle ?? 0) || null,
      severity: normalizeString(entry.severity) || "medium",
      findingType: normalizeString(entry.findingType) || "objection",
      affectedPlanSection: normalizeLiveSectionName(entry.affectedPlanSection),
      claim: normalizeString(entry.claim),
      whyItMatters: normalizeString(entry.whyItMatters),
      evidenceRefs: normalizeStringList(entry.evidenceRefs),
      proposedChange: normalizeString(entry.proposedChange),
      requiresHumanDecision: Boolean(entry.requiresHumanDecision),
      noveltyScore: Number.isFinite(Number(entry.noveltyScore)) ? Number(entry.noveltyScore) : 0.5,
      status: normalizeLiveFindingStatus(entry.status),
      summary: normalizeString(entry.summary),
      memoryRefIds: normalizeStringList(entry.memoryRefIds),
    };
  });

  const roleNotes = (Array.isArray(external.roleNotes) ? external.roleNotes : []).map((entry, index) => ({
    noteId: normalizeString(entry.noteId) || buildId("role_note", { councilId: councilBundle.council.councilId, roleId: entry.roleId, roundType: entry.roundType, index }),
    councilId: councilBundle.council.councilId,
    runId: swarmRun.runId,
    roleId: normalizeString(entry.roleId),
    roleName: normalizeString(entry.roleName),
    roundType: normalizeLiveRoundType(entry.roundType),
    status: normalizeString(entry.status) || "completed",
    stance: normalizeString(entry.stance) || "changes_requested",
    summary: normalizeString(entry.summary),
    objections: normalizeStringList(entry.objections),
    proposedEdits: normalizeStringList(entry.proposedEdits),
    memoryRefIds: normalizeStringList(entry.memoryRefIds),
    affectedPlanSections: normalizeStringList(entry.affectedPlanSections),
    severity: normalizeString(entry.severity) || "medium",
    cycle: Number(entry.cycle ?? 0) || null,
  }));
  const derivedRoleNotes = roleNotes.length > 0 ? roleNotes : buildDerivedRoleNotesFromFindings(roleFindings, councilBundle.council.councilId, swarmRun.runId);

  const agentRuns = (Array.isArray(external.agentRuns) ? external.agentRuns : []).map((entry, index) => ({
    agentRunId: normalizeString(entry.agentRunId) || buildId("agent_run", { runId: swarmRun.runId, roleId: entry.roleId, roundType: entry.roundType, cycle: entry.cycle ?? 0, index }),
    taskId: normalizeString(entry.taskId) || buildId("swarm_task", { runId: swarmRun.runId, roleId: entry.roleId, roundType: entry.roundType, cycle: entry.cycle ?? 0, index }),
    runId: swarmRun.runId,
    councilId: councilBundle.council.councilId,
    roleId: normalizeString(entry.roleId),
    roleName: normalizeString(entry.roleName),
    seatId: normalizeString(entry.seatId) || (seatByRoleId.get(normalizeString(entry.roleId))?.seatId ?? ""),
    roundType: normalizeLiveRoundType(entry.roundType),
    cycle: Number(entry.cycle ?? 0) || null,
    status: normalizeString(entry.status) || "completed",
    assignedAgentId: normalizeString(entry.assignedAgentId) || `${swarmRun.runId}:${normalizeString(entry.roleId)}`,
    memoryRefIds: normalizeStringList(entry.memoryRefIds),
    revisionPermissions: toObject(entry.revisionPermissions),
    mergeRules: normalizeStringList(entry.mergeRules),
    provider: normalizeString(entry.provider),
    promptVersion: normalizeString(entry.promptVersion),
    startedAt: normalizeString(entry.startedAt) || now,
    completedAt: normalizeString(entry.completedAt) || now,
    inputSections: normalizeStringList(entry.inputSections),
    abstained: Boolean(entry.abstained),
    abstainReason: normalizeString(entry.abstainReason),
    promptHash: normalizeString(entry.promptHash),
    outputHash: normalizeString(entry.outputHash),
  }));

  const reviewItems = roleFindings.map((finding) => {
    const round = roundByKey.get(`${finding.roundType}:${finding.cycle ?? 0}`) ?? roundByKey.get(`${finding.roundType}:0`) ?? roundPlan[0];
    const seat = seatByRoleId.get(finding.roleId) ?? null;
    return buildLiveReviewItemFromFinding(finding, seat, round?.roundId ?? "", councilBundle.council.councilId);
  });

  const addressMatrix = (Array.isArray(external.addressMatrix) ? external.addressMatrix : []).map((entry, index) => ({
    entryId: normalizeString(entry.entryId) || buildId("address_matrix", { councilId: councilBundle.council.councilId, findingId: entry.findingId, index }),
    councilId: councilBundle.council.councilId,
    findingId: normalizeString(entry.findingId),
    status: normalizeString(entry.status) || "accepted",
    resolution: normalizeString(entry.resolution),
    reason: normalizeString(entry.reason),
    revisionId: normalizeString(entry.revisionId),
    cycle: Number(entry.cycle ?? 0) || null,
  }));

  const planRevisions = (Array.isArray(external.planRevisions) ? external.planRevisions : []).map((entry, index) => ({
    revisionId: normalizeString(entry.revisionId) || buildId("plan_revision", { councilId: councilBundle.council.councilId, stage: entry.stage, cycle: entry.cycle ?? 0, index }),
    councilId: councilBundle.council.councilId,
    stage: normalizeString(entry.stage) || "planner_revision",
    cycle: Number(entry.cycle ?? 0) || null,
    authorRoleId: normalizeString(entry.authorRoleId) || "lead-planner.v1",
    summary: normalizeString(entry.summary),
    beforePlanHash: normalizeString(entry.beforePlanHash) || null,
    afterPlanHash: normalizeString(entry.afterPlanHash) || hashPlanText(normalizeString(entry.markdown)),
    changedSections: normalizeStringList(entry.changedSections),
    appliedNoteIds: normalizeStringList(entry.appliedNoteIds),
    unresolvedNoteIds: normalizeStringList(entry.unresolvedNoteIds),
    addressedFindingIds: normalizeStringList(entry.addressedFindingIds),
    rejectedFindingIds: normalizeStringList(entry.rejectedFindingIds),
    plannerRationale: normalizeString(entry.plannerRationale),
    markdown: normalizeString(entry.markdown),
  }));

  const roundSummaries = (Array.isArray(external.roundSummaries) ? external.roundSummaries : []).map((entry, index) => ({
    summaryId: normalizeString(entry.summaryId) || buildId("round_summary", { runId: swarmRun.runId, roundType: entry.roundType, cycle: entry.cycle ?? 0, index }),
    runId: swarmRun.runId,
    councilId: councilBundle.council.councilId,
    roundType: normalizeLiveRoundType(entry.roundType),
    cycle: Number(entry.cycle ?? 0) || null,
    ordinal: Number(entry.ordinal ?? index + 1),
    status: normalizeString(entry.status) || "completed",
    participatingRoleIds: normalizeStringList(entry.participatingRoleIds),
    noteIds: normalizeStringList(entry.noteIds),
    summary: normalizeString(entry.summary),
    unresolvedBlockers: normalizeStringList(entry.unresolvedBlockers),
    novelFindingsCount: Number(entry.novelFindingsCount ?? 0),
    conflictClusters: Array.isArray(entry.conflictClusters) ? entry.conflictClusters : [],
    stillBlockedFindingIds: normalizeStringList(entry.stillBlockedFindingIds),
  }));
  const normalizedRoundSummaries = roundSummaries.length > 0 ? roundSummaries : buildDerivedRoundSummaries(roundPlan, roleFindings, derivedRoleNotes, councilBundle.council.councilId, swarmRun.runId);

  const finalPlanMarkdown = normalizeString(external.finalDraftMarkdown)
    || normalizeString(planRevisions.at(-1)?.markdown)
    || initialPlanMarkdown;
  const finalPlanHash = hashPlanText(finalPlanMarkdown);
  const reviewRounds = roundPlan;

  return {
    swarmRun,
    memoryRefs,
    reviewRounds,
    reviewItems,
    roleFindings,
    agentRuns,
    roleNotes: derivedRoleNotes,
    roundSummaries: normalizedRoundSummaries,
    addressMatrix,
    planRevisions,
    initialPlanMarkdown,
    revisedPlanMarkdown: normalizeString(planRevisions.at(-1)?.markdown) || finalPlanMarkdown,
    finalPlanMarkdown,
    finalPlanHash,
  };
}

function buildCouncilSwarmArtifacts(docket, fingerprint, governance, councilBundle, reviewItems, ledger, options = {}) {
  const now = options.now ?? docket.createdAt ?? new Date().toISOString();
  const roleManifestMap = buildRoleManifestMap(governance);
  const initialPlanMarkdown = buildInitialPlanMarkdown(docket, fingerprint);
  const initialPlanHash = hashPlanText(initialPlanMarkdown);
  const memoryRefs = buildSharedMemoryRefs(docket, fingerprint, options);
  const swarmRun = {
    runId: buildId("council_swarm", { councilId: councilBundle.council.councilId, now }),
    councilId: councilBundle.council.councilId,
    createdAt: now,
    completedAt: now,
    runtime: normalizeString(docket.swarmConfig?.runtime) || DEFAULT_SWARM_CONFIG.runtime,
    reviewMode: normalizeString(docket.reviewMode) || "auto",
    draftSource: normalizeString(docket.draftSource) || "prompt_generated",
    status: "completed",
    degradedFallbackUsed: normalizeString(docket.reviewMode) === "deterministic",
    roundOrder: normalizeRoundOrder(docket.swarmConfig?.roundOrder),
    memoryPackStatus: normalizeString(options.memoryPack?.status) || "missing",
    memoryPolicyMode: normalizeString(docket.memoryPolicy?.mode) || DEFAULT_MEMORY_POLICY.mode
  };

  const seatByRoleId = new Map(councilBundle.seats.map((seat) => [seat.selectedRoleId, seat]));
  const seatBySeatId = new Map(councilBundle.seats.map((seat) => [seat.seatId, seat]));
  const agentRuns = [];
  for (const seat of councilBundle.seats) {
    const role = roleManifestMap.get(seat.selectedRoleId) ?? { roleId: seat.selectedRoleId, roleName: seat.seatName };
    const roundAssignments = normalizeStringList(role.roundAssignments).length > 0 ? normalizeStringList(role.roundAssignments) : defaultRoundAssignmentsForRole(role.roleId);
    const memoryRefIds = selectRoleMemoryRefIds(role, memoryRefs, docket.memoryPolicy?.maxRoleItems ?? DEFAULT_MEMORY_POLICY.maxRoleItems);
    for (const roundType of roundAssignments.filter((entry) => swarmRun.roundOrder.includes(entry))) {
      agentRuns.push({
        agentRunId: buildId("agent_run", { runId: swarmRun.runId, roleId: role.roleId, roundType }),
        taskId: buildId("swarm_task", { runId: swarmRun.runId, roleId: role.roleId, roundType }),
        runId: swarmRun.runId,
        councilId: councilBundle.council.councilId,
        roleId: role.roleId,
        roleName: normalizeString(role.roleName) || seat.seatName,
        seatId: seat.seatId,
        roundType,
        status: "completed",
        assignedAgentId: `${swarmRun.runId}:${role.roleId}`,
        memoryRefIds,
        revisionPermissions: toObject(role.revisionPermissions),
        mergeRules: normalizeStringList(role.mergeRules)
      });
    }
  }

  const reviewItemsByRoleId = new Map();
  for (const item of reviewItems) {
    const seat = seatBySeatId.get(item.seatId);
    const roleId = seat?.selectedRoleId ?? "";
    if (!roleId) continue;
    if (!reviewItemsByRoleId.has(roleId)) reviewItemsByRoleId.set(roleId, []);
    reviewItemsByRoleId.get(roleId).push(item);
  }

  const roleNotes = [];
  const pushRoleNote = (agentRun, summary, extra = {}) => {
    const relevantItems = reviewItemsByRoleId.get(agentRun.roleId) ?? [];
    const objections = relevantItems
      .filter((item) => ["objection", "required_revision", "evidence_gap"].includes(item.type))
      .map((item) => item.statement);
    const proposedEdits = relevantItems.map((item) => item.requiredAction);
    const severity = relevantItems.reduce((highest, item) => IMPACT_ORDER.indexOf(item.severity) > IMPACT_ORDER.indexOf(highest) ? item.severity : highest, "low");
    roleNotes.push({
      noteId: buildId("role_note", { agentRunId: agentRun.agentRunId, summary }),
      councilId: councilBundle.council.councilId,
      runId: swarmRun.runId,
      roleId: agentRun.roleId,
      roleName: agentRun.roleName,
      roundType: agentRun.roundType,
      status: "completed",
      stance:
        severity === "critical"
          ? "blocker"
          : objections.length > 0
            ? "changes_requested"
            : "support",
      summary,
      objections,
      proposedEdits,
      memoryRefIds: agentRun.memoryRefIds,
      affectedPlanSections: [...new Set(relevantItems.map((item) => sectionNameForAffectedPlanSection(item.affectedPlanSection)))],
      severity,
      ...extra
    });
  };

  for (const agentRun of agentRuns) {
    const roleName = normalizeString(agentRun.roleName) || agentRun.roleId;
    if (agentRun.roundType === "draft_capture") {
      pushRoleNote(agentRun, `${roleName} established the initial draft baseline and sequenced the first safe pass through the work.`, { planHash: initialPlanHash });
    } else if (agentRun.roundType === "memory_pack") {
      pushRoleNote(agentRun, `${roleName} reviewed the shared Studio Brain context and separated usable precedent from weakly supported assumptions.`, { planHash: initialPlanHash });
    } else if (agentRun.roundType === "parallel_critique") {
      pushRoleNote(agentRun, `${roleName} issued role-specific critique against the current plan and proposed concrete edits before revision.`, { planHash: initialPlanHash });
    }
  }

  const draftSections = parsePlanSections(initialPlanMarkdown);
  const revisedSections = new Map(Array.from(draftSections.entries()).map(([key, value]) => [key, [...value]]));
  if (!revisedSections.has("Summary")) revisedSections.set("Summary", []);
  if (!revisedSections.has("Ordered Execution Sequence")) revisedSections.set("Ordered Execution Sequence", []);
  if (!revisedSections.has("Validation Gates")) revisedSections.set("Validation Gates", []);
  if (!revisedSections.has("Failure Modes")) revisedSections.set("Failure Modes", []);
  if (!revisedSections.has("Required Human Decisions")) revisedSections.set("Required Human Decisions", []);
  if (!revisedSections.has("Assumptions")) revisedSections.set("Assumptions", []);
  if (!revisedSections.has("Dissent")) revisedSections.set("Dissent", []);

  for (const ref of selectPlanSummaryContextRefs(memoryRefs, docket, fingerprint)) {
    revisedSections.get("Summary").push(`- Context anchor: ${normalizeString(ref.summary)}`);
  }
  for (const item of reviewItems) {
    const sectionName = sectionNameForAffectedPlanSection(item.affectedPlanSection);
    revisedSections.get(sectionName).push(`- ${item.requiredAction}`);
  }
  for (const entry of docket.assumptions) {
    revisedSections.get("Assumptions").push(`- ${entry.statement} (${entry.evidenceLabel})`);
  }
  for (const item of reviewItems.filter((entry) => ["critical", "high"].includes(entry.severity) && ["objection", "required_revision"].includes(entry.type))) {
    revisedSections.get("Dissent").push(`- ${item.seat}: ${item.statement}`);
  }

  const revisedPlanMarkdown = renderPlanFromSections(revisedSections);
  const revisedPlanHash = hashPlanText(revisedPlanMarkdown);

  const plannerRun = agentRuns.find((run) => run.roleId === "lead-planner.v1" && run.roundType === "planner_revision")
    ?? {
      agentRunId: buildId("agent_run", { runId: swarmRun.runId, roleId: "lead-planner.v1", roundType: "planner_revision" }),
      roleId: "lead-planner.v1",
      roleName: "Lead Planner",
      roundType: "planner_revision",
      memoryRefIds: [],
    };
  pushRoleNote(plannerRun, "Lead Planner merged the critique into a co-edited revision and kept unresolved value choices visible for human arbitration.", {
    planHash: revisedPlanHash,
    appliedReviewItemIds: reviewItems.map((item) => item.itemId)
  });

  for (const agentRun of agentRuns.filter((run) => run.roundType === "rebuttal")) {
    pushRoleNote(agentRun, `${normalizeString(agentRun.roleName) || agentRun.roleId} re-checked the revised draft and upheld only the objections that still matter after revision.`, {
      planHash: revisedPlanHash,
      unresolved: (reviewItemsByRoleId.get(agentRun.roleId) ?? []).some((item) => item.severity === "critical")
    });
  }

  const finalSections = new Map(Array.from(revisedSections.entries()).map(([key, value]) => [key, [...value]]));
  for (const line of ledger
    .filter((entry) => entry.resolutionState === "requires_human_decision")
    .map((entry) => reviewItems.find((item) => item.itemId === entry.itemId))
    .filter(Boolean)
    .map((item) => `- Human arbitration required: ${item.statement}`)) {
    finalSections.get("Required Human Decisions").push(line);
  }
  const finalPlanMarkdown = renderPlanFromSections(finalSections);
  const finalPlanHash = hashPlanText(finalPlanMarkdown);

  const synthesizerRun = agentRuns.find((run) => run.roleId === "synthesizer.v1" && run.roundType === "synthesis")
    ?? {
      agentRunId: buildId("agent_run", { runId: swarmRun.runId, roleId: "synthesizer.v1", roundType: "synthesis" }),
      roleId: "synthesizer.v1",
      roleName: "Synthesizer",
      roundType: "synthesis",
      memoryRefIds: [],
    };
  pushRoleNote(synthesizerRun, "Synthesizer merged accepted revisions into one upgraded plan and preserved unresolved dissent instead of smoothing it away.", {
    planHash: finalPlanHash
  });

  const legitimacyRun = agentRuns.find((run) => run.roundType === "legitimacy_check");
  if (legitimacyRun) {
    pushRoleNote(legitimacyRun, `${normalizeString(legitimacyRun.roleName) || legitimacyRun.roleId} confirmed that seat selection, review rounds, and dissent handling remain visible for human arbitration.`, {
      planHash: finalPlanHash
    });
  }

  const roundSummaries = swarmRun.roundOrder.map((roundType, index) => {
    const notes = roleNotes.filter((note) => note.roundType === roundType);
    const participants = agentRuns.filter((agentRun) => agentRun.roundType === roundType).map((agentRun) => agentRun.roleId);
    return {
      summaryId: buildId("round_summary", { runId: swarmRun.runId, roundType }),
      runId: swarmRun.runId,
      councilId: councilBundle.council.councilId,
      roundType,
      ordinal: index + 1,
      status: "completed",
      participatingRoleIds: participants,
      noteIds: notes.map((note) => note.noteId),
      summary:
        notes.length > 0
          ? `${roundType} produced ${notes.length} role notes across ${participants.length} participating roles.`
          : `${roundType} completed without new role notes.`,
      unresolvedBlockers: notes.filter((note) => note.stance === "blocker").map((note) => note.noteId)
    };
  });

  const planRevisions = [
    {
      revisionId: buildId("plan_revision", { councilId: councilBundle.council.councilId, stage: "draft_capture", planHash: initialPlanHash }),
      councilId: councilBundle.council.councilId,
      stage: "draft_capture",
      authorRoleId: "lead-planner.v1",
      summary: "Initial draft captured from the existing plan or generated from the intake.",
      beforePlanHash: null,
      afterPlanHash: initialPlanHash,
      changedSections: ["Summary", "Ordered Execution Sequence"],
      appliedNoteIds: roleNotes.filter((note) => note.roundType === "draft_capture").map((note) => note.noteId),
      unresolvedNoteIds: [],
      markdown: initialPlanMarkdown
    },
    {
      revisionId: buildId("plan_revision", { councilId: councilBundle.council.councilId, stage: "planner_revision", planHash: revisedPlanHash }),
      councilId: councilBundle.council.councilId,
      stage: "planner_revision",
      authorRoleId: "lead-planner.v1",
      summary: "Planner revision applied critique, memory context, and specialist requests into one co-edited draft.",
      beforePlanHash: initialPlanHash,
      afterPlanHash: revisedPlanHash,
      changedSections: ["Summary", "Validation Gates", "Failure Modes", "Required Human Decisions", "Assumptions", "Dissent"],
      appliedNoteIds: roleNotes.filter((note) => ["memory_pack", "parallel_critique", "planner_revision"].includes(note.roundType)).map((note) => note.noteId),
      unresolvedNoteIds: roleNotes.filter((note) => note.stance === "blocker").map((note) => note.noteId),
      markdown: revisedPlanMarkdown
    },
    {
      revisionId: buildId("plan_revision", { councilId: councilBundle.council.councilId, stage: "synthesis", planHash: finalPlanHash }),
      councilId: councilBundle.council.councilId,
      stage: "synthesis",
      authorRoleId: "synthesizer.v1",
      summary: "Final synthesis preserved dissent and converted unresolved conflicts into explicit human decisions.",
      beforePlanHash: revisedPlanHash,
      afterPlanHash: finalPlanHash,
      changedSections: ["Required Human Decisions", "Dissent"],
      appliedNoteIds: roleNotes.filter((note) => ["rebuttal", "synthesis", "legitimacy_check"].includes(note.roundType)).map((note) => note.noteId),
      unresolvedNoteIds: roleNotes.filter((note) => note.stance === "blocker").map((note) => note.noteId),
      markdown: finalPlanMarkdown
    }
  ];

  return {
    swarmRun,
    memoryRefs,
    agentRuns,
    roleNotes,
    roundSummaries,
    planRevisions,
    initialPlanMarkdown,
    revisedPlanMarkdown,
    finalPlanMarkdown,
    finalPlanHash
  };
}

function deriveRoleFindingsFromReviewItems(reviewItems, councilBundle, swarmArtifacts) {
  const seatBySeatId = new Map(councilBundle.seats.map((seat) => [seat.seatId, seat]));
  const roundById = new Map((swarmArtifacts.reviewRounds ?? []).map((round) => [round.roundId, round]));
  const roundSummaryByKey = new Map((swarmArtifacts.roundSummaries ?? []).map((entry) => [`${entry.roundType}:${entry.cycle ?? 0}`, entry]));
  const ledgerByItemId = new Map((swarmArtifacts.objectionLedger ?? []).map((entry) => [entry.itemId, entry]));
  return reviewItems.map((item, index) => {
    const seat = seatBySeatId.get(item.seatId) ?? {};
    const round = roundById.get(item.roundId) ?? {};
    const roundType = normalizeLiveRoundType(round.roundType);
    const cycle = Number(round.cycle ?? item.cycle ?? 0) || null;
    const roundSummary = roundSummaryByKey.get(`${roundType}:${cycle ?? 0}`);
    const ledger = ledgerByItemId.get(item.itemId) ?? {};
    const status = normalizeString(item.findingStatus)
      || (normalizeString(ledger.resolutionState) === "requires_human_decision"
        ? "still_blocked"
        : normalizeString(ledger.resolutionState) === "deferred"
          ? "partially_resolved"
          : "resolved");
    return {
      findingId: buildId("role_finding", { councilId: councilBundle.council.councilId, itemId: item.itemId, index }),
      councilId: councilBundle.council.councilId,
      runId: swarmArtifacts.swarmRun?.runId ?? "",
      roleId: normalizeString(item.roleId) || normalizeString(seat.selectedRoleId) || "unknown-role",
      roleName: normalizeString(item.seat),
      roundType,
      cycle,
      severity: normalizeString(item.severity) || "medium",
      findingType: normalizeString(item.type) || "objection",
      affectedPlanSection: normalizeLiveSectionName(item.affectedPlanSection),
      claim: normalizeString(item.statement),
      whyItMatters: normalizeString(item.rationale),
      evidenceRefs: normalizeStringList(item.sourceBasis),
      proposedChange: normalizeString(item.requiredAction),
      requiresHumanDecision: Boolean(item.requiresHumanDecision) || normalizeString(ledger.resolutionState) === "requires_human_decision" || normalizeString(item.severity) === "critical",
      noveltyScore: Number(item.confidenceScore ?? 0.8),
      status,
      summary: roundSummary?.summary || "",
      memoryRefIds: [],
      itemId: item.itemId,
    };
  });
}

function buildDerivedAddressMatrix(roleFindings, planRevisions, councilId) {
  const latestRevisionId = planRevisions.at(-1)?.revisionId ?? null;
  return roleFindings.map((finding, index) => {
    const normalizedStatus = normalizeString(finding.status);
    const entryStatus =
      normalizedStatus === "still_blocked"
        ? "unresolved"
        : normalizedStatus === "partially_resolved"
          ? "partially_accepted"
          : normalizedStatus === "rejected"
            ? "rejected"
            : "accepted";
    return {
      entryId: buildId("address_matrix", { councilId, findingId: finding.findingId, index }),
      councilId,
      findingId: finding.findingId,
      status: entryStatus,
      resolution:
        entryStatus === "accepted"
          ? "Incorporated into the upgraded plan."
          : entryStatus === "partially_accepted"
            ? "Partially incorporated, with residual risk still visible."
            : entryStatus === "rejected"
              ? "The finding was rejected during planner revision."
              : "The finding remains unresolved and requires human arbitration.",
      reason: normalizeString(finding.whyItMatters) || "See finding rationale.",
      revisionId: latestRevisionId,
      cycle: Number(finding.cycle ?? 0) || null,
    };
  });
}

function normalizePacketArtifactEntries(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry));
}

function normalizePacketArtifactLimits(value) {
  const input = toObject(value);
  return Object.fromEntries(Object.entries(DEFAULT_PACKET_ARTIFACT_LIMITS).map(([field, defaultLimit]) => {
    const candidate = Number(input[field]);
    const normalized = Number.isFinite(candidate) && candidate >= 1
      ? Math.min(128, Math.floor(candidate))
      : defaultLimit;
    return [field, normalized];
  }));
}

function resolvePacketArtifactStableId(field, entry, index) {
  const item = toObject(entry);
  for (const key of ["agentRunId", "findingId", "noteId", "revisionId", "summaryId", "refId", "entryId", "roundId", "itemId"]) {
    const candidate = normalizeString(item[key]);
    if (candidate) return candidate;
  }
  const roleId = normalizeString(item.roleId);
  const roundType = normalizeString(item.roundType);
  const cycle = Number(item.cycle ?? 0) || 0;
  return `${field}:${roleId || roundType || "entry"}:${cycle}:${index + 1}`;
}

function buildEmbeddedPacketArtifact(field, entries, limit) {
  const normalizedEntries = normalizePacketArtifactEntries(entries);
  const maxItems = Math.max(1, Number(limit) || normalizedEntries.length || 1);
  const embedded = normalizedEntries.slice(0, maxItems);
  const omittedEntries = normalizedEntries.slice(maxItems);
  return {
    embedded,
    totalCount: normalizedEntries.length,
    embeddedCount: embedded.length,
    omittedCount: omittedEntries.length,
    omittedIds: omittedEntries
      .slice(0, 32)
      .map((entry, index) => resolvePacketArtifactStableId(field, entry, maxItems + index)),
    mode: omittedEntries.length > 0 ? "bounded" : "full"
  };
}

export function embedPlanningPacketArtifacts(packetInput, artifactsInput, options = {}) {
  const packet = toObject(packetInput);
  const artifacts = toObject(artifactsInput);
  const optionObject = toObject(options);
  const limits = normalizePacketArtifactLimits(optionObject.packetArtifactLimits ?? optionObject.limits);
  const fields = ["agentRuns", "roleFindings", "roleNotes", "planRevisions", "roundSummaries", "memoryRefs", "addressMatrix"];
  const nextPacket = { ...packet };
  const counts = {};
  const omitted = {};
  let mode = "full";

  for (const field of fields) {
    const artifactEntries =
      field === "memoryRefs" && Array.isArray(artifacts[field])
        ? artifacts[field].map((entry) => projectCouncilSafeMemoryRef(entry))
        : artifacts[field];
    const embeddedArtifact = buildEmbeddedPacketArtifact(field, artifactEntries, limits[field]);
    nextPacket[field] = embeddedArtifact.embedded;
    counts[field] = {
      total: embeddedArtifact.totalCount,
      embedded: embeddedArtifact.embeddedCount
    };
    if (embeddedArtifact.omittedCount > 0) {
      omitted[field] = embeddedArtifact.omittedIds;
      mode = "bounded";
    }
  }

  nextPacket.artifactEmbedding = {
    canonicalSource: "planning-control-plane.packet",
    mode,
    limits,
    counts,
    omitted,
    truncatedFieldCount: Object.keys(omitted).length
  };
  return nextPacket;
}

function hasExternalSwarmArtifacts(value) {
  const external = toObject(value);
  if (normalizeString(external.finalDraftMarkdown)) return true;
  if (Array.isArray(external.roleFindings) && external.roleFindings.length > 0) return true;
  if (Array.isArray(external.agentRuns) && external.agentRuns.length > 0) return true;
  if (Array.isArray(external.planRevisions) && external.planRevisions.length > 0) return true;
  if (Array.isArray(external.roundSummaries) && external.roundSummaries.length > 0) return true;
  if (Array.isArray(external.roleNotes) && external.roleNotes.length > 0) return true;
  if (Array.isArray(external.addressMatrix) && external.addressMatrix.length > 0) return true;
  return false;
}

function summarizeOptions(fingerprint) {
  const options = [{ optionId: "recommended", title: "Recommended staged plan", summary: "Proceed with a reversible-first plan and explicit validation gates." }];
  if (fingerprint.stakes !== "low") options.push({ optionId: "narrower-first-slice", title: "Narrower first slice", summary: "Reduce blast radius by shipping only the minimum safe planning slice first." });
  if (fingerprint.ambiguityLevel === "high") options.push({ optionId: "evidence-first", title: "Evidence-first path", summary: "Delay implementation planning until the highest-risk unknowns are confirmed." });
  return options;
}

function buildSynthesizedPlan(docket, fingerprint, councilBundle, reviewItems, ledger, swarmArtifacts, now) {
  const draftPlanAnalysis = toObject(docket?.draftPlan?.analysis);
  const requiredHumanDecisions = mergeStringLists(
    ledger
      .filter((entry) => entry.resolutionState === "requires_human_decision")
      .map((entry) => reviewItems.find((item) => item.itemId === entry.itemId))
      .filter(Boolean)
      .map((item) => item.statement),
    draftPlanAnalysis.requiredHumanDecisions
  );
  const validationGates = mergeStringLists(
    reviewItems
      .filter((item) => item.type === "required_revision" || item.type === "evidence_gap" || item.type === "approval_with_conditions")
      .map((item) => item.requiredAction),
    draftPlanAnalysis.validationGates
  );
  const failureModes = mergeStringLists(
    fingerprint.failureSurfaces,
    reviewItems.filter((item) => item.affectedPlanSection === "failure_modes").map((item) => item.statement),
    draftPlanAnalysis.risks
  );
  const rollbackRecovery = fingerprint.reversibility === "reversible"
    ? ["Use staged rollout with explicit go/no-go checkpoints.", "Keep a read-only or no-op fallback path until validation gates pass."]
    : ["Define a recovery owner before execution starts.", "Document partial-state recovery and rollback checkpoints."];
  const dissent = reviewItems.filter((item) => ["critical", "high"].includes(item.severity) && ["objection", "required_revision"].includes(item.type)).map((item) => `${item.seat}: ${item.statement}`);
  const draftOrderedSequence = normalizeStringList(draftPlanAnalysis.steps);
  const orderedExecutionSequence = draftOrderedSequence.length > 0
    ? mergeStringLists(
        draftOrderedSequence,
        "Resolve or escalate critical objections.",
        "Lock validation gates and failure-path checks.",
        "Hand off the packet for explicit human arbitration before any execution work."
      )
    : [
        "Confirm objective, scope, and reversibility assumptions.",
        "Validate dependencies and affected systems.",
        "Resolve or escalate critical objections.",
        "Lock validation gates and failure-path checks.",
        "Hand off the packet for explicit human arbitration before any execution work."
      ];

  return {
    planId: buildId("synthesized_plan", { docketId: docket.docketId, councilId: councilBundle.council.councilId, now }),
    councilId: councilBundle.council.councilId,
    docketId: docket.docketId,
    createdAt: now,
    version: 1,
    recommendedPlan: {
      summary: docket.sourceType === "draft-plan"
        ? `Refine the existing draft plan for ${docket.objective} into a go/no-go packet.`
        : `Produce a planning-only execution packet for ${docket.objective}.`,
      orderedExecutionSequence,
      optionsConsidered: summarizeOptions(fingerprint),
      markdown: swarmArtifacts.finalPlanMarkdown,
      planRevisionId: swarmArtifacts.planRevisions.at(-1)?.revisionId ?? null
    },
    validationGates,
    failureModes,
    rollbackRecovery,
    requiredHumanDecisions,
    openQuestions: mergeStringLists(docket.unknowns, draftPlanAnalysis.openQuestions),
    dissent,
    upgradedPlanMarkdown: swarmArtifacts.finalPlanMarkdown,
    planRevisions: swarmArtifacts.planRevisions
  };
}

function buildConfidenceAssessment(docket, fingerprint, ledger) {
  const requiresHumanDecision = ledger.filter((entry) => entry.resolutionState === "requires_human_decision").length;
  const speculativeAssumptions = docket.assumptions.filter((entry) => entry.evidenceLabel === "speculative").length;
  const label = fingerprint.intakeCompleteness === "thin"
    ? "blocked"
    : requiresHumanDecision > 3 || fingerprint.stakes === "critical" || fingerprint.highRiskHumanImpact
      ? "guarded"
      : requiresHumanDecision > 1 || speculativeAssumptions > 2
        ? "moderate"
        : "high";
  return {
    label,
    requiresHumanDecisionCount: requiresHumanDecision,
    speculativeAssumptions,
    rationale:
      label === "high"
        ? "Critical objections are contained and the packet is narrow enough for human review."
        : label === "moderate"
          ? "The packet is usable but still depends on a small set of explicit decisions."
          : label === "blocked"
            ? "The packet is blocked because the intake is still too thin or ambiguous to trust without clarification."
            : "The packet is intentionally guarded because the work has high stakes or unresolved critical decisions."
  };
}

export function buildPlanningPacket(input, governance, options = {}) {
  const now = options.now ?? new Date().toISOString();
  const docket = normalizePlanningDocket(input, { now });
  const fingerprint = fingerprintPlanningDocket(docket, { now });
  const sourceSync = buildRoleSourceSync(governance, { now });
  const roleScoreReport = buildRoleScoreReport(governance, sourceSync.extractedCandidates, { now });
  const councilBundle = buildCouncilAssembly(docket, fingerprint, governance, { now });
  const externalSwarmArtifacts = options.externalSwarmArtifacts ?? input?.externalSwarmArtifacts;
  const useExternalSwarmArtifacts = hasExternalSwarmArtifacts(externalSwarmArtifacts);
  const deterministicReview = useExternalSwarmArtifacts ? null : generateReviewItems(docket, fingerprint, councilBundle, now);
  const reviewRounds = useExternalSwarmArtifacts ? [] : deterministicReview.reviewRounds;
  const reviewItems = useExternalSwarmArtifacts ? [] : deterministicReview.reviewItems;
  const objectionLedger = useExternalSwarmArtifacts ? [] : buildObjectionLedger(reviewItems);
  const swarmArtifacts = useExternalSwarmArtifacts
    ? buildLiveCouncilSwarmArtifacts(docket, fingerprint, governance, councilBundle, { ...options, externalSwarmArtifacts })
    : buildCouncilSwarmArtifacts(docket, fingerprint, governance, councilBundle, reviewItems, objectionLedger, options);
  const normalizedReviewRounds = useExternalSwarmArtifacts ? swarmArtifacts.reviewRounds : reviewRounds;
  const normalizedReviewItems = useExternalSwarmArtifacts ? swarmArtifacts.reviewItems : reviewItems;
  const normalizedObjectionLedger = useExternalSwarmArtifacts ? buildObjectionLedger(normalizedReviewItems) : objectionLedger;
  swarmArtifacts.reviewRounds = normalizedReviewRounds;
  swarmArtifacts.objectionLedger = normalizedObjectionLedger;
  const roleFindings = useExternalSwarmArtifacts
    ? swarmArtifacts.roleFindings
    : deriveRoleFindingsFromReviewItems(normalizedReviewItems, councilBundle, swarmArtifacts);
  const addressMatrix = Array.isArray(swarmArtifacts.addressMatrix) && swarmArtifacts.addressMatrix.length > 0
    ? swarmArtifacts.addressMatrix
    : buildDerivedAddressMatrix(roleFindings, swarmArtifacts.planRevisions, councilBundle.council.councilId);
  const synthesizedPlan = buildSynthesizedPlan(docket, fingerprint, councilBundle, normalizedReviewItems, normalizedObjectionLedger, swarmArtifacts, now);
  const confidenceAssessment = buildConfidenceAssessment(docket, fingerprint, normalizedObjectionLedger);
  const unresolvedHumanDecisionCount = normalizedObjectionLedger.filter((entry) => entry.resolutionState === "requires_human_decision").length;
  const unresolvedCriticalFindingCount = roleFindings.filter((finding) => {
    const normalizedStatus = normalizeString(finding.status);
    return normalizedStatus === "still_blocked" && (Boolean(finding.requiresHumanDecision) || normalizeString(finding.severity) === "critical");
  }).length;
  const goNoGoRecommendation =
    confidenceAssessment.label === "blocked"
      ? "no_go_until_human_decision"
      : unresolvedCriticalFindingCount > 0
        ? "no_go_until_human_decision"
      : (fingerprint.highRiskHumanImpact && unresolvedHumanDecisionCount > 0) || (unresolvedHumanDecisionCount > 1 && (fingerprint.stakes === "critical" || fingerprint.ambiguityLevel === "high"))
        ? "no_go_until_human_decision"
      : synthesizedPlan.requiredHumanDecisions.length > 0 || confidenceAssessment.label !== "high"
        ? "go_with_conditions"
        : "go";
  const goNoGoWhy =
    goNoGoRecommendation === "no_go_until_human_decision"
      ? "Critical objections remain unresolved and need explicit human arbitration before implementation can begin."
      : goNoGoRecommendation === "go_with_conditions"
        ? "The upgraded plan is usable, but it still depends on explicit validation gates and isolated human decisions."
        : "The upgraded plan is narrow enough and the recorded objections are contained well enough to proceed after review.";
  const topObjectionsOrDissent = synthesizedPlan.dissent.slice(0, 8);

  const packet = embedPlanningPacketArtifacts({
    packetId: buildId("human_packet", { docketId: docket.docketId, councilId: councilBundle.council.councilId, now }),
    createdAt: now,
    status: "ready_for_human",
    docketId: docket.docketId,
    councilId: councilBundle.council.councilId,
    synthesizedPlanId: synthesizedPlan.planId,
    objective: docket.objective,
    whyNow: docket.whyNow,
    successCriteria: docket.successCriteria,
    constraints: docket.constraints,
    knownFacts: docket.knownFacts,
    assumptionsAndUnknowns: { assumptions: docket.assumptions, unknowns: docket.unknowns },
    stakeholdersSelected: councilBundle.stakeholders,
    councilSeatsSelected: councilBundle.seats,
    optionsConsidered: synthesizedPlan.recommendedPlan.optionsConsidered,
    recommendedPlan: synthesizedPlan.recommendedPlan,
    orderedExecutionSequence: synthesizedPlan.recommendedPlan.orderedExecutionSequence,
    validationGates: synthesizedPlan.validationGates,
    failureModes: synthesizedPlan.failureModes,
    rollbackRecovery: synthesizedPlan.rollbackRecovery,
    requiredHumanDecisions: synthesizedPlan.requiredHumanDecisions,
    openQuestions: synthesizedPlan.openQuestions,
    confidenceAssessment,
    dissent: synthesizedPlan.dissent,
    rationaleForOmittedStakeholdersOrSeats: councilBundle.council.audit,
    reviewMode: docket.reviewMode,
    draftSource: docket.draftSource,
    memoryPolicyMode: docket.memoryPolicy.mode,
    upgradedPlanMarkdown: swarmArtifacts.finalPlanMarkdown,
    goNoGoRecommendation,
    goNoGoWhy,
    why: goNoGoWhy,
    topObjectionsOrDissent,
    artifactRefs: Array.isArray(options.artifactRefs) ? options.artifactRefs : [],
  }, {
    agentRuns: swarmArtifacts.agentRuns,
    roleFindings,
    roleNotes: swarmArtifacts.roleNotes,
    planRevisions: swarmArtifacts.planRevisions,
    roundSummaries: swarmArtifacts.roundSummaries,
    memoryRefs: swarmArtifacts.memoryRefs,
    addressMatrix
  }, options);

  const council = {
    ...councilBundle.council,
    status: "ready_for_human",
    swarmRun: swarmArtifacts.swarmRun,
    agentRuns: swarmArtifacts.agentRuns,
    roundSummaries: swarmArtifacts.roundSummaries,
    memoryRefs: swarmArtifacts.memoryRefs,
    roleFindings,
    roleNotes: swarmArtifacts.roleNotes,
    planRevisions: swarmArtifacts.planRevisions,
    addressMatrix,
  };

  return {
    generatedAt: now,
    docket,
    fingerprint,
    sourceSync,
    roleScoreReport,
    stakeholders: councilBundle.stakeholders,
    council,
    councilSeats: councilBundle.seats,
    reviewRounds: normalizedReviewRounds,
    reviewItems: normalizedReviewItems,
    objectionLedger: normalizedObjectionLedger,
    swarmRun: swarmArtifacts.swarmRun,
    agentRuns: swarmArtifacts.agentRuns,
    roundSummaries: swarmArtifacts.roundSummaries,
    memoryRefs: swarmArtifacts.memoryRefs,
    roleFindings,
    roleNotes: swarmArtifacts.roleNotes,
    planRevisions: swarmArtifacts.planRevisions,
    addressMatrix,
    synthesizedPlan,
    packet
  };
}

export function writeJsonArtifact(repoRoot, relativePath, payload) {
  const absolutePath = resolve(repoRoot, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return absolutePath;
}
