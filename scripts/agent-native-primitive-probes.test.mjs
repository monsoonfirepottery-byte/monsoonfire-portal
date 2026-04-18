import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";

const runProbe = (scriptPath, args = []) => {
  const result = spawnSync("node", [scriptPath, ...args, "--benchmark-probe", "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(String(result.stdout || "{}"));
};

test("deploy primitive probe exits without live deploy side effects", () => {
  const payload = runProbe("./scripts/deploy-namecheap-portal.mjs", [
    "--remote-path",
    "portal/",
    "--portal-url",
    "https://portal.monsoonfire.com",
  ]);
  assert.equal(payload.tool, "deploy-namecheap-portal");
  assert.equal(payload.benchmarkProbe, true);
  assert.equal(payload.options.remotePath, "portal/");
});

test("portal smoke primitive probe exits without launching the full smoke lane", () => {
  const payload = runProbe("./scripts/portal-playwright-smoke.mjs", [
    "--base-url",
    "https://portal.monsoonfire.com",
    "--output-dir",
    "output/playwright/portal/prod",
  ]);
  assert.equal(payload.tool, "portal-playwright-smoke");
  assert.equal(payload.benchmarkProbe, true);
  assert.equal(payload.options.baseUrl, "https://portal.monsoonfire.com");
});

test("website smoke primitive probe exits without starting browser automation", () => {
  const payload = runProbe("./scripts/website-playwright-smoke.mjs", [
    "--base-url",
    "https://monsoonfire.com",
    "--output-dir",
    "output/playwright/prod",
  ]);
  assert.equal(payload.tool, "website-playwright-smoke");
  assert.equal(payload.benchmarkProbe, true);
  assert.equal(payload.options.expectedPortalHost, "portal.monsoonfire.com");
});

test("native browser shadow verifier probe exits without writing artifacts", () => {
  const payload = runProbe("./scripts/native-browser-shadow-verifier.mjs", [
    "--surface",
    "portal",
    "--base-url",
    "https://portal.monsoonfire.com",
    "--output-dir",
    "output/native-browser/portal/prod",
    "--shadow-of",
    "verify.portal.smoke",
  ]);
  assert.equal(payload.tool, "native-browser-shadow-verifier");
  assert.equal(payload.benchmarkProbe, true);
  assert.equal(payload.options.surface, "portal");
  assert.equal(payload.options.shadowOf, "verify.portal.smoke");
});

test("native browser shadow exec probe advertises execute mode", () => {
  const payload = runProbe("./scripts/native-browser-shadow-verifier.mjs", [
    "--surface",
    "website",
    "--base-url",
    "https://monsoonfire.com",
    "--output-dir",
    "output/native-browser/website/prod",
    "--shadow-of",
    "verify.website.smoke",
    "--execute",
  ]);
  assert.equal(payload.tool, "native-browser-shadow-verifier");
  assert.equal(payload.benchmarkProbe, true);
  assert.equal(payload.options.surface, "website");
  assert.equal(payload.options.execute, true);
});
