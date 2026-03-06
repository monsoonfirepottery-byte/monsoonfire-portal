import test from "node:test";
import assert from "node:assert/strict";

import * as shared from "./shared";
import { syncLibraryLoanOverduesBatch } from "./library";

type DbRow = Record<string, unknown>;
type CollectionRows = Record<string, DbRow>;
type MockDbState = Record<string, CollectionRows>;

type MockDocSnapshot = {
  id: string;
  exists: boolean;
  data: () => DbRow | undefined;
};

type MockQuerySnapshot = {
  docs: MockDocSnapshot[];
  size: number;
};

type MockQuery = {
  orderBy: (field: string, direction?: "asc" | "desc") => MockQuery;
  limit: (count: number) => MockQuery;
  get: () => Promise<MockQuerySnapshot>;
};

type MockCollectionRef = {
  orderBy: (field: string, direction?: "asc" | "desc") => MockQuery;
  limit: (count: number) => MockQuery;
  get: () => Promise<MockQuerySnapshot>;
  doc: (id: string) => {
    id: string;
    get: () => Promise<MockDocSnapshot>;
    set: (value: DbRow, options?: { merge?: boolean }) => Promise<void>;
  };
};

const DAY_MS = 24 * 60 * 60 * 1000;

function toMs(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (value && typeof value === "object") {
    const row = value as { toMillis?: unknown; seconds?: unknown; nanoseconds?: unknown };
    if (typeof row.toMillis === "function") {
      try {
        const result = (row.toMillis as () => unknown)();
        return typeof result === "number" && Number.isFinite(result) ? result : 0;
      } catch {
        return 0;
      }
    }
    if (typeof row.seconds === "number" && Number.isFinite(row.seconds)) {
      const nanos =
        typeof row.nanoseconds === "number" && Number.isFinite(row.nanoseconds) ? row.nanoseconds : 0;
      return Math.trunc(row.seconds * 1000 + nanos / 1_000_000);
    }
  }
  return 0;
}

function cloneRow<T extends DbRow>(row: T): T {
  return JSON.parse(JSON.stringify(row)) as T;
}

async function withMockFirestore<T>(state: MockDbState, callback: () => Promise<T>): Promise<T> {
  const db = shared.db as unknown as {
    collection: (path: string) => MockCollectionRef;
  };
  const originalCollection = db.collection;

  const ensureCollection = (path: string): CollectionRows => {
    const rows = state[path] ?? {};
    if (!Object.prototype.hasOwnProperty.call(state, path)) {
      state[path] = rows;
    }
    return rows;
  };

  const toSnapshot = (id: string, row: DbRow | undefined): MockDocSnapshot => ({
    id,
    exists: Boolean(row),
    data: () => (row ? cloneRow(row) : undefined),
  });

  const createQuery = (
    path: string,
    orderField?: string,
    orderDirection: "asc" | "desc" = "asc",
    limitCount?: number
  ): MockQuery => ({
    orderBy: (field, direction = "asc") => createQuery(path, field, direction, limitCount),
    limit: (count) => createQuery(path, orderField, orderDirection, count),
    get: async () => {
      const rows = ensureCollection(path);
      let docs = Object.entries(rows).map(([id, row]) => ({ id, row }));
      if (orderField) {
        docs = docs.sort((a, b) => {
          const aValue = toMs(a.row[orderField]);
          const bValue = toMs(b.row[orderField]);
          const diff = aValue - bValue;
          return orderDirection === "desc" ? -diff : diff;
        });
      }
      if (typeof limitCount === "number") {
        docs = docs.slice(0, Math.max(0, limitCount));
      }
      const snapshots = docs.map((entry) => toSnapshot(entry.id, entry.row));
      return {
        docs: snapshots,
        size: snapshots.length,
      };
    },
  });

  const createCollectionRef = (path: string): MockCollectionRef => ({
    orderBy: (field, direction = "asc") => createQuery(path, field, direction),
    limit: (count) => createQuery(path, undefined, "asc", count),
    get: async () => createQuery(path).get(),
    doc: (id: string) => ({
      id,
      get: async () => {
        const rows = ensureCollection(path);
        return toSnapshot(id, rows[id]);
      },
      set: async (value: DbRow, options?: { merge?: boolean }) => {
        const rows = ensureCollection(path);
        const previous = rows[id];
        if (options?.merge && previous) {
          rows[id] = {
            ...cloneRow(previous),
            ...cloneRow(value),
          };
          return;
        }
        rows[id] = cloneRow(value);
      },
    }),
  });

  db.collection = (path: string) => createCollectionRef(path);

  try {
    return await callback();
  } finally {
    db.collection = originalCollection;
  }
}

async function withFixedNow<T>(nowMs: number, callback: () => Promise<T>): Promise<T> {
  const originalNow = Date.now;
  Date.now = () => nowMs;
  try {
    return await callback();
  } finally {
    Date.now = originalNow;
  }
}

function createMixedLoanState(nowMs: number): MockDbState {
  return {
    libraryLoans: {
      loan_due7: {
        status: "checked_out",
        dueAt: new Date(nowMs + 7 * DAY_MS).toISOString(),
        itemId: "item_due7",
        borrowerUid: "member-a",
        borrowerEmail: "a@example.com",
      },
      loan_due1: {
        status: "return_requested",
        dueAt: new Date(nowMs + 12 * 60 * 60 * 1000).toISOString(),
        itemId: "item_due1",
        borrowerUid: "member-b",
        borrowerEmail: "b@example.com",
      },
      loan_over3: {
        status: "overdue",
        dueAt: new Date(nowMs - 4 * DAY_MS).toISOString(),
        itemId: "item_over3",
        borrowerUid: "member-c",
        borrowerEmail: "c@example.com",
      },
      loan_past_due: {
        status: "checked_out",
        dueAt: new Date(nowMs - DAY_MS).toISOString(),
        itemId: "item_past_due",
        borrowerUid: "member-d",
        borrowerEmail: "d@example.com",
      },
      loan_returned: {
        status: "returned",
        dueAt: new Date(nowMs + 7 * DAY_MS).toISOString(),
        itemId: "item_returned",
      },
      loan_lost: {
        status: "lost",
        dueAt: new Date(nowMs + 7 * DAY_MS).toISOString(),
        itemId: "item_lost",
      },
      loan_unknown: {
        status: "queued",
        dueAt: new Date(nowMs + DAY_MS).toISOString(),
        itemId: "item_unknown",
      },
      loan_missing_due: {
        status: "checked_out",
        dueAt: null,
        itemId: "item_missing_due",
      },
    },
    libraryItems: {
      item_past_due: {
        status: "available",
        current_lending_status: "available",
      },
    },
    libraryReminderEvents: {},
  };
}

test("syncLibraryLoanOverduesBatch emits reminder stages and transitions only eligible mixed-status loans", async () => {
  const nowMs = Date.parse("2026-03-01T12:00:00.000Z");
  const state = createMixedLoanState(nowMs);

  const result = await withFixedNow(nowMs, async () =>
    withMockFirestore(state, async () =>
      syncLibraryLoanOverduesBatch({ maxItems: 100, source: "manual", requestId: "req-overdue-1" })
    )
  );

  assert.equal(result.scanned, 8);
  assert.equal(result.transitionedToOverdue, 1);
  assert.equal(result.remindersCreated, 3);
  assert.equal(result.errors, 0);

  const reminders = state.libraryReminderEvents ?? {};
  assert.deepEqual(
    Object.keys(reminders).sort(),
    [
      "loan_due1__library.borrow_due_1d",
      "loan_due7__library.borrow_due_7d",
      "loan_over3__library.borrow_overdue_3d",
    ].sort()
  );

  assert.equal(state.libraryLoans?.loan_past_due?.status, "overdue");
  assert.equal(state.libraryLoans?.loan_past_due?.overdueSource, "manual");
  assert.equal(state.libraryItems?.item_past_due?.status, "overdue");
  assert.equal(state.libraryItems?.item_past_due?.current_lending_status, "overdue");
  assert.equal(state.libraryLoans?.loan_returned?.status, "returned");
});

test("syncLibraryLoanOverduesBatch is idempotent for reminder-stage persistence on rerun", async () => {
  const nowMs = Date.parse("2026-03-01T12:00:00.000Z");
  const state = createMixedLoanState(nowMs);

  const firstResult = await withFixedNow(nowMs, async () =>
    withMockFirestore(state, async () =>
      syncLibraryLoanOverduesBatch({ maxItems: 100, source: "manual", requestId: "req-overdue-2a" })
    )
  );
  assert.equal(firstResult.remindersCreated, 3);

  const reminderCountAfterFirstRun = Object.keys(state.libraryReminderEvents ?? {}).length;
  const secondResult = await withFixedNow(nowMs, async () =>
    withMockFirestore(state, async () =>
      syncLibraryLoanOverduesBatch({ maxItems: 100, source: "manual", requestId: "req-overdue-2b" })
    )
  );

  assert.equal(secondResult.remindersCreated, 0);
  assert.equal(secondResult.transitionedToOverdue, 0);
  assert.equal(secondResult.errors, 0);
  assert.equal(Object.keys(state.libraryReminderEvents ?? {}).length, reminderCountAfterFirstRun);
});
