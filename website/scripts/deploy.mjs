#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { basename, dirname, resolve } from "node:path";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolveStudioBrainNetworkProfile } from "../../scripts/studio-network-profile.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const repoRoot = resolve(__dirname, "..");
const env = process.env;
const network = resolveStudioBrainNetworkProfile();
const derivedServer = env.WEBSITE_DEPLOY_SERVER
  || (env.WEBSITE_DEPLOY_USER ? `${env.WEBSITE_DEPLOY_USER}@${network.host}` : "");
const defaults = {
  server: derivedServer,
  port: Number.parseInt(env.WEBSITE_DEPLOY_PORT || "", 10) || 21098,
  key: env.WEBSITE_DEPLOY_KEY || env.WEBSITE_DEPLOY_IDENTITY || "",
  remotePath: env.WEBSITE_DEPLOY_REMOTE_PATH || "public_html/",
  source: resolve(repoRoot, "ncsitebuilder"),
};
if (!env.WEBSITE_DEPLOY_SERVER) {
  process.stdout.write(
    `Tip: set WEBSITE_DEPLOY_SERVER (or WEBSITE_DEPLOY_USER) for ${network.host} before deploy.\n`,
  );
}

const args = parseArgs(process.argv.slice(2));
const source = resolve(args.source);
const sourceName = basename(source);
const remotePath = args.remotePath.endsWith("/") ? args.remotePath : `${args.remotePath}/`;
const remoteSource = shellQuote(sourceName);
const remotePathArg = shellQuote(remotePath);
const keyPath = args.key ? expandHomePath(args.key) : "";

if (!existsSync(source)) {
  process.stderr.write(`Missing source directory: ${source}\n`);
  process.exit(1);
}
const sourceStat = statSync(source);
if (!sourceStat.isDirectory()) {
  process.stderr.write(`Deploy source must be a directory: ${source}\n`);
  process.exit(1);
}
if (!args.server || args.server === "null" || args.server.trim() === "") {
  process.stderr.write("Missing deploy server. Set --server or WEBSITE_DEPLOY_SERVER.\n");
  process.exit(1);
}
if (!Number.isInteger(args.port) || args.port < 1 || args.port > 65535) {
  process.stderr.write(`Invalid --port value: ${args.port}\n`);
  process.exit(1);
}
if (keyPath && !existsSync(keyPath)) {
  process.stderr.write(`SSH key not found: ${keyPath}\n`);
  process.exit(1);
}

process.stdout.write(`Deploying ${source} to ${args.server}:${args.remotePath} (port ${args.port})...\n`);
const scpArgs = [];
if (keyPath) {
  scpArgs.push("-i", keyPath);
}
scpArgs.push(
  "-P",
  String(args.port),
  "-r",
  source,
  `${args.server}:${args.remotePath}`,
);
runCommand("scp", [
  ...scpArgs,
]);

process.stdout.write(`Promoting ${sourceName} into ${args.remotePath}...\n`);
const sshArgs = [];
if (keyPath) {
  sshArgs.push("-i", keyPath);
}
sshArgs.push(
  "-p",
  String(args.port),
  args.server,
  `mkdir -p ${remotePathArg} && cd ${remotePathArg} && if [ -d ${remoteSource} ]; then cp -a ${remoteSource}/. . && rm -rf ${remoteSource}; fi`,
);
runCommand("ssh", [
  ...sshArgs,
]);

process.stdout.write("Done.\n");

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
    if (current === "--server") {
      parsed.server = argv[i + 1] || parsed.server;
      i += 1;
      continue;
    }
    if (current === "--port") {
      parsed.port = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (current === "--key" || current === "--identity") {
      parsed.key = argv[i + 1] || parsed.key;
      i += 1;
      continue;
    }
    if (current === "--remote-path") {
      parsed.remotePath = argv[i + 1] || parsed.remotePath;
      i += 1;
      continue;
    }
    if (current === "--source") {
      parsed.source = argv[i + 1] || parsed.source;
      i += 1;
      continue;
    }
    if (current === "--help") {
      process.stdout.write(
        "Usage: node website/scripts/deploy.mjs [--server user@host] [--port 21098] [--key ~/.ssh/namecheap-portal] [--remote-path public_html/] [--source <path>]\n" +
          "Server defaults: --server from WEBSITE_DEPLOY_SERVER.\n" +
          "Port defaults: --port from WEBSITE_DEPLOY_PORT.\n" +
          "SSH key defaults: --key from WEBSITE_DEPLOY_KEY or WEBSITE_DEPLOY_IDENTITY.\n" +
          "Remote path defaults: --remote-path from WEBSITE_DEPLOY_REMOTE_PATH.\n"
      );
      process.exit(0);
    }
  }

  return parsed;
}

function shellQuote(raw) {
  return `'${String(raw).replace(/'/g, "'\"'\"'")}'`;
}

function expandHomePath(input) {
  if (!input || input === "~") return homedir();
  if (input.startsWith("~/")) return resolve(homedir(), input.slice(2));
  return input;
}

function runCommand(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    stdio: "inherit",
    shell: false,
  });

  if (result.error) {
    process.stderr.write(`${command} error: ${result.error.message}\n`);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
