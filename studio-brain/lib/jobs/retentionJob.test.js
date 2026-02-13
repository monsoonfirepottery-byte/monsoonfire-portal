"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const retentionJob_1 = require("./retentionJob");
(0, node_test_1.default)("computeRetentionCutoff applies retention window in days", () => {
    const now = new Date("2026-02-13T12:00:00.000Z");
    const cutoff = (0, retentionJob_1.computeRetentionCutoff)(now, 30);
    strict_1.default.equal(cutoff, "2026-01-14T12:00:00.000Z");
});
(0, node_test_1.default)("computeRetentionCutoff enforces minimum one-day window", () => {
    const now = new Date("2026-02-13T12:00:00.000Z");
    const cutoff = (0, retentionJob_1.computeRetentionCutoff)(now, 0);
    strict_1.default.equal(cutoff, "2026-02-12T12:00:00.000Z");
});
