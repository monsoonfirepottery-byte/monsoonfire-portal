#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { REPO_ROOT } from "./lib/codex-automation-control.mjs";

const __filename = fileURLToPath(import.meta.url);

const defaultSourceDir = resolve(REPO_ROOT, "config", "monsoonfire", "systemd");
const defaultInstallDir = resolve(os.homedir(), ".config", "systemd", "user");

function parseArgs(argv) {
  const parsed = {
    sourceDir: defaultSourceDir,
    installDir: defaultInstallDir,
    disableTimer: true,
    asJson: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");
    if (!arg) continue;

    if (arg === "--json") {
      parsed.asJson = true;
      continue;
    }
    if (arg === "--enable-timer") {
      parsed.disableTimer = false;
      continue;
    }
    if (arg === "--disable-timer") {
      parsed.disableTimer = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Install Monsoonfire automation systemd units",
          "",
          "Usage:",
          "  node ./scripts/install-monsoonfire-automation-systemd.mjs [--json]",
        ].join("\n")
      );
      process.exit(0);
    }

    const next = argv[index + 1];
    if (!arg.startsWith("--")) continue;
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === "--source-dir") {
      parsed.sourceDir = resolve(process.cwd(), String(next).trim());
      index += 1;
      continue;
    }
    if (arg === "--install-dir") {
      parsed.installDir = resolve(process.cwd(), String(next).trim());
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function runSystemctl(args) {
  return execFileSync("systemctl", ["--user", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const sourceFiles = ["monsoonfire-overnight.service", "monsoonfire-overnight.timer"];
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = resolve(options.installDir, "backups", `monsoonfire-automation-${stamp}`);
  const installed = [];

  mkdirSync(options.installDir, { recursive: true });
  mkdirSync(backupDir, { recursive: true });

  for (const fileName of sourceFiles) {
    const sourcePath = resolve(options.sourceDir, fileName);
    const targetPath = resolve(options.installDir, fileName);
    if (!existsSync(sourcePath)) {
      throw new Error(`Missing source unit: ${sourcePath}`);
    }
    if (existsSync(targetPath)) {
      copyFileSync(targetPath, resolve(backupDir, fileName));
    }
    copyFileSync(sourcePath, targetPath);
    installed.push(targetPath);
  }

  runSystemctl(["daemon-reload"]);
  runSystemctl(["reset-failed", "monsoonfire-overnight.service"]);
  runSystemctl(["disable", "--now", "monsoonfire-overnight.service"]);
  if (options.disableTimer) {
    runSystemctl(["disable", "--now", "monsoonfire-overnight.timer"]);
  } else {
    runSystemctl(["enable", "--now", "monsoonfire-overnight.timer"]);
  }

  const payload = {
    schema: "monsoonfire-automation-systemd-install.v1",
    generatedAt: new Date().toISOString(),
    sourceDir: options.sourceDir,
    installDir: options.installDir,
    backupDir,
    installed,
    timerEnabled: !options.disableTimer,
  };

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(`installed ${installed.length} systemd units\n`);
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `install-monsoonfire-automation-systemd failed: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
}
