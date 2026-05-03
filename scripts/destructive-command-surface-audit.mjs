#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultJsonPath = resolve(repoRoot, "output", "qa", "destructive-command-surfaces.json");
const defaultMarkdownPath = resolve(repoRoot, "output", "qa", "destructive-command-surfaces.md");

const SURFACES = [
  {
    id: "portal-namecheap-remote-cleanup",
    file: "scripts/deploy-namecheap-portal.mjs",
    owner: "portal deploy",
    classification: "remote deploy cleanup",
    evidence: ["rm -rf", "find ${shellQuote(options.remotePath)}"],
    guards: [
      "assertSafeRemotePath(options.remotePath",
      "assertSafeRemotePath(remoteRollbackPath",
      "assertSafeRemoteName(remoteUploadDirName",
    ],
    dryRun:
      "node ./scripts/deploy-namecheap-portal.mjs --benchmark-probe --json",
  },
  {
    id: "website-namecheap-remote-promotion",
    file: "website/scripts/deploy.mjs",
    owner: "website deploy",
    classification: "remote deploy promotion",
    evidence: ["rm -rf ${remoteSource}", "--dry-run"],
    guards: ["assertSafeRemotePath(remotePath", "assertSafeRemoteName(sourceName"],
    dryRun:
      "node ./website/scripts/deploy.mjs --dry-run --server <host> --key <key> --source website/ncsitebuilder --remote-path public_html/",
  },
  {
    id: "portable-java-cache-cleanup",
    file: "scripts/bootstrap-local.sh",
    owner: "local bootstrap",
    classification: "local user-cache cleanup",
    evidence: ['rm -rf "$portable_root"/*'],
    guards: ['assert_portable_java_cleanup_path "$portable_root"'],
    dryRun: "n/a; cleanup is bounded to $HOME/.local/jre17-portable before download",
  },
  {
    id: "studiobrain-bambu-install-root-refresh",
    file: "scripts/install-studiobrain-bambu-cli.sh",
    owner: "Studio Brain host tooling",
    classification: "host install refresh",
    evidence: ['rm -rf "${VERSION_ROOT}"'],
    guards: ['assert_child_path "${VERSION_ROOT}" "${INSTALL_ROOT}"'],
    dryRun: "n/a; guarded install refresh under STUDIO_BRAIN_BAMBU_ROOT",
  },
  {
    id: "studiobrain-bambu-smoke-output-cleanup",
    file: "scripts/studiobrain-bambu-cli.sh",
    owner: "Studio Brain host tooling",
    classification: "local smoke output cleanup",
    evidence: ['rm -rf "${output_dir}"'],
    guards: ['assert_smoke_cleanup_path "${output_dir}"'],
    dryRun: "STUDIO_BRAIN_BAMBU_* env can point smoke output under data root; --keep-output disables cleanup",
  },
  {
    id: "studiobrain-monitoring-container-bootstrap-cleanup",
    file: "scripts/install-studiobrain-monitoring.sh",
    owner: "Studio Brain host tooling",
    classification: "container-local bootstrap cleanup",
    evidence: ["rm -rf /tmp/kuma-bootstrap"],
    guards: ["docker exec uptime-kuma sh -lc 'rm -rf /tmp/kuma-bootstrap"],
    dryRun: "n/a; cleanup is inside the uptime-kuma container at a fixed /tmp path",
  },
  {
    id: "lighthouse-workspace-cache-cleanup",
    file: ".github/workflows/lighthouse.yml",
    owner: "website QA",
    classification: "CI workspace cache cleanup",
    evidence: ["rm -rf .lighthouseci"],
    guards: ["rm -rf .lighthouseci"],
    dryRun: "n/a; removes workflow-local Lighthouse cache only",
  },
  {
    id: "firebase-preview-channel-prune",
    file: "scripts/prune-firebase-preview-channels.mjs",
    owner: "portal deploy",
    classification: "Firebase preview channel deletion",
    evidence: ["hosting:channel:delete", "options.dryRun"],
    guards: ["options.maxDelete", "output.plannedDelete.push(channel.id)"],
    dryRun: "node ./scripts/prune-firebase-preview-channels.mjs --dry-run --json",
  },
  {
    id: "firestore-index-deploy-temp-credential-cleanup",
    file: "scripts/firestore-indexes-deploy.mjs",
    owner: "portal deploy",
    classification: "temporary credential cleanup",
    evidence: ['mkdtemp(resolve(tmpdir(), "firebase-sa-"))', "await rm(auth.cleanupDir"],
    guards: ['mkdtemp(resolve(tmpdir(), "firebase-sa-"))', "if (auth.cleanupDir)"],
    dryRun: "n/a; cleanup is limited to mkdtemp-created credential directory",
  },
  {
    id: "portal-virtual-staff-temp-credential-cleanup",
    file: "scripts/run-portal-virtual-staff-regression.mjs",
    owner: "portal QA",
    classification: "temporary credential cleanup",
    evidence: ['mkdtemp(resolve(tmpdir(), "portal-agent-staff-"))', "await rm(cleanupDir"],
    guards: ['mkdtemp(resolve(tmpdir(), "portal-agent-staff-"))', "if (cleanupDir)"],
    dryRun: "n/a; cleanup is limited to mkdtemp-created credential directory",
  },
];

function parseArgs(argv) {
  const options = {
    json: false,
    jsonPath: defaultJsonPath,
    markdownPath: defaultMarkdownPath,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--out-json" && argv[index + 1]) {
      options.jsonPath = resolve(process.cwd(), argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--out-md" && argv[index + 1]) {
      options.markdownPath = resolve(process.cwd(), argv[index + 1]);
      index += 1;
    }
  }

  return options;
}

function auditSurface(surface) {
  const absolutePath = resolve(repoRoot, surface.file);
  const text = existsSync(absolutePath) ? readFileSync(absolutePath, "utf8") : "";
  const missingEvidence = surface.evidence.filter((pattern) => !text.includes(pattern));
  const missingGuards = surface.guards.filter((pattern) => !text.includes(pattern));
  const status = missingEvidence.length === 0 && missingGuards.length === 0 ? "pass" : "fail";

  return {
    ...surface,
    file: relative(repoRoot, absolutePath).replace(/\\/g, "/"),
    status,
    missingEvidence,
    missingGuards,
  };
}

function toMarkdown(report) {
  const lines = [
    "# Destructive Command Surface Audit",
    "",
    `Generated: ${report.generatedAtIso}`,
    "",
    "| Status | Surface | Owner | Classification | Guard evidence | Dry run / boundary |",
    "| --- | --- | --- | --- | --- | --- |",
  ];

  for (const surface of report.surfaces) {
    lines.push(
      `| ${surface.status} | \`${surface.file}\` | ${surface.owner} | ${surface.classification} | ${surface.guards.map((guard) => `\`${guard}\``).join("<br>")} | ${surface.dryRun} |`
    );
  }

  return `${lines.join("\n")}\n`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const surfaces = SURFACES.map(auditSurface);
  const failed = surfaces.filter((surface) => surface.status !== "pass");
  const report = {
    schema: "destructive-command-surface-audit.v1",
    generatedAtIso: new Date().toISOString(),
    status: failed.length === 0 ? "pass" : "fail",
    surfaceCount: surfaces.length,
    failedCount: failed.length,
    surfaces,
  };

  mkdirSync(dirname(options.jsonPath), { recursive: true });
  writeFileSync(options.jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  mkdirSync(dirname(options.markdownPath), { recursive: true });
  writeFileSync(options.markdownPath, toMarkdown(report), "utf8");

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`destructive surfaces: ${report.status} (${report.surfaceCount} checked)\n`);
    if (failed.length > 0) {
      for (const surface of failed) {
        process.stdout.write(`failed: ${surface.id}\n`);
      }
    }
  }

  if (report.status !== "pass") {
    process.exitCode = 1;
  }
}

main();
