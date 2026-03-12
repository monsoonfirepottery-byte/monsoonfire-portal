import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const REPO_ROOT = resolve(__dirname, "..", "..");
export const DEFAULT_CONFIG_PATH = "config/codex-automation-budget.json";
export const DEFAULT_STATE_PATH = "output/codex-automation/control-state.json";
export const DEFAULT_REPORT_DIR = "output/intent/codex-procs";

const DEFAULT_CONFIG = {
  schema: "codex-automation-budget.v1",
  defaults: {
    paused: true,
    failClosed: true,
    cooldownMinutesOnQuotaFailure: 720,
    quotaFailurePauseThreshold: 1,
    quotaFailureWindowHours: 24,
    maxRunsPerDay: 0,
  },
  models: {
    "gpt-5.3-codex-spark": {
      automationEnabled: false,
      maxRunsPerDay: 0,
    },
  },
  launchers: {
    "intent-codex-proc": {
      enabled: false,
      paused: true,
      maxRunsPerDay: 0,
    },
    "monsoonfire-overnight.service": {
      enabled: false,
      paused: true,
      maxRunsPerDay: 0,
    },
  },
};

const DEFAULT_STATE = {
  schema: "codex-automation-state.v1",
  updatedAt: null,
  globalPause: {
    active: false,
    reason: "",
    note: "",
    at: null,
  },
  quotaCooldowns: {},
  events: [],
};

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function truncate(value, max = 400) {
  const text = String(value || "");
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...<truncated ${text.length - max} chars>`;
}

function safeReadJson(absolutePath, fallback) {
  if (!existsSync(absolutePath)) {
    return cloneJson(fallback);
  }
  try {
    return JSON.parse(readFileSync(absolutePath, "utf8"));
  } catch {
    return cloneJson(fallback);
  }
}

function mergeConfig(raw) {
  return {
    ...cloneJson(DEFAULT_CONFIG),
    ...(raw && typeof raw === "object" ? raw : {}),
    defaults: {
      ...cloneJson(DEFAULT_CONFIG.defaults),
      ...(raw?.defaults && typeof raw.defaults === "object" ? raw.defaults : {}),
    },
    models: {
      ...cloneJson(DEFAULT_CONFIG.models),
      ...(raw?.models && typeof raw.models === "object" ? raw.models : {}),
    },
    launchers: {
      ...cloneJson(DEFAULT_CONFIG.launchers),
      ...(raw?.launchers && typeof raw.launchers === "object" ? raw.launchers : {}),
    },
  };
}

function mergeState(raw) {
  return {
    ...cloneJson(DEFAULT_STATE),
    ...(raw && typeof raw === "object" ? raw : {}),
    globalPause: {
      ...cloneJson(DEFAULT_STATE.globalPause),
      ...(raw?.globalPause && typeof raw.globalPause === "object" ? raw.globalPause : {}),
    },
    quotaCooldowns: raw?.quotaCooldowns && typeof raw.quotaCooldowns === "object" ? raw.quotaCooldowns : {},
    events: Array.isArray(raw?.events) ? raw.events : [],
  };
}

export function resolveRepoPath(pathValue, fallback) {
  return resolve(REPO_ROOT, String(pathValue || fallback || ""));
}

export function loadAutomationConfig(configPath = DEFAULT_CONFIG_PATH) {
  const absolutePath = resolveRepoPath(configPath, DEFAULT_CONFIG_PATH);
  const config = mergeConfig(safeReadJson(absolutePath, DEFAULT_CONFIG));
  return { absolutePath, config };
}

export function loadAutomationState(statePath = DEFAULT_STATE_PATH) {
  const absolutePath = resolveRepoPath(statePath, DEFAULT_STATE_PATH);
  const state = mergeState(safeReadJson(absolutePath, DEFAULT_STATE));
  return { absolutePath, state };
}

export function saveAutomationState(state, statePath = DEFAULT_STATE_PATH) {
  const absolutePath = resolveRepoPath(statePath, DEFAULT_STATE_PATH);
  mkdirSync(dirname(absolutePath), { recursive: true });
  const normalized = mergeState(state);
  normalized.updatedAt = new Date().toISOString();
  writeFileSync(absolutePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return { absolutePath, state: normalized };
}

function normalizeId(value, fallback = "default") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function toDate(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  return Number.isFinite(date.getTime()) ? date : new Date();
}

function toIso(value) {
  return toDate(value).toISOString();
}

function utcDayKey(value) {
  return toIso(value).slice(0, 10);
}

function cooldownKey(launcher, model) {
  return `${normalizeId(launcher)}::${normalizeId(model)}`;
}

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const parsed = toFiniteNumber(value);
    if (parsed != null) return parsed;
  }
  return null;
}

function isActiveCooldown(entry, now) {
  if (!entry || typeof entry !== "object") return false;
  if (entry.active === false) return false;
  const until = Date.parse(String(entry.until || ""));
  return Number.isFinite(until) && until > toDate(now).getTime();
}

export function listCodexProcReports(reportDir = DEFAULT_REPORT_DIR) {
  const absoluteDir = resolveRepoPath(reportDir, DEFAULT_REPORT_DIR);
  if (!existsSync(absoluteDir)) return [];
  const files = readdirSync(absoluteDir)
    .filter((entry) => entry.endsWith(".report.json"))
    .sort();

  const reports = [];
  for (const file of files) {
    const absolutePath = resolve(absoluteDir, file);
    try {
      const parsed = JSON.parse(readFileSync(absolutePath, "utf8"));
      reports.push({
        ...parsed,
        _absolutePath: absolutePath,
        _relativePath: relative(REPO_ROOT, absolutePath).replaceAll("\\", "/"),
      });
    } catch {
      // Ignore malformed historical artifacts so the control plane stays usable.
    }
  }
  return reports;
}

export function isQuotaFailureText(text) {
  return /(429|rate limit|quota exceeded|resource exhausted|usage limit)/i.test(String(text || ""));
}

function countRunsToday(reports, launcher, model, now) {
  const dayKey = utcDayKey(now);
  return reports.filter((report) => {
    const reportDay = utcDayKey(report.generatedAt || report.generated_at || Date.now());
    if (reportDay !== dayKey) return false;
    const reportLauncher = normalizeId(report?.automation?.launcher || report?.launcher || "intent-codex-proc");
    const reportModel = normalizeId(report?.model);
    if (reportLauncher !== normalizeId(launcher)) return false;
    if (model && reportModel !== normalizeId(model)) return false;
    return true;
  }).length;
}

function pruneState(state, now, windowHours) {
  const cutoff = toDate(now).getTime() - Math.max(1, windowHours) * 60 * 60 * 1000;
  const events = Array.isArray(state.events) ? state.events : [];
  state.events = events
    .filter((entry) => {
      const stamp = Date.parse(String(entry?.at || ""));
      return Number.isFinite(stamp) && stamp >= cutoff;
    })
    .slice(-250);

  for (const [key, value] of Object.entries(state.quotaCooldowns || {})) {
    if (!isActiveCooldown(value, now)) {
      delete state.quotaCooldowns[key];
    }
  }
}

export function evaluateAutomationGate({
  launcher = "intent-codex-proc",
  model = "",
  automated = true,
  now = new Date(),
  configPath = DEFAULT_CONFIG_PATH,
  statePath = DEFAULT_STATE_PATH,
  reportDir = DEFAULT_REPORT_DIR,
} = {}) {
  const normalizedLauncher = normalizeId(launcher, "intent-codex-proc");
  const normalizedModel = String(model || "").trim();
  const { absolutePath: configAbsolutePath, config } = loadAutomationConfig(configPath);
  const { absolutePath: stateAbsolutePath, state } = loadAutomationState(statePath);
  pruneState(state, now, Number(config?.defaults?.quotaFailureWindowHours || 24) || 24);

  const launcherRule =
    config?.launchers?.[normalizedLauncher] && typeof config.launchers[normalizedLauncher] === "object"
      ? config.launchers[normalizedLauncher]
      : {};
  const modelRule =
    normalizedModel && config?.models?.[normalizedModel] && typeof config.models[normalizedModel] === "object"
      ? config.models[normalizedModel]
      : {};
  const reports = automated ? listCodexProcReports(reportDir) : [];
  const runsToday = automated ? countRunsToday(reports, normalizedLauncher, normalizedModel, now) : 0;
  const maxRunsPerDay = firstFiniteNumber(
    launcherRule.maxRunsPerDay,
    modelRule.maxRunsPerDay,
    config?.defaults?.maxRunsPerDay,
    0
  );
  const cooldown = state.quotaCooldowns?.[cooldownKey(normalizedLauncher, normalizedModel)] || null;

  let allowed = true;
  let reasonCode = "allowed";
  let reason = "Automation gate passed.";
  let source = "none";

  if (!automated) {
    reasonCode = "manual_invocation";
    reason = "Manual invocation is not blocked by automation guardrails.";
  } else if (config?.defaults?.paused) {
    allowed = false;
    reasonCode = "config_global_paused";
    reason = "Global automation pause is enabled in config/codex-automation-budget.json.";
    source = "config.defaults.paused";
  } else if (state?.globalPause?.active) {
    allowed = false;
    reasonCode = "state_global_pause";
    reason = state.globalPause.note || "Automation is paused by persisted runtime state.";
    source = "state.globalPause";
  } else if (launcherRule.enabled === false) {
    allowed = false;
    reasonCode = "launcher_disabled";
    reason = `${normalizedLauncher} is disabled in codex automation config.`;
    source = `config.launchers.${normalizedLauncher}.enabled`;
  } else if (launcherRule.paused) {
    allowed = false;
    reasonCode = "launcher_paused";
    reason = `${normalizedLauncher} is paused in codex automation config.`;
    source = `config.launchers.${normalizedLauncher}.paused`;
  } else if (normalizedModel && modelRule.automationEnabled === false) {
    allowed = false;
    reasonCode = "model_blocked";
    reason = `${normalizedModel} is blocked for unattended automation.`;
    source = `config.models.${normalizedModel}.automationEnabled`;
  } else if (Array.isArray(launcherRule.allowedModels) && launcherRule.allowedModels.length > 0 && !launcherRule.allowedModels.includes(normalizedModel)) {
    allowed = false;
    reasonCode = "model_not_allowlisted";
    reason = `${normalizedModel || "(default model)"} is not allowlisted for ${normalizedLauncher}.`;
    source = `config.launchers.${normalizedLauncher}.allowedModels`;
  } else if (isActiveCooldown(cooldown, now)) {
    allowed = false;
    reasonCode = "quota_cooldown";
    reason = `Quota cooldown remains active until ${cooldown.until}.`;
    source = `state.quotaCooldowns.${cooldownKey(normalizedLauncher, normalizedModel)}`;
  } else if (maxRunsPerDay != null && maxRunsPerDay > 0 && runsToday >= maxRunsPerDay) {
    allowed = false;
    reasonCode = "daily_run_budget_exceeded";
    reason = `Daily automation budget reached for ${normalizedLauncher} (${runsToday}/${maxRunsPerDay}).`;
    source = "daily-run-budget";
  }

  return {
    schema: "codex-automation-gate.v1",
    generatedAt: new Date().toISOString(),
    allowed,
    automated,
    launcher: normalizedLauncher,
    model: normalizedModel || null,
    reasonCode,
    reason,
    source,
    counts: {
      runsToday,
      maxRunsPerDay,
    },
    cooldown: cooldown && isActiveCooldown(cooldown, now) ? cooldown : null,
    paths: {
      configPath: relative(REPO_ROOT, configAbsolutePath).replaceAll("\\", "/"),
      statePath: relative(REPO_ROOT, stateAbsolutePath).replaceAll("\\", "/"),
      reportDir: relative(REPO_ROOT, resolveRepoPath(reportDir, DEFAULT_REPORT_DIR)).replaceAll("\\", "/"),
    },
  };
}

export function setAutomationPause({
  active = true,
  reason = "manual_pause",
  note = "",
  statePath = DEFAULT_STATE_PATH,
  at = new Date().toISOString(),
} = {}) {
  const { state } = loadAutomationState(statePath);
  state.globalPause = {
    active: Boolean(active),
    reason: String(reason || (active ? "manual_pause" : "manual_resume")),
    note: String(note || ""),
    at: toIso(at),
  };
  state.events = Array.isArray(state.events) ? state.events : [];
  state.events.push({
    at: toIso(at),
    type: active ? "manual_pause" : "manual_resume",
    reason: String(reason || ""),
    note: String(note || ""),
  });
  return saveAutomationState(state, statePath);
}

export function recordAutomationQuotaFailure({
  launcher = "intent-codex-proc",
  model = "",
  message = "",
  observedAt = new Date().toISOString(),
  configPath = DEFAULT_CONFIG_PATH,
  statePath = DEFAULT_STATE_PATH,
} = {}) {
  const normalizedLauncher = normalizeId(launcher, "intent-codex-proc");
  const normalizedModel = String(model || "").trim();
  const { config } = loadAutomationConfig(configPath);
  const { state } = loadAutomationState(statePath);

  const launcherRule =
    config?.launchers?.[normalizedLauncher] && typeof config.launchers[normalizedLauncher] === "object"
      ? config.launchers[normalizedLauncher]
      : {};
  const modelRule =
    normalizedModel && config?.models?.[normalizedModel] && typeof config.models[normalizedModel] === "object"
      ? config.models[normalizedModel]
      : {};
  const cooldownMinutes = Math.max(
    0,
    firstFiniteNumber(
      launcherRule.cooldownMinutesOnQuotaFailure,
      modelRule.cooldownMinutesOnQuotaFailure,
      config?.defaults?.cooldownMinutesOnQuotaFailure,
      0
    ) || 0
  );
  const windowHours = Math.max(
    1,
    firstFiniteNumber(
      launcherRule.quotaFailureWindowHours,
      modelRule.quotaFailureWindowHours,
      config?.defaults?.quotaFailureWindowHours,
      24
    ) || 24
  );
  const pauseThreshold = Math.max(
    0,
    firstFiniteNumber(
      launcherRule.quotaFailurePauseThreshold,
      modelRule.quotaFailurePauseThreshold,
      config?.defaults?.quotaFailurePauseThreshold,
      0
    ) || 0
  );

  pruneState(state, observedAt, windowHours);

  const until = new Date(toDate(observedAt).getTime() + cooldownMinutes * 60 * 1000).toISOString();
  const key = cooldownKey(normalizedLauncher, normalizedModel);
  state.quotaCooldowns[key] = {
    active: cooldownMinutes > 0,
    launcher: normalizedLauncher,
    model: normalizedModel || null,
    observedAt: toIso(observedAt),
    until,
    reason: "quota_failure",
    message: truncate(message, 600),
  };

  state.events = Array.isArray(state.events) ? state.events : [];
  state.events.push({
    at: toIso(observedAt),
    type: "quota_failure",
    launcher: normalizedLauncher,
    model: normalizedModel || null,
    message: truncate(message, 600),
  });
  pruneState(state, observedAt, windowHours);

  const recentQuotaFailureCount = state.events.filter((entry) => entry?.type === "quota_failure").length;
  if (pauseThreshold > 0 && recentQuotaFailureCount >= pauseThreshold) {
    state.globalPause = {
      active: true,
      reason: "quota_tripwire",
      note: `Paused after ${recentQuotaFailureCount} quota failures within ${windowHours}h.`,
      at: toIso(observedAt),
    };
  }

  const saved = saveAutomationState(state, statePath);
  return {
    schema: "codex-automation-quota-failure.v1",
    generatedAt: new Date().toISOString(),
    launcher: normalizedLauncher,
    model: normalizedModel || null,
    cooldownMinutes,
    until,
    pauseThreshold,
    recentQuotaFailureCount,
    globalPauseActive: Boolean(saved.state?.globalPause?.active),
    statePath: relative(REPO_ROOT, saved.absolutePath).replaceAll("\\", "/"),
  };
}

export function buildAutomationStatus({
  configPath = DEFAULT_CONFIG_PATH,
  statePath = DEFAULT_STATE_PATH,
  reportDir = DEFAULT_REPORT_DIR,
  launcher = "",
  model = "",
} = {}) {
  const { absolutePath: configAbsolutePath, config } = loadAutomationConfig(configPath);
  const { absolutePath: stateAbsolutePath, state } = loadAutomationState(statePath);
  const launchers = launcher
    ? [launcher]
    : Array.from(new Set([...Object.keys(config.launchers || {}), "monsoonfire-overnight.service", "intent-codex-proc"]));

  const launcherStatuses = launchers.map((entry) =>
    evaluateAutomationGate({
      launcher: entry,
      model: model || config?.launchers?.[entry]?.defaultModel || "",
      automated: true,
      configPath,
      statePath,
      reportDir,
    })
  );

  return {
    schema: "codex-automation-status.v1",
    generatedAt: new Date().toISOString(),
    config: {
      path: relative(REPO_ROOT, configAbsolutePath).replaceAll("\\", "/"),
      defaults: config.defaults,
    },
    state: {
      path: relative(REPO_ROOT, stateAbsolutePath).replaceAll("\\", "/"),
      globalPause: state.globalPause,
      activeCooldowns: Object.values(state.quotaCooldowns || {}).filter((entry) => isActiveCooldown(entry, Date.now())),
    },
    launchers: launcherStatuses,
  };
}
