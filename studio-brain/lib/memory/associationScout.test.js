"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const node_events_1 = require("node:events");
const node_fs_1 = require("node:fs");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const node_stream_1 = require("node:stream");
const associationScout_1 = require("./associationScout");
function createBundle() {
    return {
        runId: "dream-run-1",
        mode: "idle",
        bundleId: "bundle-1",
        bundleType: "theme-cluster",
        themeType: "workflow",
        themeKey: "approval-summary",
        focusAreas: ["approval summary"],
        rows: [
            {
                id: "mem-1",
                source: "manual",
                memoryLayer: "episodic",
                status: "accepted",
                content: "Summarize approvals before suggesting next actions.",
                sourceConfidence: 0.9,
                importance: 0.8,
                tags: ["decision"],
                metadata: {
                    entityHints: ["role:operator"],
                    patternHints: ["workflow:approval-summary"],
                },
            },
            {
                id: "mem-2",
                source: "repo-markdown",
                memoryLayer: "canonical",
                status: "accepted",
                content: "Runbook note: approvals get a compact summary first.",
                sourceConfidence: 0.84,
                importance: 0.78,
                tags: ["runbook"],
                metadata: {
                    lineageKey: "repo-1",
                    entityHints: ["role:operator"],
                    patternHints: ["workflow:approval-summary"],
                },
            },
        ],
    };
}
(0, node_test_1.default)("describeAssociationScoutEnv prefers codex auth in auto mode and migrates the legacy API model", () => {
    const availability = (0, associationScout_1.describeAssociationScoutEnv)({
        STUDIO_BRAIN_MEMORY_CONSOLIDATION_ASSOCIATION_SCOUT_ENABLED: "true",
        STUDIO_BRAIN_MEMORY_CONSOLIDATION_ASSOCIATION_SCOUT_PROVIDER: "auto",
        STUDIO_BRAIN_MEMORY_CONSOLIDATION_ASSOCIATION_SCOUT_MODEL: "gpt-4.1-mini",
        STUDIO_BRAIN_DISCORD_CODEX_EXECUTABLE: "codex",
        STUDIO_BRAIN_DISCORD_CODEX_MODEL: "gpt-5.4",
        STUDIO_BRAIN_DISCORD_CODEX_REASONING_EFFORT: "medium",
    });
    strict_1.default.equal(availability.available, true);
    strict_1.default.equal(availability.provider, "auto");
    strict_1.default.equal(availability.resolvedProvider, "codex-cli");
    strict_1.default.equal(availability.model, "gpt-5.4");
    strict_1.default.equal(availability.codexExecutable, "codex");
    strict_1.default.equal(availability.reasoningEffort, "medium");
    strict_1.default.equal(availability.reason, null);
});
(0, node_test_1.default)("createAssociationScoutFromEnv uses codex exec and strips direct API keys from the child environment", async () => {
    const tempRoot = (0, node_fs_1.mkdtempSync)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "association-scout-test-"));
    const sourceCodexHome = (0, node_path_1.join)(tempRoot, "source-codex-home");
    const sourceAuthPath = (0, node_path_1.join)(sourceCodexHome, "auth.json");
    (0, node_fs_1.mkdirSync)(sourceCodexHome, { recursive: true });
    (0, node_fs_1.writeFileSync)(sourceAuthPath, JSON.stringify({ access_token: "chatgpt-session" }), "utf8");
    const captured = {};
    const fakeSpawn = ((command, args, options) => {
        const child = new node_events_1.EventEmitter();
        child.stdout = new node_stream_1.PassThrough();
        child.stderr = new node_stream_1.PassThrough();
        child.stdin = new node_stream_1.PassThrough();
        child.kill = () => { };
        child.stdin.end = ((chunk) => {
            captured.command = String(command);
            captured.args = Array.isArray(args) ? args.map((entry) => String(entry)) : [];
            captured.prompt = String(chunk ?? "");
            captured.envOpenAiKey = options?.env?.OPENAI_API_KEY;
            captured.envStudioBrainKey = options?.env?.STUDIO_BRAIN_OPENAI_API_KEY;
            captured.childCodexHome = options?.env?.CODEX_HOME;
            captured.childHome = options?.env?.HOME;
            captured.childAuthSnapshot =
                captured.childCodexHome && (0, node_fs_1.existsSync)((0, node_path_1.join)(captured.childCodexHome, "auth.json"))
                    ? (0, node_fs_1.readFileSync)((0, node_path_1.join)(captured.childCodexHome, "auth.json"), "utf8")
                    : "";
            const schemaIndex = captured.args.indexOf("--output-schema");
            const outputIndex = captured.args.indexOf("-o");
            captured.schemaPath = schemaIndex >= 0 ? captured.args[schemaIndex + 1] : "";
            captured.schemaBody =
                captured.schemaPath && (0, node_fs_1.existsSync)(captured.schemaPath)
                    ? (0, node_fs_1.readFileSync)(captured.schemaPath, "utf8")
                    : "";
            const outputPath = outputIndex >= 0 ? captured.args[outputIndex + 1] : "";
            if (outputPath) {
                (0, node_fs_1.writeFileSync)(outputPath, `${JSON.stringify({
                    theme: "approval summary before action",
                    summary: "These memories describe the same approval-summary habit.",
                    confidence: 0.82,
                    contradictions: [],
                    followUpQueries: ["approval summary runbook"],
                    intents: [
                        {
                            type: "connection_note",
                            confidence: 0.84,
                            title: "approval summary thread",
                            explanation: "Link the operator habit to the runbook fragment.",
                            memoryIds: ["mem-1", "mem-2"],
                            targetIds: [],
                            relationType: null,
                            query: null,
                            recommendation: null,
                        },
                    ],
                })}\n`, "utf8");
            }
            process.nextTick(() => {
                child.stdout.end();
                child.stderr.end();
                child.emit("close", 0);
            });
            return child.stdin;
        });
        return child;
    });
    try {
        const scout = (0, associationScout_1.createAssociationScoutFromEnv)({
            STUDIO_BRAIN_MEMORY_CONSOLIDATION_ASSOCIATION_SCOUT_ENABLED: "true",
            STUDIO_BRAIN_MEMORY_CONSOLIDATION_ASSOCIATION_SCOUT_PROVIDER: "codex-cli",
            STUDIO_BRAIN_MEMORY_CONSOLIDATION_ASSOCIATION_SCOUT_CODEX_EXECUTABLE: "codex",
            STUDIO_BRAIN_MEMORY_CONSOLIDATION_ASSOCIATION_SCOUT_CODEX_EXEC_ROOT: tempRoot,
            STUDIO_BRAIN_MEMORY_CONSOLIDATION_ASSOCIATION_SCOUT_MODEL: "gpt-5.4",
            STUDIO_BRAIN_MEMORY_CONSOLIDATION_ASSOCIATION_SCOUT_CODEX_REASONING_EFFORT: "low",
            CODEX_HOME: sourceCodexHome,
            OPENAI_API_KEY: "sk-platform-should-not-pass-through",
            STUDIO_BRAIN_OPENAI_API_KEY: "sk-studio-brain-should-not-pass-through",
        }, { spawnImpl: fakeSpawn });
        strict_1.default.ok(scout);
        const proposal = await scout?.scout(createBundle());
        strict_1.default.ok(proposal);
        strict_1.default.equal(proposal?.provider, "codex.exec");
        strict_1.default.equal(proposal?.model, "gpt-5.4");
        strict_1.default.equal(proposal?.intents[0]?.type, "connection_note");
        strict_1.default.equal(captured.command, "codex");
        strict_1.default.equal(captured.envOpenAiKey, undefined);
        strict_1.default.equal(captured.envStudioBrainKey, undefined);
        strict_1.default.notEqual(captured.childCodexHome, sourceCodexHome);
        strict_1.default.notEqual(captured.childHome, process.env.HOME ?? process.env.USERPROFILE ?? "");
        strict_1.default.match(String(captured.childAuthSnapshot || ""), /chatgpt-session/);
        strict_1.default.equal(Boolean(captured.prompt?.includes("\"bundleId\":\"bundle-1\"")), true);
        strict_1.default.equal(Boolean(captured.args?.includes("--output-schema")), true);
        strict_1.default.equal(Boolean(captured.args?.includes("-o")), true);
        strict_1.default.equal(Boolean(captured.args?.includes("-m")), true);
        strict_1.default.equal(Boolean(captured.args?.includes("mcp_servers.open_memory.enabled=false")), false);
        strict_1.default.equal(Boolean(captured.args?.includes("mcp_servers.studio-brain-memory.enabled=false")), false);
        strict_1.default.equal(Boolean(captured.schemaPath), true);
        strict_1.default.match(String(captured.schemaBody || ""), /followUpQueries/);
    }
    finally {
        (0, node_fs_1.rmSync)(tempRoot, { recursive: true, force: true });
    }
});
