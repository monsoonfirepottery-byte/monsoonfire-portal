import type { Announcement } from "../types/messaging";

export const QA_ANNOUNCEMENT_ID_PREFIX = "qa-fixture-studio-update-";
export const LEGACY_QA_ANNOUNCEMENT_ID_PREFIX = "qa-studio-update-";

function normalizeAnnouncementFlag(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

export function isQaAnnouncement(announcement: Pick<Announcement, "id" | "source" | "audience">) {
  const source = normalizeAnnouncementFlag(announcement.source);
  const audience = normalizeAnnouncementFlag(announcement.audience);
  return (
    String(announcement.id || "").startsWith(QA_ANNOUNCEMENT_ID_PREFIX) ||
    String(announcement.id || "").startsWith(LEGACY_QA_ANNOUNCEMENT_ID_PREFIX) ||
    source === "qa_fixture" ||
    audience === "qa"
  );
}

export function filterVisibleAnnouncements<T extends Announcement>(announcements: readonly T[]) {
  return announcements.filter((announcement) => !isQaAnnouncement(announcement));
}
