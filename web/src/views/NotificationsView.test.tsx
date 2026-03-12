/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "firebase/auth";
import NotificationsView from "./NotificationsView";

const docMock = vi.fn((_: unknown, ...segments: string[]) => ({ path: segments.join("/") }));
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
  updateDoc: (...args: unknown[]) => updateDocMock(...args),
  Timestamp: {
    now: () => timestampNowMock(),
  },
}));

function createUser(uid = "user-1"): User {
  const getIdToken = vi.fn(async () => "id-token");
  return {
    uid,
    getIdToken,
  } as User;
}

beforeEach(() => {
  window.sessionStorage.clear();
  updateDocMock.mockReset();
  updateDocMock.mockResolvedValue(undefined);
  postJsonMock.mockReset();
  postJsonMock.mockResolvedValue({ ok: true, data: { notificationId: "notif-fallback" } });
  docMock.mockClear();
  timestampNowMock.mockClear();
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
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
    expect(screen.queryByTestId("notification-card-notif-1")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^All$/i }));

    expect(screen.queryByText("Marked just now")).not.toBeNull();
  });

  it("falls back to api mark-read when Firestore permission update is denied", async () => {
    updateDocMock.mockRejectedValue(new Error("Missing or insufficient permissions."));

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
    updateDocMock.mockRejectedValue(new Error("Missing or insufficient permissions."));
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

  it("retries Firestore mark-read after permission/auth errors before using api fallback", async () => {
    updateDocMock.mockRejectedValueOnce(new Error("Missing or insufficient permissions."));
    updateDocMock.mockResolvedValueOnce(undefined);
    const user = createUser();

    render(
      <NotificationsView
        user={user}
        notifications={[
          {
            id: "notif-4",
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
      expect(updateDocMock).toHaveBeenCalledTimes(2);
    });
    expect(user.getIdToken).toHaveBeenCalledWith(true);
    expect(postJsonMock).toHaveBeenCalledTimes(0);
    expect(screen.queryByText("Notification marked as read.")).not.toBeNull();
  });

  it("falls back to api when Firestore update fails for non-permission errors", async () => {
    updateDocMock.mockRejectedValueOnce(new Error("No document to update"));

    render(
      <NotificationsView
        user={createUser()}
        notifications={[
          {
            id: "notif-5",
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

  it("retries mark-read via alternate v1 route when apiV1 route returns not found", async () => {
    updateDocMock.mockRejectedValueOnce(new Error("No document to update"));
    postJsonMock.mockImplementation(async (route: unknown) => {
      if (route === "apiV1/v1/notifications.markRead") {
        const error = new Error("Unknown route");
        (error as Error & { statusCode?: number; code?: string }).statusCode = 404;
        (error as Error & { statusCode?: number; code?: string }).code = "NOT_FOUND";
        throw error;
      }
      return { ok: true, data: { notificationId: "notif-6" } };
    });

    render(
      <NotificationsView
        user={createUser()}
        notifications={[
          {
            id: "notif-6",
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
      expect(postJsonMock).toHaveBeenCalledTimes(2);
    });
    expect(postJsonMock.mock.calls[0]?.[0]).toBe("apiV1/v1/notifications.markRead");
    expect(postJsonMock.mock.calls[1]?.[0]).toBe("v1/notifications.markRead");
    expect(screen.queryByText("Notification marked as read.")).not.toBeNull();
  });

  it("defaults to inbox items and restores read notifications in all", async () => {
    render(
      <NotificationsView
        user={createUser()}
        notifications={[
          {
            id: "notif-unread",
            title: "Unread update",
            body: "Needs action.",
            createdAt: { toDate: () => new Date("2026-02-26T00:00:00.000Z") },
            readAt: null,
          },
          {
            id: "notif-read",
            title: "Read update",
            body: "Already handled.",
            createdAt: { toDate: () => new Date("2026-02-25T00:00:00.000Z") },
            readAt: { toDate: () => new Date("2026-02-26T01:00:00.000Z") },
          },
        ]}
        loading={false}
        error=""
        onOpenFirings={() => undefined}
      />
    );

    expect(screen.getByTestId("notification-card-notif-unread")).toBeTruthy();
    expect(screen.queryByTestId("notification-card-notif-read")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^All$/i }));

    expect(screen.getByTestId("notification-card-notif-unread")).toBeTruthy();
    expect(screen.getByTestId("notification-card-notif-read")).toBeTruthy();
  });

  it("removes a notification from inbox when viewing firings", async () => {
    const onOpenFirings = vi.fn();

    render(
      <NotificationsView
        user={createUser()}
        notifications={[
          {
            id: "notif-open",
            title: "Kiln update",
            body: "Your firing is ready.",
            createdAt: { toDate: () => new Date("2026-02-26T00:00:00.000Z") },
            readAt: null,
            data: {
              firingId: "firing-1",
              kilnName: "Electric kiln",
              firingType: "bisque",
            },
          },
        ]}
        loading={false}
        error=""
        onOpenFirings={onOpenFirings}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /^View firings$/i }));

    expect(onOpenFirings).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(updateDocMock).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByTestId("notification-card-notif-open")).toBeNull();
    expect(screen.queryByText("You're caught up. Switch to All to review earlier notifications.")).not.toBeNull();
  });

  it("keeps view-firings notifications out of inbox across a remount while read sync finishes", async () => {
    const notification = {
      id: "notif-remount",
      title: "Kiln update",
      body: "Your firing is ready.",
      createdAt: { toDate: () => new Date("2026-02-26T00:00:00.000Z") },
      readAt: null,
      data: {
        firingId: "firing-2",
        kilnName: "Gas kiln",
        firingType: "glaze",
      },
    };

    const firstRender = render(
      <NotificationsView
        user={createUser()}
        notifications={[notification]}
        loading={false}
        error=""
        onOpenFirings={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /^View firings$/i }));
    await waitFor(() => {
      expect(updateDocMock).toHaveBeenCalledTimes(1);
    });

    firstRender.unmount();

    render(
      <NotificationsView
        user={createUser()}
        notifications={[notification]}
        loading={false}
        error=""
        onOpenFirings={() => undefined}
      />
    );

    expect(screen.queryByTestId("notification-card-notif-remount")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^All$/i }));

    expect(screen.getByTestId("notification-card-notif-remount")).toBeTruthy();
  });
});
