import test from "node:test";
import assert from "node:assert/strict";
import { __testExports } from "./roborockTransport";

test("maps Home Assistant vacuum states to normalized Roborock device payload", () => {
  const rows = __testExports.mapHomeAssistantStatesToRoborockDevices(
    [
      {
        entity_id: "vacuum.studio_s7",
        state: "docked",
        last_changed: "2026-04-10T01:02:03.000Z",
        attributes: {
          friendly_name: "Studio S7",
          battery_level: 87,
        },
      },
      {
        entity_id: "light.kiln_room",
        state: "on",
      },
    ],
    []
  );

  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    id: "vacuum.studio_s7",
    name: "Studio S7",
    online: true,
    battery: 87,
    lastSeenAt: "2026-04-10T01:02:03.000Z",
    state: "docked",
    entityId: "vacuum.studio_s7",
  });
});

test("treats unknown/unavailable devices as offline and applies allowlist", () => {
  const rows = __testExports.mapHomeAssistantStatesToRoborockDevices(
    [
      {
        entity_id: "vacuum.studio_s8",
        state: "unavailable",
        attributes: {
          battery_level: "42",
        },
      },
    ],
    ["vacuum.studio_s8"]
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].online, false);
  assert.equal(rows[0].battery, 42);

  const filteredOut = __testExports.mapHomeAssistantStatesToRoborockDevices(
    [
      {
        entity_id: "vacuum.studio_s8",
        state: "cleaning",
      },
    ],
    ["vacuum.other"]
  );

  assert.equal(filteredOut.length, 0);
});
