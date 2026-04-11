"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeMemoryLayer = normalizeMemoryLayer;
exports.normalizeMemoryLayerList = normalizeMemoryLayerList;
exports.defaultMemoryTypeForLayer = defaultMemoryTypeForLayer;
exports.deriveMemoryLayer = deriveMemoryLayer;
exports.isAllowedMemoryLayer = isAllowedMemoryLayer;
exports.memoryLayerPriority = memoryLayerPriority;
const MEMORY_LAYER_VALUES = ["core", "working", "episodic", "canonical"];
function clean(value) {
    return String(value ?? "").trim().toLowerCase();
}
function asRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return {};
    return value;
}
function normalizeSourceHint(value) {
    return clean(value)
        .replace(/_/g, "-")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-");
}
function containsHint(values, ...hints) {
    return values.some((value) => hints.some((hint) => value.includes(hint)));
}
function normalizeMemoryLayer(value, fallback = "episodic") {
    const raw = clean(value);
    if (raw === "semantic" || raw === "procedural" || raw === "canonical" || raw === "durable")
        return "canonical";
    if (raw === "working" || raw === "scratch" || raw === "session")
        return "working";
    if (raw === "core" || raw === "core-blocks" || raw === "role")
        return "core";
    if (raw === "episodic" || raw === "episode")
        return "episodic";
    return fallback;
}
function normalizeMemoryLayerList(values, maxItems = 4) {
    if (!Array.isArray(values))
        return [];
    const out = [];
    const seen = new Set();
    for (const value of values) {
        const normalized = normalizeMemoryLayer(value, "episodic");
        if (!MEMORY_LAYER_VALUES.includes(normalized))
            continue;
        if (seen.has(normalized))
            continue;
        seen.add(normalized);
        out.push(normalized);
        if (out.length >= maxItems)
            break;
    }
    return out;
}
function defaultMemoryTypeForLayer(layer, fallback) {
    if (layer === "working")
        return "working";
    if (layer === "canonical") {
        return fallback === "semantic" || fallback === "procedural" ? fallback : "semantic";
    }
    if (layer === "core")
        return "procedural";
    return "episodic";
}
function deriveMemoryLayer(input) {
    const metadata = asRecord(input.metadata);
    const explicit = clean(input.memoryLayer);
    if (explicit)
        return normalizeMemoryLayer(explicit);
    const metadataLayer = clean(metadata.memoryLayer ?? metadata.layer ?? metadata.memory_layer);
    if (metadataLayer)
        return normalizeMemoryLayer(metadataLayer);
    const memoryType = clean(input.memoryType);
    if (memoryType === "working")
        return "working";
    if (memoryType === "semantic" || memoryType === "procedural")
        return "canonical";
    if (memoryType === "episodic")
        return "episodic";
    const tags = Array.isArray(input.tags)
        ? input.tags.map((value) => normalizeSourceHint(value)).filter(Boolean)
        : [];
    const source = normalizeSourceHint(input.source);
    const content = clean(input.content);
    const hints = [source, ...tags];
    if (containsHint(hints, "repo-markdown", "codex-compaction-promoted", "import-context-slice", "document-promoted")
        || Boolean(metadata.corpusRecordId || metadata.corpus_record_id || metadata.sourceArtifactPath || metadata.source_artifact_path)) {
        return "canonical";
    }
    if (containsHint(hints, "scratch", "working", "thread-scratch", "channel-scratch", "live-notes")
        || Boolean(metadata.expiresAt || metadata.channelId || metadata.threadId)) {
        return "working";
    }
    if (containsHint(hints, "decision", "checkpoint", "handoff", "blocker", "incident", "progress")
        || /\b(decision|checkpoint|handoff|blocker|incident|resolved|next action)\b/i.test(content)) {
        return "episodic";
    }
    return "episodic";
}
function isAllowedMemoryLayer(layer, allowlist, denylist) {
    if (Array.isArray(allowlist) && allowlist.length > 0 && !allowlist.includes(layer))
        return false;
    if (Array.isArray(denylist) && denylist.includes(layer))
        return false;
    return true;
}
function memoryLayerPriority(layer) {
    if (layer === "core")
        return 0;
    if (layer === "episodic")
        return 1;
    if (layer === "working")
        return 2;
    return 3;
}
