/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "firebase/auth";

import MyPiecesView from "./MyPiecesView";
import type { Batch } from "../types/domain";

type MockConstraint =
  | { type: "orderBy"; field: string; direction: "asc" | "desc" }
  | { type: "limit"; value: number };
type MockCollectionRef = { path: string };
type MockQuery = { path: string; constraints: MockConstraint[] };
type MockDoc = { id: string; data: Record<string, unknown> };
type Snapshot = { size: number; docs: { id: string; data: () => Record<string, unknown> }[] };
type TestUser = User & { getIdToken: ReturnType<typeof vi.fn> };

type UseBatchesState = {
  active: Batch[];
  history: Batch[];
  error: string;
};

type TrackedGetDocsMock = (view: string, queryRef: MockQuery) => Promise<Snapshot>;

let useBatchesState: UseBatchesState = { active: [], history: [], error: "" };
let trackedGetDocsMock: TrackedGetDocsMock;
let trackedGetDocsCalls: MockQuery[] = [];

function createSnapshot(rows: MockDoc[]): Snapshot {
  return {
    size: rows.length,
    docs: rows.map((row) => ({
      id: row.id,
      data: () => row.data,
    })),
  };
}

function permissionDeniedError(message = "Missing or insufficient permissions") {
  const error = new Error(message);
  (error as Error & { code: string }).code = "permission-denied";
  return error;
}

function hasUpdatedAtOrder(queryRef: MockQuery): boolean {
  return queryRef.constraints.some(
    (constraint) => constraint.type === "orderBy" && constraint.field === "updatedAt"
  );
}

function createUser(uid = "maker-user"): TestUser {
  const getIdToken = vi.fn(async () => "test-id-token");
  return {
    uid,
    email: "maker@monsoonfire.com",
    displayName: "Maker",
    getIdToken,
  } as unknown as TestUser;
}

vi.mock("../firebase", () => ({
  db: { name: "mock-db" },
}));

vi.mock("firebase/firestore", () => {
  const collection = vi.fn((_: unknown, ...segments: string[]) => ({
    path: segments.join("/"),
  }));
  const query = vi.fn((source: MockCollectionRef | MockQuery, ...constraints: MockConstraint[]) => ({
    path: source.path,
    constraints: [...("constraints" in source ? source.constraints : []), ...constraints],
  }));
  const orderBy = vi.fn((field: string, direction: "asc" | "desc" = "asc") => ({
    type: "orderBy" as const,
    field,
    direction,
  }));
  const limit = vi.fn((value: number) => ({ type: "limit" as const, value }));
  const doc = vi.fn((_: unknown, ...segments: string[]) => ({ path: segments.join("/") }));
  const serverTimestamp = vi.fn(() => "serverTimestamp");

  return {
    collection,
    query,
    orderBy,
    limit,
    doc,
    serverTimestamp,
  };
});

vi.mock("../hooks/useBatches", () => ({
  useBatches: () => useBatchesState,
}));

vi.mock("../api/portalApi", () => ({
  createPortalApi: () => ({
    continueJourney: vi.fn(async () => ({ data: { ok: true, newBatchId: "next-batch" }, meta: null })),
  }),
  PortalApiError: class PortalApiError extends Error {
    meta: unknown;

    constructor(message: string, meta: unknown) {
      super(message);
      this.meta = meta;
    }
  },
}));

vi.mock("../lib/analytics", () => ({
  shortId: (value: unknown) => (typeof value === "string" && value.trim() ? value : "unknown"),
  track: vi.fn(),
}));

vi.mock("../lib/firestoreTelemetry", () => ({
  trackedGetDocs: (view: string, queryRef: MockQuery) => trackedGetDocsMock(view, queryRef),
  trackedAddDoc: vi.fn(async () => ({ id: "new-doc" })),
  trackedUpdateDoc: vi.fn(async () => undefined),
}));

function renderMyPieces(
  user: TestUser,
  isStaff = false,
  options?: {
    focusTarget?: { batchId: string; pieceId?: string } | null;
    onFocusTargetConsumed?: () => void;
  }
) {
  return render(
    <MyPiecesView
      user={user}
      isStaff={isStaff}
      focusTarget={options?.focusTarget}
      onFocusTargetConsumed={options?.onFocusTargetConsumed}
    />
  );
}

beforeEach(() => {
  trackedGetDocsCalls = [];
  useBatchesState = { active: [], history: [], error: "" };
  trackedGetDocsMock = async (_view, queryRef) => {
    trackedGetDocsCalls.push(queryRef);
    return createSnapshot([]);
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MyPiecesView permission resiliency", () => {
  it("refreshes auth token and retries piece loading when all list reads are denied", async () => {
    const user = createUser("user-retry");
    useBatchesState = {
      active: [{ id: "batch-retry", title: "Retry batch", ownerUid: user.uid, isClosed: false }],
      history: [],
      error: "",
    };

    let fallbackCalls = 0;
    trackedGetDocsMock = async (_view, queryRef) => {
      trackedGetDocsCalls.push(queryRef);
      if (queryRef.path !== "batches/batch-retry/pieces") {
        return createSnapshot([]);
      }

      if (hasUpdatedAtOrder(queryRef)) {
        throw permissionDeniedError();
      }

      fallbackCalls += 1;
      if (fallbackCalls === 1) {
        throw permissionDeniedError();
      }

      return createSnapshot([
        {
          id: "piece-retry",
          data: {
            pieceCode: "QA-RETRY",
            shortDesc: "Token refresh path",
            ownerName: "Maker",
            stage: "GREENWARE",
            wareCategory: "STONEWARE",
            isArchived: false,
            updatedAt: "2026-02-26T00:00:00.000Z",
          },
        },
      ]);
    };

    renderMyPieces(user);

    await screen.findByText("QA-RETRY");
    await waitFor(() => {
      expect(user.getIdToken).toHaveBeenCalledWith(true);
    });
    expect(screen.queryByText(/Pieces failed:/i)).toBeNull();
  });

  it("renders partial success with permission warning when only some batches fail", async () => {
    const user = createUser("user-partial");
    useBatchesState = {
      active: [
        { id: "batch-ok", title: "Batch OK", ownerUid: user.uid, isClosed: false },
        { id: "batch-denied", title: "Batch denied", ownerUid: user.uid, isClosed: false },
      ],
      history: [],
      error: "",
    };

    trackedGetDocsMock = async (_view, queryRef) => {
      trackedGetDocsCalls.push(queryRef);
      if (queryRef.path === "batches/batch-ok/pieces") {
        return createSnapshot([
          {
            id: "piece-ok",
            data: {
              pieceCode: "QA-OK",
              shortDesc: "Visible batch",
              ownerName: "Maker",
              stage: "BISQUE",
              wareCategory: "STONEWARE",
              isArchived: false,
              updatedAt: "2026-02-26T00:00:00.000Z",
            },
          },
        ]);
      }
      if (queryRef.path === "batches/batch-denied/pieces") {
        throw permissionDeniedError();
      }
      return createSnapshot([]);
    };

    renderMyPieces(user);

    await screen.findByText("QA-OK");
    await screen.findByText("Some check-ins could not be loaded due to permissions (1/2).");
    expect(user.getIdToken).not.toHaveBeenCalled();
    expect(screen.queryByText(/Pieces failed:/i)).toBeNull();
  });

  it("falls back to unordered piece reads when ordered query is denied", async () => {
    const user = createUser("user-fallback");
    useBatchesState = {
      active: [{ id: "batch-fallback", title: "Batch fallback", ownerUid: user.uid, isClosed: false }],
      history: [],
      error: "",
    };

    trackedGetDocsMock = async (_view, queryRef) => {
      trackedGetDocsCalls.push(queryRef);
      if (queryRef.path !== "batches/batch-fallback/pieces") {
        return createSnapshot([]);
      }
      if (hasUpdatedAtOrder(queryRef)) {
        throw permissionDeniedError();
      }
      return createSnapshot([
        {
          id: "piece-fallback",
          data: {
            pieceCode: "QA-FALLBACK",
            shortDesc: "Fallback query result",
            ownerName: "Maker",
            stage: "GREENWARE",
            wareCategory: "STONEWARE",
            isArchived: false,
            updatedAt: "2026-02-26T00:00:00.000Z",
          },
        },
      ]);
    };

    renderMyPieces(user);

    await screen.findByText("QA-FALLBACK");
    expect(screen.queryByText(/Pieces failed:/i)).toBeNull();
    const pieceCalls = trackedGetDocsCalls.filter((entry) => entry.path === "batches/batch-fallback/pieces");
    expect(pieceCalls).toHaveLength(2);
    expect(pieceCalls.some((entry) => hasUpdatedAtOrder(entry))).toBe(true);
    expect(pieceCalls.some((entry) => !hasUpdatedAtOrder(entry))).toBe(true);
  });

  it("shows detail-level permission warning while keeping readable detail sections", async () => {
    const user = createUser("user-detail");
    useBatchesState = {
      active: [{ id: "batch-detail", title: "Batch detail", ownerUid: user.uid, isClosed: false }],
      history: [],
      error: "",
    };

    trackedGetDocsMock = async (_view, queryRef) => {
      trackedGetDocsCalls.push(queryRef);
      if (queryRef.path === "batches/batch-detail/pieces") {
        return createSnapshot([
          {
            id: "piece-detail",
            data: {
              pieceCode: "QA-DETAIL",
              shortDesc: "Detail loading",
              ownerName: "Maker",
              stage: "GREENWARE",
              wareCategory: "STONEWARE",
              isArchived: false,
              updatedAt: "2026-02-26T00:00:00.000Z",
            },
          },
        ]);
      }
      if (queryRef.path.endsWith("/clientNotes")) {
        return createSnapshot([
          {
            id: "client-note-1",
            data: {
              text: "Looks good",
              authorName: "Maker",
              at: "2026-02-26T00:01:00.000Z",
            },
          },
        ]);
      }
      if (queryRef.path.endsWith("/studioNotes")) {
        throw permissionDeniedError();
      }
      if (queryRef.path.endsWith("/audit") || queryRef.path.endsWith("/media")) {
        return createSnapshot([]);
      }
      return createSnapshot([]);
    };

    renderMyPieces(user);
    await screen.findByText("QA-DETAIL");

    fireEvent.click(screen.getByRole("button", { name: "View details" }));

    await screen.findByText("Some piece detail sections are unavailable due to permissions.");
    expect(screen.getByText("Looks good")).toBeDefined();
  });

  it("auto-selects a focused batch target from dashboard navigation", async () => {
    const user = createUser("user-focus");
    const onFocusTargetConsumed = vi.fn();
    useBatchesState = {
      active: [{ id: "batch-focus", title: "Batch focus", ownerUid: user.uid, isClosed: false }],
      history: [],
      error: "",
    };

    trackedGetDocsMock = async (_view, queryRef) => {
      trackedGetDocsCalls.push(queryRef);
      if (queryRef.path === "batches/batch-focus/pieces") {
        return createSnapshot([
          {
            id: "piece-focus-1",
            data: {
              pieceCode: "QA-FOCUS-1",
              shortDesc: "Focused piece",
              ownerName: "Maker",
              stage: "GREENWARE",
              wareCategory: "STONEWARE",
              isArchived: false,
              updatedAt: "2026-02-26T03:00:00.000Z",
            },
          },
        ]);
      }
      if (queryRef.path.endsWith("/clientNotes") || queryRef.path.endsWith("/studioNotes")) {
        return createSnapshot([]);
      }
      if (queryRef.path.endsWith("/audit") || queryRef.path.endsWith("/media")) {
        return createSnapshot([]);
      }
      return createSnapshot([]);
    };

    renderMyPieces(user, false, {
      focusTarget: { batchId: "batch-focus" },
      onFocusTargetConsumed,
    });

    const closeButton = await screen.findByRole("button", { name: "Close" });
    const detailPane = closeButton.closest(".card");
    expect(detailPane).toBeTruthy();
    if (!detailPane) {
      throw new Error("Piece detail pane not found");
    }
    expect(within(detailPane).getByText("QA-FOCUS-1")).toBeDefined();
    expect(onFocusTargetConsumed).toHaveBeenCalled();
  });
});
