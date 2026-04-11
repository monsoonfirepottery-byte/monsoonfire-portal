#!/usr/bin/env node

import { fileURLToPath } from "node:url";

function clean(value) {
  return String(value ?? "").trim();
}

function boolFlag(value, fallback = false) {
  const normalized = clean(value).toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function intFlag(value, fallback) {
  const parsed = Number.parseInt(clean(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseCsv(value) {
  return clean(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function truncate(value, limit) {
  const text = clean(value).replace(/\r\n/g, "\n");
  if (!text) return "";
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function normalizeProvider(value) {
  const normalized = clean(value).toLowerCase();
  if (["ntfy", "pushover", "webhook"].includes(normalized)) return normalized;
  return "";
}

function statusLabel(status) {
  const normalized = clean(status).toLowerCase();
  if (!normalized) return "info";
  if (["ok", "success", "done", "applied", "completed"].includes(normalized)) return "success";
  if (["warn", "warning", "skipped", "dry-run", "dryrun"].includes(normalized)) return "warning";
  if (["fail", "failed", "failure", "error"].includes(normalized)) return "failure";
  return normalized;
}

function defaultPriorityForStatus(status, provider) {
  const label = statusLabel(status);
  if (provider === "ntfy") {
    if (label === "failure") return "urgent";
    if (label === "warning") return "default";
    return "default";
  }
  if (provider === "pushover") {
    if (label === "failure") return "1";
    return "0";
  }
  return "";
}

function resolveNtfyTopicUrl(env) {
  const explicit = clean(env.CODEX_PHONE_NOTIFY_NTFY_TOPIC_URL);
  if (explicit) return explicit;
  const baseUrl = clean(env.CODEX_PHONE_NOTIFY_NTFY_URL || "https://ntfy.sh").replace(/\/+$/, "");
  const topic = clean(env.CODEX_PHONE_NOTIFY_NTFY_TOPIC);
  if (!topic) return "";
  return `${baseUrl}/${encodeURIComponent(topic)}`;
}

export function resolvePhoneNotifyConfig(env = process.env) {
  const provider = normalizeProvider(env.CODEX_PHONE_NOTIFY_PROVIDER);
  const enabled =
    boolFlag(env.CODEX_PHONE_NOTIFY_ENABLED, false) ||
    (provider === "ntfy" && Boolean(resolveNtfyTopicUrl(env))) ||
    (provider === "pushover" &&
      Boolean(clean(env.CODEX_PHONE_NOTIFY_PUSHOVER_TOKEN)) &&
      Boolean(clean(env.CODEX_PHONE_NOTIFY_PUSHOVER_USER))) ||
    (provider === "webhook" && Boolean(clean(env.CODEX_PHONE_NOTIFY_WEBHOOK_URL)));

  return {
    enabled,
    provider,
    timeoutMs: Math.max(1000, intFlag(env.CODEX_PHONE_NOTIFY_TIMEOUT_MS, 10000)),
    notifyMode: clean(env.CODEX_PHONE_NOTIFY_MODE || "always").toLowerCase() || "always",
    ntfy: {
      topicUrl: resolveNtfyTopicUrl(env),
      token: clean(env.CODEX_PHONE_NOTIFY_NTFY_TOKEN),
      priority: clean(env.CODEX_PHONE_NOTIFY_NTFY_PRIORITY),
      tags: parseCsv(env.CODEX_PHONE_NOTIFY_NTFY_TAGS),
      click: clean(env.CODEX_PHONE_NOTIFY_NTFY_CLICK_URL),
    },
    pushover: {
      apiUrl: clean(env.CODEX_PHONE_NOTIFY_PUSHOVER_API_URL || "https://api.pushover.net/1/messages.json"),
      token: clean(env.CODEX_PHONE_NOTIFY_PUSHOVER_TOKEN),
      user: clean(env.CODEX_PHONE_NOTIFY_PUSHOVER_USER),
      device: clean(env.CODEX_PHONE_NOTIFY_PUSHOVER_DEVICE),
      priority: clean(env.CODEX_PHONE_NOTIFY_PUSHOVER_PRIORITY),
      sound: clean(env.CODEX_PHONE_NOTIFY_PUSHOVER_SOUND),
      url: clean(env.CODEX_PHONE_NOTIFY_PUSHOVER_URL),
      urlTitle: clean(env.CODEX_PHONE_NOTIFY_PUSHOVER_URL_TITLE),
    },
    webhook: {
      url: clean(env.CODEX_PHONE_NOTIFY_WEBHOOK_URL),
      bearer: clean(env.CODEX_PHONE_NOTIFY_WEBHOOK_BEARER),
    },
  };
}

function shouldSendForMode(mode, status) {
  const normalizedMode = clean(mode).toLowerCase() || "always";
  const label = statusLabel(status);
  if (normalizedMode === "failures") return label === "failure";
  if (normalizedMode === "success") return label === "success";
  return true;
}

function timeoutController(timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout),
  };
}

async function readResponseText(response) {
  try {
    return truncate(await response.text(), 800);
  } catch {
    return "";
  }
}

async function postWebhook(config, payload, timeoutMs) {
  const timeout = timeoutController(timeoutMs);
  try {
    const headers = {
      "content-type": "application/json",
    };
    if (config.bearer) headers.authorization = /^bearer\s+/i.test(config.bearer) ? config.bearer : `Bearer ${config.bearer}`;
    const response = await fetch(config.url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: timeout.signal,
    });
    return {
      attempted: true,
      ok: response.ok,
      provider: "webhook",
      status: response.status,
      responseText: await readResponseText(response),
    };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      provider: "webhook",
      status: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    timeout.clear();
  }
}

async function postNtfy(config, payload, timeoutMs) {
  const timeout = timeoutController(timeoutMs);
  try {
    const headers = {
      "content-type": "text/plain; charset=utf-8",
      Title: payload.title,
      Priority: clean(config.priority || defaultPriorityForStatus(payload.status, "ntfy")),
    };
    const tags = Array.from(new Set([...(config.tags || []), ...(payload.tags || [])])).join(",");
    if (tags) headers.Tags = tags;
    if (config.click) headers.Click = config.click;
    if (config.token) headers.Authorization = /^bearer\s+/i.test(config.token) ? config.token : `Bearer ${config.token}`;
    const response = await fetch(config.topicUrl, {
      method: "POST",
      headers,
      body: payload.message,
      signal: timeout.signal,
    });
    return {
      attempted: true,
      ok: response.ok,
      provider: "ntfy",
      status: response.status,
      responseText: await readResponseText(response),
    };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      provider: "ntfy",
      status: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    timeout.clear();
  }
}

async function postPushover(config, payload, timeoutMs) {
  const timeout = timeoutController(timeoutMs);
  try {
    const body = new URLSearchParams({
      token: config.token,
      user: config.user,
      title: payload.title,
      message: payload.message,
      priority: clean(config.priority || defaultPriorityForStatus(payload.status, "pushover")),
    });
    if (config.device) body.set("device", config.device);
    if (config.sound) body.set("sound", config.sound);
    if (config.url) body.set("url", config.url);
    if (config.urlTitle) body.set("url_title", config.urlTitle);
    const response = await fetch(config.apiUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
      signal: timeout.signal,
    });
    return {
      attempted: true,
      ok: response.ok,
      provider: "pushover",
      status: response.status,
      responseText: await readResponseText(response),
    };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      provider: "pushover",
      status: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    timeout.clear();
  }
}

export function buildAutomationNotification({
  tool = "automation",
  status = "info",
  runId = "",
  summary = {},
  notes = [],
} = {}) {
  const toolLabel = clean(tool) || "automation";
  const normalizedStatus = statusLabel(status);
  const title = `Codex ${toolLabel}: ${normalizedStatus}`;
  const summaryEntries = Object.entries(summary || {})
    .filter(([, value]) => value !== null && value !== undefined && clean(value).length > 0)
    .slice(0, 6)
    .map(([key, value]) => `${key}=${String(value)}`);
  const noteLines = Array.isArray(notes)
    ? notes
        .map((entry) => truncate(entry, 160))
        .filter(Boolean)
        .slice(0, 3)
    : [];
  const lines = [
    runId ? `run: ${runId}` : "",
    summaryEntries.length ? `summary: ${summaryEntries.join(", ")}` : "",
    ...noteLines.map((entry) => `note: ${entry}`),
  ].filter(Boolean);
  return {
    title,
    message: truncate(lines.join("\n") || `${title}.`, 1600),
    status: normalizedStatus,
    tags: ["codex", toolLabel, normalizedStatus],
  };
}

export async function sendPhoneNotification({
  title = "",
  message = "",
  status = "info",
  tags = [],
  metadata = {},
  force = false,
  env = process.env,
} = {}) {
  const config = resolvePhoneNotifyConfig(env);
  if (!config.provider) {
    return {
      attempted: false,
      ok: false,
      skipped: true,
      reason: "provider-not-configured",
    };
  }
  if (!force && !config.enabled) {
    return {
      attempted: false,
      ok: false,
      skipped: true,
      reason: "disabled",
      provider: config.provider,
    };
  }
  if (!force && !shouldSendForMode(config.notifyMode, status)) {
    return {
      attempted: false,
      ok: false,
      skipped: true,
      reason: "notify-mode-suppressed",
      provider: config.provider,
    };
  }

  const payload = {
    title: truncate(title || "Codex notification", 120),
    message: truncate(message || "No message supplied.", 1600),
    status: statusLabel(status),
    tags: Array.from(new Set(tags.map((entry) => clean(entry)).filter(Boolean))).slice(0, 8),
    metadata: metadata && typeof metadata === "object" ? metadata : {},
    generatedAt: new Date().toISOString(),
  };

  if (config.provider === "webhook") {
    if (!config.webhook.url) {
      return {
        attempted: false,
        ok: false,
        skipped: true,
        reason: "webhook-url-missing",
        provider: "webhook",
      };
    }
    return postWebhook(config.webhook, payload, config.timeoutMs);
  }

  if (config.provider === "ntfy") {
    if (!config.ntfy.topicUrl) {
      return {
        attempted: false,
        ok: false,
        skipped: true,
        reason: "ntfy-topic-missing",
        provider: "ntfy",
      };
    }
    return postNtfy(config.ntfy, payload, config.timeoutMs);
  }

  if (config.provider === "pushover") {
    if (!config.pushover.token || !config.pushover.user) {
      return {
        attempted: false,
        ok: false,
        skipped: true,
        reason: "pushover-credentials-missing",
        provider: "pushover",
      };
    }
    return postPushover(config.pushover, payload, config.timeoutMs);
  }

  return {
    attempted: false,
    ok: false,
    skipped: true,
    reason: "unsupported-provider",
    provider: config.provider,
  };
}

export async function notifyAutomationOutcome({
  tool = "automation",
  status = "info",
  runId = "",
  summary = {},
  notes = [],
  metadata = {},
  force = false,
  env = process.env,
} = {}) {
  const built = buildAutomationNotification({ tool, status, runId, summary, notes });
  return sendPhoneNotification({
    ...built,
    metadata: {
      tool: clean(tool),
      runId: clean(runId) || null,
      summary,
      ...(metadata && typeof metadata === "object" ? metadata : {}),
    },
    force,
    env,
  });
}

function parseArgs(argv) {
  const options = {
    title: "",
    message: "",
    status: "info",
    asJson: false,
    force: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = clean(argv[index]);
    if (!arg) continue;
    if (arg === "--json") {
      options.asJson = true;
      continue;
    }
    if (arg === "--force") {
      options.force = true;
      continue;
    }
    const next = argv[index + 1];
    if ((arg === "--title" || arg === "--message" || arg === "--status") && next && !clean(next).startsWith("--")) {
      options[arg.slice(2)] = String(next);
      index += 1;
    }
  }

  return options;
}

async function readStdinText() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const stdinMessage = await readStdinText();
  const result = await sendPhoneNotification({
    title: options.title || "Codex notification",
    message: options.message || stdinMessage || "Codex notification",
    status: options.status,
    force: options.force,
  });

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (result.ok) {
    process.stdout.write(`sent via ${result.provider}\n`);
  } else if (result.skipped) {
    process.stdout.write(`skipped: ${result.reason}\n`);
  } else {
    process.stdout.write(`failed: ${result.error || result.responseText || result.reason || "unknown"}\n`);
  }

  if (!result.ok && !result.skipped) {
    process.exit(1);
  }
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
