import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { printValidationReport, validateEnvContract } from "../studio-brain/scripts/env-contract-validator.mjs";
import { runIntegrityCheck } from "./integrity-check.mjs";
import { resolveStudioBrainNetworkProfile } from "./studio-network-profile.mjs";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(__filename, "..", "..");
const websiteRoot = resolve(repoRoot, "website");
const defaultOutputRoot = resolve(repoRoot, "output", "playwright");
const host = resolveStudioBrainNetworkProfile().host;
const preferredPort = 4173;
const localBaseUrl = `http://${host}:${preferredPort}`;
const CONTRACT_DEFAULT_ENV = {
  STUDIO_BRAIN_PORT: "8787",
  PGHOST: "127.0.0.1",
  PGPORT: "5433",
  PGDATABASE: "monsoonfire_studio_os",
  PGUSER: "postgres",
  PGPASSWORD: "studiobrain-ci-placeholder",
  REDIS_HOST: "127.0.0.1",
  REDIS_PORT: "6379",
  STUDIO_BRAIN_REDIS_STREAM_NAME: "studiobrain.events",
  STUDIO_BRAIN_ARTIFACT_STORE_ENDPOINT: "http://127.0.0.1:9010",
  STUDIO_BRAIN_ARTIFACT_STORE_BUCKET: "studiobrain-artifacts",
  STUDIO_BRAIN_ARTIFACT_STORE_ACCESS_KEY: "studiobrain-ci-access",
  STUDIO_BRAIN_ARTIFACT_STORE_SECRET_KEY: "studiobrain-ci-secret",
  STUDIO_BRAIN_SKILL_INSTALL_ROOT: "/tmp/studiobrain/skills",
};

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8"
};

const ensureDir = async (dirPath) => mkdir(dirPath, { recursive: true });

const normalizeBaseUrl = (value) => {
  if (!value) return null;
  const parsed = new URL(value);
  return parsed.toString().replace(/\/+$/, "");
};

const parseOptions = (argv) => {
  const options = {
    baseUrl: null,
    outputDir: defaultOutputRoot
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--base-url") {
      const nextValue = argv[i + 1];
      if (!nextValue || nextValue.startsWith("--")) {
        throw new Error("Missing value for --base-url");
      }
      options.baseUrl = normalizeBaseUrl(nextValue);
      i += 1;
      continue;
    }
    if (arg === "--output-dir") {
      const nextValue = argv[i + 1];
      if (!nextValue || nextValue.startsWith("--")) {
        throw new Error("Missing value for --output-dir");
      }
      options.outputDir = resolve(repoRoot, nextValue);
      i += 1;
      continue;
    }
  }

  return options;
};

function assertStudioBrainContract() {
  const report = validateEnvContract({ strict: false });
  if (!report.ok) {
    printValidationReport(report);
    throw new Error("Studio Brain env contract validation failed before website smoke.");
  }
  if (report.warnings.length > 0) {
    process.stdout.write("website smoke: studio-brain env warnings\n");
    report.warnings.forEach((warning) => process.stdout.write(`  - ${warning}\n`));
  }
}

function applyContractDefaults() {
  const injected = [];
  const profileHost = String(resolveStudioBrainNetworkProfile().host || "127.0.0.1");
  const configuredHost = String(process.env.STUDIO_BRAIN_HOST || "").trim();
  if (!configuredHost) {
    process.env.STUDIO_BRAIN_HOST = profileHost;
    injected.push("STUDIO_BRAIN_HOST");
  }

  for (const [key, value] of Object.entries(CONTRACT_DEFAULT_ENV)) {
    const current = process.env[key];
    if (typeof current === "string" && current.trim().length > 0) continue;
    process.env[key] = value;
    injected.push(key);
  }
  if (injected.length > 0) {
    process.stdout.write(`website smoke: injected contract defaults for ${injected.length} env keys\n`);
  }
}

function assertStudioBrainIntegrity() {
  const report = runIntegrityCheck({ manifest: "studio-brain/.env.integrity.json", strict: false, verbose: false });
  if (!report.ok) {
    process.stderr.write("website smoke: studio-brain integrity check failed before website smoke.\n");
    if (report.issues?.length) {
      report.issues.forEach((issue) => {
        const suffix = issue.expected ? ` [expected=${issue.expected}, actual=${issue.actual}]` : "";
        process.stderr.write(`  - ${issue.file}: ${issue.message}${suffix}\n`);
      });
    }
    throw new Error("Studio Brain integrity check failed before website smoke.");
  }

  if (report.warnings?.length > 0) {
    process.stdout.write("website smoke: studio-brain integrity warnings\n");
    report.warnings.forEach((warning) => process.stdout.write(`  - ${warning.file}: ${warning.message}\n`));
  }
}

const createStaticServer = () => {
  const server = createServer(async (req, res) => {
    if (!req.url) {
      res.statusCode = 400;
      res.end("Bad request");
      return;
    }

    try {
      const url = new URL(req.url, `http://${host}`);
      let routePath = decodeURIComponent(url.pathname);
      if (routePath.endsWith("/")) {
        routePath += "index.html";
      }
      const safeRoute = routePath.replace(/^\/+/, "");
      const absolutePath = resolve(websiteRoot, safeRoute);

      if (!absolutePath.startsWith(websiteRoot)) {
        res.statusCode = 403;
        res.end("Forbidden");
        return;
      }

      const body = await readFile(absolutePath);
      const ext = extname(absolutePath).toLowerCase();
      res.statusCode = 200;
      res.setHeader("Content-Type", contentTypes[ext] || "application/octet-stream");
      res.end(body);
    } catch {
      res.statusCode = 404;
      res.end("Not found");
    }
  });

  return server;
};

const startStaticServer = async () => {
  const portsToTry = [preferredPort, preferredPort + 1, preferredPort + 2, preferredPort + 10];

  for (const port of portsToTry) {
    const server = createStaticServer();
    try {
      await new Promise((resolveServer, rejectServer) => {
        server.once("error", rejectServer);
        server.listen(port, host, () => resolveServer());
      });
      return {
        server,
        baseUrl: `http://${host}:${port}`
      };
    } catch (error) {
      await new Promise((resolveClose) => server.close(() => resolveClose()));
      const code = error && typeof error === "object" ? error.code : null;
      if (code !== "EADDRINUSE") {
        throw error;
      }
    }
  }

  throw new Error(`Unable to start static server. Tried ports: ${portsToTry.join(", ")}`);
};

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const run = async () => {
  applyContractDefaults();
  assertStudioBrainContract();
  assertStudioBrainIntegrity();

  const options = parseOptions(process.argv.slice(2));
  const outputRoot = options.outputDir;
  let baseUrl = options.baseUrl || localBaseUrl;
  const summaryPath = resolve(outputRoot, "smoke-summary.json");
  const summary = {
    status: "running",
    startedAt: new Date().toISOString(),
    baseUrl,
    outputDir: outputRoot,
    checks: []
  };

  await ensureDir(outputRoot);
  let server = null;
  if (!options.baseUrl) {
    const localServer = await startStaticServer();
    server = localServer.server;
    baseUrl = localServer.baseUrl;
  }
  const browser = await chromium.launch({ headless: true });

  const desktopRoutes = [
    { route: "/", name: "smoke-home-desktop.png", assertSelector: ".button.button-primary" },
    { route: "/services/", name: "smoke-services-desktop.png", assertSelector: ".button.button-primary" },
    { route: "/kiln-firing/", name: "smoke-kiln-desktop.png", assertSelector: ".button.button-primary" },
    { route: "/memberships/", name: "smoke-memberships-desktop.png", assertSelector: ".button.button-primary" },
    { route: "/contact/", name: "smoke-contact-desktop.png", assertSelector: "form[data-contact-intake]" },
    { route: "/support/", name: "smoke-support-desktop.png", assertSelector: "[data-faq-search]" }
  ];

  const mobileRoutes = [
    { route: "/", name: "smoke-home-mobile.png", assertSelector: ".button.button-primary" },
    { route: "/services/", name: "smoke-services-mobile.png", assertSelector: ".button.button-primary" },
    { route: "/kiln-firing/", name: "smoke-kiln-mobile.png", assertSelector: ".button.button-primary" },
    { route: "/memberships/", name: "smoke-memberships-mobile.png", assertSelector: ".button.button-primary" },
    { route: "/contact/", name: "smoke-contact-mobile.png", assertSelector: "form[data-contact-intake]" },
    { route: "/support/", name: "smoke-support-mobile.png", assertSelector: "[data-faq-search]" }
  ];

  try {
    const check = async (label, fn) => {
      try {
        await fn();
        summary.checks.push({ label, status: "passed" });
      } catch (error) {
        summary.checks.push({
          label,
          status: "failed",
          error: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    };

    const desktopContext = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    const desktopPage = await desktopContext.newPage();
    for (const item of desktopRoutes) {
      await check(`desktop:${item.route}`, async () => {
        await desktopPage.goto(`${baseUrl}${item.route}`, { waitUntil: "networkidle" });
        const hasRequiredElement = await desktopPage.locator(item.assertSelector).first().isVisible();
        assert(hasRequiredElement, `Missing required selector ${item.assertSelector} on ${item.route} (desktop).`);
        await desktopPage.screenshot({ path: resolve(outputRoot, item.name), fullPage: true });
      });
    }
    await desktopContext.close();

    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const mobilePage = await mobileContext.newPage();
    for (const item of mobileRoutes) {
      await check(`mobile:${item.route}`, async () => {
        await mobilePage.goto(`${baseUrl}${item.route}`, { waitUntil: "networkidle" });
        const hasMenuToggle = await mobilePage.locator("[data-menu-toggle]").first().isVisible();
        assert(hasMenuToggle, `Missing mobile menu toggle on ${item.route}.`);
        const hasRequiredElement = await mobilePage.locator(item.assertSelector).first().isVisible();
        assert(hasRequiredElement, `Missing required selector ${item.assertSelector} on ${item.route} (mobile).`);
        await mobilePage.screenshot({ path: resolve(outputRoot, item.name), fullPage: true });
      });
    }

    await check("mobile:/support/ pricing filter interaction", async () => {
      await mobilePage.goto(`${baseUrl}/support/`, { waitUntil: "networkidle" });
      await mobilePage.click('[data-topic="pricing"]');
      await mobilePage.waitForTimeout(300);
      const pricingActive = await mobilePage.evaluate(() => {
        const el = document.querySelector('[data-topic="pricing"]');
        return !!el && el.classList.contains("active");
      });
      assert(pricingActive, "Support pricing topic filter did not become active.");
      await mobilePage.screenshot({
        path: resolve(outputRoot, "smoke-support-mobile-pricing-filter.png"),
        fullPage: true
      });
    });

    await check("mobile:/contact/ validation interaction", async () => {
      await mobilePage.goto(`${baseUrl}/contact/`, { waitUntil: "networkidle" });
      await mobilePage.click('button[type="submit"]');
      await mobilePage.waitForTimeout(200);
      const validationVisible = await mobilePage.evaluate(() => {
        const error = document.querySelector("[data-contact-error]");
        return !!error && !error.hasAttribute("hidden");
      });
      assert(validationVisible, "Contact form validation error did not render.");
      await mobilePage.screenshot({
        path: resolve(outputRoot, "smoke-contact-mobile-validation.png"),
        fullPage: true
      });
    });

    await mobileContext.close();
    summary.status = "passed";
    console.log("Website Playwright smoke checks passed.");
  } catch (error) {
    summary.status = "failed";
    summary.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    summary.finishedAt = new Date().toISOString();
    await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    await browser.close();
    if (server) {
      await new Promise((resolveClose) => server.close(() => resolveClose()));
    }
  }
};

run().catch((error) => {
  console.error("Website Playwright smoke checks failed.");
  console.error(error);
  process.exit(1);
});
