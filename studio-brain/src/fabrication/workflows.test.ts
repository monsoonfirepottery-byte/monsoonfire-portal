import test from "node:test";
import assert from "node:assert/strict";
import {
  bambuX1CPrinterAsset,
  fabricationConsumableStock,
  fabricationDryRunFixtures,
  fabricationMaintenanceBaseline,
  fabricationSeedLibrary,
} from "./defaults";
import { captureLearning, planFabricationJob, sortQueueByPriority, suggestMaintenanceTasks } from "./workflows";
import type { PrintJob } from "./model";

test("dry-run fixtures route through the expected planning outcomes", () => {
  for (const fixture of fabricationDryRunFixtures) {
    const result = planFabricationJob(
      fixture.request,
      bambuX1CPrinterAsset,
      fabricationSeedLibrary,
      fabricationConsumableStock,
      new Date("2026-03-14T12:00:00.000Z")
    );

    if (fixture.expectedOutcome === "planned") {
      assert.equal(result.outcome, "planned", fixture.label);
      assert.equal(result.route, fixture.expectedRoute, fixture.label);
      continue;
    }

    if (fixture.expectedOutcome === "stock_alert") {
      assert.equal(result.outcome, "stock_alert", fixture.label);
      assert.equal(result.route, fixture.expectedRoute, fixture.label);
      continue;
    }

    assert.equal(result.outcome, "escalated", fixture.label);
    assert.equal(result.route, fixture.expectedRoute, fixture.label);
  }
});

test("queue sorting keeps ops-critical work ahead of maintenance and experiments", () => {
  const jobs: PrintJob[] = [
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

  const sorted = sortQueueByPriority(jobs);
  assert.equal(sorted[0]?.id, "job.ops_critical");
  assert.equal(sorted[1]?.id, "job.maintenance");
  assert.equal(sorted[2]?.id, "job.experiment");
});

test("maintenance suggestions open build plate and nozzle tasks for repeated reliability signals", () => {
  const tasks = suggestMaintenanceTasks(
    ["first_layer_failure", "under_extrusion"],
    fabricationMaintenanceBaseline,
    new Date("2026-03-14T13:00:00.000Z")
  );

  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]?.taskType, "nozzle_inspection");
});

test("successful repeatable custom prints are promoted into the library candidate path", () => {
  const plan = planFabricationJob(
    fabricationDryRunFixtures[1]!.request,
    bambuX1CPrinterAsset,
    fabricationSeedLibrary,
    fabricationConsumableStock,
    new Date("2026-03-14T12:00:00.000Z")
  );
  assert.equal(plan.outcome, "planned");

  const learning = captureLearning(plan.job, {
    result: "completed",
    evidencePhotos: ["photo://camera-clamp-installed"],
    operatorNotes: ["Clamp fit was solid on the first install."],
    repeatable: true,
    replacedPurchase: "small camera clamp",
    failureSignals: [],
  });

  assert.equal(learning.eventType, "fabrication.complete");
  assert.equal(learning.reuseDecision, "promote_to_library");
  assert.equal(learning.nominatedLibraryItem?.name, "Overhead camera arm clamp");
});
