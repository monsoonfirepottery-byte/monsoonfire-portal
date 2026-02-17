import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createLocalRegistryClient } from "./registry";
import { createInstallPlan, installSkill } from "./ingestion";
import type { Logger } from "../config/logger";

const logger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

type SkillFixture = {
  rootPath: string;
  name: string;
  version: string;
  installRoot: string;
};

async function buildFixture(): Promise<SkillFixture> {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "studiobrain-skill-fixture-"));
  const name = "planner";
  const version = "1.0.0";
  const sourceDir = path.join(rootPath, name, version);
  const installRoot = path.join(rootPath, "installed");

  await fs.mkdir(sourceDir, { recursive: true });
  await fs.writeFile(
    path.join(sourceDir, "manifest.json"),
    JSON.stringify({
      name,
      version,
      description: "planner skill",
      entrypoint: "index.js",
    }),
    "utf8"
  );

  await fs.writeFile(
    path.join(sourceDir, "index.js"),
    "module.exports.execute = async (payload) => ({ok: true, payload});",
    "utf8"
  );

  return { rootPath, name, version, installRoot };
}

async function checksumDirectory(rootPath: string): Promise<string> {
  const entries = await fs.readdir(rootPath, { recursive: true, withFileTypes: true });
  const payload: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const entryPath = path.join(entry.parentPath, entry.name);
    const data = await fs.readFile(entryPath);
    payload.push(`${entryPath.replace(rootPath, "")}:${data.toString("hex")}`);
  }
  payload.sort();
  return crypto.createHash("sha256").update(payload.join("\n")).digest("hex");
}

test("skill install enforces pinned references and allowlist/denylist", async () => {
  const fixture = await buildFixture();
  const registry = createLocalRegistryClient({ rootPath: fixture.rootPath });

  await assert.rejects(
    () =>
      installSkill({
        reference: fixture.name,
        registry,
        plan: createInstallPlan({
          requestor: "ops",
          allowlist: [fixture.name],
          denylist: [],
          requirePinned: true,
          requireChecksum: false,
          requireSignature: false,
        }),
        installRoot: fixture.installRoot,
        logger,
      }),
    /pinned/
  );

  await assert.rejects(
    () =>
      installSkill({
        reference: `${fixture.name}@${fixture.version}`,
        registry,
        plan: createInstallPlan({
          requestor: "ops",
          allowlist: [],
          denylist: [`${fixture.name}@${fixture.version}`],
          requirePinned: true,
          requireChecksum: false,
          requireSignature: false,
        }),
        installRoot: fixture.installRoot,
        logger,
      }),
    /install denied/
  );

  const allowed = await installSkill({
    reference: `${fixture.name}@${fixture.version}`,
    registry,
    plan: createInstallPlan({
      requestor: "ops",
      allowlist: [fixture.name],
      denylist: [],
      requirePinned: true,
      requireChecksum: false,
      requireSignature: false,
    }),
    installRoot: fixture.installRoot,
    logger,
  });
  assert.equal(allowed.name, fixture.name);
  assert.equal(allowed.version, fixture.version);

  await fs.rm(fixture.rootPath, { recursive: true, force: true });
  await fs.rm(fixture.installRoot, { recursive: true, force: true });
});

test("skill install validates checksum and optional signature verifier", async () => {
  const fixture = await buildFixture();
  const registry = createLocalRegistryClient({ rootPath: fixture.rootPath });

  const checksumOptional = await installSkill({
    reference: `${fixture.name}@${fixture.version}`,
    registry,
    plan: createInstallPlan({
      requestor: "ops",
      allowlist: [fixture.name],
      denylist: [],
      requirePinned: true,
      requireChecksum: false,
      requireSignature: false,
    }),
    installRoot: fixture.installRoot,
    logger,
  });

  assert.equal(checksumOptional.checksumVerified, false);

  const manifestPath = path.join(fixture.rootPath, fixture.name, fixture.version, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as Record<string, unknown>;
  const withChecksum = {
    ...manifest,
    checksum: await checksumDirectory(path.join(fixture.rootPath, fixture.name, fixture.version)),
  };
  await fs.writeFile(manifestPath, JSON.stringify(withChecksum), "utf8");

  const trusted = await installSkill({
    reference: `${fixture.name}@${fixture.version}`,
    registry,
    plan: createInstallPlan({
      requestor: "ops",
      allowlist: [fixture.name],
      denylist: [],
      requirePinned: true,
      requireChecksum: true,
      requireSignature: true,
    }),
    installRoot: fixture.installRoot,
    logger,
    signatureVerifier: () => ({ ok: true }),
  });
  assert.equal(trusted.name, fixture.name);
  assert.equal(trusted.version, fixture.version);
  assert.equal(trusted.checksumVerified, true);
  assert.equal(trusted.signatureVerified, true);

  const rejected = installSkill({
    reference: `${fixture.name}@${fixture.version}`,
    registry,
    plan: createInstallPlan({
      requestor: "ops",
      allowlist: [fixture.name],
      denylist: [],
      requirePinned: true,
      requireChecksum: true,
      requireSignature: true,
    }),
    installRoot: fixture.installRoot,
    logger,
    signatureVerifier: () => ({ ok: false, reason: "disallowed signature" }),
  });
  await assert.rejects(rejected, /Signature verification failed/);

  await fs.rm(fixture.rootPath, { recursive: true, force: true });
  await fs.rm(fixture.installRoot, { recursive: true, force: true });
});
