#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const repoRoot = resolve(__dirname, "..");
const env = process.env;
const defaults = {
  server: env.WEBSITE_DEPLOY_SERVER || "",
  port: Number.parseInt(env.WEBSITE_DEPLOY_PORT || "", 10) || 21098,
  remotePath: env.WEBSITE_DEPLOY_REMOTE_PATH || "public_html/",
  source: resolve(repoRoot, "ncsitebuilder"),
};
if (!env.WEBSITE_DEPLOY_SERVER) {
  process.stdout.write(
    "Tip: set WEBSITE_DEPLOY_SERVER (for example user@studiobrain.local) before deploy.\n",
  );
}

const args = parseArgs(process.argv.slice(2));
const source = resolve(args.source);

if (!existsSync(source)) {
  process.stderr.write(`Missing source directory: ${source}\n`);
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

process.stdout.write(`Deploying ${source} to ${args.server}:${args.remotePath} (port ${args.port})...\n`);
runCommand("scp", [
  "-P",
  String(args.port),
  "-r",
  source,
  `${args.server}:${args.remotePath}`,
]);

process.stdout.write(`Promoting ncsitebuilder into ${args.remotePath}...\n`);
runCommand("ssh", [
  "-p",
  String(args.port),
  args.server,
  `cd ${args.remotePath} && cp -a ncsitebuilder/. .`,
]);

process.stdout.write("Done.\n");

function parseArgs(argv) {
  const parsed = {
    server: defaults.server,
    port: defaults.port,
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
        "Usage: node website/scripts/deploy.mjs [--server user@host] [--port 21098] [--remote-path public_html/] [--source <path>]\n" +
          "Server defaults: --server from WEBSITE_DEPLOY_SERVER.\n" +
          "Port defaults: --port from WEBSITE_DEPLOY_PORT.\n" +
          "Remote path defaults: --remote-path from WEBSITE_DEPLOY_REMOTE_PATH.\n"
      );
      process.exit(0);
    }
  }

  return parsed;
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
