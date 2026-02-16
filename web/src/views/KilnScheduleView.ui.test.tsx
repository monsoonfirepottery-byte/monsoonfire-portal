/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "firebase/auth";
import KilnScheduleView from "./KilnScheduleView";

type MockQuery = { path: string };
type MockDoc = { id: string; data: Record<string, unknown> };
type Snapshot = { docs: { id: string; data: () => Record<string, unknown> }[] };
type AddDocCall = { collectionRef: { path: string }; data: Record<string, unknown> };
type TimestampFromDateCall = { input: Date };

type GetDocsMock = (queryRef: MockQuery) => Promise<Snapshot>;
type AddDocMock = (collectionRef: { path: string }, data: Record<string, unknown>) => Promise<unknown>;
let getDocsMock: GetDocsMock;
let addDocMock: AddDocMock;
let getDocsCalls: MockQuery[] = [];
let addDocCalls: AddDocCall[] = [];
let fromDateCalls: TimestampFromDateCall[] = [];
let currentFiringEndAt = 0;

function getQueryPath(queryRef: MockQuery | undefined) {
  return queryRef?.path;
}

function createSnapshot(rows: MockDoc[]): Snapshot {
  return {
    docs: rows.map((row) => ({
      id: row.id,
      data: () => row.data,
    })),
  };
}

function permissionDeniedError() {
  const error = new Error("Missing or insufficient permissions");
  (error as Error & { code: string }).code = "permission-denied";
  return error;
}

vi.mock("firebase/firestore", () => {
  const actual = {} as typeof import("firebase/firestore");
  const initializeFirestore = vi.fn((_: unknown) => ({ name: "mock-db" }));
  const collection = vi.fn((_: unknown, path: string) => ({ path }));
  const query = vi.fn((source: MockQuery) => source);
  const orderBy = vi.fn(() => ({}));
  const limit = vi.fn(() => ({}));
  const doc = vi.fn((_db: unknown, path: string) => ({ path }));
  const Timestamp = {
    fromDate: vi.fn((value: Date) => {
      fromDateCalls.push({ input: value });
      return { toDate: () => value };
    }),
  };

  return {
    ...actual,
    initializeFirestore,
    connectFirestoreEmulator: vi.fn(),
    collection,
    query,
    orderBy,
    limit,
    doc,
    Timestamp,
    serverTimestamp: vi.fn(() => "serverTimestamp"),
    addDoc: (collectionRef: { path: string }, data: Record<string, unknown>) =>
      addDocMock(collectionRef, data),
    updateDoc: vi.fn(),
    getDocs: (queryRef: MockQuery) => getDocsMock(queryRef),
  };
});

function setupGetDocsPermissionThenSuccess() {
  getDocsCalls = [];
  addDocCalls = [];
  fromDateCalls = [];
  const now = Date.now();
  let kilnsCall = 0;
  let firingsCall = 0;

  const kilnRows: MockDoc[] = [
    {
      id: "kiln-primary",
      data: {
        name: "L&L eQ2827-3",
        type: "electric",
        volume: "2",
        maxTemp: "2400",
        status: "idle",
        isAvailable: true,
        typicalCycles: [],
      },
    },
  ];

  const firingRows: MockDoc[] = [
    {
      id: "firing-primary",
      data: {
        kilnId: "kiln-primary",
        title: "Stoneware bisque",
        cycleType: "Bisque",
        startAt: new Date(now + 60 * 60 * 1000).toISOString(),
        endAt: new Date(now + 120 * 60 * 1000).toISOString(),
        status: "scheduled",
        confidence: "estimated",
        notes: null,
      },
    },
  ];

  const kilnsSuccess = createSnapshot(kilnRows);
  const firingsSuccess = createSnapshot(firingRows);

  getDocsMock = async (queryRef: MockQuery) => {
    getDocsCalls.push(queryRef);
    if (queryRef.path === "kilns") {
      if (kilnsCall++ === 0) throw permissionDeniedError();
      return kilnsSuccess;
    }

    if (queryRef.path === "kilnFirings") {
      if (firingsCall++ === 0) throw permissionDeniedError();
      return firingsSuccess;
    }

    return createSnapshot([]);
  };

  addDocMock = async (collectionRef, data) => {
    addDocCalls.push({ collectionRef, data });
    return {};
  };
}

function setupGetDocsAlwaysSuccess() {
  getDocsCalls = [];
  addDocCalls = [];
  fromDateCalls = [];
  const now = Date.now();
  const nextStartAt = now + 60 * 60 * 1000;
  const nextEndAt = now + 120 * 60 * 1000;
  currentFiringEndAt = nextEndAt;

  const kilnRows: MockDoc[] = [
    {
      id: "kiln-primary",
      data: {
        name: "L&L eQ2827-3",
        type: "electric",
        volume: "2",
        maxTemp: "2400",
        status: "idle",
        isAvailable: true,
        typicalCycles: [],
      },
    },
  ];

  const firingRows: MockDoc[] = [
    {
      id: "firing-primary",
      data: {
        kilnId: "kiln-primary",
        title: "Stoneware bisque",
        cycleType: "Bisque",
        startAt: new Date(nextStartAt).toISOString(),
        endAt: new Date(nextEndAt).toISOString(),
        status: "scheduled",
        confidence: "estimated",
        notes: null,
      },
    },
  ];

  const kilnsSuccess = createSnapshot(kilnRows);
  const firingsSuccess = createSnapshot(firingRows);

  getDocsMock = async (queryRef: MockQuery) => {
    getDocsCalls.push(queryRef);
    if (queryRef.path === "kilns") return kilnsSuccess;
    if (queryRef.path === "kilnFirings") return firingsSuccess;
    return createSnapshot([]);
  };

  addDocMock = async (collectionRef, data) => {
    addDocCalls.push({ collectionRef, data });
    return {};
  };
}

beforeEach(() => {
  setupGetDocsPermissionThenSuccess();
});

function createStaffUser(): User {
  return {
    uid: "studio-staff-id",
    email: "staff@monsoon.com",
  } as unknown as User;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("KilnScheduleView reload", () => {
  it("surfaces retry on permission failure and renders schedule after retry", async () => {
    render(<KilnScheduleView />);

    const retryButton = await screen.findByRole("button", { name: /Retry loading kiln schedule/i });
    expect(screen.getByText("You do not have sufficient Firestore permissions to read kiln schedule data.")).toBeDefined();

    fireEvent.click(retryButton);

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Retry loading kiln schedule/i })).toBeNull();
      expect(screen.getByText("L&L eQ2827-3")).toBeDefined();
    });

    expect(getDocsCalls).toHaveLength(4);
    expect(getDocsCalls.filter((entry) => getQueryPath(entry) === "kilns").length).toBe(2);
    expect(getDocsCalls.filter((entry) => getQueryPath(entry) === "kilnFirings").length).toBe(2);
  });

  it("creates a follow-up firing as staff and reloads schedule after creation", async () => {
    setupGetDocsAlwaysSuccess();
    const user = createStaffUser();

    render(<KilnScheduleView isStaff user={user} />);

    await screen.findByText("L&L eQ2827-3");
    await screen.findByText("Staff actions");
    const followUpButton = await screen.findByRole("button", { name: /Kick off follow-up firing/i });
    fireEvent.click(followUpButton);

    await waitFor(() => {
      expect(addDocCalls).toHaveLength(1);
      expect(screen.getByText("Create follow-up firing complete.")).toBeDefined();
    });

    expect(fromDateCalls).toHaveLength(2);
    const docRefPath = addDocCalls[0]?.collectionRef?.path;
    const payload = addDocCalls[0]?.data as {
      kilnId: string;
      kilnName: string | null;
      title: string;
      cycleType: string;
      status: string;
      confidence: string;
      notes: string;
      createdByUid: string;
      updatedByUid: string;
    };
    const startTimestampInput = fromDateCalls[0]?.input;
    const endTimestampInput = fromDateCalls[1]?.input;

    expect(docRefPath).toBe("kilnFirings");
    expect(payload.kilnId).toBe("kiln-primary");
    expect(payload.kilnName).toBe("L&L eQ2827-3");
    expect(payload.title).toBe("Stoneware bisque (staff follow-up)");
    expect(payload.cycleType).toBe("Bisque");
    expect(payload.status).toBe("scheduled");
    expect(payload.confidence).toBe("scheduled");
    expect(payload.notes).toBe("Scheduled by staff studio-staff-id");
    expect(payload.createdByUid).toBe("studio-staff-id");
    expect(payload.updatedByUid).toBe("studio-staff-id");
    expect(startTimestampInput).toBeInstanceOf(Date);
    expect(endTimestampInput).toBeInstanceOf(Date);
    expect(startTimestampInput.getTime()).toBeGreaterThan(currentFiringEndAt);
    expect(endTimestampInput.getTime() - startTimestampInput.getTime()).toBe(8 * 60 * 60 * 1000);

    await waitFor(() => {
      expect(getDocsCalls).toHaveLength(4);
    });
  });
});
