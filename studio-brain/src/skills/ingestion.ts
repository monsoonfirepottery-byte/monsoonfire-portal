import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { Logger } from "../config/logger";
import type { SkillBundleSource, SkillManifest, SkillRegistryClient } from "./registry";
import { parsePinnedSkillRef } from "./registry";

export type SignatureVerificationResult = {
  ok: boolean;
  reason?: string;
};

export type SignatureVerifier = (input: {
  manifest: SkillManifest;
  sourcePath: string;
}) => Promise<SignatureVerificationResult> | SignatureVerificationResult;

export type InstalledSkill = {
  name: string;
  version: string;
  installPath: string;
  checksumVerified: boolean;
  signatureVerified: boolean;
};

export type InstallationPlan = {
  requestedBy: string;
  allowlist: string[];
  denylist: string[];
  requirePinned: boolean;
  requireChecksum: boolean;
  requireSignature: boolean;
};

export type InstallDecision = {
  ok: boolean;
  reason?: string;
};

function isAllowed(reference: string, allowlist: string[], denylist: string[]): InstallDecision {
  if (denylist.some((entry) => entry === reference || entry === reference.split("@")[0])) {
    return { ok: false, reason: "skill blocked by denylist" };
  }
  if (allowlist.length === 0) {
    return { ok: true };
  }
  return allowlist.includes(reference) || allowlist.includes(reference.split("@")[0])
    ? { ok: true }
    : { ok: false, reason: "skill not on allowlist" };
}

function toSafeChecksum(parts: string[]): string {
  return crypto.createHash("sha256").update(parts.join("\n")).digest("hex");
}

async function checksumDirectoryTree(rootPath: string): Promise<string> {
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
          const normalized = JSON.stringify(withoutChecksum);
          payload.push(`${entryPath.replace(rootPath, "")}:${Buffer.from(normalized, "utf8").toString("hex")}`);
          continue;
        }
      } catch {
        // fallback to raw bytes
      }
    }
    payload.push(`${entryPath.replace(rootPath, "")}:${data.toString("hex")}`);
  }
  payload.sort();
  return toSafeChecksum(payload);
}

async function copyDirectory(source: string, destination: string): Promise<void> {
  await fs.rm(destination, { force: true, recursive: true });
  await fs.cp(source, destination, { recursive: true });
}

function createAuditLine(skill: SkillManifest, payload: {
  sourcePath: string;
  checksumExpected: string | undefined;
  checksumComputed: string;
  signatureVerified: boolean;
  requestedBy: string;
}): string {
  return JSON.stringify({
    at: new Date().toISOString(),
    event: "skill_install",
    skill: `${skill.name}@${skill.version}`,
    sourcePath: payload.sourcePath,
    checksumExpected: payload.checksumExpected ?? null,
    checksumComputed: payload.checksumComputed,
    signatureVerified: payload.signatureVerified,
    requestedBy: payload.requestedBy,
  });
}

function normalizeSignaturePolicy(plan: InstallationPlan): boolean {
  return plan.requireSignature;
}

const defaultSignatureVerifier: SignatureVerifier = async () => ({ ok: true });

export type InstallationInput = {
  reference: string;
  registry: SkillRegistryClient;
  plan: InstallationPlan;
  installRoot: string;
  logger: Logger;
  signatureVerifier?: SignatureVerifier;
};

export async function installSkill(input: InstallationInput): Promise<InstalledSkill> {
  const plan = input.plan;
  const signatureVerifier = input.signatureVerifier ?? defaultSignatureVerifier;
  const ref = plan.requirePinned || input.reference.includes("@")
    ? parsePinnedSkillRef(input.reference)
    : { name: input.reference, version: "latest" };
  const identity = `${ref.name}@${ref.version}`;
  const decision = isAllowed(identity, plan.allowlist, plan.denylist);
  if (!decision.ok) {
    throw new Error(`Skill install denied: ${decision.reason}`);
  }

  const bundle: SkillBundleSource = await input.registry.resolveSkill(ref);
  if (plan.requireChecksum && !bundle.manifest.checksum) {
    throw new Error(`Missing checksum for ${identity}. Set STUDIO_BRAIN_SKILL_REQUIRE_CHECKSUM=false to override.`);
  }

  const checksumComputed = await checksumDirectoryTree(bundle.sourcePath);
  const checksumVerified = !!bundle.manifest.checksum && checksumComputed === bundle.manifest.checksum;
  if (plan.requireChecksum && !checksumVerified) {
    throw new Error(`Checksum mismatch for ${identity}. expected=${bundle.manifest.checksum} computed=${checksumComputed}`);
  }

  const requireSignature = normalizeSignaturePolicy(plan);
  const signatureCheck = requireSignature
    ? await signatureVerifier({
        manifest: bundle.manifest,
        sourcePath: bundle.sourcePath,
      })
    : { ok: true };
  if (!signatureCheck.ok) {
    throw new Error(
      `Signature verification failed for ${identity}` + (signatureCheck.reason ? `: ${signatureCheck.reason}` : "")
    );
  }

  const safeRunId = ref.version.replace(/[^a-zA-Z0-9._-]+/g, "-");
  const installPath = path.join(input.installRoot, ref.name, safeRunId);
  await copyDirectory(bundle.sourcePath, installPath);

  const auditFile = path.join(installPath, ".install-audit.jsonl");
  const audit = createAuditLine(bundle.manifest, {
    sourcePath: bundle.sourcePath,
    checksumExpected: bundle.manifest.checksum,
    checksumComputed,
    signatureVerified: signatureCheck.ok,
    requestedBy: plan.requestedBy,
  });
  await fs.appendFile(auditFile, `${audit}\n`, "utf8");

  await fs.writeFile(
    path.join(installPath, "installed-manifest.json"),
    JSON.stringify(
      {
        installedAt: new Date().toISOString(),
        source: {
          name: ref.name,
          version: ref.version,
        },
        requestedBy: plan.requestedBy,
      },
      null,
      2
    )
  );
  input.logger.info("skill_install_completed", {
    skill: `${ref.name}@${ref.version}`,
    installPath,
    checksumVerified,
  });

  return {
    name: ref.name,
    version: ref.version,
    installPath,
    checksumVerified,
    signatureVerified: signatureCheck.ok,
  };
}

export function createInstallPlan(env: {
  requestor: string;
  allowlist: string[];
  denylist: string[];
  requirePinned: boolean;
  requireChecksum: boolean;
  requireSignature: boolean;
}): InstallationPlan {
  return {
    requestedBy: env.requestor,
    allowlist: env.allowlist,
    denylist: env.denylist,
    requirePinned: env.requirePinned,
    requireChecksum: env.requireChecksum,
    requireSignature: env.requireSignature,
  };
}
