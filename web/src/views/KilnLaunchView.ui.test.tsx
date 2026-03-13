/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "firebase/auth";

import KilnLaunchView from "./KilnLaunchView";

type MockQuery = { path: string };
type MockDoc = { id: string; data: Record<string, unknown> };
type Snapshot = { docs: { id: string; data: () => Record<string, unknown> }[] };
type GetDocsMock = (queryRef: MockQuery) => Promise<Snapshot>;

const { apiMock, createPortalApi } = vi.hoisted(() => {
  const apiMock = {
    listFiringsTimeline: vi.fn(),
    updateReservation: vi.fn(),
  };

  return {
    apiMock,
    createPortalApi: vi.fn(() => apiMock),
  };
});

let getDocsMock: GetDocsMock;
let getDocsCalls: MockQuery[] = [];

function createSnapshot(rows: MockDoc[]): Snapshot {
  return {
    docs: rows.map((row) => ({
      id: row.id,
      data: () => row.data,
    })),
  };
}

vi.mock("../api/portalApi", () => ({
  createPortalApi,
}));

vi.mock("firebase/firestore", () => {
  const actual = {} as typeof import("firebase/firestore");
  const initializeFirestore = vi.fn((_: unknown) => ({ name: "mock-db" }));
  const collection = vi.fn((_: unknown, path: string) => ({ path }));
  const query = vi.fn((source: MockQuery) => source);
  const orderBy = vi.fn(() => ({}));
  const limit = vi.fn(() => ({}));
  const where = vi.fn(() => ({}));

  return {
    ...actual,
    initializeFirestore,
    connectFirestoreEmulator: vi.fn(),
    collection,
    query,
    orderBy,
    limit,
    where,
    getDocs: (queryRef: MockQuery) => getDocsMock(queryRef),
  };
});

function createUser(): User {
  return {
    uid: "studio-maker-id",
    email: "maker@monsoonfire.com",
    displayName: "Studio Maker",
    getIdToken: vi.fn(async () => "test-id-token"),
  } as unknown as User;
}

beforeEach(() => {
  getDocsCalls = [];
  createPortalApi.mockClear();
  apiMock.listFiringsTimeline.mockReset();
  apiMock.updateReservation.mockReset();

  getDocsMock = async (queryRef: MockQuery) => {
    getDocsCalls.push(queryRef);
    if (queryRef.path === "reservations") {
      return createSnapshot([
        {
          id: "reservation-1",
          data: {
            ownerUid: "studio-maker-id",
            intakeMode: "SHELF_PURCHASE",
            firingType: "bisque",
            estimatedHalfShelves: 2,
            kilnId: "studio-electric",
            status: "REQUESTED",
            loadStatus: "queued",
            wareType: "stoneware",
            dropOffQuantity: { label: "Small batch", pieceRange: "4-6 pieces" },
          },
        },
      ]);
    }
    return createSnapshot([]);
  };

  apiMock.listFiringsTimeline.mockResolvedValue({
    data: {
      generatedAt: "2026-03-13T08:15:00.000Z",
      windowStart: "2026-03-13T08:15:00.000Z",
      windowEnd: "2026-03-20T08:15:00.000Z",
      kilns: [
        {
          id: "studio-electric",
          name: "L&L eQ2827-3",
          currentState: "firing",
          currentLabel: "Firing",
          segments: [
            {
              id: "firing-1",
              kilnId: "studio-electric",
              kilnName: "L&L eQ2827-3",
              state: "firing",
              label: "Cone 6 glaze firing",
              startAt: "2026-03-13T08:15:00.000Z",
              endAt: "2026-03-13T16:15:00.000Z",
              source: "firing",
              confidence: "confirmed",
              notes: "Currently running.",
            },
            {
              id: "forecast-1",
              kilnId: "studio-electric",
              kilnName: "L&L eQ2827-3",
              state: "scheduled",
              label: "Queued bisque load",
              startAt: "2026-03-14T17:00:00.000Z",
              endAt: "2026-03-15T01:00:00.000Z",
              source: "queue-forecast",
              confidence: "forecast",
              notes: "Forecast based on queued half-shelves.",
            },
          ],
          overflowNote: null,
        },
        {
          id: "reduction-raku",
          name: "Reduction Raku",
          currentState: "maintenance",
          currentLabel: "Maintenance",
          segments: [
            {
              id: "status-raku",
              kilnId: "reduction-raku",
              kilnName: "Reduction Raku",
              state: "maintenance",
              label: "Maintenance now",
              startAt: "2026-03-13T08:15:00.000Z",
              endAt: "2026-03-14T00:00:00.000Z",
              source: "status",
              confidence: "confirmed",
              notes: "Current kiln status is maintenance or offline.",
            },
          ],
          overflowNote: "Next queued load lands after this view.",
        },
      ],
    },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("KilnLaunchView timeline", () => {
  it("renders the 7-day kiln timeline and shows read-only details for a selected segment", async () => {
    render(<KilnLaunchView user={createUser()} isStaff={false} />);

    expect(await screen.findByText("Seven-day kiln calendar")).toBeDefined();
    expect(screen.getByText("L&L eQ2827-3")).toBeDefined();
    expect(screen.getByText("Reduction Raku")).toBeDefined();
    expect(screen.getByText("Next queued load lands after this view.")).toBeDefined();

    const forecastButton = await screen.findByRole("button", { name: /Queued bisque load/i });
    fireEvent.click(forecastButton);

    await waitFor(() => {
      expect(screen.getByText("Queued load forecast")).toBeDefined();
      expect(screen.getByText("Forecast based on queued half-shelves.")).toBeDefined();
      expect(screen.getByText(/Current kiln state: Firing/i)).toBeDefined();
    });

    expect(getDocsCalls.filter((entry) => entry.path === "reservations").length).toBe(1);
    expect(apiMock.listFiringsTimeline).toHaveBeenCalledTimes(1);
  });
});
