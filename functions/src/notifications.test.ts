import test from "node:test";
import assert from "node:assert/strict";

import * as shared from "./shared";
import {
  computeReservationStorageBilling,
  nextDueReminderOrdinal,
  runReservationStorageHoldEvaluation,
  storageStatusForElapsed,
} from "./notifications";

type DbRow = Record<string, unknown> | null;
type MockDbState = Record<string, Record<string, DbRow>>;

type MockDocRef = {
  id: string;
  path: string;
  get: () => Promise<{ id: string; exists: boolean; data: () => Record<string, unknown> | undefined }>;
  set: (value: Record<string, unknown>, options?: { merge?: boolean }) => Promise<void>;
  create: (value: Record<string, unknown>) => Promise<void>;
  collection: (path: string) => MockCollectionRef;
};

type MockCollectionRef = {
  doc: (id: string) => MockDocRef;
  where: (..._args: unknown[]) => MockQuery;
  limit: (limit: number) => MockQuery;
  get: () => Promise<{ docs: Array<{ id: string; data: () => Record<string, unknown> | undefined; ref: MockDocRef }> }>;
};

type MockQuery = {
  where: (..._args: unknown[]) => MockQuery;
  limit: (limit: number) => MockQuery;
  get: () => Promise<{ docs: Array<{ id: string; data: () => Record<string, unknown> | undefined; ref: MockDocRef }> }>;
};

function cloneRow(row: DbRow): Record<string, unknown> | undefined {
  if (!row) return undefined;
  return { ...row };
}

function mergeRows(existing: DbRow, incoming: Record<string, unknown>): Record<string, unknown> {
  return {
    ...(existing ?? {}),
    ...incoming,
  };
}

function withMockFirestore<T>(state: MockDbState, callback: () => Promise<T>): Promise<T> {
  const db = shared.db as unknown as {
    collection: (path: string) => MockCollectionRef;
  };
  const originalCollection = db.collection;

  const ensureCollection = (collectionPath: string): Record<string, DbRow> => {
    if (!Object.prototype.hasOwnProperty.call(state, collectionPath)) {
      state[collectionPath] = {};
    }
    return state[collectionPath] as Record<string, DbRow>;
  };

  const makeDocRef = (collectionPath: string, id: string): MockDocRef => ({
    id,
    path: `${collectionPath}/${id}`,
    get: async () => {
      const rows = ensureCollection(collectionPath);
      const row = Object.prototype.hasOwnProperty.call(rows, id) ? rows[id] : null;
      return {
        id,
        exists: row !== null,
        data: () => cloneRow(row),
      };
    },
    set: async (value, options) => {
      const rows = ensureCollection(collectionPath);
      const existing = Object.prototype.hasOwnProperty.call(rows, id) ? rows[id] : null;
      rows[id] = options?.merge ? mergeRows(existing, value) : { ...value };
    },
    create: async (value) => {
      const rows = ensureCollection(collectionPath);
      if (Object.prototype.hasOwnProperty.call(rows, id) && rows[id] !== null) {
        throw new Error("DOC_EXISTS");
      }
      rows[id] = { ...value };
    },
    collection: (subPath: string) => makeCollectionRef(`${collectionPath}/${id}/${subPath}`),
  });

  const makeQuery = (collectionPath: string, limitCount?: number): MockQuery => ({
    where: () => makeQuery(collectionPath, limitCount),
    limit: (nextLimit) => makeQuery(collectionPath, nextLimit),
    get: async () => {
      const rows = ensureCollection(collectionPath);
      const entries = Object.entries(rows)
        .filter(([, row]) => row !== null)
        .slice(0, limitCount ?? Number.MAX_SAFE_INTEGER)
        .map(([id, row]) => ({
          id,
          data: () => cloneRow(row),
          ref: makeDocRef(collectionPath, id),
        }));
      return { docs: entries };
    },
  });

  const makeCollectionRef = (collectionPath: string): MockCollectionRef => ({
    doc: (id: string) => makeDocRef(collectionPath, id),
    where: () => makeQuery(collectionPath),
    limit: (limitCount) => makeQuery(collectionPath, limitCount),
    get: async () => makeQuery(collectionPath).get(),
  });

  db.collection = (collectionPath) => makeCollectionRef(collectionPath);

  return callback().finally(() => {
    db.collection = originalCollection;
  });
}

function storageSeed(readyIso: string, chargeBasisHalfShelves: number) {
  const readyForPickupAt = shared.Timestamp.fromDate(new Date(readyIso));
  return computeReservationStorageBilling({
    existing: null,
    readyForPickupAt,
    chargeBasisHalfShelves,
    now: readyForPickupAt,
  });
}

test("nextDueReminderOrdinal uses the shifted grace-period thresholds", () => {
  const dayMs = 24 * 60 * 60 * 1000;
  assert.equal(nextDueReminderOrdinal({ elapsedMs: 13.9 * dayMs, currentCount: 0 }), null);
  assert.equal(nextDueReminderOrdinal({ elapsedMs: 14 * dayMs, currentCount: 0 }), 1);
  assert.equal(nextDueReminderOrdinal({ elapsedMs: 17.5 * dayMs, currentCount: 1 }), 2);
  assert.equal(nextDueReminderOrdinal({ elapsedMs: 19.25 * dayMs, currentCount: 2 }), 3);
});

test("storageStatusForElapsed maps grace, billing, and reclamation windows", () => {
  const hourMs = 60 * 60 * 1000;
  const dayMs = 24 * hourMs;
  assert.equal(storageStatusForElapsed({ elapsedMs: 13 * dayMs, reminderCount: 0 }), "active");
  assert.equal(storageStatusForElapsed({ elapsedMs: 14 * dayMs, reminderCount: 1 }), "reminder_pending");
  assert.equal(storageStatusForElapsed({ elapsedMs: 462 * hourMs, reminderCount: 3 }), "hold_pending");
  assert.equal(
    storageStatusForElapsed({ elapsedMs: (462 + 28 * 24) * hourMs, reminderCount: 3 }),
    "stored_by_policy"
  );
});

test("computeReservationStorageBilling accrues full days and caps at reclamation", () => {
  const readyForPickupAt = shared.Timestamp.fromDate(new Date("2026-03-01T00:00:00.000Z"));
  const billing = computeReservationStorageBilling({
    existing: null,
    readyForPickupAt,
    chargeBasisHalfShelves: 3,
    now: shared.Timestamp.fromDate(new Date("2026-03-21T06:00:00.000Z")),
  });
  assert.equal(billing.status, "billing");
  assert.equal(billing.billedDays, 1);
  assert.equal(billing.accruedCost, 4.5);

  const reclaimed = computeReservationStorageBilling({
    existing: billing,
    readyForPickupAt,
    chargeBasisHalfShelves: 3,
    now: shared.Timestamp.fromDate(new Date("2026-04-17T06:00:00.000Z")),
  });
  assert.equal(reclaimed.status, "reclaimed");
  assert.equal(reclaimed.billedDays, 28);
  assert.equal(reclaimed.accruedCost, 126);
  assert.ok(reclaimed.reclaimedAt);
});

test("runReservationStorageHoldEvaluation leaves reservations untouched before the first reminder window", async () => {
  const state: MockDbState = {
    reservations: {
      "reservation-early-grace": {
        ownerUid: "owner-1",
        status: "CONFIRMED",
        loadStatus: "loaded",
        estimatedHalfShelves: 2,
        readyForPickupAt: shared.Timestamp.fromDate(new Date("2026-03-01T00:00:00.000Z")),
        storageStatus: "active",
        pickupReminderCount: 0,
        storageBilling: storageSeed("2026-03-01T00:00:00.000Z", 2),
        pickupWindow: {
          status: "open",
        },
      },
    },
  };

  const summary = await withMockFirestore(state, () =>
    runReservationStorageHoldEvaluation(
      shared.Timestamp.fromDate(new Date("2026-03-13T23:00:00.000Z"))
    )
  );

  assert.equal(summary.reminderJobs, 0);
  assert.equal(summary.updatedReservations, 0);
  const reservation = state.reservations["reservation-early-grace"] as Record<string, unknown>;
  assert.equal(reservation.storageStatus, "active");
});

test("runReservationStorageHoldEvaluation sends the shifted reminders and starts billing at grace cutoff", async () => {
  const state: MockDbState = {
    reservations: {
      "reservation-grace-cutoff": {
        ownerUid: "owner-1",
        status: "CONFIRMED",
        loadStatus: "loaded",
        estimatedHalfShelves: 2,
        readyForPickupAt: shared.Timestamp.fromDate(new Date("2026-03-01T00:00:00.000Z")),
        storageStatus: "reminder_pending",
        pickupReminderCount: 2,
        storageNoticeHistory: [],
        storageBilling: storageSeed("2026-03-01T00:00:00.000Z", 2),
        pickupWindow: {
          status: "open",
        },
      },
    },
  };

  const summary = await withMockFirestore(state, () =>
    runReservationStorageHoldEvaluation(
      shared.Timestamp.fromDate(new Date("2026-03-20T06:00:00.000Z"))
    )
  );

  assert.equal(summary.reminderJobs, 1);
  const reservation = state.reservations["reservation-grace-cutoff"] as Record<string, unknown>;
  assert.equal(reservation.storageStatus, "hold_pending");
  assert.equal(reservation.pickupReminderCount, 3);
  const storageBilling = (reservation.storageBilling ?? {}) as Record<string, unknown>;
  assert.equal(storageBilling.status, "billing");
  assert.equal(storageBilling.billedDays, 0);
});

test("runReservationStorageHoldEvaluation stops billing changes after pickup is completed", async () => {
  const state: MockDbState = {
    reservations: {
      "reservation-picked-up": {
        ownerUid: "owner-1",
        status: "CONFIRMED",
        loadStatus: "loaded",
        estimatedHalfShelves: 4,
        readyForPickupAt: shared.Timestamp.fromDate(new Date("2026-03-01T00:00:00.000Z")),
        storageStatus: "hold_pending",
        pickupReminderCount: 3,
        storageBilling: {
          ...storageSeed("2026-03-01T00:00:00.000Z", 4),
          billedDays: 5,
          accruedCost: 30,
          status: "billing",
        },
        pickupWindow: {
          status: "completed",
        },
      },
    },
  };

  const summary = await withMockFirestore(state, () =>
    runReservationStorageHoldEvaluation(
      shared.Timestamp.fromDate(new Date("2026-03-28T06:00:00.000Z"))
    )
  );

  assert.equal(summary.updatedReservations, 0);
  const reservation = state.reservations["reservation-picked-up"] as Record<string, unknown>;
  const storageBilling = (reservation.storageBilling ?? {}) as Record<string, unknown>;
  assert.equal(storageBilling.billedDays, 5);
  assert.equal(storageBilling.accruedCost, 30);
});

test("runReservationStorageHoldEvaluation archives and reclaims reservations at the end of billed storage", async () => {
  const state: MockDbState = {
    reservations: {
      "reservation-reclaimed": {
        ownerUid: "owner-1",
        status: "CONFIRMED",
        loadStatus: "loaded",
        estimatedHalfShelves: 3,
        readyForPickupAt: shared.Timestamp.fromDate(new Date("2026-03-01T00:00:00.000Z")),
        storageStatus: "hold_pending",
        pickupReminderCount: 3,
        storageBilling: storageSeed("2026-03-01T00:00:00.000Z", 3),
        pickupWindow: {
          status: "missed",
          missedCount: 1,
        },
      },
    },
  };

  const summary = await withMockFirestore(state, () =>
    runReservationStorageHoldEvaluation(
      shared.Timestamp.fromDate(new Date("2026-04-17T06:00:00.000Z"))
    )
  );

  assert.equal(summary.updatedReservations, 1);
  const reservation = state.reservations["reservation-reclaimed"] as Record<string, unknown>;
  assert.equal(reservation.storageStatus, "stored_by_policy");
  assert.equal(reservation.isArchived, true);
  assert.ok(reservation.archivedAt);
  const storageBilling = (reservation.storageBilling ?? {}) as Record<string, unknown>;
  assert.equal(storageBilling.status, "reclaimed");
  assert.equal(storageBilling.billedDays, 28);
});

test("runReservationStorageHoldEvaluation records missed pickup windows without bypassing the grace timeline", async () => {
  const state: MockDbState = {
    reservations: {
      "reservation-window-missed": {
        ownerUid: "owner-1",
        status: "CONFIRMED",
        loadStatus: "loaded",
        estimatedHalfShelves: 2,
        readyForPickupAt: shared.Timestamp.fromDate(new Date("2026-03-01T00:00:00.000Z")),
        storageStatus: "active",
        pickupReminderCount: 0,
        storageBilling: storageSeed("2026-03-01T00:00:00.000Z", 2),
        pickupWindow: {
          status: "confirmed",
          confirmedEnd: shared.Timestamp.fromDate(new Date("2026-03-05T00:00:00.000Z")),
          missedCount: 1,
        },
      },
    },
  };

  const summary = await withMockFirestore(state, () =>
    runReservationStorageHoldEvaluation(
      shared.Timestamp.fromDate(new Date("2026-03-06T00:00:00.000Z"))
    )
  );

  assert.equal(summary.reminderJobs, 1);
  const reservation = state.reservations["reservation-window-missed"] as Record<string, unknown>;
  assert.equal(reservation.storageStatus, "active");
  const pickupWindow = (reservation.pickupWindow ?? {}) as Record<string, unknown>;
  assert.equal(pickupWindow.status, "missed");
  assert.equal(pickupWindow.missedCount, 2);
});
