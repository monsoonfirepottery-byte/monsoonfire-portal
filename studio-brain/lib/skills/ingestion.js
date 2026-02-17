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
        signatureVerified: payload.signatureVerified,
        requestedBy: payload.requestedBy,
    });
}
function normalizeSignaturePolicy(plan) {
    return plan.requireSignature;
}
const defaultSignatureVerifier = async () => ({ ok: true });
async function installSkill(input) {
    const plan = input.plan;
    const signatureVerifier = input.signatureVerifier ?? defaultSignatureVerifier;
    const ref = plan.requirePinned || input.reference.includes("@")
        ? (0, registry_1.parsePinnedSkillRef)(input.reference)
        : { name: input.reference, version: "latest" };
    const identity = `${ref.name}@${ref.version}`;
    const decision = isAllowed(identity, plan.allowlist, plan.denylist);
    if (!decision.ok) {
        throw new Error(`Skill install denied: ${decision.reason}`);
    }
    const bundle = await input.registry.resolveSkill(ref);
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
        throw new Error(`Signature verification failed for ${identity}` + (signatureCheck.reason ? `: ${signatureCheck.reason}` : ""));
    }
    const safeRunId = ref.version.replace(/[^a-zA-Z0-9._-]+/g, "-");
    const installPath = node_path_1.default.join(input.installRoot, ref.name, safeRunId);
    await copyDirectory(bundle.sourcePath, installPath);
    const auditFile = node_path_1.default.join(installPath, ".install-audit.jsonl");
    const audit = createAuditLine(bundle.manifest, {
        sourcePath: bundle.sourcePath,
        checksumExpected: bundle.manifest.checksum,
        checksumComputed,
        signatureVerified: signatureCheck.ok,
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
    });
    return {
        name: ref.name,
        version: ref.version,
        installPath,
        checksumVerified,
        signatureVerified: signatureCheck.ok,
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
