#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");

const defaults = {
  server: process.env.WEBSITE_DEPLOY_SERVER || "monsggbd@66.29.137.142",
  port: Number.parseInt(process.env.WEBSITE_DEPLOY_PORT || "", 10) || 21098,
  key: process.env.WEBSITE_DEPLOY_KEY || join(homedir(), ".ssh", "namecheap-portal"),
  remotePath: process.env.WEBSITE_DEPLOY_REMOTE_PATH || "public_html/",
  source: process.env.WEBSITE_DEPLOY_SOURCE || resolve(repoRoot, "website", "ncsitebuilder"),
};

const args = parseArgs(process.argv.slice(2));
const source = resolve(args.source || defaults.source);
const keyPath = expandHomePath(args.key || defaults.key);
const server = args.server || defaults.server;
const port = Number.isInteger(args.port) ? args.port : defaults.port;
const remotePath = args.remotePath || defaults.remotePath;

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

const delegate = spawnSync(
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
    source,
  ],
  {
    stdio: "inherit",
    shell: false,
  },
);

if (delegate.error) {
  fail(`Deploy failed: ${delegate.error.message}`);
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
    if (current === "--help") {
      process.stdout.write(
        "Usage: node ./scripts/deploy-namecheap-website.mjs [options]\n" +
          "  --server <user@host>      default: monsggbd@66.29.137.142\n" +
          "  --port <port>             default: 21098\n" +
          "  --key <private-key-path>  default: ~/.ssh/namecheap-portal\n" +
          "  --remote-path <path>      default: public_html/\n" +
          "  --source <path>           default: ./website/ncsitebuilder\n",
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

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
