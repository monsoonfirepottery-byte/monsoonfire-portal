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

type CapturedLog = {
  level: "debug" | "info" | "warn" | "error";
  event: string;
  meta: Record<string, unknown> | undefined;
};

function createCapturingLogger(): { logger: Logger; rows: CapturedLog[] } {
  const rows: CapturedLog[] = [];
  return {
    logger: {
      debug: (event, meta) => rows.push({ level: "debug", event, meta }),
      info: (event, meta) => rows.push({ level: "info", event, meta }),
      warn: (event, meta) => rows.push({ level: "warn", event, meta }),
      error: (event, meta) => rows.push({ level: "error", event, meta }),
    },
    rows,
  };
}

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
    if (entry.name === "manifest.json") {
      try {
        const parsed = JSON.parse(data.toString("utf8")) as Record<string, unknown>;
        if (parsed && typeof parsed === "object") {
          const { checksum, ...withoutChecksum } = parsed;
          void checksum;
          payload.push(`${entryPath.replace(rootPath, "")}:${Buffer.from(JSON.stringify(withoutChecksum), "utf8").toString("hex")}`);
          continue;
        }
      } catch {
        // fallback to raw bytes
      }
    }
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
  assert.equal(checksumOptional.signatureVerified, false);

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

test("skill install deny-defaults when signature is required but trust evidence is missing", async () => {
  const fixture = await buildFixture();
  const registry = createLocalRegistryClient({ rootPath: fixture.rootPath });
  const manifestPath = path.join(fixture.rootPath, fixture.name, fixture.version, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as Record<string, unknown>;
  await fs.writeFile(
    manifestPath,
    JSON.stringify({
      ...manifest,
      checksum: await checksumDirectory(path.join(fixture.rootPath, fixture.name, fixture.version)),
    }),
    "utf8"
  );

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
  });

  await assert.rejects(rejected, /MISSING_SIGNATURE_METADATA/);

  await fs.rm(fixture.rootPath, { recursive: true, force: true });
  await fs.rm(fixture.installRoot, { recursive: true, force: true });
});

test("skill install emits verification telemetry for fallback and failure outcomes", async () => {
  const fixture = await buildFixture();
  const registry = createLocalRegistryClient({ rootPath: fixture.rootPath });
  const capture = createCapturingLogger();

  await installSkill({
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
    logger: capture.logger,
  });

  const events = capture.rows.map((row) => row.event);
  assert.ok(events.includes("skill_install_verification_started"));
  assert.ok(events.includes("skill_install_verification_fallback"));
  assert.ok(events.includes("skill_install_verification_success"));

  capture.rows.length = 0;
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
        logger: capture.logger,
      }),
    /install denied/
  );

  const failureEvents = capture.rows.map((row) => row.event);
  assert.ok(failureEvents.includes("skill_install_verification_failed"));

  await fs.rm(fixture.rootPath, { recursive: true, force: true });
  await fs.rm(fixture.installRoot, { recursive: true, force: true });
});
