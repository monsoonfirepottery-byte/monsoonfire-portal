import { describe, expect, it } from "vitest";
import type { IndustryEventSummary } from "../api/portalContracts";
import {
  buildIndustryEventGoogleCalendarUrl,
  buildIndustryEventIcsContent,
  industryEventReminderCopy,
} from "./industryEventCalendar";

function makeEvent(overrides: Partial<IndustryEventSummary>): IndustryEventSummary {
  return {
    id: overrides.id ?? "evt-calendar",
    title: overrides.title ?? "NCECA Live Session",
    summary: overrides.summary ?? "Curated talk and panel",
    mode: overrides.mode ?? "remote",
    status: overrides.status ?? "published",
    featured: overrides.featured ?? false,
    startAt: overrides.startAt ?? "2026-03-20T17:00:00.000Z",
    endAt: overrides.endAt ?? "2026-03-20T19:00:00.000Z",
    timezone: overrides.timezone ?? "America/Phoenix",
    location: overrides.location ?? "Online",
    sourceUrl: overrides.sourceUrl ?? "https://example.com/event",
    ...overrides,
  };
}

describe("industryEventCalendar", () => {
  it("builds Google Calendar URLs with timezone and dates", () => {
    const url = buildIndustryEventGoogleCalendarUrl(makeEvent({}));
    expect(url).toBeTruthy();
    expect(url).toContain("calendar.google.com");
    expect(url).toContain("ctz=America%2FPhoenix");
    expect(url).toContain("dates=20260320T170000Z%2F20260320T190000Z");
  });

  it("builds ICS payload with required VEVENT fields", () => {
    const ics = buildIndustryEventIcsContent(makeEvent({ id: "evt-ics" }));
    expect(ics).toBeTruthy();
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("UID:evt-ics@monsoonfire.com");
    expect(ics).toContain("DTSTART:20260320T170000Z");
    expect(ics).toContain("DTEND:20260320T190000Z");
    expect(ics).toContain("END:VEVENT");
  });

  it("returns reminder copy that reflects schedule proximity", () => {
    const now = Date.parse("2026-03-19T17:00:00.000Z");
    expect(industryEventReminderCopy(makeEvent({}), now)).toBe("Starts tomorrow.");
    expect(
      industryEventReminderCopy(
        makeEvent({
          startAt: "2026-03-19T18:00:00.000Z",
        }),
        now
      )
    ).toBe("Happening today.");
    expect(
      industryEventReminderCopy(
        makeEvent({
          startAt: null,
        }),
        now
      )
    ).toBe("Schedule details pending verification.");
  });
});
