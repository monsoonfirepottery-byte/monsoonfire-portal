/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { User } from "firebase/auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/analytics", () => ({
  track: vi.fn(),
}));

vi.mock("../firebase", () => ({
  db: {},
}));

vi.mock("firebase/firestore", () => ({
  addDoc: vi.fn(async () => ({ id: "mock-doc" })),
  collection: vi.fn((...segments: unknown[]) => ({ kind: "collection", segments })),
  deleteDoc: vi.fn(async () => undefined),
  doc: vi.fn((...segments: unknown[]) => ({ kind: "doc", segments })),
  getDocs: vi.fn(async () => ({ docs: [], empty: true, forEach: () => undefined })),
  limit: vi.fn((value: number) => ({ kind: "limit", value })),
  orderBy: vi.fn((field: string, direction?: string) => ({ kind: "orderBy", field, direction })),
  query: vi.fn((...parts: unknown[]) => ({ kind: "query", parts })),
  serverTimestamp: vi.fn(() => ({ ".sv": "timestamp" })),
  setDoc: vi.fn(async () => undefined),
  where: vi.fn((field: string, op: string, value: unknown) => ({ kind: "where", field, op, value })),
}));

const postJsonMock = vi.fn(async () => ({ data: {} }));

vi.mock("../api/functionsClient", () => ({
  createFunctionsClient: vi.fn(() => ({
    postJson: postJsonMock,
    getLastRequest: () => null,
    getLastCurl: () => "",
  })),
}));

let mockListItems: Array<Record<string, unknown>> = [];
let mockDetailItem: Record<string, unknown> | null = null;

vi.mock("../api/portalApi", () => ({
  createPortalApi: vi.fn(() => ({
    getLibraryRolloutConfig: vi.fn(async () => ({
      data: {
        data: {
          phase: "phase_3_admin_full",
          memberWritesEnabled: true,
        },
      },
    })),
    listLibraryItems: vi.fn(async () => ({
      data: {
        data: {
          items: mockListItems,
          total: mockListItems.length,
          page: 1,
          pageSize: 100,
          source: "api_v1",
        },
      },
    })),
    getLibraryDiscovery: vi.fn(async () => ({
      data: {
        data: {
          staffPicks: [],
          mostBorrowed: [],
          recentlyAdded: [],
          recentlyReviewed: [],
          workshopDiscovery: { items: [], summary: { totalSignals: 0, workshopCount: 0, source: "fallback" } },
        },
      },
    })),
    getLibraryItem: vi.fn(async () => ({
      data: {
        data: {
          item: mockDetailItem,
        },
      },
    })),
    externalLookupLibrary: vi.fn(async () => ({
      data: {
        data: {
          items: [],
          sources: [],
        },
      },
    })),
  })),
}));

import LendingLibraryView from "./LendingLibraryView";

function buildUser(): User {
  return {
    uid: "member-1",
    email: "member@example.com",
    displayName: "Member",
    getIdToken: vi.fn(async () => "token"),
  } as unknown as User;
}

describe("LendingLibraryView member detail value cues", () => {
  beforeEach(() => {
    postJsonMock.mockImplementation(async (fn: string) => {
      if (fn === "apiV1/v1/library.loans.listMine") {
        return { data: { loans: [] } };
      }
      if (fn === "apiV1/v1/library.recommendations.list") {
        return { data: { recommendations: [] } };
      }
      return { data: {} };
    });
    mockListItems = [
      {
        id: "item-1",
        title: "Glaze Lab Notebook",
        authors: ["Studio Staff"],
        summary: "Short member-facing synopsis for quick borrow decisions.",
        detailStatus: "ready",
        totalCopies: 3,
        availableCopies: 1,
        status: "available",
        source: "manual",
        curation: {
          staffPick: true,
          staffRationale: "Best first for members who want glaze test discipline before a production push.",
        },
        reviewSummary: {
          reviewCount: 4,
          averagePracticality: 4.6,
          topDifficulty: "intermediate",
          topBestFor: "Line blends and glaze testing",
          latestReflection: "Helped me tighten my glaze notebook and test cadence.",
        },
      },
    ];
    mockDetailItem = {
      ...mockListItems[0],
      description:
        "Short member-facing synopsis for quick borrow decisions. This longer description explains how members use the notebook for line blends, firing logs, shelf tests, and production handoff notes across the studio.",
      lifecycle: {
        queueMessage: "One copy is on the shelf now and one member is due back soon.",
        waitlistCount: 2,
        nextAvailableIso: "2026-03-15T18:00:00.000Z",
        renewable: true,
      },
      relatedWorkshops: [],
    };
    window.history.replaceState({}, "", "/requests?intent=lending");
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows a reason-to-open shelf cue and a richer decision-support detail card", async () => {
    render(<LendingLibraryView user={buildUser()} adminToken="" isStaff={false} />);

    expect(await screen.findByText("Glaze Lab Notebook")).toBeTruthy();
    expect(screen.getAllByText("Staff pick").length).toBeGreaterThan(0);
    expect(
      screen.getByText("Best first for members who want glaze test discipline before a production push.")
    ).toBeTruthy();

    fireEvent.click(screen.getByText("Glaze Lab Notebook").closest("button") as HTMLButtonElement);

    expect(await screen.findByText("Why this title matters")).toBeTruthy();
    expect(screen.getByText("Short member-facing synopsis for quick borrow decisions.")).toBeTruthy();
    expect(screen.getByText("Is this for me?")).toBeTruthy();
    expect(screen.getByText("4.6 / 5")).toBeTruthy();
    expect(screen.getAllByText("Intermediate").length).toBeGreaterThan(0);
    expect(screen.getByText("Line blends and glaze testing")).toBeTruthy();
    expect(screen.getByText("Can I get it now?")).toBeTruthy();
    expect(screen.getByText("Waitlist: 2 members")).toBeTruthy();
    expect(screen.getByText("Full description")).toBeTruthy();
  });

  it("shows the neutral enriching note when synopsis content is still sparse", async () => {
    mockListItems = [
      {
        id: "item-2",
        title: "Ash Glaze Starter",
        authors: ["Monsoon Fire"],
        detailStatus: "enriching",
        totalCopies: 1,
        availableCopies: 0,
        status: "checked_out",
        source: "manual",
      },
    ];
    mockDetailItem = {
      ...mockListItems[0],
      relatedWorkshops: [],
    };

    render(<LendingLibraryView user={buildUser()} adminToken="" isStaff={false} />);

    expect(await screen.findByText("Ash Glaze Starter")).toBeTruthy();
    fireEvent.click(screen.getByText("Ash Glaze Starter").closest("button") as HTMLButtonElement);

    expect(await screen.findByText("Why this title matters")).toBeTruthy();
    expect(screen.getByText("More details are still being added for this title.")).toBeTruthy();
  });
});
