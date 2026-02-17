"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_readline_1 = __importDefault(require("node:readline"));
const node_module_1 = require("node:module");
function parseHostFromInput(value) {
    try {
        const parsed = new URL(value);
        return parsed.hostname;
    }
    catch {
        return undefined;
    }
}
function applyEgressPolicy() {
    const denyEgress = process.env.STUDIO_BRAIN_SKILL_SANDBOX_EGRESS_DENY === "true";
    if (!denyEgress)
        return;
    const allowlist = new Set((process.env.STUDIO_BRAIN_SKILL_SANDBOX_EGRESS_ALLOWLIST ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean));
    const checkUrl = (value) => {
        const host = parseHostFromInput(value);
        if (!host)
            return;
        if (allowlist.size > 0 && allowlist.has(host))
            return;
        throw new Error(`egress blocked by policy for host ${host}`);
    };
    const originalFetch = globalThis.fetch;
    if (typeof originalFetch === "function") {
        globalThis.fetch = (input, init) => {
            const target = typeof input === "string" || input instanceof URL
                ? String(input)
                : typeof input === "object" && input !== null && "url" in input
                    ? String(input.url)
                    : typeof input === "object" && input !== null && "href" in input
                        ? String(input.href || "")
                        : "";
            checkUrl(target);
            return originalFetch.call(globalThis, input, init);
        };
    }
    const blockClient = (client) => {
        const originalRequest = client.request;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        client.request = (...args) => {
            const first = args[0];
            if (typeof first === "string") {
                checkUrl(first);
            }
            else if (first && typeof first === "object") {
                const options = first;
                const host = options.hostname ?? options.host;
                if (host) {
                    checkUrl(`https://${host}`);
                }
            }
            return originalRequest.apply(client, args);
        };
    };
    blockClient(require("http"));
    blockClient(require("https"));
}
function send(response) {
    process.stdout.write(`${JSON.stringify(response)}\n`);
}
function readCommaList(raw) {
    if (!raw)
        return new Set();
    return new Set(raw.split(",").map((entry) => entry.trim()).filter(Boolean));
}
function withTimeout(promise, timeoutMs) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("skill execution timed out")), timeoutMs);
        void promise
            .then((value) => {
            clearTimeout(timer);
            resolve(value);
        })
            .catch((error) => {
            clearTimeout(timer);
            reject(error);
        });
    });
}
async function executeSkill(input) {
    if (!input || !input.skillPath) {
        throw new Error("skillPath is required");
    }
    const entrypoint = input.entrypoint || "index.js";
    const source = node_path_1.default.resolve(process.cwd(), input.skillPath, entrypoint);
    if (!node_fs_1.default.existsSync(source)) {
        throw new Error(`skill entrypoint missing: ${source}`);
    }
    const loader = (0, node_module_1.createRequire)(__filename);
    const loaded = loader(source);
    const execute = loaded.execute ?? loaded.default;
    if (typeof execute !== "function") {
        throw new Error("skill module missing execute function");
    }
    const command = String(input.command ?? "default");
    const allowlist = readCommaList(process.env.STUDIO_BRAIN_SKILL_RUNTIME_ALLOWLIST);
    if (allowlist.size > 0 && !allowlist.has(command)) {
        throw new Error(`skill command "${command}" blocked by runtime allowlist`);
    }
    const payload = input.payload ?? input.input ?? {};
    return Promise.resolve(execute(payload, {
        command,
        context: {
            allowedEgressHosts: (process.env.STUDIO_BRAIN_SKILL_SANDBOX_EGRESS_ALLOWLIST ?? "")
                .split(",")
                .map((entry) => entry.trim())
                .filter(Boolean),
        },
    }));
}
async function main() {
    applyEgressPolicy();
    const lineReader = node_readline_1.default.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false,
    });
    const timeoutMs = Math.max(250, Number(process.env.STUDIO_BRAIN_SKILL_SANDBOX_ENTRY_TIMEOUT_MS ?? "15000"));
    lineReader.on("line", async (raw) => {
        let parsed;
        try {
            parsed = JSON.parse(raw);
        }
        catch {
            send({ id: "invalid", ok: false, error: "invalid rpc payload" });
            return;
        }
        if (parsed.method === "healthcheck") {
            send({ id: parsed.id, ok: true, result: { ok: true } });
            return;
        }
        if (parsed.method !== "execute") {
            send({ id: parsed.id, ok: false, error: `unknown method ${parsed.method}` });
            return;
        }
        try {
            const result = await withTimeout(executeSkill(parsed.params), timeoutMs);
            send({ id: parsed.id, ok: true, result });
        }
        catch (error) {
            send({ id: parsed.id, ok: false, error: error instanceof Error ? error.message : String(error) });
        }
    });
}
void main().catch((error) => {
    send({ id: "fatal", ok: false, error: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
});
