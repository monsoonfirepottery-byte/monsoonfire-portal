import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import {
  DEFAULT_INTENTS_DIR,
  loadIntentEntries,
  validateIntentEntries,
} from "./intent-control-plane.mjs";

export const DEFAULT_AGENT_TOOL_REGISTRY_PATH = "config/agent-tool-contracts.json";
export const DEFAULT_AGENT_TOOL_PRIMITIVE_FAMILY_PATH = "config/agent-tool-primitives.json";
export const DEFAULT_AGENT_RUNS_ROOT = "output/agent-runs";
export const DEFAULT_INTENT_PLAN_PATH = "artifacts/intent-plan.generated.json";
export const DEFAULT_CODEX_MODEL_POLICY_PATH = "config/codex-model-policy.json";

const VALID_MODEL_REASONING_EFFORTS = new Set(["low", "medium", "high", "xhigh"]);

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function stableHash(value, length = 16) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, length);
}

function normalizeStringList(value, maxItems = 32) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const output = [];
  for (const entry of value) {
    const normalized = clean(entry);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
    if (output.length >= maxItems) break;
  }
  return output;
}

function readJsonFileIfExists(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function normalizeToolInputContracts(inputs) {
  if (!Array.isArray(inputs)) return [];
  return inputs
    .map((input) => {
      if (!input || typeof input !== "object") return null;
      const name = clean(input.name);
      if (!name) return null;
      return {
        name,
        required: input.required === true,
        description: clean(input.description),
      };
    })
    .filter(Boolean);
}

function normalizeNativeSpec(nativeSpec) {
  if (!nativeSpec || typeof nativeSpec !== "object") return null;
  const argv = Array.isArray(nativeSpec.argv)
    ? nativeSpec.argv.map((entry) => clean(entry)).filter(Boolean)
    : [];
  const probeArgv = Array.isArray(nativeSpec.probeArgv)
    ? nativeSpec.probeArgv.map((entry) => clean(entry)).filter(Boolean)
    : [];
  const runner = clean(nativeSpec.runner);
  const cwd = clean(nativeSpec.cwd);
  const shellCommand = clean(nativeSpec.shellCommand);
  const probeCommand = clean(nativeSpec.probeCommand);
  if (!runner && argv.length === 0 && probeArgv.length === 0 && !shellCommand && !probeCommand) return null;
  return {
    ...(runner ? { runner } : {}),
    ...(cwd ? { cwd } : {}),
    ...(argv.length > 0 ? { argv } : {}),
    ...(probeArgv.length > 0 ? { probeArgv } : {}),
    ...(shellCommand ? { shellCommand } : {}),
    ...(probeCommand ? { probeCommand } : {}),
  };
}

function normalizeApprovalPolicy(policy) {
  if (!policy || typeof policy !== "object") return null;
  const tier = clean(policy.tier);
  if (!tier) return null;
  const requiredEvidence = normalizeStringList(policy.requiredEvidence || [], 32);
  return {
    tier,
    ...(clean(policy.why) ? { why: clean(policy.why) } : {}),
    ...(requiredEvidence.length > 0 ? { requiredEvidence } : {}),
    ...(policy.blockedIfDirty !== undefined ? { blockedIfDirty: Boolean(policy.blockedIfDirty) } : {}),
    ...(policy.liveSurface !== undefined ? { liveSurface: Boolean(policy.liveSurface) } : {}),
  };
}

function envKeyForModelRole(roleName, suffix = "") {
  const normalized = clean(roleName).toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  return suffix ? `CODEX_MODEL_${normalized}_${suffix}` : `CODEX_MODEL_${normalized}`;
}

function normalizeModelPolicyRole(roleName, role, env = process.env) {
  const preferred = normalizeStringList(role?.preferred || [], 16);
  const fallback = clean(role?.fallback) || preferred.at(-1) || "";
  const modelOverride = clean(env?.[envKeyForModelRole(roleName)] || "");
  const effortOverride = clean(env?.[envKeyForModelRole(roleName, "REASONING_EFFORT")] || "");
  const configuredEffort = clean(role?.reasoningEffort || "medium");
  const reasoningEffort = VALID_MODEL_REASONING_EFFORTS.has(effortOverride)
    ? effortOverride
    : VALID_MODEL_REASONING_EFFORTS.has(configuredEffort)
      ? configuredEffort
      : "medium";
  const model = modelOverride || preferred[0] || fallback;
  return {
    model,
    reasoningEffort,
    fallback,
    preferred,
    source: modelOverride ? "env" : "policy",
  };
}

function mergeToolDefinition(defaults = {}, entry = {}) {
  const merged = {
    ...defaults,
    ...entry,
  };
  const inputs = normalizeToolInputContracts(entry.inputs ?? defaults.inputs);
  if (inputs.length > 0) merged.inputs = inputs;
  const lifecycleDefaults = defaults.lifecycle && typeof defaults.lifecycle === "object" ? defaults.lifecycle : null;
  const lifecycleEntry = entry.lifecycle && typeof entry.lifecycle === "object" ? entry.lifecycle : null;
  if (lifecycleDefaults || lifecycleEntry) {
    merged.lifecycle = {
      ...(lifecycleDefaults || {}),
      ...(lifecycleEntry || {}),
    };
  }
  const approvalDefaults = defaults.approvalPolicy && typeof defaults.approvalPolicy === "object" ? defaults.approvalPolicy : null;
  const approvalEntry = entry.approvalPolicy && typeof entry.approvalPolicy === "object" ? entry.approvalPolicy : null;
  if (approvalDefaults || approvalEntry) {
    merged.approvalPolicy = {
      ...(approvalDefaults || {}),
      ...(approvalEntry || {}),
    };
  }
  return merged;
}

function pickToolContractFields(tool, overrides = {}) {
  const resolved = {
    toolId: clean(overrides.toolId ?? tool.toolId),
    kind: clean(overrides.kind ?? tool.kind),
    command: clean(overrides.command ?? tool.command),
    purpose: clean(overrides.purpose ?? tool.purpose),
    inputs: normalizeToolInputContracts(overrides.inputs ?? tool.inputs),
    sideEffects: clean(overrides.sideEffects ?? tool.sideEffects),
    dryRunSupport: overrides.dryRunSupport ?? tool.dryRunSupport,
    verificationCommand: clean(overrides.verificationCommand ?? tool.verificationCommand),
    safeFailBehavior: clean(overrides.safeFailBehavior ?? tool.safeFailBehavior),
    rollbackBehavior: clean(overrides.rollbackBehavior ?? tool.rollbackBehavior),
    selectableByAgent:
      overrides.selectableByAgent !== undefined
        ? overrides.selectableByAgent
        : tool.selectableByAgent,
    lifecycle:
      overrides.lifecycle !== undefined
        ? overrides.lifecycle
        : tool.lifecycle,
    generatedFrom:
      overrides.generatedFrom !== undefined
        ? overrides.generatedFrom
        : tool.generatedFrom,
    nativeSpec:
      overrides.nativeSpec !== undefined
        ? overrides.nativeSpec
        : tool.nativeSpec,
    approvalPolicy:
      overrides.approvalPolicy !== undefined
        ? overrides.approvalPolicy
        : tool.approvalPolicy,
  };

  return {
    toolId: resolved.toolId,
    kind: resolved.kind,
    ...(resolved.selectableByAgent !== undefined ? { selectableByAgent: Boolean(resolved.selectableByAgent) } : {}),
    command: resolved.command,
    purpose: resolved.purpose,
    ...(resolved.inputs.length > 0 ? { inputs: resolved.inputs } : {}),
    sideEffects: resolved.sideEffects,
    dryRunSupport: Boolean(resolved.dryRunSupport),
    verificationCommand: resolved.verificationCommand,
    safeFailBehavior: resolved.safeFailBehavior,
    rollbackBehavior: resolved.rollbackBehavior,
    ...(resolved.lifecycle && typeof resolved.lifecycle === "object" ? { lifecycle: resolved.lifecycle } : {}),
    ...(resolved.generatedFrom && typeof resolved.generatedFrom === "object" ? { generatedFrom: resolved.generatedFrom } : {}),
    ...(normalizeNativeSpec(resolved.nativeSpec) ? { nativeSpec: normalizeNativeSpec(resolved.nativeSpec) } : {}),
    ...(normalizeApprovalPolicy(resolved.approvalPolicy) ? { approvalPolicy: normalizeApprovalPolicy(resolved.approvalPolicy) } : {}),
  };
}

function compileNamecheapLiveDeployFamily(family) {
  const defaults = family?.defaults && typeof family.defaults === "object" ? family.defaults : {};
  const entries = Array.isArray(family?.entries) ? family.entries : [];
  return entries.map((entry) => {
    const merged = mergeToolDefinition(defaults, entry);
    const remotePath = clean(entry?.remotePath || defaults.remotePath);
    const portalUrl = clean(entry?.portalUrl || defaults.portalUrl);
    const argv = ["node", "./scripts/deploy-namecheap-portal.mjs"];
    if (remotePath) argv.push("--remote-path", remotePath);
    if (entry?.verify !== false && defaults.verify !== false) argv.push("--verify");
    if (portalUrl) argv.push("--portal-url", portalUrl);
    if (entry?.noBuild === true) argv.push("--no-build");
    const probeArgv = [...argv, "--benchmark-probe", "--json"];
    return pickToolContractFields(merged, {
      kind: clean(merged.kind || "runtime-primitive"),
      command: argv.join(" "),
      verificationCommand:
        clean(merged.verificationCommand) ||
        (portalUrl
          ? `node ./scripts/portal-playwright-smoke.mjs --base-url ${portalUrl} --output-dir output/playwright/portal/prod`
          : ""),
      nativeSpec: {
        runner: "process.spawn",
        cwd: ".",
        argv,
        probeArgv,
        shellCommand: argv.join(" "),
        probeCommand: probeArgv.join(" "),
      },
      generatedFrom: {
        familyId: clean(family?.familyId),
        builder: clean(family?.builder),
      },
    });
  });
}

function compilePlaywrightSmokeVerifierFamily(family) {
  const defaults = family?.defaults && typeof family.defaults === "object" ? family.defaults : {};
  const entries = Array.isArray(family?.entries) ? family.entries : [];
  return entries.map((entry) => {
    const merged = mergeToolDefinition(defaults, entry);
    const script = clean(entry?.script || defaults.script);
    const baseUrl = clean(entry?.baseUrl || defaults.baseUrl);
    const outputDir = clean(entry?.outputDir || defaults.outputDir);
    const deep = entry?.deep === true || (entry?.deep === undefined && defaults.deep === true);
    const argv = ["node", script];
    if (baseUrl) argv.push("--base-url", baseUrl);
    if (outputDir) argv.push("--output-dir", outputDir);
    if (deep) argv.push("--deep");
    const probeArgv = [...argv, "--benchmark-probe", "--json"];
    const inputs = normalizeToolInputContracts(
      entry.inputs ??
        defaults.inputs ??
        (deep
          ? [{ name: "--deep", required: false, description: "Run the deeper journey coverage profile." }]
          : []),
    );
    return pickToolContractFields(merged, {
      kind: clean(merged.kind || "runtime-primitive"),
      inputs,
      command: argv.join(" "),
      verificationCommand: clean(merged.verificationCommand) || argv.join(" "),
      nativeSpec: {
        runner: "process.spawn",
        cwd: ".",
        argv,
        probeArgv,
        shellCommand: argv.join(" "),
        probeCommand: probeArgv.join(" "),
      },
      generatedFrom: {
        familyId: clean(family?.familyId),
        builder: clean(family?.builder),
      },
    });
  });
}

function compileNativeBrowserShadowVerifierFamily(family) {
  const defaults = family?.defaults && typeof family.defaults === "object" ? family.defaults : {};
  const entries = Array.isArray(family?.entries) ? family.entries : [];
  return entries.map((entry) => {
    const merged = mergeToolDefinition(defaults, entry);
    const script = clean(entry?.script || defaults.script || "./scripts/native-browser-shadow-verifier.mjs");
    const surface = clean(entry?.surface || defaults.surface);
    const baseUrl = clean(entry?.baseUrl || defaults.baseUrl);
    const outputDir = clean(entry?.outputDir || defaults.outputDir);
    const shadowOf = clean(entry?.shadowOf || defaults.shadowOf);
    const canonicalArtifactRoot = clean(entry?.canonicalArtifactRoot || defaults.canonicalArtifactRoot);
    const expectedPortalHost = clean(entry?.expectedPortalHost || defaults.expectedPortalHost);
    const deep = entry?.deep === true || (entry?.deep === undefined && defaults.deep === true);
    const execute = entry?.execute === true || (entry?.execute === undefined && defaults.execute === true);
    const appHandoff = entry?.appHandoff === true || (entry?.appHandoff === undefined && defaults.appHandoff === true);
    const argv = ["node", script];
    if (surface) argv.push("--surface", surface);
    if (baseUrl) argv.push("--base-url", baseUrl);
    if (outputDir) argv.push("--output-dir", outputDir);
    if (shadowOf) argv.push("--shadow-of", shadowOf);
    if (canonicalArtifactRoot) argv.push("--canonical-artifact-root", canonicalArtifactRoot);
    if (expectedPortalHost) argv.push("--expected-portal-host", expectedPortalHost);
    if (deep) argv.push("--deep");
    if (appHandoff) argv.push("--app-handoff");
    else if (execute) argv.push("--execute");
    const probeArgv = [...argv, "--benchmark-probe", "--json"];
    const inputs = normalizeToolInputContracts(
      entry.inputs ??
        defaults.inputs ??
        [
          { name: "--deep", required: false, description: "Prepare the deeper native-browser shadow profile." },
          { name: "--execute", required: false, description: "Run the bounded codex.exec shadow lane instead of only preparing artifacts." },
          { name: "--app-handoff", required: false, description: "Prepare a Codex desktop in-app browser handoff instead of shell execution." },
        ],
    );
    return pickToolContractFields(merged, {
      kind: clean(merged.kind || "runtime-primitive"),
      inputs,
      command: argv.join(" "),
      verificationCommand: clean(merged.verificationCommand) || argv.join(" "),
      nativeSpec: {
        runner: "process.spawn",
        cwd: ".",
        argv,
        probeArgv,
        shellCommand: argv.join(" "),
        probeCommand: probeArgv.join(" "),
      },
      generatedFrom: {
        familyId: clean(family?.familyId),
        builder: clean(family?.builder),
      },
    });
  });
}

export function compileToolPrimitiveFamilies(familyRegistry) {
  if (!familyRegistry || typeof familyRegistry !== "object") {
    return {
      schema: "agent-tool-contract-registry.v1",
      generatedAt: new Date().toISOString(),
      tools: [],
      primitiveFamilies: {
        generatedCount: 0,
        familyCount: 0,
      },
    };
  }
  if (familyRegistry.schema !== "agent-tool-primitive-family-registry.v1") {
    throw new Error(`Unexpected tool primitive family schema: ${familyRegistry.schema || "missing"}.`);
  }
  const families = Array.isArray(familyRegistry.families) ? familyRegistry.families : [];
  const generatedTools = [];
  for (const family of families) {
    const builder = clean(family?.builder);
    if (!builder) continue;
    if (builder === "namecheap-live-deploy") {
      generatedTools.push(...compileNamecheapLiveDeployFamily(family));
      continue;
    }
    if (builder === "playwright-smoke-verifier") {
      generatedTools.push(...compilePlaywrightSmokeVerifierFamily(family));
      continue;
    }
    if (builder === "native-browser-shadow-verifier") {
      generatedTools.push(...compileNativeBrowserShadowVerifierFamily(family));
      continue;
    }
    throw new Error(`Unsupported tool primitive family builder: ${builder}.`);
  }
  return {
    schema: "agent-tool-contract-registry.v1",
    generatedAt: new Date().toISOString(),
    tools: generatedTools,
    primitiveFamilies: {
      generatedCount: generatedTools.length,
      familyCount: families.length,
    },
  };
}

export function mergeToolContractRegistries(baseRegistry, generatedRegistry) {
  const baseTools = Array.isArray(baseRegistry?.tools) ? baseRegistry.tools : [];
  const generatedTools = Array.isArray(generatedRegistry?.tools) ? generatedRegistry.tools : [];
  return {
    schema: "agent-tool-contract-registry.v1",
    generatedAt: clean(baseRegistry?.generatedAt) || clean(generatedRegistry?.generatedAt) || new Date().toISOString(),
    tools: [...baseTools, ...generatedTools],
    primitiveFamilies: {
      generatedCount: generatedTools.length,
      familyCount: Number(generatedRegistry?.primitiveFamilies?.familyCount || 0),
    },
  };
}

function runShellJson(repoRoot, command, args = []) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1024 * 1024 * 12,
    env: process.env,
  });
  const stdout = String(result.stdout || "");
  let json = null;
  try {
    json = JSON.parse(stdout);
  } catch {
    json = null;
  }
  return {
    ok: result.status === 0,
    status: result.status,
    stdout,
    stderr: String(result.stderr || ""),
    json,
  };
}

function runShellText(repoRoot, command, args = []) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1024 * 1024 * 12,
    env: process.env,
  });
  return {
    ok: result.status === 0,
    stdout: clean(result.stdout),
    stderr: clean(result.stderr),
  };
}

export function loadCompiledIntentPlan(repoRoot, artifactPath = DEFAULT_INTENT_PLAN_PATH) {
  const absolutePath = resolve(repoRoot, artifactPath);
  const plan = readJsonFileIfExists(absolutePath);
  if (!plan || !Array.isArray(plan.intents) || !Array.isArray(plan.tasks)) {
    throw new Error(`Compiled intent plan is missing or invalid at ${artifactPath}.`);
  }
  return {
    absolutePath,
    relativePath: relative(repoRoot, absolutePath).replaceAll("\\", "/"),
    plan,
  };
}

export function loadIntentSources(repoRoot, intentsDir = DEFAULT_INTENTS_DIR) {
  const entries = loadIntentEntries(repoRoot, intentsDir);
  const validation = validateIntentEntries(repoRoot, entries);
  if (validation.findings.some((finding) => finding.severity === "error")) {
    const summary = validation.findings
      .filter((finding) => finding.severity === "error")
      .slice(0, 6)
      .map((finding) => `${finding.file}: ${finding.message}`)
      .join("; ");
    throw new Error(`Intent sources are invalid: ${summary}`);
  }
  return new Map(validation.validEntries.map((entry) => [entry.intent.intentId, entry.intent]));
}

export function validateToolContractRegistry(registry) {
  const findings = [];
  if (!registry || typeof registry !== "object") {
    findings.push({ severity: "error", message: "Tool contract registry must be an object." });
    return { status: "fail", findings, tools: [] };
  }
  if (registry.schema !== "agent-tool-contract-registry.v1") {
    findings.push({ severity: "error", message: `Unexpected tool registry schema: ${registry.schema || "missing"}.` });
  }
  const tools = Array.isArray(registry.tools) ? registry.tools : [];
  if (tools.length === 0) {
    findings.push({ severity: "error", message: "Tool contract registry must include at least one tool." });
  }

  const seenIds = new Set();
  for (const tool of tools) {
    const toolId = clean(tool?.toolId);
    if (!toolId) {
      findings.push({ severity: "error", message: "Tool contract is missing toolId." });
      continue;
    }
    if (seenIds.has(toolId)) {
      findings.push({ severity: "error", message: `Duplicate toolId detected: ${toolId}.` });
    }
    seenIds.add(toolId);
    if (!clean(tool?.purpose)) findings.push({ severity: "error", message: `${toolId} is missing purpose.` });
    if (!clean(tool?.command)) findings.push({ severity: "error", message: `${toolId} is missing command.` });
    if (!clean(tool?.verificationCommand)) findings.push({ severity: "error", message: `${toolId} is missing verificationCommand.` });
    if (!clean(tool?.safeFailBehavior)) findings.push({ severity: "error", message: `${toolId} is missing safeFailBehavior.` });
    if (!clean(tool?.rollbackBehavior)) findings.push({ severity: "error", message: `${toolId} is missing rollbackBehavior.` });
    if (tool?.selectableByAgent !== undefined && typeof tool.selectableByAgent !== "boolean") {
      findings.push({ severity: "error", message: `${toolId} has an invalid selectableByAgent flag.` });
    }
    if (clean(tool?.kind) === "runtime-primitive") {
      const nativeSpec = normalizeNativeSpec(tool?.nativeSpec);
      if (!nativeSpec) {
        findings.push({ severity: "error", message: `${toolId} is missing nativeSpec.` });
      } else if (nativeSpec.argv?.length === 0) {
        findings.push({ severity: "error", message: `${toolId} nativeSpec must include argv.` });
      }
    }
    if (clean(tool?.kind) === "repo-script") {
      const lifecycle = tool?.lifecycle && typeof tool.lifecycle === "object" ? tool.lifecycle : {};
      if (!clean(lifecycle.owner)) findings.push({ severity: "error", message: `${toolId} is missing lifecycle.owner.` });
      if (!Number.isFinite(Number(lifecycle.reviewEveryDays)) || Number(lifecycle.reviewEveryDays) <= 0) {
        findings.push({ severity: "error", message: `${toolId} is missing lifecycle.reviewEveryDays.` });
      }
      if (!clean(lifecycle.retireWhen)) findings.push({ severity: "error", message: `${toolId} is missing lifecycle.retireWhen.` });
    }
    if (tool?.approvalPolicy !== undefined) {
      const approvalPolicy = normalizeApprovalPolicy(tool.approvalPolicy);
      const validTiers = new Set(["no_approval", "auto_review_ok", "human_required", "human_required_for_mutation"]);
      if (!approvalPolicy) {
        findings.push({ severity: "error", message: `${toolId} has invalid approvalPolicy metadata.` });
      } else if (!validTiers.has(approvalPolicy.tier)) {
        findings.push({ severity: "error", message: `${toolId} has unknown approvalPolicy tier: ${approvalPolicy.tier}.` });
      }
      if (/deploy|send|cleanup|delete|memory_write|hygiene_write/i.test(clean(tool.sideEffects)) && approvalPolicy?.tier === "no_approval") {
        findings.push({ severity: "warning", message: `${toolId} declares mutating side effects with no_approval.` });
      }
    }
  }

  return {
    status: findings.some((finding) => finding.severity === "error") ? "fail" : "pass",
    findings,
    tools,
  };
}

export function buildAgentSelectableToolRegistry(registry) {
  const tools = Array.isArray(registry?.tools) ? registry.tools : [];
  return {
    ...registry,
    tools: tools.filter((tool) => tool?.selectableByAgent !== false),
  };
}

export function auditToolContractLifecycle(registry) {
  const tools = Array.isArray(registry?.tools) ? registry.tools : [];
  const toolIndex = new Map(
    tools
      .map((tool) => [clean(tool?.toolId), tool])
      .filter(([toolId]) => Boolean(toolId))
  );
  const now = Date.now();
  const findings = [];

  for (const tool of tools) {
    if (clean(tool?.kind) !== "repo-script") continue;
    const lifecycle = tool?.lifecycle && typeof tool.lifecycle === "object" ? tool.lifecycle : {};
    const selectableByAgent = tool?.selectableByAgent !== false;
    const owner = clean(lifecycle.owner);
    const reviewEveryDays = Number(lifecycle.reviewEveryDays || 0);
    const lastReviewedAt = clean(lifecycle.lastReviewedAt);
    const nativeAlternative = clean(lifecycle.nativeAlternative);
    const className = clean(lifecycle.class || "wrapper");
    const reviewedMs = lastReviewedAt ? Date.parse(lastReviewedAt) : Number.NaN;
    const overdue =
      Number.isFinite(reviewedMs) && Number.isFinite(reviewEveryDays) && reviewEveryDays > 0
        ? now - reviewedMs > reviewEveryDays * 24 * 60 * 60 * 1000
        : true;

    if (!owner || reviewEveryDays <= 0) {
      findings.push({
        severity: "error",
        toolId: clean(tool?.toolId),
        message: "Wrapper lifecycle metadata is incomplete.",
      });
      continue;
    }

    if (!nativeAlternative) {
      findings.push({
        severity: "warning",
        toolId: clean(tool?.toolId),
        message: "Wrapper does not declare a nativeAlternative or direct primitive it should defer to later.",
      });
    } else if (selectableByAgent) {
      const alternativeTool = toolIndex.get(nativeAlternative);
      if (alternativeTool && clean(alternativeTool?.kind) !== "repo-script") {
        findings.push({
          severity: "warning",
          toolId: clean(tool?.toolId),
          message: `Wrapper has a registered native alternative (${nativeAlternative}); confirm the local shim is still needed.`,
        });
      }
    }

    if (overdue) {
      findings.push({
        severity: "warning",
        toolId: clean(tool?.toolId),
        message: `${className} review is overdue for ${clean(tool?.toolId)}.`,
      });
    }
  }

  return {
    schema: "agent-tool-contract-lifecycle-audit.v1",
    generatedAt: new Date().toISOString(),
    findings,
    status: findings.some((finding) => finding.severity === "error") ? "fail" : findings.length ? "warn" : "pass",
  };
}

export function loadToolContractRegistry(
  repoRoot,
  registryPath = DEFAULT_AGENT_TOOL_REGISTRY_PATH,
  primitiveFamilyPath = DEFAULT_AGENT_TOOL_PRIMITIVE_FAMILY_PATH,
) {
  const absolutePath = resolve(repoRoot, registryPath);
  const baseRegistry = readJsonFileIfExists(absolutePath);
  const primitiveAbsolutePath = resolve(repoRoot, primitiveFamilyPath);
  const primitiveFamilyRegistry = readJsonFileIfExists(primitiveAbsolutePath);
  const generatedRegistry = primitiveFamilyRegistry ? compileToolPrimitiveFamilies(primitiveFamilyRegistry) : null;
  const registry = generatedRegistry ? mergeToolContractRegistries(baseRegistry, generatedRegistry) : baseRegistry;
  const validation = validateToolContractRegistry(registry);
  if (validation.status !== "pass") {
    const summary = validation.findings.map((finding) => finding.message).join("; ");
    throw new Error(`Tool contract registry is invalid: ${summary}`);
  }
  return {
    absolutePath,
    relativePath: relative(repoRoot, absolutePath).replaceAll("\\", "/"),
    primitiveAbsolutePath: primitiveFamilyRegistry ? primitiveAbsolutePath : null,
    primitiveRelativePath:
      primitiveFamilyRegistry ? relative(repoRoot, primitiveAbsolutePath).replaceAll("\\", "/") : null,
    registry,
  };
}

export function validateCodexModelPolicy(policy) {
  const findings = [];
  if (!policy || typeof policy !== "object") {
    findings.push({ severity: "error", message: "Codex model policy must be an object." });
    return { status: "fail", findings, roles: {} };
  }
  if (policy.schema !== "codex-model-policy.v1") {
    findings.push({ severity: "error", message: `Unexpected model policy schema: ${policy.schema || "missing"}.` });
  }
  const roles = policy.roles && typeof policy.roles === "object" ? policy.roles : {};
  if (Object.keys(roles).length === 0) {
    findings.push({ severity: "error", message: "Codex model policy must include at least one role." });
  }
  for (const [roleName, role] of Object.entries(roles)) {
    const preferred = normalizeStringList(role?.preferred || [], 16);
    if (preferred.length === 0 && !clean(role?.fallback)) {
      findings.push({ severity: "error", message: `${roleName} must include preferred models or a fallback model.` });
    }
    const effort = clean(role?.reasoningEffort || "medium");
    if (!VALID_MODEL_REASONING_EFFORTS.has(effort)) {
      findings.push({ severity: "error", message: `${roleName} has invalid reasoningEffort: ${effort || "missing"}.` });
    }
  }
  return {
    status: findings.some((finding) => finding.severity === "error") ? "fail" : "pass",
    findings,
    roles,
  };
}

export function loadCodexModelPolicy(repoRoot, policyPath = DEFAULT_CODEX_MODEL_POLICY_PATH) {
  const absolutePath = resolve(repoRoot, policyPath);
  const policy = readJsonFileIfExists(absolutePath);
  const validation = validateCodexModelPolicy(policy);
  if (validation.status !== "pass") {
    const summary = validation.findings.map((finding) => finding.message).join("; ");
    throw new Error(`Codex model policy is invalid: ${summary}`);
  }
  return {
    absolutePath,
    relativePath: relative(repoRoot, absolutePath).replaceAll("\\", "/"),
    policy,
    validation,
  };
}

export function resolveCodexModelPolicy(repoRoot, options = {}, dependencies = {}) {
  const policyBundle = dependencies.policyBundle ?? loadCodexModelPolicy(repoRoot, options.policyPath);
  const policy = dependencies.policy ?? policyBundle.policy;
  const env = dependencies.env ?? process.env;
  const roles = policy.roles && typeof policy.roles === "object" ? policy.roles : {};
  const resolvedRoles = Object.fromEntries(
    Object.entries(roles).map(([roleName, role]) => [roleName, normalizeModelPolicyRole(roleName, role, env)]),
  );
  const implementationDefault = resolvedRoles.implementation_default || normalizeModelPolicyRole("implementation_default", {}, env);
  const planningDeep = resolvedRoles.planning_deep || implementationDefault;
  const cheapHygiene = resolvedRoles.cheap_hygiene || implementationDefault;
  const fastUiIteration = resolvedRoles.fast_ui_iteration || implementationDefault;
  const approvalReview = resolvedRoles.approval_review || implementationDefault;
  return {
    schema: "agent-model-policy.v1",
    generatedAt: clean(options.generatedAt) || new Date().toISOString(),
    source: policyBundle.relativePath || clean(options.policyPath) || DEFAULT_CODEX_MODEL_POLICY_PATH,
    standard: implementationDefault.model,
    planning: planningDeep.model,
    hygiene: cheapHygiene.model,
    roles: {
      implementation_default: implementationDefault,
      planning_deep: planningDeep,
      fast_ui_iteration: fastUiIteration,
      cheap_hygiene: cheapHygiene,
      approval_review: approvalReview,
      ...resolvedRoles,
    },
  };
}

function inferRiskLane(selectedIntents, preferredLane = "") {
  const normalizedPreferred = clean(preferredLane).toLowerCase();
  if (normalizedPreferred === "interactive" || normalizedPreferred === "background" || normalizedPreferred === "high_risk") {
    return normalizedPreferred;
  }
  const riskTiers = new Set(selectedIntents.map((intent) => clean(intent.constraints?.riskTier || intent.riskTier).toLowerCase()));
  if (riskTiers.has("critical") || riskTiers.has("high")) return "high_risk";
  return "background";
}

function buildMutationPolicy(platform = process.platform) {
  const isWindows = clean(platform).toLowerCase() === "win32";
  return {
    schema: "agent-mutation-policy.v1",
    platform: clean(platform) || process.platform,
    preferredPrimitive: isWindows ? "workspace.mutation.file-plan" : "functions.apply_patch",
    fallbackPrimitive: isWindows ? "functions.apply_patch" : "workspace.mutation.file-plan",
    maxFilesPerBatch: isWindows ? 4 : 8,
    maxWriteOpsPerBatch: isWindows ? 12 : 20,
    maxInlinePatchBytes: isWindows ? 12_000 : 48_000,
    batchStrategy: isWindows ? "file-by-file" : "group-compatible-files",
    rationale: isWindows
      ? "Prefer file-backed edit plans on Windows to avoid oversized inline patch payloads and path-handling failures."
      : "Prefer direct patching unless the edit set grows large enough to benefit from a file-backed plan.",
  };
}

function aggregateConstraints(selectedIntents) {
  const positiveNumbers = (values) => values.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0);
  const minOrNull = (values) => {
    const filtered = positiveNumbers(values);
    return filtered.length > 0 ? Math.min(...filtered) : null;
  };

  return {
    maxChangedFiles: minOrNull(selectedIntents.map((intent) => intent?.constraints?.maxChangedFiles)),
    maxWriteActions: minOrNull(selectedIntents.map((intent) => intent?.constraints?.maxWriteActions)),
    approvalRequiredFor: normalizeStringList(selectedIntents.flatMap((intent) => intent?.authority?.approvalRequiredFor || [])),
    writePolicies: normalizeStringList(selectedIntents.map((intent) => intent?.constraints?.writePolicy || "")),
  };
}

export function buildMissionEnvelope(repoRoot, options = {}, dependencies = {}) {
  const planBundle = dependencies.plan ? { plan: dependencies.plan, relativePath: DEFAULT_INTENT_PLAN_PATH } : loadCompiledIntentPlan(repoRoot);
  const plan = planBundle.plan;
  const intentSources = dependencies.intentSources || loadIntentSources(repoRoot);
  const compiledIntentMap = new Map((Array.isArray(plan.intents) ? plan.intents : []).map((intent) => [intent.intentId, intent]));
  const requestedIntentIds = normalizeStringList(
    Array.isArray(options.intentIds) && options.intentIds.length > 0
      ? options.intentIds
      : plan.intents.map((intent) => intent.intentId),
    256,
  );
  const selectedIntents = requestedIntentIds
    .map((intentId) => intentSources.get(intentId) || compiledIntentMap.get(intentId))
    .filter(Boolean);

  if (selectedIntents.length === 0) {
    throw new Error("No valid intents were selected for the mission envelope.");
  }

  const taskRefs = plan.tasks.filter((task) => requestedIntentIds.includes(task.intentId));
  const constraintSummary = aggregateConstraints(selectedIntents);
  const riskLane = inferRiskLane(selectedIntents, options.riskLane);
  const runId = clean(options.runId) || `agent-run-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const missionId = clean(options.missionId) || `mission_${stableHash(requestedIntentIds.join("|"), 18)}`;
  const generatedAt = clean(options.generatedAt) || new Date().toISOString();
  const modelPolicy =
    dependencies.modelPolicy ||
    resolveCodexModelPolicy(
      repoRoot,
      { policyPath: options.modelPolicyPath, generatedAt },
      {
        policyBundle: dependencies.modelPolicyBundle,
        policy: dependencies.modelPolicyConfig,
        env: dependencies.env,
      },
    );

  const verifierChecks = normalizeStringList(selectedIntents.flatMap((intent) => intent.doneCriteria?.requiredChecks || []), 256);
  const verifierArtifacts = normalizeStringList(selectedIntents.flatMap((intent) => intent.doneCriteria?.requiredArtifacts || []), 256);
  const verifierDocs = normalizeStringList(selectedIntents.flatMap((intent) => intent.doneCriteria?.requiredDocs || []), 256);
  const requiredEvidence = normalizeStringList(selectedIntents.flatMap((intent) => intent.requiredEvidenceTypes || []), 64);
  const nonGoals = normalizeStringList(
    [
      ...selectedIntents.flatMap((intent) => intent.nonGoals || []),
      "Do not replace the existing startup and memory harness in this first implementation slice.",
      "Do not introduce autonomous merge or deploy behavior beyond current repo guardrails.",
    ],
    32,
  );
  const objectives = normalizeStringList(selectedIntents.map((intent) => intent.objective), 16);
  const goal =
    objectives.length === 1
      ? objectives[0]
      : `Execute the bounded mission bundle for ${requestedIntentIds.join(", ")} with explicit verification and goal-lock enforcement.`;
  const mutationPolicy = buildMutationPolicy(options.platform || process.platform);

  return {
    schema: "agent-mission-envelope.v1",
    generatedAt,
    runId,
    missionId,
    missionTitle: clean(options.title) || selectedIntents.map((intent) => intent.title).join(" + "),
    goal,
    nonGoals,
    riskLane,
    modelPolicy,
    selectedIntents: selectedIntents.map((intent) => ({
      intentId: intent.intentId,
      title: intent.title,
      objective: intent.objective,
      riskTier: intent.constraints?.riskTier || intent.riskTier || "medium",
      priorityClass: intent.priorityClass || "P2",
      autonomyMode: intent.autonomy?.mode || intent.autonomyMode || "bounded",
      capabilityToken: clean(intent.capabilityToken),
    })),
    taskRefs: taskRefs.map((task) => ({
      taskId: task.taskId,
      title: task.title,
      dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn : [],
      actionType: task.actionType,
      writeScope: task.writeScope,
      riskTier: task.riskTier,
      priorityClass: task.priorityClass,
      authorityTier: task.authorityTier,
      checks: Array.isArray(task.checks) ? task.checks : [],
    })),
    allowedTools: normalizeStringList(selectedIntents.flatMap((intent) => intent.autonomy?.allowedTools || intent.allowedTools || []), 64),
    toolBudget: {
      maxChangedFiles: constraintSummary.maxChangedFiles,
      maxWriteActions: constraintSummary.maxWriteActions,
      approvalRequiredFor: constraintSummary.approvalRequiredFor,
      writePolicies: constraintSummary.writePolicies,
    },
    mutationPolicy,
    requiredEvidence,
    verifierSpec: {
      schema: "agent-verifier-spec.v1",
      mode: riskLane === "high_risk" ? "required" : "bounded_required",
      requiredChecks: verifierChecks,
      requiredArtifacts: verifierArtifacts,
      requiredDocs: verifierDocs,
      gateVisualVerification: verifierChecks.some((command) => /playwright|visual|smoke/i.test(command)),
      gateLiveDeploy: verifierChecks.some((command) => /deploy|portal\.monsoonfire\.com/i.test(command)),
    },
    stopConditions: [
      "A required verifier check fails without a bounded recovery path.",
      "A blocking rathole signal is raised and the critical path cannot be narrowed.",
      "A required tool contract is missing for a requested mutate or deploy action.",
    ],
    sourcePlan: {
      schema: plan.schema,
      planDigestSha256: clean(plan.planDigestSha256),
      artifactPath: planBundle.relativePath || DEFAULT_INTENT_PLAN_PATH,
    },
  };
}

function collectGitSnapshot(repoRoot) {
  const branch = runShellText(repoRoot, "git", ["branch", "--show-current"]);
  const status = runShellText(repoRoot, "git", ["status", "--short"]);
  const changedFiles = status.stdout ? status.stdout.split(/\r?\n/).filter(Boolean).slice(0, 24) : [];
  return {
    branch: branch.ok ? branch.stdout : "",
    dirtyCount: changedFiles.length,
    changedFiles,
    statusCommandOk: status.ok,
  };
}

function collectCorpusSignals(repoRoot) {
  const corpusRoot = resolve(repoRoot, "output", "open-memory", "corpus");
  return {
    available: existsSync(corpusRoot),
    root: existsSync(corpusRoot) ? relative(repoRoot, corpusRoot).replaceAll("\\", "/") : null,
    authority: "canonical-corpus-first",
  };
}

export function buildContextPack(repoRoot, options = {}, dependencies = {}) {
  const generatedAt = clean(options.generatedAt) || new Date().toISOString();
  const startupPayload =
    dependencies.startupPayload ??
    runShellJson(repoRoot, process.execPath, [resolve(repoRoot, "scripts", "codex-startup-preflight.mjs"), "--json"]).json;
  const startupContext = startupPayload?.checks?.startupContext ?? {};
  const startupScorecard =
    dependencies.startupScorecard ??
    readJsonFileIfExists(resolve(repoRoot, "output", "qa", "codex-startup-scorecard.json"));
  const memoryBrief =
    dependencies.memoryBrief ??
    readJsonFileIfExists(resolve(repoRoot, "output", "studio-brain", "memory-brief", "latest.json"));
  const repoSnapshot = dependencies.repoSnapshot ?? collectGitSnapshot(repoRoot);
  const corpusSignals = dependencies.corpusSignals ?? collectCorpusSignals(repoRoot);
  const memoriesInfluencingRun = normalizeStringList(
    [
      ...(memoryBrief?.layers?.coreBlocks || []),
      ...(memoryBrief?.layers?.workingMemory || []),
      ...(memoryBrief?.layers?.episodicMemory || []),
      ...(memoryBrief?.layers?.canonicalMemory || []),
    ],
    12,
  );

  const coverage = startupScorecard?.launcherCoverage ?? {};
  const startupTrustworthy = startupScorecard?.launcherCoverage?.trustworthy === true;
  const startupBlockers = [];
  if (startupContext?.continuityState && clean(startupContext.continuityState).toLowerCase() !== "ready") {
    startupBlockers.push(`startup continuity is ${clean(startupContext.continuityState)}`);
  }
  if (startupScorecard && startupTrustworthy !== true) {
    const observed = Number(coverage.liveStartupSamples || 0);
    const required = Number(coverage.requiredLiveStartupSamples || 5);
    startupBlockers.push(`startup coverage is ${observed}/${required} live samples and is not yet trustworthy`);
  }

  return {
    schema: "agent-context-pack.v1",
    generatedAt,
    runId: clean(options.runId) || "",
    continuity: {
      state: clean(startupContext.continuityState || "missing").toLowerCase(),
      reasonCode: clean(startupContext.reasonCode || ""),
      summary: clean(startupContext.contextSummary || ""),
      recoveryStep: clean(startupContext.recoveryStep || ""),
    },
    memory: {
      summary: clean(memoryBrief?.summary || ""),
      goal: clean(memoryBrief?.goal || ""),
      blockers: normalizeStringList(memoryBrief?.blockers || [], 8),
      recentDecisions: normalizeStringList(memoryBrief?.recentDecisions || [], 8),
      recommendedNextActions: normalizeStringList(memoryBrief?.recommendedNextActions || [], 8),
    },
    corpus: corpusSignals,
    repo: repoSnapshot,
    telemetry: {
      startupLatestStatus: clean(startupScorecard?.latest?.sample?.status || ""),
      startupGrade: clean(startupScorecard?.rubric?.grade || ""),
      startupTrustworthy,
      startupCoverage: {
        liveStartupSamples: Number(coverage.liveStartupSamples || 0),
        requiredLiveStartupSamples: Number(coverage.requiredLiveStartupSamples || 5),
      },
      startupBlockers,
    },
    groundingSources: normalizeStringList(
      [
        "codex-startup-preflight",
        memoryBrief ? "studio-brain-memory-brief" : "",
        startupScorecard ? "codex-startup-scorecard" : "",
        repoSnapshot.branch ? "git-status" : "",
        corpusSignals.available ? "canonical-corpus" : "",
      ],
      8,
    ),
    memoriesInfluencingRun,
  };
}

export function createInitialRunSummary(missionEnvelope, contextPack) {
  const blockingNotes = normalizeStringList(
    [
      ...normalizeStringList(contextPack?.telemetry?.startupBlockers || [], 8),
      ...(contextPack?.memory?.blockers || []),
    ],
    8,
  );
  const totalChecks = Array.isArray(missionEnvelope?.verifierSpec?.requiredChecks)
    ? missionEnvelope.verifierSpec.requiredChecks.length
    : 0;
  return {
    schema: "agent-runtime-summary.v1",
    generatedAt: missionEnvelope.generatedAt,
    runId: missionEnvelope.runId,
    missionId: missionEnvelope.missionId,
    status: blockingNotes.length > 0 ? "blocked" : "queued",
    riskLane: missionEnvelope.riskLane,
    title: missionEnvelope.missionTitle,
    goal: missionEnvelope.goal,
    groundingSources: normalizeStringList(contextPack.groundingSources || [], 12),
    acceptance: {
      total: totalChecks,
      pending: totalChecks,
      completed: 0,
      failed: 0,
    },
    activeBlockers: blockingNotes,
    ratholeSignals: [],
    memoriesInfluencingRun: normalizeStringList(contextPack.memoriesInfluencingRun || [], 12),
    goalMisses: [],
    lastEventType: null,
    updatedAt: missionEnvelope.generatedAt,
    boardRow: {
      id: `agent-runtime:${missionEnvelope.runId}`,
      owner: "agent-runtime",
      task: missionEnvelope.missionTitle,
      state: blockingNotes.length > 0 ? "blocked" : "queued",
      blocker: blockingNotes[0] || "none",
      next: blockingNotes.length > 0 ? "inspect startup and memory blockers" : "launch background runtime",
      last_update: missionEnvelope.generatedAt,
    },
  };
}

export function writeAgentRunBundle(repoRoot, bundle, options = {}) {
  const runId = clean(bundle?.missionEnvelope?.runId || options.runId);
  if (!runId) {
    throw new Error("Cannot write agent run bundle without a runId.");
  }
  const runsRoot = resolve(repoRoot, options.runsRoot || DEFAULT_AGENT_RUNS_ROOT);
  const runRoot = resolve(runsRoot, runId);
  mkdirSync(runRoot, { recursive: true });

  const missionEnvelopePath = resolve(runRoot, "mission-envelope.json");
  const contextPackPath = resolve(runRoot, "context-pack.json");
  const toolContractsPath = resolve(runRoot, "tool-contracts.json");
  const summaryPath = resolve(runRoot, "summary.json");
  const ledgerPath = resolve(runRoot, "run-ledger.jsonl");
  const summary = bundle.summary || createInitialRunSummary(bundle.missionEnvelope, bundle.contextPack);

  writeFileSync(missionEnvelopePath, `${JSON.stringify(bundle.missionEnvelope, null, 2)}\n`, "utf8");
  writeFileSync(contextPackPath, `${JSON.stringify(bundle.contextPack, null, 2)}\n`, "utf8");
  writeFileSync(toolContractsPath, `${JSON.stringify(bundle.toolRegistry, null, 2)}\n`, "utf8");
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  if (!existsSync(ledgerPath)) {
    writeFileSync(ledgerPath, "", "utf8");
  }

  const pointerPath = resolve(runsRoot, "latest.json");
  const pointerPayload = {
    schema: "agent-runtime-pointer.v1",
    updatedAt: bundle.missionEnvelope.generatedAt,
    runId,
    runRoot: relative(repoRoot, runRoot).replaceAll("\\", "/"),
    missionEnvelopePath: relative(repoRoot, missionEnvelopePath).replaceAll("\\", "/"),
    contextPackPath: relative(repoRoot, contextPackPath).replaceAll("\\", "/"),
    toolContractsPath: relative(repoRoot, toolContractsPath).replaceAll("\\", "/"),
    summaryPath: relative(repoRoot, summaryPath).replaceAll("\\", "/"),
    ledgerPath: relative(repoRoot, ledgerPath).replaceAll("\\", "/"),
  };
  writeFileSync(pointerPath, `${JSON.stringify(pointerPayload, null, 2)}\n`, "utf8");

  return {
    runRoot,
    missionEnvelopePath,
    contextPackPath,
    toolContractsPath,
    summaryPath,
    ledgerPath,
    pointerPath,
    summary,
  };
}
