/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "firebase/auth";
import type { ReactNode } from "react";

import ReservationsView from "./ReservationsView";

type MockConstraint =
  | { type: "orderBy"; field: string; direction: "asc" | "desc" }
  | { type: "limit"; value: number }
  | { type: "where"; field: string; op: string; value: unknown };
type MockCollectionRef = { path: string };
type MockQuery = { path: string; constraints: MockConstraint[] };
type MockDoc = { id: string; data: Record<string, unknown> };
type Snapshot = { docs: { id: string; data: () => Record<string, unknown> }[] };

const { postJsonMock, createFunctionsClientMock, createPortalApiMock } = vi.hoisted(() => ({
  postJsonMock: vi.fn(),
  createFunctionsClientMock: vi.fn(() => ({
    postJson: postJsonMock,
    getLastRequest: () => ({ url: "functions/createReservation" }),
  })),
  createPortalApiMock: vi.fn(() => ({
    updateReservation: vi.fn(),
    assignReservationStation: vi.fn(),
    updateReservationPickupWindow: vi.fn(),
    updateReservationQueueFairness: vi.fn(),
    exportReservationContinuity: vi.fn(),
  })),
}));

function createSnapshot(rows: MockDoc[]): Snapshot {
  return {
    docs: rows.map((row) => ({
      id: row.id,
      data: () => row.data,
    })),
  };
}

function createUser(): User {
  return {
    uid: "member-1",
    email: "member@monsoonfire.com",
    displayName: "Studio Member",
    isAnonymous: false,
    getIdToken: vi.fn(async () => "member-token"),
    getIdTokenResult: vi.fn(async () => ({ claims: {} })),
  } as unknown as User;
}

vi.mock("../api/functionsClient", () => ({
  createFunctionsClient: createFunctionsClientMock,
}));

vi.mock("../api/portalApi", () => ({
  createPortalApi: createPortalApiMock,
}));

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
  const where = vi.fn((field: string, op: string, value: unknown) => ({
    type: "where" as const,
    field,
    op,
    value,
  }));
  const orderBy = vi.fn((field: string, direction: "asc" | "desc" = "asc") => ({
    type: "orderBy" as const,
    field,
    direction,
  }));
  const limit = vi.fn((value: number) => ({ type: "limit" as const, value }));
  const getDocs = vi.fn(async (queryRef: MockQuery) => {
    if (queryRef.path === "kilns") {
      return createSnapshot([
        {
          id: "kiln-studio-electric",
          data: {
            name: "Studio kiln (electric)",
            status: "idle",
          },
        },
      ]);
    }
    return createSnapshot([]);
  });

  return {
    collection,
    getDocs,
    limit,
    orderBy,
    query,
    where,
  };
});

vi.mock("firebase/storage", () => ({
  connectStorageEmulator: vi.fn(),
  getDownloadURL: vi.fn(async () => "https://example.com/photo.jpg"),
  getStorage: vi.fn(() => ({})),
  ref: vi.fn(() => ({})),
  uploadBytes: vi.fn(async () => undefined),
}));

vi.mock("../auth/staffRole", () => ({
  parseStaffRoleFromClaims: () => ({
    isStaff: false,
    roles: [],
  }),
}));

vi.mock("../context/UiSettingsContext", () => ({
  useUiSettings: () => ({
    themeName: "portal",
    portalMotion: "reduced",
    enhancedMotion: false,
    prefersReducedMotion: false,
  }),
}));

vi.mock("../components/RevealCard", () => ({
  default: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

vi.mock("../lib/safeStorage", () => ({
  safeStorageReadJson: (_target: string, _key: string, fallback: unknown) => fallback,
  safeStorageRemoveItem: vi.fn(),
  safeStorageSetItem: vi.fn(),
}));

vi.mock("../lib/analytics", () => ({
  shortId: () => "short-id",
  track: vi.fn(),
}));

beforeEach(() => {
  postJsonMock.mockReset();
  postJsonMock.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("ReservationsView ware check-in UX", () => {
  it("keeps a single community-shelf confirmation path and surfaces oversize feedback inline", async () => {
    render(<ReservationsView user={createUser()} isStaff={false} />);

    expect(screen.getByText("4. Size + firing option")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Flexible tiny drop-off/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Standard shelf purchase/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Reserve the whole kiln/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Flexible tiny drop-off/i }));
    expect(await screen.findByText("Flexible tiny drop-off summary")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Keep standard shelf purchase/i }));
    await waitFor(() => {
      expect(screen.queryByText("Flexible tiny drop-off summary")).toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: /Flexible tiny drop-off/i }));
    expect(await screen.findByText("Flexible tiny drop-off summary")).toBeTruthy();
    fireEvent.click(
      screen.getByLabelText(/I confirm this drop-off is under one half shelf and can wait for leftover kiln space/i)
    );
    fireEvent.click(screen.getByRole("button", { name: /Use flexible tiny drop-off/i }));
    await waitFor(() => {
      expect(screen.queryByText("Flexible tiny drop-off summary")).toBeNull();
    });

    fireEvent.click(screen.getAllByRole("button", { name: /^2$/i })[0]);
    expect(
      await screen.findByText(/This load is currently too large for flexible tiny drop-off/i)
    ).toBeTruthy();
  });

  it("shows inline priority guidance and never uses browser confirm during submit", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-03-20T12:00:00.000Z"));
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<ReservationsView user={createUser()} isStaff={false} />);

    fireEvent.click(screen.getByText("6. Notes (optional)"));
    const latestInput = screen.getByLabelText(/I need it by/i);

    fireEvent.change(latestInput, {
      target: { value: "2026-03-30T12:00" },
    });
    expect(await screen.findByText(/Priority queue is recommended for this date/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Add priority queue/i }));

    fireEvent.change(latestInput, {
      target: { value: "2026-03-24T12:00" },
    });
    expect(await screen.findByText(/Priority queue was turned on for this date/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Use standard timing instead/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Check in my work/i }));

    await waitFor(() => {
      expect(postJsonMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByText(/Check-in sent\. You're all set\./i)).toBeTruthy();
    });
    expect(confirmSpy).not.toHaveBeenCalled();

    nowSpy.mockRestore();
  });
});
