#!/usr/bin/env node
import fs from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveStudioBrainNetworkProfile } from "../../scripts/studio-network-profile.mjs";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..");
const defaultRoot = repoRoot;
const defaultHost = resolveStudioBrainNetworkProfile().host || "127.0.0.1";
const defaultPort = 8000;
const defaultCookieDays = 30;
const defaultVariantRoot = "ab";

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

const args = parseArgs(process.argv.slice(2));
const host = args.host;
const port = args.port;
const root = resolve(args.root);
const variantRoot = args.variantRoot;
const cookieDays = args.cookieDays;

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  process.stderr.write(`Invalid --port value: ${args.portRaw}\n`);
  process.exit(1);
}
if (!Number.isInteger(cookieDays) || cookieDays < 1 || cookieDays > 365) {
  process.stderr.write(`Invalid --cookie-days value: ${args.cookieDaysRaw}\n`);
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
    const url = new URL(req.url, `http://${host}:${port}`);
    const safePath = getSafePath(url.pathname || "/");
    const selectedVariant = pickVariant(req.headers.cookie || "", url.searchParams);
    const requestedFile = resolveRequestedFile(root, safePath);
    const variantFile = resolveVariantFile(root, variantRoot, safePath, selectedVariant.variant);
    const filePath = variantFile || requestedFile;

    await sendResponse(req, res, filePath, selectedVariant.variant, selectedVariant.shouldSetCookie);
  } catch (error) {
    if (error?.message === "FORBIDDEN") {
      res.statusCode = 403;
      res.end("Forbidden");
      return;
    }
    if (error?.message === "BAD_REQUEST") {
      res.statusCode = 400;
      res.end("Bad request");
      return;
    }
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
  process.stdout.write(`Serving ${root} with A/B variants at http://${host}:${port}/ (Ctrl+C to stop)\n`);
  if (variantRoot) {
    process.stdout.write(`Variant root: ${variantRoot}\n`);
  }
});

process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});

function getSafePath(rawPathname) {
  let pathname;
  try {
    pathname = decodeURIComponent(rawPathname);
  } catch {
    throw new Error("BAD_REQUEST");
  }
  const routePath = pathname.endsWith("/") ? `${pathname}index.html` : pathname;
  const safePath = routePath.replace(/^\/+/, "");
  const absolutePath = resolve(root, safePath);
  const requestedRelative = relative(root, absolutePath);
  if (requestedRelative.startsWith("..") || isAbsolute(requestedRelative)) {
    throw new Error("FORBIDDEN");
  }
  return safePath;
}

function resolveRequestedFile(siteRoot, safePath) {
  const requested = resolve(siteRoot, safePath);
  const requestedRelative = relative(siteRoot, requested);
  if (requestedRelative.startsWith("..") || isAbsolute(requestedRelative)) {
    throw new Error("FORBIDDEN");
  }

  try {
    const stat = statSync(requested);
    return stat.isDirectory() ? `${requested}/index.html` : requested;
  } catch {
    const candidateIndex = `${requested}/index.html`;
    if (existsSync(candidateIndex)) {
      return candidateIndex;
    }
    return requested;
  }
}

function resolveVariantFile(siteRoot, variantRootName, safePath, variant = null) {
  if (!variant || !variantRootName) {
    return null;
  }
  const variantFolder = resolve(siteRoot, variantRootName, variant);
  const candidatePath = resolve(variantFolder, safePath);
  const candidateRelative = relative(variantFolder, candidatePath);

  if (candidateRelative.startsWith("..") || isAbsolute(candidateRelative)) {
    return null;
  }
  if (!existsSync(candidatePath)) {
    return null;
  }

  try {
    const stat = statSync(candidatePath);
    const variantCandidate = stat.isDirectory() ? `${candidatePath}/index.html` : candidatePath;
    if (existsSync(variantCandidate)) {
      return variantCandidate;
    }
  } catch {
    return null;
  }
  return null;
}

function pickVariant(rawCookieHeader, searchParams) {
  const queryVariant = (() => {
    const raw = searchParams.get("ab") || searchParams.get("variant");
    const value = typeof raw === "string" ? raw.toLowerCase() : "";
    if (value === "a" || value === "b") {
      return value;
    }
    return null;
  })();
  if (queryVariant) {
    return {
      variant: queryVariant,
      shouldSetCookie: true,
    };
  }

  const cookieValue = getCookieValue(rawCookieHeader, "ab_variant");
  if (cookieValue === "a" || cookieValue === "b") {
    return { variant: cookieValue, shouldSetCookie: false };
  }

  return {
    variant: Math.random() < 0.5 ? "a" : "b",
    shouldSetCookie: true,
  };
}

function getCookieValue(rawCookieHeader, name) {
  const cookies = rawCookieHeader.split(";").map((entry) => entry.trim());
  for (const cookie of cookies) {
    const idx = cookie.indexOf("=");
    if (idx <= 0) {
      continue;
    }
    const key = cookie.slice(0, idx).trim();
    const value = cookie.slice(idx + 1).trim();
    if (key === name) {
      return value;
    }
  }
  return null;
}

async function sendResponse(req, res, filePath, variant, shouldSetCookie) {
  let resolved = filePath;
  try {
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      resolved = `${filePath}/index.html`;
    }
  } catch {
    throw new Error("ENOENT");
  }

  const resolvedRelative = relative(root, resolved);
  if (resolvedRelative.startsWith("..") || isAbsolute(resolvedRelative)) {
    throw new Error("FORBIDDEN");
  }

  const fileContent = await fs.readFile(resolved);
  const ext = extname(resolved).toLowerCase();
  res.setHeader("X-AB-Variant", variant);
  res.statusCode = 200;
  res.setHeader("Content-Type", MIME_TYPES[ext] || "application/octet-stream");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  if (shouldSetCookie) {
    const maxAge = cookieDays * 86400;
    res.setHeader("Set-Cookie", `ab_variant=${variant}; Path=/; Max-Age=${maxAge}; SameSite=Lax`);
  }
  if (req.method !== "HEAD") {
    res.end(fileContent);
    return;
  }
  res.end();
}

function parseArgs(argv) {
  const parsed = {
    host: defaultHost,
    port: defaultPort,
    portRaw: String(defaultPort),
    root: defaultRoot,
    variantRoot: defaultVariantRoot,
    cookieDays: defaultCookieDays,
    cookieDaysRaw: String(defaultCookieDays),
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--port") {
      parsed.portRaw = argv[i + 1];
      parsed.port = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (argv[i] === "--host") {
      parsed.host = argv[i + 1] || parsed.host;
      i += 1;
      continue;
    }
    if (argv[i] === "--root") {
      const next = argv[i + 1];
      parsed.root = next ? resolve(process.cwd(), next) : parsed.root;
      i += 1;
      continue;
    }
    if (argv[i] === "--variant-root") {
      parsed.variantRoot = argv[i + 1] || "";
      i += 1;
      continue;
    }
    if (argv[i] === "--cookie-days") {
      parsed.cookieDaysRaw = argv[i + 1];
      parsed.cookieDays = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (argv[i] === "--help" || argv[i] === "-h") {
      process.stdout.write(
        "Usage: node website/scripts/serve-ab.mjs --root <path> [--host 127.0.0.1] [--port 8000] [--variant-root ab] [--cookie-days 30]\n"
      );
      process.exit(0);
    }
  }

  return parsed;
}
