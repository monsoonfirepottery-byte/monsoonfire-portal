/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "firebase/auth";
import DashboardView from "./DashboardView";

type MockQuery = { path: string };
type MockDoc = { id: string; data: Record<string, unknown> };
type Snapshot = { docs: { id: string; data: () => Record<string, unknown> }[] };

type GetDocsMock = (queryRef: MockQuery) => Promise<Snapshot>;
let getDocsMock: GetDocsMock;
let getDocsCalls: MockQuery[] = [];

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
  return {
    ...actual,
    initializeFirestore,
    collection,
    query,
    orderBy,
    limit,
    connectFirestoreEmulator: vi.fn(),
    getDocs: (queryRef: MockQuery) => getDocsMock(queryRef),
  };
});

function setupGetDocsPermissionThenSuccess() {
  getDocsCalls = [];
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
}

function setupGetDocsEmptySuccess() {
  getDocsCalls = [];
  const empty = createSnapshot([]);
  getDocsMock = async (queryRef: MockQuery) => {
    getDocsCalls.push(queryRef);
    return queryRef.path === "kilns" || queryRef.path === "kilnFirings" ? empty : createSnapshot([]);
  };
}

function createUser(): User {
  return {
    uid: "studio-user-id",
    email: "maker@monsoon.com",
  } as unknown as User;
}

beforeEach(() => {
  setupGetDocsPermissionThenSuccess();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DashboardView kiln reload", () => {
  it("shows retry after permission failure and loads kiln rows on retry", async () => {
    const user = createUser();

  render(
      <DashboardView
        user={user}
        name="Maker"
        themeName="portal"
        threads={[]}
        announcements={[]}
        onThemeChange={vi.fn()}
        onOpenKilnRentals={vi.fn()}
        onOpenCheckin={vi.fn()}
        onOpenQueues={vi.fn()}
        onOpenFirings={vi.fn()}
        onOpenStudioResources={vi.fn()}
        onOpenGlazeBoard={vi.fn()}
        onOpenCommunity={vi.fn()}
        onOpenMessages={vi.fn()}
        onOpenPieces={vi.fn()}
      />
    );

    const retryButton = await screen.findByRole("button", { name: /Retry loading kiln status/i });
    expect(screen.getByText("Unable to load kiln schedules. Permissions may not be configured yet.")).toBeDefined();

    fireEvent.click(retryButton);

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Retry loading kiln status/i })).toBeNull();
      expect(screen.getByText("L&L eQ2827-3")).toBeDefined();
    });

    expect(getDocsCalls).toHaveLength(4);
    expect(getDocsCalls.filter((entry) => getQueryPath(entry) === "kilns").length).toBe(2);
    expect(getDocsCalls.filter((entry) => getQueryPath(entry) === "kilnFirings").length).toBe(2);
  });

  it("shows empty kiln state when no live data exists and mock fallback is not enabled", async () => {
    setupGetDocsEmptySuccess();
    const user = createUser();

    render(
      <DashboardView
        user={user}
        name="Maker"
        themeName="portal"
        threads={[]}
        announcements={[]}
        onThemeChange={vi.fn()}
        onOpenKilnRentals={vi.fn()}
        onOpenCheckin={vi.fn()}
        onOpenQueues={vi.fn()}
        onOpenFirings={vi.fn()}
        onOpenStudioResources={vi.fn()}
        onOpenGlazeBoard={vi.fn()}
        onOpenCommunity={vi.fn()}
        onOpenMessages={vi.fn()}
        onOpenPieces={vi.fn()}
      />
    );

    expect(await screen.findByText("No kiln status available yet.")).toBeDefined();
    expect(screen.queryByText(/Using sample kiln data/i)).toBeNull();
    expect(screen.queryByText("L&L eQ2827-3")).toBeNull();
  });
});
