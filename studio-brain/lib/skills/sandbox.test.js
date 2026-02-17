"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const promises_1 = __importDefault(require("node:fs/promises"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const sandbox_1 = require("./sandbox");
const logger = {
    debug: () => { },
    info: () => { },
    warn: () => { },
    error: () => { },
};
async function withTempSkillFile(code, run) {
    const root = await promises_1.default.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "studiobrain-sandbox-skill-"));
    const skillDir = node_path_1.default.join(root, "skill");
    await promises_1.default.mkdir(skillDir, { recursive: true });
    await promises_1.default.writeFile(node_path_1.default.join(skillDir, "index.js"), code, "utf8");
    try {
        await run(skillDir);
    }
    finally {
        await promises_1.default.rm(root, { recursive: true, force: true });
    }
}
(0, node_test_1.default)("skill sandbox can execute a module over stdio", async () => {
    await withTempSkillFile("module.exports.execute = async (payload) => ({ answer: Number(payload.value) + 1 });", async (skillPath) => {
        const sandbox = await (0, sandbox_1.createSkillSandbox)({
            enabled: true,
            egressDeny: false,
            entryTimeoutMs: 3_000,
            logger,
        });
        try {
            strict_1.default.ok(sandbox, "sandbox should be created");
            const out = await sandbox.executeSkill({
                skillPath,
                payload: { value: 2 },
                command: "default",
            });
            strict_1.default.deepEqual(out, { answer: 3 });
        }
        finally {
            await sandbox.close();
        }
    });
});
(0, node_test_1.default)("skill sandbox enforces command allowlist", async () => {
    await withTempSkillFile("module.exports.execute = async () => ({ ok: true });", async (skillPath) => {
        const sandbox = await (0, sandbox_1.createSkillSandbox)({
            enabled: true,
            egressDeny: false,
            entryTimeoutMs: 3_000,
            runtimeAllowlist: ["allowed"],
            logger,
        });
        try {
            strict_1.default.ok(sandbox, "sandbox should be created");
            await strict_1.default.rejects(() => sandbox.executeSkill({
                skillPath,
                command: "blocked",
            }), /command "blocked" blocked by runtime allowlist/);
        }
        finally {
            await sandbox.close();
        }
    });
});
