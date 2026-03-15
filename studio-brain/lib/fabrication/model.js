"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.failureSignals = exports.maintenanceTaskStatuses = exports.consumableStatuses = exports.reuseDecisions = exports.printJobDispositions = exports.printJobStatuses = exports.fabricationUrgencies = exports.fabricationLanes = exports.fabricationMaterials = exports.fabricationEventTypes = void 0;
exports.fabricationEventTypes = [
    "fabrication.request",
    "fabrication.plan",
    "fabrication.stock_alert",
    "fabrication.maintenance_due",
    "fabrication.complete",
    "fabrication.fail",
];
exports.fabricationMaterials = ["PLA", "PETG"];
exports.fabricationLanes = ["ceramics_tooling", "studio_infrastructure"];
exports.fabricationUrgencies = ["ops_critical", "repeatable_tooling", "maintenance", "experiment"];
exports.printJobStatuses = ["requested", "planned", "blocked_stock", "queued", "in_progress", "completed", "failed", "escalated"];
exports.printJobDispositions = [
    "library_reuse",
    "custom_build",
    "stock_blocked",
    "escalated_review",
    "keep_in_rotation",
    "discard_after_use",
];
exports.reuseDecisions = ["keep_existing_library_item", "promote_to_library", "one_off_only", "escalate_review"];
exports.consumableStatuses = ["ready", "low", "drying", "quarantined"];
exports.maintenanceTaskStatuses = ["open", "scheduled", "completed", "dismissed"];
exports.failureSignals = [
    "first_layer_failure",
    "bed_adhesion_noise",
    "under_extrusion",
    "toolhead_vibration",
    "material_runout",
    "ambiguous_request",
];
