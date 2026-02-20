#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile, cp } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");

const defaults = {
  source: resolve(repoRoot, "website", "ncsitebuilder"),
  server: process.env.WEBSITE_DEPLOY_SERVER || "monsggbd@66.29.137.142",
  port: Number.parseInt(process.env.WEBSITE_DEPLOY_PORT || "", 10) || 21098,
  key: process.env.WEBSITE_DEPLOY_KEY || join(homedir(), ".ssh", "namecheap-portal"),
  remoteRoot: process.env.WEBSITE_DEPLOY_REMOTE_PATH || "public_html/",
  previewRoot: process.env.WEBSITE_PREVIEW_ROOT || "__preview",
  baseUrl: process.env.WEBSITE_PREVIEW_BASE_URL || "https://monsoonfire.com",
  previewId: process.env.WEBSITE_PREVIEW_ID || buildDefaultPreviewId(),
};

const args = parseArgs(process.argv.slice(2));
const previewId = sanitizePreviewId(args.previewId || defaults.previewId);
const remoteRoot = normalizeRemoteRoot(args.remoteRoot || defaults.remoteRoot);
const previewRoot = sanitizePreviewRoot(args.previewRoot || defaults.previewRoot);
const previewPrefix = `/${previewRoot}/${previewId}`;
const remotePath = `${remoteRoot}${previewRoot}/${previewId}/`;
const previewUrl = normalizeBaseUrl(args.baseUrl || defaults.baseUrl) + `${previewPrefix}/`;
const sourceDir = resolve(args.source || defaults.source);
const keyPath = expandHomePath(args.key || defaults.key);

if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
  fail(`Source directory does not exist: ${sourceDir}`);
}
if (!args.server && !defaults.server) {
  fail("Missing deploy server. Pass --server or set WEBSITE_DEPLOY_SERVER.");
}
if (!Number.isInteger(args.port || defaults.port) || (args.port || defaults.port) < 1 || (args.port || defaults.port) > 65535) {
  fail(`Invalid port: ${String(args.port || defaults.port)}`);
}
if (!existsSync(keyPath)) {
  fail(`SSH key not found: ${keyPath}`);
}

const server = args.server || defaults.server;
const port = args.port || defaults.port;
const remotePathQuoted = shellQuote(remotePath);

const stagingRoot = await mkdtemp(join(tmpdir(), "monsoonfire-preview-"));
const stagingSource = join(stagingRoot, "site");

try {
  await cp(sourceDir, stagingSource, { recursive: true, force: true });
  await rewriteForPreview(stagingSource, previewPrefix);

  run("ssh", [
    "-i",
    keyPath,
    "-p",
    String(port),
    server,
    `mkdir -p ${remotePathQuoted}`,
  ]);

  run("node", [
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
    stagingSource,
  ]);

  const statusCode = runCapture("curl", ["-sS", "-o", "/dev/null", "-w", "%{http_code}", previewUrl]).trim();
  if (!/^2|3/.test(statusCode)) {
    fail(`Preview URL returned HTTP ${statusCode}: ${previewUrl}`);
  }

  process.stdout.write(`PREVIEW_URL=${previewUrl}\n`);
  process.stdout.write(`HTTP_STATUS=${statusCode}\n`);
  process.stdout.write(`REMOTE_PATH=${remotePath}\n`);
} finally {
  await rm(stagingRoot, { recursive: true, force: true });
}

async function rewriteForPreview(rootDir, previewPrefixValue) {
  const files = await listFiles(rootDir);
  for (const filePath of files) {
    const extension = extname(filePath).toLowerCase();
    if (extension === ".html" || extension === ".shtml") {
      const original = await readFile(filePath, "utf8");
      const rewritten = rewriteHtml(original, previewPrefixValue);
      if (rewritten !== original) {
        await writeFile(filePath, rewritten, "utf8");
      }
      continue;
    }
    if (extension === ".css") {
      const original = await readFile(filePath, "utf8");
      const rewritten = rewriteCss(original, previewPrefixValue);
      if (rewritten !== original) {
        await writeFile(filePath, rewritten, "utf8");
      }
    }
  }
}

async function listFiles(dirPath) {
  const files = [];
  const entries = await readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(fullPath)));
      continue;
    }
    files.push(fullPath);
  }
  return files;
}

function rewriteHtml(content, previewPrefixValue) {
  const rewrittenRootAttrs = content
    .replace(
      /(href|src|action|data-nav-parent)=("|\')\/(?!\/|#)/g,
      (_match, attr, quote) => `${attr}=${quote}${previewPrefixValue}/`,
    )
    .replace(
      /url\((["']?)\/(?!\/)/g,
      (_match, quote) => `url(${quote}${previewPrefixValue}/`,
    );

  return rewrittenRootAttrs.replace(/(srcset|imagesrcset)=("([^"]*)"|'([^']*)')/g, (match, attr, quotedValue, doubleQuoted, singleQuoted) => {
    const value = doubleQuoted ?? singleQuoted ?? "";
    const rewrittenValue = value.replace(/(^|,\s*)\/(?!\/)/g, (_pathMatch, prefix) => `${prefix}${previewPrefixValue}/`);
    return `${attr}=${quotedValue[0]}${rewrittenValue}${quotedValue[0]}`;
  });
}

function rewriteCss(content, previewPrefixValue) {
  return content
    .replace(/url\((["']?)\/(?!\/)/g, (_match, quote) => `url(${quote}${previewPrefixValue}/`)
    .replace(/@import\s+(["'])\/(?!\/)/g, (_match, quote) => `@import ${quote}${previewPrefixValue}/`);
}

function parseArgs(argv) {
  const parsed = {
    source: defaults.source,
    server: defaults.server,
    port: defaults.port,
    key: defaults.key,
    remoteRoot: defaults.remoteRoot,
    previewRoot: defaults.previewRoot,
    previewId: defaults.previewId,
    baseUrl: defaults.baseUrl,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    const next = argv[i + 1];
    if (current === "--source") {
      parsed.source = next || parsed.source;
      i += 1;
      continue;
    }
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
    if (current === "--key") {
      parsed.key = next || parsed.key;
      i += 1;
      continue;
    }
    if (current === "--remote-root") {
      parsed.remoteRoot = next || parsed.remoteRoot;
      i += 1;
      continue;
    }
    if (current === "--preview-root") {
      parsed.previewRoot = next || parsed.previewRoot;
      i += 1;
      continue;
    }
    if (current === "--preview-id") {
      parsed.previewId = next || parsed.previewId;
      i += 1;
      continue;
    }
    if (current === "--base-url") {
      parsed.baseUrl = next || parsed.baseUrl;
      i += 1;
      continue;
    }
    if (current === "--help") {
      process.stdout.write(
        "Usage: node ./scripts/deploy-namecheap-preview.mjs [options]\n" +
          "  --server <user@host>       SSH target (default env/default)\n" +
          "  --port <port>              SSH port (default env/default)\n" +
          "  --key <path>               SSH key path (default ~/.ssh/namecheap-portal)\n" +
          "  --source <path>            Source website directory (default ./website/ncsitebuilder)\n" +
          "  --remote-root <path>       Remote base path (default public_html/)\n" +
          "  --preview-root <path>      Preview folder under remote root (default __preview)\n" +
          "  --preview-id <id>          Preview identifier (default timestamp)\n" +
          "  --base-url <url>           Public base URL (default https://monsoonfire.com)\n",
      );
      process.exit(0);
    }
  }

  return parsed;
}

function sanitizePreviewId(value) {
  const sanitized = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  if (!sanitized) {
    fail("Preview ID resolved to empty after sanitization.");
  }
  return sanitized;
}

function sanitizePreviewRoot(value) {
  const cleaned = String(value || "")
    .replace(/^\/+|\/+$/g, "")
    .replace(/[^a-zA-Z0-9._/-]+/g, "");
  if (!cleaned) {
    fail("Invalid preview root.");
  }
  return cleaned;
}

function normalizeRemoteRoot(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "public_html/";
  }
  return raw.endsWith("/") ? raw : `${raw}/`;
}

function normalizeBaseUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

function buildDefaultPreviewId() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const mm = String(now.getUTCMinutes()).padStart(2, "0");
  return `preview-${y}${m}${d}-${hh}${mm}`;
}

function expandHomePath(input) {
  if (!input || input === "~") return homedir();
  if (input.startsWith("~/")) return join(homedir(), input.slice(2));
  return input;
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: false });
  if (result.error) {
    fail(`${command} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function runCapture(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", shell: false });
  if (result.error) {
    fail(`${command} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`${command} exited with status ${result.status ?? 1}`);
  }
  return result.stdout || "";
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function shellQuote(raw) {
  return `'${String(raw).replace(/'/g, `'\"'\"'`)}'`;
}
