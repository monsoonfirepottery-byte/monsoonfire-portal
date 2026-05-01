#!/usr/bin/env node
/* eslint-disable no-console */

import { randomUUID } from "node:crypto";

const DEFAULT_ENDPOINT = "https://us-central1-monsoonfire-portal.cloudfunctions.net/apiV1/v1/support.chat.attachment";
const DEFAULT_ORIGIN = "https://monsoonfire.com";
const DEFAULT_PAGE_PATH = "/firing-care-preview/support-pickup/";
const DEFAULT_TIMEOUT_MS = 15_000;
const SYNTHETIC_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
  0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48,
  0x00, 0x48, 0x00, 0x00, 0xff, 0xd9,
]);

function valueAfter(argv, flag) {
  const index = argv.indexOf(flag);
  if (index === -1) return null;
  const value = argv[index + 1];
  return value && !String(value).startsWith("--") ? String(value) : null;
}

function parseArgs(argv) {
  return {
    endpoint: valueAfter(argv, "--endpoint") ?? DEFAULT_ENDPOINT,
    origin: valueAfter(argv, "--origin") ?? DEFAULT_ORIGIN,
    pagePath: valueAfter(argv, "--page-path") ?? DEFAULT_PAGE_PATH,
    sessionId: valueAfter(argv, "--session-id") ?? `ember_smoke_${randomUUID().replaceAll("-", "_")}`,
    requestId: valueAfter(argv, "--request-id") ?? `codex_ember_attachment_smoke_${Date.now().toString(36)}`,
    timeoutMs: Number(valueAfter(argv, "--timeout-ms") ?? DEFAULT_TIMEOUT_MS),
    asJson: argv.includes("--json"),
    strict: argv.includes("--strict"),
    skipPreflight: argv.includes("--skip-preflight"),
  };
}

function safeUrl(raw) {
  const parsed = new URL(raw);
  parsed.username = "";
  parsed.password = "";
  return parsed.toString();
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function hasCorsAllowOrigin(headers, origin) {
  const allowOrigin = headers.get("access-control-allow-origin");
  if (!allowOrigin) return false;
  const normalized = allowOrigin.trim();
  return normalized === "*" || normalized === origin;
}

async function readJson(response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) return {};
  return await response.json().catch(() => ({}));
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sanitizePayload(payload) {
  const body = payload && typeof payload === "object" ? payload : {};
  const data = body.data && typeof body.data === "object" ? body.data : body;
  const attachment = data.attachment && typeof data.attachment === "object" ? data.attachment : null;
  return {
    ok: body.ok === true || data.ok === true,
    code: typeof body.code === "string" ? body.code : typeof data.code === "string" ? data.code : null,
    message: typeof body.message === "string" ? body.message : typeof data.message === "string" ? data.message : null,
    attachmentStore: typeof data.attachmentStore === "string" ? data.attachmentStore : null,
    hasAttachment: Boolean(attachment),
    attachment: attachment
      ? {
          fileName: typeof attachment.fileName === "string" ? attachment.fileName : null,
          contentType: typeof attachment.contentType === "string" ? attachment.contentType : null,
          sizeBytes: finiteNumber(attachment.sizeBytes),
          expiresAtPresent: typeof attachment.expiresAt === "string" && attachment.expiresAt.length > 0,
        }
      : null,
    controls: data.controls && typeof data.controls === "object"
      ? {
          maxBytes: finiteNumber(data.controls.maxBytes),
          ttlMinutes: finiteNumber(data.controls.ttlMinutes),
          maxSessionUploadsPerWindow: finiteNumber(data.controls.maxSessionUploadsPerWindow),
        }
      : null,
  };
}

async function probePreflight(options) {
  if (options.skipPreflight) {
    return {
      skipped: true,
      passed: true,
      status: null,
      allowOrigin: null,
    };
  }

  const response = await fetchWithTimeout(options.endpoint, {
    method: "OPTIONS",
    headers: {
      Origin: options.origin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type,x-request-id",
    },
  }, options.timeoutMs);

  const allowOrigin = response.headers.get("access-control-allow-origin");
  const passed = (response.status === 204 || response.status === 200) && hasCorsAllowOrigin(response.headers, options.origin);
  return {
    skipped: false,
    passed,
    status: response.status,
    allowOrigin: allowOrigin ?? null,
  };
}

async function postAttachment(options) {
  const body = {
    sessionId: options.sessionId,
    supportRequestId: null,
    pagePath: options.pagePath,
    fileName: "codex-ember-support-smoke.jpg",
    contentType: "image/jpeg",
    sizeBytes: SYNTHETIC_JPEG.byteLength,
    dataBase64: SYNTHETIC_JPEG.toString("base64"),
    note: "Synthetic smoke photo generated by the redacted Ember support attachment preflight.",
  };

  const response = await fetchWithTimeout(options.endpoint, {
    method: "POST",
    headers: {
      Origin: options.origin,
      "content-type": "application/json",
      "x-request-id": options.requestId,
      "user-agent": "codex-ember-support-attachment-smoke/1.0",
    },
    body: JSON.stringify(body),
  }, options.timeoutMs);
  const payload = await readJson(response);
  return {
    status: response.status,
    corsPassed: hasCorsAllowOrigin(response.headers, options.origin),
    sanitizedPayload: sanitizePayload(payload),
  };
}

function summarize(options, preflight, response, error) {
  const sanitized = response?.sanitizedPayload ?? {};
  const ok = !error
    && preflight.passed
    && response.status >= 200
    && response.status < 300
    && response.corsPassed
    && sanitized.ok === true
    && sanitized.attachmentStore === "studio-brain-postgres"
    && sanitized.hasAttachment === true;

  return {
    ok,
    endpoint: safeUrl(options.endpoint),
    origin: options.origin,
    pagePath: options.pagePath,
    sessionId: options.sessionId,
    requestId: options.requestId,
    preflight,
    response: response
      ? {
          status: response.status,
          corsPassed: response.corsPassed,
          ok: sanitized.ok === true,
          code: sanitized.code,
          message: sanitized.message,
          attachmentStore: sanitized.attachmentStore,
          hasAttachment: sanitized.hasAttachment,
          attachment: sanitized.attachment,
          controls: sanitized.controls,
        }
      : null,
    error: error ? (error instanceof Error ? error.message : String(error)) : null,
  };
}

function printHuman(summary) {
  const status = summary.ok ? "passed" : "failed";
  console.log(`Ember support attachment smoke ${status}`);
  console.log(`endpoint: ${summary.endpoint}`);
  console.log(`origin: ${summary.origin}`);
  console.log(`preflight: ${summary.preflight.skipped ? "skipped" : `${summary.preflight.status} ${summary.preflight.passed ? "passed" : "failed"}`}`);
  if (summary.response) {
    console.log(`response: ${summary.response.status} ${summary.response.ok ? "ok" : "not ok"}`);
    console.log(`attachmentStore: ${summary.response.attachmentStore ?? "<missing>"}`);
    console.log(`hasAttachment: ${summary.response.hasAttachment ? "true" : "false"}`);
    if (summary.response.code || summary.response.message) {
      console.log(`message: ${[summary.response.code, summary.response.message].filter(Boolean).join(" - ")}`);
    }
  }
  if (summary.error) {
    console.log(`error: ${summary.error}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  let preflight = {
    skipped: false,
    passed: false,
    status: null,
    allowOrigin: null,
  };
  let response = null;
  let error = null;

  try {
    preflight = await probePreflight(options);
    response = await postAttachment(options);
  } catch (caught) {
    error = caught;
  }

  const summary = summarize(options, preflight, response, error);
  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    printHuman(summary);
  }

  if (options.strict && !summary.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`ember-support-attachment-smoke failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
