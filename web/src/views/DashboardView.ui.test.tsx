/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "firebase/auth";
import DashboardView from "./DashboardView";
import type { EventSummary } from "../api/portalContracts";
import type { Batch } from "../types/domain";

type MockQuery = { path: string };
type MockDoc = { id: string; data: Record<string, unknown> };
type Snapshot = { docs: { id: string; data: () => Record<string, unknown> }[] };

type GetDocsMock = (queryRef: MockQuery) => Promise<Snapshot>;
let getDocsMock: GetDocsMock;
let getDocsCalls: MockQuery[] = [];
const listEventsMock = vi.fn();
let useBatchesState: { active: Batch[]; history: Batch[]; error: string } = {
  active: [],
  history: [],
  error: "",
};

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
  const collection = vi.fn((_: unknown, ...segments: string[]) => ({ path: segments.join("/") }));
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

vi.mock("../hooks/useBatches", () => ({
  useBatches: () => useBatchesState,
}));

vi.mock("../api/portalApi", () => ({
  createPortalApi: () => ({
    listEvents: listEventsMock,
  }),
}));

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
    getIdToken: vi.fn(async () => "test-id-token"),
  } as unknown as User;
}

function buildEventSummary(overrides: Partial<EventSummary> = {}): EventSummary {
  return {
    id: "event-1",
    title: "Wheel Lab Live",
    summary: "A focused wheel session.",
    startAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    endAt: new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString(),
    timezone: "America/Phoenix",
    location: "Main studio",
    priceCents: 4500,
    currency: "USD",
    includesFiring: false,
    firingDetails: null,
    capacity: 8,
    waitlistEnabled: true,
    waitlistCount: 0,
    status: "published",
    remainingCapacity: 4,
    communitySignalCounts: null,
    ...overrides,
  };
}

beforeEach(() => {
  setupGetDocsPermissionThenSuccess();
  useBatchesState = { active: [], history: [], error: "" };
  listEventsMock.mockResolvedValue({
    data: {
      ok: true,
      events: [],
    },
    meta: {},
  });
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
        isStaff={false}
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
        onOpenWorkshops={vi.fn()}
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
        isStaff={false}
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
        onOpenWorkshops={vi.fn()}
        onOpenMessages={vi.fn()}
        onOpenPieces={vi.fn()}
      />
    );

    expect(await screen.findByText("No kiln status available yet.")).toBeDefined();
    expect(screen.queryByText(/Using sample kiln data/i)).toBeNull();
    expect(screen.queryByText("L&L eQ2827-3")).toBeNull();
  });

  it("opens My Pieces with focus target when preview chip is clicked", async () => {
    const user = createUser();
    const onOpenPieces = vi.fn();
    getDocsCalls = [];
    useBatchesState = {
      active: [
        {
          id: "batch-focus",
          title: "QA target batch",
          status: "GREENWARE",
          isClosed: false,
          ownerUid: user.uid,
        },
      ],
      history: [],
      error: "",
    };
    getDocsMock = async (queryRef: MockQuery) => {
      getDocsCalls.push(queryRef);
      if (queryRef.path === "kilns" || queryRef.path === "kilnFirings") {
        return createSnapshot([]);
      }
      if (queryRef.path === "batches/batch-focus/pieces") {
        return createSnapshot([
          {
            id: "piece-focus",
            data: {
              pieceCode: "",
              shortDesc: "QA target batch",
              stage: "GREENWARE",
              isArchived: false,
              updatedAt: new Date().toISOString(),
            },
          },
        ]);
      }
      return createSnapshot([]);
    };

    render(
      <DashboardView
        user={user}
        isStaff={false}
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
        onOpenWorkshops={vi.fn()}
        onOpenMessages={vi.fn()}
        onOpenPieces={onOpenPieces}
      />
    );

    const previewButton = await screen.findByRole("button", { name: /Open QA target batch in My Pieces/i });
    fireEvent.click(previewButton);
    expect(onOpenPieces).toHaveBeenCalledWith({ batchId: "batch-focus", pieceId: "piece-focus" });
  });

  it("renders live workshop availability and routes to the workshop calendar", async () => {
    setupGetDocsEmptySuccess();
    listEventsMock.mockResolvedValue({
      data: {
        ok: true,
        events: [
          buildEventSummary({
            id: "event-live",
            title: "Kiln Club",
            remainingCapacity: 2,
            includesFiring: true,
            communitySignalCounts: {
              totalSignals: 3,
              requestSignals: 1,
              interestSignals: 2,
              showcaseSignals: 0,
              withdrawnSignals: 0,
              demandScore: 4,
              latestSignalAtMs: Date.now() - 60_000,
            },
          }),
        ],
      },
      meta: {},
    });
    const onOpenWorkshops = vi.fn();

    render(
      <DashboardView
        user={createUser()}
        isStaff={false}
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
        onOpenWorkshops={onOpenWorkshops}
        onOpenMessages={vi.fn()}
        onOpenPieces={vi.fn()}
      />
    );

    expect(await screen.findByText("Kiln Club")).toBeDefined();
    expect(screen.getByText("2 spots left")).toBeDefined();
    expect(screen.getAllByText("Glaze inspiration")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: /Open workshop calendar/i }));
    expect(onOpenWorkshops).toHaveBeenCalledTimes(1);
  });

  it("hides QA workshop fixtures and falls back to a quick note when no live workshops remain", async () => {
    setupGetDocsEmptySuccess();
    listEventsMock.mockResolvedValue({
      data: {
        ok: true,
        events: [
          buildEventSummary({
            id: "event-qa",
            title: "QA Fixture Workshop 2026-03-20",
            summary: "Seeded workshop fixture for deterministic canary coverage.",
            remainingCapacity: 6,
          }),
        ],
      },
      meta: {},
    });
    const onOpenWorkshops = vi.fn();

    render(
      <DashboardView
        user={createUser()}
        isStaff={false}
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
        onOpenWorkshops={onOpenWorkshops}
        onOpenMessages={vi.fn()}
        onOpenPieces={vi.fn()}
      />
    );

    expect(await screen.findByText("No workshops are currently scheduled.")).toBeDefined();
    expect(screen.getByText("Open the workshop calendar for the latest schedule.")).toBeDefined();
    expect(screen.queryByText(/QA Fixture Workshop/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Open workshop calendar/i }));
    expect(onOpenWorkshops).toHaveBeenCalledTimes(1);
  });
});
