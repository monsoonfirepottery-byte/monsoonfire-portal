"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.describeAssociationScoutEnv = describeAssociationScoutEnv;
exports.createAssociationScoutFromEnv = createAssociationScoutFromEnv;
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const zod_1 = require("zod");
const ASSOCIATION_SCOUT_REPO_ROOT = (0, node_path_1.resolve)(__dirname, "..", "..", "..");
const ASSOCIATION_SCOUT_REASONING_EFFORTS = new Set(["low", "medium", "high", "xhigh"]);
const LEGACY_API_ONLY_ASSOCIATION_SCOUT_MODELS = new Set(["gpt-4.1-mini"]);
const associationScoutIntentSchema = zod_1.z.object({
    type: zod_1.z.enum([
        "connection_note",
        "repair_edges",
        "promotion_candidate",
        "quarantine_candidate",
        "follow_up_query",
    ]),
    confidence: zod_1.z.number().min(0).max(1),
    title: zod_1.z.string().trim().min(1).max(160),
    explanation: zod_1.z.string().trim().min(1).max(400),
    memoryIds: zod_1.z.array(zod_1.z.string().trim().min(1).max(128)).min(1).max(12),
    targetIds: zod_1.z.array(zod_1.z.string().trim().min(1).max(128)).max(12).default([]),
    relationType: zod_1.z.string().trim().min(1).max(64).nullable().default(null),
    query: zod_1.z.string().trim().min(1).max(180).nullable().default(null),
    recommendation: zod_1.z.string().trim().min(1).max(240).nullable().default(null),
});
const associationScoutResponseSchema = zod_1.z.object({
    theme: zod_1.z.string().trim().min(1).max(160),
    summary: zod_1.z.string().trim().min(1).max(1_200),
    confidence: zod_1.z.number().min(0).max(1),
    contradictions: zod_1.z.array(zod_1.z.string().trim().min(1).max(240)).max(8).default([]),
    followUpQueries: zod_1.z.array(zod_1.z.string().trim().min(1).max(180)).max(8).default([]),
    intents: zod_1.z.array(associationScoutIntentSchema).max(16).default([]),
});
const ASSOCIATION_SCOUT_RESPONSE_JSON_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["theme", "summary", "confidence", "contradictions", "followUpQueries", "intents"],
    properties: {
        theme: { type: "string", minLength: 1, maxLength: 160 },
        summary: { type: "string", minLength: 1, maxLength: 1200 },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        contradictions: {
            type: "array",
            items: { type: "string", minLength: 1, maxLength: 240 },
            maxItems: 8,
        },
        followUpQueries: {
            type: "array",
            items: { type: "string", minLength: 1, maxLength: 180 },
            maxItems: 8,
        },
        intents: {
            type: "array",
            maxItems: 16,
            items: {
                type: "object",
                additionalProperties: false,
                required: [
                    "type",
                    "confidence",
                    "title",
                    "explanation",
                    "memoryIds",
                    "targetIds",
                    "relationType",
                    "query",
                    "recommendation",
                ],
                properties: {
                    type: {
                        type: "string",
                        enum: [
                            "connection_note",
                            "repair_edges",
                            "promotion_candidate",
                            "quarantine_candidate",
                            "follow_up_query",
                        ],
                    },
                    confidence: { type: "number", minimum: 0, maximum: 1 },
                    title: { type: "string", minLength: 1, maxLength: 160 },
                    explanation: { type: "string", minLength: 1, maxLength: 400 },
                    memoryIds: {
                        type: "array",
                        items: { type: "string", minLength: 1, maxLength: 128 },
                        minItems: 1,
                        maxItems: 12,
                    },
                    targetIds: {
                        type: "array",
                        items: { type: "string", minLength: 1, maxLength: 128 },
                        maxItems: 12,
                    },
                    relationType: {
                        anyOf: [
                            { type: "string", minLength: 1, maxLength: 64 },
                            { type: "null" },
                        ],
                    },
                    query: {
                        anyOf: [
                            { type: "string", minLength: 1, maxLength: 180 },
                            { type: "null" },
                        ],
                    },
                    recommendation: {
                        anyOf: [
                            { type: "string", minLength: 1, maxLength: 240 },
                            { type: "null" },
                        ],
                    },
                },
            },
        },
    },
};
function normalizeAssociationScoutProposal(parsed, provider, model) {
    return {
        theme: parsed.theme,
        summary: parsed.summary,
        confidence: parsed.confidence,
        contradictions: parsed.contradictions,
        followUpQueries: parsed.followUpQueries,
        intents: parsed.intents.map((intent) => ({
            type: intent.type,
            confidence: intent.confidence,
            title: intent.title,
            explanation: intent.explanation,
            memoryIds: intent.memoryIds,
            targetIds: intent.targetIds,
            relationType: intent.relationType ?? undefined,
            query: intent.query ?? undefined,
            recommendation: intent.recommendation ?? undefined,
        })),
        provider,
        model,
    };
}
function clean(value) {
    return String(value ?? "").trim();
}
function clip(value, max = 900) {
    const normalized = String(value ?? "").trim();
    if (normalized.length <= max)
        return normalized;
    return `${normalized.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}
function clampTimeout(value) {
    return Math.max(2_000, Math.min(Math.trunc(value), 120_000));
}
function defaultCodexExecutable() {
    return process.platform === "win32" ? "codex.cmd" : "codex";
}
function defaultCodexExecutionRoot() {
    if (process.platform === "win32") {
        return (0, node_path_1.resolve)(process.env.TEMP || process.env.TMP || ASSOCIATION_SCOUT_REPO_ROOT);
    }
    return "/tmp";
}
function resolveCodexHome(env = process.env) {
    const explicit = clean(env.CODEX_HOME);
    if (explicit)
        return (0, node_path_1.resolve)(explicit);
    const home = clean(env.HOME || env.USERPROFILE);
    if (!home)
        return "";
    return (0, node_path_1.resolve)(home, ".codex");
}
function prepareIsolatedCodexHome(tempRoot, env = process.env) {
    const sourceCodexHome = resolveCodexHome(env);
    if (!sourceCodexHome)
        return null;
    const authPath = (0, node_path_1.resolve)(sourceCodexHome, "auth.json");
    if (!(0, node_fs_1.existsSync)(authPath))
        return null;
    const homeRoot = (0, node_path_1.join)(tempRoot, "home");
    const isolatedCodexHome = (0, node_path_1.join)(homeRoot, ".codex");
    (0, node_fs_1.mkdirSync)(isolatedCodexHome, { recursive: true });
    (0, node_fs_1.copyFileSync)(authPath, (0, node_path_1.join)(isolatedCodexHome, "auth.json"));
    (0, node_fs_1.writeFileSync)((0, node_path_1.join)(isolatedCodexHome, "config.toml"), "", "utf8");
    return {
        codexHome: isolatedCodexHome,
        homeRoot,
    };
}
function resolveAssociationScoutProvider(env = process.env) {
    const normalized = clean(env.STUDIO_BRAIN_MEMORY_CONSOLIDATION_ASSOCIATION_SCOUT_PROVIDER).toLowerCase();
    if (normalized === "codex-cli" || normalized === "codex")
        return "codex-cli";
    if (normalized === "openai-api" || normalized === "openai" || normalized === "responses")
        return "openai-api";
    return "auto";
}
function resolveAssociationScoutApiKey(env = process.env) {
    const studioBrainApiKey = clean(env.STUDIO_BRAIN_OPENAI_API_KEY);
    if (studioBrainApiKey) {
        return {
            apiKey: studioBrainApiKey,
            apiKeySource: "STUDIO_BRAIN_OPENAI_API_KEY",
        };
    }
    const openAiApiKey = clean(env.OPENAI_API_KEY);
    if (openAiApiKey) {
        return {
            apiKey: openAiApiKey,
            apiKeySource: "OPENAI_API_KEY",
        };
    }
    return {
        apiKey: "",
        apiKeySource: null,
    };
}
function resolveAssociationScoutCodexExecutable(env = process.env) {
    return (clean(env.STUDIO_BRAIN_MEMORY_CONSOLIDATION_ASSOCIATION_SCOUT_CODEX_EXECUTABLE)
        || clean(env.STUDIO_BRAIN_DISCORD_CODEX_EXECUTABLE)
        || clean(env.CODEX_BIN_OVERRIDE)
        || defaultCodexExecutable());
}
function resolveAssociationScoutReasoningEffort(env = process.env) {
    const candidate = clean(env.STUDIO_BRAIN_MEMORY_CONSOLIDATION_ASSOCIATION_SCOUT_CODEX_REASONING_EFFORT
        || env.STUDIO_BRAIN_DISCORD_CODEX_REASONING_EFFORT
        || env.CODEX_REASONING_EFFORT).toLowerCase();
    if (ASSOCIATION_SCOUT_REASONING_EFFORTS.has(candidate)) {
        return candidate;
    }
    return "low";
}
function resolveAssociationScoutExecutionRoot(env = process.env) {
    const override = clean(env.STUDIO_BRAIN_MEMORY_CONSOLIDATION_ASSOCIATION_SCOUT_CODEX_EXEC_ROOT
        || env.STUDIO_BRAIN_DISCORD_CODEX_EXEC_ROOT
        || env.CODEX_EXEC_ROOT);
    return override ? (0, node_path_1.resolve)(override) : defaultCodexExecutionRoot();
}
function codexExecutableLooksPresent(command) {
    const normalized = clean(command);
    if (!normalized)
        return false;
    if (normalized.includes("/") || normalized.includes("\\")) {
        return (0, node_fs_1.existsSync)((0, node_path_1.resolve)(normalized));
    }
    return true;
}
function resolveAssociationScoutResolvedProvider(provider, env = process.env) {
    if (provider === "openai-api")
        return "openai-api";
    if (provider === "codex-cli")
        return "codex-cli";
    const codexExecutable = resolveAssociationScoutCodexExecutable(env);
    if (codexExecutableLooksPresent(codexExecutable))
        return "codex-cli";
    const { apiKey } = resolveAssociationScoutApiKey(env);
    if (apiKey)
        return "openai-api";
    return null;
}
function resolveAssociationScoutModel(env = process.env, resolvedProvider = resolveAssociationScoutResolvedProvider(resolveAssociationScoutProvider(env), env)) {
    const configured = clean(env.STUDIO_BRAIN_MEMORY_CONSOLIDATION_ASSOCIATION_SCOUT_MODEL);
    if (resolvedProvider === "codex-cli") {
        if (!configured || LEGACY_API_ONLY_ASSOCIATION_SCOUT_MODELS.has(configured)) {
            return (clean(env.STUDIO_BRAIN_DISCORD_CODEX_MODEL)
                || clean(env.CODEX_MODEL)
                || "gpt-5.4");
        }
        return configured;
    }
    return configured || "gpt-4.1-mini";
}
function buildScoutPrompt(bundle) {
    return [
        "You are Studio Brain's memory association scout for an offline dream cycle.",
        "Work only from the provided bundle. Never invent facts, IDs, people, incidents, or conclusions.",
        "Return JSON that matches the schema exactly.",
        "Do not use tools, shell commands, repo context, or web search.",
        "Your job is to surface associative changes and intent proposals, not to take actions.",
        "Use high confidence only when the evidence is explicit in the bundle.",
        "Intent guidance:",
        "- connection_note: propose a synthesized memory note tying together memories that belong in one readable thread.",
        "- repair_edges: propose one or more relationship edges between memories already in the bundle.",
        "- promotion_candidate: only when the bundle suggests durable knowledge, but do not assume authority.",
        "- quarantine_candidate: only when the bundle contains contradiction or loop-state tension.",
        "- follow_up_query: only when a focused retrieval query would likely deepen or verify the thread.",
        "Always cite memory IDs in intents. Keep explanations concrete and short.",
        "",
        `Bundle JSON: ${JSON.stringify(bundle)}`,
    ].join("\n");
}
function buildPromptInput(prompt) {
    return prompt.endsWith("\n") ? prompt : `${prompt}\n`;
}
function extractResponseText(payload) {
    const record = payload;
    if (typeof record?.output_text === "string" && record.output_text.trim()) {
        return record.output_text.trim();
    }
    for (const item of record?.output || []) {
        for (const part of item.content || []) {
            if (typeof part.text === "string" && part.text.trim()) {
                return part.text.trim();
            }
        }
    }
    return "";
}
function runProcess({ command, args, cwd, input = "", timeoutMs, spawnImpl = node_child_process_1.spawn, env = process.env, }) {
    return new Promise((resolvePromise, rejectPromise) => {
        let stdout = "";
        let stderr = "";
        let settled = false;
        const child = spawnImpl(command, args, {
            cwd,
            env,
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
            shell: process.platform === "win32",
        });
        const finish = (callback) => {
            if (settled)
                return;
            settled = true;
            if (timer) {
                clearTimeout(timer);
            }
            callback();
        };
        const timer = timeoutMs > 0
            ? setTimeout(() => {
                try {
                    child.kill("SIGTERM");
                }
                catch { }
                finish(() => rejectPromise(new Error(`association scout codex exec timed out after ${timeoutMs}ms.`)));
            }, timeoutMs)
            : null;
        child.stdout.on("data", (chunk) => {
            stdout += String(chunk);
        });
        child.stderr.on("data", (chunk) => {
            stderr += String(chunk);
        });
        child.on("error", (error) => {
            finish(() => rejectPromise(error));
        });
        child.on("close", (exitCode) => {
            const normalizedExitCode = typeof exitCode === "number" && Number.isFinite(exitCode) ? exitCode : 1;
            finish(() => resolvePromise({
                exitCode: normalizedExitCode,
                stdout,
                stderr,
            }));
        });
        child.stdin.end(buildPromptInput(input));
    });
}
function buildCodexExecArgs(input) {
    return [
        "exec",
        "--skip-git-repo-check",
        "--ephemeral",
        "--sandbox",
        "read-only",
        "--color",
        "never",
        "--disable",
        "apps",
        "--disable",
        "multi_agent",
        "--disable",
        "shell_snapshot",
        "-c",
        `model_reasoning_effort="${clean(input.reasoningEffort) || "low"}"`,
        "-c",
        "web_search=\"disabled\"",
        "-C",
        (0, node_path_1.resolve)(input.executionRoot || defaultCodexExecutionRoot()),
        "-m",
        clean(input.model) || "gpt-5.4",
        "--output-schema",
        (0, node_path_1.resolve)(input.schemaPath),
        "-o",
        (0, node_path_1.resolve)(input.outputPath),
        "-",
    ];
}
async function callOpenAiAssociationScout(input) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs);
    try {
        const response = await input.fetchImpl("https://api.openai.com/v1/responses", {
            method: "POST",
            headers: {
                authorization: `Bearer ${input.apiKey}`,
                "content-type": "application/json",
            },
            body: JSON.stringify({
                model: input.model,
                input: buildScoutPrompt(input.bundle),
                max_output_tokens: input.maxOutputTokens,
                text: {
                    format: {
                        type: "json_schema",
                        name: "studio_brain_association_scout",
                        strict: true,
                        schema: ASSOCIATION_SCOUT_RESPONSE_JSON_SCHEMA,
                    },
                },
            }),
            signal: controller.signal,
        });
        const responseText = await response.text();
        if (!response.ok) {
            throw new Error(`association scout failed (${response.status}): ${clip(responseText, 600)}`);
        }
        const payload = JSON.parse(responseText);
        const outputText = extractResponseText(payload);
        if (!outputText)
            return null;
        const parsed = associationScoutResponseSchema.parse(JSON.parse(outputText));
        return normalizeAssociationScoutProposal(parsed, "openai.responses", input.model);
    }
    finally {
        clearTimeout(timer);
    }
}
async function callCodexAssociationScout(input) {
    const tempRoot = (0, node_fs_1.mkdtempSync)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "studio-brain-association-scout-"));
    const schemaPath = (0, node_path_1.join)(tempRoot, "association-scout.schema.json");
    const outputPath = (0, node_path_1.join)(tempRoot, "association-scout-output.json");
    const prompt = buildScoutPrompt(input.bundle);
    const childEnv = { ...(input.env ?? process.env) };
    delete childEnv.OPENAI_API_KEY;
    delete childEnv.STUDIO_BRAIN_OPENAI_API_KEY;
    const isolatedCodexHome = prepareIsolatedCodexHome(tempRoot, childEnv);
    if (isolatedCodexHome) {
        childEnv.CODEX_HOME = isolatedCodexHome.codexHome;
        childEnv.HOME = isolatedCodexHome.homeRoot;
        childEnv.USERPROFILE = isolatedCodexHome.homeRoot;
        childEnv.XDG_CONFIG_HOME = isolatedCodexHome.homeRoot;
    }
    try {
        (0, node_fs_1.writeFileSync)(schemaPath, `${JSON.stringify(ASSOCIATION_SCOUT_RESPONSE_JSON_SCHEMA, null, 2)}\n`, "utf8");
        const result = await runProcess({
            command: input.codexExecutable,
            args: buildCodexExecArgs({
                executionRoot: input.executionRoot,
                model: input.model,
                outputPath,
                schemaPath,
                reasoningEffort: input.reasoningEffort,
            }),
            cwd: (0, node_path_1.resolve)(input.executionRoot || defaultCodexExecutionRoot()),
            input: prompt,
            timeoutMs: input.timeoutMs,
            spawnImpl: input.spawnImpl,
            env: childEnv,
        });
        if (result.exitCode !== 0) {
            throw new Error(clean(result.stderr || result.stdout)
                || `association scout codex exec failed (${result.exitCode}).`);
        }
        const outputText = (0, node_fs_1.existsSync)(outputPath) ? (0, node_fs_1.readFileSync)(outputPath, "utf8") : "";
        const normalized = clean(outputText);
        if (!normalized) {
            throw new Error(clean(result.stderr || result.stdout)
                || "association scout codex exec completed without a final JSON message.");
        }
        const parsed = associationScoutResponseSchema.parse(JSON.parse(normalized));
        return normalizeAssociationScoutProposal(parsed, "codex.exec", input.model);
    }
    finally {
        (0, node_fs_1.rmSync)(tempRoot, { recursive: true, force: true });
    }
}
function describeAssociationScoutEnv(env = process.env) {
    const enabled = !["0", "false", "no", "off"].includes(clean(env.STUDIO_BRAIN_MEMORY_CONSOLIDATION_ASSOCIATION_SCOUT_ENABLED).toLowerCase());
    const provider = resolveAssociationScoutProvider(env);
    const resolvedProvider = enabled ? resolveAssociationScoutResolvedProvider(provider, env) : null;
    const codexExecutable = resolveAssociationScoutCodexExecutable(env);
    const reasoningEffort = resolveAssociationScoutReasoningEffort(env);
    const executionRoot = resolveAssociationScoutExecutionRoot(env);
    const { apiKey, apiKeySource } = resolveAssociationScoutApiKey(env);
    const model = resolveAssociationScoutModel(env, resolvedProvider);
    const codexExecutablePresent = codexExecutableLooksPresent(codexExecutable);
    if (!enabled) {
        return {
            enabled,
            available: false,
            model,
            provider,
            resolvedProvider: null,
            apiKeySource,
            codexExecutable: codexExecutable || null,
            reasoningEffort,
            executionRoot,
            reason: "disabled",
        };
    }
    if (resolvedProvider === "codex-cli") {
        return {
            enabled,
            available: codexExecutablePresent,
            model,
            provider,
            resolvedProvider,
            apiKeySource,
            codexExecutable: codexExecutable || null,
            reasoningEffort,
            executionRoot,
            reason: codexExecutablePresent ? null : "missing-codex-executable",
        };
    }
    if (resolvedProvider === "openai-api") {
        return {
            enabled,
            available: Boolean(apiKey),
            model,
            provider,
            resolvedProvider,
            apiKeySource,
            codexExecutable: codexExecutable || null,
            reasoningEffort,
            executionRoot,
            reason: apiKey ? null : "missing-api-key",
        };
    }
    return {
        enabled,
        available: false,
        model,
        provider,
        resolvedProvider,
        apiKeySource,
        codexExecutable: codexExecutable || null,
        reasoningEffort,
        executionRoot,
        reason: provider === "codex-cli"
            ? "missing-codex-executable"
            : provider === "openai-api"
                ? "missing-api-key"
                : "missing-provider-credentials",
    };
}
function createAssociationScoutFromEnv(env = process.env, options = {}) {
    const availability = describeAssociationScoutEnv(env);
    const { apiKey } = resolveAssociationScoutApiKey(env);
    const timeoutMs = clampTimeout(Number(env.STUDIO_BRAIN_MEMORY_CONSOLIDATION_ASSOCIATION_SCOUT_TIMEOUT_MS ?? "60000") || 60_000);
    const maxOutputTokens = Math.max(400, Math.min(4_000, Number(env.STUDIO_BRAIN_MEMORY_CONSOLIDATION_ASSOCIATION_SCOUT_MAX_OUTPUT_TOKENS ?? "1400") || 1_400));
    const fetchImpl = options.fetchImpl ?? fetch;
    const spawnImpl = options.spawnImpl ?? node_child_process_1.spawn;
    if (!availability.available || !availability.resolvedProvider) {
        return null;
    }
    if (availability.resolvedProvider === "codex-cli") {
        return {
            async scout(bundle) {
                if (!bundle.rows.length)
                    return null;
                return await callCodexAssociationScout({
                    bundle,
                    model: availability.model,
                    timeoutMs,
                    codexExecutable: availability.codexExecutable || defaultCodexExecutable(),
                    executionRoot: availability.executionRoot || defaultCodexExecutionRoot(),
                    reasoningEffort: availability.reasoningEffort,
                    spawnImpl,
                    env,
                });
            },
        };
    }
    if (!apiKey) {
        return null;
    }
    return {
        async scout(bundle) {
            if (!bundle.rows.length)
                return null;
            return await callOpenAiAssociationScout({
                bundle,
                apiKey,
                model: availability.model,
                timeoutMs,
                maxOutputTokens,
                fetchImpl,
            });
        },
    };
}
