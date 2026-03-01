#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  preflight: true,
  autoRollback: true,
  rollbackVerify: true,
  evidencePack: true,
  verifyArgs: [],
  preflightReport: resolve(repoRoot, "output", "qa", "deploy-preflight.json"),
  cutoverVerifyReport: resolve(repoRoot, "output", "qa", "post-deploy-cutover-verify.json"),
  promotionReport: resolve(repoRoot, "output", "qa", "post-deploy-promotion-gate.json"),
  rollbackReport: resolve(repoRoot, "output", "qa", "post-deploy-rollback.json"),
  rollbackVerifyReport: resolve(repoRoot, "output", "qa", "post-deploy-rollback-verify.json"),
  evidenceJson: resolve(repoRoot, "artifacts", "deploy-evidence-latest.json"),
  evidenceMd: resolve(repoRoot, "artifacts", "deploy-evidence-latest.md"),
};

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}

const FIREBASE_EMBEDDED_KEY_REGEX = /VITE_FIREBASE_API_KEY["']?\s*:\s*["']AIza[0-9A-Za-z_-]{20,}["']/;

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

const stageRoot = mkdtempSync(join(tmpdir(), "mf-namecheap-portal-"));
const stageDir = resolve(stageRoot, "staging");
const rollbackBackupDir = resolve(stageRoot, "rollback-backup");

let deploymentError = null;
let promotionGateFailure = null;
let rollbackSummary = {
  status: "not_needed",
  triggeredBy: "",
  rollbackApplied: false,
  rollbackExitCode: 0,
  rollbackVerify: {
    attempted: false,
    exitCode: 0,
  },
  details: "",
};

try {
  if (options.preflight) {
    const preflightArgs = [
      resolve(repoRoot, "scripts", "deploy-preflight.mjs"),
      "--target",
      "namecheap-portal",
      "--json",
      "--report",
      options.preflightReport,
    ];
    if (!options.promotionGate) {
      preflightArgs.push("--skip-promotion-gate");
    }

    run("node", preflightArgs, {
      label: "Running deploy preflight",
    });
  }

  if (!options.noBuild) {
    run("npm", ["--prefix", "web", "run", "build"], {
      label: "Building web/dist",
    });
  }

  if (!existsSync(webDist)) {
    fail(`Missing build output: ${webDist}`);
  }
  assertFirebaseApiKeyIsEmbedded(webDist);

  cpSync(webDist, stageDir, { recursive: true });
  cpSync(htaccessTemplate, resolve(stageDir, ".htaccess"));
  // Use website/.well-known as the single source and mirror both paths for host compatibility.
  cpSync(wellKnownSourceDir, resolve(stageDir, ".well-known"), { recursive: true });
  cpSync(wellKnownSourceDir, resolve(stageDir, "well-known"), { recursive: true });

  const sshTransport = `ssh -i ${keyPath} -p ${String(options.port)} -o StrictHostKeyChecking=accept-new`;
  const remotePathWithSlash = ensureTrailingSlash(options.remotePath);
  const remoteTarget = `${options.server}:${options.remotePath}`;

  run("ssh", [
    "-i",
    keyPath,
    "-p",
    String(options.port),
    "-o",
    "StrictHostKeyChecking=accept-new",
    options.server,
    `mkdir -p ${shellQuote(options.remotePath)}`,
  ], {
    label: "Ensuring remote deploy path exists",
  });

  if (options.autoRollback && options.promotionGate) {
    mkdirSync(rollbackBackupDir, { recursive: true });
    run(
      "rsync",
      ["-az", "--delete", "-e", sshTransport, `${options.server}:${remotePathWithSlash}`, `${rollbackBackupDir}/`],
      {
        label: "Capturing pre-deploy rollback snapshot",
      }
    );
  }

  run(
    "rsync",
    ["-az", "--delete", "-e", sshTransport, `${stageDir}/`, remoteTarget],
    { label: `Syncing ${stageDir} -> ${remoteTarget}` }
  );

  if (options.verify) {
    const verifyScript = resolve(repoRoot, "web", "deploy", "namecheap", "verify-cutover.mjs");
    const verifyArgs = [
      "--portal-url",
      options.portalUrl,
      "--report-path",
      options.cutoverVerifyReport,
      ...options.verifyArgs,
    ];
    run("node", [verifyScript, ...verifyArgs], {
      label: "Running cutover verification",
    });
  }

  if (options.promotionGate) {
    const promotionResult = run(
      "node",
      [
        resolve(repoRoot, "scripts", "post-deploy-promotion-gate.mjs"),
        "--base-url",
        options.portalUrl,
        "--report",
        options.promotionReport,
        "--json",
      ],
      {
        label: "Running post-deploy promotion gate",
        allowFailure: true,
      }
    );

    if (!promotionResult.ok) {
      promotionGateFailure = {
        exitCode: promotionResult.status,
      };
      rollbackSummary = {
        status: "required",
        triggeredBy: "promotion-gate-failure",
        rollbackApplied: false,
        rollbackExitCode: 0,
        rollbackVerify: {
          attempted: false,
          exitCode: 0,
        },
        details: "Promotion gate failed after deploy.",
      };

      if (options.autoRollback) {
        const rollbackResult = run(
          "rsync",
          ["-az", "--delete", "-e", sshTransport, `${rollbackBackupDir}/`, remoteTarget],
          {
            label: "Auto-rollback: restoring pre-deploy snapshot",
            allowFailure: true,
          }
        );

        rollbackSummary.rollbackApplied = rollbackResult.ok;
        rollbackSummary.rollbackExitCode = rollbackResult.status;
        rollbackSummary.status = rollbackResult.ok ? "rolled_back" : "rollback_failed";
        rollbackSummary.details = rollbackResult.ok
          ? "Rollback applied because promotion gate failed."
          : "Rollback attempted but failed.";

        if (rollbackResult.ok && options.rollbackVerify) {
          rollbackSummary.rollbackVerify.attempted = true;
          const rollbackVerifyScript = resolve(repoRoot, "web", "deploy", "namecheap", "verify-cutover.mjs");
          const rollbackVerifyResult = run(
            "node",
            [
              rollbackVerifyScript,
              "--portal-url",
              options.portalUrl,
              "--report-path",
              options.rollbackVerifyReport,
            ],
            {
              label: "Auto-rollback: running post-rollback verification",
              allowFailure: true,
            }
          );

          rollbackSummary.rollbackVerify.exitCode = rollbackVerifyResult.status;
          if (!rollbackVerifyResult.ok) {
            rollbackSummary.status = "rollback_failed";
            rollbackSummary.details = "Rollback restored files but post-rollback verification failed.";
          }
        }
      } else {
        rollbackSummary.status = "skipped";
        rollbackSummary.details = "Promotion gate failed and auto-rollback is disabled.";
      }

      writeJson(options.rollbackReport, {
        timestampIso: new Date().toISOString(),
        portalUrl: options.portalUrl,
        server: options.server,
        remotePath: options.remotePath,
        promotionGate: promotionGateFailure,
        rollback: rollbackSummary,
      });

      throw new Error(
        rollbackSummary.status === "rolled_back"
          ? "Post-deploy promotion gate failed; auto-rollback has been applied."
          : "Post-deploy promotion gate failed; rollback could not be safely completed."
      );
    }
  }
} catch (error) {
  deploymentError = error instanceof Error ? error : new Error(String(error));
} finally {
  if (options.evidencePack) {
    const evidenceArgs = [
      resolve(repoRoot, "scripts", "deploy-evidence-pack.mjs"),
      "--target",
      "namecheap-portal",
      "--base-url",
      options.portalUrl,
      "--output-json",
      options.evidenceJson,
      "--output-md",
      options.evidenceMd,
      "--json",
    ];
    if (!options.promotionGate) {
      evidenceArgs.push("--skip-promotion-gate");
    }
    if (!options.verify) {
      evidenceArgs.push("--skip-cutover-verify");
    }

    run("node", evidenceArgs, {
      label: "Generating deploy evidence pack",
      allowFailure: true,
    });
  }

  rmSync(stageRoot, { recursive: true, force: true });
}

if (deploymentError) {
  fail(deploymentError.message);
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
    if (arg === "--preflight") {
      parsed.preflight = true;
      continue;
    }
    if (arg === "--skip-preflight") {
      parsed.preflight = false;
      continue;
    }
    if (arg === "--auto-rollback") {
      parsed.autoRollback = true;
      continue;
    }
    if (arg === "--skip-auto-rollback") {
      parsed.autoRollback = false;
      continue;
    }
    if (arg === "--rollback-verify") {
      parsed.rollbackVerify = true;
      continue;
    }
    if (arg === "--skip-rollback-verify") {
      parsed.rollbackVerify = false;
      continue;
    }
    if (arg === "--evidence-pack") {
      parsed.evidencePack = true;
      continue;
    }
    if (arg === "--skip-evidence-pack") {
      parsed.evidencePack = false;
      continue;
    }
    if (arg === "--preflight-report") {
      parsed.preflightReport = resolve(process.cwd(), readValue(argv, i, arg));
      i += 1;
      continue;
    }
    if (arg === "--cutover-verify-report") {
      parsed.cutoverVerifyReport = resolve(process.cwd(), readValue(argv, i, arg));
      i += 1;
      continue;
    }
    if (arg === "--promotion-report") {
      parsed.promotionReport = resolve(process.cwd(), readValue(argv, i, arg));
      i += 1;
      continue;
    }
    if (arg === "--rollback-report") {
      parsed.rollbackReport = resolve(process.cwd(), readValue(argv, i, arg));
      i += 1;
      continue;
    }
    if (arg === "--rollback-verify-report") {
      parsed.rollbackVerifyReport = resolve(process.cwd(), readValue(argv, i, arg));
      i += 1;
      continue;
    }
    if (arg === "--evidence-json") {
      parsed.evidenceJson = resolve(process.cwd(), readValue(argv, i, arg));
      i += 1;
      continue;
    }
    if (arg === "--evidence-md") {
      parsed.evidenceMd = resolve(process.cwd(), readValue(argv, i, arg));
      i += 1;
      continue;
    }

    parsed.verifyArgs.push(arg);
  }
  return parsed;
}

function ensureTrailingSlash(value) {
  const raw = String(value || "");
  return raw.endsWith("/") ? raw : `${raw}/`;
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

function shellQuote(raw) {
  return `'${String(raw).replace(/'/g, "'\"'\"'")}'`;
}

function run(command, args, options = {}) {
  if (options.label) {
    process.stdout.write(`${options.label}...\n`);
  }
  const result = spawnSync(command, args, { stdio: "inherit", shell: false });

  if (result.error) {
    if (options.allowFailure) {
      return {
        ok: false,
        status: 1,
      };
    }
    throw new Error(`${command} failed: ${result.error.message}`);
  }

  const status = typeof result.status === "number" ? result.status : 1;
  if (status !== 0 && !options.allowFailure) {
    throw new Error(`${command} exited with status ${status}`);
  }

  return {
    ok: status === 0,
    status,
  };
}

function collectFiles(rootDir, includeFile) {
  const files = [];
  const queue = [rootDir];

  while (queue.length > 0) {
    const current = queue.pop();
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = resolve(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(entryPath);
        continue;
      }
      if (includeFile(entryPath)) {
        files.push(entryPath);
      }
    }
  }

  return files;
}

function assertFirebaseApiKeyIsEmbedded(distDir) {
  const buildFiles = collectFiles(distDir, (filePath) => filePath.endsWith(".js"));
  const matchingFiles = [];

  for (const filePath of buildFiles) {
    const text = readFileSync(filePath, "utf8");
    if (FIREBASE_EMBEDDED_KEY_REGEX.test(text)) {
      matchingFiles.push(filePath);
    }
  }

  if (matchingFiles.length > 0) {
    return;
  }

  fail(
    "Build output does not include a compiled VITE_FIREBASE_API_KEY value; refusing deploy.\n" +
      "Set VITE_FIREBASE_API_KEY (or ensure web build injects it) before deploy."
  );
}

function writeJson(path, payload) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
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
      "  --preflight                run deploy preflight checks (default)\n" +
      "  --skip-preflight           skip deploy preflight checks\n" +
      "  --auto-rollback            restore pre-deploy snapshot if promotion gate fails (default)\n" +
      "  --skip-auto-rollback       disable automatic rollback on promotion-gate failure\n" +
      "  --rollback-verify          verify after rollback (default)\n" +
      "  --skip-rollback-verify     skip rollback verification\n" +
      "  --evidence-pack            generate deploy evidence pack (default)\n" +
      "  --skip-evidence-pack       skip deploy evidence pack generation\n" +
      "  --help                     show this help\n" +
      "\n" +
      "Any unknown args are forwarded to verify-cutover when --verify is enabled.\n"
  );
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
