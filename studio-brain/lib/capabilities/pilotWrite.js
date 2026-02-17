"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPilotDryRun = buildPilotDryRun;
function requiredString(value, name) {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`Missing ${name}.`);
    }
    return value.trim();
}
function buildPilotDryRun(input) {
    const actionType = requiredString(input.actionType, "actionType");
    if (actionType !== "ops_note_append") {
        throw new Error("Unsupported pilot actionType.");
    }
    const ownerUid = requiredString(input.ownerUid, "ownerUid");
    const resourceCollection = requiredString(input.resourceCollection, "resourceCollection");
    if (resourceCollection !== "batches") {
        throw new Error("Pilot resourceCollection must be batches.");
    }
    const resourceId = requiredString(input.resourceId, "resourceId");
    const note = requiredString(input.note, "note");
    if (note.length < 5) {
        throw new Error("Pilot note must be at least 5 characters.");
    }
    return {
        actionType: "ops_note_append",
        ownerUid,
        resourceCollection: "batches",
        resourceId,
        notePreview: note.slice(0, 140),
    };
}
