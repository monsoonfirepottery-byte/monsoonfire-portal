"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSkillSandbox = createSkillSandbox;
const node_child_process_1 = require("node:child_process");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
function createRequestId() {
    return `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 9)}`;
}
async function createSkillSandbox(env) {
    if (env.enabled === false)
        return null;
    const root = process.cwd();
    const workerPath = node_path_1.default.join(root, "lib", "skills", "sandboxWorker.js");
    if (!node_fs_1.default.existsSync(workerPath)) {
        throw new Error(`sandbox worker missing at ${workerPath}. Run npm run build first.`);
    }
    const child = (0, node_child_process_1.spawn)(process.execPath, [workerPath], {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
            ...process.env,
            STUDIO_BRAIN_SKILL_SANDBOX_ENTRY_TIMEOUT_MS: String(env.entryTimeoutMs ?? 15_000),
            STUDIO_BRAIN_SKILL_SANDBOX_EGRESS_DENY: env.egressDeny ? "true" : "false",
            STUDIO_BRAIN_SKILL_SANDBOX_EGRESS_ALLOWLIST: env.egressAllowlist?.join(",") ?? "",
            STUDIO_BRAIN_SKILL_RUNTIME_ALLOWLIST: env.runtimeAllowlist?.join(",") ?? "",
        },
    });
    if (!child.stdout || !child.stdin) {
        throw new Error("sandbox process stdio unavailable");
    }
    const pending = new Map();
    let closed = false;
    const onMessage = (line) => {
        try {
            const parsed = JSON.parse(line);
            const pendingHandler = pending.get(parsed.id);
            if (!pendingHandler)
                return;
            pending.delete(parsed.id);
            if (parsed.ok)
                pendingHandler.resolve(parsed);
            else
                pendingHandler.reject(new Error(parsed.error ?? "sandbox error"));
        }
        catch {
            // ignore malformed frame
        }
    };
    child.stdout.on("data", (chunk) => {
        const text = String(chunk);
        text.split("\n").forEach((line) => {
            if (line.trim().length > 0)
                onMessage(line.trim());
        });
    });
    const send = (message) => {
        return new Promise((resolve, reject) => {
            if (closed) {
                reject(new Error("sandbox closed"));
                return;
            }
            pending.set(message.id, { resolve, reject });
            child.stdin?.write(`${JSON.stringify(message)}\n`);
            setTimeout(() => {
                if (pending.delete(message.id)) {
                    reject(new Error(`sandbox timeout for ${message.id}`));
                }
            }, env.entryTimeoutMs ? env.entryTimeoutMs + 1_000 : 16_000);
        });
    };
    const executeSkill = async (input) => {
        const payload = { id: createRequestId(), method: "execute", params: input };
        const response = await send(payload);
        return response.result;
    };
    const healthcheck = async () => {
        const response = await send({ id: createRequestId(), method: "healthcheck" });
        return response.ok && response.result !== undefined;
    };
    const close = async () => {
        closed = true;
        for (const [, pendingResponse] of pending.entries()) {
            pendingResponse.reject(new Error("sandbox closed"));
        }
        pending.clear();
        await new Promise((resolve) => {
            if (!child.killed) {
                child.kill("SIGTERM");
            }
            child.once("exit", () => resolve());
        });
    };
    child.on("error", (error) => {
        env.logger.error("skill_sandbox_process_error", { message: error.message });
    });
    child.stderr.on("data", (chunk) => {
        env.logger.debug("skill_sandbox_stderr", { output: String(chunk) });
    });
    return { executeSkill, healthcheck, close };
}
