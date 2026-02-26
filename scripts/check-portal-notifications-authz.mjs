#!/usr/bin/env node

/* eslint-disable no-console */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

const DEFAULT_API_KEY = "AIzaSyC7ynej0nGJas9me9M5oW6jHfLsWe5gHbU";
const DEFAULT_PROJECT_ID = "monsoonfire-portal";
const DEFAULT_NOTIFICATION_ID = "welcome-messaging-infra";

function parseArgs(argv) {
  const options = {
    apiKey: process.env.PORTAL_FIREBASE_API_KEY || DEFAULT_API_KEY,
    projectId: process.env.PORTAL_PROJECT_ID || DEFAULT_PROJECT_ID,
    credentialsPath:
      process.env.PORTAL_AGENT_STAFF_CREDENTIALS ||
      resolve(homedir(), ".ssh", "portal-agent-staff.json"),
    notificationId: process.env.PORTAL_NOTIFICATION_PROBE_ID || DEFAULT_NOTIFICATION_ID,
    asJson: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg || !arg.startsWith("--")) continue;

    if (arg === "--api-key") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --api-key");
      options.apiKey = String(next).trim();
      index += 1;
      continue;
    }

    if (arg === "--project") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --project");
      options.projectId = String(next).trim();
      index += 1;
      continue;
    }

    if (arg === "--credentials") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --credentials");
      options.credentialsPath = resolve(process.cwd(), String(next).trim());
      index += 1;
      continue;
    }

    if (arg === "--notification-id") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --notification-id");
      options.notificationId = String(next).trim();
      index += 1;
      continue;
    }

    if (arg === "--json") {
      options.asJson = true;
      continue;
    }
  }

  return options;
}

async function requestJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 600) };
  }
  return {
    ok: response.ok,
    status: response.status,
    json,
  };
}

function summarizeError(response) {
  if (response.ok) return null;
  return response.json ?? { message: "Request failed with non-JSON payload" };
}

function getDocIdFromName(name) {
  if (typeof name !== "string" || !name.trim()) return "";
  const parts = name.split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : "";
}

function print(summary, asJson) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  process.stdout.write(`status: ${summary.status}\n`);
  process.stdout.write(`project: ${summary.projectId}\n`);
  process.stdout.write(`actor: ${summary.actor.email} (${summary.actor.uid})\n`);
  process.stdout.write(`target notification: ${summary.notification.targetId || "n/a"}\n`);
  process.stdout.write(
    `checks: list=${summary.notification.list.status} read=${summary.notification.read.status} markRead=${summary.notification.markRead.status}\n`
  );
  if (summary.message) {
    process.stdout.write(`${summary.message}\n`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const rawCreds = await readFile(options.credentialsPath, "utf8");
  const creds = JSON.parse(rawCreds);
  const refreshToken = String(creds.refreshToken || "").trim();
  const uid = String(creds.uid || "").trim();
  const email = String(creds.email || "").trim();

  if (!refreshToken || !uid || !email) {
    throw new Error(`Invalid credentials file at ${options.credentialsPath}`);
  }

  const tokenResp = await requestJson(
    `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(options.apiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }).toString(),
    }
  );

  if (!tokenResp.ok || !tokenResp.json?.id_token) {
    const summary = {
      status: "failed",
      projectId: options.projectId,
      actor: { uid, email },
      message: "Could not mint ID token from refresh token.",
      token: { status: tokenResp.status, error: summarizeError(tokenResp) },
    };
    print(summary, options.asJson);
    process.exit(1);
  }

  const idToken = String(tokenResp.json.id_token);
  const firestoreBase = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    options.projectId
  )}/databases/(default)/documents`;
  const authHeaders = { Authorization: `Bearer ${idToken}` };

  const listResp = await requestJson(
    `${firestoreBase}/users/${encodeURIComponent(uid)}/notifications?pageSize=20`,
    { headers: authHeaders }
  );
  const listedDocIds = Array.isArray(listResp.json?.documents)
    ? listResp.json.documents.map((document) => getDocIdFromName(document?.name)).filter(Boolean)
    : [];

  const preferredId = String(options.notificationId || "").trim();
  const targetId = listedDocIds.includes(preferredId) ? preferredId : listedDocIds[0] || "";

  if (!targetId) {
    const summary = {
      status: "failed",
      projectId: options.projectId,
      actor: { uid, email },
      notification: {
        targetId: "",
        list: {
          status: listResp.status,
          ok: listResp.ok,
          count: listedDocIds.length,
          error: summarizeError(listResp),
        },
        read: { status: 0, ok: false, error: { message: "No notifications found for this user." } },
        markRead: { status: 0, ok: false, error: { message: "No target notification to update." } },
      },
      message:
        "Notifications mark-read authz probe could not run because no notification documents were found for this account. Seed at least one notification for this QA user first.",
    };
    print(summary, options.asJson);
    process.exit(1);
  }

  const targetDocPath = `${firestoreBase}/users/${encodeURIComponent(uid)}/notifications/${encodeURIComponent(
    targetId
  )}`;

  const getTargetResp = await requestJson(targetDocPath, { headers: authHeaders });

  const markReadTimestampIso = new Date().toISOString();
  const markReadResp = await requestJson(`${targetDocPath}?updateMask.fieldPaths=readAt`, {
    method: "PATCH",
    headers: {
      ...authHeaders,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      fields: {
        readAt: { timestampValue: markReadTimestampIso },
      },
    }),
  });

  const verifyResp = await requestJson(targetDocPath, { headers: authHeaders });
  const passed = listResp.ok && getTargetResp.ok && markReadResp.ok && verifyResp.ok;

  const summary = {
    status: passed ? "passed" : "failed",
    projectId: options.projectId,
    actor: { uid, email },
    notification: {
      targetId,
      list: {
        status: listResp.status,
        ok: listResp.ok,
        count: listedDocIds.length,
        error: summarizeError(listResp),
      },
      read: {
        status: getTargetResp.status,
        ok: getTargetResp.ok,
        error: summarizeError(getTargetResp),
      },
      markRead: {
        status: markReadResp.status,
        ok: markReadResp.ok,
        error: summarizeError(markReadResp),
      },
      verify: {
        status: verifyResp.status,
        ok: verifyResp.ok,
        error: summarizeError(verifyResp),
      },
    },
    message: passed
      ? "Notifications permission path passed list/read/mark-read checks."
      : "Notifications permission path failed one or more checks.",
  };

  print(summary, options.asJson);
  if (!passed) {
    process.exit(1);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`check-portal-notifications-authz failed: ${message}`);
  process.exit(1);
});
