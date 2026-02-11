#!/usr/bin/env node
/*
 * Seed minimal Project Tracker data for a single user.
 *
 * Usage:
 *   node functions/scripts/seedTracker.js --uid <firebase_uid> [--projectId monsoonfire-portal]
 *
 * Optional env:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
 */

const admin = require("firebase-admin");

function readArg(name, fallback = "") {
  const idx = process.argv.findIndex((arg) => arg === `--${name}`);
  if (idx === -1) return fallback;
  const next = process.argv[idx + 1];
  return typeof next === "string" ? next : fallback;
}

async function run() {
  const uid = readArg("uid");
  const projectId = readArg("projectId", process.env.GCLOUD_PROJECT || "monsoonfire-portal");

  if (!uid) {
    throw new Error("Missing --uid. Example: node functions/scripts/seedTracker.js --uid abc123");
  }

  if (!admin.apps.length) {
    admin.initializeApp({ projectId });
  }

  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();

  const portalProjectRef = db.collection("trackerProjects").doc(`${uid}_PORTAL`);
  const websiteProjectRef = db.collection("trackerProjects").doc(`${uid}_WEBSITE`);

  await portalProjectRef.set(
    {
      ownerUid: uid,
      key: "PORTAL",
      name: "Monsoon Fire Portal",
      description: "Product app: kiln batch workflow + member operations.",
      createdAt: now,
      updatedAt: now,
    },
    { merge: true }
  );

  await websiteProjectRef.set(
    {
      ownerUid: uid,
      key: "WEBSITE",
      name: "Monsoon Fire Website",
      description: "Marketing site and public content platform.",
      createdAt: now,
      updatedAt: now,
    },
    { merge: true }
  );

  const epicSeeds = [
    {
      id: `${uid}_EPIC_PORTAL_STABILITY`,
      projectId: portalProjectRef.id,
      title: "Portal Stability and Safety Rails",
      description: "Guardrails, no blank screens, and reliable kiln operations.",
      status: "InProgress",
      priority: "P1",
      tags: ["portal", "stability"],
    },
    {
      id: `${uid}_EPIC_PORTAL_TRACKER`,
      projectId: portalProjectRef.id,
      title: "Internal Tracker MVP",
      description: "Kanban-first internal progress tracker with GitHub linking.",
      status: "Ready",
      priority: "P1",
      tags: ["tracker", "portal"],
    },
    {
      id: `${uid}_EPIC_WEBSITE_POLISH`,
      projectId: websiteProjectRef.id,
      title: "Website UX and Content Polish",
      description: "Improve content quality, accessibility, and conversion clarity.",
      status: "Backlog",
      priority: "P2",
      tags: ["website", "ux", "content"],
    },
  ];

  for (const epic of epicSeeds) {
    await db
      .collection("trackerEpics")
      .doc(epic.id)
      .set(
        {
          ownerUid: uid,
          projectId: epic.projectId,
          title: epic.title,
          description: epic.description,
          status: epic.status,
          priority: epic.priority,
          tags: epic.tags,
          createdAt: now,
          updatedAt: now,
        },
        { merge: true }
      );
  }

  const ticketSeeds = [
    {
      id: `${uid}_TICKET_PORTAL_STABILITY`,
      projectId: portalProjectRef.id,
      epicId: `${uid}_EPIC_PORTAL_STABILITY`,
      title: "Audit no-blank-screen guardrails in tracker + portal shell",
      description: "Verify ErrorBoundary and explicit error UI on critical entry points.",
      status: "InProgress",
      priority: "P1",
      severity: "Sev2",
      component: "portal",
      impact: "high",
      tags: ["tracker", "stability"],
      links: ["docs/API_CONTRACTS.md"],
    },
    {
      id: `${uid}_TICKET_WEBSITE_A11Y`,
      projectId: websiteProjectRef.id,
      epicId: `${uid}_EPIC_WEBSITE_POLISH`,
      title: "Website accessibility pass on nav + CTA hierarchy",
      description: "Validate keyboard flow and contrast in top conversion pages.",
      status: "Ready",
      priority: "P2",
      severity: "Sev3",
      component: "website",
      impact: "med",
      tags: ["website", "a11y"],
      links: ["tickets/P1-a11y-nav-chips.md"],
    },
    {
      id: `${uid}_TICKET_GH_SYNC`,
      projectId: portalProjectRef.id,
      epicId: `${uid}_EPIC_PORTAL_TRACKER`,
      title: "Validate GitHub metadata refresh on linked issues",
      description: "Confirm link + refresh updates title/state and integration health widget.",
      status: "Backlog",
      priority: "P1",
      severity: "Sev3",
      component: "functions",
      impact: "med",
      tags: ["github", "tracker"],
      links: ["tickets/P2-portal-integrations-ui.md"],
    },
  ];

  for (const ticket of ticketSeeds) {
    await db
      .collection("trackerTickets")
      .doc(ticket.id)
      .set(
        {
          ownerUid: uid,
          trackerVisible: true,
          projectId: ticket.projectId,
          epicId: ticket.epicId,
          title: ticket.title,
          description: ticket.description,
          status: ticket.status,
          priority: ticket.priority,
          severity: ticket.severity,
          component: ticket.component,
          impact: ticket.impact,
          tags: ticket.tags,
          blocked: false,
          blockedReason: null,
          blockedByTicketId: null,
          links: ticket.links,
          githubIssue: null,
          githubPRs: [],
          createdAt: now,
          updatedAt: now,
          closedAt: null,
        },
        { merge: true }
      );
  }

  console.log("Seeded tracker projects, epics, and tickets", {
    uid,
    projectId,
    projects: [portalProjectRef.id, websiteProjectRef.id],
    epics: epicSeeds.map((entry) => entry.id),
    tickets: ticketSeeds.map((entry) => entry.id),
    firestoreEmulatorHost: process.env.FIRESTORE_EMULATOR_HOST || null,
  });
}

run().catch((error) => {
  console.error("seedTracker failed", error);
  process.exitCode = 1;
});
