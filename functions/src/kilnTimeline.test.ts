import test from "node:test";
import assert from "node:assert/strict";

import { buildKilnTimeline } from "./kilnTimeline";

test("buildKilnTimeline returns explicit firing segments and mirrors current live kiln state", () => {
  const now = new Date("2026-03-13T10:30:00.000Z");
  const result = buildKilnTimeline({
    now,
    kilns: [
      {
        id: "studio-electric",
        name: "L&L eQ2827-3",
        status: "cooling",
        typicalCycles: [{ id: "bisque", name: "Bisque", typicalDurationHours: 9 }],
      },
    ],
    firings: [
      {
        id: "firing-1",
        kilnId: "studio-electric",
        title: "Stoneware bisque",
        cycleType: "bisque",
        startAt: "2026-03-13T08:00:00.000Z",
        endAt: "2026-03-13T16:00:00.000Z",
        status: "in-progress",
        confidence: "scheduled",
        notes: "Cooling down now.",
      },
    ],
    reservations: [],
  });

  assert.equal(result.kilns.length, 1);
  assert.equal(result.kilns[0]?.currentState, "cooling");
  assert.equal(result.kilns[0]?.segments.length, 1);
  assert.equal(result.kilns[0]?.segments[0]?.state, "cooling");
  assert.equal(result.kilns[0]?.segments[0]?.source, "firing");
});

test("buildKilnTimeline reschedules queued load forecasts after a conflicting confirmed firing", () => {
  const now = new Date("2026-03-13T08:15:00.000Z");
  const result = buildKilnTimeline({
    now,
    kilns: [
      {
        id: "studio-electric",
        name: "L&L eQ2827-3",
        status: "idle",
        typicalCycles: [{ id: "glaze", name: "Mid-fire glaze", typicalDurationHours: 8 }],
      },
    ],
    firings: [
      {
        id: "whole-kiln",
        kilnId: "studio-electric",
        title: "Whole kiln glaze firing",
        cycleType: "glaze",
        startAt: "2026-03-13T09:00:00.000Z",
        endAt: "2026-03-13T17:00:00.000Z",
        status: "scheduled",
        confidence: "scheduled",
      },
    ],
    reservations: [
      {
        id: "reservation-1",
        status: "REQUESTED",
        loadStatus: "queued",
        intakeMode: "SHELF_PURCHASE",
        firingType: "glaze",
        assignedStationId: "studio-electric",
        estimatedHalfShelves: 4,
      },
      {
        id: "reservation-2",
        status: "CONFIRMED",
        loadStatus: "queued",
        intakeMode: "SHELF_PURCHASE",
        firingType: "glaze",
        assignedStationId: "studio-electric",
        estimatedHalfShelves: 2,
      },
    ],
  });

  const kiln = result.kilns[0];
  assert.ok(kiln);
  assert.equal(kiln.segments.length, 2);
  const forecast = kiln.segments.find((segment) => segment.source === "queue-forecast");
  assert.ok(forecast);
  assert.equal(forecast.label, "Queued glaze load");
  assert.equal(forecast.startAt, "2026-03-13T17:00:00.000Z");
  assert.match(forecast.notes ?? "", /next open slot/i);
});

test("buildKilnTimeline suppresses queue forecast when the next open slot lands outside the 7 day view", () => {
  const now = new Date("2026-03-13T08:00:00.000Z");
  const result = buildKilnTimeline({
    now,
    kilns: [
      {
        id: "studio-electric",
        name: "L&L eQ2827-3",
        status: "idle",
        typicalCycles: [{ id: "bisque", name: "Bisque", typicalDurationHours: 8 }],
      },
    ],
    firings: [
      {
        id: "firing-blocker",
        kilnId: "studio-electric",
        title: "All week firing",
        cycleType: "bisque",
        startAt: "2026-03-13T08:00:00.000Z",
        endAt: "2026-03-20T07:30:00.000Z",
        status: "scheduled",
        confidence: "scheduled",
      },
    ],
    reservations: [
      {
        id: "reservation-1",
        status: "CONFIRMED",
        loadStatus: "queued",
        intakeMode: "SHELF_PURCHASE",
        firingType: "bisque",
        assignedStationId: "studio-electric",
        estimatedHalfShelves: 5,
      },
    ],
  });

  const kiln = result.kilns[0];
  assert.ok(kiln);
  assert.equal(kiln.segments.filter((segment) => segment.source === "queue-forecast").length, 0);
  assert.equal(kiln.overflowNote, "Next queued load lands after this view.");
});

test("buildKilnTimeline ignores community shelf, whole kiln, and loaded reservations in the forecast", () => {
  const now = new Date("2026-03-13T08:00:00.000Z");
  const result = buildKilnTimeline({
    now,
    kilns: [
      {
        id: "reduction-raku",
        name: "Reduction Raku",
        status: "idle",
        typicalCycles: [{ id: "raku", name: "Reduction firing", typicalDurationHours: 6 }],
      },
    ],
    firings: [],
    reservations: [
      {
        id: "community",
        status: "REQUESTED",
        loadStatus: "queued",
        intakeMode: "COMMUNITY_SHELF",
        firingType: "glaze",
        assignedStationId: "reduction-raku",
        estimatedHalfShelves: 5,
      },
      {
        id: "whole-kiln",
        status: "REQUESTED",
        loadStatus: "queued",
        intakeMode: "WHOLE_KILN",
        firingType: "glaze",
        assignedStationId: "reduction-raku",
        estimatedHalfShelves: 8,
      },
      {
        id: "loaded",
        status: "CONFIRMED",
        loadStatus: "loaded",
        intakeMode: "SHELF_PURCHASE",
        firingType: "glaze",
        assignedStationId: "reduction-raku",
        estimatedHalfShelves: 3,
      },
    ],
  });

  const kiln = result.kilns[0];
  assert.ok(kiln);
  assert.equal(kiln.segments.length, 0);
  assert.equal(kiln.overflowNote, null);
});
