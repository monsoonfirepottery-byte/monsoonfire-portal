import {
  addDoc,
  deleteDoc,
  getDoc,
  getDocs,
  onSnapshot,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { safeStorageSetItem } from "./safeStorage";

type CounterBucket = {
  reads: number;
  writes: number;
  deletes: number;
  listenerEvents: number;
  listenerReads: number;
};

type TelemetryEvent = {
  atMs: number;
  view: string;
  kind: keyof CounterBucket;
  count: number;
};

type SnapshotLike = {
  size?: number;
  docs?: Array<{
    id: string;
    data: () => unknown;
  }>;
  docChanges?: () => Array<unknown>;
};

const SUMMARY_STORAGE_KEY = "mf_firestore_telemetry:last";
const MAX_EVENTS = 500;
const LAST_WINDOW_MS = 60_000;

const sessionTotals: CounterBucket = {
  reads: 0,
  writes: 0,
  deletes: 0,
  listenerEvents: 0,
  listenerReads: 0,
};

const perView = new Map<string, CounterBucket>();
const events: TelemetryEvent[] = [];
let currentView = "app";
let lastPersistAtMs = 0;

function getOrCreateBucket(view: string): CounterBucket {
  const existing = perView.get(view);
  if (existing) return existing;
  const created: CounterBucket = {
    reads: 0,
    writes: 0,
    deletes: 0,
    listenerEvents: 0,
    listenerReads: 0,
  };
  perView.set(view, created);
  return created;
}

function persistSummary() {
  const now = Date.now();
  if (now - lastPersistAtMs < 2000) return;
  lastPersistAtMs = now;

  const summary = {
    atIso: new Date(now).toISOString(),
    currentView,
    sessionTotals,
    perView: Array.from(perView.entries()),
  };
  try {
    safeStorageSetItem("localStorage", SUMMARY_STORAGE_KEY, JSON.stringify(summary));
  } catch {
    // Ignore local storage errors.
  }
}

function record(view: string, kind: keyof CounterBucket, count: number) {
  if (!Number.isFinite(count) || count <= 0) return;
  const normalizedView = view.trim() || "app";
  const normalizedCount = Math.max(0, Math.round(count));

  const bucket = getOrCreateBucket(normalizedView);
  bucket[kind] += normalizedCount;
  sessionTotals[kind] += normalizedCount;

  events.push({
    atMs: Date.now(),
    view: normalizedView,
    kind,
    count: normalizedCount,
  });
  while (events.length > MAX_EVENTS) {
    events.shift();
  }

  persistSummary();
}

function countSnapshotReads(snapshot: SnapshotLike, initialized: boolean): number {
  if (typeof snapshot.docChanges === "function") {
    if (!initialized) {
      return typeof snapshot.size === "number" ? snapshot.size : snapshot.docChanges().length;
    }
    return snapshot.docChanges().length;
  }
  if (typeof snapshot.size === "number") {
    return snapshot.size;
  }
  return 1;
}

export function setTelemetryView(view: string) {
  currentView = view.trim() || "app";
  getOrCreateBucket(currentView);
  persistSummary();
}

export function resetFirestoreTelemetry() {
  sessionTotals.reads = 0;
  sessionTotals.writes = 0;
  sessionTotals.deletes = 0;
  sessionTotals.listenerEvents = 0;
  sessionTotals.listenerReads = 0;
  perView.clear();
  events.length = 0;
  persistSummary();
}

export function getFirestoreTelemetrySnapshot() {
  const now = Date.now();
  const last60 = {
    reads: 0,
    writes: 0,
    deletes: 0,
    listenerEvents: 0,
    listenerReads: 0,
  } as CounterBucket;

  for (const event of events) {
    if (now - event.atMs > LAST_WINDOW_MS) continue;
    last60[event.kind] += event.count;
  }

  return {
    atIso: new Date(now).toISOString(),
    currentView,
    last60,
    sessionTotals: { ...sessionTotals },
    perView: Array.from(perView.entries()).map(([view, counters]) => ({
      view,
      ...counters,
    })),
  };
}

export async function trackedGetDoc<TRef>(view: string, ref: TRef) {
  const snap = await getDoc(ref as Parameters<typeof getDoc>[0]);
  record(view, "reads", 1);
  return snap;
}

export async function trackedGetDocs<TQuery>(view: string, q: TQuery) {
  const snap = await getDocs(q as Parameters<typeof getDocs>[0]);
  record(view, "reads", snap.size);
  return snap;
}

export async function trackedAddDoc<TCol, TValue>(view: string, colRef: TCol, data: TValue) {
  const result = await addDoc(
    colRef as Parameters<typeof addDoc>[0],
    data as Parameters<typeof addDoc>[1]
  );
  record(view, "writes", 1);
  return result;
}

export async function trackedSetDoc<TDoc, TValue>(view: string, docRef: TDoc, data: TValue, options?: unknown) {
  if (options !== undefined) {
    await setDoc(
      docRef as Parameters<typeof setDoc>[0],
      data as Parameters<typeof setDoc>[1],
      options as Parameters<typeof setDoc>[2]
    );
  } else {
    await setDoc(
      docRef as Parameters<typeof setDoc>[0],
      data as Parameters<typeof setDoc>[1]
    );
  }
  record(view, "writes", 1);
}

export async function trackedUpdateDoc<TDoc, TValue>(view: string, docRef: TDoc, data: TValue) {
  const runner = updateDoc as unknown as (ref: Parameters<typeof updateDoc>[0], payload: unknown) => Promise<void>;
  await runner(docRef as Parameters<typeof updateDoc>[0], data);
  record(view, "writes", 1);
}

export async function trackedDeleteDoc<TDoc>(view: string, docRef: TDoc) {
  await deleteDoc(docRef as Parameters<typeof deleteDoc>[0]);
  record(view, "deletes", 1);
}

export function trackedOnSnapshot<TRef>(
  view: string,
  source: TRef,
  onNext: (snapshot: SnapshotLike) => void,
  onError?: (error: Error) => void
) {
  let initialized = false;
  const unsubscribe = onSnapshot(
    source as Parameters<typeof onSnapshot>[0],
    (snapshot: SnapshotLike) => {
      const reads = countSnapshotReads(snapshot, initialized);
      record(view, "listenerEvents", 1);
      record(view, "listenerReads", reads);
      record(view, "reads", reads);
      initialized = true;
      onNext(snapshot);
    },
    onError
  );

  return () => {
    unsubscribe();
  };
}
