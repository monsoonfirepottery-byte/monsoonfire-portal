/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "firebase/auth";

import CommunityBlogStudio from "./CommunityBlogStudio";

const storageFns = vi.hoisted(() => ({
  connectStorageEmulator: vi.fn(),
  getStorage: vi.fn(() => ({ name: "mock-storage" })),
  getDownloadURL: vi.fn(),
  ref: vi.fn(),
  uploadBytes: vi.fn(),
}));

vi.mock("firebase/storage", () => storageFns);

function createUser(): User {
  return {
    uid: "staff-1",
    email: "staff@monsoonfire.com",
    displayName: "Studio Staff",
    getIdToken: vi.fn(async () => "id-token"),
  } as unknown as User;
}

function makeClient() {
  return {
    postJson: vi.fn(async (fn: string, payload: Record<string, unknown>) => {
      if (fn === "staffListCommunityBlogs") {
        return {
          ok: true,
          distributionAvailability: [
            { channel: "facebook_page", available: true, reason: null },
            { channel: "instagram_business", available: false, reason: "Needs image." },
          ],
          posts: [
            {
              id: "draft-1",
              slug: "queue-update",
              title: "Queue update",
              excerpt: "Initial excerpt",
              bodyHtml: "<p>Initial body</p>",
              bodyMarkdown: "Initial body",
              tags: ["kiln"],
              tonePreset: "studio_notes",
              marketingFocus: "studio-services",
              status: "draft",
              createdAtMs: Date.parse("2026-03-12T09:00:00.000Z"),
              updatedAtMs: Date.parse("2026-03-12T10:00:00.000Z"),
              publishedAtMs: 0,
              readingMinutes: 1,
              authorName: "Studio staff",
              canonicalUrl: "https://monsoonfire.com/blog/queue-update/",
              createdByUid: "staff-1",
              updatedByUid: "staff-1",
              authorUid: "staff-1",
              distributions: {},
            },
          ],
        };
      }
      if (fn === "staffListCommunityBlogSources") {
        return { ok: true, sources: [], items: [] };
      }
      if (fn === "staffUpsertCommunityBlog") {
        return {
          ok: true,
          message: "Draft saved.",
          post: {
            id: "draft-1",
            slug: String(payload.slug || "queue-update"),
            title: String(payload.title || "Queue update"),
            excerpt: String(payload.excerpt || ""),
            bodyHtml: "<p>Fresh body copy</p>",
            bodyMarkdown: String(payload.bodyMarkdown || ""),
            tags: payload.tags || [],
            tonePreset: payload.tonePreset || "studio_notes",
            marketingFocus: payload.marketingFocus || "studio-services",
            status: "draft",
            createdAtMs: Date.parse("2026-03-12T09:00:00.000Z"),
            updatedAtMs: Date.parse("2026-03-13T10:00:00.000Z"),
            publishedAtMs: 0,
            readingMinutes: 1,
            authorName: "Studio staff",
            canonicalUrl: "https://monsoonfire.com/blog/queue-update/",
            createdByUid: "staff-1",
            updatedByUid: "staff-1",
            authorUid: "staff-1",
            distributions: {},
          },
        };
      }
      if (fn === "staffAssistCommunityBlog") {
        return {
          ok: true,
          available: true,
          message: "Suggestions ready.",
          model: { provider: "openai", version: "gpt-test" },
          suggestions: [
            {
              id: "suggestion-1",
              title: "Sharper queue note",
              excerpt: "A clearer packaging option for the same update.",
              bodyMarkdown: "Rewritten body from AI.",
              note: "Tighter tone for quick reading.",
            },
          ],
        };
      }
      return { ok: true };
    }),
  };
}

beforeEach(() => {
  storageFns.connectStorageEmulator.mockReset();
  storageFns.getStorage.mockClear();
  storageFns.getDownloadURL.mockReset();
  storageFns.ref.mockReset();
  storageFns.uploadBytes.mockReset();
  vi.spyOn(window, "confirm").mockImplementation(() => true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CommunityBlogStudio", () => {
  it("saves a draft and applies an AI suggestion only when requested", async () => {
    const client = makeClient();

    render(<CommunityBlogStudio client={client} user={createUser()} active={true} variant="staff" />);

    expect(await screen.findByDisplayValue("Queue update")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /Write blog/i }));
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Fresh queue note" },
    });
    fireEvent.change(screen.getByLabelText("Excerpt"), {
      target: { value: "A quick queue summary." },
    });
    fireEvent.change(
      screen.getByPlaceholderText("Write in a lightweight markdown style. Use the toolbar above for quick formatting."),
      {
        target: { value: "Fresh body copy" },
      }
    );

    fireEvent.click(screen.getByRole("button", { name: /Save draft/i }));

    await waitFor(() => {
      expect(screen.getByText("Draft saved.")).toBeDefined();
    });
    expect(client.postJson).toHaveBeenCalledWith(
      "staffUpsertCommunityBlog",
      expect.objectContaining({
        title: "Fresh queue note",
        excerpt: "A quick queue summary.",
        bodyMarkdown: "Fresh body copy",
      })
    );

    fireEvent.click(screen.getByRole("button", { name: /Ask AI/i }));

    expect(await screen.findByText("Suggestions ready.")).toBeDefined();
    expect(screen.queryByDisplayValue("Sharper queue note")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Apply suggestion/i }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("Sharper queue note")).toBeDefined();
      expect(screen.getByDisplayValue("Rewritten body from AI.")).toBeDefined();
    });
  });

  it("keeps the community composer focused and confirms before closing dirty edits", async () => {
    const client = makeClient();
    const onRequestClose = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockImplementation(() => true);

    render(
      <CommunityBlogStudio
        client={client}
        user={createUser()}
        active={true}
        variant="community"
        onRequestClose={onRequestClose}
      />
    );

    expect(await screen.findByDisplayValue("Queue update")).toBeDefined();
    expect(screen.queryByLabelText("Slug")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(await screen.findByLabelText("Slug")).toBeDefined();

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Queue update revised" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Close editor/i }));

    expect(confirmSpy).toHaveBeenCalledWith("Discard unsaved blog edits?");
    expect(onRequestClose).toHaveBeenCalledTimes(1);
  });
});
