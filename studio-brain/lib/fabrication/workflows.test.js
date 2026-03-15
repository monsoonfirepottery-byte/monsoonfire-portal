"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const defaults_1 = require("./defaults");
const workflows_1 = require("./workflows");
(0, node_test_1.default)("dry-run fixtures route through the expected planning outcomes", () => {
    for (const fixture of defaults_1.fabricationDryRunFixtures) {
        const result = (0, workflows_1.planFabricationJob)(fixture.request, defaults_1.bambuX1CPrinterAsset, defaults_1.fabricationSeedLibrary, defaults_1.fabricationConsumableStock, new Date("2026-03-14T12:00:00.000Z"));
        if (fixture.expectedOutcome === "planned") {
            strict_1.default.equal(result.outcome, "planned", fixture.label);
            strict_1.default.equal(result.route, fixture.expectedRoute, fixture.label);
            continue;
        }
        if (fixture.expectedOutcome === "stock_alert") {
            strict_1.default.equal(result.outcome, "stock_alert", fixture.label);
            strict_1.default.equal(result.route, fixture.expectedRoute, fixture.label);
            continue;
        }
        strict_1.default.equal(result.outcome, "escalated", fixture.label);
        strict_1.default.equal(result.route, fixture.expectedRoute, fixture.label);
    }
});
(0, node_test_1.default)("queue sorting keeps ops-critical work ahead of maintenance and experiments", () => {
    const jobs = [
        {
            id: "job.experiment",
            createdAt: "2026-03-14T12:10:00.000Z",
            title: "Experimental texture plate",
            category: "ceramics_tooling",
            urgency: "experiment",
            requester: "ops-primary",
            linkedSource: "cad://texture-v1",
            material: "PLA",
            estimatedGrams: 90,
            estimatedRuntimeMinutes: 180,
            status: "planned",
            disposition: "custom_build",
            reuseDecision: "promote_to_library",
            libraryItemId: null,
            notes: [],
        },
        {
            id: "job.ops_critical",
            createdAt: "2026-03-14T12:05:00.000Z",
            title: "Large mold registration key set",
            category: "ceramics_tooling",
            urgency: "ops_critical",
            requester: "ops-primary",
            linkedSource: "cad://mold-key-v3",
            material: "PETG",
            estimatedGrams: 160,
            estimatedRuntimeMinutes: 320,
            status: "planned",
            disposition: "custom_build",
            reuseDecision: "promote_to_library",
            libraryItemId: null,
            notes: [],
        },
        {
            id: "job.maintenance",
            createdAt: "2026-03-14T12:00:00.000Z",
            title: "Cable guide pack",
            category: "studio_infrastructure",
            urgency: "maintenance",
            requester: "ops-primary",
            linkedSource: null,
            material: "PLA",
            estimatedGrams: 28,
            estimatedRuntimeMinutes: 80,
            status: "planned",
            disposition: "library_reuse",
            reuseDecision: "keep_existing_library_item",
            libraryItemId: "library.cable_guide_pack",
            notes: [],
        },
    ];
    const sorted = (0, workflows_1.sortQueueByPriority)(jobs);
    strict_1.default.equal(sorted[0]?.id, "job.ops_critical");
    strict_1.default.equal(sorted[1]?.id, "job.maintenance");
    strict_1.default.equal(sorted[2]?.id, "job.experiment");
});
(0, node_test_1.default)("maintenance suggestions open build plate and nozzle tasks for repeated reliability signals", () => {
    const tasks = (0, workflows_1.suggestMaintenanceTasks)(["first_layer_failure", "under_extrusion"], defaults_1.fabricationMaintenanceBaseline, new Date("2026-03-14T13:00:00.000Z"));
    strict_1.default.equal(tasks.length, 1);
    strict_1.default.equal(tasks[0]?.taskType, "nozzle_inspection");
});
(0, node_test_1.default)("successful repeatable custom prints are promoted into the library candidate path", () => {
    const plan = (0, workflows_1.planFabricationJob)(defaults_1.fabricationDryRunFixtures[1].request, defaults_1.bambuX1CPrinterAsset, defaults_1.fabricationSeedLibrary, defaults_1.fabricationConsumableStock, new Date("2026-03-14T12:00:00.000Z"));
    strict_1.default.equal(plan.outcome, "planned");
    const learning = (0, workflows_1.captureLearning)(plan.job, {
        result: "completed",
        evidencePhotos: ["photo://camera-clamp-installed"],
        operatorNotes: ["Clamp fit was solid on the first install."],
        repeatable: true,
        replacedPurchase: "small camera clamp",
        failureSignals: [],
    });
    strict_1.default.equal(learning.eventType, "fabrication.complete");
    strict_1.default.equal(learning.reuseDecision, "promote_to_library");
    strict_1.default.equal(learning.nominatedLibraryItem?.name, "Overhead camera arm clamp");
});
