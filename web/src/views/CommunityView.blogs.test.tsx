/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "firebase/auth";

import CommunityView from "./CommunityView";

const { postJsonMock, createFunctionsClient } = vi.hoisted(() => ({
  postJsonMock: vi.fn(),
  createFunctionsClient: vi.fn(() => ({
    postJson: postJsonMock,
  })),
}));

vi.mock("../api/functionsClient", () => ({
  createFunctionsClient,
}));

vi.mock("./community/CommunityBlogStudio", () => ({
  default: ({ onRequestClose }: { onRequestClose?: () => void }) => (
    <div>
      <div>Mock blog studio</div>
      <button type="button" onClick={onRequestClose}>
        Close studio
      </button>
    </div>
  ),
}));

function createUser(): User {
  return {
    uid: "staff-1",
    email: "staff@monsoonfire.com",
    displayName: "Staff",
    getIdToken: vi.fn(async () => "test-id-token"),
  } as unknown as User;
}

beforeEach(() => {
  postJsonMock.mockReset();
  postJsonMock.mockImplementation(async (fn: string) => {
    if (fn === "listMyReports") return { ok: true, reports: [] };
    if (fn === "listMyReportAppeals") return { ok: true, appeals: [] };
    if (fn === "getModerationPolicyCurrent") return { ok: true, policy: null };
    if (fn === "listPublishedCommunityBlogExperience") {
      return {
        ok: true,
        posts: [
          {
            id: "blog-1",
            slug: "kiln-queue-update",
            title: "Kiln queue update",
            excerpt: "The next glaze cycle is loading tonight.",
            bodyHtml: "<p>The next glaze cycle is loading tonight.</p>",
            tags: ["kiln", "glaze"],
            publishedAtMs: Date.parse("2026-03-13T08:00:00.000Z"),
            updatedAtMs: Date.parse("2026-03-13T09:00:00.000Z"),
            readingMinutes: 2,
            authorName: "Studio staff",
            canonicalUrl: "https://monsoonfire.com/blog/kiln-queue-update/",
            marketingFocus: "kiln-firing",
          },
          {
            id: "blog-2",
            slug: "member-rhythm-note",
            title: "Member rhythm note",
            excerpt: "A quick note about building a steadier studio cadence.",
            bodyHtml: "<p>A quick note about building a steadier studio cadence.</p>",
            tags: ["membership"],
            publishedAtMs: Date.parse("2026-03-12T08:00:00.000Z"),
            updatedAtMs: Date.parse("2026-03-12T09:00:00.000Z"),
            readingMinutes: 3,
            authorName: "Studio staff",
            canonicalUrl: "https://monsoonfire.com/blog/member-rhythm-note/",
            marketingFocus: "memberships",
          },
        ],
        externalHighlights: [
          {
            id: "ext-1",
            sourceId: "source-1",
            sourceTitle: "Ceramic Arts Daily",
            title: "Glaze timing notes",
            excerpt: "An outside read on firing rhythm and glaze timing.",
            canonicalUrl: "https://example.com/glaze-timing",
            publishedAtMs: Date.parse("2026-03-11T08:00:00.000Z"),
            updatedAtMs: Date.parse("2026-03-11T08:00:00.000Z"),
            importedAtMs: Date.parse("2026-03-11T08:00:00.000Z"),
            status: "featured",
            tags: ["glaze"],
            studioNote: "Worth reading alongside our own queue updates.",
          },
        ],
      };
    }
    return { ok: true };
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CommunityView studio notes", () => {
  it("renders published studio notes and toggles the staff blog studio", async () => {
    render(
      <CommunityView
        user={createUser()}
        isStaff={true}
        onOpenLendingLibrary={() => undefined}
        onOpenWorkshops={() => undefined}
      />
    );

    expect(await screen.findByText("Latest studio note")).toBeDefined();
    expect(screen.getByText("Kiln queue update")).toBeDefined();
    expect(screen.getByText("Member rhythm note")).toBeDefined();
    expect(screen.getByText("Glaze timing notes")).toBeDefined();

    fireEvent.click(screen.getAllByRole("button", { name: /Quick look/i })[0]);
    const expandedMatches = await screen.findAllByText(/loading tonight/i);
    expect(expandedMatches.length).toBeGreaterThan(1);

    fireEvent.click(screen.getByRole("button", { name: /Write blog/i }));
    expect(await screen.findByRole("dialog", { name: /Blog studio/i })).toBeDefined();
    expect(screen.getByText("Mock blog studio")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /Close studio/i }));
    await waitFor(() => {
      expect(screen.queryByText("Mock blog studio")).toBeNull();
    });
  });
});
