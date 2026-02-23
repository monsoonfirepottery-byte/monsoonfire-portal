#!/usr/bin/env node

import { existsSync, writeFileSync } from "node:fs";
import { promises as dns } from "node:dns";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = new URL("..", import.meta.url);

function parseArgs(argv) {
  const options = {
    portalUrl: "https://portal.monsoonfire.com",
    projectId: "monsoonfire-portal",
    checklistOut: "docs/EXTERNAL_CUTOVER_EXECUTION.md",
    cutoverReportPath: "docs/cutover-verify.json",
    skipVerifier: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg === "--skip-verifier" || arg === "--skip") {
      options.skipVerifier = true;
      continue;
    }

    if (arg.startsWith("--portal-url=")) {
      options.portalUrl = arg.slice("--portal-url=".length);
      continue;
    }
    if (arg.startsWith("--project-id=")) {
      options.projectId = arg.slice("--project-id=".length);
      continue;
    }
    if (arg.startsWith("--checklist-out=")) {
      options.checklistOut = arg.slice("--checklist-out=".length);
      continue;
    }
    if (arg.startsWith("--cutover-report-path=")) {
      options.cutoverReportPath = arg.slice("--cutover-report-path=".length);
      continue;
    }

    if (arg === "--portal-url" && i + 1 < argv.length) {
      options.portalUrl = argv[++i];
      continue;
    }
    if (arg === "--project-id" && i + 1 < argv.length) {
      options.projectId = argv[++i];
      continue;
    }
    if (arg === "--checklist-out" && i + 1 < argv.length) {
      options.checklistOut = argv[++i];
      continue;
    }
    if (arg === "--cutover-report-path" && i + 1 < argv.length) {
      options.cutoverReportPath = argv[++i];
      continue;
    }
  }

  return options;
}

function formatChecklist({
  portalUrl,
  projectId,
  cutoverReportPath,
  skipVerifier,
  hostAvailable,
}) {
  return [
    "# External Cutover Execution Checklist",
    `Generated at: ${new Date().toISOString().replace(/\\.\\d{3}Z$/, "Z")}`,
    "",
    "Primary checklist is platform-neutral and uses compatibility-aware script entrypoints.",
    "",
    `Portal URL: ${portalUrl}`,
    `Firebase project: ${projectId}`,
    "",
    "## 1) DNS + hosting cutover",
    "- [ ] DNS A/CNAME for portal host points to target hosting",
    "- [ ] TLS/HTTPS valid and HTTP -> HTTPS redirect active",
    "- [ ] Upload latest `web/dist` build + Namecheap `.htaccess`",
    "- [ ] Confirm `.well-known` files exist when needed",
    "",
  "Run verifier:",
  "- Execute the Node verifier (primary path):",
  `  - \`node ./web/deploy/namecheap/verify-cutover.mjs --portal-url "${portalUrl}" --report-path "${cutoverReportPath}"\``,
  "- Execute authenticated protected-function verifier (required for cutover close-out):",
  "  - `PORTAL_CUTOVER_ID_TOKEN=\"<REAL_ID_TOKEN>\" node ./web/deploy/namecheap/verify-cutover.mjs`",
  `    - \`--portal-url "${portalUrl}"\``,
  `    - \`--report-path "${cutoverReportPath}"\``,
  "    - `--require-protected-check true`",
  "    - `--functions-base-url https://us-central1-monsoonfire-portal.cloudfunctions.net`",
  "    - `--protected-fn listMaterialsProducts`",
  "    - `--protected-body '{\"includeInactive\":false}'`",
  "  - Do not commit or log the raw token.",
  "- Compatibility fallback (legacy alias):",
  "  - `web/deploy/namecheap/verify-cutover`",
  `    - \`-PortalUrl "${portalUrl}"\``,
  `    - \`-ReportPath "${cutoverReportPath}"\``,
    "",
    "## 2) Firebase Auth baseline",
    "- [ ] Firebase Console -> Authentication -> Settings -> Authorized domains include:",
    "  - `portal.monsoonfire.com`",
    "  - `monsoonfire.com`",
    "  - `www.monsoonfire.com`",
    "  - `localhost`",
    "  - `127.0.0.1`",
    "- [ ] Firebase sign-in methods enabled: Google, Email/Password, Email Link",
    "",
    "## 3) OAuth provider credentials (external consoles)",
    "- [ ] Apple configured in Firebase (Service ID + key)",
    "- [ ] Facebook configured in Firebase (App ID + secret)",
    "- [ ] Microsoft configured in Firebase (App ID + secret)",
    "- [ ] Redirect URIs copied from Firebase provider panels exactly",
    "",
    "Log entry helper:",
    "- Run from compatibility-friendly shell:",
    "  - `node ./scripts/ps1-run.mjs scripts/new-auth-provider-run-entry.ps1`",
    `  - \`-OutFile docs/PROD_AUTH_PROVIDER_RUN_LOG.md\``,
    `  - \`-PortalUrl "${portalUrl}"\``,
    "",
    "## 4) Hosted auth verification",
    "- [ ] Google sign-in succeeds on hosted portal",
    "- [ ] Apple sign-in succeeds on hosted portal",
    "- [ ] Facebook sign-in succeeds on hosted portal",
    "- [ ] Microsoft sign-in succeeds on hosted portal",
    "- [ ] No `auth/unauthorized-domain` errors",
    "- [ ] Popup blocked fallback works",
    "",
    "## 4b) Protected function verification from hosted auth context",
    "- [ ] Capture a valid user ID token from hosted sign-in session (no token in git)",
    "- [ ] Run authenticated verifier command (section 1)",
    "- [ ] Confirm report includes `protectedFunction` in passed checks",
    "",
    "## 5) Notification drill execution (prod token required)",
    "- [ ] Append run template:",
    "  - Run `node ./scripts/ps1-run.mjs scripts/new-drill-log-entry.ps1`",
    '  - `-Uid "<REAL_UID>"`',
    "- [ ] Run drills:",
    "  - Execute `node ./scripts/ps1-run.mjs scripts/run-notification-drills.ps1`",
    "  - Parameters:",
    "    - `-BaseUrl https://us-central1-{PROJECT_ID}.cloudfunctions.net`",
    '    - `-IdToken "<REAL_ID_TOKEN>"`',
    '    - `-Uid "<REAL_UID>"`',
    '    - `-OutputJson`',
    '    - `-LogFile "docs/drill-runs.jsonl"`',
    "- [ ] Verify Firestore evidence collections and update `docs/DRILL_EXECUTION_LOG.md`",
    "",
    "## 6) Final evidence handoff",
    "- [ ] Attach cutover verifier JSON report",
    "- [ ] Attach provider run log entry",
    "- [ ] Attach drill summary/log output",
    "- [ ] Mark tickets complete:",
    "  - `tickets/P0-portal-hosting-cutover.md`",
    "  - `tickets/P1-prod-auth-oauth-provider-credentials.md`",
    "  - `tickets/P0-alpha-drills-real-auth.md`",
    "",
    skipVerifier
      ? "> Verifier execution intentionally skipped (--skip-verifier)."
      : hostAvailable
        ? "> Host is currently resolving; run verifier command once DNS and hosting are in place."
        : "> Host is not yet resolving in current environment; run verifier once DNS resolves.",
  ].join("\n");
}

function toAbsoluteRepoPath(relativePath) {
  return resolve(fileURLToPath(repoRoot), relativePath);
}

function ensureDirectory(relativePath) {
  const absPath = toAbsoluteRepoPath(relativePath);
  if (!existsSync(absPath)) {
    throw new Error(`Required file not found: ${relativePath}`);
  }
}

function isPortalResolvable(portalUrl) {
  try {
    const host = new URL(portalUrl).hostname;
    return dns
      .lookup(host)
      .then(() => true)
      .catch(() => false);
  } catch {
    return Promise.resolve(false);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  ensureDirectory("docs/PROD_AUTH_PROVIDER_EXECUTION.md");

  const hostAvailable = await isPortalResolvable(args.portalUrl);
  const checklistOut = toAbsoluteRepoPath(args.checklistOut);
  const checklist = formatChecklist({
    portalUrl: args.portalUrl,
    projectId: args.projectId,
    cutoverReportPath: args.cutoverReportPath,
    skipVerifier: args.skipVerifier,
    hostAvailable,
  });

  writeFileSync(checklistOut, `${checklist}\n`, "utf8");
  console.info(`Wrote checklist: ${args.checklistOut}`);

  if (args.skipVerifier) {
    console.info("Skipping verifier execution (--skip-verifier)");
    return;
  }

  if (!hostAvailable) {
    console.warn("Portal host not resolvable yet; skip verifier now.");
    console.warn(`DNS for ${args.portalUrl} must resolve before compatibility verifier runs.`);
  } else {
    console.info("Portal host resolves. Execute verifier entrypoint manually if desired.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
