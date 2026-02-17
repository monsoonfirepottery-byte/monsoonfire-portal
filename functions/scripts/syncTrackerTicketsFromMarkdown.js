#!/usr/bin/env node
/*
 * Normalize ticket markdown statuses and sync into Firestore tracker collections.
 *
 * Usage:
 *   node functions/scripts/syncTrackerTicketsFromMarkdown.js --uid <firebase_uid>
 *   node functions/scripts/syncTrackerTicketsFromMarkdown.js --email monsoonfirepottery@gmail.com
 *
 * Optional:
 *   --projectId monsoonfire-portal
 *   --dryRun true
 */

const fs = require("node:fs");
const path = require("node:path");
const admin = require("firebase-admin");

const ROOT = path.resolve(__dirname, "..", "..");
const TICKETS_DIR = path.join(ROOT, "tickets");
const PROJECTS_COLLECTION = "trackerProjects";
const EPICS_COLLECTION = "trackerEpics";
const TICKETS_COLLECTION = "trackerTickets";

const CANONICAL_STATUS_ORDER = ["Backlog", "Planned", "Open", "In Progress", "Blocked", "Completed"];

function readArg(name, fallback = "") {
  const idx = process.argv.findIndex((arg) => arg === `--${name}`);
  if (idx === -1) return fallback;
  const next = process.argv[idx + 1];
  return typeof next === "string" ? next : fallback;
}

function asBool(value, fallback = false) {
  if (!value) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(normalized)) return true;
  if (["0", "false", "no", "n"].includes(normalized)) return false;
  return fallback;
}

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
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

function trackerStatusForCanonical(status) {
  switch (status) {
  case "Completed":
    return "Done";
  case "In Progress":
    return "InProgress";
  case "Blocked":
    return "Blocked";
  case "Backlog":
    return "Backlog";
  case "Open":
    return "Ready";
  case "Planned":
  default:
    return "Backlog";
  }
}

function slugify(value) {
  return String(value || "")
    .replace(/\.md$/i, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .toUpperCase();
}

function parseHeading(lines) {
  for (const line of lines) {
    const match = line.match(/^#\s+(.+)\s*$/);
    if (match) return match[1].trim();
  }
  return null;
}

function parsePriorityFromFilename(fileName) {
  const base = fileName.toUpperCase();
  if (base.startsWith("P0-")) return "P0";
  if (base.startsWith("P1-")) return "P1";
  if (base.startsWith("P2-")) return "P2";
  if (base.startsWith("P3-")) return "P3";
  return "P1";
}

function severityFromPriority(priority) {
  if (priority === "P0") return "Sev1";
  if (priority === "P1") return "Sev2";
  if (priority === "P2") return "Sev3";
  return "Sev4";
}

function impactFromPriority(priority) {
  if (priority === "P0" || priority === "P1") return "high";
  if (priority === "P2") return "med";
  return "low";
}

function detectProjectKey(fileName) {
  const lower = fileName.toLowerCase();
  if (lower.includes("website")) return "WEBSITE";
  return "PORTAL";
}

function detectComponent(fileName) {
  const lower = fileName.toLowerCase();
  if (lower.includes("website")) return "website";
  if (lower.includes("ios") || lower.includes("s12-")) return "ios";
  if (lower.includes("functions") || lower.includes("api") || lower.includes("auth")) return "functions";
  if (lower.includes("security") || lower.includes("cors") || lower.includes("ratelimit")) return "security";
  if (lower.includes("community")) return "community";
  if (lower.includes("agent")) return "agents";
  if (lower.includes("tracker")) return "tracker";
  return "portal";
}

function detectEpicKey(fileName, projectKey) {
  const lower = fileName.toLowerCase();
  if (lower.includes("agent")) return `${projectKey}_AGENTIC_COMMERCE`;
  if (lower.includes("community")) return `${projectKey}_COMMUNITY_TRUST`;
  if (lower.includes("a11y") || lower.includes("accessibility")) return `${projectKey}_ACCESSIBILITY`;
  if (lower.includes("security") || lower.includes("auth") || lower.includes("cors") || lower.includes("ratelimit")) return `${projectKey}_SECURITY`;
  if (lower.includes("ios") || lower.startsWith("s12-")) return `${projectKey}_MOBILE`;
  if (lower.includes("tracker")) return `${projectKey}_TRACKER`;
  if (lower.includes("theme") || lower.includes("memoria") || lower.includes("motion")) return `${projectKey}_THEME_AND_UX`;
  return `${projectKey}_GENERAL`;
}

function epicTitleForKey(epicKey) {
  if (epicKey.endsWith("AGENTIC_COMMERCE")) return "Agentic Commerce";
  if (epicKey.endsWith("COMMUNITY_TRUST")) return "Community Trust & Safety";
  if (epicKey.endsWith("ACCESSIBILITY")) return "Accessibility";
  if (epicKey.endsWith("SECURITY")) return "Security & Platform Hardening";
  if (epicKey.endsWith("MOBILE")) return "Mobile/iOS Readiness";
  if (epicKey.endsWith("TRACKER")) return "Tracker & Delivery Operations";
  if (epicKey.endsWith("THEME_AND_UX")) return "Theme & UX Polish";
  return "General Delivery";
}

function parseSummary(lines) {
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) continue;
    if (/^\*?\*?status\*?\*?\s*:/i.test(trimmed)) continue;
    if (/^(created|sprint|swarm)\s*:/i.test(trimmed)) continue;
    if (trimmed.startsWith("##")) continue;
    if (trimmed.startsWith("- ")) continue;
    return trimmed;
  }
  return "";
}

function parseTags(fileName) {
  return fileName
    .replace(/\.md$/i, "")
    .split(/[^a-zA-Z0-9]+/)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0 && !/^p\d+$/.test(part) && !/^s\d+$/.test(part))
    .slice(0, 8);
}

function normalizeTicketFile(fullPath) {
  const original = normalizeWhitespace(fs.readFileSync(fullPath, "utf8"));
  const lines = original.split("\n");
  const heading = parseHeading(lines) || path.basename(fullPath, ".md");

  let foundStatusIndex = -1;
  let foundStatusRaw = "";
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const match = line.match(/^\s*(?:\*\*?)?Status(?:\*\*?)?\s*:\s*(.+)\s*$/i);
    if (match) {
      foundStatusIndex = i;
      foundStatusRaw = match[1].trim();
      break;
    }
  }

  const canonical = canonicalStatus(foundStatusRaw);
  const normalizedStatusLine = `Status: ${canonical}`;
  let updatedLines = [...lines];

  if (foundStatusIndex >= 0) {
    updatedLines[foundStatusIndex] = normalizedStatusLine;
  } else {
    const headingIndex = updatedLines.findIndex((line) => /^#\s+/.test(line));
    if (headingIndex >= 0) {
      updatedLines.splice(headingIndex + 1, 0, "", normalizedStatusLine);
    } else {
      updatedLines = [heading, "", normalizedStatusLine, "", ...updatedLines];
    }
  }

  const normalized = `${updatedLines.join("\n").replace(/\n+$/, "")}\n`;
  const changed = normalized !== original;
  return {
    changed,
    canonicalStatus: canonical,
    heading,
    normalized,
  };
}

async function resolveUid(auth, explicitUid, email) {
  if (explicitUid) return explicitUid;
  if (!email) throw new Error("Provide --uid or --email.");
  const user = await auth.getUserByEmail(email);
  return user.uid;
}

async function ensureProject(db, uid, projectKey, now) {
  const docId = `${uid}_${projectKey}`;
  const ref = db.collection(PROJECTS_COLLECTION).doc(docId);
  const snap = await ref.get();
  const payload = {
    ownerUid: uid,
    key: projectKey,
    name: projectKey === "WEBSITE" ? "Monsoon Fire Website" : "Monsoon Fire Portal",
    description: projectKey === "WEBSITE" ? "Marketing site delivery backlog." : "Portal product delivery backlog.",
    updatedAt: now,
  };
  if (!snap.exists) payload.createdAt = now;
  await ref.set(payload, { merge: true });
  return docId;
}

async function ensureEpic(db, uid, projectId, projectKey, epicKey, now) {
  const docId = `${uid}_EPIC_${epicKey}`;
  const ref = db.collection(EPICS_COLLECTION).doc(docId);
  const snap = await ref.get();
  const payload = {
    ownerUid: uid,
    projectId,
    title: epicTitleForKey(epicKey),
    description: "Auto-generated from normalized ticket backlog.",
    status: "Ready",
    priority: "P1",
    tags: [projectKey.toLowerCase(), epicKey.toLowerCase()],
    updatedAt: now,
  };
  if (!snap.exists) payload.createdAt = now;
  await ref.set(payload, { merge: true });
  return docId;
}

async function syncTicket(db, uid, fileName, meta, projectId, epicId, now) {
  const docId = `${uid}_TICKET_${slugify(fileName)}`;
  const ref = db.collection(TICKETS_COLLECTION).doc(docId);
  const snap = await ref.get();
  const priority = parsePriorityFromFilename(fileName);
  const trackerStatus = trackerStatusForCanonical(meta.canonicalStatus);
  const blocked = trackerStatus === "Blocked";
  const title = meta.heading.replace(/\s+/g, " ").trim();
  const summary = meta.summary || title;
  const payload = {
    ownerUid: uid,
    trackerVisible: true,
    projectId,
    epicId,
    title,
    description: summary,
    status: trackerStatus,
    priority,
    severity: severityFromPriority(priority),
    component: detectComponent(fileName),
    impact: impactFromPriority(priority),
    tags: parseTags(fileName),
    blocked,
    blockedReason: blocked ? "Status marked blocked in ticket markdown." : null,
    blockedByTicketId: null,
    links: [`tickets/${fileName}`],
    updatedAt: now,
    closedAt: trackerStatus === "Done" ? now : null,
  };

  if (!snap.exists) {
    payload.githubIssue = null;
    payload.githubPRs = [];
    payload.createdAt = now;
  }

  await ref.set(payload, { merge: true });
  return { docId, trackerStatus };
}

async function run() {
  const projectId = readArg("projectId", process.env.GCLOUD_PROJECT || "monsoonfire-portal");
  const uidArg = readArg("uid");
  const email = readArg("email", "monsoonfirepottery@gmail.com");
  const dryRun = asBool(readArg("dryRun"), false);

  if (!admin.apps.length) {
    admin.initializeApp({ projectId });
  }

  const uid = await resolveUid(admin.auth(), uidArg, email);
  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();

  const files = fs
    .readdirSync(TICKETS_DIR)
    .filter((file) => file.toLowerCase().endsWith(".md") && file.toLowerCase() !== "readme.md")
    .sort((a, b) => a.localeCompare(b));

  const statusCounts = new Map();
  let changedFiles = 0;
  const perFileMeta = [];

  for (const fileName of files) {
    const fullPath = path.join(TICKETS_DIR, fileName);
    const normalized = normalizeTicketFile(fullPath);
    const lines = normalized.normalized.split("\n");
    const summary = parseSummary(lines);

    perFileMeta.push({
      fileName,
      canonicalStatus: normalized.canonicalStatus,
      heading: normalized.heading,
      summary,
      changed: normalized.changed,
    });

    statusCounts.set(
      normalized.canonicalStatus,
      (statusCounts.get(normalized.canonicalStatus) || 0) + 1
    );

    if (normalized.changed && !dryRun) {
      fs.writeFileSync(fullPath, normalized.normalized, "utf8");
      changedFiles += 1;
    } else if (normalized.changed) {
      changedFiles += 1;
    }
  }

  const projectMap = {};
  const epicMap = {};
  const syncedByTrackerStatus = {};
  let syncedTickets = 0;

  if (!dryRun) {
    for (const item of perFileMeta) {
      const projectKey = detectProjectKey(item.fileName);
      if (!projectMap[projectKey]) {
        projectMap[projectKey] = await ensureProject(db, uid, projectKey, now);
      }

      const epicKey = detectEpicKey(item.fileName, projectKey);
      const epicCacheKey = `${projectKey}:${epicKey}`;
      if (!epicMap[epicCacheKey]) {
        epicMap[epicCacheKey] = await ensureEpic(
          db,
          uid,
          projectMap[projectKey],
          projectKey,
          epicKey,
          now
        );
      }

      const out = await syncTicket(
        db,
        uid,
        item.fileName,
        item,
        projectMap[projectKey],
        epicMap[epicCacheKey],
        now
      );

      syncedByTrackerStatus[out.trackerStatus] =
        (syncedByTrackerStatus[out.trackerStatus] || 0) + 1;
      syncedTickets += 1;
    }
  }

  const trackerSnap = !dryRun
    ? await db.collection(TICKETS_COLLECTION).where("ownerUid", "==", uid).get()
    : null;
  const trackerCounts = {};
  if (trackerSnap) {
    trackerSnap.forEach((docSnap) => {
      const data = docSnap.data() || {};
      const status = typeof data.status === "string" ? data.status : "Unknown";
      trackerCounts[status] = (trackerCounts[status] || 0) + 1;
    });
  }

  const orderedStatusCounts = {};
  for (const key of CANONICAL_STATUS_ORDER) {
    if (statusCounts.has(key)) {
      orderedStatusCounts[key] = statusCounts.get(key);
    }
  }

  console.log(
    JSON.stringify(
      {
        uid,
        projectId,
        dryRun,
        markdownFiles: files.length,
        markdownStatusCounts: orderedStatusCounts,
        markdownChangedFiles: changedFiles,
        syncedTickets,
        syncedByTrackerStatus,
        trackerCounts,
      },
      null,
      2
    )
  );
}

run().catch((error) => {
  console.error("syncTrackerTicketsFromMarkdown failed", error);
  process.exitCode = 1;
});
