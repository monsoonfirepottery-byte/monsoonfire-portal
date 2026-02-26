#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");

const defaults = {
  server: process.env.WEBSITE_DEPLOY_SERVER || "monsggbd@66.29.137.142",
  port: Number.parseInt(process.env.WEBSITE_DEPLOY_PORT || "", 10) || 21098,
  key: process.env.WEBSITE_DEPLOY_KEY || "~/.ssh/namecheap-portal",
  remotePath: process.env.WEBSITE_DEPLOY_REMOTE_PATH || "portal/",
  portalUrl: process.env.PORTAL_DEPLOY_URL || "https://portal.monsoonfire.com",
  noBuild: false,
  verify: false,
  promotionGate: true,
  verifyArgs: [],
};

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}

if (!options.server.trim()) {
  fail("Missing --server (or WEBSITE_DEPLOY_SERVER).");
}
if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
  fail(`Invalid --port value: ${options.port}`);
}

const keyPath = expandHome(options.key);
if (!existsSync(keyPath)) {
  fail(`SSH key not found: ${keyPath}`);
}

const webDist = resolve(repoRoot, "web", "dist");
const htaccessTemplate = resolve(repoRoot, "web", "deploy", "namecheap", ".htaccess");
const wellKnownSourceDir = resolve(repoRoot, "website", ".well-known");
const requiredWellKnownFiles = ["apple-app-site-association", "assetlinks.json"];
if (!existsSync(htaccessTemplate)) {
  fail(`Missing template: ${htaccessTemplate}`);
}
if (!existsSync(wellKnownSourceDir)) {
  fail(`Missing well-known source directory: ${wellKnownSourceDir}`);
}
for (const fileName of requiredWellKnownFiles) {
  const sourcePath = resolve(wellKnownSourceDir, fileName);
  if (!existsSync(sourcePath)) {
    fail(`Missing well-known source file: ${sourcePath}`);
  }
}

if (!options.noBuild) {
  run("npm", ["--prefix", "web", "run", "build"], {
    label: "Building web/dist",
  });
}
if (!existsSync(webDist)) {
  fail(`Missing build output: ${webDist}`);
}

const stageRoot = mkdtempSync(join(tmpdir(), "mf-namecheap-portal-"));
const stageDir = resolve(stageRoot, "staging");

try {
  cpSync(webDist, stageDir, { recursive: true });
  cpSync(htaccessTemplate, resolve(stageDir, ".htaccess"));
  // Use website/.well-known as the single source and mirror both paths for host compatibility.
  cpSync(wellKnownSourceDir, resolve(stageDir, ".well-known"), { recursive: true });
  cpSync(wellKnownSourceDir, resolve(stageDir, "well-known"), { recursive: true });

  const sshTransport = `ssh -i ${keyPath} -p ${String(options.port)} -o StrictHostKeyChecking=accept-new`;
  const remoteTarget = `${options.server}:${options.remotePath}`;

  run(
    "rsync",
    ["-az", "--delete", "-e", sshTransport, `${stageDir}/`, remoteTarget],
    { label: `Syncing ${stageDir} -> ${remoteTarget}` }
  );

  if (options.verify) {
    const verifyScript = resolve(repoRoot, "web", "deploy", "namecheap", "verify-cutover.mjs");
    const verifyArgs = ["--portal-url", options.portalUrl, ...options.verifyArgs];
    run("node", [verifyScript, ...verifyArgs], {
      label: "Running cutover verification",
    });
  }

  if (options.promotionGate) {
    run(
      "node",
      [
        resolve(repoRoot, "scripts", "post-deploy-promotion-gate.mjs"),
        "--base-url",
        options.portalUrl,
        "--report",
        resolve(repoRoot, "output", "qa", "namecheap-post-deploy-promotion-gate.json"),
        "--json",
      ],
      {
        label: "Running post-deploy promotion gate",
      }
    );
  }
} finally {
  rmSync(stageRoot, { recursive: true, force: true });
}

process.stdout.write("Namecheap portal deploy complete.\n");

function parseArgs(argv) {
  const parsed = { ...defaults };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "--server") {
      parsed.server = readValue(argv, i, arg);
      i += 1;
      continue;
    }
    if (arg === "--port") {
      parsed.port = Number.parseInt(readValue(argv, i, arg), 10);
      i += 1;
      continue;
    }
    if (arg === "--key") {
      parsed.key = readValue(argv, i, arg);
      i += 1;
      continue;
    }
    if (arg === "--remote-path") {
      parsed.remotePath = readValue(argv, i, arg);
      i += 1;
      continue;
    }
    if (arg === "--portal-url") {
      parsed.portalUrl = readValue(argv, i, arg);
      i += 1;
      continue;
    }
    if (arg === "--no-build") {
      parsed.noBuild = true;
      continue;
    }
    if (arg === "--verify") {
      parsed.verify = true;
      continue;
    }
    if (arg === "--skip-verify") {
      parsed.verify = false;
      continue;
    }
    if (arg === "--promotion-gate") {
      parsed.promotionGate = true;
      continue;
    }
    if (arg === "--skip-promotion-gate") {
      parsed.promotionGate = false;
      continue;
    }
    parsed.verifyArgs.push(arg);
  }
  return parsed;
}

function readValue(argv, idx, name) {
  const value = argv[idx + 1];
  if (!value || value.startsWith("--")) {
    fail(`${name} requires a value.`);
  }
  return value;
}

function expandHome(pathValue) {
  if (pathValue === "~") return process.env.HOME || pathValue;
  if (pathValue.startsWith("~/")) {
    return resolve(process.env.HOME || "", pathValue.slice(2));
  }
  return pathValue;
}

function run(command, args, options = {}) {
  if (options.label) {
    process.stdout.write(`${options.label}...\n`);
  }
  const result = spawnSync(command, args, { stdio: "inherit", shell: false });
  if (result.error) {
    fail(`${command} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function printHelp() {
  process.stdout.write(
    "Usage: node ./scripts/deploy-namecheap-portal.mjs [options]\n" +
      "\n" +
      "Options:\n" +
      "  --server <user@host>       default: monsggbd@66.29.137.142\n" +
      "  --port <ssh-port>          default: 21098\n" +
      "  --key <private-key-path>   default: ~/.ssh/namecheap-portal\n" +
      "  --remote-path <path>       default: portal/\n" +
      "  --portal-url <url>         default: https://portal.monsoonfire.com\n" +
      "  --no-build                 skip web build\n" +
      "  --verify                   run cutover verifier after sync\n" +
      "  --skip-verify              skip verifier (default unless --verify passed)\n" +
      "  --promotion-gate           run automated promotion gate after deploy (default)\n" +
      "  --skip-promotion-gate      skip promotion gate automation\n" +
      "  --help                     show this help\n" +
      "\n" +
      "Any unknown args are forwarded to verify-cutover when --verify is enabled.\n"
  );
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
