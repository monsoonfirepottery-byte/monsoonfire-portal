#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

function parseArgs(argv) {
  const parsed = {
    json: false,
    strict: false,
    inputPath: "imports/memory-context-slice.jsonl",
    configPath: "config/intent-memory-governance.json",
    artifact: "output/open-memory/memory-governance-latest.json",
    runId: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");
    if (!arg) continue;
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--strict") {
      parsed.strict = true;
      continue;
    }

    if ((arg === "--input" || arg === "--input-path") && argv[index + 1]) {
      parsed.inputPath = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--input=")) {
      parsed.inputPath = arg.slice("--input=".length).trim();
      continue;
    }

    if ((arg === "--config" || arg === "--config-path") && argv[index + 1]) {
      parsed.configPath = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--config=")) {
      parsed.configPath = arg.slice("--config=".length).trim();
      continue;
    }

    if ((arg === "--artifact" || arg === "--report") && argv[index + 1]) {
      parsed.artifact = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--artifact=")) {
      parsed.artifact = arg.slice("--artifact=".length).trim();
      continue;
    }

    if (arg === "--run-id" && argv[index + 1]) {
      parsed.runId = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--run-id=")) {
      parsed.runId = arg.slice("--run-id=".length).trim();
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Intent memory governance",
          "",
          "Usage:",
          "  node ./scripts/intent-memory-governance.mjs [--input imports/memory-context-slice.jsonl] [--json]",
        ].join("\n")
      );
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function parseJsonl(path) {
  const raw = readFileSync(path, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function hashOf(value) {
  return createHash("sha256").update(value).digest("hex");
}

function confidenceForItem(item, config) {
  const bySource = config?.confidenceBySource || {};
  const source = String(item?.source || "");
  if (source && Number.isFinite(Number(bySource[source]))) {
    return Number(bySource[source]);
  }
  return Number(config?.defaults?.minConfidence || 0.7);
}

function compilePatternList(rows) {
  if (!Array.isArray(rows)) return [];
  const compiled = [];
  for (const row of rows) {
    const pattern = String(row || "").trim();
    if (!pattern) continue;
    try {
      compiled.push(new RegExp(pattern, "i"));
    } catch {
      // Skip invalid patterns.
    }
  }
  return compiled;
}

function extractMemoryText(entry) {
  return String(entry?.content || entry?.statement || entry?.text || "").trim();
}

function detectPolarity(normalizedText) {
  const positiveHints = [" allow ", " enable ", " approved ", " safe ", " should "];
  const negativeHints = [" deny ", " disable ", " forbidden ", " unsafe ", " must not "];
  let positive = 0;
  let negative = 0;
  for (const token of positiveHints) {
    if (normalizedText.includes(token.trim())) positive += 1;
  }
  for (const token of negativeHints) {
    if (normalizedText.includes(token.trim())) negative += 1;
  }
  if (positive > negative) return "positive";
  if (negative > positive) return "negative";
  return "neutral";
}

function subjectFingerprint(normalizedText) {
  const words = normalizedText
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .slice(0, 12);
  return words.join(" ");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputAbsolutePath = resolve(REPO_ROOT, args.inputPath);
  const configAbsolutePath = resolve(REPO_ROOT, args.configPath);
  const artifactAbsolutePath = resolve(REPO_ROOT, args.artifact);

  if (!existsSync(configAbsolutePath)) {
    throw new Error(`Memory governance config not found: ${configAbsolutePath}`);
  }
  const config = readJson(configAbsolutePath);
  const promptInjectionPatterns = compilePatternList(config?.promptInjectionPatterns);
  const trustedSources = new Set(
    Array.isArray(config?.trustedSources) ? config.trustedSources.map((row) => normalize(row)).filter(Boolean) : []
  );
  const laneRules = config?.laneRules && typeof config.laneRules === "object" ? config.laneRules : {};
  const quarantineLanes = new Set(
    Array.isArray(laneRules?.quarantineLanes) ? laneRules.quarantineLanes.map((row) => normalize(row)).filter(Boolean) : []
  );
  const autoAcceptByLane =
    laneRules?.autoAcceptByLane && typeof laneRules.autoAcceptByLane === "object" ? laneRules.autoAcceptByLane : {};
  const poisoningConfig = config?.poisoning && typeof config.poisoning === "object" ? config.poisoning : {};
  const quarantineEnabled = poisoningConfig.quarantineEnabled !== false;
  const maxPromptInjectionMatchesBeforeFail = Number(poisoningConfig.maxPromptInjectionMatchesBeforeFail ?? 0);
  const maxContradictionMatchesBeforeFail = Number(poisoningConfig.maxContradictionMatchesBeforeFail ?? 2);

  if (!existsSync(inputAbsolutePath)) {
    const emptyReport = {
      schema: "intent-memory-governance-report.v1",
      generatedAt: new Date().toISOString(),
      runId: args.runId || null,
      status: "pass",
      inputPath: args.inputPath,
      summary: {
        total: 0,
        unique: 0,
        duplicates: 0,
        lowConfidence: 0,
        stale: 0,
        promptInjection: 0,
        contradiction: 0,
        quarantined: 0,
        autoAcceptCandidates: 0,
      },
      actions: [],
      warnings: ["Input memory slice not found; governance skipped."],
    };
    mkdirSync(dirname(artifactAbsolutePath), { recursive: true });
    writeFileSync(artifactAbsolutePath, `${JSON.stringify(emptyReport, null, 2)}\n`, "utf8");
    if (args.json) process.stdout.write(`${JSON.stringify(emptyReport, null, 2)}\n`);
    return;
  }

  const entries = parseJsonl(inputAbsolutePath);
  const maxAgeDays = Number(config?.defaults?.maxAgeDays || 730);
  const minConfidence = Number(config?.defaults?.minConfidence || 0.7);
  const now = Date.now();

  const seen = new Map();
  const subjectPolarity = new Map();
  let duplicateCount = 0;
  let lowConfidenceCount = 0;
  let staleCount = 0;
  let promptInjectionCount = 0;
  let contradictionCount = 0;
  let quarantinedCount = 0;
  let autoAcceptCandidateCount = 0;
  const actions = [];

  for (const entry of entries) {
    const rawText = extractMemoryText(entry);
    const normalizedText = ` ${normalize(rawText)} `;
    const contentKey = normalize(rawText);
    const sourceKey = normalize(entry?.source || "");
    const tagsKey = Array.isArray(entry?.tags) ? entry.tags.map((tag) => normalize(tag)).sort().join(",") : "";
    const dedupeKey = hashOf(`${contentKey}|${sourceKey}|${tagsKey}`);

    if (seen.has(dedupeKey)) {
      duplicateCount += 1;
      actions.push({
        type: "dedupe_candidate",
        reason: "duplicate-content-source-tags",
        duplicateOf: seen.get(dedupeKey),
        memoryId: entry?.id || null,
      });
    } else {
      seen.set(dedupeKey, entry?.id || dedupeKey);
    }

    const confidence = confidenceForItem(entry, config);
    const projectLane = normalize(entry?.metadata?.projectLane || entry?.projectLane || "");
    if (confidence < minConfidence) {
      lowConfidenceCount += 1;
      actions.push({
        type: "confidence_review",
        reason: `confidence ${confidence.toFixed(3)} below min ${minConfidence.toFixed(3)}`,
        memoryId: entry?.id || null,
      });
    }

    if (trustedSources.size > 0 && sourceKey && !trustedSources.has(sourceKey)) {
      actions.push({
        type: "source_trust_review",
        reason: `source "${sourceKey}" is outside trustedSources`,
        memoryId: entry?.id || null,
      });
    }

    if (quarantineEnabled && projectLane && quarantineLanes.has(projectLane)) {
      quarantinedCount += 1;
      actions.push({
        type: "lane_quarantine",
        reason: `lane "${projectLane}" is configured for quarantine`,
        memoryId: entry?.id || null,
      });
    }

    if (projectLane && sourceKey) {
      const allowedSources = Array.isArray(autoAcceptByLane[projectLane])
        ? autoAcceptByLane[projectLane].map((row) => normalize(row)).filter(Boolean)
        : [];
      if (allowedSources.includes(sourceKey) && confidence >= minConfidence) {
        autoAcceptCandidateCount += 1;
        actions.push({
          type: "auto_accept_candidate",
          reason: `lane "${projectLane}" allows source "${sourceKey}" at confidence ${confidence.toFixed(3)}`,
          memoryId: entry?.id || null,
        });
      }
    }

    let flaggedPromptInjection = false;
    for (const pattern of promptInjectionPatterns) {
      if (pattern.test(rawText)) {
        flaggedPromptInjection = true;
        promptInjectionCount += 1;
        actions.push({
          type: "prompt_injection_quarantine",
          reason: `matched prompt-injection pattern ${pattern}`,
          memoryId: entry?.id || null,
        });
      }
    }

    const subject = subjectFingerprint(normalizedText);
    if (subject) {
      const polarity = detectPolarity(normalizedText);
      const prior = subjectPolarity.get(subject) || null;
      if (prior && prior !== polarity && prior !== "neutral" && polarity !== "neutral") {
        contradictionCount += 1;
        actions.push({
          type: "contradiction_quarantine",
          reason: `contradictory polarity detected for subject "${subject}"`,
          memoryId: entry?.id || null,
        });
      } else if (!prior) {
        subjectPolarity.set(subject, polarity);
      }
    }

    const occurredAt = Date.parse(String(entry?.occurredAt || entry?.createdAt || ""));
    if (Number.isFinite(occurredAt)) {
      const ageDays = (now - occurredAt) / (24 * 60 * 60 * 1000);
      if (ageDays > maxAgeDays) {
        staleCount += 1;
        actions.push({
          type: "stale_review",
          reason: `age ${ageDays.toFixed(1)} days exceeds maxAgeDays ${maxAgeDays}`,
          memoryId: entry?.id || null,
        });
      }
    }

    if (quarantineEnabled && flaggedPromptInjection) {
      quarantinedCount += 1;
    }
  }

  if (quarantineEnabled) {
    quarantinedCount += contradictionCount;
  }

  const shouldFail =
    (maxPromptInjectionMatchesBeforeFail >= 0 && promptInjectionCount > maxPromptInjectionMatchesBeforeFail) ||
    (maxContradictionMatchesBeforeFail >= 0 && contradictionCount > maxContradictionMatchesBeforeFail);

  const report = {
    schema: "intent-memory-governance-report.v1",
    generatedAt: new Date().toISOString(),
    runId: args.runId || null,
    status: shouldFail ? "fail" : "pass",
    inputPath: args.inputPath,
    configPath: args.configPath,
    summary: {
      total: entries.length,
      unique: seen.size,
      duplicates: duplicateCount,
      lowConfidence: lowConfidenceCount,
      stale: staleCount,
      promptInjection: promptInjectionCount,
      contradiction: contradictionCount,
      quarantined: quarantinedCount,
      autoAcceptCandidates: autoAcceptCandidateCount,
      minConfidence,
      maxAgeDays,
    },
    actions,
    warnings: [],
  };

  mkdirSync(dirname(artifactAbsolutePath), { recursive: true });
  writeFileSync(artifactAbsolutePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`intent-memory-governance status: ${report.status}\n`);
    process.stdout.write(`report: ${artifactAbsolutePath}\n`);
  }

  if (report.status !== "pass" && args.strict) {
    process.exitCode = 1;
  } else if (report.status !== "pass") {
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`intent-memory-governance failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
