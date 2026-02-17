"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parsePinnedSkillRef = parsePinnedSkillRef;
exports.createLocalRegistryClient = createLocalRegistryClient;
exports.createRemoteRegistryClient = createRemoteRegistryClient;
const node_crypto_1 = __importDefault(require("node:crypto"));
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = require("node:fs");
function normalizeSkillRef(input) {
    if (!input || !input.includes("@")) {
        throw new Error("skill reference must be pinned as <name>@<version>");
    }
    const [name, version] = input.split("@", 2);
    if (!name || !version) {
        throw new Error("skill reference must be pinned as <name>@<version>");
    }
    const badVersion = ["latest", "head", "main", "master", "edge"].includes(version.trim().toLowerCase());
    if (badVersion) {
        throw new Error(`skill reference version must be pinned. Received ${version}`);
    }
    if (version.length > 64) {
        throw new Error(`invalid skill version '${version}'`);
    }
    return { name: name.trim(), version: version.trim() };
}
function parsePinnedSkillRef(reference) {
    return normalizeSkillRef(reference);
}
function loadManifestFromFile(filePath) {
    const raw = (0, node_fs_1.readFileSync)(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
        throw new Error(`invalid manifest at ${filePath}`);
    }
    if (!parsed.name || !parsed.version) {
        throw new Error(`manifest missing name/version at ${filePath}`);
    }
    return parsed;
}
function createLocalRegistryClient(options) {
    const root = node_path_1.default.resolve(process.cwd(), options.rootPath);
    return {
        resolveSkill: async ({ name, version }) => {
            const sourcePath = node_path_1.default.join(root, name, version);
            const manifestPath = node_path_1.default.join(sourcePath, "manifest.json");
            const manifest = loadManifestFromFile(manifestPath);
            if (manifest.name !== name || manifest.version !== version) {
                throw new Error(`local manifest mismatch for ${name}@${version}`);
            }
            return { manifest, sourcePath };
        },
        listSkillVersions: async (name) => {
            const target = node_path_1.default.join(root, name);
            const dirents = await promises_1.default.readdir(target, { withFileTypes: true });
            return dirents.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
        },
        healthcheck: async () => {
            const startedAt = Date.now();
            try {
                await promises_1.default.access(root);
                const check = node_crypto_1.default.createHash("sha256").update(root).digest("hex");
                if (!check)
                    throw new Error("hash failure");
                return { ok: true, latencyMs: Date.now() - startedAt };
            }
            catch (error) {
                return {
                    ok: false,
                    latencyMs: Date.now() - startedAt,
                    error: error instanceof Error ? error.message : String(error),
                };
            }
        },
    };
}
function createRemoteRegistryClient(options) {
    const base = options.baseUrl.replace(/\/+$/, "");
    const timeoutMs = Math.max(250, options.timeoutMs ?? 10_000);
    const request = async (pathname) => {
        const url = new URL(`${base}${pathname}`);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(url, { signal: controller.signal });
            if (!response.ok) {
                throw new Error(`remote registry ${url} -> ${response.status}`);
            }
            return (await response.json());
        }
        finally {
            clearTimeout(timeout);
        }
    };
    return {
        resolveSkill: async ({ name, version }) => {
            const payload = await request(`/v1/skills/${encodeURIComponent(name)}/${encodeURIComponent(version)}`);
            if (!payload.manifest)
                throw new Error(`remote registry returned no manifest for ${name}@${version}`);
            const manifest = payload.manifest;
            if (!manifest.name || !manifest.version)
                throw new Error("remote manifest missing name/version");
            if (manifest.name !== name || manifest.version !== version) {
                throw new Error(`remote manifest mismatch for ${name}@${version}`);
            }
            const sourcePath = payload.sourcePath ?? node_path_1.default.join(process.cwd(), ".studiobrain", "remote", name, version);
            return {
                manifest,
                sourcePath,
            };
        },
        listSkillVersions: async (name) => {
            const payload = await request(`/v1/skills/${encodeURIComponent(name)}`);
            return Array.isArray(payload.versions) ? payload.versions.sort() : [];
        },
        healthcheck: async () => {
            const startedAt = Date.now();
            try {
                await request("/healthz");
                return { ok: true, latencyMs: Date.now() - startedAt };
            }
            catch (error) {
                return {
                    ok: false,
                    latencyMs: Date.now() - startedAt,
                    error: error instanceof Error ? error.message : String(error),
                };
            }
        },
    };
}
