"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.esc = esc;
exports.jsonScript = jsonScript;
exports.formatTimestamp = formatTimestamp;
exports.truthToneClass = truthToneClass;
exports.actionToneClass = actionToneClass;
exports.surfaceLabel = surfaceLabel;
function esc(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}
function jsonScript(value) {
    return JSON.stringify(value)
        .replaceAll("<", "\\u003c")
        .replaceAll(">", "\\u003e")
        .replaceAll("&", "\\u0026");
}
function formatTimestamp(value) {
    if (!value)
        return "n/a";
    const ms = Date.parse(value);
    if (!Number.isFinite(ms))
        return value;
    return new Date(ms).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}
function truthToneClass(truth) {
    return `tone-${truth.tone} readiness-${truth.readiness}`;
}
function actionToneClass(action) {
    const tone = action.tone ?? "primary";
    return `button--${tone}`;
}
function surfaceLabel(surface) {
    switch (surface) {
        case "owner":
            return "Owner";
        case "manager":
            return "Manager";
        case "hands":
            return "Hands";
        case "internet":
            return "Internet";
        default:
            return surface;
    }
}
