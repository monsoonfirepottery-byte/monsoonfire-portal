/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "firebase/auth";
import NotificationsView from "./NotificationsView";

const docMock = vi.fn((_: unknown, ...segments: string[]) => ({ path: segments.join("/") }));
const serverTimestampMock = vi.fn(() => "server-ts");
const updateDocMock = vi.fn(async () => undefined);
const timestampNowMock = vi.fn(() => "client-ts");
const postJsonMock = vi.fn(async () => ({ ok: true, data: { notificationId: "notif-fallback" } }));

vi.mock("../api/functionsClient", () => ({
  createFunctionsClient: () => ({
    postJson: (...args: unknown[]) => postJsonMock(...args),
  }),
}));

vi.mock("../utils/functionsBaseUrl", () => ({
  resolveFunctionsBaseUrl: () => "https://functions.example.test",
}));

vi.mock("../firebase", () => ({
  db: { name: "mock-db" },
}));

vi.mock("firebase/firestore", () => ({
  doc: (...args: unknown[]) => docMock(...(args as [unknown, ...string[]])),
  serverTimestamp: () => serverTimestampMock(),
  updateDoc: (...args: unknown[]) => updateDocMock(...args),
  Timestamp: {
    now: () => timestampNowMock(),
  },
}));

function createUser(uid = "user-1"): User {
  return {
    uid,
    getIdToken: async () => "id-token",
  } as User;
}

beforeEach(() => {
  updateDocMock.mockReset();
  updateDocMock.mockResolvedValue(undefined);
  postJsonMock.mockReset();
  postJsonMock.mockResolvedValue({ ok: true, data: { notificationId: "notif-fallback" } });
  docMock.mockClear();
  serverTimestampMock.mockClear();
  timestampNowMock.mockClear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("NotificationsView mark-read feedback", () => {
  it("shows immediate success feedback and optimistic read state", async () => {
    render(
      <NotificationsView
        user={createUser()}
        notifications={[
          {
            id: "notif-1",
            title: "Kiln update",
            body: "Your piece was unloaded.",
            createdAt: { toDate: () => new Date("2026-02-26T00:00:00.000Z") },
            readAt: null,
          },
        ]}
        loading={false}
        error=""
        onOpenFirings={() => undefined}
      />
    );

    expect(screen.queryByText("1 unread")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /mark read/i }));

    await waitFor(() => {
      expect(updateDocMock).toHaveBeenCalledTimes(1);
    });
    expect(postJsonMock).toHaveBeenCalledTimes(0);

    expect(screen.queryByText("Notification marked as read.")).not.toBeNull();
    expect(screen.queryByText("All caught up")).not.toBeNull();
    expect(screen.queryByText("Marked just now")).not.toBeNull();
  });

  it("falls back to api mark-read when Firestore permission update is denied", async () => {
    updateDocMock.mockRejectedValueOnce(new Error("Missing or insufficient permissions."));

    render(
      <NotificationsView
        user={createUser()}
        notifications={[
          {
            id: "notif-2",
            title: "Studio note",
            body: "Reminder posted.",
            createdAt: { toDate: () => new Date("2026-02-26T00:00:00.000Z") },
            readAt: null,
          },
        ]}
        loading={false}
        error=""
        onOpenFirings={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /mark read/i }));

    await waitFor(() => {
      expect(postJsonMock).toHaveBeenCalledTimes(1);
    });

    expect(screen.queryByText("Notification marked as read.")).not.toBeNull();
    expect(screen.queryByText("All caught up")).not.toBeNull();
  });

  it("shows mark-read error when both Firestore and fallback api fail", async () => {
    updateDocMock.mockRejectedValueOnce(new Error("Missing or insufficient permissions."));
    postJsonMock.mockRejectedValueOnce(new Error("fallback failed"));

    render(
      <NotificationsView
        user={createUser()}
        notifications={[
          {
            id: "notif-3",
            title: "Studio note",
            body: "Reminder posted.",
            createdAt: { toDate: () => new Date("2026-02-26T00:00:00.000Z") },
            readAt: null,
          },
        ]}
        loading={false}
        error=""
        onOpenFirings={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /mark read/i }));

    await waitFor(() => {
      expect(screen.queryByText("Mark read failed: fallback failed")).not.toBeNull();
    });

    expect(screen.queryByRole("button", { name: /mark read/i })).not.toBeNull();
    expect(screen.queryByText("1 unread")).not.toBeNull();
  });
});
