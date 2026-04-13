#!/usr/bin/env node

/* eslint-disable no-console */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mintStaffIdTokenFromPortalEnv } from "./lib/firebase-auth-token.mjs";
import { loadPortalAutomationEnv } from "./lib/runtime-secrets.mjs";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..");

loadPortalAutomationEnv();

const DEFAULT_PROJECT_ID = "monsoonfire-portal";
const DEFAULT_FUNCTIONS_BASE_URL = "https://us-central1-monsoonfire-portal.cloudfunctions.net";
const DEFAULT_REPORT_PATH = resolve(repoRoot, "output", "qa", "reservation-policy-live-auth-check.json");
const DEFAULT_API_GET_ROUTE = "apiV1/v1/notifications.reservationPolicy.get";
const DEFAULT_API_SET_ROUTE = "apiV1/v1/notifications.reservationPolicy.set";
const DEFAULT_UID = String(process.env.PORTAL_STAFF_UID || "").trim() || "Foe98flKP6ZBOngz271FvuwWLIx2";

function clean(value) {
  return String(value ?? "").trim();
}

function parseArgs(argv) {
  const options = {
    projectId: clean(process.env.PORTAL_PROJECT_ID || DEFAULT_PROJECT_ID) || DEFAULT_PROJECT_ID,
    functionsBaseUrl: clean(process.env.PORTAL_FUNCTIONS_BASE_URL || DEFAULT_FUNCTIONS_BASE_URL).replace(/\/+$/, ""),
    reportPath: clean(process.env.PORTAL_RESERVATION_POLICY_AUTH_CHECK_REPORT || DEFAULT_REPORT_PATH),
    uid: clean(process.env.PORTAL_STAFF_UID || DEFAULT_UID) || DEFAULT_UID,
    asJson: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = clean(argv[index]);
    if (!arg) continue;

    if (arg === "--json") {
      options.asJson = true;
      continue;
    }

    const next = clean(argv[index + 1]);
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === "--project") {
      options.projectId = next;
      index += 1;
      continue;
    }
    if (arg === "--functions-base-url") {
      options.functionsBaseUrl = next.replace(/\/+$/, "");
      index += 1;
      continue;
    }
    if (arg === "--report") {
      options.reportPath = resolve(process.cwd(), next);
      index += 1;
      continue;
    }
    if (arg === "--uid") {
      options.uid = next;
      index += 1;
      continue;
    }
  }

  return options;
}

async function ensureDir(path) {
  await mkdir(path, { recursive: true });
}

async function requestJson(url, { method = "GET", headers = {}, body } = {}) {
  const response = await fetch(url, {
    method,
    headers,
    body,
  });
  const raw = await response.text();
  let parsed = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  return {
    ok: response.ok,
    status: response.status,
    raw,
    data: parsed,
  };
}

function encodeFirestorePath(path) {
  return String(path || "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function firestoreValueToJs(value) {
  if (!value || typeof value !== "object") return null;
  if (Object.prototype.hasOwnProperty.call(value, "nullValue")) return null;
  if (Object.prototype.hasOwnProperty.call(value, "stringValue")) return String(value.stringValue || "");
  if (Object.prototype.hasOwnProperty.call(value, "booleanValue")) return Boolean(value.booleanValue);
  if (Object.prototype.hasOwnProperty.call(value, "integerValue")) return Number(value.integerValue);
  if (Object.prototype.hasOwnProperty.call(value, "doubleValue")) return Number(value.doubleValue);
  if (Object.prototype.hasOwnProperty.call(value, "timestampValue")) return String(value.timestampValue || "");
  if (Object.prototype.hasOwnProperty.call(value, "arrayValue")) {
    const values = Array.isArray(value.arrayValue?.values) ? value.arrayValue.values : [];
    return values.map((entry) => firestoreValueToJs(entry));
  }
  if (Object.prototype.hasOwnProperty.call(value, "mapValue")) {
    const fields = value.mapValue?.fields && typeof value.mapValue.fields === "object" ? value.mapValue.fields : {};
    const out = {};
    for (const [key, nested] of Object.entries(fields)) {
      out[key] = firestoreValueToJs(nested);
    }
    return out;
  }
  return null;
}

function jsToFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === "string") return { stringValue: value };
  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map((entry) => jsToFirestoreValue(entry)),
      },
    };
  }
  if (typeof value === "object") {
    if (
      Object.prototype.hasOwnProperty.call(value, "timestampValue") &&
      Object.keys(value).length === 1 &&
      typeof value.timestampValue === "string"
    ) {
      return { timestampValue: value.timestampValue };
    }
    const fields = {};
    for (const [key, nested] of Object.entries(value)) {
      fields[key] = jsToFirestoreValue(nested);
    }
    return { mapValue: { fields } };
  }
  throw new Error(`Unsupported Firestore value type: ${typeof value}`);
}

async function callPolicyRoute(options, idToken, route, payload = {}) {
  return await requestJson(`${options.functionsBaseUrl}/${route}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

async function readFirestoreDocument(options, idToken, path) {
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    options.projectId
  )}/databases/(default)/documents/${encodeFirestorePath(path)}`;
  const response = await requestJson(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });

  if (response.status === 404) {
    return { exists: false, path, fields: {}, raw: response.data };
  }
  if (!response.ok) {
    throw new Error(`Firestore read failed for ${path}: HTTP ${response.status} ${response.raw}`);
  }

  const docFields = response.data?.fields && typeof response.data.fields === "object" ? response.data.fields : {};
  const fields = {};
  for (const [key, value] of Object.entries(docFields)) {
    fields[key] = firestoreValueToJs(value);
  }
  return { exists: true, path, fields, raw: response.data };
}

async function patchFirestoreDocument(options, idToken, path, fields, fieldPaths) {
  const url = new URL(
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      options.projectId
    )}/databases/(default)/documents/${encodeFirestorePath(path)}`
  );
  for (const fieldPath of fieldPaths) {
    url.searchParams.append("updateMask.fieldPaths", fieldPath);
  }

  const payloadFields = {};
  for (const [key, value] of Object.entries(fields)) {
    payloadFields[key] = jsToFirestoreValue(value);
  }

  const response = await requestJson(url.toString(), {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ fields: payloadFields }),
  });

  if (!response.ok) {
    throw new Error(`Firestore patch failed for ${path}: HTTP ${response.status} ${response.raw}`);
  }
  return response.data;
}

function buildNotificationPrefsDoc(source = {}) {
  const channels = source.channels && typeof source.channels === "object" ? source.channels : {};
  const events = source.events && typeof source.events === "object" ? source.events : {};
  const quietHours = source.quietHours && typeof source.quietHours === "object" ? source.quietHours : {};
  const frequency = source.frequency && typeof source.frequency === "object" ? source.frequency : {};

  return {
    enabled: typeof source.enabled === "boolean" ? source.enabled : true,
    channels: {
      inApp: typeof channels.inApp === "boolean" ? channels.inApp : true,
      email: typeof channels.email === "boolean" ? channels.email : true,
      push: typeof channels.push === "boolean" ? channels.push : false,
      sms: typeof channels.sms === "boolean" ? channels.sms : false,
    },
    events: {
      kilnUnloaded: typeof events.kilnUnloaded === "boolean" ? events.kilnUnloaded : true,
      kilnUnloadedBisque: typeof events.kilnUnloadedBisque === "boolean" ? events.kilnUnloadedBisque : true,
      kilnUnloadedGlaze: typeof events.kilnUnloadedGlaze === "boolean" ? events.kilnUnloadedGlaze : true,
      reservationStatus: typeof events.reservationStatus === "boolean" ? events.reservationStatus : true,
      reservationEtaShift: typeof events.reservationEtaShift === "boolean" ? events.reservationEtaShift : true,
      reservationPickupReady: typeof events.reservationPickupReady === "boolean" ? events.reservationPickupReady : true,
      reservationDelayFollowUp:
        typeof events.reservationDelayFollowUp === "boolean" ? events.reservationDelayFollowUp : true,
      reservationPickupReminder:
        typeof events.reservationPickupReminder === "boolean" ? events.reservationPickupReminder : true,
    },
    quietHours: {
      enabled: typeof quietHours.enabled === "boolean" ? quietHours.enabled : false,
      startLocal: typeof quietHours.startLocal === "string" ? quietHours.startLocal : "22:00",
      endLocal: typeof quietHours.endLocal === "string" ? quietHours.endLocal : "07:00",
      timezone: typeof quietHours.timezone === "string" ? quietHours.timezone : "America/Phoenix",
    },
    frequency: {
      mode: frequency.mode === "digest" ? "digest" : "immediate",
      digestHours:
        typeof frequency.digestHours === "number" && Number.isFinite(frequency.digestHours)
          ? frequency.digestHours
          : null,
    },
  };
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} mismatch. Expected ${JSON.stringify(expected)} but found ${JSON.stringify(actual)}.`);
  }
}

async function runStaffPolicyCheck(options, idToken) {
  const beforeResponse = await callPolicyRoute(options, idToken, DEFAULT_API_GET_ROUTE, {});
  if (!beforeResponse.ok) {
    throw new Error(`Policy GET failed before save/readback: HTTP ${beforeResponse.status} ${beforeResponse.raw}`);
  }

  const originalPolicy = beforeResponse.data?.data?.policy ?? {};
  const originalNote = originalPolicy.note ?? null;
  const marker = `[live-auth-check ${new Date().toISOString()}]`;

  let restored = false;
  try {
    const setResponse = await callPolicyRoute(options, idToken, DEFAULT_API_SET_ROUTE, {
      note: marker,
    });
    if (!setResponse.ok) {
      throw new Error(`Policy SET failed: HTTP ${setResponse.status} ${setResponse.raw}`);
    }

    const readbackResponse = await callPolicyRoute(options, idToken, DEFAULT_API_GET_ROUTE, {});
    if (!readbackResponse.ok) {
      throw new Error(`Policy GET failed after save: HTTP ${readbackResponse.status} ${readbackResponse.raw}`);
    }

    const readbackPolicy = readbackResponse.data?.data?.policy ?? {};
    assertEqual(readbackPolicy.note ?? null, marker, "Reservation policy note readback");

    const restoreResponse = await callPolicyRoute(options, idToken, DEFAULT_API_SET_ROUTE, {
      note: originalNote,
    });
    if (!restoreResponse.ok) {
      throw new Error(`Policy restore failed: HTTP ${restoreResponse.status} ${restoreResponse.raw}`);
    }
    restored = true;

    const restoredReadbackResponse = await callPolicyRoute(options, idToken, DEFAULT_API_GET_ROUTE, {});
    if (!restoredReadbackResponse.ok) {
      throw new Error(
        `Policy GET failed after restore: HTTP ${restoredReadbackResponse.status} ${restoredReadbackResponse.raw}`
      );
    }
    const restoredPolicy = restoredReadbackResponse.data?.data?.policy ?? {};
    assertEqual(restoredPolicy.note ?? null, originalNote, "Reservation policy restore readback");

    return {
      originalNote,
      changedNote: marker,
      restoredNote: originalNote,
    };
  } finally {
    if (!restored) {
      await callPolicyRoute(options, idToken, DEFAULT_API_SET_ROUTE, {
        note: originalNote,
      }).catch(() => {});
    }
  }
}

async function runProfilePreferenceCheck(options, idToken) {
  const profilePath = `profiles/${options.uid}`;
  const notificationsPath = `users/${options.uid}/prefs/notifications`;

  const [profileBefore, notificationsBefore] = await Promise.all([
    readFirestoreDocument(options, idToken, profilePath),
    readFirestoreDocument(options, idToken, notificationsPath),
  ]);

  const originalStates = {
    notifyReservations:
      typeof profileBefore.fields.notifyReservations === "boolean" ? profileBefore.fields.notifyReservations : true,
    reservationPickupReady:
      typeof notificationsBefore.fields.events?.reservationPickupReady === "boolean"
        ? notificationsBefore.fields.events.reservationPickupReady
        : true,
    reservationPickupReminder:
      typeof notificationsBefore.fields.events?.reservationPickupReminder === "boolean"
        ? notificationsBefore.fields.events.reservationPickupReminder
        : true,
  };

  const changedStates = {
    notifyReservations: !originalStates.notifyReservations,
    reservationPickupReady: !originalStates.reservationPickupReady,
    reservationPickupReminder: !originalStates.reservationPickupReminder,
  };
  const originalNotificationsDoc = buildNotificationPrefsDoc(notificationsBefore.fields);
  const changedNotificationsDoc = buildNotificationPrefsDoc({
    ...notificationsBefore.fields,
    events: {
      ...(notificationsBefore.fields.events ?? {}),
      reservationPickupReady: changedStates.reservationPickupReady,
      reservationPickupReminder: changedStates.reservationPickupReminder,
    },
  });

  const nowIso = new Date().toISOString();
  let restored = false;

  try {
    await Promise.all([
      patchFirestoreDocument(
        options,
        idToken,
        profilePath,
        {
          notifyReservations: changedStates.notifyReservations,
          updatedAt: { timestampValue: nowIso },
        },
        ["notifyReservations", "updatedAt"]
      ),
      patchFirestoreDocument(
        options,
        idToken,
        notificationsPath,
        {
          ...changedNotificationsDoc,
          updatedAt: { timestampValue: nowIso },
        },
        ["enabled", "channels", "events", "quietHours", "frequency", "updatedAt"]
      ),
    ]);

    const [profileReadback, notificationsReadback] = await Promise.all([
      readFirestoreDocument(options, idToken, profilePath),
      readFirestoreDocument(options, idToken, notificationsPath),
    ]);

    assertEqual(
      profileReadback.fields.notifyReservations ?? true,
      changedStates.notifyReservations,
      "Profile notifyReservations readback"
    );
    assertEqual(
      notificationsReadback.fields.events?.reservationPickupReady ?? true,
      changedStates.reservationPickupReady,
      "Profile reservationPickupReady readback"
    );
    assertEqual(
      notificationsReadback.fields.events?.reservationPickupReminder ?? true,
      changedStates.reservationPickupReminder,
      "Profile reservationPickupReminder readback"
    );

    const restoreIso = new Date().toISOString();
    await Promise.all([
      patchFirestoreDocument(
        options,
        idToken,
        profilePath,
        {
          notifyReservations: originalStates.notifyReservations,
          updatedAt: { timestampValue: restoreIso },
        },
        ["notifyReservations", "updatedAt"]
      ),
      patchFirestoreDocument(
        options,
        idToken,
        notificationsPath,
        {
          ...originalNotificationsDoc,
          updatedAt: { timestampValue: restoreIso },
        },
        ["enabled", "channels", "events", "quietHours", "frequency", "updatedAt"]
      ),
    ]);
    restored = true;

    const [profileRestored, notificationsRestored] = await Promise.all([
      readFirestoreDocument(options, idToken, profilePath),
      readFirestoreDocument(options, idToken, notificationsPath),
    ]);

    assertEqual(
      profileRestored.fields.notifyReservations ?? true,
      originalStates.notifyReservations,
      "Profile notifyReservations restore readback"
    );
    assertEqual(
      notificationsRestored.fields.events?.reservationPickupReady ?? true,
      originalStates.reservationPickupReady,
      "Profile reservationPickupReady restore readback"
    );
    assertEqual(
      notificationsRestored.fields.events?.reservationPickupReminder ?? true,
      originalStates.reservationPickupReminder,
      "Profile reservationPickupReminder restore readback"
    );

    return {
      originalStates,
      changedStates,
      restoredStates: originalStates,
    };
  } finally {
    if (!restored) {
      const fallbackIso = new Date().toISOString();
      await Promise.allSettled([
        patchFirestoreDocument(
          options,
          idToken,
          profilePath,
          {
            notifyReservations: originalStates.notifyReservations,
            updatedAt: { timestampValue: fallbackIso },
          },
          ["notifyReservations", "updatedAt"]
        ),
        patchFirestoreDocument(
          options,
          idToken,
          notificationsPath,
          {
            ...originalNotificationsDoc,
            updatedAt: { timestampValue: fallbackIso },
          },
          ["enabled", "channels", "events", "quietHours", "frequency", "updatedAt"]
        ),
      ]);
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const summary = {
    status: "running",
    projectId: options.projectId,
    functionsBaseUrl: options.functionsBaseUrl,
    uid: options.uid,
    startedAtIso: new Date().toISOString(),
    authSource: "",
    staffPolicy: null,
    profilePreferences: null,
  };

  try {
    const minted = await mintStaffIdTokenFromPortalEnv();
    if (!minted.ok || !minted.token) {
      throw new Error(`Could not mint staff ID token: ${minted.reason}`);
    }
    summary.authSource = minted.source || "";
    summary.staffPolicy = await runStaffPolicyCheck(options, minted.token);
    summary.profilePreferences = await runProfilePreferenceCheck(options, minted.token);
    summary.status = "passed";
    summary.completedAtIso = new Date().toISOString();
  } catch (error) {
    summary.status = "failed";
    summary.completedAtIso = new Date().toISOString();
    summary.error = error instanceof Error ? error.message : String(error);
  }

  await ensureDir(dirname(options.reportPath));
  await writeFile(options.reportPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    process.stdout.write(`status: ${summary.status}\n`);
    process.stdout.write(`report: ${options.reportPath}\n`);
    if (summary.error) {
      process.stdout.write(`error: ${summary.error}\n`);
    }
  }

  if (summary.status !== "passed") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`portal reservation policy live auth check failed: ${message}`);
  process.exit(1);
});
