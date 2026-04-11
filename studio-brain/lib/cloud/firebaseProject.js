"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_FIREBASE_PROJECT_ID = void 0;
exports.resolveFirebaseProjectId = resolveFirebaseProjectId;
exports.DEFAULT_FIREBASE_PROJECT_ID = "monsoonfire-portal";
function clean(value) {
    return typeof value === "string" ? value.trim() : "";
}
function parseProjectIdFromFirebaseConfig(raw) {
    const trimmed = clean(raw);
    if (!trimmed.startsWith("{"))
        return "";
    try {
        const parsed = JSON.parse(trimmed);
        return clean(parsed.projectId);
    }
    catch {
        return "";
    }
}
function resolveFirebaseProjectId(explicitProjectId, env = process.env) {
    const candidates = [
        clean(explicitProjectId),
        clean(env.FIREBASE_PROJECT_ID),
        clean(env.GOOGLE_CLOUD_PROJECT),
        clean(env.GCLOUD_PROJECT),
        clean(env.PORTAL_PROJECT_ID),
        parseProjectIdFromFirebaseConfig(clean(env.FIREBASE_CONFIG)),
        exports.DEFAULT_FIREBASE_PROJECT_ID,
    ];
    for (const candidate of candidates) {
        if (candidate)
            return candidate;
    }
    return exports.DEFAULT_FIREBASE_PROJECT_ID;
}
