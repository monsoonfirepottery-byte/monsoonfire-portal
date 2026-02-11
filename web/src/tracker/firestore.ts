import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
  type Timestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import type {
  FirestoreQueryTrace,
  FirestoreWriteTrace,
  IntegrationHealth,
  Priority,
  Severity,
  TicketStatus,
  TrackerEpic,
  TrackerProject,
  TrackerTicket,
} from "./types";

const PROJECTS_COLLECTION = "trackerProjects";
const EPICS_COLLECTION = "trackerEpics";
const TICKETS_COLLECTION = "trackerTickets";
const INTEGRATION_HEALTH_COLLECTION = "trackerIntegrationHealth";

export type TrackerDiagnosticsCallbacks = {
  onWrite?: (event: FirestoreWriteTrace) => void;
  onQuery?: (event: FirestoreQueryTrace) => void;
};

type TicketPatch = Partial<{
  epicId: string | null;
  title: string;
  description: string | null;
  status: TicketStatus;
  priority: Priority;
  severity: Severity;
  component: string;
  impact: "low" | "med" | "high";
  tags: string[];
  blocked: boolean;
  blockedReason: string | null;
  blockedByTicketId: string | null;
  links: string[];
  githubIssue: TrackerTicket["githubIssue"];
  githubPRs: TrackerTicket["githubPRs"];
  closedAtMs: number | null;
}>;

function nowIso() {
  return new Date().toISOString();
}

function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function readStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function readBool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readTimestampMs(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && "toMillis" in value && typeof (value as Timestamp).toMillis === "function") {
    return (value as Timestamp).toMillis();
  }
  if (value && typeof value === "object" && "seconds" in value && "nanoseconds" in value) {
    const ts = value as { seconds?: unknown; nanoseconds?: unknown };
    const sec = typeof ts.seconds === "number" ? ts.seconds : 0;
    const nanos = typeof ts.nanoseconds === "number" ? ts.nanoseconds : 0;
    return Math.floor(sec * 1000 + nanos / 1_000_000);
  }
  return 0;
}

function mapGithubRef(raw: unknown): TrackerTicket["githubIssue"] {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const owner = readString(data.owner);
  const repo = readString(data.repo);
  const number = readNumber(data.number);
  const url = readString(data.url);
  if (!owner || !repo || !number || !url) return null;

  return {
    owner,
    repo,
    number,
    url,
    title: readStringOrNull(data.title),
    state: readStringOrNull(data.state),
    merged: typeof data.merged === "boolean" ? data.merged : undefined,
    lastSyncedAtMs: readTimestampMs(data.lastSyncedAt),
  };
}

function mapGithubPrArray(raw: unknown): TrackerTicket["githubPRs"] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => mapGithubRef(item))
    .filter((item): item is NonNullable<TrackerTicket["githubIssue"]> => item !== null);
}

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => stripUndefined(entry)) as T;
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (child === undefined) continue;
      output[key] = stripUndefined(child);
    }
    return output as T;
  }
  return value;
}

function mapProjectDoc(snap: QueryDocumentSnapshot<DocumentData>): TrackerProject {
  const data = snap.data();
  return {
    id: snap.id,
    ownerUid: readString(data.ownerUid),
    key: readString(data.key),
    name: readString(data.name),
    description: readStringOrNull(data.description),
    createdAtMs: readTimestampMs(data.createdAt),
    updatedAtMs: readTimestampMs(data.updatedAt),
  };
}

function mapEpicDoc(snap: QueryDocumentSnapshot<DocumentData>): TrackerEpic {
  const data = snap.data();
  return {
    id: snap.id,
    ownerUid: readString(data.ownerUid),
    projectId: readString(data.projectId),
    title: readString(data.title),
    description: readStringOrNull(data.description),
    status: (readString(data.status, "Backlog") as TicketStatus),
    priority: (readStringOrNull(data.priority) as Priority | null),
    tags: readStringArray(data.tags),
    createdAtMs: readTimestampMs(data.createdAt),
    updatedAtMs: readTimestampMs(data.updatedAt),
  };
}

function mapTicketDoc(snap: QueryDocumentSnapshot<DocumentData>): TrackerTicket {
  const data = snap.data();
  return {
    id: snap.id,
    ownerUid: readString(data.ownerUid),
    trackerVisible: typeof data.trackerVisible === "boolean" ? data.trackerVisible : true,
    projectId: readString(data.projectId),
    epicId: readStringOrNull(data.epicId),
    title: readString(data.title),
    description: readStringOrNull(data.description),
    status: readString(data.status, "Backlog") as TicketStatus,
    priority: readString(data.priority, "P2") as Priority,
    severity: readString(data.severity, "Sev3") as Severity,
    component: readString(data.component, "portal"),
    impact: readString(data.impact, "med") as "low" | "med" | "high",
    tags: readStringArray(data.tags),
    blocked: readBool(data.blocked),
    blockedReason: readStringOrNull(data.blockedReason),
    blockedByTicketId: readStringOrNull(data.blockedByTicketId),
    links: readStringArray(data.links),
    githubIssue: mapGithubRef(data.githubIssue),
    githubPRs: mapGithubPrArray(data.githubPRs),
    createdAtMs: readTimestampMs(data.createdAt),
    updatedAtMs: readTimestampMs(data.updatedAt),
    closedAtMs: readTimestampMs(data.closedAt),
  };
}

function mapIntegrationHealth(uid: string, data: DocumentData | undefined): IntegrationHealth {
  if (!data) {
    return {
      ownerUid: uid,
      lastSuccessAtMs: null,
      lastFailureAtMs: null,
      lastFailureMessage: null,
      lastSyncStatus: null,
      updatedAtMs: null,
    };
  }
  return {
    ownerUid: uid,
    lastSuccessAtMs: readTimestampMs(data.lastSuccessAt),
    lastFailureAtMs: readTimestampMs(data.lastFailureAt),
    lastFailureMessage: readStringOrNull(data.lastFailureMessage),
    lastSyncStatus: typeof data.lastSyncStatus === "number" ? data.lastSyncStatus : null,
    updatedAtMs: readTimestampMs(data.updatedAt),
  };
}

function recordQuery(
  callbacks: TrackerDiagnosticsCallbacks | undefined,
  collectionName: string,
  params: Record<string, unknown>
) {
  callbacks?.onQuery?.({
    atIso: nowIso(),
    collection: collectionName,
    params,
  });
}

function recordWrite(
  callbacks: TrackerDiagnosticsCallbacks | undefined,
  collectionName: string,
  docId: string,
  payload: unknown
) {
  callbacks?.onWrite?.({
    atIso: nowIso(),
    collection: collectionName,
    docId,
    payload,
  });
}

export async function listProjects(uid: string, callbacks?: TrackerDiagnosticsCallbacks): Promise<TrackerProject[]> {
  const q = query(collection(db, PROJECTS_COLLECTION), where("ownerUid", "==", uid));
  recordQuery(callbacks, PROJECTS_COLLECTION, { ownerUid: uid });
  const snaps = await getDocs(q);
  return snaps.docs.map(mapProjectDoc).sort((a, b) => b.updatedAtMs - a.updatedAtMs);
}

export async function listEpics(uid: string, callbacks?: TrackerDiagnosticsCallbacks): Promise<TrackerEpic[]> {
  const q = query(collection(db, EPICS_COLLECTION), where("ownerUid", "==", uid));
  recordQuery(callbacks, EPICS_COLLECTION, { ownerUid: uid });
  const snaps = await getDocs(q);
  return snaps.docs.map(mapEpicDoc).sort((a, b) => b.updatedAtMs - a.updatedAtMs);
}

export async function listTicketsByStatus(
  uid: string,
  status: TicketStatus,
  callbacks?: TrackerDiagnosticsCallbacks
): Promise<TrackerTicket[]> {
  // Composite indexes expected in firestore.indexes.json:
  // (ownerUid + status + updatedAt desc) and (ownerUid + projectId + status + updatedAt desc).
  const q = query(
    collection(db, TICKETS_COLLECTION),
    where("ownerUid", "==", uid),
    where("status", "==", status)
  );
  recordQuery(callbacks, TICKETS_COLLECTION, { ownerUid: uid, status, sort: "updatedAt:desc(client)" });
  const snaps = await getDocs(q);
  return snaps.docs.map(mapTicketDoc).sort((a, b) => b.updatedAtMs - a.updatedAtMs);
}

export async function listTickets(
  uid: string,
  callbacks?: TrackerDiagnosticsCallbacks
): Promise<TrackerTicket[]> {
  const q = query(collection(db, TICKETS_COLLECTION), where("ownerUid", "==", uid));
  recordQuery(callbacks, TICKETS_COLLECTION, { ownerUid: uid, sort: "updatedAt:desc(client)" });
  const snaps = await getDocs(q);
  return snaps.docs.map(mapTicketDoc).sort((a, b) => b.updatedAtMs - a.updatedAtMs);
}

export async function createProject(
  uid: string,
  input: { key: string; name: string; description: string | null },
  callbacks?: TrackerDiagnosticsCallbacks
): Promise<void> {
  const payload = stripUndefined({
    ownerUid: uid,
    key: input.key.toUpperCase(),
    name: input.name,
    description: input.description,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const ref = doc(collection(db, PROJECTS_COLLECTION));
  recordWrite(callbacks, PROJECTS_COLLECTION, ref.id, payload);
  await setDoc(ref, payload);
}

export async function createEpic(
  uid: string,
  input: {
    projectId: string;
    title: string;
    description: string | null;
    status: TicketStatus;
    priority: Priority | null;
    tags: string[];
  },
  callbacks?: TrackerDiagnosticsCallbacks
): Promise<void> {
  const payload = stripUndefined({
    ownerUid: uid,
    projectId: input.projectId,
    title: input.title,
    description: input.description,
    status: input.status,
    priority: input.priority,
    tags: input.tags,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const ref = doc(collection(db, EPICS_COLLECTION));
  recordWrite(callbacks, EPICS_COLLECTION, ref.id, payload);
  await setDoc(ref, payload);
}

export async function createTicket(
  uid: string,
  input: {
    projectId: string;
    epicId: string | null;
    title: string;
    description: string | null;
    status: TicketStatus;
    priority: Priority;
    severity: Severity;
    component: string;
    impact: "low" | "med" | "high";
    tags: string[];
    blocked: boolean;
    blockedReason: string | null;
    blockedByTicketId: string | null;
    links: string[];
  },
  callbacks?: TrackerDiagnosticsCallbacks
): Promise<void> {
  const payload = stripUndefined({
    ownerUid: uid,
    trackerVisible: true,
    projectId: input.projectId,
    epicId: input.epicId,
    title: input.title,
    description: input.description,
    status: input.status,
    priority: input.priority,
    severity: input.severity,
    component: input.component,
    impact: input.impact,
    tags: input.tags,
    blocked: input.blocked,
    blockedReason: input.blockedReason,
    blockedByTicketId: input.blockedByTicketId,
    links: input.links,
    githubIssue: null,
    githubPRs: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    closedAt: input.status === "Done" ? serverTimestamp() : null,
  });

  const ref = doc(collection(db, TICKETS_COLLECTION));
  recordWrite(callbacks, TICKETS_COLLECTION, ref.id, payload);
  await setDoc(ref, payload);
}

export async function updateTicket(ticketId: string, patch: TicketPatch, callbacks?: TrackerDiagnosticsCallbacks): Promise<void> {
  const ref = doc(db, TICKETS_COLLECTION, ticketId);
  const payload = stripUndefined({
    trackerVisible: true,
    ...patch,
    updatedAt: serverTimestamp(),
    closedAt:
      patch.closedAtMs === undefined
        ? patch.status === "Done"
          ? serverTimestamp()
          : patch.status
            ? null
            : undefined
        : typeof patch.closedAtMs === "number" && patch.closedAtMs > 0
          ? new Date(patch.closedAtMs)
          : null,
  });

  recordWrite(callbacks, TICKETS_COLLECTION, ticketId, payload);
  await updateDoc(ref, payload);
}

export async function addTicketComment(
  ticketId: string,
  body: string,
  callbacks?: TrackerDiagnosticsCallbacks
): Promise<void> {
  const payload = stripUndefined({
    body,
    createdAt: serverTimestamp(),
  });
  const commentsRef = collection(db, TICKETS_COLLECTION, ticketId, "comments");
  const created = await addDoc(commentsRef, payload);
  recordWrite(callbacks, `${TICKETS_COLLECTION}/${ticketId}/comments`, created.id, payload);
}

export async function addTicketActivity(
  ticketId: string,
  type: string,
  payload: unknown,
  callbacks?: TrackerDiagnosticsCallbacks
): Promise<void> {
  const activityPayload = stripUndefined({
    type,
    at: serverTimestamp(),
    payload: payload ?? null,
  });
  const activityRef = collection(db, TICKETS_COLLECTION, ticketId, "activity");
  const created = await addDoc(activityRef, activityPayload);
  recordWrite(callbacks, `${TICKETS_COLLECTION}/${ticketId}/activity`, created.id, activityPayload);
}

export async function getIntegrationHealth(uid: string, callbacks?: TrackerDiagnosticsCallbacks): Promise<IntegrationHealth> {
  const ref = doc(db, INTEGRATION_HEALTH_COLLECTION, uid);
  recordQuery(callbacks, INTEGRATION_HEALTH_COLLECTION, { ownerUid: uid, docId: uid });
  const snap = await getDoc(ref);
  return mapIntegrationHealth(uid, snap.data());
}

export async function upsertIntegrationHealth(
  uid: string,
  input: {
    lastSuccessAtMs?: number | null;
    lastFailureAtMs?: number | null;
    lastFailureMessage?: string | null;
    lastSyncStatus?: number | null;
  },
  callbacks?: TrackerDiagnosticsCallbacks
): Promise<void> {
  const ref = doc(db, INTEGRATION_HEALTH_COLLECTION, uid);
  const payload = stripUndefined({
    ownerUid: uid,
    lastSuccessAt: input.lastSuccessAtMs && input.lastSuccessAtMs > 0 ? new Date(input.lastSuccessAtMs) : null,
    lastFailureAt: input.lastFailureAtMs && input.lastFailureAtMs > 0 ? new Date(input.lastFailureAtMs) : null,
    lastFailureMessage: input.lastFailureMessage ?? null,
    lastSyncStatus: input.lastSyncStatus ?? null,
    updatedAt: serverTimestamp(),
  });

  recordWrite(callbacks, INTEGRATION_HEALTH_COLLECTION, uid, payload);
  await setDoc(ref, payload, { merge: true });
}

export async function seedTrackerStarterData(
  uid: string,
  callbacks?: TrackerDiagnosticsCallbacks
): Promise<void> {
  const now = serverTimestamp();

  const portalProjectRef = doc(db, PROJECTS_COLLECTION, `${uid}_PORTAL`);
  const websiteProjectRef = doc(db, PROJECTS_COLLECTION, `${uid}_WEBSITE`);

  const portalProjectPayload = stripUndefined({
    ownerUid: uid,
    key: "PORTAL",
    name: "Monsoon Fire Portal",
    description: "Product app: kiln workflow, member operations, internal tools.",
    createdAt: now,
    updatedAt: now,
  });

  const websiteProjectPayload = stripUndefined({
    ownerUid: uid,
    key: "WEBSITE",
    name: "Monsoon Fire Website",
    description: "Marketing site, SEO, content, and conversion path.",
    createdAt: now,
    updatedAt: now,
  });

  recordWrite(callbacks, PROJECTS_COLLECTION, portalProjectRef.id, portalProjectPayload);
  await setDoc(portalProjectRef, portalProjectPayload, { merge: true });
  recordWrite(callbacks, PROJECTS_COLLECTION, websiteProjectRef.id, websiteProjectPayload);
  await setDoc(websiteProjectRef, websiteProjectPayload, { merge: true });

  const epicSeeds = [
    {
      id: `${uid}_EPIC_PORTAL_STABILITY`,
      projectId: portalProjectRef.id,
      title: "Portal Stability and Safety Rails",
      description: "Guardrails, no blank screens, and resilient core flows.",
      status: "InProgress" as TicketStatus,
      priority: "P1" as Priority,
      tags: ["portal", "stability"],
    },
    {
      id: `${uid}_EPIC_PORTAL_TRACKER`,
      projectId: portalProjectRef.id,
      title: "Internal Tracker MVP",
      description: "Kanban-first internal tracker with GitHub metadata linking.",
      status: "Ready" as TicketStatus,
      priority: "P1" as Priority,
      tags: ["tracker", "portal"],
    },
    {
      id: `${uid}_EPIC_WEBSITE_POLISH`,
      projectId: websiteProjectRef.id,
      title: "Website UX and Content Polish",
      description: "Accessibility, content clarity, and performance hygiene.",
      status: "Backlog" as TicketStatus,
      priority: "P2" as Priority,
      tags: ["website", "ux", "content"],
    },
  ];

  for (const epic of epicSeeds) {
    const epicRef = doc(db, EPICS_COLLECTION, epic.id);
    const epicPayload = stripUndefined({
      ownerUid: uid,
      projectId: epic.projectId,
      title: epic.title,
      description: epic.description,
      status: epic.status,
      priority: epic.priority,
      tags: epic.tags,
      createdAt: now,
      updatedAt: now,
    });

    recordWrite(callbacks, EPICS_COLLECTION, epicRef.id, epicPayload);
    await setDoc(epicRef, epicPayload, { merge: true });
  }

  const ticketSeeds = [
    {
      id: `${uid}_TICKET_PORTAL_STABILITY`,
      projectId: portalProjectRef.id,
      epicId: `${uid}_EPIC_PORTAL_STABILITY`,
      title: "Audit no-blank-screen guardrails in tracker + portal shell",
      description: "Verify ErrorBoundary and explicit error UI on critical entry points.",
      status: "InProgress" as TicketStatus,
      priority: "P1" as Priority,
      severity: "Sev2" as Severity,
      component: "portal",
      impact: "high" as const,
      tags: ["tracker", "stability"],
      blocked: false,
      blockedReason: null,
      blockedByTicketId: null,
      links: ["docs/API_CONTRACTS.md"],
    },
    {
      id: `${uid}_TICKET_WEBSITE_A11Y`,
      projectId: websiteProjectRef.id,
      epicId: `${uid}_EPIC_WEBSITE_POLISH`,
      title: "Website accessibility pass on nav + CTA hierarchy",
      description: "Validate keyboard flow and color contrast in top conversion pages.",
      status: "Ready" as TicketStatus,
      priority: "P2" as Priority,
      severity: "Sev3" as Severity,
      component: "website",
      impact: "med" as const,
      tags: ["website", "a11y"],
      blocked: false,
      blockedReason: null,
      blockedByTicketId: null,
      links: ["tickets/P1-a11y-nav-chips.md"],
    },
    {
      id: `${uid}_TICKET_GH_SYNC`,
      projectId: portalProjectRef.id,
      epicId: `${uid}_EPIC_PORTAL_TRACKER`,
      title: "Validate GitHub metadata refresh on linked issues",
      description: "Confirm link + refresh workflows update title/state and integration health widget.",
      status: "Backlog" as TicketStatus,
      priority: "P1" as Priority,
      severity: "Sev3" as Severity,
      component: "functions",
      impact: "med" as const,
      tags: ["github", "tracker"],
      blocked: false,
      blockedReason: null,
      blockedByTicketId: null,
      links: ["tickets/P2-portal-integrations-ui.md"],
    },
  ];

  for (const ticket of ticketSeeds) {
    const ticketRef = doc(db, TICKETS_COLLECTION, ticket.id);
    const ticketPayload = stripUndefined({
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
      blocked: ticket.blocked,
      blockedReason: ticket.blockedReason,
      blockedByTicketId: ticket.blockedByTicketId,
      links: ticket.links,
      githubIssue: null,
      githubPRs: [],
      createdAt: now,
      updatedAt: now,
      closedAt: null,
    });

    recordWrite(callbacks, TICKETS_COLLECTION, ticketRef.id, ticketPayload);
    await setDoc(ticketRef, ticketPayload, { merge: true });
  }
}
