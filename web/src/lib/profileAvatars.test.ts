import { describe, expect, it } from "vitest";
import {
  hasValidAvatarSignature,
  parseProfileAvatarStoragePath,
  PROFILE_DEFAULT_AVATAR_URL,
  resolveAvatarFileExtension,
  sanitizeAvatarUid,
} from "./profileAvatars";

describe("profileAvatars", () => {
  it("keeps a stable default avatar data URL", () => {
    expect(PROFILE_DEFAULT_AVATAR_URL.startsWith("data:image/svg+xml")).toBe(true);
  });

  it("sanitizes uid for storage paths", () => {
    expect(sanitizeAvatarUid("abc:/123")).toBe("abc--123");
  });

  it("resolves extension from mime first", () => {
    expect(resolveAvatarFileExtension({ type: "image/webp", name: "photo.png" } as File)).toBe("webp");
    expect(resolveAvatarFileExtension({ type: "", name: "photo.jpeg" } as File)).toBe("jpg");
  });

  it("parses only owner-scoped profile avatar storage paths", () => {
    const url =
      "https://firebasestorage.googleapis.com/v0/b/test/o/profileAvatars%2Fuser-1%2Fprofile-1.jpg?alt=media";
    expect(parseProfileAvatarStoragePath(url, "user-1")).toBe("profileAvatars/user-1/profile-1.jpg");
    expect(parseProfileAvatarStoragePath(url, "user-2")).toBeNull();
  });

  it("validates supported image signatures", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);

    expect(hasValidAvatarSignature(png, "image/png")).toBe(true);
    expect(hasValidAvatarSignature(jpeg, "image/jpeg")).toBe(true);
    expect(hasValidAvatarSignature(gif, "image/gif")).toBe(true);
    expect(hasValidAvatarSignature(webp, "image/webp")).toBe(true);
    expect(hasValidAvatarSignature(new Uint8Array([0x00, 0x00, 0x00]), "image/png")).toBe(false);
  });
});
