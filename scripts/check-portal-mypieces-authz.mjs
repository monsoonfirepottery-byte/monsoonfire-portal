#!/usr/bin/env node

/* eslint-disable no-console */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const DEFAULT_PROJECT_ID = "monsoonfire-portal";
const DEFAULT_FUNCTIONS_BASE_URL = "https://us-central1-monsoonfire-portal.cloudfunctions.net";
const DEFAULT_CREDENTIALS_PATH = resolve(process.cwd(), "secrets", "portal", "portal-agent-staff.json");

function parseArgs(argv) {
  const options = {
    apiKey: String(process.env.PORTAL_FIREBASE_API_KEY || "").trim(),
    projectId: process.env.PORTAL_PROJECT_ID || DEFAULT_PROJECT_ID,
    functionsBaseUrl: process.env.PORTAL_FUNCTIONS_BASE_URL || DEFAULT_FUNCTIONS_BASE_URL,
    credentialsPath:
      process.env.PORTAL_AGENT_STAFF_CREDENTIALS ||
      DEFAULT_CREDENTIALS_PATH,
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

    if (arg === "--functions-base-url") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --functions-base-url");
      options.functionsBaseUrl = String(next).trim().replace(/\/+$/, "");
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

    if (arg === "--json") {
      options.asJson = true;
      continue;
    }
  }

  if (!options.apiKey) {
    throw new Error("Missing PORTAL_FIREBASE_API_KEY (or pass --api-key).");
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

function print(summary, asJson) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  process.stdout.write(`status: ${summary.status}\n`);
  process.stdout.write(`project: ${summary.projectId}\n`);
  process.stdout.write(`actor: ${summary.actor.email} (${summary.actor.uid})\n`);
  process.stdout.write(`batchId: ${summary.batch.batchId || "n/a"}\n`);
  process.stdout.write(
    `piece checks: create=${summary.piece.create.status} get=${summary.piece.get.status} list=${summary.piece.list.status}\n`
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
  const displayName = String(creds.displayName || "Portal Agent Staff").trim();

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
  const now = Date.now();
  const title = `QA-MyPieces-${now}`;
  const clientRequestId = `qa-mypieces-${now}`;

  const createBatchResp = await requestJson(`${options.functionsBaseUrl}/createBatch`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      ownerUid: uid,
      ownerDisplayName: displayName,
      title,
      intakeMode: "STAFF_HANDOFF",
      estimatedCostCents: 1500,
      estimateNotes: "QA probe for My Pieces permission path",
      clientRequestId,
    }),
  });

  const batchId = createBatchResp.json?.batchId ?? createBatchResp.json?.existingBatchId ?? null;
  if (!batchId) {
    const summary = {
      status: "failed",
      projectId: options.projectId,
      actor: { uid, email },
      batch: {
        status: createBatchResp.status,
        error: summarizeError(createBatchResp),
      },
      message: "Could not create probe batch.",
    };
    print(summary, options.asJson);
    process.exit(1);
  }

  const pieceId = `piece-${now}`;
  const timestampIso = new Date().toISOString();
  const firestoreBase = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    options.projectId
  )}/databases/(default)/documents`;
  const headers = {
    Authorization: `Bearer ${idToken}`,
    "content-type": "application/json",
  };

  const createPieceResp = await requestJson(
    `${firestoreBase}/batches/${encodeURIComponent(batchId)}/pieces?documentId=${encodeURIComponent(pieceId)}`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        fields: {
          pieceCode: { stringValue: `QA-${String(now).slice(-6)}` },
          shortDesc: { stringValue: "My Pieces authz QA probe piece" },
          ownerName: { stringValue: email },
          stage: { stringValue: "GREENWARE" },
          wareCategory: { stringValue: "STONEWARE" },
          isArchived: { booleanValue: false },
          createdAt: { timestampValue: timestampIso },
          updatedAt: { timestampValue: timestampIso },
        },
      }),
    }
  );

  const getPieceResp = await requestJson(
    `${firestoreBase}/batches/${encodeURIComponent(batchId)}/pieces/${encodeURIComponent(pieceId)}`,
    { headers: { Authorization: `Bearer ${idToken}` } }
  );

  const listPieceResp = await requestJson(
    `${firestoreBase}/batches/${encodeURIComponent(batchId)}/pieces?pageSize=5`,
    { headers: { Authorization: `Bearer ${idToken}` } }
  );

  const passed = createPieceResp.ok && getPieceResp.ok && listPieceResp.ok;
  const summary = {
    status: passed ? "passed" : "failed",
    projectId: options.projectId,
    actor: { uid, email },
    batch: {
      batchId,
      status: createBatchResp.status,
      ok: createBatchResp.ok,
      error: summarizeError(createBatchResp),
    },
    piece: {
      pieceId,
      create: {
        status: createPieceResp.status,
        ok: createPieceResp.ok,
        error: summarizeError(createPieceResp),
      },
      get: {
        status: getPieceResp.status,
        ok: getPieceResp.ok,
        error: summarizeError(getPieceResp),
      },
      list: {
        status: listPieceResp.status,
        ok: listPieceResp.ok,
        error: summarizeError(listPieceResp),
      },
    },
    message: passed
      ? "My Pieces permission path passed create/get/list checks."
      : "My Pieces permission path failed one or more checks.",
  };

  print(summary, options.asJson);
  if (!passed) {
    process.exit(1);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`check-portal-mypieces-authz failed: ${message}`);
  process.exit(1);
});
