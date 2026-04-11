import test from "node:test";
import assert from "node:assert/strict";

import * as shared from "./shared";
import { collectWorkshopCommunitySignalCountsByEventIds } from "./events";

type SupportRequestRow = Record<string, unknown>;
type SupportRequestDoc = {
  id: string;
  row: SupportRequestRow;
};

type QueryFilter =
  | { field: string; op: "=="; value: unknown }
  | { field: string; op: "in"; value: unknown[] };

type MockQueryState = {
  filters: QueryFilter[];
  ordered: boolean;
  limitCount: number | null;
  offsetCount: number;
};

type MockSnapshot = {
  id: string;
  data: () => SupportRequestRow;
};

function matchesFilter(row: SupportRequestRow, filter: QueryFilter): boolean {
  const value = row[filter.field];
  if (filter.op === "==") {
    return value === filter.value;
  }
  return Array.isArray(filter.value) && filter.value.includes(value);
}

function createSupportRequestQuery(
  rows: SupportRequestDoc[],
  state: MockQueryState,
): {
  where: (field: string, op: "==" | "in", value: unknown) => ReturnType<typeof createSupportRequestQuery>;
  orderBy: (_field: string, _direction?: string) => ReturnType<typeof createSupportRequestQuery>;
  limit: (limit: number) => ReturnType<typeof createSupportRequestQuery>;
  offset: (offset: number) => ReturnType<typeof createSupportRequestQuery>;
  get: () => Promise<{ docs: MockSnapshot[]; empty: boolean }>;
} {
  return {
    where: (field, op, value) =>
      createSupportRequestQuery(rows, {
        ...state,
        filters: [
          ...state.filters,
          op === "in"
            ? { field, op, value: Array.isArray(value) ? value : [] }
            : { field, op, value },
        ],
      }),
    orderBy: () =>
      createSupportRequestQuery(rows, {
        ...state,
        ordered: true,
      }),
    limit: (limit) =>
      createSupportRequestQuery(rows, {
        ...state,
        limitCount: limit,
      }),
    offset: (offset) =>
      createSupportRequestQuery(rows, {
        ...state,
        offsetCount: offset,
      }),
    get: async () => {
      const sourceEquality = state.filters.find(
        (filter) => filter.field === "source" && filter.op === "==",
      );
      const hasSourceInFilter = state.filters.some(
        (filter) => filter.field === "source" && filter.op === "in",
      );
      const shouldFailOrdered =
        state.ordered &&
        (!hasSourceInFilter ||
          sourceEquality?.value === null ||
          sourceEquality?.value === "");
      if (shouldFailOrdered) {
        throw new Error("requires an index");
      }

      const filtered = rows.filter(({ row }) =>
        state.filters.every((filter) => matchesFilter(row, filter)),
      );
      const start = Math.max(0, state.offsetCount);
      const end =
        state.limitCount === null ? undefined : start + Math.max(0, state.limitCount);
      const docs = filtered.slice(start, end).map<MockSnapshot>(({ id, row }) => ({
        id,
        data: () => row,
      }));
      return {
        docs,
        empty: docs.length === 0,
      };
    },
  };
}

async function withMockSupportRequests<T>(
  supportRequests: Record<string, SupportRequestRow>,
  callback: () => Promise<T>,
): Promise<T> {
  const db = shared.db as unknown as {
    collection: (path: string) => unknown;
  };
  const originalCollection = db.collection;
  const rows = Object.entries(supportRequests).map(([id, row]) => ({ id, row }));

  db.collection = (path: string) => {
    if (path !== "supportRequests") {
      throw new Error(`Unexpected collection path in test: ${path}`);
    }
    return createSupportRequestQuery(rows, {
      filters: [],
      ordered: false,
      limitCount: null,
      offsetCount: 0,
    });
  };

  try {
    return await callback();
  } finally {
    db.collection = originalCollection;
  }
}

test("collectWorkshopCommunitySignalCountsByEventIds paginates fallback queries beyond 250 docs", async () => {
  const supportRequests: Record<string, SupportRequestRow> = {};
  for (let index = 0; index < 260; index += 1) {
    const minute = String(index % 60).padStart(2, "0");
    const second = String(Math.floor(index / 60)).padStart(2, "0");
    supportRequests[`support-${index}`] = {
      category: "Workshops",
      source: null,
      eventId: "event-null-fallback-123",
      uid: `member-${index}`,
      createdAt: `2031-01-01T10:${minute}:${second}.000Z`,
      subject: "Workshop request: Large format clay",
      body: "Workshop request:\nWorkshop id: event-null-fallback-123",
    };
  }

  const counts = await withMockSupportRequests(supportRequests, async () =>
    await collectWorkshopCommunitySignalCountsByEventIds("owner-1", ["event-null-fallback-123"]),
  );

  const eventCounts = counts.get("event-null-fallback-123");
  assert.ok(eventCounts);
  assert.equal(eventCounts?.requestSignals, 260);
  assert.equal(eventCounts?.interestSignals, 0);
  assert.equal(eventCounts?.showcaseSignals, 0);
  assert.equal(eventCounts?.withdrawnSignals, 0);
  assert.ok(typeof eventCounts?.latestSignalAtMs === "number");
  assert.ok((eventCounts?.latestSignalAtMs ?? 0) > 0);
});
