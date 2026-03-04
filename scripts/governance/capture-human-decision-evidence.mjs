#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..", "..");

function parseArgs(argv) {
  const parsed = {
    eventPath: process.env.GITHUB_EVENT_PATH || "",
    outputPath: "output/governance/human-decision-evidence.json"
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] || "");
    if (!arg) continue;
    if ((arg === "--event-path" || arg === "--event") && argv[i + 1]) {
      parsed.eventPath = String(argv[i + 1]);
      i += 1;
      continue;
    }
    if ((arg === "--output" || arg === "--report") && argv[i + 1]) {
      parsed.outputPath = String(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Capture human decision evidence",
          "",
          "Usage:",
          "  node ./scripts/governance/capture-human-decision-evidence.mjs [options]",
          "",
          "Options:",
          "  --event-path <path>   GitHub event payload path",
          "  --output <path>       JSON output path"
        ].join("\n")
      );
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function readJson(pathValue) {
  return JSON.parse(readFileSync(pathValue, "utf8"));
}

function normalizePath(value) {
  return String(value || "").replaceAll("\\", "/");
}

function loadAuthorityMap() {
  const authorityPath = resolve(REPO_ROOT, ".governance/config/authority-map.json");
  if (!existsSync(authorityPath)) {
    return { verified_identities: [], default_unknown_identity_tier: 5 };
  }
  try {
    return readJson(authorityPath);
  } catch {
    return { verified_identities: [], default_unknown_identity_tier: 5 };
  }
}

function tierForLogin(login, authorityMap) {
  const normalizedLogin = String(login || "").toLowerCase();
  const identities = Array.isArray(authorityMap.verified_identities) ? authorityMap.verified_identities : [];
  const row = identities.find((entry) => String(entry.github_login || "").toLowerCase() === normalizedLogin);
  if (!row) return Number(authorityMap.default_unknown_identity_tier || 5);
  return Number(row.tier || 5);
}

function summaryFromBody(body) {
  return String(body || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 280);
}

function extractEventPayload(event) {
  if (event.comment) {
    return {
      author: event.comment.user?.login || "",
      body: event.comment.body || "",
      url: event.comment.html_url || "",
      timestamp: event.comment.created_at || new Date().toISOString(),
      kind: "comment",
      issueNumber: event.issue?.number || null,
      prNumber: event.issue?.pull_request ? event.issue?.number : null
    };
  }
  if (event.review) {
    return {
      author: event.review.user?.login || "",
      body: event.review.body || "",
      url: event.review.html_url || "",
      timestamp: event.review.submitted_at || new Date().toISOString(),
      kind: "review",
      issueNumber: null,
      prNumber: event.pull_request?.number || null
    };
  }
  return null;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.eventPath) {
    throw new Error("Missing event payload path.");
  }

  const event = readJson(resolve(args.eventPath));
  const payload = extractEventPayload(event);
  if (!payload) {
    throw new Error("Unsupported event payload for decision capture.");
  }

  const authorityMap = loadAuthorityMap();
  const tier = tierForLogin(payload.author, authorityMap);
  const accepted = tier === 1;

  const record = {
    captured_at: new Date().toISOString(),
    accepted_as_tier1: accepted,
    actor: {
      github_login: payload.author,
      tier
    },
    source: {
      kind: payload.kind,
      url: payload.url,
      timestamp: payload.timestamp,
      issue_number: payload.issueNumber,
      pr_number: payload.prNumber
    },
    evidence_record: {
      evidence_id: `human-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
      source_type: "human",
      pointer: payload.url,
      timestamp: payload.timestamp,
      hash_attestation: null,
      redaction_metadata: {
        redacted: false,
        reason: null,
        fields_removed: []
      }
    },
    summary: summaryFromBody(payload.body)
  };

  const outputPath = resolve(REPO_ROOT, args.outputPath);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");

  process.stdout.write(`decision-capture accepted_tier1: ${accepted}\n`);
  process.stdout.write(`actor: ${payload.author || "unknown"} (tier ${tier})\n`);
  process.stdout.write(`artifact: ${normalizePath(args.outputPath)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`decision-capture failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

