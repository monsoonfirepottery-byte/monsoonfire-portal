#!/usr/bin/env node

/* eslint-disable no-console */

import { appendFile } from "node:fs/promises";

function parseArgs(argv) {
  const options = {
    asJson: false,
    writeGithubOutput: false,
  };

  for (const arg of argv) {
    if (arg === "--json") {
      options.asJson = true;
      continue;
    }
    if (arg === "--github-output") {
      options.writeGithubOutput = true;
    }
  }

  return options;
}

function looksLikeApiKey(value) {
  return /^AIza[0-9A-Za-z_-]{20,}$/.test(String(value || "").trim());
}

function summarize(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "<empty>";
  if (trimmed.length <= 10) return `${trimmed[0]}***`;
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
}

async function requestText(url, init = {}) {
  try {
    const response = await fetch(url, init);
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      text,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      text: error instanceof Error ? error.message : String(error),
    };
  }
}

async function validateApiKey(candidate) {
  const key = String(candidate || "").trim();
  if (!key) return { ok: false, reason: "missing" };
  if (!looksLikeApiKey(key)) return { ok: false, reason: "format" };

  const configResp = await requestText(
    `https://www.googleapis.com/identitytoolkit/v3/relyingparty/getProjectConfig?key=${encodeURIComponent(key)}`
  );
  if (configResp.status !== 200) {
    return { ok: false, reason: `project-config-http-${configResp.status || "error"}` };
  }

  const signInResp = await requestText(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "nobody@example.com",
        password: "invalid-password",
        returnSecureToken: true,
      }),
    }
  );
  if (signInResp.status !== 400) {
    return { ok: false, reason: `sign-in-http-${signInResp.status || "error"}` };
  }
  if (/API key not valid|API_KEY_INVALID/i.test(signInResp.text || "")) {
    return { ok: false, reason: "api-key-invalid" };
  }

  return { ok: true, reason: "valid" };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const candidates = [
    { source: "portal", key: String(process.env.PORTAL_FIREBASE_API_KEY || "").trim() },
    { source: "firebase_web", key: String(process.env.FIREBASE_WEB_API_KEY || "").trim() },
  ];

  const attempts = [];
  for (const candidate of candidates) {
    const result = await validateApiKey(candidate.key);
    attempts.push({
      source: candidate.source,
      keySummary: summarize(candidate.key),
      status: result.ok ? "valid" : "invalid",
      reason: result.reason,
    });
    if (result.ok) {
      const payload = {
        status: "resolved",
        source: candidate.source,
        attempts,
      };

      if (options.writeGithubOutput && process.env.GITHUB_OUTPUT) {
        await appendFile(
          process.env.GITHUB_OUTPUT,
          `firebase_api_key=${candidate.key}\nfirebase_api_key_source=${candidate.source}\n`,
          "utf8"
        );
      }

      if (options.asJson) {
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      } else {
        process.stdout.write(`resolved Firebase API key source: ${candidate.source}\n`);
      }
      return;
    }
  }

  const failurePayload = {
    status: "failed",
    message: "No valid Firebase API key resolved from PORTAL_FIREBASE_API_KEY or FIREBASE_WEB_API_KEY.",
    attempts,
  };

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(failurePayload, null, 2)}\n`);
  } else {
    process.stderr.write(`${failurePayload.message}\n`);
    for (const attempt of attempts) {
      process.stderr.write(
        `- ${attempt.source}: ${attempt.status} (${attempt.reason}, ${attempt.keySummary})\n`
      );
    }
  }
  process.exit(1);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`resolve-firebase-api-key failed: ${message}`);
  process.exit(1);
});
