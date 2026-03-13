/** @vitest-environment jsdom */

import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "firebase/auth";

import { useStudioReservationsData } from "./useStudioReservationsData";

type TestUser = User & { uid: string; getIdToken: ReturnType<typeof vi.fn> };

const { createPortalApi, listMyStudioReservations, listStudioReservationCalendar } = vi.hoisted(() => {
  const listCalendar = vi.fn();
  const listMine = vi.fn();
  return {
    listStudioReservationCalendar: listCalendar,
    listMyStudioReservations: listMine,
    createPortalApi: vi.fn(() => ({
      listStudioReservationCalendar: listCalendar,
      listMyStudioReservations: listMine,
    })),
  };
});

vi.mock("../api/portalApi", () => ({
  createPortalApi,
}));

function createUser(uid = "studio-maker"): TestUser {
  return {
    uid,
    email: "maker@monsoonfire.com",
    displayName: "Studio Maker",
    getIdToken: vi.fn(async () => "studio-test-id-token"),
  } as unknown as TestUser;
}

function Harness({ user, selectedSpaceId }: { user: User; selectedSpaceId: string }) {
  const requestedSpaceIds = selectedSpaceId !== "all" ? [selectedSpaceId] : [];
  const { error, loading, spaces } = useStudioReservationsData({
    user,
    adminToken: "dev-admin-token",
    rangeStartIso: "2026-03-13T07:00:00.000Z",
    rangeEndIso: "2026-03-14T07:00:00.000Z",
    spaceIds: requestedSpaceIds,
  });

  return (
    <div>
      <div data-testid="loading">{String(loading)}</div>
      <div data-testid="error">{error}</div>
      <div data-testid="space-count">{spaces.length}</div>
    </div>
  );
}

beforeEach(() => {
  createPortalApi.mockClear();
  listStudioReservationCalendar.mockReset();
  listMyStudioReservations.mockReset();

  listStudioReservationCalendar.mockResolvedValue({
    data: {
      ok: true,
      data: {
        spaces: [],
        entries: [],
        reservations: [],
        timezone: "America/Phoenix",
        generatedDefaults: false,
      },
    },
  });
  listMyStudioReservations.mockResolvedValue({
    data: {
      ok: true,
      data: {
        reservations: [],
        timezone: "America/Phoenix",
      },
    },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useStudioReservationsData", () => {
  it("does not refetch when equivalent space filters are recreated across rerenders", async () => {
    const user = createUser();

    render(<Harness user={user} selectedSpaceId="wheel-studio" />);

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });

    expect(createPortalApi).toHaveBeenCalledTimes(1);
    expect(listStudioReservationCalendar).toHaveBeenCalledTimes(1);
    expect(listMyStudioReservations).toHaveBeenCalledTimes(1);
    expect(user.getIdToken).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("error").textContent).toBe("");
    expect(screen.getByTestId("space-count").textContent).toBe("0");

    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(listStudioReservationCalendar).toHaveBeenCalledTimes(1);
    expect(listMyStudioReservations).toHaveBeenCalledTimes(1);
    expect(user.getIdToken).toHaveBeenCalledTimes(1);
  });
});
