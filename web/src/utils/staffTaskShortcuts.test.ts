import { describe, expect, it } from "vitest";

import { resolveStaffTaskShortcut } from "./staffTaskShortcuts";

describe("resolveStaffTaskShortcut", () => {
  it("maps message-oriented staff aliases to the messages nav target", () => {
    expect(resolveStaffTaskShortcut("/staff/messages", "")).toEqual({
      targetNav: "messages",
      canonicalPath: "/staff/messages",
    });
    expect(resolveStaffTaskShortcut("/staff/communication", "")).toEqual({
      targetNav: "messages",
      canonicalPath: "/staff/messages",
    });
  });

  it("maps announcement aliases to the cockpit composer workflow", () => {
    expect(resolveStaffTaskShortcut("/staff/announcement", "")).toEqual({
      targetNav: "staff",
      canonicalPath: "/staff/announcements",
      workspaceMode: "cockpit",
      initialTaskAction: "announcementComposer",
    });
  });

  it("supports hash-based staff task aliases", () => {
    expect(resolveStaffTaskShortcut("/dashboard", "#/staff/messages")).toEqual({
      targetNav: "messages",
      canonicalPath: "/staff/messages",
    });
    expect(resolveStaffTaskShortcut("/dashboard", "#/staff/announcements")).toEqual({
      targetNav: "staff",
      canonicalPath: "/staff/announcements",
      workspaceMode: "cockpit",
      initialTaskAction: "announcementComposer",
    });
  });

  it("returns null for unrelated routes", () => {
    expect(resolveStaffTaskShortcut("/staff/system", "")).toBeNull();
    expect(resolveStaffTaskShortcut("/messages", "")).toBeNull();
  });
});
