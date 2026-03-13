#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const PATTERNS = [
  {
    id: "discord_webhook_url",
    description: "Potential Discord webhook URLs in history",
    regex: "https://(ptb\\.|canary\\.)?discord(app)?\\.com/api/webhooks/[0-9]+/[A-Za-z0-9_-]+",
  },
  {
    id: "discord_bot_token_var",
    description: "Discord or clawbot token variable assignments",
    regex: "(DISCORD(_|)BOT(_|)TOKEN|CLAW(DB)?OT(_|)TOKEN)\\s*[=:]",
  },
  {
    id: "discord_token_literal",
    description: "Possible Discord token literal formats",
    regex: "(mfa\\.[A-Za-z0-9_-]{20,}|[MN][A-Za-z0-9_-]{23}\\.[A-Za-z0-9_-]{6}\\.[A-Za-z0-9_-]{20,})",
  },
  {
    id: "clawbot_markers",
    description: "Historical clawbot/clawdbot references",
    regex: "(clawbot|clawdbot)",
  },
];

const GENERIC_PATTERN = {
  id: "generic_secret_assignment",
  description: "Generic high-risk secret assignment markers (broad, noisy)",
  regex: "(API_KEY|ACCESS_KEY|SECRET_KEY|PRIVATE_KEY|PASSWORD|TOKEN|WEBHOOK)\\s*[=:]\\s*[\"']?[A-Za-z0-9_\\-]{12,}",
};

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const raw = String(argv[i] ?? "");
    if (!raw.startsWith("--")) continue;
    const key = raw
      .slice(2, raw.includes("=") ? raw.indexOf("=") : undefined)
      .trim()
      .toLowerCase();
    if (!key) continue;
    if (raw.includes("=")) {
      flags[key] = raw.slice(raw.indexOf("=") + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next && !String(next).startsWith("--")) {
      flags[key] = String(next);
      i += 1;
    } else {
      flags[key] = "true";
    }
  }
  return flags;
}

function intFlag(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.trunc(parsed)) : fallback;
}

function runGit(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  }).trim();
}

function parseLogRows(raw) {
  if (!raw) return [];
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [commit, date, ...subjectParts] = line.split("\t");
      return {
        commit: commit ?? "",
        date: date ?? "",
        subject: subjectParts.join("\t") || "",
      };
    })
    .filter((row) => row.commit.length > 0);
}

function scanPattern(pattern, options) {
  const args = [
    "log",
    "--all",
    `-G${pattern.regex}`,
    "--date=short",
    "--pretty=format:%H\t%ad\t%s",
  ];

  if (options.since) {
    args.push(`--since=${options.since}`);
  }

  if (options.until) {
    args.push(`--until=${options.until}`);
  }

  const raw = runGit(args);
  const rows = parseLogRows(raw);
  const deduped = [];
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.commit)) continue;
    seen.add(row.commit);
    deduped.push(row);
    if (deduped.length >= options.maxPerPattern) break;
  }

  return {
    id: pattern.id,
    description: pattern.description,
    regex: pattern.regex,
    totalMatches: rows.length,
    sampledMatches: deduped,
    truncated: rows.length > deduped.length,
  };
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  const strict = String(flags.strict ?? "false").toLowerCase() === "true";
  const json = String(flags.json ?? "false").toLowerCase() === "true";
  const includeGeneric = String(flags["include-generic"] ?? "false").toLowerCase() === "true";
  const maxPerPattern = intFlag(flags["max-per-pattern"], 30);
  const since = flags.since ? String(flags.since).trim() : "";
  const until = flags.until ? String(flags.until).trim() : "";
  const reportPath = String(flags["report-path"] ?? "output/security/history-secret-scan.json").trim();

  const startedAt = new Date().toISOString();
  const gitRoot = runGit(["rev-parse", "--show-toplevel"]);
  const branch = runGit(["rev-parse", "--abbrev-ref", "HEAD"]);

  const activePatterns = includeGeneric ? [...PATTERNS, GENERIC_PATTERN] : PATTERNS;
  const findings = activePatterns.map((pattern) =>
    scanPattern(pattern, {
      maxPerPattern,
      since,
      until,
    })
  );

  const totalMatches = findings.reduce((sum, row) => sum + row.totalMatches, 0);
  const hasFindings = totalMatches > 0;

  const result = {
    ok: !hasFindings,
    strict,
    generatedAt: startedAt,
    gitRoot,
    branch,
    filters: {
      since: since || null,
      until: until || null,
      maxPerPattern,
      includeGeneric,
    },
    summary: {
      totalMatches,
      patternsWithFindings: findings.filter((row) => row.totalMatches > 0).length,
    },
    findings,
    nextSteps: [
      "Rotate any exposed secrets before history rewrite.",
      "Use docs/runbooks/SECURITY_HISTORY_REWRITE_PLAYBOOK.md for filter-repo workflow.",
      "Force-push rewritten refs and require collaborators to re-clone.",
    ],
  };

  const absoluteReportPath = resolve(gitRoot, reportPath);
  mkdirSync(dirname(absoluteReportPath), { recursive: true });
  writeFileSync(absoluteReportPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`security-history-scan: ${hasFindings ? "findings detected" : "no findings"}\n`);
    process.stdout.write(`report: ${absoluteReportPath}\n`);
    for (const finding of findings) {
      process.stdout.write(
        `- ${finding.id}: ${finding.totalMatches} match(es)${finding.truncated ? " (sampled)" : ""}\n`
      );
    }
  }

  if (strict && hasFindings) {
    process.exitCode = 2;
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`security-history-scan failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
