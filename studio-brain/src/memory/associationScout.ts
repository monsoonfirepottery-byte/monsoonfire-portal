import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";

const ASSOCIATION_SCOUT_REPO_ROOT = resolve(__dirname, "..", "..", "..");
const ASSOCIATION_SCOUT_REASONING_EFFORTS = new Set(["low", "medium", "high", "xhigh"]);
const LEGACY_API_ONLY_ASSOCIATION_SCOUT_MODELS = new Set(["gpt-4.1-mini"]);

export type AssociationScoutIntentType =
  | "connection_note"
  | "repair_edges"
  | "promotion_candidate"
  | "quarantine_candidate"
  | "follow_up_query";

export type AssociationScoutIntent = {
  type: AssociationScoutIntentType;
  confidence: number;
  title: string;
  explanation: string;
  memoryIds: string[];
  targetIds: string[];
  relationType?: string;
  query?: string;
  recommendation?: string;
};

export type AssociationScoutBundleRow = {
  id: string;
  source: string;
  memoryLayer: "working" | "episodic" | "canonical";
  status: "proposed" | "accepted" | "quarantined" | "archived";
  content: string;
  sourceConfidence: number;
  importance: number;
  occurredAt?: string | null;
  tags: string[];
  metadata: {
    subjectKey?: string | null;
    threadKey?: string | null;
    loopKey?: string | null;
    lineageKey?: string | null;
    entityHints: string[];
    patternHints: string[];
  };
};

export type AssociationScoutBundle = {
  runId: string;
  mode: "idle" | "overnight";
  bundleId: string;
  bundleType: "hard-cluster" | "theme-cluster" | "synthesis-bundle";
  themeType: string;
  themeKey: string;
  recallPass?: "initial" | "second-pass";
  originatingBundleId?: string | null;
  replayQueries?: string[];
  focusAreas: string[];
  rows: AssociationScoutBundleRow[];
};

export type AssociationScoutProposal = {
  theme: string;
  summary: string;
  confidence: number;
  contradictions: string[];
  followUpQueries: string[];
  intents: AssociationScoutIntent[];
  provider: string;
  model: string;
};

export type AssociationScout = {
  scout: (bundle: AssociationScoutBundle) => Promise<AssociationScoutProposal | null>;
};

export type AssociationScoutProvider = "auto" | "codex-cli" | "openai-api";
export type AssociationScoutResolvedProvider = "codex-cli" | "openai-api" | null;
export type AssociationScoutApiKeySource = "STUDIO_BRAIN_OPENAI_API_KEY" | "OPENAI_API_KEY" | null;
export type AssociationScoutReasoningEffort = "low" | "medium" | "high" | "xhigh";
export type AssociationScoutAvailabilityReason =
  | "disabled"
  | "missing-api-key"
  | "missing-codex-executable"
  | "missing-provider-credentials"
  | null;

export type AssociationScoutAvailability = {
  enabled: boolean;
  available: boolean;
  model: string;
  provider: AssociationScoutProvider;
  resolvedProvider: AssociationScoutResolvedProvider;
  apiKeySource: AssociationScoutApiKeySource;
  codexExecutable: string | null;
  reasoningEffort: AssociationScoutReasoningEffort;
  executionRoot: string | null;
  reason: AssociationScoutAvailabilityReason;
};

type AssociationScoutRuntimeOptions = {
  fetchImpl?: typeof fetch;
  spawnImpl?: typeof spawn;
};

type ProcessResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

const associationScoutIntentSchema = z.object({
  type: z.enum([
    "connection_note",
    "repair_edges",
    "promotion_candidate",
    "quarantine_candidate",
    "follow_up_query",
  ]),
  confidence: z.number().min(0).max(1),
  title: z.string().trim().min(1).max(160),
  explanation: z.string().trim().min(1).max(400),
  memoryIds: z.array(z.string().trim().min(1).max(128)).min(1).max(12),
  targetIds: z.array(z.string().trim().min(1).max(128)).max(12).default([]),
  relationType: z.string().trim().min(1).max(64).nullable().default(null),
  query: z.string().trim().min(1).max(180).nullable().default(null),
  recommendation: z.string().trim().min(1).max(240).nullable().default(null),
});

const associationScoutResponseSchema = z.object({
  theme: z.string().trim().min(1).max(160),
  summary: z.string().trim().min(1).max(1_200),
  confidence: z.number().min(0).max(1),
  contradictions: z.array(z.string().trim().min(1).max(240)).max(8).default([]),
  followUpQueries: z.array(z.string().trim().min(1).max(180)).max(8).default([]),
  intents: z.array(associationScoutIntentSchema).max(16).default([]),
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
} as const;

function normalizeAssociationScoutProposal(
  parsed: z.infer<typeof associationScoutResponseSchema>,
  provider: string,
  model: string,
): AssociationScoutProposal {
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

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function clip(value: unknown, max = 900): string {
  const normalized = String(value ?? "").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

function clampTimeout(value: number): number {
  return Math.max(2_000, Math.min(Math.trunc(value), 120_000));
}

function defaultCodexExecutable(): string {
  return process.platform === "win32" ? "codex.cmd" : "codex";
}

function defaultCodexExecutionRoot(): string {
  if (process.platform === "win32") {
    return resolve(process.env.TEMP || process.env.TMP || ASSOCIATION_SCOUT_REPO_ROOT);
  }
  return "/tmp";
}

function resolveCodexHome(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = clean(env.CODEX_HOME);
  if (explicit) return resolve(explicit);
  const home = clean(env.HOME || env.USERPROFILE);
  if (!home) return "";
  return resolve(home, ".codex");
}

function prepareIsolatedCodexHome(
  tempRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): { codexHome: string; homeRoot: string } | null {
  const sourceCodexHome = resolveCodexHome(env);
  if (!sourceCodexHome) return null;
  const authPath = resolve(sourceCodexHome, "auth.json");
  if (!existsSync(authPath)) return null;
  const homeRoot = join(tempRoot, "home");
  const isolatedCodexHome = join(homeRoot, ".codex");
  mkdirSync(isolatedCodexHome, { recursive: true });
  copyFileSync(authPath, join(isolatedCodexHome, "auth.json"));
  writeFileSync(join(isolatedCodexHome, "config.toml"), "", "utf8");
  return {
    codexHome: isolatedCodexHome,
    homeRoot,
  };
}

function resolveAssociationScoutProvider(env: NodeJS.ProcessEnv = process.env): AssociationScoutProvider {
  const normalized = clean(env.STUDIO_BRAIN_MEMORY_CONSOLIDATION_ASSOCIATION_SCOUT_PROVIDER).toLowerCase();
  if (normalized === "codex-cli" || normalized === "codex") return "codex-cli";
  if (normalized === "openai-api" || normalized === "openai" || normalized === "responses") return "openai-api";
  return "auto";
}

function resolveAssociationScoutApiKey(
  env: NodeJS.ProcessEnv = process.env,
): {
  apiKey: string;
  apiKeySource: AssociationScoutApiKeySource;
} {
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

function resolveAssociationScoutCodexExecutable(env: NodeJS.ProcessEnv = process.env): string {
  return (
    clean(env.STUDIO_BRAIN_MEMORY_CONSOLIDATION_ASSOCIATION_SCOUT_CODEX_EXECUTABLE)
    || clean(env.STUDIO_BRAIN_DISCORD_CODEX_EXECUTABLE)
    || clean(env.CODEX_BIN_OVERRIDE)
    || defaultCodexExecutable()
  );
}

function resolveAssociationScoutReasoningEffort(
  env: NodeJS.ProcessEnv = process.env,
): AssociationScoutReasoningEffort {
  const candidate = clean(
    env.STUDIO_BRAIN_MEMORY_CONSOLIDATION_ASSOCIATION_SCOUT_CODEX_REASONING_EFFORT
      || env.STUDIO_BRAIN_DISCORD_CODEX_REASONING_EFFORT
      || env.CODEX_REASONING_EFFORT,
  ).toLowerCase();
  if (ASSOCIATION_SCOUT_REASONING_EFFORTS.has(candidate)) {
    return candidate as AssociationScoutReasoningEffort;
  }
  return "low";
}

function resolveAssociationScoutExecutionRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = clean(
    env.STUDIO_BRAIN_MEMORY_CONSOLIDATION_ASSOCIATION_SCOUT_CODEX_EXEC_ROOT
      || env.STUDIO_BRAIN_DISCORD_CODEX_EXEC_ROOT
      || env.CODEX_EXEC_ROOT,
  );
  return override ? resolve(override) : defaultCodexExecutionRoot();
}

function codexExecutableLooksPresent(command: string): boolean {
  const normalized = clean(command);
  if (!normalized) return false;
  if (normalized.includes("/") || normalized.includes("\\")) {
    return existsSync(resolve(normalized));
  }
  return true;
}

function resolveAssociationScoutResolvedProvider(
  provider: AssociationScoutProvider,
  env: NodeJS.ProcessEnv = process.env,
): AssociationScoutResolvedProvider {
  if (provider === "openai-api") return "openai-api";
  if (provider === "codex-cli") return "codex-cli";
  const codexExecutable = resolveAssociationScoutCodexExecutable(env);
  if (codexExecutableLooksPresent(codexExecutable)) return "codex-cli";
  const { apiKey } = resolveAssociationScoutApiKey(env);
  if (apiKey) return "openai-api";
  return null;
}

function resolveAssociationScoutModel(
  env: NodeJS.ProcessEnv = process.env,
  resolvedProvider: AssociationScoutResolvedProvider = resolveAssociationScoutResolvedProvider(
    resolveAssociationScoutProvider(env),
    env,
  ),
): string {
  const configured = clean(env.STUDIO_BRAIN_MEMORY_CONSOLIDATION_ASSOCIATION_SCOUT_MODEL);
  if (resolvedProvider === "codex-cli") {
    if (!configured || LEGACY_API_ONLY_ASSOCIATION_SCOUT_MODELS.has(configured)) {
      return (
        clean(env.STUDIO_BRAIN_DISCORD_CODEX_MODEL)
        || clean(env.CODEX_MODEL)
        || "gpt-5.4"
      );
    }
    return configured;
  }
  return configured || "gpt-4.1-mini";
}

function buildScoutPrompt(bundle: AssociationScoutBundle): string {
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

function buildPromptInput(prompt: string): string {
  return prompt.endsWith("\n") ? prompt : `${prompt}\n`;
}

function extractResponseText(payload: unknown): string {
  const record = payload as {
    output_text?: unknown;
    output?: Array<{ content?: Array<{ text?: string; type?: string }> }>;
  };
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

function runProcess(
  {
    command,
    args,
    cwd,
    input = "",
    timeoutMs,
    spawnImpl = spawn,
    env = process.env,
  }: {
    command: string;
    args: string[];
    cwd: string;
    input?: string;
    timeoutMs: number;
    spawnImpl?: typeof spawn;
    env?: NodeJS.ProcessEnv;
  },
): Promise<ProcessResult> {
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

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      callback();
    };

    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            try {
              child.kill("SIGTERM");
            } catch {}
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
      finish(() =>
        resolvePromise({
          exitCode: normalizedExitCode,
          stdout,
          stderr,
        }),
      );
    });
    child.stdin.end(buildPromptInput(input));
  });
}

function buildCodexExecArgs(input: {
  executionRoot: string;
  model: string;
  outputPath: string;
  schemaPath: string;
  reasoningEffort: AssociationScoutReasoningEffort;
}): string[] {
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
    resolve(input.executionRoot || defaultCodexExecutionRoot()),
    "-m",
    clean(input.model) || "gpt-5.4",
    "--output-schema",
    resolve(input.schemaPath),
    "-o",
    resolve(input.outputPath),
    "-",
  ];
}

async function callOpenAiAssociationScout(input: {
  bundle: AssociationScoutBundle;
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxOutputTokens: number;
  fetchImpl: typeof fetch;
}): Promise<AssociationScoutProposal | null> {
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
    const payload = JSON.parse(responseText) as unknown;
    const outputText = extractResponseText(payload);
    if (!outputText) return null;
    const parsed = associationScoutResponseSchema.parse(JSON.parse(outputText));
    return normalizeAssociationScoutProposal(parsed, "openai.responses", input.model);
  } finally {
    clearTimeout(timer);
  }
}

async function callCodexAssociationScout(input: {
  bundle: AssociationScoutBundle;
  model: string;
  timeoutMs: number;
  codexExecutable: string;
  executionRoot: string;
  reasoningEffort: AssociationScoutReasoningEffort;
  spawnImpl: typeof spawn;
  env?: NodeJS.ProcessEnv;
}): Promise<AssociationScoutProposal | null> {
  const tempRoot = mkdtempSync(join(tmpdir(), "studio-brain-association-scout-"));
  const schemaPath = join(tempRoot, "association-scout.schema.json");
  const outputPath = join(tempRoot, "association-scout-output.json");
  const prompt = buildScoutPrompt(input.bundle);
  const childEnv: NodeJS.ProcessEnv = { ...(input.env ?? process.env) };
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
    writeFileSync(schemaPath, `${JSON.stringify(ASSOCIATION_SCOUT_RESPONSE_JSON_SCHEMA, null, 2)}\n`, "utf8");
    const result = await runProcess({
      command: input.codexExecutable,
      args: buildCodexExecArgs({
        executionRoot: input.executionRoot,
        model: input.model,
        outputPath,
        schemaPath,
        reasoningEffort: input.reasoningEffort,
      }),
      cwd: resolve(input.executionRoot || defaultCodexExecutionRoot()),
      input: prompt,
      timeoutMs: input.timeoutMs,
      spawnImpl: input.spawnImpl,
      env: childEnv,
    });
    if (result.exitCode !== 0) {
      throw new Error(
        clean(result.stderr || result.stdout)
          || `association scout codex exec failed (${result.exitCode}).`,
      );
    }
    const outputText = existsSync(outputPath) ? readFileSync(outputPath, "utf8") : "";
    const normalized = clean(outputText);
    if (!normalized) {
      throw new Error(
        clean(result.stderr || result.stdout)
          || "association scout codex exec completed without a final JSON message.",
      );
    }
    const parsed = associationScoutResponseSchema.parse(JSON.parse(normalized));
    return normalizeAssociationScoutProposal(parsed, "codex.exec", input.model);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

export function describeAssociationScoutEnv(
  env: NodeJS.ProcessEnv = process.env,
): AssociationScoutAvailability {
  const enabled = !["0", "false", "no", "off"].includes(
    clean(env.STUDIO_BRAIN_MEMORY_CONSOLIDATION_ASSOCIATION_SCOUT_ENABLED).toLowerCase(),
  );
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
    reason:
      provider === "codex-cli"
        ? "missing-codex-executable"
        : provider === "openai-api"
          ? "missing-api-key"
          : "missing-provider-credentials",
  };
}

export function createAssociationScoutFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  options: AssociationScoutRuntimeOptions = {},
): AssociationScout | null {
  const availability = describeAssociationScoutEnv(env);
  const { apiKey } = resolveAssociationScoutApiKey(env);
  const timeoutMs = clampTimeout(
    Number(env.STUDIO_BRAIN_MEMORY_CONSOLIDATION_ASSOCIATION_SCOUT_TIMEOUT_MS ?? "60000") || 60_000,
  );
  const maxOutputTokens = Math.max(
    400,
    Math.min(
      4_000,
      Number(env.STUDIO_BRAIN_MEMORY_CONSOLIDATION_ASSOCIATION_SCOUT_MAX_OUTPUT_TOKENS ?? "1400") || 1_400,
    ),
  );
  const fetchImpl = options.fetchImpl ?? fetch;
  const spawnImpl = options.spawnImpl ?? spawn;

  if (!availability.available || !availability.resolvedProvider) {
    return null;
  }

  if (availability.resolvedProvider === "codex-cli") {
    return {
      async scout(bundle: AssociationScoutBundle): Promise<AssociationScoutProposal | null> {
        if (!bundle.rows.length) return null;
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
    async scout(bundle: AssociationScoutBundle): Promise<AssociationScoutProposal | null> {
      if (!bundle.rows.length) return null;
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
