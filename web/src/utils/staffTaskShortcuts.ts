import { normalizeStaffPath } from "./staffWorkspacePaths";

export type StaffTaskShortcut = {
  targetNav: "messages" | "staff";
  canonicalPath: "/staff/messages" | "/staff/announcements";
  workspaceMode?: "default" | "cockpit";
  initialTaskAction?: "announcementComposer";
};

const STAFF_TASK_SHORTCUTS: Readonly<Record<string, StaffTaskShortcut>> = {
  message: {
    targetNav: "messages",
    canonicalPath: "/staff/messages",
  },
  messages: {
    targetNav: "messages",
    canonicalPath: "/staff/messages",
  },
  communication: {
    targetNav: "messages",
    canonicalPath: "/staff/messages",
  },
  communications: {
    targetNav: "messages",
    canonicalPath: "/staff/messages",
  },
  announcement: {
    targetNav: "staff",
    canonicalPath: "/staff/announcements",
    workspaceMode: "cockpit",
    initialTaskAction: "announcementComposer",
  },
  announcements: {
    targetNav: "staff",
    canonicalPath: "/staff/announcements",
    workspaceMode: "cockpit",
    initialTaskAction: "announcementComposer",
  },
};

function resolveShortcutFromCandidate(candidate: string): StaffTaskShortcut | null {
  const normalizedCandidate = normalizeStaffPath(candidate);
  if (!normalizedCandidate.startsWith("/staff/")) return null;

  const segments = normalizedCandidate.split("/").filter(Boolean);
  if (segments[0] !== "staff") return null;

  const shortcutKey = segments[1] ?? "";
  return STAFF_TASK_SHORTCUTS[shortcutKey] ?? null;
}

export function resolveStaffTaskShortcut(
  pathname: string | null | undefined,
  hash: string | null | undefined,
): StaffTaskShortcut | null {
  return resolveShortcutFromCandidate(pathname ?? "") ?? resolveShortcutFromCandidate(hash ?? "");
}
