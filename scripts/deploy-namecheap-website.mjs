#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");
const canonicalPortalHandoffHost = "portal.monsoonfire.com";
const defaultWebsitePortalHandoffHost = "monsoonfire.kilnfire.com";
const textReplacementExtensions = new Set([
  ".config",
  ".css",
  ".html",
  ".htm",
  ".js",
  ".json",
  ".mjs",
  ".svg",
  ".txt",
  ".xml",
]);

const defaults = {
  server: process.env.WEBSITE_DEPLOY_SERVER || "monsggbd@66.29.137.142",
  port: Number.parseInt(process.env.WEBSITE_DEPLOY_PORT || "", 10) || 21098,
  key: process.env.WEBSITE_DEPLOY_KEY || join(homedir(), ".ssh", "namecheap-portal"),
  remotePath: process.env.WEBSITE_DEPLOY_REMOTE_PATH || "public_html/",
  source: process.env.WEBSITE_DEPLOY_SOURCE || resolve(repoRoot, "website", "ncsitebuilder"),
  portalHandoffHost: process.env.WEBSITE_PORTAL_HANDOFF_HOST || defaultWebsitePortalHandoffHost,
};

const args = parseArgs(process.argv.slice(2));
const source = resolve(args.source || defaults.source);
const keyPath = expandHomePath(args.key || defaults.key);
const server = args.server || defaults.server;
const port = Number.isInteger(args.port) ? args.port : defaults.port;
const remotePath = args.remotePath || defaults.remotePath;
const portalHandoffHost = normalizePortalHandoffHost(args.portalHandoffHost || defaults.portalHandoffHost);

if (!existsSync(source) || !statSync(source).isDirectory()) {
  fail(`Source directory does not exist: ${source}`);
}
if (!server || server.trim() === "") {
  fail("Missing deploy server. Pass --server or set WEBSITE_DEPLOY_SERVER.");
}
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  fail(`Invalid deploy port: ${String(port)}`);
}
if (!keyPath || !existsSync(keyPath)) {
  fail(`SSH key not found: ${keyPath}`);
}
if (!portalHandoffHost) {
  fail("Missing website portal handoff host. Pass --portal-handoff-host or set WEBSITE_PORTAL_HANDOFF_HOST.");
}

const stagedRoot = mkdtempSync(join(tmpdir(), "monsoonfire-website-deploy-"));
const stagedSource = join(stagedRoot, "site");
cpSync(source, stagedSource, { recursive: true });
rewritePortalHandoffHost(stagedSource, portalHandoffHost);

let delegate = null;
let delegateFailure = null;
try {
  delegate = spawnSync(
    "node",
    [
      resolve(repoRoot, "website", "scripts", "deploy.mjs"),
      "--server",
      server,
      "--port",
      String(port),
      "--key",
      keyPath,
      "--remote-path",
      remotePath,
      "--source",
      stagedSource,
    ],
    {
      stdio: "inherit",
      shell: false,
    },
  );

  if (delegate.error) {
    throw new Error(`Deploy failed: ${delegate.error.message}`);
  }
} catch (error) {
  delegateFailure = error instanceof Error ? error.message : String(error);
} finally {
  rmSync(stagedRoot, { recursive: true, force: true });
}

if (delegateFailure) {
  fail(delegateFailure);
}
if (!delegate) {
  fail("Deploy failed before the delegate process started.");
}
if (delegate.status !== 0) {
  process.exit(delegate.status ?? 1);
}

function parseArgs(argv) {
  const parsed = {
    server: defaults.server,
    port: defaults.port,
    key: defaults.key,
    remotePath: defaults.remotePath,
    source: defaults.source,
    portalHandoffHost: defaults.portalHandoffHost,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    const next = argv[i + 1];
    if (current === "--server") {
      parsed.server = next || parsed.server;
      i += 1;
      continue;
    }
    if (current === "--port") {
      parsed.port = Number.parseInt(next || "", 10);
      i += 1;
      continue;
    }
    if (current === "--key" || current === "--identity") {
      parsed.key = next || parsed.key;
      i += 1;
      continue;
    }
    if (current === "--remote-path") {
      parsed.remotePath = next || parsed.remotePath;
      i += 1;
      continue;
    }
    if (current === "--source") {
      parsed.source = next || parsed.source;
      i += 1;
      continue;
    }
    if (current === "--portal-handoff-host") {
      parsed.portalHandoffHost = next || parsed.portalHandoffHost;
      i += 1;
      continue;
    }
    if (current === "--help") {
      process.stdout.write(
        "Usage: node ./scripts/deploy-namecheap-website.mjs [options]\n" +
          "  --server <user@host>      default: monsggbd@66.29.137.142\n" +
          "  --port <port>             default: 21098\n" +
          "  --key <private-key-path>  default: ~/.ssh/namecheap-portal\n" +
          "  --remote-path <path>      default: public_html/\n" +
          "  --source <path>           default: ./website/ncsitebuilder\n" +
          `  --portal-handoff-host <host> default: ${defaultWebsitePortalHandoffHost}\n`,
      );
      process.exit(0);
    }
  }

  return parsed;
}

function expandHomePath(input) {
  if (!input || input === "~") return homedir();
  if (input.startsWith("~/")) return join(homedir(), input.slice(2));
  return input;
}

function normalizePortalHandoffHost(input) {
  return String(input || "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
}

function rewritePortalHandoffHost(directory, portalHandoffHost) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      rewritePortalHandoffHost(absolutePath, portalHandoffHost);
      continue;
    }

    if (!textReplacementExtensions.has(extname(entry.name).toLowerCase())) {
      continue;
    }

    const contents = readFileSync(absolutePath, "utf8");
    if (!contents.includes(canonicalPortalHandoffHost)) {
      continue;
    }

    const rewritten = contents.replaceAll(canonicalPortalHandoffHost, portalHandoffHost);
    if (rewritten !== contents) {
      writeFileSync(absolutePath, rewritten, "utf8");
    }
  }
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
