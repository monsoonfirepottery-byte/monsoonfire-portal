/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "firebase/auth";
import type { ReactNode } from "react";

import MessagesView from "./MessagesView";

type MockConstraint =
  | { type: "orderBy"; field: string; direction: "asc" | "desc" }
  | { type: "limit"; value: number };
type MockCollectionRef = { path: string };
type MockQuery = { path: string; constraints: MockConstraint[] };
type MockDoc = { id: string; data: Record<string, unknown> };
type Snapshot = { docs: { id: string; data: () => Record<string, unknown> }[] };

type TrackedGetDocsCall = {
  view: string;
  queryRef: MockQuery;
};
type TrackedUpdateDocFn = (
  view: string,
  docRef: unknown,
  data: Record<string, unknown>
) => Promise<void>;

let trackedGetDocsCalls: TrackedGetDocsCall[] = [];
let trackedUpdateDocMock: TrackedUpdateDocFn = vi.fn(async () => undefined);

function createSnapshot(rows: MockDoc[]): Snapshot {
  return {
    docs: rows.map((row) => ({
      id: row.id,
      data: () => row.data,
    })),
  };
}

function createTimestamp(ms: number) {
  return {
    toDate: () => new Date(ms),
    toMillis: () => ms,
  };
}

function createUser(): User {
  return {
    uid: "staff-user",
    email: "staff@monsoonfire.com",
    displayName: "Studio Staff",
  } as unknown as User;
}

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
  const orderBy = vi.fn((field: string, direction: "asc" | "desc" = "asc") => ({
    type: "orderBy" as const,
    field,
    direction,
  }));
  const limit = vi.fn((value: number) => ({ type: "limit" as const, value }));
  const doc = vi.fn((_: unknown, ...segments: string[]) => ({ path: segments.join("/") }));
  const serverTimestamp = vi.fn(() => "serverTimestamp");
  const arrayUnion = vi.fn((...values: unknown[]) => values);

  return {
    arrayUnion,
    collection,
    doc,
    limit,
    orderBy,
    query,
    serverTimestamp,
  };
});

vi.mock("../lib/firestoreTelemetry", () => ({
  trackedAddDoc: vi.fn(async () => ({ id: "new-message" })),
  trackedGetDocs: vi.fn(async (view: string, queryRef: MockQuery) => {
    trackedGetDocsCalls.push({ view, queryRef });
    if (queryRef.path === "directMessages/thread-a/messages") {
      return createSnapshot([
        {
          id: "message-a1",
          data: {
            subject: "Unread thread",
            body: "Unread body copy",
            fromUid: "client-user",
            fromName: "Client A",
            sentAt: createTimestamp(Date.UTC(2026, 1, 26, 17, 45, 0)),
          },
        },
      ]);
    }
    if (queryRef.path === "directMessages/thread-b/messages") {
      return createSnapshot([
        {
          id: "message-1",
          data: {
            subject: "Focused thread",
            body: "Focused body copy",
            fromUid: "client-user",
            fromName: "Client",
            sentAt: createTimestamp(Date.UTC(2026, 1, 26, 18, 30, 0)),
          },
        },
      ]);
    }
    return createSnapshot([]);
  }),
  trackedSetDoc: vi.fn(async () => undefined),
  trackedUpdateDoc: vi.fn(
    async (view: string, docRef: unknown, data: Record<string, unknown>) =>
      trackedUpdateDocMock(view, docRef, data)
  ),
}));

vi.mock("../context/UiSettingsContext", () => ({
  useUiSettings: () => ({
    themeName: "portal",
    portalMotion: "reduced",
  }),
}));

vi.mock("../components/RevealCard", () => ({
  default: ({
    children,
    className,
  }: {
    children: ReactNode;
    className?: string;
  }) => <div className={className}>{children}</div>,
}));

beforeEach(() => {
  trackedGetDocsCalls = [];
  trackedUpdateDocMock = vi.fn(async () => undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MessagesView initial thread focus", () => {
  it("selects and consumes a focused thread from staff navigation", async () => {
    const onInitialThreadIdConsumed = vi.fn();
    const now = Date.UTC(2026, 1, 26, 19, 0, 0);

    render(
      <MessagesView
        user={createUser()}
        supportEmail="support@monsoonfire.com"
        initialThreadId="thread-b"
        onInitialThreadIdConsumed={onInitialThreadIdConsumed}
        threads={[
          {
            id: "thread-a",
            subject: "Earlier thread",
            lastSenderName: "Maker A",
            lastMessagePreview: "Earlier preview",
            lastMessageAt: createTimestamp(now - 60_000),
            lastReadAtByUid: { "staff-user": createTimestamp(now - 30_000) },
          },
          {
            id: "thread-b",
            subject: "Focused thread",
            lastSenderName: "Maker B",
            lastMessagePreview: "Focus this thread",
            lastMessageAt: createTimestamp(now),
            lastReadAtByUid: { "staff-user": createTimestamp(now - 120_000) },
          },
        ]}
        threadsLoading={false}
        threadsError=""
        liveUsers={[]}
        liveUsersLoading={false}
        liveUsersError=""
        announcements={[]}
        announcementsLoading={false}
        announcementsError=""
        unreadAnnouncements={0}
      />
    );

    await screen.findByText("Focused body copy");
    await waitFor(() => {
      expect(screen.queryByTestId("thread-item-thread-b")).toBeNull();
    });
    await waitFor(() => {
      expect(onInitialThreadIdConsumed).toHaveBeenCalledTimes(1);
    });
    expect(
      screen.getByText("Inbox cleared. You're still viewing the last conversation you opened.")
    ).toBeTruthy();

    expect(trackedGetDocsCalls.map((entry) => entry.queryRef.path)).toEqual([
      "directMessages/thread-b/messages",
    ]);
    expect(trackedUpdateDocMock).toHaveBeenCalledWith(
      "messages:readState",
      { path: "directMessages/thread-b" },
      expect.objectContaining({
        "lastReadAtByUid.staff-user": "serverTimestamp",
      })
    );
  });

  it("removes read threads from inbox and restores them in all", async () => {
    const now = Date.UTC(2026, 1, 26, 19, 0, 0);

    render(
      <MessagesView
        user={createUser()}
        supportEmail="support@monsoonfire.com"
        initialThreadId="thread-b"
        threads={[
          {
            id: "thread-a",
            subject: "Unread thread",
            lastSenderName: "Maker A",
            lastMessagePreview: "Needs attention",
            lastMessageAt: createTimestamp(now),
            lastReadAtByUid: { "staff-user": createTimestamp(now - 120_000) },
          },
          {
            id: "thread-b",
            subject: "Earlier thread",
            lastSenderName: "Maker B",
            lastMessagePreview: "Already handled",
            lastMessageAt: createTimestamp(now - 60_000),
            lastReadAtByUid: { "staff-user": createTimestamp(now) },
          },
        ]}
        threadsLoading={false}
        threadsError=""
        liveUsers={[]}
        liveUsersLoading={false}
        liveUsersError=""
        announcements={[]}
        announcementsLoading={false}
        announcementsError=""
        unreadAnnouncements={0}
      />
    );

    expect(screen.getByTestId("thread-item-thread-a")).toBeTruthy();
    expect(screen.queryByTestId("thread-item-thread-b")).toBeNull();

    fireEvent.click(screen.getByTestId("thread-item-thread-a"));

    await screen.findByText("Unread body copy");
    await waitFor(() => {
      expect(screen.queryByTestId("thread-item-thread-a")).toBeNull();
    });
    expect(screen.getByText("Inbox cleared. You're still viewing the last conversation you opened.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^All$/i }));

    expect(screen.getByTestId("thread-item-thread-a")).toBeTruthy();
    expect(screen.getByTestId("thread-item-thread-b")).toBeTruthy();
  });

  it("removes read studio updates from inbox and restores them in all", async () => {
    render(
      <MessagesView
        user={createUser()}
        supportEmail="support@monsoonfire.com"
        threads={[]}
        threadsLoading={false}
        threadsError=""
        liveUsers={[]}
        liveUsersLoading={false}
        liveUsersError=""
        announcements={[
          {
            id: "ann-unread",
            title: "Unread update",
            body: "Fresh studio update",
            createdAt: createTimestamp(Date.UTC(2026, 1, 26, 16, 0, 0)),
            readBy: [],
          },
          {
            id: "ann-read",
            title: "Read update",
            body: "Past studio update",
            createdAt: createTimestamp(Date.UTC(2026, 1, 25, 16, 0, 0)),
            readBy: ["staff-user"],
          },
        ]}
        announcementsLoading={false}
        announcementsError=""
        unreadAnnouncements={1}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /^Studio updates/i }));

    expect(screen.getByTestId("announcement-card-ann-unread")).toBeTruthy();
    expect(screen.queryByTestId("announcement-card-ann-read")).toBeNull();

    fireEvent.click(screen.getByTestId("announcement-card-ann-unread"));

    await waitFor(() => {
      expect(screen.queryByTestId("announcement-card-ann-unread")).toBeNull();
    });
    expect(screen.getByTestId("selected-announcement-preview")).toBeTruthy();
    expect(screen.getByText("Inbox cleared")).toBeTruthy();
    expect(
      screen.getByText(
        "You are reviewing a previously read studio update. Switch to All when you want to revisit the full announcement history."
      )
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^All$/i }));

    expect(screen.getByTestId("announcement-card-ann-unread")).toBeTruthy();
    expect(screen.getByTestId("announcement-card-ann-read")).toBeTruthy();
  });

  it("preserves mirrored announcement CTA affordances and read tracking", async () => {
    render(
      <MessagesView
        user={createUser()}
        supportEmail="support@monsoonfire.com"
        threads={[]}
        threadsLoading={false}
        threadsError=""
        liveUsers={[]}
        liveUsersLoading={false}
        liveUsersError=""
        announcements={[
          {
            id: "marketing-public-updates-live",
            sourceId: "public-updates-live",
            sourceSystem: "marketing-feed-v1",
            category: "ops_update",
            title: "Public studio updates are now live",
            summary: "Broad studio notices now have a public home.",
            body: "Fresh studio update",
            ctaLabel: "View public updates",
            ctaUrl: "/updates/",
            publishAt: createTimestamp(Date.UTC(2026, 2, 14, 16, 0, 0)),
            expiresAt: null,
            createdAt: createTimestamp(Date.UTC(2026, 2, 14, 16, 0, 0)),
            readBy: [],
          },
        ]}
        announcementsLoading={false}
        announcementsError=""
        unreadAnnouncements={1}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /^Studio updates/i }));
    fireEvent.click(screen.getByTestId("announcement-card-marketing-public-updates-live"));

    expect(screen.getByText("View public updates")).toBeTruthy();
    await waitFor(() => {
      expect(trackedUpdateDocMock).toHaveBeenCalledWith(
        "messages:announcement",
        { path: "announcements/marketing-public-updates-live" },
        { readBy: ["staff-user"] }
      );
    });
  });
});
