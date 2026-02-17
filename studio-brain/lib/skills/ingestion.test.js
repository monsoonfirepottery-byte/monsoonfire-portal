"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const promises_1 = __importDefault(require("node:fs/promises"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const registry_1 = require("./registry");
const ingestion_1 = require("./ingestion");
const logger = {
    debug: () => { },
    info: () => { },
    warn: () => { },
    error: () => { },
};
async function buildFixture() {
    const rootPath = await promises_1.default.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "studiobrain-skill-fixture-"));
    const name = "planner";
    const version = "1.0.0";
    const sourceDir = node_path_1.default.join(rootPath, name, version);
    const installRoot = node_path_1.default.join(rootPath, "installed");
    await promises_1.default.mkdir(sourceDir, { recursive: true });
    await promises_1.default.writeFile(node_path_1.default.join(sourceDir, "manifest.json"), JSON.stringify({
        name,
        version,
        description: "planner skill",
        entrypoint: "index.js",
    }), "utf8");
    await promises_1.default.writeFile(node_path_1.default.join(sourceDir, "index.js"), "module.exports.execute = async (payload) => ({ok: true, payload});", "utf8");
    return { rootPath, name, version, installRoot };
}
async function checksumDirectory(rootPath) {
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
                    payload.push(`${entryPath.replace(rootPath, "")}:${Buffer.from(JSON.stringify(withoutChecksum), "utf8").toString("hex")}`);
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
    return node_crypto_1.default.createHash("sha256").update(payload.join("\n")).digest("hex");
}
(0, node_test_1.default)("skill install enforces pinned references and allowlist/denylist", async () => {
    const fixture = await buildFixture();
    const registry = (0, registry_1.createLocalRegistryClient)({ rootPath: fixture.rootPath });
    await strict_1.default.rejects(() => (0, ingestion_1.installSkill)({
        reference: fixture.name,
        registry,
        plan: (0, ingestion_1.createInstallPlan)({
            requestor: "ops",
            allowlist: [fixture.name],
            denylist: [],
            requirePinned: true,
            requireChecksum: false,
            requireSignature: false,
        }),
        installRoot: fixture.installRoot,
        logger,
    }), /pinned/);
    await strict_1.default.rejects(() => (0, ingestion_1.installSkill)({
        reference: `${fixture.name}@${fixture.version}`,
        registry,
        plan: (0, ingestion_1.createInstallPlan)({
            requestor: "ops",
            allowlist: [],
            denylist: [`${fixture.name}@${fixture.version}`],
            requirePinned: true,
            requireChecksum: false,
            requireSignature: false,
        }),
        installRoot: fixture.installRoot,
        logger,
    }), /install denied/);
    const allowed = await (0, ingestion_1.installSkill)({
        reference: `${fixture.name}@${fixture.version}`,
        registry,
        plan: (0, ingestion_1.createInstallPlan)({
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
    strict_1.default.equal(allowed.name, fixture.name);
    strict_1.default.equal(allowed.version, fixture.version);
    await promises_1.default.rm(fixture.rootPath, { recursive: true, force: true });
    await promises_1.default.rm(fixture.installRoot, { recursive: true, force: true });
});
(0, node_test_1.default)("skill install validates checksum and optional signature verifier", async () => {
    const fixture = await buildFixture();
    const registry = (0, registry_1.createLocalRegistryClient)({ rootPath: fixture.rootPath });
    const checksumOptional = await (0, ingestion_1.installSkill)({
        reference: `${fixture.name}@${fixture.version}`,
        registry,
        plan: (0, ingestion_1.createInstallPlan)({
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
    strict_1.default.equal(checksumOptional.checksumVerified, false);
    const manifestPath = node_path_1.default.join(fixture.rootPath, fixture.name, fixture.version, "manifest.json");
    const manifest = JSON.parse(await promises_1.default.readFile(manifestPath, "utf8"));
    const withChecksum = {
        ...manifest,
        checksum: await checksumDirectory(node_path_1.default.join(fixture.rootPath, fixture.name, fixture.version)),
    };
    await promises_1.default.writeFile(manifestPath, JSON.stringify(withChecksum), "utf8");
    const trusted = await (0, ingestion_1.installSkill)({
        reference: `${fixture.name}@${fixture.version}`,
        registry,
        plan: (0, ingestion_1.createInstallPlan)({
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
    strict_1.default.equal(trusted.name, fixture.name);
    strict_1.default.equal(trusted.version, fixture.version);
    strict_1.default.equal(trusted.checksumVerified, true);
    strict_1.default.equal(trusted.signatureVerified, true);
    const rejected = (0, ingestion_1.installSkill)({
        reference: `${fixture.name}@${fixture.version}`,
        registry,
        plan: (0, ingestion_1.createInstallPlan)({
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
    await strict_1.default.rejects(rejected, /Signature verification failed/);
    await promises_1.default.rm(fixture.rootPath, { recursive: true, force: true });
    await promises_1.default.rm(fixture.installRoot, { recursive: true, force: true });
});
