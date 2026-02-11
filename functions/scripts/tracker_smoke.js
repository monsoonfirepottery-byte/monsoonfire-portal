#!/usr/bin/env node
/*
 * Emulator smoke test for tracker MVP.
 *
 * Validates:
 * - seed data creation (projects/epics)
 * - ticket create + status transition + blocked flow
 * - ticket filtering query shape (owner + status)
 * - githubLookup endpoint call with Firebase auth token
 *
 * Usage:
 *   node functions/scripts/tracker_smoke.js
 */

const admin = require("firebase-admin");
const { randomUUID } = require("node:crypto");

const PROJECT_ID = process.env.GCLOUD_PROJECT || "monsoonfire-portal";
const FUNCTIONS_BASE_URL =
  process.env.FUNCTIONS_BASE_URL ||
  "http://127.0.0.1:5001/monsoonfire-portal/us-central1";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
}
if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
}

async function getIdTokenForUid(uid) {
  const customToken = await admin.auth().createCustomToken(uid);
  const url = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });

  const body = await response.json();
  if (!response.ok || !body.idToken) {
    throw new Error(`Auth emulator signInWithCustomToken failed: ${JSON.stringify(body)}`);
  }
  return body.idToken;
}

async function run() {
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: PROJECT_ID });
  }

  const db = admin.firestore();
  const uid = `tracker-smoke-${Date.now()}`;
  const now = admin.firestore.FieldValue.serverTimestamp();

  const portalProjectId = `${uid}_PORTAL`;
  const epicId = `${uid}_EPIC_TRACKER`;
  const ticketId = `${uid}_TICKET_1`;

  await db.collection("trackerProjects").doc(portalProjectId).set({
    ownerUid: uid,
    key: "PORTAL",
    name: "Monsoon Fire Portal",
    description: "Smoke project",
    createdAt: now,
    updatedAt: now,
  });

  await db.collection("trackerEpics").doc(epicId).set({
    ownerUid: uid,
    projectId: portalProjectId,
    title: "Tracker smoke epic",
    description: "Smoke epic",
    status: "Ready",
    priority: "P1",
    tags: ["tracker", "smoke"],
    createdAt: now,
    updatedAt: now,
  });

  await db.collection("trackerTickets").doc(ticketId).set({
    ownerUid: uid,
    projectId: portalProjectId,
    epicId,
    title: "Smoke ticket",
    description: "Exercise create/update/query",
    status: "Backlog",
    priority: "P1",
    severity: "Sev2",
    component: "portal",
    impact: "high",
    tags: ["smoke", "tracker"],
    blocked: false,
    blockedReason: null,
    blockedByTicketId: null,
    links: [],
    githubIssue: null,
    githubPRs: [],
    createdAt: now,
    updatedAt: now,
    closedAt: null,
  });

  await db.collection("trackerTickets").doc(ticketId).set(
    {
      status: "Blocked",
      blocked: true,
      blockedReason: "Waiting on API contract",
      blockedByTicketId: "TICKET-42",
      updatedAt: now,
    },
    { merge: true }
  );

  await db.collection("trackerTickets").doc(ticketId).set(
    {
      status: "InProgress",
      blocked: false,
      blockedReason: null,
      blockedByTicketId: null,
      updatedAt: now,
    },
    { merge: true }
  );

  const inProgress = await db
    .collection("trackerTickets")
    .where("ownerUid", "==", uid)
    .where("status", "==", "InProgress")
    .get();

  if (inProgress.empty) {
    throw new Error("Expected at least one InProgress tracker ticket");
  }

  const idToken = await getIdTokenForUid(uid);

  const githubCall = {
    owner: "octocat",
    repo: "Hello-World",
    number: 1,
    type: "issue",
  };

  const githubResp = await fetch(`${FUNCTIONS_BASE_URL}/githubLookup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
      "x-request-id": `tracker_smoke_${randomUUID()}`,
    },
    body: JSON.stringify(githubCall),
  });

  const githubBody = await githubResp.json().catch(() => ({}));

  const summary = {
    uid,
    firestoreEmulatorHost: process.env.FIRESTORE_EMULATOR_HOST,
    authEmulatorHost: process.env.FIREBASE_AUTH_EMULATOR_HOST,
    ticketQueryCount: inProgress.size,
    githubLookupStatus: githubResp.status,
    githubLookupOk: githubResp.ok,
    githubLookupResponse: githubBody,
  };

  console.log("Tracker smoke summary", JSON.stringify(summary, null, 2));

  if (!githubResp.ok) {
    throw new Error(`githubLookup failed with status ${githubResp.status}`);
  }

  if (!githubBody || githubBody.ok !== true || !githubBody.data || !githubBody.data.url) {
    throw new Error("githubLookup response shape is invalid");
  }

  console.log("Tracker smoke test passed.");
}

run().catch((error) => {
  console.error("Tracker smoke test failed", error);
  process.exitCode = 1;
});
