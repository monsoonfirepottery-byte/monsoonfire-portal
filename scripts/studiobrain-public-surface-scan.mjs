#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);
const DEFAULT_REPORT_PATH = resolve(REPO_ROOT, "output", "security", "studiobrain", "public-surface-scan.json");
const PUBLIC_PORTS = [80, 443, 22, 8787, 5433, 6379, 9010, 9011, 18080, 18081, 4317, 4318, 8889];
const LAN_PORTS = [22, 8787, 5433, 6379, 9010, 9011, 18080, 18081, 4317, 4318, 8889];

const args = process.argv.slice(2);
const jsonMode = args.includes("--json");
const reportPath = resolve(REPO_ROOT, readFlagValue(args, "--report-path") || DEFAULT_REPORT_PATH);
const publicHost = readFlagValue(args, "--public-host") || process.env.STUDIO_BRAIN_PUBLIC_IP || "";
const lanHost = readFlagValue(args, "--lan-host") || process.env.STUDIO_BRAIN_HOST || "";

async function main() {
  const report = {
    generatedAt: new Date().toISOString(),
    publicHost: publicHost || null,
    lanHost: lanHost || null,
    publicPorts: [],
    lanPorts: [],
  };

  if (publicHost) {
    report.publicPorts = PUBLIC_PORTS.map((port) => scanPort(publicHost, port));
  }

  if (lanHost) {
    report.lanPorts = LAN_PORTS.map((port) => scanPort(lanHost, port));
  }

  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  process.stdout.write(`public surface scan report: ${reportPath}\n`);
  for (const entry of report.publicPorts) {
    process.stdout.write(`public ${entry.host}:${entry.port} ${entry.state}\n`);
  }
  for (const entry of report.lanPorts) {
    process.stdout.write(`lan ${entry.host}:${entry.port} ${entry.state}\n`);
  }
}

function readFlagValue(argv, flag) {
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === flag) {
      return String(argv[index + 1] || "").trim();
    }
    if (String(value).startsWith(`${flag}=`)) {
      return String(value).slice(flag.length + 1).trim();
    }
  }
  return "";
}

function scanPort(host, port) {
  const result = spawnSync("nc", ["-vz", "-w", "2", host, String(port)], {
    encoding: "utf8",
    stdio: "pipe",
  });
  const combined = `${result.stdout || ""}${result.stderr || ""}`.trim();
  const state = result.status === 0 ? "open" : "closed";
  return {
    host,
    port,
    state,
    output: combined,
  };
}

void main().catch((error) => {
  process.stderr.write(`public surface scan failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
