#!/usr/bin/env node
/*
 * Quick tracker status snapshot from Firestore and markdown tickets.
 *
 * Usage:
 *   node functions/scripts/tracker_counts.js --uid <firebase_uid>
 *   node functions/scripts/tracker_counts.js --email monsoonfirepottery@gmail.com
 *
 * Optional:
 *   --projectId monsoonfire-portal
 */

const fs = require("node:fs");
const path = require("node:path");
const admin = require("firebase-admin");

const ROOT = path.resolve(__dirname, "..", "..");
const TICKETS_DIR = path.join(ROOT, "tickets");

function readArg(name, fallback = "") {
  const idx = process.argv.findIndex((arg) => arg === `--${name}`);
  if (idx === -1) return fallback;
  const next = process.argv[idx + 1];
  return typeof next === "string" ? next : fallback;
}

function canonicalStatus(rawStatus) {
  const value = String(rawStatus || "").trim().toLowerCase();
  if (!value) return "Planned";
  if (value.includes("completed") || value.includes("done")) return "Completed";
  if (value.includes("in progress") || value.includes("in_progress")) return "In Progress";
  if (value.includes("blocked")) return "Blocked";
  if (value.includes("backlog")) return "Backlog";
  if (value.includes("open")) return "Open";
  if (value.includes("planned")) return "Planned";
  return "Planned";
}

function trackerStatusFromMarkdownCanonical(status) {
  if (status === "Completed") return "Done";
  if (status === "In Progress") return "InProgress";
  if (status === "Blocked") return "Blocked";
  if (status === "Open") return "Ready";
  return "Backlog";
}

function getMarkdownCounts() {
  const counts = { total: 0, byStatus: {} };
  const files = fs
    .readdirSync(TICKETS_DIR)
    .filter((file) => file.toLowerCase().endsWith(".md") && file.toLowerCase() !== "readme.md");

  for (const fileName of files) {
    counts.total += 1;
    const text = fs.readFileSync(path.join(TICKETS_DIR, fileName), "utf8");
    const match =
      text.match(/^\s*(?:\*\*?)?Status(?:\*\*?)?\s*:\s*(.+)\s*$/im);
    const status = canonicalStatus(match ? match[1] : "");
    counts.byStatus[status] = (counts.byStatus[status] || 0) + 1;
  }
  return counts;
}

async function resolveUid(auth, explicitUid, email) {
  if (explicitUid) return explicitUid;
  if (!email) throw new Error("Provide --uid or --email.");
  const user = await auth.getUserByEmail(email);
  return user.uid;
}

async function run() {
  const projectId = readArg("projectId", process.env.GCLOUD_PROJECT || "monsoonfire-portal");
  const uidArg = readArg("uid");
  const email = readArg("email", "monsoonfirepottery@gmail.com");

  if (!admin.apps.length) {
    admin.initializeApp({ projectId });
  }

  const uid = await resolveUid(admin.auth(), uidArg, email);
  const db = admin.firestore();

  const trackerSnap = await db
    .collection("trackerTickets")
    .where("ownerUid", "==", uid)
    .get();

  const trackerCounts = { total: trackerSnap.size, blocked: 0, byStatus: {} };
  trackerSnap.forEach((docSnap) => {
    const row = docSnap.data() || {};
    const status = typeof row.status === "string" ? row.status : "Unknown";
    trackerCounts.byStatus[status] = (trackerCounts.byStatus[status] || 0) + 1;
    if (row.blocked === true) trackerCounts.blocked += 1;
  });

  const markdownCounts = getMarkdownCounts();
  const mappedMarkdownToTracker = {};
  for (const [status, count] of Object.entries(markdownCounts.byStatus)) {
    const mapped = trackerStatusFromMarkdownCanonical(status);
    mappedMarkdownToTracker[mapped] = (mappedMarkdownToTracker[mapped] || 0) + count;
  }

  console.log(
    JSON.stringify(
      {
        uid,
        projectId,
        tracker: trackerCounts,
        markdown: markdownCounts,
        markdownMappedToTrackerStatuses: mappedMarkdownToTracker,
      },
      null,
      2
    )
  );
}

run().catch((error) => {
  console.error("tracker_counts failed", error);
  process.exitCode = 1;
});
