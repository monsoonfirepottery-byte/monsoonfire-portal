#!/usr/bin/env node
import fs from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { resolveStudioBrainNetworkProfile } from "../../../scripts/studio-network-profile.mjs";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..");
const defaultHost = resolveStudioBrainNetworkProfile().host || "127.0.0.1";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const parsed = parseArgs(process.argv.slice(2));
const root = resolve(parsed.root);
const host = parsed.host;
const port = parsed.port;

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  process.stderr.write(`Invalid --port value: ${parsed.portRaw}\n`);
  process.exit(1);
}
if (!existsSync(root)) {
  process.stderr.write(`Root path does not exist: ${root}\n`);
  process.exit(1);
}
if (!statSync(root).isDirectory()) {
  process.stderr.write(`--root must be a directory: ${root}\n`);
  process.exit(1);
}

const server = createServer(async (req, res) => {
  if (!req.url) {
    res.statusCode = 400;
    res.end("Bad request");
    return;
  }

  try {
    const requested = decodeURIComponent(new URL(req.url, `http://${host}:${port}`).pathname || "/");
    let routePath = requested;
    if (routePath.endsWith("/")) {
      routePath += "index.html";
    }
    const safePath = routePath.replace(/^\/+/, "");
    const absolutePath = resolve(root, safePath);
    const requestedRelative = relative(root, absolutePath);
    if (requestedRelative.startsWith("..") || isAbsolute(requestedRelative)) {
      res.statusCode = 403;
      res.end("Forbidden");
      return;
    }

    const stat = statSync(absolutePath);
    let resolved = absolutePath;
    if (stat.isDirectory()) {
      resolved = `${absolutePath}/index.html`;
    }
    const resolvedRelative = relative(root, resolved);
    if (resolvedRelative.startsWith("..") || isAbsolute(resolvedRelative)) {
      throw new Error("Forbidden");
    }

    const content = await fs.readFile(resolved);
    const ext = extname(resolved).toLowerCase();
    res.statusCode = 200;
    res.setHeader("Content-Type", MIME_TYPES[ext] || "application/octet-stream");
    res.end(content);
  } catch (error) {
    if (error?.code === "ENOENT") {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }
    res.statusCode = 500;
    res.end("Server error");
  }
});

server.listen(port, host, () => {
  process.stdout.write(`Serving ${root} at http://${host}:${port}/ (Ctrl+C to stop)\n`);
});

process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});

function parseArgs(args) {
  const parsed = {
    host: defaultHost,
    port: 8000,
    portRaw: "8000",
    root: repoRoot,
  };

  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--port") {
      parsed.portRaw = args[i + 1];
      parsed.port = Number(args[i + 1]);
      i += 1;
      continue;
    }
    if (args[i] === "--host") {
      parsed.host = args[i + 1] || parsed.host;
      i += 1;
      continue;
    }
    if (args[i] === "--root") {
      parsed.root = resolve(process.cwd(), args[i + 1]);
      i += 1;
      continue;
    }
    if (args[i] === "--help") {
      process.stdout.write(
        "Usage: node website/ncsitebuilder/scripts/serve.mjs [--host 127.0.0.1] [--port 8000] [--root <path>]\n"
      );
      process.exit(0);
    }
  }

  return parsed;
}
