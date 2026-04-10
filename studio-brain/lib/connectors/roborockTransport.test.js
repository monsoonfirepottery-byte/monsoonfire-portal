"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const roborockTransport_1 = require("./roborockTransport");
(0, node_test_1.default)("maps Home Assistant vacuum states to normalized Roborock device payload", () => {
    const rows = roborockTransport_1.__testExports.mapHomeAssistantStatesToRoborockDevices([
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
    ], []);
    strict_1.default.equal(rows.length, 1);
    strict_1.default.deepEqual(rows[0], {
        id: "vacuum.studio_s7",
        name: "Studio S7",
        online: true,
        battery: 87,
        lastSeenAt: "2026-04-10T01:02:03.000Z",
        state: "docked",
        entityId: "vacuum.studio_s7",
    });
});
(0, node_test_1.default)("treats unknown/unavailable devices as offline and applies allowlist", () => {
    const rows = roborockTransport_1.__testExports.mapHomeAssistantStatesToRoborockDevices([
        {
            entity_id: "vacuum.studio_s8",
            state: "unavailable",
            attributes: {
                battery_level: "42",
            },
        },
    ], ["vacuum.studio_s8"]);
    strict_1.default.equal(rows.length, 1);
    strict_1.default.equal(rows[0].online, false);
    strict_1.default.equal(rows[0].battery, 42);
    const filteredOut = roborockTransport_1.__testExports.mapHomeAssistantStatesToRoborockDevices([
        {
            entity_id: "vacuum.studio_s8",
            state: "cleaning",
        },
    ], ["vacuum.other"]);
    strict_1.default.equal(filteredOut.length, 0);
});
