/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { User } from "firebase/auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ProfileView from "./ProfileView";

const { getDocMock, setDocMock, updateProfileMock } = vi.hoisted(() => ({
  getDocMock: vi.fn(),
  setDocMock: vi.fn(async () => undefined),
  updateProfileMock: vi.fn(async () => undefined),
}));

function createDocSnapshot(data: Record<string, unknown> | null) {
  return {
    exists: () => data !== null,
    data: () => data,
  };
}

function createUser(): User {
  return {
    uid: "member-1",
    email: "member@monsoonfire.com",
    displayName: "Studio Member",
    photoURL: null,
    isAnonymous: false,
    metadata: {
      creationTime: "2026-01-05T00:00:00.000Z",
      lastSignInTime: "2026-04-12T00:00:00.000Z",
    },
    getIdToken: vi.fn(async () => "member-token"),
    getIdTokenResult: vi.fn(async () => ({ claims: {} })),
  } as unknown as User;
}

vi.mock("../firebase", () => ({
  db: { name: "mock-db" },
}));

vi.mock("../hooks/useBatches", () => ({
  useBatches: () => ({
    active: [],
    history: [],
  }),
}));

vi.mock("../hooks/usePrefersReducedMotion", () => ({
  usePrefersReducedMotion: () => false,
}));

vi.mock("../theme/themeStorage", () => ({
  writeStoredPortalTheme: vi.fn(),
}));

vi.mock("../theme/motionStorage", () => ({
  writeStoredEnhancedMotion: vi.fn(),
}));

vi.mock("firebase/auth", () => ({
  updateProfile: updateProfileMock,
}));

vi.mock("firebase/firestore", () => ({
  doc: vi.fn((_: unknown, ...segments: string[]) => ({
    path: segments.join("/"),
  })),
  getDoc: getDocMock,
  serverTimestamp: vi.fn(() => "serverTimestamp"),
  setDoc: setDocMock,
}));

vi.mock("firebase/storage", () => ({
  connectStorageEmulator: vi.fn(),
  deleteObject: vi.fn(async () => undefined),
  getDownloadURL: vi.fn(async () => "https://example.com/profile.png"),
  getStorage: vi.fn(() => ({})),
  ref: vi.fn((_: unknown, path?: string) => ({ path: path ?? "" })),
  uploadBytes: vi.fn(async () => ({ metadata: {} })),
}));

describe("ProfileView reservation notification settings", () => {
  beforeEach(() => {
    getDocMock.mockReset();
    setDocMock.mockReset();
    updateProfileMock.mockReset();

    getDocMock.mockImplementation(async (ref: { path: string }) => {
      switch (ref.path) {
        case "profiles/member-1":
          return createDocSnapshot({
            displayName: "Studio Member",
            preferredKilns: ["Skutt 1027"],
            notifyKiln: true,
            notifyClasses: false,
            notifyPieces: true,
            notifyReservations: true,
          });
        case "users/member-1/prefs/notifications":
          return createDocSnapshot({
            enabled: true,
            channels: {
              inApp: true,
              email: true,
              push: false,
              sms: false,
            },
            events: {
              kilnUnloaded: true,
              kilnUnloadedBisque: true,
              kilnUnloadedGlaze: true,
              reservationStatus: true,
              reservationEtaShift: false,
              reservationPickupReady: true,
              reservationDelayFollowUp: false,
              reservationPickupReminder: true,
            },
            quietHours: {
              enabled: false,
              startLocal: "21:00",
              endLocal: "08:00",
              timezone: "America/Phoenix",
            },
            frequency: {
              mode: "immediate",
              digestHours: 6,
            },
          });
        default:
          return createDocSnapshot(null);
      }
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders reservation notification toggles and saves the reservation-specific prefs", async () => {
    render(
      <ProfileView
        user={createUser()}
        themeName="portal"
        onThemeChange={() => undefined}
        enhancedMotion={false}
        onEnhancedMotionChange={() => undefined}
        onOpenIntegrations={() => undefined}
        onOpenBilling={() => undefined}
        onAvatarUpdated={() => undefined}
      />,
    );

    expect(await screen.findByText("Notification settings")).toBeTruthy();
    expect(screen.getByText("Reservations & pickup")).toBeTruthy();

    const reservationUpdates = screen.getByLabelText("Reservation and pickup updates") as HTMLInputElement;
    const statusChanges = screen.getByLabelText("Status changes") as HTMLInputElement;
    const etaShifts = screen.getByLabelText("ETA shifts") as HTMLInputElement;
    const readyForPickup = screen.getByLabelText("Ready for pickup") as HTMLInputElement;
    const delayFollowUps = screen.getByLabelText("Delay follow-ups") as HTMLInputElement;
    const pickupReminders = screen.getByLabelText("Pickup reminders") as HTMLInputElement;

    await waitFor(() => {
      expect(etaShifts.checked).toBe(false);
      expect(delayFollowUps.checked).toBe(false);
    });

    expect(reservationUpdates.checked).toBe(true);
    expect(statusChanges.checked).toBe(true);
    expect(readyForPickup.checked).toBe(true);
    expect(pickupReminders.checked).toBe(true);

    fireEvent.click(reservationUpdates);
    fireEvent.click(etaShifts);
    fireEvent.click(delayFollowUps);
    fireEvent.click(screen.getByRole("button", { name: "Save notifications" }));

    await waitFor(() => {
      expect(setDocMock).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText("Notification settings saved.")).toBeTruthy();

    const calls = setDocMock.mock.calls.map(([ref, value, options]) => ({
      path: ref.path as string,
      value: value as Record<string, unknown>,
      options: options as { merge?: boolean } | undefined,
    }));

    const notificationPrefsWrite = calls.find((entry) => entry.path === "users/member-1/prefs/notifications");
    expect(notificationPrefsWrite).toBeTruthy();
    expect(notificationPrefsWrite?.options).toEqual({ merge: true });
    expect(notificationPrefsWrite?.value.events).toEqual({
      kilnUnloaded: true,
      kilnUnloadedBisque: true,
      kilnUnloadedGlaze: true,
      reservationStatus: true,
      reservationEtaShift: true,
      reservationPickupReady: true,
      reservationDelayFollowUp: true,
      reservationPickupReminder: true,
    });

    const profileWrite = calls.find((entry) => entry.path === "profiles/member-1");
    expect(profileWrite).toBeTruthy();
    expect(profileWrite?.options).toEqual({ merge: true });
    expect(profileWrite?.value.notifyReservations).toBe(false);
  });
});
