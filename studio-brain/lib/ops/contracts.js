"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.opsAuthStatuses = exports.taskEscapeHatches = exports.approvalStatuses = exports.proofModes = exports.humanTaskStatuses = exports.opsCaseStatuses = exports.opsPriorityLevels = exports.opsCaseKinds = exports.opsCapabilities = exports.opsHumanRoles = exports.opsSurfaceModes = exports.opsSurfaceIds = exports.opsDegradeModes = exports.verificationClasses = void 0;
exports.normalizeOpsHumanRole = normalizeOpsHumanRole;
exports.normalizeOpsHumanRoles = normalizeOpsHumanRoles;
exports.deriveOpsCapabilities = deriveOpsCapabilities;
exports.allowedSurfacesForCapabilities = allowedSurfacesForCapabilities;
exports.allowedModesForSurface = allowedModesForSurface;
exports.hasOpsCapability = hasOpsCapability;
exports.canAccessOpsSurface = canAccessOpsSurface;
exports.canAccessOpsMode = canAccessOpsMode;
exports.nowIso = nowIso;
exports.stableOpsHash = stableOpsHash;
exports.clampConfidence = clampConfidence;
exports.makeId = makeId;
const node_crypto_1 = __importDefault(require("node:crypto"));
exports.verificationClasses = ["observed", "inferred", "planned", "claimed", "confirmed"];
exports.opsDegradeModes = [
    "observe_only",
    "draft_only",
    "no_human_tasking",
    "manual_dispatch_only",
    "internet_pause",
    "growth_pause",
    "forge_pause",
];
exports.opsSurfaceIds = ["owner", "manager", "hands", "internet", "ceo", "forge"];
exports.opsSurfaceModes = {
    owner: ["brief", "approvals", "finance", "identity"],
    manager: ["overview", "live", "truth", "operations", "commitments", "trust"],
    hands: ["now", "queue", "checkins", "production", "firings", "lending", "lending-intake"],
    internet: ["desk", "member-ops", "events", "support", "reputation"],
    ceo: ["portfolio", "community", "campaigns"],
    forge: ["lab", "policy-agent-ops", "telemetry", "migration"],
};
exports.opsHumanRoles = [
    "owner",
    "member_ops",
    "support_ops",
    "kiln_lead",
    "floor_staff",
    "events_ops",
    "library_ops",
    "finance_ops",
];
exports.opsCapabilities = [
    "surface:owner",
    "surface:manager",
    "surface:hands",
    "surface:internet",
    "surface:ceo",
    "surface:forge",
    "members:view",
    "members:create",
    "members:edit_profile",
    "members:edit_membership",
    "members:edit_role",
    "members:edit_owner_role",
    "members:edit_billing",
    "approvals:view",
    "approvals:manage",
    "tasks:claim:any",
    "tasks:escape",
    "proof:submit",
    "proof:accept",
    "reservations:view",
    "reservations:prepare",
    "events:view",
    "reports:view",
    "lending:view",
    "finance:view",
    "finance:act",
    "overrides:request",
    "overrides:approve",
    "identity:manage",
    "strategy:ceo",
    "forge:manage",
];
const roleCapabilityMap = {
    owner: [
        "surface:owner",
        "surface:manager",
        "surface:hands",
        "surface:internet",
        "surface:ceo",
        "surface:forge",
        "members:view",
        "members:create",
        "members:edit_profile",
        "members:edit_membership",
        "members:edit_role",
        "members:edit_owner_role",
        "members:edit_billing",
        "approvals:view",
        "approvals:manage",
        "tasks:claim:any",
        "tasks:escape",
        "proof:submit",
        "proof:accept",
        "reservations:view",
        "reservations:prepare",
        "events:view",
        "reports:view",
        "lending:view",
        "finance:view",
        "finance:act",
        "overrides:request",
        "overrides:approve",
        "identity:manage",
        "strategy:ceo",
        "forge:manage",
    ],
    member_ops: [
        "surface:internet",
        "members:view",
        "members:create",
        "members:edit_profile",
        "members:edit_membership",
        "members:edit_role",
        "members:edit_billing",
        "approvals:view",
        "tasks:escape",
        "proof:submit",
        "reservations:view",
        "events:view",
        "overrides:request",
    ],
    support_ops: [
        "surface:internet",
        "members:view",
        "members:create",
        "members:edit_profile",
        "members:edit_membership",
        "members:edit_role",
        "members:edit_billing",
        "approvals:view",
        "tasks:claim:any",
        "tasks:escape",
        "proof:submit",
        "proof:accept",
        "reservations:view",
        "events:view",
        "reports:view",
        "overrides:request",
    ],
    kiln_lead: [
        "surface:hands",
        "tasks:claim:any",
        "tasks:escape",
        "proof:submit",
        "proof:accept",
        "reservations:view",
        "reservations:prepare",
        "overrides:request",
    ],
    floor_staff: [
        "surface:hands",
        "tasks:claim:any",
        "tasks:escape",
        "proof:submit",
        "reservations:view",
        "overrides:request",
    ],
    events_ops: [
        "surface:internet",
        "tasks:claim:any",
        "tasks:escape",
        "proof:submit",
        "reservations:view",
        "events:view",
        "overrides:request",
    ],
    library_ops: [
        "surface:hands",
        "tasks:claim:any",
        "tasks:escape",
        "proof:submit",
        "lending:view",
        "overrides:request",
    ],
    finance_ops: [
        "surface:owner",
        "approvals:view",
        "finance:view",
        "members:edit_billing",
        "overrides:request",
    ],
};
function normalizeOpsHumanRole(value) {
    if (typeof value !== "string")
        return null;
    const normalized = value.trim().toLowerCase();
    return exports.opsHumanRoles.find((entry) => entry === normalized) ?? null;
}
function normalizeOpsHumanRoles(values) {
    const next = new Set();
    const source = Array.isArray(values) ? values : [values];
    for (const entry of source) {
        const normalized = normalizeOpsHumanRole(entry);
        if (normalized)
            next.add(normalized);
    }
    return [...next];
}
function deriveOpsCapabilities(roles) {
    const next = new Set();
    for (const role of roles) {
        for (const capability of roleCapabilityMap[role] ?? []) {
            next.add(capability);
        }
    }
    return [...next];
}
function allowedSurfacesForCapabilities(capabilities) {
    const allowed = new Set();
    for (const capability of capabilities) {
        const match = capability.match(/^surface:(.+)$/);
        if (!match?.[1])
            continue;
        const surface = exports.opsSurfaceIds.find((entry) => entry === match[1]);
        if (surface)
            allowed.add(surface);
    }
    return exports.opsSurfaceIds.filter((entry) => allowed.has(entry));
}
function allowedModesForSurface(surface, capabilities) {
    if (!allowedSurfacesForCapabilities(capabilities).includes(surface))
        return [];
    return [...exports.opsSurfaceModes[surface]];
}
function hasOpsCapability(capabilities, capability) {
    return capabilities.includes(capability);
}
function canAccessOpsSurface(capabilities, surface) {
    const normalized = exports.opsSurfaceIds.find((entry) => entry === surface);
    if (!normalized)
        return false;
    return hasOpsCapability(capabilities, `surface:${normalized}`);
}
function canAccessOpsMode(capabilities, surface, mode) {
    if (!canAccessOpsSurface(capabilities, surface))
        return false;
    return exports.opsSurfaceModes[surface].includes(mode);
}
exports.opsCaseKinds = [
    "kiln_run",
    "arrival",
    "support_thread",
    "event",
    "anomaly",
    "complaint",
    "growth_experiment",
    "improvement_case",
    "station_session",
    "general",
];
exports.opsPriorityLevels = ["p0", "p1", "p2", "p3"];
exports.opsCaseStatuses = [
    "open",
    "active",
    "blocked",
    "awaiting_approval",
    "resolved",
    "canceled",
];
exports.humanTaskStatuses = [
    "proposed",
    "queued",
    "claimed",
    "in_progress",
    "blocked",
    "proof_pending",
    "verified",
    "reopened",
    "canceled",
];
exports.proofModes = [
    "manual_confirm",
    "qr_scan",
    "camera_snapshot",
    "sensor_transition",
    "dual_confirm",
];
exports.approvalStatuses = ["pending", "approved", "rejected", "executed", "expired"];
exports.taskEscapeHatches = [
    "need_help",
    "unsafe",
    "missing_tool",
    "not_my_role",
    "already_done",
    "defer_with_reason",
];
function nowIso() {
    return new Date().toISOString();
}
function stableOpsHash(value) {
    return node_crypto_1.default.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function clampConfidence(value, fallback = 0.5) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed))
        return fallback;
    return Math.max(0, Math.min(1, parsed));
}
function makeId(prefix) {
    return `${prefix}_${node_crypto_1.default.randomUUID()}`;
}
exports.opsAuthStatuses = ["authorized", "denied", "degraded"];
