import { describe, expect, it } from "vitest";
import type { IndustryEventSummary } from "../api/portalContracts";
import { filterIndustryEvents, industryEventLocationLabel, sortIndustryEvents } from "./industryEvents";

function makeEvent(overrides: Partial<IndustryEventSummary>): IndustryEventSummary {
  return {
    id: overrides.id ?? "evt",
    title: overrides.title ?? "Event",
    summary: overrides.summary ?? "Summary",
    mode: overrides.mode ?? "local",
    status: overrides.status ?? "published",
    featured: overrides.featured ?? false,
    startAt: overrides.startAt ?? null,
    endAt: overrides.endAt ?? null,
    ...overrides,
  };
}

describe("industryEvents helpers", () => {
  it("filters by mode and search term while hiding past events by default", () => {
    const nowMs = Date.parse("2026-03-01T12:00:00.000Z");
    const events: IndustryEventSummary[] = [
      makeEvent({
        id: "remote-nceca",
        title: "NCECA Virtual Talks",
        mode: "remote",
        startAt: "2026-03-20T10:00:00.000Z",
      }),
      makeEvent({
        id: "local-phx",
        title: "Phoenix Clay Convention",
        mode: "local",
        city: "Phoenix",
        region: "AZ",
        startAt: "2026-03-18T10:00:00.000Z",
      }),
      makeEvent({
        id: "past-remote",
        title: "Past Remote Summit",
        mode: "remote",
        endAt: "2026-01-10T10:00:00.000Z",
      }),
    ];

    const filtered = filterIndustryEvents(events, {
      mode: "remote",
      search: "nceca",
      nowMs,
    });

    expect(filtered.map((event) => event.id)).toEqual(["remote-nceca"]);
  });

  it("sorts featured upcoming events first and pushes past events to the bottom", () => {
    const nowMs = Date.parse("2026-03-01T12:00:00.000Z");
    const events: IndustryEventSummary[] = [
      makeEvent({
        id: "future-b",
        title: "Future B",
        startAt: "2026-03-12T10:00:00.000Z",
      }),
      makeEvent({
        id: "future-featured",
        title: "Future Featured",
        featured: true,
        startAt: "2026-03-09T10:00:00.000Z",
      }),
      makeEvent({
        id: "past-a",
        title: "Past A",
        endAt: "2026-01-09T10:00:00.000Z",
      }),
    ];

    const sorted = sortIndustryEvents(events, nowMs);
    expect(sorted.map((event) => event.id)).toEqual(["future-featured", "future-b", "past-a"]);
  });

  it("builds a readable location label for remote and local events", () => {
    expect(industryEventLocationLabel(makeEvent({ mode: "remote" }))).toBe("Remote");
    expect(
      industryEventLocationLabel(makeEvent({ mode: "local", location: "", city: "Phoenix", region: "AZ" }))
    ).toBe("Phoenix, AZ");
  });
});

