#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as exegesis from "exegesis";

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), "..");
const REQUIRED_OPENAPI_PATHS = [
  "/v1/reservations.create",
  "/v1/reservations.get",
  "/v1/reservations.list",
  "/v1/reservations.lookupArrival",
  "/v1/reservations.checkIn",
  "/v1/reservations.rotateArrivalToken",
  "/v1/reservations.pickupWindow",
  "/v1/memberships.summary",
  "/v1/memberships.changePlan",
];

const args = parseArgs(process.argv.slice(2));
const artifactPath = resolve(ROOT, args.artifact);
const tempRoot = mkdtempSync(resolve(tmpdir(), "mf-verify-well-known-"));

const report = {
  timestamp: new Date().toISOString(),
  status: "pass",
  strict: args.strict,
  build: {
    attempted: !args.noBuild,
    ok: false,
    command: "npm --prefix web run build",
  },
  servers: {},
  checks: [],
  openApi: {
    file: resolve(ROOT, "web/dist/.well-known/openapi.json"),
    ok: false,
    message: "",
  },
};

let portalServer = null;
let websiteServer = null;
let websiteNcServer = null;

try {
  if (!args.noBuild) {
    runBuild();
  } else {
    report.build.ok = true;
  }

  const portalRoot = resolve(ROOT, "web/dist");
  const websiteRoot = resolve(ROOT, "website");
  const websiteNcRoot = resolve(ROOT, "website/ncsitebuilder");

  portalServer = await startStaticServer(portalRoot);
  websiteServer = await startStaticServer(websiteRoot);
  websiteNcServer = await startStaticServer(websiteNcRoot);

  report.servers = {
    portal: { root: portalRoot, url: portalServer.baseUrl },
    website: { root: websiteRoot, url: websiteServer.baseUrl },
    websiteNcsitebuilder: { root: websiteNcRoot, url: websiteNcServer.baseUrl },
  };

  const endpoints = [
    { id: "portal-root", baseUrl: portalServer.baseUrl, path: "/", type: "text/html", includes: "<html" },
    { id: "portal-robots", baseUrl: portalServer.baseUrl, path: "/robots.txt", type: "text/plain", includes: "Sitemap:" },
    { id: "portal-sitemap", baseUrl: portalServer.baseUrl, path: "/sitemap.xml", type: "application/xml", includes: "portal.monsoonfire.com/reserve" },
    { id: "portal-llms", baseUrl: portalServer.baseUrl, path: "/llms.txt", type: "text/plain", includes: "portal.monsoonfire.com/.well-known/openapi.json" },
    { id: "portal-ai", baseUrl: portalServer.baseUrl, path: "/ai.txt", type: "text/plain", includes: "portal.monsoonfire.com/apis.json" },
    { id: "portal-agent-docs", baseUrl: portalServer.baseUrl, path: "/agent-docs/", type: "text/html", includes: "/.well-known/openapi.json" },
    { id: "portal-reserve", baseUrl: portalServer.baseUrl, path: "/reserve", type: "text/html", includes: "ReserveAction" },
    { id: "portal-membership", baseUrl: portalServer.baseUrl, path: "/membership", type: "text/html", includes: "JoinAction" },
    { id: "portal-openapi", baseUrl: portalServer.baseUrl, path: "/.well-known/openapi.json", type: "application/json", includes: "\"openapi\": \"3.1.0\"" },
    { id: "portal-apis-json", baseUrl: portalServer.baseUrl, path: "/apis.json", type: "application/json", includes: ".well-known/openapi.json" },
    { id: "portal-contract-index", baseUrl: portalServer.baseUrl, path: "/contracts/portal-contracts.json", type: "application/json", includes: "\"publicOperations\"" },
    { id: "website-robots", baseUrl: websiteServer.baseUrl, path: "/robots.txt", type: "text/plain", includes: "Sitemap:" },
    { id: "website-sitemap", baseUrl: websiteServer.baseUrl, path: "/sitemap.xml", type: "application/xml", includes: "https://monsoonfire.com/agent-docs/" },
    { id: "website-llms", baseUrl: websiteServer.baseUrl, path: "/llms.txt", type: "text/plain", includes: "https://portal.monsoonfire.com/reserve" },
    { id: "website-ai", baseUrl: websiteServer.baseUrl, path: "/ai.txt", type: "text/plain", includes: "https://portal.monsoonfire.com/.well-known/openapi.json" },
    { id: "website-agent-docs", baseUrl: websiteServer.baseUrl, path: "/agent-docs/", type: "text/html", includes: "portal.monsoonfire.com" },
    { id: "website-aasa", baseUrl: websiteServer.baseUrl, path: "/.well-known/apple-app-site-association", type: "application/json", includes: "\"appID\"" },
    { id: "website-assetlinks", baseUrl: websiteServer.baseUrl, path: "/.well-known/assetlinks.json", type: "application/json", includes: "\"package_name\"" },
    { id: "website-nc-robots", baseUrl: websiteNcServer.baseUrl, path: "/robots.txt", type: "text/plain", includes: "Sitemap:" },
    { id: "website-nc-sitemap", baseUrl: websiteNcServer.baseUrl, path: "/sitemap.xml", type: "application/xml", includes: "https://monsoonfire.com/agent-docs/" },
    { id: "website-nc-llms", baseUrl: websiteNcServer.baseUrl, path: "/llms.txt", type: "text/plain", includes: "https://portal.monsoonfire.com/reserve" },
    { id: "website-nc-ai", baseUrl: websiteNcServer.baseUrl, path: "/ai.txt", type: "text/plain", includes: "https://portal.monsoonfire.com/.well-known/openapi.json" },
    { id: "website-nc-agent-docs", baseUrl: websiteNcServer.baseUrl, path: "/agent-docs/", type: "text/html", includes: "portal.monsoonfire.com" },
    { id: "website-nc-aasa", baseUrl: websiteNcServer.baseUrl, path: "/.well-known/apple-app-site-association", type: "application/json", includes: "\"appID\"" },
    { id: "website-nc-assetlinks", baseUrl: websiteNcServer.baseUrl, path: "/.well-known/assetlinks.json", type: "application/json", includes: "\"package_name\"" },
  ];

  for (const endpoint of endpoints) {
    const result = await curlFetch(`${endpoint.baseUrl}${endpoint.path}`, endpoint.id);
    const contentType = String(result.contentType || "").toLowerCase();
    const expectedType = endpoint.type.toLowerCase();
    const contentTypeOk = contentType.startsWith(expectedType);
    const includesOk = endpoint.includes ? result.body.includes(endpoint.includes) : true;

    report.checks.push({
      id: endpoint.id,
      url: `${endpoint.baseUrl}${endpoint.path}`,
      ok: result.ok && contentTypeOk && includesOk,
      status: result.status,
      contentType: result.contentType,
      expectedType: endpoint.type,
      expectedIncludes: endpoint.includes || "",
      message: result.ok
        ? contentTypeOk
          ? includesOk
            ? "ok"
            : `Response missing expected marker: ${endpoint.includes}`
          : `Unexpected content-type: ${result.contentType || "<missing>"}`
        : result.error,
    });
  }

  await validateOpenApi(report.openApi.file);

  if (report.checks.some((check) => !check.ok) || !report.openApi.ok) {
    report.status = "fail";
  }
} catch (error) {
  report.status = "fail";
  report.checks.push({
    id: "verify-execution",
    url: "",
    ok: false,
    status: 0,
    contentType: "",
    expectedType: "",
    expectedIncludes: "",
    message: error instanceof Error ? error.message : String(error),
  });
} finally {
  await Promise.all([
    closeStaticServer(portalServer),
    closeStaticServer(websiteServer),
    closeStaticServer(websiteNcServer),
  ]);
  rmSync(tempRoot, { recursive: true, force: true });
}

mkdirSync(dirname(artifactPath), { recursive: true });
writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

if (args.json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  for (const check of report.checks) {
    const prefix = check.ok ? "[PASS]" : "[FAIL]";
    process.stdout.write(`${prefix} ${check.id} ${check.url}\n`);
    if (!check.ok) {
      process.stdout.write(`  ${check.message}\n`);
    }
  }
  process.stdout.write(`${report.openApi.ok ? "[PASS]" : "[FAIL]"} openapi-lint ${report.openApi.file}\n`);
  if (!report.openApi.ok && report.openApi.message) {
    process.stdout.write(`  ${report.openApi.message}\n`);
  }
  process.stdout.write(`verify:well-known ${report.status.toUpperCase()}\n`);
}

process.exit(report.status === "pass" ? 0 : 1);

function runBuild() {
  const result = spawnSync(resolveCommand("npm"), ["--prefix", "web", "run", "build"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  report.build.ok = result.status === 0;
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "web build failed");
  }
}

async function validateOpenApi(openApiPath) {
  if (!existsSync(openApiPath)) {
    report.openApi.ok = false;
    report.openApi.message = "Built OpenAPI artifact is missing.";
    return;
  }

  try {
    const payload = JSON.parse(readFileSync(openApiPath, "utf8"));
    const paths = payload.paths && typeof payload.paths === "object" ? Object.keys(payload.paths) : [];
    const missingPaths = REQUIRED_OPENAPI_PATHS.filter((entry) => !paths.includes(entry));
    if (payload.openapi !== "3.1.0") {
      throw new Error(`Unexpected OpenAPI version: ${String(payload.openapi || "<missing>")}`);
    }
    if (missingPaths.length > 0) {
      throw new Error(`Missing required public API paths: ${missingPaths.join(", ")}`);
    }
    await exegesis.compileRunner(payload, {
      authenticators: buildAuthenticatorStubs(payload),
    });
    report.openApi.ok = true;
    report.openApi.message = "OpenAPI document compiled successfully.";
    report.openApi.paths = paths.sort();
  } catch (error) {
    report.openApi.ok = false;
    report.openApi.message = error instanceof Error ? error.message : String(error);
  }
}

async function startStaticServer(root) {
  if (!existsSync(root)) {
    throw new Error(`Missing static root: ${root}`);
  }

  const server = createServer((req, res) => {
    const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
    const filePath = resolveStaticPath(root, requestUrl.pathname);

    if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
      res.statusCode = 404;
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.end("Not found");
      return;
    }

    res.statusCode = 200;
    res.setHeader("content-type", contentTypeFor(filePath));
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(filePath).pipe(res);
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error(`Unable to resolve server address for ${root}`);
  }

  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function closeStaticServer(handle) {
  if (!handle?.server) return;
  await new Promise((resolveClose) => {
    handle.server.close(() => resolveClose());
  });
}

function resolveStaticPath(root, pathname) {
  const decoded = decodeURIComponent(pathname || "/");
  const direct = resolve(root, `.${decoded}`);
  const normalizedRoot = `${root}${root.endsWith("/") ? "" : "/"}`;
  if (direct !== root && !direct.startsWith(normalizedRoot)) {
    return null;
  }

  if (decoded === "/") {
    return resolve(root, "index.html");
  }

  if (existsSync(direct) && statSync(direct).isFile()) {
    return direct;
  }

  if (existsSync(direct) && statSync(direct).isDirectory()) {
    const indexPath = resolve(direct, "index.html");
    return existsSync(indexPath) ? indexPath : null;
  }

  if (!extname(decoded)) {
    const indexPath = resolve(root, `.${decoded}`, "index.html");
    if (indexPath.startsWith(normalizedRoot) && existsSync(indexPath)) {
      return indexPath;
    }
  }

  return null;
}

function contentTypeFor(filePath) {
  if (basename(filePath) === "apple-app-site-association") {
    return "application/json; charset=utf-8";
  }

  switch (extname(filePath).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".xml":
      return "application/xml; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".ico":
      return "image/x-icon";
    default:
      return "application/octet-stream";
  }
}

async function curlFetch(url, id) {
  const headerPath = resolve(tempRoot, `${id}.headers.txt`);
  const bodyPath = resolve(tempRoot, `${id}.body.txt`);
  const result = await runAsyncCommand(resolveCommand("curl"), [
    "-fsS",
    "--max-time",
    "15",
    "-D",
    headerPath,
    "-o",
    bodyPath,
    url,
  ]);

  if (result.error) {
    return {
      ok: false,
      error: result.error.message,
      status: 0,
      contentType: "",
      body: "",
    };
  }

  if (result.status !== 0) {
    return {
      ok: false,
      error: result.stderr || result.stdout || `curl exited with ${result.status}`,
      status: 0,
      contentType: "",
      body: readIfExists(bodyPath),
    };
  }

  const headersRaw = readIfExists(headerPath);
  const body = readIfExists(bodyPath);
  const headerBlock = headersRaw.trim().split(/\r?\n\r?\n/).filter(Boolean).at(-1) || "";
  const headerLines = headerBlock.split(/\r?\n/);
  const statusMatch = /^HTTP\/\d+(?:\.\d+)?\s+(\d+)/i.exec(headerLines[0] || "");
  const status = statusMatch ? Number.parseInt(statusMatch[1], 10) : 0;
  const contentType = headerLines
    .find((line) => line.toLowerCase().startsWith("content-type:"))
    ?.split(":")
    .slice(1)
    .join(":")
    .trim() || "";

  return {
    ok: status === 200,
    error: "",
    status,
    contentType,
    body,
  };
}

function readIfExists(filePath) {
  return existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
}

function buildAuthenticatorStubs(payload) {
  const securitySchemes = payload?.components?.securitySchemes;
  if (!securitySchemes || typeof securitySchemes !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.keys(securitySchemes).map((schemeName) => [
      schemeName,
      async () => ({ type: "success", user: { sub: "verify-well-known" } }),
    ]),
  );
}

function parseArgs(argv) {
  const options = {
    artifact: "output/well-known/verify.json",
    json: false,
    noBuild: false,
    strict: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--strict") {
      options.strict = true;
      continue;
    }
    if (arg === "--no-build") {
      options.noBuild = true;
      continue;
    }
    if (arg === "--artifact") {
      options.artifact = argv[index + 1] || options.artifact;
      index += 1;
      continue;
    }
    if (arg.startsWith("--artifact=")) {
      options.artifact = arg.substring("--artifact=".length);
    }
  }

  return options;
}

function resolveCommand(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

function runAsyncCommand(command, args) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      resolvePromise({ status: 1, stdout, stderr, error });
    });
    child.on("close", (status) => {
      resolvePromise({ status: typeof status === "number" ? status : 1, stdout, stderr, error: null });
    });
  });
}
