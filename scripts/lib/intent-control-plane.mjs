import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve, relative } from "node:path";

export const DEFAULT_INTENTS_DIR = "intents";
export const DEFAULT_SCHEMA_PATH = "contracts/intent.schema.json";
export const DEFAULT_PLAN_ARTIFACT = "artifacts/intent-plan.generated.json";

const RISK_TIERS = new Set(["low", "medium", "high", "critical"]);
const AUTONOMY_MODES = new Set(["manual", "bounded", "semi_auto"]);
const SCHEMA_VERSIONS = new Set(["intent.v1", "intent.v2"]);
const PRIORITY_CLASSES = new Set(["P0", "P1", "P2", "P3"]);
const AUTHORITY_TIERS = new Set(["T0", "T1", "T2", "T3", "T4"]);

function inferPriorityClassFromRisk(riskTier) {
  switch (String(riskTier || "").toLowerCase()) {
    case "critical":
      return "P0";
    case "high":
      return "P1";
    case "medium":
      return "P2";
    default:
      return "P3";
  }
}

function inferAuthorityTierFromRisk(riskTier) {
  switch (String(riskTier || "").toLowerCase()) {
    case "critical":
      return "T4";
    case "high":
      return "T3";
    default:
      return "T2";
  }
}

function normalizeWriteScope(value) {
  const scope = String(value || "").trim().toLowerCase();
  if (!scope || scope === "unspecified") return "unspecified";
  return scope;
}

function actionTypeFromWriteScope(writeScope) {
  const scope = normalizeWriteScope(writeScope);
  if (scope === "none") return "analyze";
  if (scope === "artifact-only" || scope === "artifact_only") return "verify";
  return "mutate";
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeTextForDigest(value) {
  return String(value).replace(/\r\n/g, "\n");
}

function slugify(value, fallback = "item") {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || fallback;
}

function digestFileIfExists(path) {
  if (!existsSync(path)) return null;
  return sha256(normalizeTextForDigest(readFileSync(path, "utf8")));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const keys = Object.keys(value).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function listIntentFilesRecursive(rootDir, subPath = "") {
  const absolute = resolve(rootDir, subPath);
  if (!existsSync(absolute)) return [];

  const rows = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const entrySubPath = subPath ? `${subPath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      rows.push(...listIntentFilesRecursive(rootDir, entrySubPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".intent.json")) {
      rows.push(entrySubPath);
    }
  }

  return rows.sort();
}

export function loadIntentEntries(repoRoot, intentsDir = DEFAULT_INTENTS_DIR) {
  const intentsRoot = resolve(repoRoot, intentsDir);
  const files = listIntentFilesRecursive(intentsRoot);

  return files.map((relativeFromIntents) => {
    const absolutePath = resolve(intentsRoot, relativeFromIntents);
    const fileFromRepo = relative(repoRoot, absolutePath).replaceAll("\\", "/");
    const raw = readFileSync(absolutePath, "utf8");
    let parsed = null;
    let parseError = null;

    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      parseError = error instanceof Error ? error.message : String(error);
    }

    return {
      absolutePath,
      fileFromRepo,
      raw,
      parsed,
      parseError,
    };
  });
}

export function validateIntentEntries(repoRoot, entries) {
  const findings = [];
  const summaries = [];
  const idToFile = new Map();
  const pendingIntentDependencies = [];

  const pushFinding = (severity, type, file, message, details = null) => {
    findings.push({ severity, type, file, message, details });
  };

  const validEntries = [];

  for (const entry of entries) {
    const file = entry.fileFromRepo;
    if (entry.parseError) {
      pushFinding("error", "json-parse", file, `Failed to parse JSON: ${entry.parseError}`);
      summaries.push({ file, valid: false, intentId: null, riskTier: null, epicPath: null, executionSlices: 0 });
      continue;
    }

    const intent = entry.parsed;
    if (!isPlainObject(intent)) {
      pushFinding("error", "shape", file, "Intent file root must be a JSON object.");
      summaries.push({ file, valid: false, intentId: null, riskTier: null, epicPath: null, executionSlices: 0 });
      continue;
    }

    const errorsBefore = findings.length;

    const requireString = (path, value) => {
      if (typeof value !== "string" || value.trim().length === 0) {
        pushFinding("error", "required-field", file, `${path} must be a non-empty string.`);
        return "";
      }
      return value.trim();
    };
    const requireBoolean = (path, value) => {
      if (typeof value !== "boolean") {
        pushFinding("error", "required-field", file, `${path} must be a boolean.`);
        return null;
      }
      return value;
    };
    const requireNumberInRange = (path, value, min, max) => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric < min || numeric > max) {
        pushFinding("error", "required-field", file, `${path} must be a number in [${min}, ${max}].`);
        return null;
      }
      return numeric;
    };

    const intentId = requireString("intentId", intent.intentId);
    const schemaVersion = requireString("schemaVersion", intent.schemaVersion);
    if (schemaVersion && !SCHEMA_VERSIONS.has(schemaVersion)) {
      pushFinding(
        "error",
        "schema-version",
        file,
        `schemaVersion must be one of ${Array.from(SCHEMA_VERSIONS).join(", ")} (received "${schemaVersion}").`
      );
    }

    requireString("title", intent.title);
    requireString("objective", intent.objective);

    if (!Array.isArray(intent.nonGoals) || intent.nonGoals.length === 0) {
      pushFinding("error", "required-field", file, "nonGoals must be a non-empty array.");
    }

    if (!isPlainObject(intent.epic)) {
      pushFinding("error", "required-field", file, "epic must be an object.");
    }

    const epicPath = isPlainObject(intent.epic) ? requireString("epic.path", intent.epic.path) : "";
    if (epicPath) {
      const epicAbsolute = resolve(repoRoot, epicPath);
      if (!existsSync(epicAbsolute)) {
        pushFinding("error", "missing-epic", file, `Referenced epic file does not exist: ${epicPath}`);
      }
    }

    if (!isPlainObject(intent.constraints)) {
      pushFinding("error", "required-field", file, "constraints must be an object.");
    }

    const riskTier = isPlainObject(intent.constraints)
      ? requireString("constraints.riskTier", intent.constraints.riskTier).toLowerCase()
      : "";
    if (riskTier && !RISK_TIERS.has(riskTier)) {
      pushFinding("error", "enum", file, `constraints.riskTier must be one of: ${Array.from(RISK_TIERS).join(", ")}.`);
    }
    if (isPlainObject(intent.constraints) && intent.constraints.maxChangedFiles !== undefined) {
      const maxChangedFiles = Number(intent.constraints.maxChangedFiles);
      if (!Number.isInteger(maxChangedFiles) || maxChangedFiles <= 0 || maxChangedFiles > 5000) {
        pushFinding("error", "required-field", file, "constraints.maxChangedFiles must be an integer in [1, 5000].");
      }
    }
    if (isPlainObject(intent.constraints) && intent.constraints.maxWriteActions !== undefined) {
      const maxWriteActions = Number(intent.constraints.maxWriteActions);
      if (!Number.isInteger(maxWriteActions) || maxWriteActions < 0 || maxWriteActions > 5000) {
        pushFinding("error", "required-field", file, "constraints.maxWriteActions must be an integer in [0, 5000].");
      }
    }

    if (!isPlainObject(intent.autonomy)) {
      pushFinding("error", "required-field", file, "autonomy must be an object.");
    } else {
      const mode = requireString("autonomy.mode", intent.autonomy.mode);
      if (mode && !AUTONOMY_MODES.has(mode)) {
        pushFinding("error", "enum", file, `autonomy.mode must be one of: ${Array.from(AUTONOMY_MODES).join(", ")}.`);
      }

      if (!Array.isArray(intent.autonomy.allowedTools) || intent.autonomy.allowedTools.length === 0) {
        pushFinding("error", "required-field", file, "autonomy.allowedTools must be a non-empty array.");
      }

      const maxRunMinutes = Number(intent.autonomy.maxRunMinutes);
      if (!Number.isFinite(maxRunMinutes) || maxRunMinutes <= 0) {
        pushFinding("error", "required-field", file, "autonomy.maxRunMinutes must be a positive number.");
      }
    }

    if (intent.priorityClass !== undefined) {
      const priorityClass = requireString("priorityClass", intent.priorityClass);
      if (priorityClass && !PRIORITY_CLASSES.has(priorityClass)) {
        pushFinding("error", "enum", file, `priorityClass must be one of: ${Array.from(PRIORITY_CLASSES).join(", ")}.`);
      }
    }

    if (intent.authority !== undefined) {
      if (!isPlainObject(intent.authority)) {
        pushFinding("error", "required-field", file, "authority must be an object when provided.");
      } else if (intent.authority.tier !== undefined) {
        const authorityTier = requireString("authority.tier", intent.authority.tier);
        if (authorityTier && !AUTHORITY_TIERS.has(authorityTier)) {
          pushFinding("error", "enum", file, `authority.tier must be one of: ${Array.from(AUTHORITY_TIERS).join(", ")}.`);
        }
      }
    }

    if (intent.progressModel !== undefined && !isPlainObject(intent.progressModel)) {
      pushFinding("error", "required-field", file, "progressModel must be an object when provided.");
    }

    if (intent.requiredEvidenceTypes !== undefined && !Array.isArray(intent.requiredEvidenceTypes)) {
      pushFinding("error", "required-field", file, "requiredEvidenceTypes must be an array when provided.");
    }

    if (intent.verificationProfile !== undefined && !isPlainObject(intent.verificationProfile)) {
      pushFinding("error", "required-field", file, "verificationProfile must be an object when provided.");
    }

    if (intent.preemptionPolicy !== undefined && !isPlainObject(intent.preemptionPolicy)) {
      pushFinding("error", "required-field", file, "preemptionPolicy must be an object when provided.");
    }

    if (intent.degradedModePolicy !== undefined && !isPlainObject(intent.degradedModePolicy)) {
      pushFinding("error", "required-field", file, "degradedModePolicy must be an object when provided.");
    }

    if (intent.compensationPolicy !== undefined && !isPlainObject(intent.compensationPolicy)) {
      pushFinding("error", "required-field", file, "compensationPolicy must be an object when provided.");
    }

    if (intent.idempotencyProfile !== undefined && !isPlainObject(intent.idempotencyProfile)) {
      pushFinding("error", "required-field", file, "idempotencyProfile must be an object when provided.");
    }

    if (intent.dataHandlingPolicy !== undefined && !isPlainObject(intent.dataHandlingPolicy)) {
      pushFinding("error", "required-field", file, "dataHandlingPolicy must be an object when provided.");
    }

    if (intent.modelGovernancePolicy !== undefined && !isPlainObject(intent.modelGovernancePolicy)) {
      pushFinding("error", "required-field", file, "modelGovernancePolicy must be an object when provided.");
    }

    if (!isPlainObject(intent.doneCriteria)) {
      pushFinding("error", "required-field", file, "doneCriteria must be an object.");
    } else if (!Array.isArray(intent.doneCriteria.requiredChecks) || intent.doneCriteria.requiredChecks.length === 0) {
      pushFinding("error", "required-field", file, "doneCriteria.requiredChecks must be a non-empty array.");
    }

    if (intent.dependsOnIntents !== undefined) {
      if (!Array.isArray(intent.dependsOnIntents)) {
        pushFinding("error", "required-field", file, "dependsOnIntents must be an array when provided.");
      } else {
        const dependencies = [];
        for (const [dependencyIndex, dependencyIntentId] of intent.dependsOnIntents.entries()) {
          if (typeof dependencyIntentId !== "string" || dependencyIntentId.trim().length === 0) {
            pushFinding(
              "error",
              "invalid-intent-dependency",
              file,
              `dependsOnIntents[${dependencyIndex}] must be a non-empty string.`
            );
            continue;
          }
          dependencies.push(dependencyIntentId.trim());
        }
        pendingIntentDependencies.push({ file, intentId, dependsOnIntents: dependencies });
      }
    }

    if (!Array.isArray(intent.executionSlices) || intent.executionSlices.length === 0) {
      pushFinding("error", "required-field", file, "executionSlices must be a non-empty array.");
    } else {
      const ids = new Set();
      for (const [index, slice] of intent.executionSlices.entries()) {
        const prefix = `executionSlices[${index}]`;
        if (!isPlainObject(slice)) {
          pushFinding("error", "required-field", file, `${prefix} must be an object.`);
          continue;
        }
        const sliceId = requireString(`${prefix}.id`, slice.id);
        requireString(`${prefix}.title`, slice.title);

        if (sliceId) {
          if (ids.has(sliceId)) {
            pushFinding("error", "duplicate-slice-id", file, `executionSlices contains duplicate id \"${sliceId}\".`);
          }
          ids.add(sliceId);
        }

        if (!Array.isArray(slice.dependsOn)) {
          pushFinding("error", "required-field", file, `${prefix}.dependsOn must be an array.`);
        }

        if (!Array.isArray(slice.checks) || slice.checks.length === 0) {
          pushFinding("error", "required-field", file, `${prefix}.checks must be a non-empty array.`);
        } else {
          for (const [checkIndex, command] of slice.checks.entries()) {
            if (typeof command !== "string" || command.trim().length === 0) {
              pushFinding("error", "required-field", file, `${prefix}.checks[${checkIndex}] must be a non-empty string.`);
            }
          }
        }
      }

      for (const slice of intent.executionSlices) {
        if (!isPlainObject(slice) || !Array.isArray(slice.dependsOn) || typeof slice.id !== "string") continue;
        for (const dependency of slice.dependsOn) {
          if (typeof dependency !== "string" || dependency.trim().length === 0) {
            pushFinding("error", "invalid-dependency", file, `Slice \"${slice.id}\" has invalid dependency id.`);
            continue;
          }
          if (!ids.has(dependency)) {
            pushFinding(
              "error",
              "missing-dependency",
              file,
              `Slice \"${slice.id}\" depends on missing slice id \"${dependency}\".`
            );
          }
        }
      }
    }

    if (intent.simulation !== undefined) {
      if (!isPlainObject(intent.simulation)) {
        pushFinding("error", "required-field", file, "simulation must be an object when provided.");
      } else {
        requireString("simulation.profile", intent.simulation.profile);
        if (intent.simulation.required !== undefined) {
          requireBoolean("simulation.required", intent.simulation.required);
        }
        if (intent.simulation.strict !== undefined) {
          requireBoolean("simulation.strict", intent.simulation.strict);
        }
      }
    }

    if (intent.evaluation !== undefined) {
      if (!isPlainObject(intent.evaluation)) {
        pushFinding("error", "required-field", file, "evaluation must be an object when provided.");
      } else {
        requireBoolean("evaluation.required", intent.evaluation.required);
        requireNumberInRange("evaluation.threshold", intent.evaluation.threshold, 0, 1);
        requireString("evaluation.suite", intent.evaluation.suite);
      }
    }

    if (intent.budget !== undefined) {
      if (!isPlainObject(intent.budget)) {
        pushFinding("error", "required-field", file, "budget must be an object when provided.");
      } else {
        const integerFields = [
          ["budget.maxTasks", intent.budget.maxTasks, 1, 5000],
          ["budget.maxChecks", intent.budget.maxChecks, 1, 50000],
          ["budget.maxRuntimeMs", intent.budget.maxRuntimeMs, 1000, 86400000],
          ["budget.maxRetriesPerCheck", intent.budget.maxRetriesPerCheck, 0, 5],
        ];
        for (const [path, value, min, max] of integerFields) {
          if (value === undefined) continue;
          const numeric = Number(value);
          if (!Number.isInteger(numeric) || numeric < min || numeric > max) {
            pushFinding("error", "required-field", file, `${path} must be an integer in [${min}, ${max}].`);
          }
        }
      }
    }

    if (intent.policy !== undefined) {
      if (!isPlainObject(intent.policy)) {
        pushFinding("error", "required-field", file, "policy must be an object when provided.");
      } else {
        if (intent.policy.profile !== undefined) {
          requireString("policy.profile", intent.policy.profile);
        }
        if (intent.policy.allowUntrustedMcp !== undefined) {
          requireBoolean("policy.allowUntrustedMcp", intent.policy.allowUntrustedMcp);
        }
      }
    }

    if (intent.memoryGovernance !== undefined) {
      if (!isPlainObject(intent.memoryGovernance)) {
        pushFinding("error", "required-field", file, "memoryGovernance must be an object when provided.");
      } else {
        if (intent.memoryGovernance.enabled !== undefined) {
          requireBoolean("memoryGovernance.enabled", intent.memoryGovernance.enabled);
        }
        if (intent.memoryGovernance.minConfidence !== undefined) {
          requireNumberInRange("memoryGovernance.minConfidence", intent.memoryGovernance.minConfidence, 0, 1);
        }
        if (intent.memoryGovernance.maxAgeDays !== undefined) {
          const maxAgeDays = Number(intent.memoryGovernance.maxAgeDays);
          if (!Number.isInteger(maxAgeDays) || maxAgeDays <= 0 || maxAgeDays > 3650) {
            pushFinding("error", "required-field", file, "memoryGovernance.maxAgeDays must be an integer in [1, 3650].");
          }
        }
      }
    }

    if (!isPlainObject(intent.escalation) || !Array.isArray(intent.escalation.when) || intent.escalation.when.length === 0) {
      pushFinding("warning", "escalation", file, "escalation.when should be a non-empty array for bounded autonomy.");
    }

    if (intentId) {
      const prior = idToFile.get(intentId);
      if (prior && prior !== file) {
        pushFinding("error", "duplicate-intent-id", file, `intentId \"${intentId}\" is already used in ${prior}.`);
      } else if (!prior) {
        idToFile.set(intentId, file);
      }
    }

    const hadErrors = findings.slice(errorsBefore).some((finding) => finding.severity === "error");
    summaries.push({
      file,
      valid: !hadErrors,
      intentId: intentId || null,
      riskTier: riskTier || null,
      epicPath: epicPath || null,
      executionSlices: Array.isArray(intent.executionSlices) ? intent.executionSlices.length : 0,
    });

    if (!hadErrors) {
      validEntries.push({ ...entry, intent });
    }
  }

  const knownIntentIds = new Set(idToFile.keys());
  for (const row of pendingIntentDependencies) {
    for (const dependencyIntentId of row.dependsOnIntents) {
      if (!knownIntentIds.has(dependencyIntentId)) {
        pushFinding(
          "error",
          "missing-intent-dependency",
          row.file,
          `dependsOnIntents references unknown intentId "${dependencyIntentId}".`
        );
      }
      if (row.intentId && dependencyIntentId === row.intentId) {
        pushFinding("error", "invalid-intent-dependency", row.file, "dependsOnIntents cannot reference itself.");
      }
    }
  }

  const errors = findings.filter((finding) => finding.severity === "error").length;
  const warnings = findings.filter((finding) => finding.severity === "warning").length;

  return {
    findings,
    summaries,
    validEntries,
    summary: {
      filesScanned: entries.length,
      validIntents: validEntries.length,
      errors,
      warnings,
    },
  };
}

export function buildCompiledPlan(repoRoot, validEntries) {
  const intents = validEntries
    .map((entry) => {
      const intentDigestSha256 = sha256(normalizeTextForDigest(entry.raw));
      const epicPath = entry.intent.epic.path;
      const epicAbsolutePath = resolve(repoRoot, epicPath);
      const epicRaw = readFileSync(epicAbsolutePath, "utf8");
      const epicDigestSha256 = sha256(normalizeTextForDigest(epicRaw));

      const normalizedSlices = entry.intent.executionSlices.map((slice) => ({
        id: slice.id,
        title: slice.title,
        dependsOn: slice.dependsOn,
        checks: slice.checks,
        writeScope: slice.writeScope || "unspecified",
      }));

      return {
        schemaVersion: entry.intent.schemaVersion,
        intentId: entry.intent.intentId,
        title: entry.intent.title,
        file: entry.fileFromRepo,
        epicPath,
        epicDigestSha256,
        intentDigestSha256,
        objective: entry.intent.objective,
        riskTier: entry.intent.constraints.riskTier,
        constraints: {
          writePolicy: typeof entry.intent.constraints.writePolicy === "string" ? entry.intent.constraints.writePolicy : null,
          maxChangedFiles: Number(entry.intent.constraints.maxChangedFiles || 0) || null,
          maxWriteActions: Number(entry.intent.constraints.maxWriteActions || 0) || null,
        },
        autonomyMode: entry.intent.autonomy.mode,
        allowedTools: entry.intent.autonomy.allowedTools,
        authority: {
          tier:
            typeof entry.intent.authority?.tier === "string"
              ? entry.intent.authority.tier
              : inferAuthorityTierFromRisk(entry.intent.constraints.riskTier),
          approvalRequiredFor: Array.isArray(entry.intent.authority?.approvalRequiredFor)
            ? entry.intent.authority.approvalRequiredFor
            : Array.isArray(entry.intent.autonomy.requiresHumanApprovalFor)
              ? entry.intent.autonomy.requiresHumanApprovalFor
              : [],
        },
        priorityClass:
          typeof entry.intent.priorityClass === "string"
            ? entry.intent.priorityClass
            : inferPriorityClassFromRisk(entry.intent.constraints.riskTier),
        progressModel: isPlainObject(entry.intent.progressModel)
          ? entry.intent.progressModel
          : {
              kind: "criteria",
              minimumEvidenceCoverage: 0.75,
            },
        requiredEvidenceTypes: Array.isArray(entry.intent.requiredEvidenceTypes)
          ? entry.intent.requiredEvidenceTypes
          : ["tool_output", "repo_state"],
        verificationProfile: isPlainObject(entry.intent.verificationProfile)
          ? entry.intent.verificationProfile
          : {
              mustVerifyAfterMutate: true,
            },
        preemptionPolicy: isPlainObject(entry.intent.preemptionPolicy)
          ? entry.intent.preemptionPolicy
          : {
              preemptibleBy: ["P0", "P1"],
              resumeAllowed: true,
            },
        degradedModePolicy: isPlainObject(entry.intent.degradedModePolicy)
          ? entry.intent.degradedModePolicy
          : {
              allowReadOnlyContinuation: true,
              reduceMutationScopeOnOutage: true,
            },
        compensationPolicy: isPlainObject(entry.intent.compensationPolicy)
          ? entry.intent.compensationPolicy
          : {
              strategy: "forward_fix",
            },
        idempotencyProfile: isPlainObject(entry.intent.idempotencyProfile)
          ? entry.intent.idempotencyProfile
          : {
              enabled: true,
              keyTemplate: `${entry.intent.intentId}:{sliceId}`,
            },
        dataHandlingPolicy: isPlainObject(entry.intent.dataHandlingPolicy)
          ? entry.intent.dataHandlingPolicy
          : {
              redactSecrets: true,
              retentionDays: 30,
            },
        modelGovernancePolicy: isPlainObject(entry.intent.modelGovernancePolicy)
          ? entry.intent.modelGovernancePolicy
          : {
              canaryPercent: 10,
              rollbackOnDriftIncreasePct: 10,
            },
        capabilityToken: `capref_${slugify(entry.intent.intentId, "intent_capability")}`,
        dependsOnIntents: Array.isArray(entry.intent.dependsOnIntents) ? entry.intent.dependsOnIntents : [],
        doneCriteria: entry.intent.doneCriteria,
        simulation: isPlainObject(entry.intent.simulation)
          ? {
              profile: entry.intent.simulation.profile,
              required: entry.intent.simulation.required !== false,
              strict: entry.intent.simulation.strict === true,
            }
          : null,
        evaluation: isPlainObject(entry.intent.evaluation)
          ? {
              required: entry.intent.evaluation.required === true,
              threshold: Number(entry.intent.evaluation.threshold),
              suite: entry.intent.evaluation.suite,
            }
          : null,
        budget: isPlainObject(entry.intent.budget)
          ? {
              maxTasks: Number(entry.intent.budget.maxTasks || 0) || null,
              maxChecks: Number(entry.intent.budget.maxChecks || 0) || null,
              maxRuntimeMs: Number(entry.intent.budget.maxRuntimeMs || 0) || null,
              maxRetriesPerCheck: Number(entry.intent.budget.maxRetriesPerCheck || 0),
            }
          : null,
        policy: isPlainObject(entry.intent.policy)
          ? {
              profile: typeof entry.intent.policy.profile === "string" ? entry.intent.policy.profile : null,
              allowUntrustedMcp: entry.intent.policy.allowUntrustedMcp === true,
            }
          : null,
        memoryGovernance: isPlainObject(entry.intent.memoryGovernance)
          ? {
              enabled: entry.intent.memoryGovernance.enabled !== false,
              minConfidence: Number(entry.intent.memoryGovernance.minConfidence || 0) || null,
              maxAgeDays: Number(entry.intent.memoryGovernance.maxAgeDays || 0) || null,
            }
          : null,
        executionSlices: normalizedSlices,
      };
    })
    .sort((a, b) => a.intentId.localeCompare(b.intentId));

  const intentMap = new Map(intents.map((intent) => [intent.intentId, intent]));
  const leafSliceIdsByIntent = new Map();
  for (const intent of intents) {
    const referenced = new Set();
    for (const slice of intent.executionSlices) {
      for (const dependencyId of slice.dependsOn || []) {
        referenced.add(dependencyId);
      }
    }
    const leafIds = intent.executionSlices
      .map((slice) => slice.id)
      .filter((sliceId) => !referenced.has(sliceId))
      .sort();
    leafSliceIdsByIntent.set(intent.intentId, leafIds);
  }

  const tasks = [];
  for (const intent of intents) {
    for (const slice of intent.executionSlices) {
      const localDependencies = (slice.dependsOn || []).map((dependencyId) => `${intent.intentId}::${dependencyId}`);
      const crossIntentDependencies = [];
      if ((slice.dependsOn || []).length === 0 && Array.isArray(intent.dependsOnIntents) && intent.dependsOnIntents.length > 0) {
        for (const dependencyIntentId of intent.dependsOnIntents) {
          if (!intentMap.has(dependencyIntentId)) continue;
          const leafSliceIds = leafSliceIdsByIntent.get(dependencyIntentId) || [];
          for (const leafSliceId of leafSliceIds) {
            crossIntentDependencies.push(`${dependencyIntentId}::${leafSliceId}`);
          }
        }
      }
      tasks.push({
        taskId: `${intent.intentId}::${slice.id}`,
        intentId: intent.intentId,
        criterionRef: slice.id,
        title: slice.title,
        dependsOn: Array.from(new Set([...localDependencies, ...crossIntentDependencies])),
        checks: slice.checks,
        writeScope: slice.writeScope,
        actionType: actionTypeFromWriteScope(slice.writeScope),
        lockScope: normalizeWriteScope(slice.writeScope),
        capabilityToken: intent.capabilityToken,
        riskTier: intent.riskTier,
        priorityClass: intent.priorityClass,
        authorityTier: intent.authority?.tier || inferAuthorityTierFromRisk(intent.riskTier),
      });
    }
  }

  tasks.sort((a, b) => a.taskId.localeCompare(b.taskId));

  const staticPlan = {
    schema: "intent-plan.v1",
    controlPlaneDigests: {
      intentSchema: digestFileIfExists(resolve(repoRoot, "contracts/intent.schema.json")),
      policyConfig: digestFileIfExists(resolve(repoRoot, "config/intent-policy.json")),
      budgetConfig: digestFileIfExists(resolve(repoRoot, "config/intent-budget.json")),
      memoryGovernanceConfig: digestFileIfExists(resolve(repoRoot, "config/intent-memory-governance.json")),
      safetyRailsConfig: digestFileIfExists(resolve(repoRoot, "config/intent-safety-rails.json")),
      hardeningRegistry: digestFileIfExists(resolve(repoRoot, "config/intent-hardening-opportunities.json")),
    },
    intents,
    tasks,
  };

  const planDigestSha256 = sha256(stableStringify(staticPlan));

  return {
    ...staticPlan,
    generatedAt: new Date().toISOString(),
    intentCount: intents.length,
    taskCount: tasks.length,
    planDigestSha256,
  };
}

export function buildValidationReport({ strict, artifactPath, schemaPath, validation }) {
  const hasErrors = validation.summary.errors > 0;
  const hasWarnings = validation.summary.warnings > 0;
  const status = hasErrors || (strict && hasWarnings) ? "fail" : "pass";

  return {
    schema: "intent-validate-report.v1",
    generatedAt: new Date().toISOString(),
    strict,
    schemaPath,
    artifactPath,
    status,
    summary: validation.summary,
    intents: validation.summaries,
    findings: validation.findings,
  };
}
