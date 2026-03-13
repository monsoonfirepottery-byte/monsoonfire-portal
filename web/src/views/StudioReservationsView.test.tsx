/** @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "firebase/auth";

import { safeStorageGetItem } from "../lib/safeStorage";
import StudioReservationsView from "./StudioReservationsView";

const { apiMock, feedbackAudioMock, createPortalApi, useStudioReservationsData } = vi.hoisted(() => {
  const apiMock = {
    createStudioReservation: vi.fn(),
    joinStudioReservationWaitlist: vi.fn(),
    cancelStudioReservation: vi.fn(),
  };
  const feedbackAudioMock = {
    prime: vi.fn(),
    play: vi.fn(),
    dispose: vi.fn(),
  };

  return {
    apiMock,
    feedbackAudioMock,
    createPortalApi: vi.fn(() => apiMock),
    useStudioReservationsData: vi.fn(),
  };
});

vi.mock("../api/portalApi", () => ({
  createPortalApi,
  PortalApiError: class PortalApiError extends Error {
    meta: { code?: string };
    appError?: { code?: string };

    constructor(message: string, meta: { code?: string } = {}, appError?: { code?: string }) {
      super(message);
      this.name = "PortalApiError";
      this.meta = meta;
      this.appError = appError;
    }
  },
}));

vi.mock("../hooks/useStudioReservationsData", () => ({
  useStudioReservationsData,
}));

vi.mock("../lib/studioReservationFeedbackAudio", () => ({
  createStudioReservationFeedbackAudio: vi.fn(() => feedbackAudioMock),
}));

function createUser(): User {
  return {
    uid: "studio-maker",
    email: "maker@monsoonfire.com",
    displayName: "Studio Maker",
    getIdToken: vi.fn(async () => "studio-test-id-token"),
  } as unknown as User;
}

function createStorageMock() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.has(key) ? values.get(key)! : null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
    clear() {
      values.clear();
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null;
    },
    get length() {
      return values.size;
    },
  };
}

function baseSpaces() {
  return [
    {
      id: "handbuilding-area-indoors",
      name: "Handbuilding Area (indoors)",
      description: "Indoor tables for longer handbuilding sessions.",
      category: "Handbuilding",
      bookingMode: "capacity",
      capacity: 1,
      colorToken: "#d7c4aa",
      resources: [],
      templates: [],
      sortOrder: 0,
    },
    {
      id: "glaze-kitchen-outdoors",
      name: "Glaze Kitchen (outdoors)",
      description: "Outdoor glaze prep and finishing space.",
      category: "Glaze kitchen",
      bookingMode: "capacity",
      capacity: 1,
      colorToken: "#b9c7d2",
      resources: [],
      templates: [],
      sortOrder: 1,
    },
    {
      id: "wheel-throwing-sanding",
      name: "Wheel Throwing & Sanding",
      description: "Reserve a wheel instead of a shared seat.",
      category: "Wheel throwing",
      bookingMode: "resource",
      capacity: null,
      colorToken: "#cdb7a0",
      resources: [
        { id: "skutt-wheel", label: "Skutt wheel", active: true },
        { id: "vevor-wheel-trimming-only", label: "Vevor wheel (trimming only)", active: true },
      ],
      templates: [],
      sortOrder: 2,
    },
  ];
}

function makeEntry(overrides: Record<string, unknown>) {
  return {
    id: "entry-1",
    kind: "availability",
    status: "available",
    title: "Handbuilding slot",
    spaceId: "handbuilding-area-indoors",
    spaceName: "Handbuilding Area (indoors)",
    startAtDate: new Date("2026-03-13T17:00:00.000Z"),
    endAtDate: new Date("2026-03-13T19:00:00.000Z"),
    startAt: "2026-03-13T17:00:00.000Z",
    endAt: "2026-03-13T19:00:00.000Z",
    availableCount: 4,
    capacity: 4,
    waitlistCount: 0,
    bookingMode: "capacity",
    availableResourceIds: [],
    myReservationId: null,
    myWaitlistId: null,
    staffReservations: [],
    ...overrides,
  };
}

function makeReservation(overrides: Record<string, unknown>) {
  return {
    id: "reservation-1",
    spaceId: "handbuilding-area-indoors",
    spaceName: "Handbuilding Area (indoors)",
    status: "confirmed",
    quantity: 1,
    assignedResourceIds: [],
    canCancel: true,
    startAtDate: new Date("2026-03-14T18:00:00.000Z"),
    endAtDate: new Date("2026-03-14T20:00:00.000Z"),
    ...overrides,
  };
}

type ReservationCreateCall = {
  adminToken?: string;
  payload: {
    spaceId?: string;
    quantity?: number;
    resourceIds?: string[];
    note?: string | null;
  };
};

type WaitlistCall = {
  payload: {
    spaceId?: string;
    quantity?: number;
    note?: string | null;
  };
};

function baseHookValue() {
  return {
    spaces: baseSpaces(),
    entries: [],
    myReservations: [],
    timezone: "America/Phoenix",
    generatedDefaults: false,
    loading: false,
    error: "",
    reload: vi.fn(async () => undefined),
  };
}

beforeEach(() => {
  Object.defineProperty(window, "localStorage", {
    value: createStorageMock(),
    configurable: true,
  });
  window.localStorage?.removeItem?.("mf_studio_reservations_last_space");
  window.localStorage?.removeItem?.("mf:studioReservationsSoundEnabled");
  window.history.replaceState({}, "", "/reservations?date=2026-03-13");
  document.documentElement.dataset.portalMotion = "enhanced";
  document.documentElement.dataset.portalTheme = "portal";
  createPortalApi.mockClear();
  useStudioReservationsData.mockReset();
  apiMock.createStudioReservation.mockReset();
  apiMock.joinStudioReservationWaitlist.mockReset();
  apiMock.cancelStudioReservation.mockReset();
  feedbackAudioMock.prime.mockReset();
  feedbackAudioMock.play.mockReset();
  feedbackAudioMock.dispose.mockReset();
  apiMock.createStudioReservation.mockResolvedValue({
    data: { ok: true, data: { reservationId: "reservation-new" } },
  });
  apiMock.joinStudioReservationWaitlist.mockResolvedValue({
    data: { ok: true, data: { reservationId: "waitlist-new" } },
  });
  apiMock.cancelStudioReservation.mockResolvedValue({
    data: { ok: true },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("StudioReservationsView", () => {
  it("renders a space-first flow with a featured opening and available-day browsing", async () => {
    useStudioReservationsData.mockReturnValue({
      ...baseHookValue(),
      entries: [
        makeEntry({
          id: "handbuilding-feature",
          startAtDate: new Date("2026-03-13T17:00:00.000Z"),
          endAtDate: new Date("2026-03-13T19:00:00.000Z"),
          startAt: "2026-03-13T17:00:00.000Z",
          endAt: "2026-03-13T19:00:00.000Z",
        }),
        makeEntry({
          id: "handbuilding-alt",
          startAtDate: new Date("2026-03-13T20:00:00.000Z"),
          endAtDate: new Date("2026-03-13T22:00:00.000Z"),
          startAt: "2026-03-13T20:00:00.000Z",
          endAt: "2026-03-13T22:00:00.000Z",
        }),
        makeEntry({
          id: "handbuilding-other-day",
          startAtDate: new Date("2026-03-14T16:00:00.000Z"),
          endAtDate: new Date("2026-03-14T18:00:00.000Z"),
          startAt: "2026-03-14T16:00:00.000Z",
          endAt: "2026-03-14T18:00:00.000Z",
        }),
        makeEntry({
          id: "glaze-open",
          spaceId: "glaze-kitchen-outdoors",
          spaceName: "Glaze Kitchen (outdoors)",
          title: "Glaze slot",
          startAtDate: new Date("2026-03-15T18:00:00.000Z"),
          endAtDate: new Date("2026-03-15T20:00:00.000Z"),
          startAt: "2026-03-15T18:00:00.000Z",
          endAt: "2026-03-15T20:00:00.000Z",
        }),
      ],
    });

    render(
      <StudioReservationsView
        user={createUser()}
        adminToken="dev-admin-token"
        isStaff={false}
      />
    );

    expect(screen.getByText("Choose a space")).toBeTruthy();
    expect(screen.getByText("Best next opening")).toBeTruthy();
    expect(screen.queryByText("More good times")).toBeNull();
    expect(screen.getByRole("button", { name: /Show 2 more good times/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Next week/i })).toBeNull();
    expect(screen.getByRole("button", { name: /^Book Fri, Mar 13/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Show 2 more good times/i }));

    expect(screen.getByText("More good times")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Choose another day/i }));

    expect(screen.getByRole("button", { name: /Sat, Mar 14/i })).toBeTruthy();
    expect(document.querySelectorAll(".studio-date-chip")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: /Sat, Mar 14/i }));

    await waitFor(() => expect(window.location.search).toContain("space=handbuilding-area-indoors"));
    await waitFor(() => expect(window.location.search).toContain("date=2026-03-14"));
  });

  it("books capacity spaces immediately from the featured opening", async () => {
    const hookValue = {
      ...baseHookValue(),
      entries: [
        makeEntry({
          id: "handbuilding-feature",
          availableCount: 3,
        }),
      ],
    };
    useStudioReservationsData.mockReturnValue(hookValue);

    render(
      <StudioReservationsView
        user={createUser()}
        adminToken="dev-admin-token"
        isStaff={false}
      />
    );

    expect(screen.getByRole("button", { name: /^Book Fri, Mar 13/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Booking options/i })).toBeNull();

    fireEvent.change(screen.getByLabelText(/Note for staff/i), {
      target: { value: "Please leave room for a glaze test." },
    });

    fireEvent.click(screen.getByRole("button", { name: /^Book Fri, Mar 13/i }));

    await waitFor(() => expect(apiMock.createStudioReservation).toHaveBeenCalledTimes(1));

    const createCall = apiMock.createStudioReservation.mock.calls[0]?.[0] as ReservationCreateCall | undefined;
    expect(createCall).toBeTruthy();
    expect(createCall?.adminToken).toBe("dev-admin-token");
    expect(createCall?.payload.spaceId).toBe("handbuilding-area-indoors");
    expect(createCall?.payload.quantity).toBe(1);
    expect(createCall?.payload.resourceIds).toBeUndefined();
    expect(createCall?.payload.note).toBe("Please leave room for a glaze test.");
    await waitFor(() =>
      expect(
        document
          .querySelector(".studio-feature-layout .studio-time-row")
          ?.getAttribute("data-feedback-phase")
      ).toBe("success")
    );
    expect(screen.getByText(/Booked Handbuilding Area \(indoors\)/i)).toBeTruthy();
    expect((screen.getByLabelText(/Note for staff/i) as HTMLTextAreaElement).value).toBe("");
    expect(hookValue.reload).toHaveBeenCalledTimes(1);
  });

  it("keeps wheel bookings behind a compact chooser", async () => {
    useStudioReservationsData.mockReturnValue({
      ...baseHookValue(),
      entries: [
        makeEntry({
          id: "wheel-open",
          title: "Wheel session",
          spaceId: "wheel-throwing-sanding",
          spaceName: "Wheel Throwing & Sanding",
          bookingMode: "resource",
          availableCount: 2,
          availableResourceIds: ["skutt-wheel", "vevor-wheel-trimming-only"],
        }),
      ],
    });

    render(
      <StudioReservationsView
        user={createUser()}
        adminToken="dev-admin-token"
        isStaff={false}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /^Wheel Throwing & Sanding/i }));
    fireEvent.click(screen.getByRole("button", { name: /Choose wheel/i }));

    expect(apiMock.createStudioReservation).not.toHaveBeenCalled();
    expect(screen.getByText("Choose your wheel")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Skutt wheel/i })).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Note for staff/i), {
      target: { value: "Need the trimming splash pan too." },
    });

    fireEvent.click(screen.getByRole("button", { name: /Reserve selected wheel/i }));

    await waitFor(() => expect(apiMock.createStudioReservation).toHaveBeenCalledTimes(1));

    const createCall = apiMock.createStudioReservation.mock.calls[0]?.[0] as ReservationCreateCall | undefined;
    expect(createCall).toBeTruthy();
    expect(createCall?.payload.spaceId).toBe("wheel-throwing-sanding");
    expect(createCall?.payload.quantity).toBeUndefined();
    expect(createCall?.payload.resourceIds).toEqual(["skutt-wheel"]);
    expect(createCall?.payload.note).toBe("Need the trimming splash pan too.");
    await waitFor(() => expect(screen.getByText("Reservation confirmed.")).toBeTruthy());
    expect((screen.getByLabelText(/Note for staff/i) as HTMLTextAreaElement).value).toBe("");
  });

  it("shows action-scoped failure feedback when a booking is rejected", async () => {
    useStudioReservationsData.mockReturnValue({
      ...baseHookValue(),
      entries: [
        makeEntry({
          id: "handbuilding-feature",
          availableCount: 1,
        }),
      ],
    });
    apiMock.createStudioReservation.mockRejectedValueOnce(new Error("This opening is no longer available."));

    render(
      <StudioReservationsView
        user={createUser()}
        adminToken="dev-admin-token"
        isStaff={false}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /^Book Fri, Mar 13/i }));

    await waitFor(() => expect(apiMock.createStudioReservation).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        document
          .querySelector(".studio-feature-layout .studio-time-row")
          ?.getAttribute("data-feedback-phase")
      ).toBe("error")
    );
    expect(screen.getAllByText("That opening just changed. Pick another time and try again.").length).toBeGreaterThan(0);
  });

  it("uses waitlist browsing as a secondary recovery path when the horizon is full", async () => {
    useStudioReservationsData.mockReturnValue({
      ...baseHookValue(),
      entries: [
        makeEntry({
          id: "handbuilding-full",
          status: "full",
          availableCount: 0,
          waitlistCount: 2,
        }),
      ],
    });

    render(
      <StudioReservationsView
        user={createUser()}
        adminToken="dev-admin-token"
        isStaff={false}
      />
    );

    expect(screen.getByText(/The next 14 days are full for Handbuilding Area \(indoors\)/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Join a waitlist/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Next week/i })).toBeNull();

    fireEvent.change(screen.getByLabelText(/Note for staff/i), {
      target: { value: "Text me if an earlier slot opens." },
    });
    fireEvent.click(screen.getByRole("button", { name: /Join a waitlist/i }));

    expect(screen.getByRole("button", { name: /Fri, Mar 13/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Join waitlist/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Join waitlist/i }));

    await waitFor(() => expect(apiMock.joinStudioReservationWaitlist).toHaveBeenCalledTimes(1));
    const waitlistCall = apiMock.joinStudioReservationWaitlist.mock.calls[0]?.[0] as WaitlistCall | undefined;
    expect(waitlistCall).toBeTruthy();
    expect(waitlistCall?.payload.spaceId).toBe("handbuilding-area-indoors");
    expect(waitlistCall?.payload.quantity).toBe(1);
    expect(waitlistCall?.payload.note).toBe("Text me if an earlier slot opens.");
    expect((screen.getByLabelText(/Note for staff/i) as HTMLTextAreaElement).value).toBe("");
  });

  it("keeps my reservations secondary and collapsed until opened", async () => {
    useStudioReservationsData.mockReturnValue({
      ...baseHookValue(),
      entries: [
        makeEntry({
          id: "glaze-open",
          title: "Glaze kitchen block",
          spaceId: "glaze-kitchen-outdoors",
          spaceName: "Glaze Kitchen (outdoors)",
          startAtDate: new Date("2026-03-14T20:00:00.000Z"),
          endAtDate: new Date("2026-03-14T22:00:00.000Z"),
          startAt: "2026-03-14T20:00:00.000Z",
          endAt: "2026-03-14T22:00:00.000Z",
          availableCount: 2,
        }),
      ],
      myReservations: [
        makeReservation({
          id: "reservation-glaze",
          spaceId: "glaze-kitchen-outdoors",
          spaceName: "Glaze Kitchen (outdoors)",
          startAtDate: new Date("2026-03-14T20:00:00.000Z"),
          endAtDate: new Date("2026-03-14T22:00:00.000Z"),
        }),
      ],
    });

    render(
      <StudioReservationsView
        user={createUser()}
        adminToken="dev-admin-token"
        isStaff={false}
      />
    );

    const reservationsDetails = screen.getByText("My reservations").closest("details");
    expect(reservationsDetails).toBeTruthy();
    expect((reservationsDetails as HTMLDetailsElement).open).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /Manage reservations/i }));

    await waitFor(() => expect((reservationsDetails as HTMLDetailsElement).open).toBe(true));
    expect(screen.getByRole("button", { name: /Browse this day/i })).toBeTruthy();
  });

  it("defaults feedback sound to on and persists the toggle", async () => {
    useStudioReservationsData.mockReturnValue({
      ...baseHookValue(),
      entries: [
        makeEntry({
          id: "handbuilding-feature",
        }),
      ],
    });

    render(
      <StudioReservationsView
        user={createUser()}
        adminToken="dev-admin-token"
        isStaff={false}
      />
    );

    const soundToggle = screen.getByRole("button", { name: /Mute booking chime/i });
    expect(soundToggle.getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(safeStorageGetItem("localStorage", "mf:studioReservationsSoundEnabled")).toBe("1"));

    fireEvent.click(soundToggle);

    expect(screen.getByRole("button", { name: /Unmute booking chime/i }).getAttribute("aria-pressed")).toBe("false");
    await waitFor(() => expect(safeStorageGetItem("localStorage", "mf:studioReservationsSoundEnabled")).toBe("0"));
  });

  it("keeps feedback readable and functional in reduced motion mode", async () => {
    document.documentElement.dataset.portalMotion = "reduced";
    useStudioReservationsData.mockReturnValue({
      ...baseHookValue(),
      entries: [
        makeEntry({
          id: "handbuilding-feature",
          availableCount: 1,
        }),
      ],
    });

    render(
      <StudioReservationsView
        user={createUser()}
        adminToken="dev-admin-token"
        isStaff={false}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /^Book Fri, Mar 13/i }));

    await waitFor(() => expect(apiMock.createStudioReservation).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/Booked Handbuilding Area \(indoors\)/i)).toBeTruthy();
    expect(
      document
        .querySelector(".studio-feature-layout .studio-time-row")
        ?.getAttribute("data-feedback-phase")
    ).toBe("success");
  });

  it("plays the cancel chime when a reservation is canceled", async () => {
    useStudioReservationsData.mockReturnValue({
      ...baseHookValue(),
      entries: [
        makeEntry({
          id: "glaze-open",
          title: "Glaze kitchen block",
          spaceId: "glaze-kitchen-outdoors",
          spaceName: "Glaze Kitchen (outdoors)",
          startAtDate: new Date("2026-03-14T20:00:00.000Z"),
          endAtDate: new Date("2026-03-14T22:00:00.000Z"),
          startAt: "2026-03-14T20:00:00.000Z",
          endAt: "2026-03-14T22:00:00.000Z",
          availableCount: 1,
        }),
      ],
      myReservations: [
        makeReservation({
          id: "reservation-glaze",
          spaceId: "glaze-kitchen-outdoors",
          spaceName: "Glaze Kitchen (outdoors)",
          startAtDate: new Date("2026-03-14T20:00:00.000Z"),
          endAtDate: new Date("2026-03-14T22:00:00.000Z"),
        }),
      ],
    });

    render(
      <StudioReservationsView
        user={createUser()}
        adminToken="dev-admin-token"
        isStaff={false}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Manage reservations/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Cancel$/i })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/i }));

    await waitFor(() => expect(apiMock.cancelStudioReservation).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(feedbackAudioMock.play).toHaveBeenCalledWith("cancel"));
  });

  it("uses the error tone when canceling fails", async () => {
    apiMock.cancelStudioReservation.mockRejectedValueOnce(new Error("Unable to cancel reservation."));
    useStudioReservationsData.mockReturnValue({
      ...baseHookValue(),
      entries: [
        makeEntry({
          id: "glaze-open",
          title: "Glaze kitchen block",
          spaceId: "glaze-kitchen-outdoors",
          spaceName: "Glaze Kitchen (outdoors)",
          startAtDate: new Date("2026-03-14T20:00:00.000Z"),
          endAtDate: new Date("2026-03-14T22:00:00.000Z"),
          startAt: "2026-03-14T20:00:00.000Z",
          endAt: "2026-03-14T22:00:00.000Z",
          availableCount: 1,
        }),
      ],
      myReservations: [
        makeReservation({
          id: "reservation-glaze",
          spaceId: "glaze-kitchen-outdoors",
          spaceName: "Glaze Kitchen (outdoors)",
          startAtDate: new Date("2026-03-14T20:00:00.000Z"),
          endAtDate: new Date("2026-03-14T22:00:00.000Z"),
        }),
      ],
    });

    render(
      <StudioReservationsView
        user={createUser()}
        adminToken="dev-admin-token"
        isStaff={false}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Manage reservations/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Cancel$/i })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/i }));

    await waitFor(() => expect(apiMock.cancelStudioReservation).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(feedbackAudioMock.play).toHaveBeenCalledWith("error"));
  });
});
