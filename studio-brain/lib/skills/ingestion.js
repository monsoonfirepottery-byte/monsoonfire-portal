"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.installSkill = installSkill;
exports.createInstallPlan = createInstallPlan;
const node_crypto_1 = __importDefault(require("node:crypto"));
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const registry_1 = require("./registry");
const trustAnchor_1 = require("./trustAnchor");
function isAllowed(reference, allowlist, denylist) {
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
function toSafeChecksum(parts) {
    return node_crypto_1.default.createHash("sha256").update(parts.join("\n")).digest("hex");
}
async function checksumDirectoryTree(rootPath) {
    const entries = await promises_1.default.readdir(rootPath, { recursive: true, withFileTypes: true });
    const payload = [];
    for (const entry of entries) {
        if (!entry.isFile())
            continue;
        const entryPath = node_path_1.default.join(entry.parentPath, entry.name);
        const data = await promises_1.default.readFile(entryPath);
        if (entry.name === "manifest.json") {
            try {
                const parsed = JSON.parse(data.toString("utf8"));
                if (parsed && typeof parsed === "object") {
                    const { checksum, ...withoutChecksum } = parsed;
                    void checksum;
                    const normalized = JSON.stringify(withoutChecksum);
                    payload.push(`${entryPath.replace(rootPath, "")}:${Buffer.from(normalized, "utf8").toString("hex")}`);
                    continue;
                }
            }
            catch {
                // fallback to raw bytes
            }
        }
        payload.push(`${entryPath.replace(rootPath, "")}:${data.toString("hex")}`);
    }
    payload.sort();
    return toSafeChecksum(payload);
}
async function copyDirectory(source, destination) {
    await promises_1.default.rm(destination, { force: true, recursive: true });
    await promises_1.default.cp(source, destination, { recursive: true });
}
function createAuditLine(skill, payload) {
    return JSON.stringify({
        at: new Date().toISOString(),
        event: "skill_install",
        skill: `${skill.name}@${skill.version}`,
        sourcePath: payload.sourcePath,
        checksumExpected: payload.checksumExpected ?? null,
        checksumComputed: payload.checksumComputed,
        checksumVerified: payload.checksumVerified,
        requireChecksum: payload.requireChecksum,
        signatureVerified: payload.signatureVerified,
        requireSignature: payload.requireSignature,
        signatureFallbackReason: payload.signatureFallbackReason,
        requestedBy: payload.requestedBy,
    });
}
function normalizeSignaturePolicy(plan) {
    return plan.requireSignature;
}
async function installSkill(input) {
    const plan = input.plan;
    const signatureVerifier = input.signatureVerifier ??
        (0, trustAnchor_1.createSkillSignatureTrustAnchorVerifier)({
            trustAnchors: input.signatureTrustAnchors ?? {},
        });
    const ref = plan.requirePinned || input.reference.includes("@")
        ? (0, registry_1.parsePinnedSkillRef)(input.reference)
        : { name: input.reference, version: "latest" };
    const identity = `${ref.name}@${ref.version}`;
    input.logger.info("skill_install_verification_started", {
        skill: identity,
        requestedBy: plan.requestedBy,
        requirePinned: plan.requirePinned,
        requireChecksum: plan.requireChecksum,
        requireSignature: plan.requireSignature,
    });
    const decision = isAllowed(identity, plan.allowlist, plan.denylist);
    if (!decision.ok) {
        input.logger.warn("skill_install_verification_failed", {
            skill: identity,
            stage: "policy",
            reason: decision.reason ?? "INSTALL_POLICY_DENIED",
        });
        throw new Error(`Skill install denied: ${decision.reason}`);
    }
    const bundle = await input.registry.resolveSkill(ref);
    if (plan.requireChecksum && !bundle.manifest.checksum) {
        input.logger.warn("skill_install_verification_failed", {
            skill: identity,
            stage: "checksum",
            reason: "MISSING_CHECKSUM",
        });
        throw new Error(`Missing checksum for ${identity}. Set STUDIO_BRAIN_SKILL_REQUIRE_CHECKSUM=false to override.`);
    }
    if (!plan.requireChecksum) {
        input.logger.info("skill_install_verification_fallback", {
            skill: identity,
            stage: "checksum",
            reason: "CHECKSUM_POLICY_DISABLED",
        });
    }
    const checksumComputed = await checksumDirectoryTree(bundle.sourcePath);
    const checksumVerified = !!bundle.manifest.checksum && checksumComputed === bundle.manifest.checksum;
    if (plan.requireChecksum && !checksumVerified) {
        input.logger.warn("skill_install_verification_failed", {
            skill: identity,
            stage: "checksum",
            reason: "CHECKSUM_MISMATCH",
        });
        throw new Error(`Checksum mismatch for ${identity}. expected=${bundle.manifest.checksum} computed=${checksumComputed}`);
    }
    const requireSignature = normalizeSignaturePolicy(plan);
    let signatureVerified = false;
    let signatureFallbackReason = null;
    if (requireSignature) {
        const signatureCheck = await signatureVerifier({
            manifest: bundle.manifest,
            sourcePath: bundle.sourcePath,
        });
        if (!signatureCheck.ok) {
            const reason = signatureCheck.reason ?? "SIGNATURE_VERIFICATION_FAILED";
            input.logger.warn("skill_install_verification_failed", {
                skill: identity,
                stage: "signature",
                reason,
            });
            throw new Error(`Signature verification failed for ${identity}: ${reason}`);
        }
        signatureVerified = true;
    }
    else {
        signatureFallbackReason = "SIGNATURE_POLICY_DISABLED";
        input.logger.info("skill_install_verification_fallback", {
            skill: identity,
            stage: "signature",
            reason: signatureFallbackReason,
        });
    }
    input.logger.info("skill_install_verification_success", {
        skill: identity,
        checksumVerified,
        signatureVerified,
        requireChecksum: plan.requireChecksum,
        requireSignature,
    });
    const safeRunId = ref.version.replace(/[^a-zA-Z0-9._-]+/g, "-");
    const installPath = node_path_1.default.join(input.installRoot, ref.name, safeRunId);
    await copyDirectory(bundle.sourcePath, installPath);
    const auditFile = node_path_1.default.join(installPath, ".install-audit.jsonl");
    const audit = createAuditLine(bundle.manifest, {
        sourcePath: bundle.sourcePath,
        checksumExpected: bundle.manifest.checksum,
        checksumComputed,
        checksumVerified,
        requireChecksum: plan.requireChecksum,
        signatureVerified,
        requireSignature,
        signatureFallbackReason,
        requestedBy: plan.requestedBy,
    });
    await promises_1.default.appendFile(auditFile, `${audit}\n`, "utf8");
    await promises_1.default.writeFile(node_path_1.default.join(installPath, "installed-manifest.json"), JSON.stringify({
        installedAt: new Date().toISOString(),
        source: {
            name: ref.name,
            version: ref.version,
        },
        requestedBy: plan.requestedBy,
    }, null, 2));
    input.logger.info("skill_install_completed", {
        skill: `${ref.name}@${ref.version}`,
        installPath,
        checksumVerified,
        signatureVerified,
    });
    return {
        name: ref.name,
        version: ref.version,
        installPath,
        checksumVerified,
        signatureVerified,
    };
}
function createInstallPlan(env) {
    return {
        requestedBy: env.requestor,
        allowlist: env.allowlist,
        denylist: env.denylist,
        requirePinned: env.requirePinned,
        requireChecksum: env.requireChecksum,
        requireSignature: env.requireSignature,
    };
}
