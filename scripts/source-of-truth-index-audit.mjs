#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), "..");

const args = parseArgs(process.argv.slice(2));
const strict = args.strict;
const emitJson = args.json;
const requireLocalMcpKeys = args.requireLocalMcpKeys
  || String(process.env.SOURCE_OF_TRUTH_REQUIRE_LOCAL_MCP_KEYS || "").trim().toLowerCase() === "true"
  || String(process.env.SOURCE_OF_TRUTH_REQUIRE_LOCAL_MCP_KEYS || "").trim() === "1";
const artifactPath = resolve(ROOT, args.artifact || "output/source-of-truth-index-audit/latest.json");

const indexPath = resolve(ROOT, "docs/SOURCE_OF_TRUTH_INDEX.md");
const codexConfigPath = resolve(process.env.HOME || process.env.USERPROFILE || "", ".codex", "config.toml");

const report = {
  timestamp: new Date().toISOString(),
  strict,
  status: "pass",
  index: {
    path: indexPath,
    exists: false,
  },
  checks: [],
  summary: {
    errors: 0,
    warnings: 0,
    rows: 0,
  },
};

const requiredSections = [
  "Contract Sources",
  "Deployment/Environment Sources",
  "MCP & External Sources",
  "Evidence Evidence Bundle Outputs",
];

const requiredIndexStatements = [
  "source-of-truth index",
  "Ubuntu server administration",
  "Home automation",
  "Agent orchestration",
  "Apple Home",
  "well-known validation",
  "store-readiness",
];

const allowedTrustLevels = new Set(["authoritative", "derived", "generated", "advisory", "trusted"]);

const requiredMcpKeys = new Set([
  "homeAssistantMcpIntegration",
  "ubuntuServerAdministrationReference",
  "ubuntuServerInstallationGuide",
  "ubuntuSecurityGuide",
  "ubuntuNetworkingGuide",
  "ubuntuCloudInitGuide",
  "ubuntuFirewallGuide",
  "ubuntuSystemdGuide",
  "ubuntuBackupGuide",
  "serverOperationsDocker",
  "serverOperationsSsh",
  "agentOrchestrationDockerDocs",
  "agentOrchestrationDockerComposeDocs",
  "agentOrchestrationKubernetes",
  "agentOrchestrationKubernetesDocs",
  "agentOrchestrationAnsible",
  "agentOrchestrationJenkins",
  "agentOrchestrationNomad",
  "agentOrchestrationPodman",
  "homeAssistantMcpServer",
  "homeAssistantMcpServerAi",
  "homeAssistantMcpCommunityServer",
  "homeAssistantMcpServerDocs",
  "homeAssistantCameraIntegration",
  "homeAssistantOnvifIntegration",
  "homeAssistantStreamIntegration",
  "homeAssistantFFmpegIntegration",
  "homeAssistantAqaraIntegration",
  "hubitatMCP",
  "hubitatMakerAPI",
  "appleHomeDocumentation",
  "appleHomeKitAppStoreGuidance",
  "appleHomeAppSiteAssociation",
  "appleHomeKitAccess",
  "appleAssociatedDomains",
]);

function parseMcpRows(rows) {
  return rows
    .filter((row) => typeof row?.source === "string" && row.source.includes("mcp_servers."))
    .map((row) => ({
      ...row,
      keys: extractMcpServerKeys(row.source),
      domain: row.domain,
    }))
    .filter((entry) => entry.keys.length > 0);
}

if (!existsSync(indexPath)) {
  addFinding(
    "error",
    "index-file",
    `Source-of-truth index file not found: ${indexPath}`,
    {
      expected: indexPath,
      actual: "missing",
    },
  );
} else {
  report.index.exists = true;
  const content = readFile(indexPath);
  for (const section of requiredSections) {
    addFinding(
      content.includes(section) ? "pass" : "error",
      "index-section",
      `Required section is ${content.includes(section) ? "present" : "missing"}: ${section}`,
      section,
      content.includes(section) ? "present" : "missing",
    );
  }

  for (const statement of requiredIndexStatements) {
    addFinding(
      content.toLowerCase().includes(statement.toLowerCase()) ? "pass" : "warning",
      "index-coverage",
      `Source-of-truth index should include: ${statement}`,
      statement,
      content.toLowerCase().includes(statement.toLowerCase()) ? "present" : "missing",
    );
  }

  const parsedRows = parseMarkdownRows(content);
  const mcpRows = parseMcpRows(parsedRows);
  const trustViolations = [];
  const localSourceRows = [];
  for (const row of parsedRows) {
    report.summary.rows += 1;
    const trust = String(row.trust || "").trim().toLowerCase();
    if (trust && !allowedTrustLevels.has(trust)) {
      trustViolations.push({
        domain: row.domain,
        source: row.source,
        trust,
      });
      addFinding("error", "trust-level", `Unknown trust label in index row: ${row.domain}`, row, trust);
    } else if (trust) {
      addFinding("pass", "trust-level", `Trust label validated for ${row.domain}`, row, trust);
    }

    const localSources = extractLocalSources(row.source || "");
    if (localSources.length === 0) {
      continue;
    }
    for (const source of localSources) {
      if (!shouldCheckSourcePath(source)) {
        continue;
      }
      const local = resolve(ROOT, source);
      if (!existsSync(local)) {
        addFinding(
          "warning",
          "index-source-file",
          `Source-of-truth artifact referenced by index is missing in repo: ${source}`,
          source,
          existsSync(local) ? "exists" : "missing",
        );
      }
    }
    localSourceRows.push({ domain: row.domain, source: row.source });
  }

  addFinding(
    "pass",
    "index-table",
    `Parsed source-of-truth index rows: ${localSourceRows.length}`,
    "rows",
    localSourceRows.length,
  );

  for (const requiredKey of requiredMcpKeys) {
    const matches = resolveMcpRowsForKey(requiredKey, mcpRows);
    if (matches.length === 0) {
      addFinding(
        "error",
        "mcp-index-reference",
        `MCP reference in source-of-truth index is missing for key: mcp_servers.${requiredKey}`,
        requiredKey,
        "reference row (direct or wildcard)",
      );
      continue;
    }
    if (matches.length > 1) {
      addFinding(
        "error",
        "mcp-index-reference",
        `MCP key appears in multiple source-of-truth index rows: mcp_servers.${requiredKey}`,
        requiredKey,
        matches.map((entry) => ({ domain: entry.domain, source: entry.source })),
      );
      continue;
    }
    addFinding(
      "pass",
      "mcp-index-reference",
      `MCP key is represented in index: mcp_servers.${requiredKey}`,
      requiredKey,
      matches[0].domain,
    );
  }
}

if (existsSync(codexConfigPath)) {
  const configText = readFile(codexConfigPath);
  const observedKeys = Array.from(configText.matchAll(/^\s*\[mcp_servers\.(?<name>[A-Za-z0-9_]+)\]/gm))
    .map((entry) => entry?.groups?.name)
    .filter(Boolean);
  const missingKeys = [...requiredMcpKeys].filter((requiredKey) => !observedKeys.includes(requiredKey));

  if (requireLocalMcpKeys) {
    for (const requiredKey of requiredMcpKeys) {
      const present = observedKeys.includes(requiredKey);
      addFinding(
        present ? "pass" : "error",
        "mcp-key",
        `Required MCP key ${present ? "present" : "missing"} in .codex/config.toml: mcp_servers.${requiredKey}`,
        requiredKey,
        present ? "present" : "missing",
      );
    }
  } else {
    addFinding(
      "pass",
      "mcp-key",
      "Local MCP key inventory is advisory by default; strict failure requires --require-local-mcp-keys or SOURCE_OF_TRUTH_REQUIRE_LOCAL_MCP_KEYS=true.",
      {
        config: codexConfigPath,
        configuredCount: observedKeys.length,
        requiredCount: requiredMcpKeys.size,
        missingCount: missingKeys.length,
        missingKeys,
      },
      "advisory",
    );
  }
} else {
  addFinding(
    "pass",
    "mcp-key",
    `.codex/config.toml not found at ${codexConfigPath}; MCP source inventory skipped (non-fatal in CI)`,
    {
      config: codexConfigPath,
      mode: "pass",
    },
    "missing",
  );
}

const errors = report.checks.filter((entry) => entry.severity === "error");
const warnings = report.checks.filter((entry) => entry.severity === "warning");
report.summary.errors = errors.length;
report.summary.warnings = warnings.length;
report.status = errors.length > 0 || (strict && warnings.length > 0) ? "fail" : "pass";

if (emitJson) {
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  for (const entry of report.checks) {
    if (entry.severity === "pass") {
      continue;
    }
    const label = entry.severity === "error" ? "[ERROR]" : "[WARN]";
    process.stdout.write(`${label} ${entry.id} — ${entry.message}\n`);
    if (entry.value !== undefined) {
      process.stdout.write(`  value: ${JSON.stringify(entry.value)}\n`);
    }
  }
  process.stdout.write(`source-of-truth-index-audit: ${report.status.toUpperCase()}\n`);
}

process.exit(report.status === "pass" ? 0 : 1);

function addFinding(severity, id, message, value, expected) {
  const normalizedSeverity = severity === "pass" ? "pass" : severity;
  report.checks.push({
    id,
    severity: normalizedSeverity,
    message,
    value,
    expected,
  });
}

function parseMarkdownRows(rawText) {
  const rows = [];
const tableRow = /^\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|$/;

for (const line of rawText.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || tableRow.test(trimmed) === false) {
    continue;
  }
  if (isHeaderRow(trimmed) || /^\|[-:]+\|/.test(trimmed)) {
    continue;
  }
  const match = trimmed.match(tableRow);
    if (!match) {
      continue;
    }
    rows.push({
      domain: match[1].trim(),
      source: match[2].trim(),
      trustedBy: match[3].trim(),
      trust: match[4].trim(),
    });
  }
  return rows;
}

function extractMcpServerKeys(rawSource) {
  const source = String(rawSource || "");
  const refs = source.matchAll(/mcp_servers\.([A-Za-z0-9_]+\*?)/g);
  return [...refs]
    .map((entry) => String(entry?.[1] || ""))
    .map((entry) => entry.replace(/\)$/, ""))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function resolveMcpRowsForKey(requiredKey, mcpRows) {
  const directMatches = mcpRows.filter((row) => row.keys.includes(requiredKey));
  if (directMatches.length > 0) {
    return dedupeMcpRows(directMatches.map((row) => ({ domain: row.domain, source: row.source })));
  }
  const wildcardMatches = mcpRows.filter((row) => row.keys.some((candidate) => candidate.endsWith("*") && requiredKey.startsWith(candidate.slice(0, -1))));
  return dedupeMcpRows(wildcardMatches.map((row) => ({ domain: row.domain, source: row.source })));
}

function dedupeMcpRows(rows) {
  const seen = new Set();
  const deduped = [];
  for (const row of rows) {
    const key = `${row.domain}::${row.source}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
}

function extractLocalSources(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw) {
    return [];
  }

  const inlineSources = [...raw.matchAll(/`([^`]+)`/g)].map((entry) => normalizeSourcePath(entry[1])).filter(Boolean);
  if (inlineSources.length > 0) {
    return [...new Set(inlineSources)];
  }

  const splitSources = raw
    .split(/[,+]/)
    .map((entry) => normalizeSourcePath(entry))
    .filter(Boolean);

  return [...new Set(splitSources)];
}

function normalizeSourcePath(rawPath) {
  const normalized = String(rawPath || "").trim()
    .replace(/^\(|\)$/g, "")
    .replace(/^`+|`+$/g, "")
    .replace(/^"+|"+$/g, "")
    .trim();
  return normalized;
}

function shouldCheckSourcePath(source) {
  if (!source) {
    return false;
  }
  if (source.startsWith(".codex/")) {
    return false;
  }
  if (source.startsWith("http://") || source.startsWith("https://")) {
    return false;
  }
  if (/\s/.test(source)) {
    return false;
  }
  if (source.includes("mcp_")) {
    return false;
  }
  if (!source.includes("/") && !/\.[a-z0-9]+$/i.test(source)) {
    return false;
  }
  return isLocalSourcePath(source);
}

function isLocalSourcePath(source) {
  const normalized = String(source || "").trim();
  return normalized.startsWith(".")
    || normalized.startsWith("functions/")
    || normalized.startsWith("website/")
    || normalized.startsWith("scripts/")
    || normalized.startsWith("ios/")
    || normalized.startsWith("android/")
    || normalized.startsWith("docs/")
    || normalized.startsWith("tickets/")
    || normalized.startsWith(".github/");
}

function isHeaderRow(rawLine) {
  return /^(\|?\s*domain\s*)\|/i.test(rawLine);
}

function parseArgs(argv) {
  const parsed = {
    strict: false,
    json: false,
    requireLocalMcpKeys: false,
    artifact: "output/source-of-truth-index-audit/latest.json",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--strict") {
      parsed.strict = true;
      continue;
    }
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--artifact") {
      parsed.artifact = argv[index + 1] || parsed.artifact;
      index += 1;
      continue;
    }
    if (arg === "--require-local-mcp-keys") {
      parsed.requireLocalMcpKeys = true;
      continue;
    }
  }

  return parsed;
}

function readFile(filePath) {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}
