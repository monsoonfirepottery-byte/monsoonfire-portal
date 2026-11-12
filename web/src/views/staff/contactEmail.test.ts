import { describe, expect, it } from "vitest";
import { contactEmailAddress } from "./contactEmail";

describe("contactEmailAddress", () => {
  it("accepts one normal mailbox and trims ordinary spaces", () => {
    expect(contactEmailAddress("  maker+studio@example.com  ")).toBe("maker+studio@example.com");
  });
  it.each([
    "maker@example.com,other@example.com",
    "maker@example.com?subject=hello",
    "maker@example.com%0Abcc=other@example.com",
    "maker@example.com\r\nbcc:other@example.com",
    ".maker@example.com",
    "maker..other@example.com",
    "maker@-example.com",
    "maker@example",
  ])("rejects unsafe or malformed address %s", (input) => {
    expect(contactEmailAddress(input)).toBeNull();
  });
});
