import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readEnv } from "../config/env";

export type FirestoreReadModel = {
  readAt: string;
  durationMs?: number;
  completeness?: "full" | "partial";
  warnings?: string[];
  failedCollections?: string[];
  truncatedCollections?: string[];
  counts: {
    batchesActive: number;
    batchesClosed: number;
    reservationsOpen: number;
    firingsScheduled: number;
    reportsOpen: number;
    blockedTickets: number;
    agentRequestsPending: number;
    highSeverityReports: number;
    pendingOrders: number;
  };
  sourceSample: {
    batchesScanned: number;
    reservationsScanned: number;
    firingsScanned: number;
    reportsScanned: number;
  };
};

function ensureFirebaseAdmin(projectId?: string): void {
  if (getApps().length > 0) return;
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    initializeApp();
    return;
  }
  if (projectId) {
    initializeApp({ projectId });
    return;
  }
  initializeApp();
}

function isClosedBatch(state: unknown): boolean {
  const s = typeof state === "string" ? state : "";
  return s.startsWith("CLOSED_");
}

type RowDoc = {
  data: () => Record<string, unknown>;
};

type CollectionRead = {
  name: string;
  docs: RowDoc[];
  size: number;
  durationMs: number;
  truncated: boolean;
};

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        if (typeof timer.unref === "function") timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function safeReadCollection(params: {
  name: string;
  fields: string[];
  scanLimit: number;
  queryTimeoutMs: number;
  warnings: string[];
}): Promise<CollectionRead> {
  const { name, fields, scanLimit, queryTimeoutMs, warnings } = params;
  const db = getFirestore();
  const startedAt = Date.now();
  try {
    let query = db.collection(name).limit(scanLimit);
    if (fields.length > 0) {
      query = query.select(...fields);
    }
    const snapshot = await withTimeout(query.get(), queryTimeoutMs, `collection ${name}`);
    return {
      name,
      docs: snapshot.docs.map((doc) => ({ data: () => doc.data() as Record<string, unknown> })),
      size: snapshot.size,
      durationMs: Date.now() - startedAt,
      truncated: snapshot.size >= scanLimit,
    };
  } catch (error) {
    warnings.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    return {
      name,
      docs: [],
      size: 0,
      durationMs: Date.now() - startedAt,
      truncated: false,
    };
  }
}

export async function readFirestoreModel(projectId?: string, scanLimitOverride?: number): Promise<FirestoreReadModel> {
  const startedAt = Date.now();
  ensureFirebaseAdmin(projectId);
  const env = readEnv();
  const scanLimit = scanLimitOverride ?? env.STUDIO_BRAIN_SCAN_LIMIT;
  const queryTimeoutMs = env.STUDIO_BRAIN_FIRESTORE_QUERY_TIMEOUT_MS;
  const warnings: string[] = [];

  const [
    batchesRead,
    reservationsRead,
    firingsRead,
    reportsRead,
    trackerRead,
    agentRequestsRead,
    ordersRead,
  ] = await Promise.all([
    safeReadCollection({
      name: "batches",
      fields: ["state"],
      scanLimit,
      queryTimeoutMs,
      warnings,
    }),
    safeReadCollection({
      name: "reservations",
      fields: ["status"],
      scanLimit,
      queryTimeoutMs,
      warnings,
    }),
    safeReadCollection({
      name: "kilnFirings",
      fields: ["status"],
      scanLimit,
      queryTimeoutMs,
      warnings,
    }),
    safeReadCollection({
      name: "communityReports",
      fields: ["status", "severity"],
      scanLimit,
      queryTimeoutMs,
      warnings,
    }),
    safeReadCollection({
      name: "trackerTickets",
      fields: ["blocked"],
      scanLimit,
      queryTimeoutMs,
      warnings,
    }),
    safeReadCollection({
      name: "agentRequests",
      fields: ["status"],
      scanLimit,
      queryTimeoutMs,
      warnings,
    }),
    safeReadCollection({
      name: "materialsOrders",
      fields: ["status"],
      scanLimit,
      queryTimeoutMs,
      warnings,
    }),
  ]);

  let batchesActive = 0;
  let batchesClosed = 0;
  for (const doc of batchesRead.docs) {
    const row = doc.data();
    if (isClosedBatch(row.state)) batchesClosed += 1;
    else batchesActive += 1;
  }

  let reservationsOpen = 0;
  for (const doc of reservationsRead.docs) {
    const status = String(doc.data().status ?? "");
    if (!["CANCELLED", "COMPLETED", "DECLINED", "CLOSED"].includes(status.toUpperCase())) {
      reservationsOpen += 1;
    }
  }

  let firingsScheduled = 0;
  for (const doc of firingsRead.docs) {
    const status = String(doc.data().status ?? "").toLowerCase();
    if (["queued", "scheduled", "loaded", "firing", "cooling", "ready"].includes(status)) firingsScheduled += 1;
  }

  let reportsOpen = 0;
  let highSeverityReports = 0;
  for (const doc of reportsRead.docs) {
    const row = doc.data();
    const status = String(row.status ?? "open").toLowerCase();
    const severity = String(row.severity ?? "low").toLowerCase();
    if (["open", "triaged", "actioned"].includes(status)) reportsOpen += 1;
    if (severity === "high") highSeverityReports += 1;
  }

  let blockedTickets = 0;
  for (const doc of trackerRead.docs) {
    if (doc.data().blocked === true) blockedTickets += 1;
  }

  let agentRequestsPending = 0;
  for (const doc of agentRequestsRead.docs) {
    const status = String(doc.data().status ?? "pending").toLowerCase();
    if (["pending", "needs_review", "awaiting_payment"].includes(status)) agentRequestsPending += 1;
  }

  let pendingOrders = 0;
  for (const doc of ordersRead.docs) {
    const status = String(doc.data().status ?? "").toLowerCase();
    if (!["paid", "cancelled", "fulfilled", "completed"].includes(status)) pendingOrders += 1;
  }

  const truncatedCollections = [
    batchesRead,
    reservationsRead,
    firingsRead,
    reportsRead,
    trackerRead,
    agentRequestsRead,
    ordersRead,
  ]
    .filter((item) => item.truncated)
    .map((item) => item.name);
  if (truncatedCollections.length > 0) {
    warnings.push(`sample_limit_reached: ${truncatedCollections.join(",")}`);
  }
  const failedCollections = warnings
    .map((item) => item.split(":")[0].trim())
    .filter((name) => name && name !== "sample_limit_reached");

  return {
    readAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    completeness: warnings.length > 0 || truncatedCollections.length > 0 ? "partial" : "full",
    warnings,
    failedCollections,
    truncatedCollections,
    counts: {
      batchesActive,
      batchesClosed,
      reservationsOpen,
      firingsScheduled,
      reportsOpen,
      blockedTickets,
      agentRequestsPending,
      highSeverityReports,
      pendingOrders,
    },
    sourceSample: {
      batchesScanned: batchesRead.size,
      reservationsScanned: reservationsRead.size,
      firingsScanned: firingsRead.size,
      reportsScanned: reportsRead.size,
    },
  };
}
