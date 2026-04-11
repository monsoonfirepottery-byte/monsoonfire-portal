"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoryValidationError = void 0;
exports.createMemoryService = createMemoryService;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const zod_1 = require("zod");
const embedding_1 = require("./embedding");
const associationScout_1 = require("./associationScout");
const contracts_1 = require("./contracts");
const nanny_1 = require("./nanny");
const layers_1 = require("./layers");
const SENSITIVE_KEY_PATTERN = /(secret|password|authorization|api[-_]?key|cookie|session)/i;
const SENSITIVE_TOKEN_COMPONENT_PATTERN = /(^|_)(token|jwt|bearer|access|refresh|id)($|_)/i;
const SAFE_TOKEN_COMPONENT_PATTERN = /(^|_)(topic_tokens|participant_tokens|token_count|tokens_count|structure_signal_count)($|_)/i;
const SAFE_METADATA_POINTER_KEY_PATTERN = /^(corpus_record_id|corpus_source_unit_id|chunk_id|source_client_request_id|source_client_request_ids)$/;
const SOURCE_CONFIDENCE_DEFAULT = 0.5;
const SOURCE_CONFIDENCE_BY_SOURCE = {
    "user-direct": 0.98,
    "codex-compaction-promoted": 0.88,
    "codex-compaction-window": 0.72,
    "codex-compaction-raw": 0.64,
    "codex-resumable-session": 0.76,
    "codex-history-export": 0.72,
    "import-context-slice": 0.82,
    "repo-markdown": 0.84,
    "chatgpt-export:memory-pack.zip": 0.45,
    "memory-pack-mined-memories-unique-runid": 0.35,
};
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const URL_PATTERN = /\bhttps?:\/\/[^\s)>"']+/gi;
const TICKET_PATTERN = /\b(?:[A-Z]{2,10}-\d{1,8}|INC\d{4,10}|SR-\d{3,10}|BUG-\d{3,10}|#\d{2,8})\b/g;
const MESSAGE_ID_PATTERN = /<[^>]+>/g;
const DATE_PATTERN = /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/g;
const GRAPH_RELATION_LIMIT = 64;
const ENTITY_INDEX_LIMIT = 96;
const MEMORY_BRIEF_RELATIVE_PATH = ["output", "studio-brain", "memory-brief", "latest.json"];
const MEMORY_CONSOLIDATION_RELATIVE_PATH = ["output", "studio-brain", "memory-consolidation", "latest.json"];
const MEMORY_SERVICE_REPO_ROOT = (0, node_path_1.resolve)(__dirname, "..", "..", "..");
const MEMORY_CONSOLIDATION_CONNECTION_SOURCE = "memory-consolidation-connection";
const MEMORY_CONSOLIDATION_PROMOTION_CANDIDATE_SOURCE = "memory-consolidation-promotion-candidate";
const MEMORY_CONSOLIDATION_PROMOTED_SOURCE = "memory-consolidation-promoted";
class MemoryValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = "MemoryValidationError";
    }
}
exports.MemoryValidationError = MemoryValidationError;
function clamp01(value, fallback = 0.5) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric))
        return fallback;
    return Math.max(0, Math.min(1, numeric));
}
function normalizeError(error) {
    if (error instanceof MemoryValidationError)
        return error;
    if (error instanceof zod_1.ZodError) {
        const details = error.issues.map((issue) => `${issue.path.join(".") || "value"}: ${issue.message}`).join("; ");
        return new MemoryValidationError(details || "Invalid memory request payload.");
    }
    if (error instanceof Error)
        return new MemoryValidationError(error.message);
    return new MemoryValidationError(String(error));
}
function normalizeErrorMessage(error) {
    return String(error instanceof Error ? error.message : error ?? "")
        .trim()
        .toLowerCase();
}
function isSearchLexicalTimeoutError(error) {
    const message = normalizeErrorMessage(error);
    return (message.includes("search-lexical") || message.includes("lexical")) && message.includes("timed out");
}
function isTransientStoreTimeoutError(error) {
    const message = normalizeErrorMessage(error);
    return (message.includes("timed out") ||
        message.includes("timeout exceeded") ||
        message.includes("failed to reach") ||
        message.includes("connect") ||
        message.includes("econn") ||
        message.includes("cannot use a pool after calling end on the pool"));
}
function stableSortValue(value) {
    if (Array.isArray(value)) {
        return value.map((entry) => stableSortValue(entry));
    }
    if (!value || typeof value !== "object")
        return value;
    const source = value;
    const sortedKeys = Object.keys(source).sort((left, right) => left.localeCompare(right));
    const out = {};
    for (const key of sortedKeys)
        out[key] = stableSortValue(source[key]);
    return out;
}
function stableStringify(value) {
    try {
        return JSON.stringify(stableSortValue(value));
    }
    catch {
        return String(value ?? "");
    }
}
async function withTimeout(promise, timeoutMs, label) {
    const boundedMs = Math.max(1, Math.trunc(timeoutMs));
    let handle = null;
    const timeoutPromise = new Promise((_, reject) => {
        handle = setTimeout(() => reject(new Error(`${label} timed out after ${boundedMs}ms`)), boundedMs);
    });
    try {
        return await Promise.race([promise, timeoutPromise]);
    }
    finally {
        if (handle)
            clearTimeout(handle);
    }
}
function readBoundedEnvInt(name, fallback, min, max) {
    const raw = String(process.env[name] ?? "").trim();
    if (!raw)
        return fallback;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed))
        return fallback;
    return Math.max(min, Math.min(max, parsed));
}
function readBoolEnv(name, fallback) {
    const raw = String(process.env[name] ?? "").trim().toLowerCase();
    if (!raw)
        return fallback;
    if (raw === "1" || raw === "true" || raw === "yes" || raw === "on")
        return true;
    if (raw === "0" || raw === "false" || raw === "no" || raw === "off")
        return false;
    return fallback;
}
const MEMORY_QUERY_ROUTE_TIMEOUT_MS = readBoundedEnvInt("STUDIO_BRAIN_MEMORY_QUERY_ROUTE_TIMEOUT_MS", 16_000, 1_000, 120_000);
const MEMORY_QUERY_STAGE_TIMEOUT_MS = readBoundedEnvInt("STUDIO_BRAIN_MEMORY_QUERY_STAGE_TIMEOUT_MS", Math.max(1_500, Math.min(4_500, Math.floor(MEMORY_QUERY_ROUTE_TIMEOUT_MS * 0.2))), 1_000, 60_000);
const MEMORY_QUERY_FALLBACK_STAGE_TIMEOUT_MS = readBoundedEnvInt("STUDIO_BRAIN_MEMORY_QUERY_FALLBACK_STAGE_TIMEOUT_MS", Math.max(1_200, Math.min(3_000, Math.floor(MEMORY_QUERY_ROUTE_TIMEOUT_MS * 0.14))), 1_000, 60_000);
const MEMORY_QUERY_EMBED_TIMEOUT_MS = readBoundedEnvInt("STUDIO_BRAIN_MEMORY_QUERY_EMBED_TIMEOUT_MS", Math.max(1_000, Math.min(2_000, Math.floor(MEMORY_QUERY_ROUTE_TIMEOUT_MS * 0.1))), 1_000, 60_000);
const MEMORY_QUERY_ENABLE_SEMANTIC_TIMEOUT_FALLBACK = readBoolEnv("STUDIO_BRAIN_MEMORY_SEARCH_SEMANTIC_TIMEOUT_FALLBACK", false);
const MEMORY_QUERY_ENABLE_LEXICAL_TIMEOUT_FALLBACK = readBoolEnv("STUDIO_BRAIN_MEMORY_QUERY_LEXICAL_TIMEOUT_FALLBACK", true);
const MEMORY_WORKING_TTL_HOURS = readBoundedEnvInt("STUDIO_BRAIN_MEMORY_WORKING_TTL_HOURS", 72, 1, 24 * 30);
const MEMORY_CONSOLIDATION_STALE_WARNING_HOURS = readBoundedEnvInt("STUDIO_BRAIN_MEMORY_CONSOLIDATION_STALE_WARNING_HOURS", 36, 1, 24 * 30);
const MEMORY_CONSOLIDATION_PROMOTION_CONFIDENCE_THRESHOLD = Math.max(0, Math.min(1, Number(process.env.STUDIO_BRAIN_MEMORY_CONSOLIDATION_PROMOTION_CONFIDENCE_THRESHOLD ?? "0.8") || 0.8));
const MEMORY_CONSOLIDATION_PROMOTION_IMPORTANCE_THRESHOLD = Math.max(0, Math.min(1, Number(process.env.STUDIO_BRAIN_MEMORY_CONSOLIDATION_PROMOTION_IMPORTANCE_THRESHOLD ?? "0.65") || 0.65));
const MEMORY_CONSOLIDATION_DEDUPE_SIMILARITY_THRESHOLD = Math.max(0, Math.min(1, Number(process.env.STUDIO_BRAIN_MEMORY_CONSOLIDATION_DEDUPE_SIMILARITY_THRESHOLD ?? "0.92") || 0.92));
const MEMORY_CONSOLIDATION_REPAIR_THRESHOLD = Math.max(0, Math.min(1, Number(process.env.STUDIO_BRAIN_MEMORY_CONSOLIDATION_REPAIR_THRESHOLD ?? "0.7") || 0.7));
const MEMORY_CONSOLIDATION_CONNECTION_NOTES_ENABLED = readBoolEnv("STUDIO_BRAIN_MEMORY_CONSOLIDATION_CONNECTION_NOTES_ENABLED", true);
const MEMORY_CONSOLIDATION_CONNECTION_NOTE_MIN_SCORE = Math.max(0, Math.min(1, Number(process.env.STUDIO_BRAIN_MEMORY_CONSOLIDATION_CONNECTION_NOTE_MIN_SCORE ?? "0.7") || 0.7));
const MEMORY_CONSOLIDATION_MAX_CONNECTION_NOTES = readBoundedEnvInt("STUDIO_BRAIN_MEMORY_CONSOLIDATION_MAX_CONNECTION_NOTES", 12, 1, 128);
const MEMORY_CONSOLIDATION_WIDE_SEARCH_ENABLED = readBoolEnv("STUDIO_BRAIN_MEMORY_CONSOLIDATION_WIDE_SEARCH_ENABLED", true);
const MEMORY_CONSOLIDATION_WIDE_QUERY_LIMIT = readBoundedEnvInt("STUDIO_BRAIN_MEMORY_CONSOLIDATION_WIDE_QUERY_LIMIT", 6, 1, 16);
const MEMORY_CONSOLIDATION_WIDE_SEARCH_RESULT_LIMIT = readBoundedEnvInt("STUDIO_BRAIN_MEMORY_CONSOLIDATION_WIDE_SEARCH_RESULT_LIMIT", 24, 1, 128);
const MEMORY_CONSOLIDATION_WIDE_RELATED_LIMIT = readBoundedEnvInt("STUDIO_BRAIN_MEMORY_CONSOLIDATION_WIDE_RELATED_LIMIT", 64, 4, 256);
const MEMORY_CONSOLIDATION_SOURCE_BALANCING_ENABLED = readBoolEnv("STUDIO_BRAIN_MEMORY_CONSOLIDATION_SOURCE_BALANCING_ENABLED", true);
const MEMORY_CONSOLIDATION_SECOND_PASS_ENABLED = readBoolEnv("STUDIO_BRAIN_MEMORY_CONSOLIDATION_SECOND_PASS_ENABLED", true);
const MEMORY_CONSOLIDATION_SECOND_PASS_MAX_QUERIES = readBoundedEnvInt("STUDIO_BRAIN_MEMORY_CONSOLIDATION_SECOND_PASS_MAX_QUERIES", 6, 0, 24);
const MEMORY_CONSOLIDATION_SECOND_PASS_SEARCH_LIMIT = readBoundedEnvInt("STUDIO_BRAIN_MEMORY_CONSOLIDATION_SECOND_PASS_SEARCH_LIMIT", 12, 1, 64);
const MEMORY_CONSOLIDATION_SECOND_PASS_RELATED_LIMIT = readBoundedEnvInt("STUDIO_BRAIN_MEMORY_CONSOLIDATION_SECOND_PASS_RELATED_LIMIT", 18, 0, 128);
const MEMORY_CONSOLIDATION_RAW_COMPACTION_SHARE_CAP = Math.max(0, Math.min(1, Number(process.env.STUDIO_BRAIN_MEMORY_CONSOLIDATION_RAW_COMPACTION_SHARE_CAP ?? "0.2") || 0.2));
const MEMORY_CONSOLIDATION_FAMILY_MIN_COUNT = readBoundedEnvInt("STUDIO_BRAIN_MEMORY_CONSOLIDATION_FAMILY_MIN_COUNT", 2, 1, 12);
const MEMORY_CONSOLIDATION_THEME_CLUSTER_MIN_SIMILARITY = Math.max(0, Math.min(1, Number(process.env.STUDIO_BRAIN_MEMORY_CONSOLIDATION_THEME_CLUSTER_MIN_SIMILARITY ?? "0.38") || 0.38));
const MEMORY_CONSOLIDATION_THEME_MAX_CLUSTERS = readBoundedEnvInt("STUDIO_BRAIN_MEMORY_CONSOLIDATION_THEME_MAX_CLUSTERS", 12, 1, 64);
const MEMORY_CONSOLIDATION_THEME_PROMOTION_CANDIDATE_ENABLED = readBoolEnv("STUDIO_BRAIN_MEMORY_CONSOLIDATION_THEME_PROMOTION_CANDIDATE_ENABLED", true);
const MEMORY_CONSOLIDATION_THEME_PROMOTION_CANDIDATE_MIN_CONFIDENCE = Math.max(0, Math.min(1, Number(process.env.STUDIO_BRAIN_MEMORY_CONSOLIDATION_THEME_PROMOTION_CANDIDATE_MIN_CONFIDENCE ?? "0.72") || 0.72));
const MEMORY_CONSOLIDATION_THEME_PROMOTION_CONFIRM_MIN_FAMILIES = readBoundedEnvInt("STUDIO_BRAIN_MEMORY_CONSOLIDATION_THEME_PROMOTION_CONFIRM_MIN_FAMILIES", 3, 2, 6);
const MEMORY_CONSOLIDATION_ASSOCIATION_SCOUT_MAX_BUNDLES = readBoundedEnvInt("STUDIO_BRAIN_MEMORY_CONSOLIDATION_ASSOCIATION_SCOUT_MAX_BUNDLES", 3, 1, 64);
const MEMORY_CONSOLIDATION_ASSOCIATION_SCOUT_MAX_MEMORIES_PER_BUNDLE = readBoundedEnvInt("STUDIO_BRAIN_MEMORY_CONSOLIDATION_ASSOCIATION_SCOUT_MAX_MEMORIES_PER_BUNDLE", 10, 2, 20);
const MEMORY_CONSOLIDATION_ASSOCIATION_SCOUT_INTENT_MIN_CONFIDENCE = Math.max(0, Math.min(1, Number(process.env.STUDIO_BRAIN_MEMORY_CONSOLIDATION_ASSOCIATION_SCOUT_INTENT_MIN_CONFIDENCE ?? "0.58") || 0.58));
function toNormalizedMetadataKey(value) {
    return String(value ?? "")
        .trim()
        .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
        .replace(/[^a-zA-Z0-9]+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "")
        .toLowerCase();
}
function shouldRedactMetadataKey(key) {
    const normalized = toNormalizedMetadataKey(key);
    if (!normalized)
        return false;
    if (SAFE_METADATA_POINTER_KEY_PATTERN.test(normalized))
        return false;
    if (SENSITIVE_KEY_PATTERN.test(normalized))
        return true;
    if (SAFE_TOKEN_COMPONENT_PATTERN.test(normalized))
        return false;
    if (SENSITIVE_TOKEN_COMPONENT_PATTERN.test(normalized))
        return true;
    return false;
}
const MESSAGE_REFERENCE_METADATA_KEY_PATTERN = /(^|_)(?:normalized_message_id|message_id|raw_message_id|in_reply_to|reply_to|reference_message_ids?|references|message_reference(?:_ids?)?)(_|$)/;
function shouldTokenizeMessageReferenceMetadataKey(normalizedKey) {
    return MESSAGE_REFERENCE_METADATA_KEY_PATTERN.test(normalizedKey);
}
function toMessageReferenceToken(value) {
    const raw = normalizeText(value).toLowerCase();
    if (!raw)
        return "";
    if (/^msg_[a-f0-9]{16,64}$/i.test(raw))
        return raw;
    const extracted = extractMessageIds(raw, 1)[0] ?? "";
    const candidate = (extracted || raw).toLowerCase();
    if (!candidate)
        return "";
    if (!extracted && (!/^[a-z0-9._:+-]{6,220}$/i.test(candidate) || candidate.includes("@")))
        return "";
    return `msg_${(0, node_crypto_1.createHash)("sha256").update(candidate).digest("hex").slice(0, 24)}`;
}
function normalizeMessageReferenceList(value, max = 64) {
    const out = [];
    const seen = new Set();
    for (const token of readStringValues(value, max * 4)) {
        const extracted = extractMessageIds(token, max * 2);
        if (extracted.length > 0) {
            for (const hit of extracted) {
                const normalized = toMessageReferenceToken(hit);
                if (!normalized || seen.has(normalized))
                    continue;
                seen.add(normalized);
                out.push(normalized);
                if (out.length >= max)
                    return out;
            }
            continue;
        }
        const normalized = toMessageReferenceToken(token);
        if (!normalized || seen.has(normalized))
            continue;
        seen.add(normalized);
        out.push(normalized);
        if (out.length >= max)
            return out;
    }
    return out;
}
function redactSensitiveMetadataValue(normalizedKey, value) {
    if (shouldTokenizeMessageReferenceMetadataKey(normalizedKey)) {
        const normalized = normalizeMessageReferenceList(value, 96);
        if (Array.isArray(value))
            return normalized;
        if (normalized.length >= 2)
            return normalized;
        if (normalized.length === 1)
            return normalized[0];
        return "[redacted]";
    }
    return "[redacted]";
}
function redactSensitiveMetadata(metadata) {
    const next = {};
    for (const [key, value] of Object.entries(metadata)) {
        const normalizedKey = toNormalizedMetadataKey(key);
        if (shouldRedactMetadataKey(key)) {
            next[key] = redactSensitiveMetadataValue(normalizedKey, value);
            continue;
        }
        if (shouldTokenizeMessageReferenceMetadataKey(normalizedKey)) {
            const normalized = normalizeMessageReferenceList(value, 96);
            if (Array.isArray(value)) {
                next[key] = normalized;
                continue;
            }
            if (normalized.length >= 2) {
                next[key] = normalized;
                continue;
            }
            if (normalized.length === 1) {
                next[key] = normalized[0];
                continue;
            }
        }
        next[key] = value;
    }
    return next;
}
function normalizeSource(raw) {
    return raw
        .trim()
        .toLowerCase()
        .replace(/_/g, "-")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-");
}
function sourceConfidenceForSource(source) {
    const normalized = normalizeSource(source);
    if (normalized.startsWith("mail:")) {
        return 0.28;
    }
    return clamp01(SOURCE_CONFIDENCE_BY_SOURCE[normalized] ??
        SOURCE_CONFIDENCE_BY_SOURCE[source] ??
        SOURCE_CONFIDENCE_DEFAULT, SOURCE_CONFIDENCE_DEFAULT);
}
function deriveMemoryId(payload) {
    const digest = (0, node_crypto_1.createHash)("sha256")
        .update(`${payload.tenantId ?? "none"}|${payload.source}|${payload.clientRequestId ?? "none"}|${payload.content}`)
        .digest("hex")
        .slice(0, 24);
    return payload.clientRequestId ? `mem_req_${digest}` : `mem_${digest}`;
}
function normalizeMetadata(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return {};
    return value;
}
function resolveMemoryArtifactPath(relativePath) {
    return (0, node_path_1.resolve)(MEMORY_SERVICE_REPO_ROOT, ...relativePath);
}
function readJsonArtifact(relativePath) {
    try {
        const target = resolveMemoryArtifactPath(relativePath);
        if (!(0, node_fs_1.existsSync)(target))
            return null;
        return JSON.parse((0, node_fs_1.readFileSync)(target, "utf8"));
    }
    catch {
        return null;
    }
}
function readMemoryConsolidationArtifact() {
    return readJsonArtifact(MEMORY_CONSOLIDATION_RELATIVE_PATH);
}
function writeMemoryConsolidationArtifact(artifact) {
    const target = resolveMemoryArtifactPath(MEMORY_CONSOLIDATION_RELATIVE_PATH);
    (0, node_fs_1.mkdirSync)((0, node_path_1.resolve)(target, ".."), { recursive: true });
    (0, node_fs_1.writeFileSync)(target, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    return target;
}
function readMemoryBriefArtifact() {
    return readJsonArtifact(MEMORY_BRIEF_RELATIVE_PATH);
}
function countByLayer(rows) {
    const counts = new Map();
    for (const row of rows) {
        counts.set(row.memoryLayer, (counts.get(row.memoryLayer) ?? 0) + 1);
    }
    return Array.from(counts.entries())
        .map(([layer, count]) => ({ layer, count }))
        .sort((left, right) => right.count - left.count || left.layer.localeCompare(right.layer));
}
function countByLayerFromSearchRows(rows) {
    const counts = new Map();
    for (const row of rows) {
        counts.set(row.memoryLayer, (counts.get(row.memoryLayer) ?? 0) + 1);
    }
    return Array.from(counts.entries())
        .map(([layer, count]) => ({ layer, count }))
        .sort((left, right) => right.count - left.count || left.layer.localeCompare(right.layer));
}
function countByStatus(rows) {
    const counts = new Map();
    for (const row of rows) {
        counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
    }
    return Array.from(counts.entries())
        .map(([status, count]) => ({ status, count }))
        .sort((left, right) => right.count - left.count || left.status.localeCompare(right.status));
}
function applyDefaultWorkingTtl(metadata, occurredAt) {
    if (metadata.expiresAt)
        return metadata;
    const anchorMs = Number.isFinite(Date.parse(occurredAt ?? "")) ? Date.parse(occurredAt ?? "") : Date.now();
    return {
        ...metadata,
        expiresAt: new Date(anchorMs + MEMORY_WORKING_TTL_HOURS * 60 * 60 * 1000).toISOString(),
    };
}
function hasCanonicalLineage(metadata) {
    const derivedIds = metadata.derivedFromIds;
    if (Array.isArray(derivedIds) && derivedIds.some((value) => normalizeText(value)))
        return true;
    return Boolean(normalizeText(metadata.corpusRecordId)
        || normalizeText(metadata.corpus_record_id)
        || normalizeText(metadata.corpusSourceUnitId)
        || normalizeText(metadata.corpus_source_unit_id)
        || normalizeText(metadata.sourceArtifactPath)
        || normalizeText(metadata.source_artifact_path)
        || normalizeText(metadata.sourcePath)
        || normalizeText(metadata.source_path)
        || normalizeText(metadata.lineagePointer)
        || normalizeText(metadata.lineage_pointer));
}
function withCanonicalLineage(metadata, input) {
    if (hasCanonicalLineage(metadata))
        return metadata;
    return {
        ...metadata,
        lineagePointer: input.clientRequestId || input.id,
        sourceArtifactPath: normalizeText(metadata.sourceArtifactPath) || normalizeText(metadata.sourcePath) || `memory://${input.source}/${input.id}`,
    };
}
function deriveCaptureLayer(input) {
    return (0, layers_1.deriveMemoryLayer)({
        memoryLayer: input.memoryLayer,
        memoryType: input.memoryType,
        source: input.source,
        tags: input.tags,
        content: input.content,
        metadata: input.metadata,
    });
}
function synthesizeCoreRowsFromBrief(brief, tenantId, anchorAt) {
    const generatedAt = normalizeText(brief?.generatedAt) || anchorAt;
    const rows = [];
    const coreBlocks = Array.isArray(brief?.layers?.coreBlocks) ? brief.layers.coreBlocks : [];
    for (const [index, content] of coreBlocks.entries()) {
        const trimmed = normalizeText(content);
        if (!trimmed)
            continue;
        rows.push({
            id: `core-block:${index}:${(0, node_crypto_1.createHash)("sha1").update(trimmed).digest("hex").slice(0, 16)}`,
            tenantId,
            agentId: "studio-brain-startup",
            runId: "startup-context",
            content: trimmed,
            source: "startup-context",
            tags: ["core-block"],
            metadata: {
                source: "startup-context",
                memoryLayer: "core",
                readOnly: true,
                synthesizedFrom: MEMORY_BRIEF_RELATIVE_PATH.join("/"),
            },
            createdAt: generatedAt,
            occurredAt: generatedAt,
            status: "accepted",
            memoryType: "procedural",
            memoryLayer: "core",
            sourceConfidence: 0.94,
            importance: 0.9,
        });
    }
    return rows;
}
function normalizeContentClusterKey(content) {
    return content
        .toLowerCase()
        .replace(/\s+/g, " ")
        .replace(/[^a-z0-9@:/._ -]+/g, "")
        .trim()
        .slice(0, 240);
}
function duplicateClusterKeyForRow(row) {
    const metadata = normalizeMetadata(row.metadata);
    const fingerprint = normalizeText(metadata.fingerprint);
    if (fingerprint)
        return `fingerprint:${fingerprint}`;
    return `content:${(0, node_crypto_1.createHash)("sha1")
        .update(`${row.tenantId ?? "none"}|${row.source}|${normalizeContentClusterKey(row.content)}|${row.tags.join(",")}`)
        .digest("hex")
        .slice(0, 24)}`;
}
function consolidationPrecedenceScore(row) {
    let score = 0;
    if (row.memoryLayer === "canonical")
        score += 400;
    else if (row.memoryLayer === "episodic" && row.status === "accepted")
        score += 300;
    else if (row.memoryLayer === "episodic")
        score += 220;
    else if (row.memoryLayer === "working")
        score += 120;
    if (normalizeSource(row.source) === "codex-compaction-promoted")
        score += 40;
    if (normalizeSource(row.source) === "codex-compaction-window")
        score += 20;
    if (normalizeSource(row.source) === "codex-compaction-raw")
        score -= 10;
    score += Math.round(row.sourceConfidence * 100) + Math.round(row.importance * 60);
    return score;
}
function extractLoopStateHint(row) {
    const metadata = normalizeMetadata(row.metadata);
    return normalizeText(metadata.loopState || metadata.currentState || metadata.state).toLowerCase();
}
function isDreamConnectionNoteSource(source) {
    return normalizeSource(source) === MEMORY_CONSOLIDATION_CONNECTION_SOURCE;
}
function isDreamConnectionNoteRow(row) {
    if (isDreamConnectionNoteSource(row.source))
        return true;
    const metadata = normalizeMetadata(row.metadata);
    return normalizeText(metadata?.dreamCycleNoteType || metadata?.dreamNoteType || metadata?.consolidationSynthesizedNoteType) === "connection";
}
function countClusterSources(rows, limit = 6) {
    const counts = new Map();
    for (const row of rows) {
        const source = normalizeSource(row.source);
        if (!source)
            continue;
        counts.set(source, (counts.get(source) ?? 0) + 1);
    }
    return Array.from(counts.entries())
        .map(([source, count]) => ({ source, count }))
        .sort((left, right) => right.count - left.count || left.source.localeCompare(right.source))
        .slice(0, limit);
}
function normalizeDreamQuerySeed(value) {
    return String(value ?? "")
        .replace(/\[[^\]]+\]\s*/g, " ")
        .replace(/^fallback:/i, " ")
        .replace(/^query=/i, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 180);
}
function shouldUseDreamQuerySeed(value) {
    const normalized = normalizeDreamQuerySeed(value).toLowerCase();
    if (!normalized || normalized.length < 8)
        return false;
    if (normalized.includes("startup-context"))
        return false;
    if (normalized.includes("persona/current-goal"))
        return false;
    if (normalized.includes("continuity brief"))
        return false;
    if (looksLikePseudoDecisionTraceText(normalized))
        return false;
    if (normalized === "accepted corpus artifacts" || normalized === "promoted jsonl" || normalized === "sqlite materialization") {
        return false;
    }
    return true;
}
function appendDreamQuerySeed(target, seen, value) {
    const normalized = normalizeDreamQuerySeed(value);
    if (!shouldUseDreamQuerySeed(normalized))
        return;
    const dedupe = normalized.toLowerCase();
    if (seen.has(dedupe))
        return;
    seen.add(dedupe);
    target.push(normalized);
}
const DREAM_CANDIDATE_FAMILY_ORDER = [
    "canonical-accepted",
    "episodic-accepted",
    "channel-manual",
    "compaction-promoted",
    "working-scratch",
    "compaction-raw",
];
const DREAM_CANDIDATE_SPILLOVER_ORDER = [
    "episodic-accepted",
    "canonical-accepted",
    "channel-manual",
    "compaction-promoted",
    "working-scratch",
    "compaction-raw",
];
const DREAM_CANDIDATE_FAMILY_SHARES = {
    "canonical-accepted": 0.25,
    "episodic-accepted": 0.25,
    "channel-manual": 0.2,
    "compaction-promoted": 0.15,
    "working-scratch": 0.05,
    "compaction-raw": 0.1,
};
function isDreamPromotionCandidateSource(source) {
    return normalizeSource(source) === MEMORY_CONSOLIDATION_PROMOTION_CANDIDATE_SOURCE;
}
function isDreamGeneratedRow(row) {
    return isDreamConnectionNoteRow(row) || isDreamPromotionCandidateSource(row.source);
}
function dreamSourceFamilyKey(row) {
    const normalized = normalizeSource(row.source);
    if (normalized === "codex-compaction-raw")
        return "compaction-raw";
    if (normalized.startsWith("codex-compaction-"))
        return "compaction-promoted";
    if (row.memoryLayer === "canonical" && row.status === "accepted")
        return "canonical-accepted";
    if (row.memoryLayer === "episodic" && row.status === "accepted")
        return "episodic-accepted";
    if (row.memoryLayer === "working")
        return "working-scratch";
    return "channel-manual";
}
function dreamCandidatePriorityScore(row) {
    const metadata = normalizeMetadata(row.metadata);
    const family = dreamSourceFamilyKey(row);
    let score = consolidationPrecedenceScore(row);
    if (row.memoryLayer === "episodic" && row.status === "accepted")
        score += 40;
    if (hasCanonicalLineage(metadata))
        score += 35;
    if (row.status === "proposed")
        score -= 10;
    if (family === "compaction-promoted")
        score -= 28;
    if (family === "compaction-raw")
        score -= 72;
    if (family === "channel-manual")
        score += 16;
    if (family === "canonical-accepted")
        score += 24;
    if (row.memoryLayer === "working")
        score -= 28;
    return score;
}
function countByDreamFamily(rows, limit = 10) {
    const counts = new Map();
    for (const row of rows) {
        const family = dreamSourceFamilyKey(row);
        counts.set(family, (counts.get(family) ?? 0) + 1);
    }
    return Array.from(counts.entries())
        .map(([family, count]) => ({ family, count }))
        .sort((left, right) => right.count - left.count || left.family.localeCompare(right.family))
        .slice(0, limit);
}
function determineDreamMixQuality(counts, warnings) {
    if (warnings.some((warning) => warning.includes("compaction-raw")))
        return "raw-heavy";
    const activeFamilies = counts.filter((entry) => entry.count > 0).length;
    if (activeFamilies >= 4 && warnings.length === 0)
        return "balanced";
    if (activeFamilies >= 2)
        return "mixed";
    return "narrow";
}
function selectDreamCandidates(rows, limit) {
    if (!MEMORY_CONSOLIDATION_SOURCE_BALANCING_ENABLED || rows.length <= 1) {
        const selectedRows = rows.slice(0, limit);
        const actual = countByDreamFamily(selectedRows, DREAM_CANDIDATE_FAMILY_ORDER.length);
        const quota = DREAM_CANDIDATE_FAMILY_ORDER.map((family) => ({
            family,
            share: DREAM_CANDIDATE_FAMILY_SHARES[family],
            availableCount: actual.find((entry) => entry.family === family)?.count ?? 0,
            targetCount: actual.find((entry) => entry.family === family)?.count ?? 0,
            selectedCount: actual.find((entry) => entry.family === family)?.count ?? 0,
        }));
        return {
            rows: selectedRows,
            familyQuotaPlan: quota,
            familyQuotaActual: quota,
            dominanceWarnings: [],
            mixQuality: determineDreamMixQuality(actual, []),
        };
    }
    const requestedLimit = Math.max(1, Math.min(limit, rows.length));
    const sortedRows = [...rows].sort((left, right) => dreamCandidatePriorityScore(right) - dreamCandidatePriorityScore(left));
    const buckets = new Map();
    for (const family of DREAM_CANDIDATE_FAMILY_ORDER)
        buckets.set(family, []);
    for (const row of sortedRows) {
        const bucket = buckets.get(dreamSourceFamilyKey(row)) || [];
        bucket.push(row);
        buckets.set(dreamSourceFamilyKey(row), bucket);
    }
    const rawAvailable = buckets.get("compaction-raw")?.length ?? 0;
    const nonRawAvailable = DREAM_CANDIDATE_FAMILY_ORDER
        .filter((family) => family !== "compaction-raw")
        .reduce((sum, family) => sum + (buckets.get(family)?.length ?? 0), 0);
    const boundedLimit = rawAvailable > 0 && nonRawAvailable > 0 && MEMORY_CONSOLIDATION_RAW_COMPACTION_SHARE_CAP < 1
        ? Math.max(1, Math.min(requestedLimit, Math.max(nonRawAvailable, Math.floor(nonRawAvailable / Math.max(0.01, 1 - MEMORY_CONSOLIDATION_RAW_COMPACTION_SHARE_CAP)))))
        : requestedLimit;
    const nonEmptyFamilies = DREAM_CANDIDATE_FAMILY_ORDER.filter((family) => (buckets.get(family)?.length ?? 0) > 0);
    const minimumPerFamily = nonEmptyFamilies.length === 0
        ? 0
        : boundedLimit >= nonEmptyFamilies.length * MEMORY_CONSOLIDATION_FAMILY_MIN_COUNT
            ? MEMORY_CONSOLIDATION_FAMILY_MIN_COUNT
            : 1;
    const quotas = new Map();
    let allocated = 0;
    for (const family of DREAM_CANDIDATE_FAMILY_ORDER) {
        const available = buckets.get(family)?.length ?? 0;
        if (available <= 0) {
            quotas.set(family, 0);
            continue;
        }
        const shareTarget = Math.floor(boundedLimit * DREAM_CANDIDATE_FAMILY_SHARES[family]);
        let target = Math.max(minimumPerFamily, shareTarget);
        if (family === "compaction-raw") {
            target = Math.min(target, Math.max(minimumPerFamily, Math.floor(boundedLimit * MEMORY_CONSOLIDATION_RAW_COMPACTION_SHARE_CAP)));
        }
        target = Math.min(target, available);
        quotas.set(family, target);
        allocated += target;
    }
    for (const family of DREAM_CANDIDATE_SPILLOVER_ORDER) {
        if (allocated >= boundedLimit)
            break;
        const available = buckets.get(family)?.length ?? 0;
        const current = quotas.get(family) ?? 0;
        if (available <= current)
            continue;
        const remaining = available - current;
        const allowance = family === "compaction-raw"
            ? Math.max(0, Math.floor(boundedLimit * MEMORY_CONSOLIDATION_RAW_COMPACTION_SHARE_CAP) - current)
            : remaining;
        if (allowance <= 0)
            continue;
        const grant = Math.min(remaining, allowance, boundedLimit - allocated);
        quotas.set(family, current + grant);
        allocated += grant;
    }
    if (allocated < boundedLimit) {
        for (const family of DREAM_CANDIDATE_SPILLOVER_ORDER) {
            if (allocated >= boundedLimit)
                break;
            const available = buckets.get(family)?.length ?? 0;
            const current = quotas.get(family) ?? 0;
            if (available <= current)
                continue;
            const grant = Math.min(available - current, boundedLimit - allocated);
            quotas.set(family, current + grant);
            allocated += grant;
        }
    }
    const selected = [];
    for (const family of DREAM_CANDIDATE_FAMILY_ORDER) {
        const bucket = buckets.get(family) || [];
        selected.push(...bucket.slice(0, quotas.get(family) ?? 0));
    }
    const selectedRows = selected
        .sort((left, right) => {
        const precedenceDelta = consolidationPrecedenceScore(right) - consolidationPrecedenceScore(left);
        if (precedenceDelta !== 0)
            return precedenceDelta;
        return (right.occurredAt || right.createdAt).localeCompare(left.occurredAt || left.createdAt);
    })
        .slice(0, boundedLimit);
    const familyCounts = countByDreamFamily(selectedRows, DREAM_CANDIDATE_FAMILY_ORDER.length);
    const familyCountsMap = new Map(familyCounts.map((entry) => [entry.family, entry.count]));
    const total = Math.max(1, selectedRows.length);
    const dominanceWarnings = [];
    for (const entry of familyCounts) {
        const share = entry.count / total;
        if (entry.family === "compaction-raw" && share > MEMORY_CONSOLIDATION_RAW_COMPACTION_SHARE_CAP) {
            dominanceWarnings.push(`compaction-raw exceeded ${(MEMORY_CONSOLIDATION_RAW_COMPACTION_SHARE_CAP * 100).toFixed(0)}% of selected candidates`);
        }
        else if (share > 0.45) {
            dominanceWarnings.push(`${entry.family} exceeded 45% of selected candidates`);
        }
    }
    const familyQuotaPlan = DREAM_CANDIDATE_FAMILY_ORDER.map((family) => ({
        family,
        share: DREAM_CANDIDATE_FAMILY_SHARES[family],
        availableCount: buckets.get(family)?.length ?? 0,
        targetCount: quotas.get(family) ?? 0,
    }));
    const familyQuotaActual = familyQuotaPlan.map((entry) => ({
        ...entry,
        selectedCount: familyCountsMap.get(entry.family) ?? 0,
    }));
    return {
        rows: selectedRows,
        familyQuotaPlan,
        familyQuotaActual,
        dominanceWarnings,
        mixQuality: determineDreamMixQuality(familyCounts, dominanceWarnings),
    };
}
function buildClusterInspectionDetail(input) {
    const metadata = normalizeMetadata(input.primary.metadata);
    const earliestOccurredAt = input.rows
        .map((row) => normalizeText(row.occurredAt || row.createdAt))
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right))[0] || null;
    const latestOccurredAt = input.rows
        .map((row) => normalizeText(row.occurredAt || row.createdAt))
        .filter(Boolean)
        .sort((left, right) => right.localeCompare(left))[0] || null;
    return {
        clusterKey: input.clusterKey,
        primaryId: input.primary.id,
        primarySource: normalizeSource(input.primary.source),
        primaryLayer: input.primary.memoryLayer,
        primaryStatus: input.primary.status,
        clusterSize: input.rows.length,
        duplicateIds: input.pairAssessments.map((entry) => entry.row.id),
        duplicateSources: Array.from(new Set(input.pairAssessments.map((entry) => normalizeSource(entry.row.source)))).slice(0, 8),
        reasons: input.clusterReasons,
        strongestSimilarity: Number(input.strongestSimilarity.toFixed(3)),
        meanSimilarity: Number(input.meanSimilarity.toFixed(3)),
        promotionConfidence: Number(input.promotionConfidence.toFixed(3)),
        promotionImportance: Number(input.promotionImportance.toFixed(3)),
        corroboratingAcceptedEpisodic: input.corroboratingAcceptedEpisodic,
        provenanceBacked: input.provenanceBacked,
        nonRawSupport: input.nonRawSupport,
        acceptedOrLineageSupport: input.acceptedOrLineageSupport,
        conflictingLoopState: input.conflictingLoopState,
        loopStates: input.loopStates,
        sourceSummary: countClusterSources(input.rows),
        earliestOccurredAt,
        latestOccurredAt,
        subjectKey: normalizeSubjectKey(metadata.subjectKey || metadata.subject) || null,
        threadKey: normalizeText(threadKeyFromMetadata(metadata)) || null,
        loopKey: normalizeText(loopClusterKeyFromMetadata(metadata)) || null,
    };
}
function buildConsolidationTopicLabel(primary, rows) {
    const primaryMetadata = normalizeMetadata(primary.metadata);
    const subjectKey = normalizeSubjectKey(primaryMetadata.subjectKey || primaryMetadata.subject);
    if (subjectKey)
        return subjectKey;
    const threadKey = normalizeText(threadKeyFromMetadata(primaryMetadata));
    if (threadKey)
        return threadKey;
    const loopKey = normalizeText(loopClusterKeyFromMetadata(primaryMetadata));
    if (loopKey)
        return loopKey;
    for (const row of rows) {
        const metadata = normalizeMetadata(row.metadata);
        const candidate = normalizeSubjectKey(metadata.subjectKey || metadata.subject)
            || normalizeText(threadKeyFromMetadata(metadata))
            || normalizeText(loopClusterKeyFromMetadata(metadata));
        if (candidate)
            return candidate;
    }
    return primary.content.replace(/\s+/g, " ").trim().slice(0, 96);
}
function buildConnectionRecommendation(input) {
    if (input.conflictingLoopState) {
        return "Hold this thread in quarantine until the conflicting loop state is resolved.";
    }
    if (input.shouldPromote) {
        return "Keep this as the readable map for the promoted canonical thread.";
    }
    if (input.acceptedOrLineageSupport) {
        return input.corroboratingAcceptedEpisodic >= 2 || input.provenanceBacked
            ? "Keep the thread linked and wait for stronger corroboration before another promotion attempt."
            : "Preserve the thread as a connection note until provenance is stronger.";
    }
    return "Treat this as weak overlap only and wait for better evidence before trusting it.";
}
function buildConsolidationConnectionNote(input) {
    const duplicateIds = input.pairAssessments.map((entry) => entry.row.id);
    const topicLabel = buildConsolidationTopicLabel(input.primary, input.rows);
    const sourceSummary = countClusterSources(input.rows);
    const recommendation = buildConnectionRecommendation({
        shouldPromote: Boolean(input.promotedId),
        conflictingLoopState: input.conflictingLoopState,
        acceptedOrLineageSupport: input.acceptedOrLineageSupport,
        corroboratingAcceptedEpisodic: input.corroboratingAcceptedEpisodic,
        provenanceBacked: input.provenanceBacked,
    });
    const acceptedCount = input.rows.filter((row) => row.status === "accepted").length;
    const proposedCount = input.rows.filter((row) => row.status === "proposed").length;
    const canonicalCount = input.rows.filter((row) => row.memoryLayer === "canonical").length;
    const actionability = evaluateDreamConnectionActionability({
        rows: input.rows,
        recommendation,
        acceptedOrLineageSupport: input.acceptedOrLineageSupport,
        corroboratingAcceptedEpisodic: input.corroboratingAcceptedEpisodic,
        provenanceBacked: input.provenanceBacked,
        contradictionCount: input.conflictingLoopState ? 1 : 0,
        promotedId: input.promotedId || null,
    });
    const topicText = topicLabel ? `"${topicLabel}"` : "this thread";
    const sharedSignals = input.clusterReasons.length > 0 ? input.clusterReasons.join(", ") : "soft context overlap";
    const sourceText = sourceSummary.map((entry) => `${entry.source}(${entry.count})`).join(", ");
    const primaryText = input.primary.content.replace(/\s+/g, " ").trim().slice(0, 220);
    const content = [
        `Dream connection note: ${input.rows.length} memories converge on ${topicText}.`,
        `Primary memory: ${primaryText}`,
        `Shared signals: ${sharedSignals}.`,
        `Support: accepted=${acceptedCount}, proposed=${proposedCount}, canonical=${canonicalCount}, corroborating_episodic=${input.corroboratingAcceptedEpisodic}, provenance_backed=${input.provenanceBacked ? "yes" : "no"}, non_raw_support=${input.nonRawSupport ? "yes" : "no"}.`,
        sourceText ? `Sources: ${sourceText}.` : "",
        `Recommendation: ${recommendation}`,
    ]
        .filter(Boolean)
        .join(" ");
    const id = `dream-connection:${(0, node_crypto_1.createHash)("sha1").update(`${input.tenantId ?? "none"}|${input.clusterKey}`).digest("hex").slice(0, 24)}`;
    const materialSignature = buildConnectionNoteMaterialSignature({
        noteId: id,
        topicLabel,
        recommendation,
        relatedIds: input.rows.map((row) => row.id),
        acceptedCount,
        canonicalCount,
        contradictionCount: input.conflictingLoopState ? 1 : 0,
        promotedId: input.promotedId || null,
    });
    const sourceConfidence = Math.max(0.35, Math.min(0.94, input.primary.sourceConfidence));
    const importance = Math.max(0.45, Math.min(0.96, input.primary.importance));
    const status = input.conflictingLoopState
        ? "proposed"
        : input.acceptedOrLineageSupport
            ? "accepted"
            : "proposed";
    return {
        id,
        content,
        status,
        tags: Array.from(new Set([
            ...input.primary.tags,
            "dream-cycle",
            "memory-consolidation",
            "connection-note",
            input.mode,
        ])).slice(0, 32),
        metadata: {
            derivedFromIds: input.rows.map((row) => row.id),
            relatedMemoryIds: input.rows.map((row) => row.id).slice(0, 32),
            threadRootMemoryId: input.primary.id,
            sourceArtifactPath: MEMORY_CONSOLIDATION_RELATIVE_PATH.join("/"),
            focusAreas: input.focusAreas.slice(0, 6),
            dreamCycleNoteType: "connection",
            connectionTopic: topicLabel,
            connectionRecommendation: recommendation,
            connectionMaterialSignature: materialSignature,
            connectionActionability: {
                actionable: actionability.actionable,
                reasons: actionability.reasons,
                groundedRecommendation: actionability.groundedRecommendation,
                resolvedClaim: actionability.resolvedClaim,
            },
            entityHints: Array.from(new Set(input.rows.flatMap((row) => readStringValues(normalizeMetadata(row.metadata).entityHints, 24)))).slice(0, 24),
            patternHints: Array.from(new Set([
                ...input.rows.flatMap((row) => readStringValues(normalizeMetadata(row.metadata).patternHints, 24)),
                ...input.clusterReasons.map((reason) => `dream:${reason}`),
            ])).slice(0, 24),
            consolidation: {
                runId: input.runId,
                mode: input.mode,
                clusterKey: input.clusterKey,
                promotedId: input.promotedId || null,
                duplicateIds,
                strongestSimilarity: Number(input.strongestSimilarity.toFixed(3)),
                meanSimilarity: Number(input.meanSimilarity.toFixed(3)),
                reasons: input.clusterReasons,
                corroboratingAcceptedEpisodic: input.corroboratingAcceptedEpisodic,
                provenanceBacked: input.provenanceBacked,
                nonRawSupport: input.nonRawSupport,
            },
        },
        sourceConfidence,
        importance,
        topicLabel,
        recommendation,
        sourceSummary,
        materialSignature,
        actionable: actionability.actionable,
        actionabilityReasons: actionability.reasons,
    };
}
function buildConsolidationContentTokens(content, max = 96) {
    const tokens = new Set();
    for (const token of String(content ?? "")
        .toLowerCase()
        .split(/[^a-z0-9@:/._-]+/g)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length >= 4 && entry.length <= 64)) {
        tokens.add(token);
        if (tokens.size >= max)
            break;
    }
    return Array.from(tokens);
}
function buildConsolidationHintTokens(value, max = 96) {
    const tokens = new Set();
    for (const token of readStringValues(value, max * 3)) {
        const normalized = normalizeText(token).toLowerCase();
        if (!normalized)
            continue;
        tokens.add(normalized);
        if (tokens.size >= max)
            break;
    }
    return Array.from(tokens);
}
function jaccardSimilarity(left, right) {
    if (left.length === 0 || right.length === 0)
        return 0;
    const leftSet = new Set(left);
    const rightSet = new Set(right);
    let intersect = 0;
    for (const value of leftSet) {
        if (rightSet.has(value))
            intersect += 1;
    }
    const union = leftSet.size + rightSet.size - intersect;
    return union > 0 ? intersect / union : 0;
}
function consolidationLineageKey(row) {
    const metadata = normalizeMetadata(row.metadata);
    return normalizeText(metadata.corpusRecordId
        || metadata.corpus_record_id
        || metadata.sourceArtifactPath
        || metadata.source_artifact_path
        || metadata.lineagePointer
        || metadata.lineage_pointer).toLowerCase();
}
function buildConsolidationBucketKeys(row) {
    const metadata = normalizeMetadata(row.metadata);
    const keys = new Set();
    keys.add(duplicateClusterKeyForRow(row));
    const threadKey = normalizeText(threadKeyFromMetadata(metadata));
    if (threadKey)
        keys.add(`thread:${threadKey.toLowerCase()}`);
    const loopKey = normalizeText(loopClusterKeyFromMetadata(metadata));
    if (loopKey)
        keys.add(`loop:${loopKey.toLowerCase()}`);
    const subjectKey = normalizeSubjectKey(metadata.subjectKey || metadata.subject);
    if (subjectKey)
        keys.add(`subject:${subjectKey}`);
    const lineageKey = consolidationLineageKey(row);
    if (lineageKey)
        keys.add(`lineage:${lineageKey}`);
    return Array.from(keys);
}
function calculateConsolidationSimilarity(left, right) {
    const leftMetadata = normalizeMetadata(left.metadata);
    const rightMetadata = normalizeMetadata(right.metadata);
    const leftFingerprint = normalizeText(leftMetadata.fingerprint);
    const rightFingerprint = normalizeText(rightMetadata.fingerprint);
    const fingerprintMatch = Boolean(leftFingerprint) && leftFingerprint === rightFingerprint;
    const sameNormalizedContent = normalizeContentClusterKey(left.content) !== ""
        && normalizeContentClusterKey(left.content) === normalizeContentClusterKey(right.content);
    const sameThread = normalizeText(threadKeyFromMetadata(leftMetadata)) !== ""
        && normalizeText(threadKeyFromMetadata(leftMetadata)) === normalizeText(threadKeyFromMetadata(rightMetadata));
    const sameLoop = normalizeText(loopClusterKeyFromMetadata(leftMetadata)) !== ""
        && normalizeText(loopClusterKeyFromMetadata(leftMetadata)) === normalizeText(loopClusterKeyFromMetadata(rightMetadata));
    const sameSubject = normalizeSubjectKey(leftMetadata.subjectKey || leftMetadata.subject) !== ""
        && normalizeSubjectKey(leftMetadata.subjectKey || leftMetadata.subject) === normalizeSubjectKey(rightMetadata.subjectKey || rightMetadata.subject);
    const sameLineage = consolidationLineageKey(left) !== ""
        && consolidationLineageKey(left) === consolidationLineageKey(right);
    if (fingerprintMatch || sameNormalizedContent) {
        return {
            score: fingerprintMatch ? 1 : 0.98,
            tokenOverlap: 1,
            entityOverlap: 1,
            patternOverlap: 1,
            fingerprintMatch,
            sameThread,
            sameLoop,
            sameSubject,
            sameLineage,
        };
    }
    const tokenOverlap = jaccardSimilarity(buildConsolidationContentTokens(left.content), buildConsolidationContentTokens(right.content));
    const entityOverlap = jaccardSimilarity(buildConsolidationHintTokens(leftMetadata.entityHints), buildConsolidationHintTokens(rightMetadata.entityHints));
    const patternOverlap = jaccardSimilarity(buildConsolidationHintTokens(leftMetadata.patternHints), buildConsolidationHintTokens(rightMetadata.patternHints));
    const score = Math.max(0, Math.min(1, tokenOverlap * 0.56
        + entityOverlap * 0.18
        + patternOverlap * 0.12
        + (sameThread ? 0.06 : 0)
        + (sameLoop ? 0.06 : 0)
        + (sameSubject ? 0.04 : 0)
        + (sameLineage ? 0.08 : 0)
        + (normalizeSource(left.source) === normalizeSource(right.source) ? 0.04 : 0)));
    return {
        score: Number(score.toFixed(3)),
        tokenOverlap: Number(tokenOverlap.toFixed(3)),
        entityOverlap: Number(entityOverlap.toFixed(3)),
        patternOverlap: Number(patternOverlap.toFixed(3)),
        fingerprintMatch,
        sameThread,
        sameLoop,
        sameSubject,
        sameLineage,
    };
}
function buildConsolidationClusters(rows, threshold) {
    const parents = rows.map((_, index) => index);
    const find = (index) => {
        let current = index;
        while (parents[current] !== current) {
            parents[current] = parents[parents[current]];
            current = parents[current];
        }
        return current;
    };
    const union = (left, right) => {
        const leftRoot = find(left);
        const rightRoot = find(right);
        if (leftRoot === rightRoot)
            return;
        parents[rightRoot] = leftRoot;
    };
    let comparedPairCount = 0;
    const bucketMap = new Map();
    for (const [index, row] of rows.entries()) {
        for (const bucketKey of buildConsolidationBucketKeys(row)) {
            const bucket = bucketMap.get(bucketKey) || [];
            bucket.push(index);
            bucketMap.set(bucketKey, bucket);
        }
    }
    for (const bucket of bucketMap.values()) {
        if (bucket.length < 2)
            continue;
        const compareSet = Array.from(new Set(bucket))
            .sort((left, right) => consolidationPrecedenceScore(rows[right]) - consolidationPrecedenceScore(rows[left]))
            .slice(0, 48);
        for (let index = 0; index < compareSet.length; index += 1) {
            for (let offset = index + 1; offset < compareSet.length; offset += 1) {
                const leftIndex = compareSet[index];
                const rightIndex = compareSet[offset];
                comparedPairCount += 1;
                const metrics = calculateConsolidationSimilarity(rows[leftIndex], rows[rightIndex]);
                if (metrics.fingerprintMatch || metrics.score >= threshold) {
                    union(leftIndex, rightIndex);
                }
            }
        }
    }
    const groups = new Map();
    for (const [index, row] of rows.entries()) {
        const root = find(index);
        const bucket = groups.get(root) || [];
        bucket.push(row);
        groups.set(root, bucket);
    }
    const clusters = Array.from(groups.values())
        .filter((bucket) => bucket.length >= 2)
        .map((bucket) => {
        const sorted = [...bucket].sort((left, right) => consolidationPrecedenceScore(right) - consolidationPrecedenceScore(left));
        const exactClusterKeys = Array.from(new Set(sorted.map((row) => duplicateClusterKeyForRow(row))));
        const keySource = exactClusterKeys.length === 1
            ? exactClusterKeys[0]
            : `cluster:${(0, node_crypto_1.createHash)("sha1").update(sorted.map((row) => row.id).join("|")).digest("hex").slice(0, 24)}`;
        return {
            key: keySource,
            rows: sorted,
            exactClusterKeys,
        };
    })
        .sort((left, right) => right.rows.length - left.rows.length || left.key.localeCompare(right.key));
    return {
        clusters,
        comparedPairCount,
        softClusterCount: clusters.filter((cluster) => cluster.exactClusterKeys.length > 1).length,
    };
}
function buildConsolidationThemeKeys(row) {
    const metadata = normalizeMetadata(row.metadata);
    const keys = new Map();
    const push = (themeType, themeKey) => {
        const normalizedType = normalizePatternType(themeType);
        const normalizedKey = normalizePatternKey(themeKey);
        if (!normalizedType || !normalizedKey)
            return;
        keys.set(`${normalizedType}|${normalizedKey}`, {
            themeType: normalizedType,
            themeKey: normalizedKey,
        });
    };
    const threadKey = normalizeText(threadKeyFromMetadata(metadata));
    const loopKey = normalizeText(loopClusterKeyFromMetadata(metadata));
    const subjectKey = normalizeSubjectKey(metadata.subjectKey || metadata.subject);
    const lineageKey = consolidationLineageKey(row);
    if (threadKey)
        push("thread", threadKey);
    if (loopKey)
        push("loop", loopKey);
    if (subjectKey)
        push("subject", subjectKey);
    if (lineageKey)
        push("lineage", lineageKey);
    for (const raw of readStringValues(metadata.entityHints, 16).slice(0, 4)) {
        const [rawType, rawKey] = String(raw).split(":");
        const entityType = normalizeEntityType(rawType || "entity");
        const entityKey = normalizeEntityKey(rawKey || raw);
        if (!entityKey)
            continue;
        push(`entity:${entityType || "entity"}`, entityKey);
    }
    for (const raw of readStringValues(metadata.patternHints, 16).slice(0, 4)) {
        const [rawType, rawKey] = String(raw).split(":");
        const patternType = normalizePatternType(rawType || "pattern");
        const patternKey = normalizePatternKey(rawKey || raw);
        if (!patternKey || patternType.startsWith("dream"))
            continue;
        push(`pattern:${patternType}`, patternKey);
    }
    return Array.from(keys.values());
}
function buildConsolidationThemeClusters(rows, hardClusterRowIds) {
    const bucketMap = new Map();
    for (const row of rows) {
        if (hardClusterRowIds.has(row.id))
            continue;
        if (isDreamGeneratedRow(row))
            continue;
        for (const entry of buildConsolidationThemeKeys(row)) {
            const bucketKey = `${entry.themeType}|${entry.themeKey}`;
            const bucket = bucketMap.get(bucketKey) || {
                themeType: entry.themeType,
                themeKey: entry.themeKey,
                rows: [],
            };
            bucket.rows.push(row);
            bucketMap.set(bucketKey, bucket);
        }
    }
    const out = [];
    for (const bucket of bucketMap.values()) {
        const dedupedRows = Array.from(new Map(bucket.rows.map((row) => [row.id, row])).values())
            .sort((left, right) => dreamCandidatePriorityScore(right) - dreamCandidatePriorityScore(left))
            .slice(0, MEMORY_CONSOLIDATION_ASSOCIATION_SCOUT_MAX_MEMORIES_PER_BUNDLE);
        if (dedupedRows.length < 2)
            continue;
        const primary = dedupedRows[0];
        const pairAssessments = dedupedRows.slice(1).map((row) => ({
            row,
            metrics: calculateConsolidationSimilarity(primary, row),
        }));
        const strongestSimilarity = pairAssessments.reduce((max, entry) => Math.max(max, entry.metrics.score), 0);
        const meanSimilarity = pairAssessments.reduce((sum, entry) => sum + entry.metrics.score, 0) / Math.max(1, pairAssessments.length);
        const acceptedOrLineageSupport = dedupedRows.some((row) => row.status === "accepted" || hasCanonicalLineage(normalizeMetadata(row.metadata)));
        if (strongestSimilarity < MEMORY_CONSOLIDATION_THEME_CLUSTER_MIN_SIMILARITY
            && !(acceptedOrLineageSupport && dedupedRows.length >= 3)) {
            continue;
        }
        const reasons = Array.from(new Set([
            `shared-${bucket.themeType}`,
            ...pairAssessments.flatMap((entry) => summarizeConsolidationReasons(entry.metrics)),
        ])).slice(0, 8);
        out.push({
            key: `${bucket.themeType}:${bucket.themeKey}`,
            themeType: bucket.themeType,
            themeKey: bucket.themeKey,
            rows: dedupedRows,
            strongestSimilarity: Number(strongestSimilarity.toFixed(3)),
            meanSimilarity: Number(meanSimilarity.toFixed(3)),
            reasons,
        });
    }
    const themePriority = (themeType) => {
        if (themeType === "thread")
            return 6;
        if (themeType === "loop")
            return 5;
        if (themeType === "subject")
            return 4;
        if (themeType === "lineage")
            return 3;
        if (themeType.startsWith("entity:"))
            return 2;
        if (themeType.startsWith("pattern:"))
            return 1;
        return 0;
    };
    const deduped = new Map();
    for (const cluster of out) {
        const signature = cluster.rows.map((row) => row.id).sort((left, right) => left.localeCompare(right)).join("|");
        const existing = deduped.get(signature);
        if (!existing) {
            deduped.set(signature, cluster);
            continue;
        }
        const shouldReplace = themePriority(cluster.themeType) > themePriority(existing.themeType)
            || (themePriority(cluster.themeType) === themePriority(existing.themeType)
                && (cluster.strongestSimilarity > existing.strongestSimilarity
                    || (cluster.strongestSimilarity === existing.strongestSimilarity
                        && cluster.meanSimilarity > existing.meanSimilarity)));
        if (shouldReplace) {
            deduped.set(signature, cluster);
        }
    }
    return Array.from(deduped.values())
        .sort((left, right) => right.rows.length - left.rows.length
        || right.strongestSimilarity - left.strongestSimilarity
        || right.meanSimilarity - left.meanSimilarity
        || left.key.localeCompare(right.key))
        .slice(0, MEMORY_CONSOLIDATION_THEME_MAX_CLUSTERS);
}
function buildAssociationScoutBundle(input) {
    return {
        runId: input.runId,
        mode: input.mode,
        bundleId: input.bundleId,
        bundleType: input.bundleType,
        themeType: input.themeType,
        themeKey: input.themeKey,
        recallPass: input.recallPass ?? "initial",
        originatingBundleId: input.originatingBundleId ?? null,
        replayQueries: (input.replayQueries ?? []).slice(0, 6),
        focusAreas: input.focusAreas.slice(0, 6),
        rows: input.rows.slice(0, MEMORY_CONSOLIDATION_ASSOCIATION_SCOUT_MAX_MEMORIES_PER_BUNDLE).map((row) => {
            const metadata = normalizeMetadata(row.metadata);
            return {
                id: row.id,
                source: normalizeSource(row.source),
                memoryLayer: row.memoryLayer === "core" ? "episodic" : row.memoryLayer,
                status: row.status,
                content: row.content.replace(/\s+/g, " ").trim().slice(0, 320),
                sourceConfidence: Number(row.sourceConfidence.toFixed(3)),
                importance: Number(row.importance.toFixed(3)),
                occurredAt: row.occurredAt || row.createdAt || null,
                tags: row.tags.slice(0, 12),
                metadata: {
                    subjectKey: normalizeSubjectKey(metadata.subjectKey || metadata.subject) || null,
                    threadKey: normalizeText(threadKeyFromMetadata(metadata)) || null,
                    loopKey: normalizeText(loopClusterKeyFromMetadata(metadata)) || null,
                    lineageKey: consolidationLineageKey(row) || null,
                    entityHints: readStringValues(metadata.entityHints, 16).slice(0, 8),
                    patternHints: readStringValues(metadata.patternHints, 16).slice(0, 8),
                },
            };
        }),
    };
}
function buildAssociationBundleContext(input) {
    const primary = input.rows[0];
    const loopStates = Array.from(new Set(input.rows.map((row) => extractLoopStateHint(row)).filter(Boolean)));
    const sourceFamilyMix = countByDreamFamily(input.rows, DREAM_CANDIDATE_FAMILY_ORDER.length);
    const sourceFamilies = sourceFamilyMix.map((entry) => entry.family);
    const acceptedSupportCount = input.rows.filter((row) => row.status === "accepted").length;
    const lineageSupportCount = input.rows.filter((row) => hasCanonicalLineage(normalizeMetadata(row.metadata))).length;
    return {
        bundleId: input.bundleId,
        bundleType: input.bundleType,
        themeType: input.themeType,
        themeKey: input.themeKey,
        rows: input.rows,
        primary,
        strongestSimilarity: input.strongestSimilarity,
        meanSimilarity: input.meanSimilarity,
        reasons: input.reasons,
        acceptedOrLineageSupport: acceptedSupportCount > 0 || lineageSupportCount > 0,
        conflictingLoopState: loopStates.length > 1,
        corroboratingAcceptedEpisodic: input.rows.filter((row) => row.memoryLayer === "episodic" && row.status === "accepted" && !isDreamGeneratedRow(row)).length,
        provenanceBacked: lineageSupportCount > 0,
        nonRawSupport: input.rows.some((row) => !normalizeSource(row.source).includes("raw")),
        sourceFamilyMix,
        sourceFamilies,
        acceptedSupportCount,
        lineageSupportCount,
        recallPass: input.recallPass ?? "initial",
        originatingBundleId: input.originatingBundleId ?? null,
        replayQueries: (input.replayQueries ?? []).slice(0, 6),
        addedRowIds: (input.addedRowIds ?? []).slice(0, 24),
    };
}
function buildPromotionCandidateFingerprint(bundle, proposal, intent) {
    return (0, node_crypto_1.createHash)("sha1")
        .update([
        "promotion-candidate",
        normalizePatternType(bundle.themeType),
        normalizePatternKey(bundle.themeKey),
        normalizeContentClusterKey(proposal.theme),
        normalizeContentClusterKey(intent.title),
    ].join("|"))
        .digest("hex")
        .slice(0, 24);
}
function selectBundleSupportRows(bundle, intent, rowsById) {
    const ids = filterAssociationScoutIntentIds(intent, new Set(rowsById.keys()));
    const supportedRows = ids
        .map((id) => rowsById.get(id))
        .filter((row) => Boolean(row));
    return supportedRows.length > 0 ? supportedRows : bundle.rows.slice(0, 8);
}
function countAcceptedNonRawSupport(rows) {
    return rows.filter((row) => row.status === "accepted" && !normalizeSource(row.source).includes("raw")).length;
}
function countNonCompactionFamilies(rows) {
    return Array.from(new Set(rows.map((row) => dreamSourceFamilyKey(row)).filter((family) => !family.startsWith("compaction")))).length;
}
function countNonRawSupport(rows) {
    return rows.filter((row) => !normalizeSource(row.source).includes("raw")).length;
}
function buildConnectionNoteMaterialSignature(input) {
    return (0, node_crypto_1.createHash)("sha1")
        .update(stableStringify({
        noteId: input.noteId,
        topicLabel: normalizeText(input.topicLabel).toLowerCase(),
        recommendation: normalizeText(input.recommendation).toLowerCase(),
        relatedIds: [...input.relatedIds].sort((left, right) => left.localeCompare(right)),
        acceptedCount: Math.max(0, Math.trunc(input.acceptedCount)),
        canonicalCount: Math.max(0, Math.trunc(input.canonicalCount)),
        contradictionCount: Math.max(0, Math.trunc(input.contradictionCount)),
        promoted: Boolean(input.promotedId),
    }))
        .digest("hex")
        .slice(0, 24);
}
function readConnectionNoteMaterialSignature(row) {
    const metadata = normalizeMetadata(row?.metadata);
    return normalizeText(metadata.connectionMaterialSignature || metadata.connection_signature);
}
function evaluateDreamConnectionActionability(input) {
    const nonRawSupportCount = countNonRawSupport(input.rows);
    const groundedRecommendation = nonRawSupportCount >= 2 && isActionableDreamRecommendation(input.recommendation);
    const resolvedClaim = input.contradictionCount === 0
        && input.acceptedOrLineageSupport
        && nonRawSupportCount >= 2
        && (input.corroboratingAcceptedEpisodic >= 2
            || input.provenanceBacked
            || Boolean(input.promotedId));
    const actionable = groundedRecommendation || resolvedClaim;
    const reasons = [
        groundedRecommendation ? "grounded-operator-recommendation" : "recommendation-not-grounded",
        resolvedClaim ? "resolved-claim-supported" : "resolved-claim-not-supported",
        nonRawSupportCount < 2 ? "insufficient-non-raw-support" : "",
        input.contradictionCount > 0 ? "contradictions-present" : "",
    ].filter(Boolean);
    return {
        actionable,
        reasons,
        groundedRecommendation,
        resolvedClaim,
    };
}
function filterAssociationScoutIntentIds(intent, validIds) {
    return Array.from(new Set([...intent.memoryIds, ...intent.targetIds].filter((id) => validIds.has(id)))).slice(0, 12);
}
function buildAssociationIntentConnectionNote(input) {
    const relatedIds = filterAssociationScoutIntentIds(input.intent, new Set(input.rowsById.keys()));
    const relatedRows = relatedIds
        .map((id) => input.rowsById.get(id))
        .filter((row) => Boolean(row));
    const noteRows = relatedRows.length > 0 ? relatedRows : input.bundle.rows;
    const primary = noteRows[0] || input.bundle.primary;
    const topicLabel = normalizeText(input.intent.title)
        || normalizeText(input.proposal.theme)
        || buildConsolidationTopicLabel(primary, noteRows);
    const recommendation = normalizeText(input.intent.recommendation)
        || `Keep this association as a readable intent thread until stronger corroboration lands.`;
    const contradictionText = input.proposal.contradictions.length > 0
        ? `Contradictions: ${input.proposal.contradictions.slice(0, 3).join("; ")}.`
        : "";
    const followUpText = input.proposal.followUpQueries.length > 0
        ? `Follow-up queries: ${input.proposal.followUpQueries.slice(0, 3).join("; ")}.`
        : "";
    const sourceSummary = countClusterSources(noteRows);
    const sourceText = sourceSummary.map((entry) => `${entry.source}(${entry.count})`).join(", ");
    const acceptedCount = noteRows.filter((row) => row.status === "accepted").length;
    const canonicalCount = noteRows.filter((row) => row.memoryLayer === "canonical").length;
    const supportRows = noteRows.filter((row) => row.status === "accepted" || hasCanonicalLineage(normalizeMetadata(row.metadata)));
    const actionability = evaluateDreamConnectionActionability({
        rows: noteRows,
        recommendation,
        acceptedOrLineageSupport: supportRows.length > 0,
        corroboratingAcceptedEpisodic: input.bundle.corroboratingAcceptedEpisodic,
        provenanceBacked: input.bundle.provenanceBacked,
        contradictionCount: input.proposal.contradictions.length,
        promotedId: null,
    });
    const content = [
        `Dream association intent: ${noteRows.length} memories likely belong to "${topicLabel || "shared context"}".`,
        `Scout summary: ${input.proposal.summary}`,
        `Intent: ${input.intent.explanation}`,
        contradictionText,
        followUpText,
        sourceText ? `Sources: ${sourceText}.` : "",
        `Recommendation: ${recommendation}`,
    ].filter(Boolean).join(" ");
    const id = `dream-connection:${(0, node_crypto_1.createHash)("sha1").update(`${input.tenantId ?? "none"}|${input.bundle.bundleId}|${input.intent.title}`).digest("hex").slice(0, 24)}`;
    const status = input.bundle.conflictingLoopState
        ? "proposed"
        : supportRows.length > 0 && input.proposal.confidence >= 0.66
            ? "accepted"
            : "proposed";
    const materialSignature = buildConnectionNoteMaterialSignature({
        noteId: id,
        topicLabel,
        recommendation,
        relatedIds: noteRows.map((row) => row.id),
        acceptedCount,
        canonicalCount,
        contradictionCount: input.proposal.contradictions.length,
        promotedId: null,
    });
    const confidence = Math.max(primary.sourceConfidence, Math.min(0.96, Math.max(input.proposal.confidence, input.intent.confidence)));
    const importance = Math.max(primary.importance, Math.min(0.98, 0.42 + noteRows.length * 0.08 + input.proposal.confidence * 0.28));
    return {
        id,
        content,
        status,
        tags: Array.from(new Set([
            ...primary.tags,
            "dream-cycle",
            "memory-consolidation",
            "connection-note",
            "association-intent",
            input.mode,
        ])).slice(0, 32),
        metadata: {
            derivedFromIds: noteRows.map((row) => row.id),
            relatedMemoryIds: noteRows.map((row) => row.id).slice(0, 32),
            threadRootMemoryId: primary.id,
            sourceArtifactPath: MEMORY_CONSOLIDATION_RELATIVE_PATH.join("/"),
            focusAreas: input.focusAreas.slice(0, 6),
            dreamCycleNoteType: "connection",
            dreamIntentType: "association-intent",
            connectionTopic: topicLabel,
            connectionRecommendation: recommendation,
            connectionMaterialSignature: materialSignature,
            connectionActionability: {
                actionable: actionability.actionable,
                reasons: actionability.reasons,
                groundedRecommendation: actionability.groundedRecommendation,
                resolvedClaim: actionability.resolvedClaim,
            },
            entityHints: Array.from(new Set(noteRows.flatMap((row) => readStringValues(normalizeMetadata(row.metadata).entityHints, 24)))).slice(0, 24),
            patternHints: Array.from(new Set([
                ...noteRows.flatMap((row) => readStringValues(normalizeMetadata(row.metadata).patternHints, 24)),
                `dream:${input.bundle.themeType}`,
            ])).slice(0, 24),
            consolidation: {
                runId: input.runId,
                mode: input.mode,
                clusterKey: input.bundle.bundleId,
                strongestSimilarity: Number(input.bundle.strongestSimilarity.toFixed(3)),
                meanSimilarity: Number(input.bundle.meanSimilarity.toFixed(3)),
                reasons: input.bundle.reasons,
                corroboratingAcceptedEpisodic: input.bundle.corroboratingAcceptedEpisodic,
                provenanceBacked: input.bundle.provenanceBacked,
                nonRawSupport: input.bundle.nonRawSupport,
            },
            associationScout: {
                provider: input.proposal.provider,
                model: input.proposal.model,
                theme: input.proposal.theme,
                summary: input.proposal.summary,
                confidence: Number(input.proposal.confidence.toFixed(3)),
                contradictions: input.proposal.contradictions.slice(0, 6),
                followUpQueries: input.proposal.followUpQueries.slice(0, 6),
                intentType: input.intent.type,
                intentConfidence: Number(input.intent.confidence.toFixed(3)),
                intentTitle: input.intent.title,
                intentExplanation: input.intent.explanation,
            },
        },
        sourceConfidence: Math.max(0.38, Math.min(0.96, confidence)),
        importance: Math.max(0.45, Math.min(0.98, importance)),
        topicLabel,
        recommendation,
        sourceSummary,
        materialSignature,
        actionable: actionability.actionable,
        actionabilityReasons: actionability.reasons,
    };
}
function summarizeConsolidationReasons(metrics) {
    const reasons = [];
    if (metrics.fingerprintMatch)
        reasons.push("fingerprint-match");
    if (metrics.tokenOverlap >= 0.7)
        reasons.push("high-token-overlap");
    if (metrics.entityOverlap >= 0.45)
        reasons.push("entity-overlap");
    if (metrics.patternOverlap >= 0.45)
        reasons.push("pattern-overlap");
    if (metrics.sameThread)
        reasons.push("shared-thread");
    if (metrics.sameLoop)
        reasons.push("shared-loop");
    if (metrics.sameSubject)
        reasons.push("shared-subject");
    if (metrics.sameLineage)
        reasons.push("shared-lineage");
    return reasons.slice(0, 6);
}
function relationTypeForConsolidation(metrics) {
    if (metrics.fingerprintMatch || metrics.score >= 0.97)
        return "duplicate-of";
    if (metrics.sameLineage)
        return "lineage-overlap";
    if (metrics.sameLoop || metrics.sameThread)
        return "consolidates-with";
    return "context-overlap";
}
function readExpiryMs(metadata) {
    const expiresAt = normalizeText(metadata.expiresAt);
    if (!expiresAt)
        return null;
    const parsed = Date.parse(expiresAt);
    return Number.isFinite(parsed) ? parsed : null;
}
function isExpiredMetadata(metadata, nowMs = Date.now()) {
    const expiresMs = readExpiryMs(metadata);
    return expiresMs !== null && expiresMs <= nowMs;
}
function isExpiredRecord(row, nowMs = Date.now()) {
    if (row.status === "archived")
        return true;
    return isExpiredMetadata(normalizeMetadata(row.metadata), nowMs);
}
function isExpiredSearchResult(row, nowMs = Date.now()) {
    if (row.status === "archived")
        return true;
    return isExpiredMetadata(normalizeMetadata(row.metadata), nowMs);
}
function filterExpiredSearchResults(rows, nowMs = Date.now()) {
    return rows.filter((row) => !isExpiredSearchResult(row, nowMs));
}
function filterExpiredMemoryRecords(rows, nowMs = Date.now()) {
    return rows.filter((row) => !isExpiredRecord(row, nowMs));
}
function normalizeText(value) {
    return typeof value === "string" ? value.trim() : "";
}
function looksLikeStartupPlaceholderText(value) {
    const normalized = normalizeText(value).toLowerCase();
    return Boolean(normalized) && (normalized.includes("[startup-context]") || normalized === "startup-context");
}
function looksLikePseudoDecisionTraceText(value) {
    const normalized = normalizeText(value).toLowerCase();
    if (!normalized)
        return false;
    if (looksLikeStartupPlaceholderText(normalized))
        return true;
    if (normalized.includes("startup continuity loaded")
        || normalized.includes("context loaded")
        || normalized.includes("fallback retrieval")
        || normalized.includes("fallback strategy")
        || normalized.includes("query replay")
        || normalized.includes("resume startup query")
        || normalized.includes("startup query")
        || normalized.includes("semantic fallback")
        || normalized.includes("lexical timeout fallback")
        || normalized.includes("open-memory-cli")) {
        return true;
    }
    const activityLike = /\b(search|query|retrieval|lookup|look up|context)\b/.test(normalized);
    const traceLike = /\b(ran|executed|loaded|used|performed|replayed|fallback)\b/.test(normalized);
    const decisionLike = /\b(decision|resolved|confirmed|approved|quarantined|promoted|next action|owner|blocker)\b/.test(normalized);
    return activityLike && traceLike && !decisionLike;
}
function isPseudoDecisionTrace(input) {
    const source = normalizeSource(String(input.source ?? ""));
    if (source === "startup-context")
        return true;
    const metadata = normalizeMetadata(input.metadata);
    const kindHints = [
        normalizeSource(String(metadata.kind ?? "")),
        normalizeSource(String(metadata.type ?? "")),
        normalizeSource(String(metadata.memoryKind ?? "")),
        normalizeSource(String(metadata.rememberKind ?? "")),
        normalizeSource(String(metadata.codexTraceKind ?? "")),
    ].filter(Boolean);
    if (kindHints.some((value) => value.includes("startup-context") || value.includes("query-replay"))) {
        return true;
    }
    const text = [
        normalizeText(metadata.subject),
        normalizeText(metadata.title),
        normalizeText(metadata.summary),
        normalizeText(input.content),
    ]
        .filter(Boolean)
        .join("\n");
    return looksLikePseudoDecisionTraceText(text);
}
function isActionableDreamRecommendation(value) {
    const normalized = normalizeText(value);
    if (!normalized)
        return false;
    if (/\b(preserve the thread|keep this association as a readable intent thread|keep the thread linked|treat this as weak overlap|wait for stronger corroboration|preserve the thread as a connection note)\b/i.test(normalized)) {
        return false;
    }
    return /\b(confirm|notify|reuse|promote|quarantine|split|review|archive|rerun|triage|reconcile|disable|enable|update|verify|investigate|label|route|fix|close|publish)\b/i.test(normalized);
}
function extractEmailAddresses(value, max = 64) {
    const out = [];
    const seen = new Set();
    const push = (candidate) => {
        const normalized = String(candidate ?? "").trim().toLowerCase();
        if (!normalized || !normalized.includes("@"))
            return;
        if (seen.has(normalized))
            return;
        seen.add(normalized);
        out.push(normalized);
    };
    for (const token of readStringValues(value, max * 3)) {
        for (const email of String(token).match(EMAIL_PATTERN) || []) {
            push(email);
            if (out.length >= max)
                return out;
        }
    }
    return out;
}
function normalizeSubjectKey(value) {
    let subject = String(value ?? "").trim().toLowerCase();
    if (!subject)
        return "";
    for (let index = 0; index < 6; index += 1) {
        const next = subject.replace(/^(?:re|fw|fwd|sv|aw)\s*:\s*/i, "").trim();
        if (next === subject)
            break;
        subject = next;
    }
    subject = subject
        .replace(/\[[^\]]{1,24}\]\s*/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    return subject.slice(0, 180);
}
function parseEmailHeaderMap(content, maxLines = 120) {
    const lines = String(content ?? "")
        .split(/\r?\n/)
        .slice(0, maxLines);
    const out = {};
    let activeKey = "";
    for (const line of lines) {
        if (!line.trim())
            break;
        if (/^[ \t]+/.test(line) && activeKey) {
            out[activeKey] = `${out[activeKey]} ${line.trim()}`.trim();
            continue;
        }
        const match = line.match(/^([A-Za-z0-9-]{2,40})\s*:\s*(.*)$/);
        if (!match) {
            activeKey = "";
            continue;
        }
        activeKey = match[1].toLowerCase();
        out[activeKey] = (match[2] ?? "").trim();
    }
    return out;
}
function extractMessageIds(value, max = 24) {
    const out = [];
    const seen = new Set();
    for (const token of readStringValues(value, max * 3)) {
        for (const raw of String(token).match(MESSAGE_ID_PATTERN) || []) {
            let normalized = String(raw ?? "").trim().toLowerCase().replace(/\s+/g, "");
            if (!normalized)
                continue;
            if (!normalized.startsWith("<"))
                normalized = `<${normalized.replace(/^<|>$/g, "")}>`;
            if (seen.has(normalized))
                continue;
            seen.add(normalized);
            out.push(normalized.slice(0, 220));
            if (out.length >= max)
                return out;
        }
    }
    return out;
}
function mergeUniqueStrings(primary, additions, max = 48) {
    const out = [];
    const seen = new Set();
    for (const value of [...readStringValues(primary, max * 3), ...readStringValues(additions, max * 3)]) {
        const normalized = String(value ?? "").trim();
        if (!normalized)
            continue;
        const dedupe = normalized.toLowerCase();
        if (seen.has(dedupe))
            continue;
        seen.add(dedupe);
        out.push(normalized);
        if (out.length >= max)
            break;
    }
    return out;
}
function inferLoopClusterKeyFromEmail(input) {
    if (input.existing)
        return normalizePatternKey(input.existing);
    if (input.tickets.length > 0) {
        return normalizePatternKey(`ticket:${input.tickets[0].toUpperCase()}`);
    }
    if (input.subjectKey) {
        const compact = input.subjectKey
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 90);
        if (compact)
            return normalizePatternKey(`mail:${compact}`);
    }
    if (input.threadKey) {
        return normalizePatternKey(`thread:${input.threadKey}`);
    }
    if (input.participantDomains.length > 0) {
        return normalizePatternKey(`domain:${input.participantDomains.slice(0, 2).join("-")}`);
    }
    return "";
}
function inferLoopStateFromContent(subject, content) {
    const signals = parseQuerySignals(`${subject}\n${content}`);
    if (signals.reopened)
        return "reopened";
    if (signals.superseded)
        return "superseded";
    if (signals.resolved && !signals.blocker)
        return "resolved";
    if (signals.openLoop || signals.blocker || signals.action || signals.urgent)
        return "open-loop";
    return null;
}
function enrichCaptureMetadata(payload) {
    const metadata = normalizeMetadata(payload.metadata);
    const enriched = { ...metadata };
    const source = normalizeSource(payload.source);
    const isEmailLike = source.startsWith("mail:") || source.includes("email");
    const headers = parseEmailHeaderMap(payload.content);
    const subject = normalizeText(enriched.subject) || normalizeText(headers.subject);
    const fromRaw = normalizeText(enriched.from) || normalizeText(headers.from);
    const toRaw = normalizeText(enriched.to) || normalizeText(headers.to);
    const ccRaw = normalizeText(enriched.cc) || normalizeText(headers.cc);
    const bccRaw = normalizeText(enriched.bcc) || normalizeText(headers.bcc);
    const subjectKey = normalizeSubjectKey(normalizeText(enriched.subjectKey) || subject);
    const normalizedMessageId = normalizeMessageReferenceList([enriched.normalizedMessageId, enriched.messageId, enriched.rawMessageId, headers["message-id"]], 1)[0] ?? "";
    const inReplyToNormalized = normalizeMessageReferenceList([enriched.inReplyToNormalized, enriched.inReplyTo, enriched.replyTo, headers["in-reply-to"]], 1)[0] ??
        "";
    const referenceMessageIds = mergeUniqueStrings(normalizeMessageReferenceList(enriched.referenceMessageIds, 48), normalizeMessageReferenceList(`${normalizeText(headers.references)} ${normalizeText(enriched.references)} ${inReplyToNormalized}`, 48), 48).map((value) => String(value).toLowerCase());
    const participantEmails = mergeUniqueStrings(extractEmailAddresses(enriched.participants, 64), [
        ...extractEmailAddresses([fromRaw, toRaw, ccRaw, bccRaw], 64),
        ...extractEmailAddresses(payload.content.slice(0, 6000), 32),
    ], 64).map((value) => value.toLowerCase());
    const participantDomains = mergeUniqueStrings(enriched.participantDomains, participantEmails.map((email) => email.split("@")[1] || "").filter(Boolean), 24).map((value) => String(value).toLowerCase());
    const participantKey = normalizeText(enriched.participantKey) ||
        participantEmails
            .slice(0, 8)
            .sort((left, right) => left.localeCompare(right))
            .join("|");
    const existingThreadKey = normalizeText(enriched.threadKey) ||
        normalizeText(enriched.thread) ||
        normalizeText(enriched.thread_id) ||
        normalizeText(enriched.conversationId);
    const supportsDerivedThreading = Boolean(isEmailLike || normalizedMessageId || inReplyToNormalized || referenceMessageIds.length > 0);
    const inferredThreadKey = existingThreadKey ||
        (supportsDerivedThreading
            ? normalizePatternKey([
                "mail-thread",
                subjectKey.slice(0, 80) || participantDomains[0] || "unknown",
                referenceMessageIds[0] || inReplyToNormalized || normalizedMessageId || "",
            ]
                .filter(Boolean)
                .join(":"))
            : "");
    const threadEvidence = existingThreadKey
        ? "explicit"
        : inferredThreadKey
            ? "derived"
            : "none";
    const tickets = mergeUniqueStrings(enriched.mentionedTickets, `${subject}\n${payload.content}`.match(TICKET_PATTERN) ?? [], 24).map((value) => String(value).toUpperCase());
    const urls = mergeUniqueStrings(enriched.mentionedUrls, `${subject}\n${payload.content}`.match(URL_PATTERN) ?? [], 24).map((value) => String(value).toLowerCase());
    const topicTokens = mergeUniqueStrings(enriched.topicTokens, subjectKey
        .split(/[^a-z0-9]+/g)
        .map((token) => token.trim().toLowerCase())
        .filter((token) => token.length >= 4)
        .slice(0, 18), 32).map((value) => String(value).toLowerCase());
    const inferredLoopState = inferLoopStateFromContent(subject, payload.content.slice(0, 14_000));
    const loopClusterKey = threadEvidence !== "none"
        ? inferLoopClusterKeyFromEmail({
            existing: normalizeText(enriched.loopClusterKey),
            threadKey: inferredThreadKey,
            subjectKey,
            tickets,
            participantDomains,
        })
        : "";
    const deterministicThreadSignature = (() => {
        if (threadEvidence === "none")
            return "";
        const signatureBasis = [
            inferredThreadKey,
            normalizedMessageId,
            inReplyToNormalized,
            referenceMessageIds.slice(0, 12).join("|"),
            participantEmails
                .slice(0, 12)
                .map((email) => email.toLowerCase())
                .sort((left, right) => left.localeCompare(right))
                .join("|"),
            subjectKey,
        ]
            .filter(Boolean)
            .join("||");
        if (!signatureBasis)
            return "";
        return `threadsig_${(0, node_crypto_1.createHash)("sha256").update(signatureBasis).digest("hex").slice(0, 24)}`;
    })();
    const patternHints = new Set(readStringValues(enriched.patternHints, 96));
    const entityHints = new Set(readStringValues(enriched.entityHints, 96));
    if (isEmailLike)
        patternHints.add("source-family:mail");
    if (subjectKey) {
        patternHints.add(`topic:${subjectKey}`);
        entityHints.add(`subject:${subjectKey}`);
    }
    if (loopClusterKey) {
        patternHints.add(`loop-cluster:${loopClusterKey}`);
        patternHints.add(`loop-state:${loopClusterKey}`);
    }
    if (inferredLoopState) {
        patternHints.add(`state:${inferredLoopState}`);
    }
    if (inReplyToNormalized || referenceMessageIds.length > 0)
        patternHints.add("structure:has-references");
    if (threadEvidence !== "none" && inferredThreadKey)
        patternHints.add("structure:has-thread");
    if (threadEvidence !== "none" && deterministicThreadSignature)
        patternHints.add(`thread-signature:${deterministicThreadSignature}`);
    if (normalizedMessageId && (inReplyToNormalized || referenceMessageIds.length > 0)) {
        patternHints.add("structure:deterministic-thread-link");
    }
    if (normalizedMessageId)
        entityHints.add(`message-id:${normalizedMessageId}`);
    if (inReplyToNormalized)
        entityHints.add(`message-ref:${inReplyToNormalized}`);
    for (const ref of referenceMessageIds.slice(0, 16))
        entityHints.add(`message-ref:${ref}`);
    if (threadEvidence !== "none" && inferredThreadKey)
        entityHints.add(`thread:${inferredThreadKey}`);
    if (threadEvidence !== "none" && deterministicThreadSignature)
        entityHints.add(`thread-signature:${deterministicThreadSignature}`);
    if (participantKey)
        entityHints.add(`participants:${participantKey}`);
    for (const domain of participantDomains.slice(0, 12))
        entityHints.add(`domain:${domain}`);
    for (const ticket of tickets.slice(0, 12))
        entityHints.add(`ticket:${ticket}`);
    const contextSignals = normalizeMetadata(enriched.contextSignals);
    const signals = parseQuerySignals(`${subject}\n${payload.content.slice(0, 14_000)}`);
    const pseudoDecisionTrace = isPseudoDecisionTrace({
        source: normalizeSource(String(enriched.source ?? "")),
        content: payload.content,
        metadata: enriched,
    });
    contextSignals.decisionLike = pseudoDecisionTrace ? false : contextSignals.decisionLike === true || signals.decision;
    contextSignals.actionLike = contextSignals.actionLike === true || signals.action;
    contextSignals.blockerLike = contextSignals.blockerLike === true || signals.blocker;
    contextSignals.deadlineLike = contextSignals.deadlineLike === true || signals.deadline;
    contextSignals.urgentLike = contextSignals.urgentLike === true || signals.urgent;
    contextSignals.reopenedLike = contextSignals.reopenedLike === true || signals.reopened;
    contextSignals.correctionLike = contextSignals.correctionLike === true || signals.superseded;
    contextSignals.relationshipLike = contextSignals.relationshipLike === true || signals.relationship;
    const messageStructure = normalizeMetadata(enriched.messageStructure);
    messageStructure.hasMessageId = Boolean(normalizedMessageId);
    messageStructure.hasReplyTo = Boolean(inReplyToNormalized);
    messageStructure.hasReferences = referenceMessageIds.length > 0;
    messageStructure.hasThreadKey = Boolean(inferredThreadKey);
    messageStructure.sourceFamily = isEmailLike ? "mail" : "generic";
    messageStructure.threadEvidence = threadEvidence;
    const structureSignalCount = Number(messageStructure.hasMessageId === true) +
        Number(messageStructure.hasReplyTo === true) +
        Number(messageStructure.hasReferences === true) +
        Number(messageStructure.hasThreadKey === true);
    const existingThreadDepth = Number(enriched.threadDepthEstimate ?? 0);
    const derivedDepth = Math.max(referenceMessageIds.length + (inReplyToNormalized ? 1 : 0), subject.toLowerCase().startsWith("re:") ? 2 : 1);
    const threadDepthEstimate = Number.isFinite(existingThreadDepth)
        ? Math.max(existingThreadDepth, derivedDepth)
        : derivedDepth;
    if (subject && !normalizeText(enriched.subject))
        enriched.subject = subject;
    if (fromRaw && !normalizeText(enriched.from))
        enriched.from = fromRaw;
    if (toRaw && !normalizeText(enriched.to))
        enriched.to = toRaw;
    if (ccRaw && !normalizeText(enriched.cc))
        enriched.cc = ccRaw;
    if (bccRaw && !normalizeText(enriched.bcc))
        enriched.bcc = bccRaw;
    if (subjectKey)
        enriched.subjectKey = subjectKey;
    if (participantEmails.length > 0)
        enriched.participants = participantEmails;
    if (participantKey)
        enriched.participantKey = participantKey;
    if (participantDomains.length > 0)
        enriched.participantDomains = participantDomains;
    if (normalizedMessageId)
        enriched.normalizedMessageId = normalizedMessageId;
    if (inReplyToNormalized)
        enriched.inReplyToNormalized = inReplyToNormalized;
    if (referenceMessageIds.length > 0)
        enriched.referenceMessageIds = referenceMessageIds;
    if (threadEvidence !== "none" && inferredThreadKey)
        enriched.threadKey = inferredThreadKey;
    if (threadEvidence !== "none" && loopClusterKey)
        enriched.loopClusterKey = loopClusterKey;
    if (threadEvidence !== "none" && deterministicThreadSignature)
        enriched.threadDeterministicSignature = deterministicThreadSignature;
    enriched.threadEvidence = threadEvidence;
    if (!normalizeText(enriched.loopState) && inferredLoopState)
        enriched.loopState = inferredLoopState;
    if (tickets.length > 0)
        enriched.mentionedTickets = tickets;
    if (urls.length > 0)
        enriched.mentionedUrls = urls;
    if (topicTokens.length > 0)
        enriched.topicTokens = topicTokens;
    enriched.patternHints = Array.from(patternHints).slice(0, 96);
    enriched.entityHints = Array.from(entityHints).slice(0, 96);
    enriched.contextSignals = contextSignals;
    enriched.messageStructure = messageStructure;
    enriched.structureSignalCount = Math.max(Number(enriched.structureSignalCount ?? 0) || 0, structureSignalCount);
    enriched.threadDepthEstimate = Math.max(1, threadDepthEstimate);
    enriched.threadReconstructionSignals = {
        deterministicSignature: deterministicThreadSignature || null,
        messageIdCount: normalizedMessageId ? 1 : 0,
        replyReferenceCount: referenceMessageIds.length + (inReplyToNormalized ? 1 : 0),
        participantCount: participantEmails.length,
        hasLinkableMessagePath: Boolean(normalizedMessageId && (inReplyToNormalized || referenceMessageIds.length > 0)),
    };
    enriched.emailSignalSummary = {
        participantCount: participantEmails.length,
        domainCount: participantDomains.length,
        referenceCount: referenceMessageIds.length,
        threadDepthEstimate: Math.max(1, threadDepthEstimate),
        hasReplyTo: Boolean(inReplyToNormalized),
        hasMessageId: Boolean(normalizedMessageId),
        inferredLoopState: inferredLoopState ?? null,
        sourceFamily: isEmailLike ? "mail" : "generic",
        threadEvidence,
    };
    return enriched;
}
function sanitizeStringList(values) {
    if (!Array.isArray(values))
        return [];
    return values.map((value) => normalizeSource(value)).filter(Boolean);
}
function applyDreamDefaultSourceDenylist(allowlist, denylist) {
    const merged = new Set(denylist);
    if (!allowlist.includes(MEMORY_CONSOLIDATION_PROMOTION_CANDIDATE_SOURCE)) {
        merged.add(MEMORY_CONSOLIDATION_PROMOTION_CANDIDATE_SOURCE);
    }
    return Array.from(merged.values()).sort((left, right) => left.localeCompare(right));
}
function normalizeEntityType(value) {
    return String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9:_-]+/g, "-")
        .replace(/-+/g, "-")
        .slice(0, 48);
}
function normalizeEntityKey(value) {
    return String(value ?? "").trim().toLowerCase().slice(0, 160);
}
function normalizePatternType(value) {
    return String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9:_-]+/g, "-")
        .replace(/-+/g, "-")
        .slice(0, 48);
}
function normalizePatternKey(value) {
    return String(value ?? "").trim().toLowerCase().slice(0, 180);
}
function tokenSetOverlapScore(left, right) {
    const leftSet = new Set(Array.from(left).map((value) => normalizeText(value).toLowerCase()).filter(Boolean));
    const rightSet = new Set(Array.from(right).map((value) => normalizeText(value).toLowerCase()).filter(Boolean));
    if (!leftSet.size || !rightSet.size)
        return 0;
    let intersect = 0;
    for (const token of leftSet) {
        if (rightSet.has(token))
            intersect += 1;
    }
    if (!intersect)
        return 0;
    const union = leftSet.size + rightSet.size - intersect;
    return union > 0 ? intersect / union : 0;
}
function looksLikeMemoryId(value) {
    if (!value || value.length < 8 || value.length > 128)
        return false;
    if (/\s/.test(value))
        return false;
    if (/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(value))
        return false;
    if (/^<[^>]+>$/.test(value))
        return false;
    if (/^(mem_|mail:|codex|ctx_|context-|timeline-|agent:|msg_|thread:|evt_)/i.test(value))
        return true;
    if (/^[a-f0-9]{16,}$/i.test(value))
        return true;
    if (/^[a-z0-9_-]+:[a-z0-9_-]{8,}$/i.test(value))
        return true;
    return false;
}
function readStringValues(value, max = 64) {
    const output = [];
    const push = (entry) => {
        if (output.length >= max)
            return;
        if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") {
            const normalized = String(entry).trim();
            if (normalized.length > 0)
                output.push(normalized);
            return;
        }
        if (Array.isArray(entry)) {
            for (const nested of entry) {
                push(nested);
                if (output.length >= max)
                    break;
            }
            return;
        }
        if (entry && typeof entry === "object") {
            const obj = entry;
            for (const key of ["id", "memoryId", "value", "key", "name", "email", "address"]) {
                if (key in obj) {
                    push(obj[key]);
                }
            }
        }
    };
    push(value);
    return output;
}
function appendEntity(entities, seen, entityType, entityKeyRaw, entityValueRaw, confidence) {
    if (entities.length >= ENTITY_INDEX_LIMIT)
        return;
    const entityTypeNormalized = normalizeEntityType(entityType);
    const entityKey = normalizeEntityKey(entityKeyRaw);
    const entityValue = String(entityValueRaw ?? "").trim().slice(0, 240);
    if (!entityTypeNormalized || !entityKey || !entityValue)
        return;
    const dedupe = `${entityTypeNormalized}|${entityKey}`;
    if (seen.has(dedupe))
        return;
    seen.add(dedupe);
    entities.push({
        entityType: entityTypeNormalized,
        entityKey,
        entityValue,
        confidence: clamp01(confidence, 0.55),
    });
}
function appendPattern(patterns, seen, patternTypeRaw, patternKeyRaw, patternValueRaw, confidence) {
    if (patterns.length >= ENTITY_INDEX_LIMIT)
        return;
    const patternType = normalizePatternType(patternTypeRaw);
    const patternKey = normalizePatternKey(patternKeyRaw);
    const patternValue = String(patternValueRaw ?? "").trim().slice(0, 240);
    if (!patternType || !patternKey || !patternValue)
        return;
    const dedupe = `${patternType}|${patternKey}`;
    if (seen.has(dedupe))
        return;
    seen.add(dedupe);
    patterns.push({
        patternType,
        patternKey,
        patternValue,
        confidence: clamp01(confidence, 0.55),
    });
}
function appendEdge(edges, seen, sourceId, targetIdRaw, relationTypeRaw, weight, evidence) {
    if (edges.length >= GRAPH_RELATION_LIMIT)
        return;
    const targetId = String(targetIdRaw ?? "").trim();
    if (!targetId || targetId === sourceId)
        return;
    if (!looksLikeMemoryId(targetId))
        return;
    const relationType = normalizeEntityType(relationTypeRaw) || "related";
    const dedupe = `${targetId}|${relationType}`;
    if (seen.has(dedupe))
        return;
    seen.add(dedupe);
    edges.push({
        targetId,
        relationType,
        weight: clamp01(weight, 0.55),
        evidence: evidence ?? {},
    });
}
function extractQueryEntityHints(query) {
    const text = String(query ?? "").trim();
    if (!text)
        return [];
    const hints = [];
    const seen = new Set();
    const addHint = (entityType, key, weight) => {
        const normalizedType = normalizeEntityType(entityType);
        const normalizedKey = normalizeEntityKey(key);
        if (!normalizedType || !normalizedKey)
            return;
        const dedupe = `${normalizedType}|${normalizedKey}`;
        if (seen.has(dedupe))
            return;
        seen.add(dedupe);
        hints.push({
            entityType: normalizedType,
            entityKey: normalizedKey,
            weight: clamp01(weight, 0.6),
        });
    };
    for (const email of text.match(EMAIL_PATTERN) || []) {
        addHint("email", email, 1);
        const domain = email.split("@")[1] || "";
        if (domain)
            addHint("domain", domain, 0.7);
    }
    for (const url of text.match(URL_PATTERN) || []) {
        addHint("url", url.toLowerCase(), 0.8);
    }
    for (const ticket of text.match(TICKET_PATTERN) || []) {
        addHint("ticket", ticket, 0.78);
    }
    for (const msgId of text.match(MESSAGE_ID_PATTERN) || []) {
        const normalized = toMessageReferenceToken(msgId);
        if (!normalized)
            continue;
        addHint("message-id", normalized, 0.82);
    }
    for (const dateToken of text.match(DATE_PATTERN) || []) {
        const parsed = Date.parse(dateToken);
        if (Number.isFinite(parsed)) {
            addHint("date", new Date(parsed).toISOString().slice(0, 10), 0.5);
        }
    }
    for (const token of text
        .toLowerCase()
        .split(/\s+/)
        .map((entry) => entry.replace(/[^a-z0-9._:@/-]+/g, "").trim())
        .filter((entry) => entry.length >= 10)
        .slice(0, 12)) {
        if (token.includes("@"))
            continue;
        if (token.startsWith("http"))
            continue;
        addHint("token", token, 0.42);
    }
    return hints.slice(0, 24);
}
function extractQueryPatternHints(query) {
    const text = String(query ?? "").trim();
    if (!text)
        return [];
    const hints = [];
    const seen = new Set();
    const addHint = (patternType, patternKey, weight) => {
        const normalizedType = normalizePatternType(patternType);
        const normalizedKey = normalizePatternKey(patternKey);
        if (!normalizedType || !normalizedKey)
            return;
        const dedupe = `${normalizedType}|${normalizedKey}`;
        if (seen.has(dedupe))
            return;
        seen.add(dedupe);
        hints.push({
            patternType: normalizedType,
            patternKey: normalizedKey,
            weight: clamp01(weight, 0.62),
        });
    };
    const signals = parseQuerySignals(text);
    if (signals.decision)
        addHint("intent", "decision", 0.9);
    if (signals.action)
        addHint("intent", "action", 0.82);
    if (signals.blocker)
        addHint("intent", "blocker", 0.88);
    if (signals.deadline)
        addHint("intent", "deadline", 0.8);
    if (signals.relationship)
        addHint("intent", "relationship", 0.72);
    if (signals.openLoop)
        addHint("state", "open-loop", 0.92);
    if (signals.resolved)
        addHint("state", "resolved", 0.88);
    if (signals.reopened)
        addHint("state", "reopened", 0.9);
    if (signals.superseded)
        addHint("state", "superseded", 0.86);
    if (signals.latest) {
        addHint("state", "superseded", 0.86);
        addHint("state", "resolved", 0.8);
        addHint("intent", "latest", 0.78);
    }
    if (/\b(urgent|asap|priority|p0|p1|sev1|sev2|incident)\b/.test(text.toLowerCase())) {
        addHint("priority", "urgent", 0.86);
    }
    if (/\b(roadmap|planning|strategy|quarter|q1|q2|q3|q4)\b/.test(text.toLowerCase())) {
        addHint("intent", "planning", 0.7);
    }
    if (/\b(full thread|entire thread|deep thread|thread depth|full history|long chain)\b/.test(text.toLowerCase())) {
        addHint("thread-depth", "deep", 0.78);
    }
    for (const ticket of text.match(TICKET_PATTERN) || []) {
        addHint("loop-cluster", `ticket:${ticket.toUpperCase()}`, 0.9);
    }
    for (const token of text
        .toLowerCase()
        .split(/\s+/)
        .map((entry) => entry.replace(/[^a-z0-9._:@/-]+/g, "").trim())
        .filter((entry) => entry.length >= 4)
        .slice(0, 16)) {
        addHint("topic", token, 0.45);
    }
    return hints.slice(0, 24);
}
function buildRelatedEntityHints(entities) {
    const allowTypes = new Set(["thread", "subject", "participants", "ticket", "email", "domain", "topic", "message-id", "date"]);
    const seen = new Set();
    const hints = [];
    for (const entity of entities) {
        if (!allowTypes.has(entity.entityType))
            continue;
        const key = `${entity.entityType}|${entity.entityKey}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        hints.push({
            entityType: entity.entityType,
            entityKey: entity.entityKey,
            weight: clamp01(entity.confidence, 0.58),
        });
        if (hints.length >= 24)
            break;
    }
    return hints;
}
function buildRelatedPatternHints(patterns) {
    const allowTypes = new Set([
        "state",
        "loop-cluster",
        "loop-state",
        "intent",
        "priority",
        "thread",
        "thread-depth",
        "structure",
        "topic",
    ]);
    const seen = new Set();
    const hints = [];
    for (const pattern of patterns) {
        if (!allowTypes.has(pattern.patternType))
            continue;
        const key = `${pattern.patternType}|${pattern.patternKey}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        hints.push({
            patternType: pattern.patternType,
            patternKey: pattern.patternKey,
            weight: clamp01(pattern.confidence, 0.62),
        });
        if (hints.length >= 24)
            break;
    }
    return hints;
}
function deriveSignalIndex(payload) {
    const entities = [];
    const entitySeen = new Set();
    const patterns = [];
    const patternSeen = new Set();
    const metadata = normalizeMetadata(payload.metadata);
    appendEntity(entities, entitySeen, "source", payload.source, payload.source, 0.6);
    for (const tag of payload.tags.slice(0, 24)) {
        appendEntity(entities, entitySeen, "tag", tag, tag, 0.55);
    }
    const threadKey = threadKeyFromMetadata(metadata);
    if (threadKey)
        appendEntity(entities, entitySeen, "thread", threadKey, threadKey, 0.9);
    if (threadKey)
        appendPattern(patterns, patternSeen, "thread", threadKey, threadKey, 0.88);
    const subjectKey = normalizeText(metadata.subjectKey || metadata.subject);
    if (subjectKey)
        appendEntity(entities, entitySeen, "subject", subjectKey, subjectKey, 0.7);
    if (subjectKey)
        appendPattern(patterns, patternSeen, "topic", subjectKey, subjectKey, 0.68);
    const participantKey = normalizeText(metadata.participantKey);
    if (participantKey)
        appendEntity(entities, entitySeen, "participants", participantKey, participantKey, 0.82);
    if (participantKey)
        appendPattern(patterns, patternSeen, "participants", participantKey, participantKey, 0.78);
    const loopClusterKey = loopClusterKeyFromMetadata(metadata);
    if (loopClusterKey)
        appendPattern(patterns, patternSeen, "loop-cluster", loopClusterKey, loopClusterKey, 0.92);
    const normalizedMessageId = normalizeMessageReferenceList([metadata.normalizedMessageId, metadata.messageId, metadata.rawMessageId], 1)[0] ?? "";
    if (normalizedMessageId)
        appendEntity(entities, entitySeen, "message-id", normalizedMessageId.toLowerCase(), normalizedMessageId, 0.86);
    const inReplyToNormalized = normalizeMessageReferenceList([metadata.inReplyToNormalized, metadata.inReplyTo], 1)[0] ?? "";
    if (inReplyToNormalized)
        appendEntity(entities, entitySeen, "message-ref", inReplyToNormalized.toLowerCase(), inReplyToNormalized, 0.8);
    for (const refMessageId of normalizeMessageReferenceList(metadata.referenceMessageIds, 32)) {
        appendEntity(entities, entitySeen, "message-ref", refMessageId.toLowerCase(), refMessageId, 0.76);
    }
    const ownerHint = normalizeText(metadata.owner || metadata.assignee || metadata.responsible);
    if (ownerHint)
        appendEntity(entities, entitySeen, "owner", ownerHint.toLowerCase(), ownerHint, 0.72);
    for (const domain of readStringValues(metadata.participantDomains, 24)) {
        appendEntity(entities, entitySeen, "domain", domain.toLowerCase(), domain, 0.74);
    }
    for (const ticket of readStringValues(metadata.mentionedTickets, 24)) {
        appendEntity(entities, entitySeen, "ticket", ticket.toUpperCase(), ticket, 0.8);
        appendPattern(patterns, patternSeen, "ticket", ticket.toUpperCase(), ticket, 0.76);
    }
    for (const url of readStringValues(metadata.mentionedUrls, 24)) {
        appendEntity(entities, entitySeen, "url", url.toLowerCase(), url, 0.76);
    }
    for (const token of readStringValues(metadata.topicTokens, 24)) {
        appendEntity(entities, entitySeen, "topic", token.toLowerCase(), token, 0.58);
        appendPattern(patterns, patternSeen, "topic", token.toLowerCase(), token, 0.62);
    }
    const fingerprint = normalizeText(metadata.fingerprint);
    if (fingerprint)
        appendEntity(entities, entitySeen, "fingerprint", fingerprint, fingerprint, 0.6);
    const peopleFields = [metadata.from, metadata.to, metadata.cc, metadata.bcc, metadata.participants];
    for (const value of peopleFields) {
        for (const candidate of readStringValues(value, 32)) {
            for (const email of candidate.match(EMAIL_PATTERN) || []) {
                appendEntity(entities, entitySeen, "email", email.toLowerCase(), email, 0.88);
                const domain = email.split("@")[1] || "";
                if (domain) {
                    appendEntity(entities, entitySeen, "domain", domain.toLowerCase(), domain, 0.72);
                }
            }
        }
    }
    const haystack = `${payload.content}\n${subjectKey}`.slice(0, 30_000);
    for (const email of haystack.match(EMAIL_PATTERN) || []) {
        appendEntity(entities, entitySeen, "email", email.toLowerCase(), email, 0.78);
    }
    for (const url of haystack.match(URL_PATTERN) || []) {
        appendEntity(entities, entitySeen, "url", url.toLowerCase(), url, 0.74);
    }
    for (const ticket of haystack.match(TICKET_PATTERN) || []) {
        appendEntity(entities, entitySeen, "ticket", ticket.toUpperCase(), ticket, 0.76);
        appendPattern(patterns, patternSeen, "ticket", ticket.toUpperCase(), ticket, 0.72);
    }
    for (const msgId of haystack.match(MESSAGE_ID_PATTERN) || []) {
        const normalized = toMessageReferenceToken(msgId);
        if (!normalized)
            continue;
        appendEntity(entities, entitySeen, "message-id", normalized, normalized, 0.8);
    }
    for (const dateToken of haystack.match(DATE_PATTERN) || []) {
        const parsed = Date.parse(dateToken);
        if (Number.isFinite(parsed)) {
            const isoDate = new Date(parsed).toISOString().slice(0, 10);
            appendEntity(entities, entitySeen, "date", isoDate, isoDate, 0.52);
            appendPattern(patterns, patternSeen, "date-anchor", isoDate, isoDate, 0.56);
        }
    }
    const contextSignals = normalizeMetadata(metadata.contextSignals);
    if (contextSignals.decisionLike === true)
        appendPattern(patterns, patternSeen, "intent", "decision", "decision", 0.9);
    if (contextSignals.actionLike === true)
        appendPattern(patterns, patternSeen, "intent", "action", "action", 0.84);
    if (contextSignals.blockerLike === true)
        appendPattern(patterns, patternSeen, "intent", "blocker", "blocker", 0.9);
    if (contextSignals.deadlineLike === true)
        appendPattern(patterns, patternSeen, "intent", "deadline", "deadline", 0.82);
    if (contextSignals.numericLike === true)
        appendPattern(patterns, patternSeen, "intent", "numeric", "numeric", 0.58);
    if (contextSignals.urgentLike === true)
        appendPattern(patterns, patternSeen, "priority", "urgent", "urgent", 0.9);
    if (contextSignals.reopenedLike === true)
        appendPattern(patterns, patternSeen, "state", "reopened", "reopened", 0.9);
    if (contextSignals.correctionLike === true)
        appendPattern(patterns, patternSeen, "state", "superseded", "superseded", 0.84);
    const openLoopLike = (contextSignals.actionLike === true || contextSignals.blockerLike === true) && contextSignals.decisionLike !== true;
    if (openLoopLike)
        appendPattern(patterns, patternSeen, "state", "open-loop", "open-loop", 0.9);
    const resolvedLike = contextSignals.decisionLike === true && contextSignals.blockerLike !== true;
    if (resolvedLike)
        appendPattern(patterns, patternSeen, "state", "resolved", "resolved", 0.82);
    if (loopClusterKey && (openLoopLike || resolvedLike)) {
        appendPattern(patterns, patternSeen, "loop-state", loopClusterKey, loopClusterKey, 0.88);
    }
    for (const hint of readStringValues(metadata.patternHints, 32)) {
        const normalized = String(hint).trim();
        if (!normalized)
            continue;
        const [hintType, hintKeyRaw] = normalized.includes(":")
            ? [normalized.split(":")[0], normalized.slice(normalized.indexOf(":") + 1)]
            : ["hint", normalized];
        const hintTypeNormalized = normalizePatternType(hintType);
        const hintKeyNormalized = normalizePatternKey(hintKeyRaw);
        if (!hintTypeNormalized || !hintKeyNormalized)
            continue;
        appendPattern(patterns, patternSeen, hintTypeNormalized, hintKeyNormalized, normalized, 0.72);
    }
    for (const temporalKey of readStringValues(metadata.temporalBuckets, 24)) {
        appendPattern(patterns, patternSeen, "time-bucket", temporalKey, temporalKey, 0.64);
    }
    const messageStructure = normalizeMetadata(metadata.messageStructure);
    const structureSignalCount = Number(metadata.structureSignalCount ?? 0);
    if (structureSignalCount >= 4) {
        appendPattern(patterns, patternSeen, "structure", "high-fidelity", "high-fidelity", 0.68);
    }
    else if (structureSignalCount >= 2) {
        appendPattern(patterns, patternSeen, "structure", "medium-fidelity", "medium-fidelity", 0.54);
    }
    if (messageStructure.hasReferences === true)
        appendPattern(patterns, patternSeen, "structure", "has-references", "has-references", 0.7);
    if (messageStructure.hasReplyTo === true)
        appendPattern(patterns, patternSeen, "structure", "has-replyto", "has-replyto", 0.66);
    if (messageStructure.hasThreadKey === true)
        appendPattern(patterns, patternSeen, "structure", "has-thread", "has-thread", 0.68);
    const threadDepthEstimate = Number(metadata.threadDepthEstimate ?? 0);
    if (Number.isFinite(threadDepthEstimate) && threadDepthEstimate > 0) {
        if (threadDepthEstimate >= 6)
            appendPattern(patterns, patternSeen, "thread-depth", "deep", "deep", 0.72);
        else if (threadDepthEstimate >= 2)
            appendPattern(patterns, patternSeen, "thread-depth", "mid", "mid", 0.62);
        else
            appendPattern(patterns, patternSeen, "thread-depth", "shallow", "shallow", 0.52);
    }
    const sourceLower = payload.source.toLowerCase();
    if (sourceLower.startsWith("mail:")) {
        appendPattern(patterns, patternSeen, "source-family", "mail", "mail", 0.74);
        appendPattern(patterns, patternSeen, "thread-channel", "email", "email", 0.72);
    }
    const textualSignals = parseQuerySignals(haystack);
    if (textualSignals.decision)
        appendPattern(patterns, patternSeen, "intent", "decision", "decision", 0.74);
    if (textualSignals.action)
        appendPattern(patterns, patternSeen, "intent", "action", "action", 0.72);
    if (textualSignals.blocker)
        appendPattern(patterns, patternSeen, "intent", "blocker", "blocker", 0.76);
    if (textualSignals.deadline)
        appendPattern(patterns, patternSeen, "intent", "deadline", "deadline", 0.68);
    if (textualSignals.reopened)
        appendPattern(patterns, patternSeen, "state", "reopened", "reopened", 0.72);
    if (textualSignals.superseded)
        appendPattern(patterns, patternSeen, "state", "superseded", "superseded", 0.68);
    const occurredAt = normalizeText(metadata.occurredAt || metadata.receivedAt || metadata.sentAt);
    const occurredMs = Number.isFinite(Date.parse(occurredAt)) ? Date.parse(occurredAt) : Number.NaN;
    if (Number.isFinite(occurredMs)) {
        const dayKey = new Date(occurredMs).toISOString().slice(0, 10);
        appendPattern(patterns, patternSeen, "time-day", dayKey, dayKey, 0.66);
    }
    const edges = [];
    const edgeSeen = new Set();
    const relationIds = extractRelationIds(metadata);
    for (const relationId of relationIds) {
        appendEdge(edges, edgeSeen, payload.memoryId, relationId, "related", 0.62, { via: "metadata" });
    }
    for (const relatedId of readStringValues(metadata.relatedMemoryIds, 32)) {
        appendEdge(edges, edgeSeen, payload.memoryId, relatedId, "related", 0.82, { via: "relatedMemoryIds" });
    }
    for (const parentId of readStringValues(metadata.parentMemoryId || metadata.parentId, 8)) {
        appendEdge(edges, edgeSeen, payload.memoryId, parentId, "parent", 0.88, { via: "parent" });
    }
    for (const replyId of readStringValues(metadata.inReplyToMemoryId || metadata.replyToMemoryId, 8)) {
        appendEdge(edges, edgeSeen, payload.memoryId, replyId, "reply-to", 0.9, { via: "reply" });
    }
    for (const threadId of readStringValues(metadata.threadRootMemoryId || metadata.rootMemoryId, 8)) {
        appendEdge(edges, edgeSeen, payload.memoryId, threadId, "thread-root", 0.84, { via: "thread-root" });
    }
    for (const targetId of readStringValues(metadata.resolvesMemoryIds || metadata.resolves, 16)) {
        appendEdge(edges, edgeSeen, payload.memoryId, targetId, "resolves", 0.92, { via: "resolves" });
    }
    for (const targetId of readStringValues(metadata.reopensMemoryIds || metadata.reopens, 16)) {
        appendEdge(edges, edgeSeen, payload.memoryId, targetId, "reopens", 0.88, { via: "reopens" });
    }
    for (const targetId of readStringValues(metadata.supersedesMemoryIds || metadata.supersedes, 16)) {
        appendEdge(edges, edgeSeen, payload.memoryId, targetId, "supersedes", 0.86, { via: "supersedes" });
    }
    return {
        tenantId: payload.tenantId,
        memoryId: payload.memoryId,
        edges,
        entities,
        patterns,
    };
}
function normalizeRelatedResultWeight(hit) {
    if (!hit)
        return { graphBoost: 0, entityBoost: 0, patternBoost: 0 };
    return {
        graphBoost: Math.min(0.26, Math.max(0, hit.graphScore) * 0.22),
        entityBoost: Math.min(0.22, Math.max(0, hit.entityScore) * 0.18),
        patternBoost: Math.min(0.2, Math.max(0, hit.patternScore) * 0.17),
    };
}
function addRelationIds(value, ids) {
    if (!value)
        return;
    if (typeof value === "string") {
        const normalized = normalizeText(value);
        if (normalized)
            ids.add(normalized);
        return;
    }
    if (Array.isArray(value)) {
        for (const entry of value) {
            addRelationIds(entry, ids);
        }
        return;
    }
    if (typeof value === "object") {
        const obj = normalizeMetadata(value);
        const keys = [
            "id",
            "memoryId",
            "targetId",
            "sourceId",
            "relatedTo",
            "referenceId",
            "refId",
            "parentId",
            "parentMemoryId",
            "childId",
            "childMemoryId",
            "messageId",
            "message_id",
            "replyTo",
            "inReplyTo",
        ];
        for (const key of keys) {
            addRelationIds(obj[key], ids);
        }
        addRelationIds(obj.relations, ids);
        addRelationIds(obj.relationships, ids);
        addRelationIds(obj.related, ids);
        addRelationIds(obj.references, ids);
        addRelationIds(obj.referenceIds, ids);
    }
}
function extractRelationIds(metadata) {
    const ids = new Set();
    const singleKeys = [
        "relatedMemoryId",
        "relatedMemory",
        "threadRootMemoryId",
        "parentMemoryId",
        "referenceId",
        "replyTo",
        "inReplyTo",
        "messageReference",
        "linkedMemoryId",
    ];
    const listKeys = [
        "relatedMemoryIds",
        "relatedMemoryIdList",
        "relatedIds",
        "references",
        "referenceIds",
        "relationIds",
        "relatedMessages",
    ];
    for (const key of singleKeys) {
        addRelationIds(metadata[key], ids);
    }
    for (const key of listKeys) {
        addRelationIds(metadata[key], ids);
    }
    return Array.from(ids).filter((value) => value.length > 0 && value.length <= 128);
}
function metadataHasThreadSignals(metadata) {
    const messageStructure = normalizeMetadata(metadata.messageStructure);
    if (messageStructure.hasMessageId === true ||
        messageStructure.hasReplyTo === true ||
        messageStructure.hasReferences === true) {
        return true;
    }
    const normalizedMessageId = normalizeMessageReferenceList([metadata.normalizedMessageId, metadata.messageId, metadata.rawMessageId], 1)[0] ?? "";
    if (normalizedMessageId)
        return true;
    return normalizeMessageReferenceList([metadata.referenceMessageIds, metadata.inReplyToNormalized, metadata.inReplyTo, metadata.replyTo, metadata.references], 2).length > 0;
}
function normalizeThreadEvidence(metadata) {
    const explicit = normalizeText(metadata.threadEvidence);
    if (explicit === "explicit" || explicit === "derived" || explicit === "none") {
        return explicit;
    }
    const emailSignalSummary = normalizeMetadata(metadata.emailSignalSummary);
    const sourceFamily = normalizeText(emailSignalSummary.sourceFamily) ||
        normalizeText(normalizeMetadata(metadata.messageStructure).sourceFamily) ||
        normalizeText(metadata.sourceFamily);
    if (sourceFamily === "mail" || metadataHasThreadSignals(metadata)) {
        return "derived";
    }
    return "none";
}
function threadRelationshipsAllowed(metadata) {
    const evidence = normalizeThreadEvidence(metadata);
    if (evidence === "explicit")
        return true;
    if (evidence !== "derived")
        return false;
    const emailSignalSummary = normalizeMetadata(metadata.emailSignalSummary);
    const sourceFamily = normalizeText(emailSignalSummary.sourceFamily) ||
        normalizeText(normalizeMetadata(metadata.messageStructure).sourceFamily) ||
        normalizeText(metadata.sourceFamily);
    return sourceFamily === "mail" || metadataHasThreadSignals(metadata);
}
function threadKeyFromMetadata(metadata) {
    if (!threadRelationshipsAllowed(metadata))
        return "";
    return (normalizeText(metadata.threadKey) ||
        normalizeText(metadata.thread) ||
        normalizeText(metadata.thread_id) ||
        normalizeText(metadata.conversationId));
}
function loopClusterKeyFromMetadata(metadata) {
    if (!threadRelationshipsAllowed(metadata))
        return "";
    return normalizeText(metadata.loopClusterKey);
}
function isMailLikeThreadSource(source, metadata) {
    const normalized = normalizeSource(source);
    if (normalized.startsWith("mail:") || normalized.includes("email") || normalized.startsWith("message-signal:")) {
        return true;
    }
    const emailSignalSummary = normalizeMetadata(metadata.emailSignalSummary);
    const sourceFamily = normalizeText(emailSignalSummary.sourceFamily) ||
        normalizeText(normalizeMetadata(metadata.messageStructure).sourceFamily) ||
        normalizeText(metadata.sourceFamily);
    return sourceFamily === "mail";
}
function isThreadEntityHint(value) {
    const normalized = normalizeText(value);
    return normalized.startsWith("thread:") || normalized.startsWith("thread-signature:");
}
function isThreadPatternHint(value) {
    const normalized = normalizeText(value);
    return (normalized === "structure:has-thread" ||
        normalized === "thread:shallow" ||
        normalized.startsWith("thread:") ||
        normalized.startsWith("thread-signature:") ||
        normalized.startsWith("loop-cluster:") ||
        normalized.startsWith("loop-state:") ||
        normalized.startsWith("loop:thread:"));
}
function scrubThreadMetadata(metadata) {
    const before = normalizeMetadata(metadata);
    const beforeThreadKey = normalizeText(before.threadKey) || null;
    const beforeLoopClusterKey = normalizeText(before.loopClusterKey) || null;
    const beforeThreadSignature = normalizeText(before.threadDeterministicSignature);
    const beforeThreadEvidence = normalizeThreadEvidence(before);
    const entityHints = readStringValues(before.entityHints, 128);
    const patternHints = readStringValues(before.patternHints, 192);
    const hadThreadHints = entityHints.some(isThreadEntityHint) || patternHints.some(isThreadPatternHint);
    const hadThreadArtifacts = Boolean(beforeThreadKey || beforeLoopClusterKey || beforeThreadSignature || hadThreadHints);
    const hasUnknownThreadKey = (beforeThreadKey?.includes("mail-thread:unknown") ?? false) ||
        (beforeThreadKey?.endsWith(":unknown") ?? false) ||
        (beforeLoopClusterKey?.includes("mail-thread:unknown") ?? false) ||
        (beforeLoopClusterKey?.endsWith(":unknown") ?? false);
    const relationshipsAllowed = threadRelationshipsAllowed(before);
    if (!hadThreadArtifacts || (beforeThreadEvidence === "explicit" && !hasUnknownThreadKey) || (relationshipsAllowed && !hasUnknownThreadKey)) {
        return {
            changed: false,
            reason: "",
            metadata: before,
            beforeThreadKey,
            afterThreadKey: beforeThreadKey,
            beforeLoopClusterKey,
            afterLoopClusterKey: beforeLoopClusterKey,
            beforeThreadEvidence,
            afterThreadEvidence: beforeThreadEvidence,
        };
    }
    const next = { ...before };
    delete next.threadKey;
    delete next.thread;
    delete next.thread_id;
    delete next.loopClusterKey;
    delete next.threadDeterministicSignature;
    next.threadEvidence = "none";
    const filteredEntityHints = entityHints.filter((value) => !isThreadEntityHint(value));
    if (filteredEntityHints.length > 0)
        next.entityHints = filteredEntityHints;
    else
        delete next.entityHints;
    const filteredPatternHints = patternHints.filter((value) => !isThreadPatternHint(value));
    if (filteredPatternHints.length > 0)
        next.patternHints = filteredPatternHints;
    else
        delete next.patternHints;
    const workstreamKey = normalizeText(next.workstreamKey);
    if (workstreamKey.startsWith("thread:")) {
        delete next.workstreamKey;
    }
    const messageStructure = normalizeMetadata(next.messageStructure);
    if (Object.keys(messageStructure).length > 0) {
        messageStructure.hasThreadKey = false;
        messageStructure.threadEvidence = "none";
        if (messageStructure.sourceFamily === "mail" && !metadataHasThreadSignals(before)) {
            messageStructure.sourceFamily = "generic";
        }
        next.messageStructure = messageStructure;
    }
    const threadSignals = normalizeMetadata(next.threadReconstructionSignals);
    if (Object.keys(threadSignals).length > 0) {
        threadSignals.deterministicSignature = "";
        threadSignals.hasLinkableMessagePath = false;
        if (!metadataHasThreadSignals(before)) {
            threadSignals.messageIdCount = 0;
            threadSignals.replyReferenceCount = 0;
            threadSignals.participantCount = 0;
        }
        next.threadReconstructionSignals = threadSignals;
    }
    const after = normalizeMetadata(next);
    const afterThreadEvidence = normalizeThreadEvidence(after);
    const reasons = [];
    if (hasUnknownThreadKey)
        reasons.push("unknown-thread-key");
    if (!relationshipsAllowed)
        reasons.push("unsupported-thread-source");
    if (beforeThreadSignature)
        reasons.push("thread-signature");
    if (hadThreadHints)
        reasons.push("thread-hints");
    if (workstreamKey.startsWith("thread:"))
        reasons.push("thread-workstream");
    return {
        changed: stableStringify(before) !== stableStringify(after),
        reason: reasons.join(",") || "synthetic-thread-metadata",
        metadata: after,
        beforeThreadKey,
        afterThreadKey: normalizeText(after.threadKey) || null,
        beforeLoopClusterKey,
        afterLoopClusterKey: normalizeText(after.loopClusterKey) || null,
        beforeThreadEvidence,
        afterThreadEvidence,
    };
}
function halfLifeDays(memoryType) {
    if (memoryType === "working")
        return 3;
    if (memoryType === "episodic")
        return 30;
    if (memoryType === "semantic")
        return 180;
    return 365;
}
function recencyScore(occurredAt, createdAt, memoryType, anchorMs = Date.now()) {
    const timestamp = Date.parse(occurredAt || createdAt);
    if (!Number.isFinite(timestamp))
        return 0.5;
    const ageMs = Math.max(0, anchorMs - timestamp);
    const ageDays = ageMs / 86_400_000;
    return Math.exp(-ageDays / halfLifeDays(memoryType));
}
function sourceAllowed(source, allowlist, denylist) {
    const normalized = normalizeSource(source);
    if (allowlist.length > 0 && !allowlist.includes(normalized))
        return false;
    if (denylist.length > 0 && denylist.includes(normalized))
        return false;
    return true;
}
function classifyStatus(source, content) {
    const normalizedSource = normalizeSource(source);
    if (!content.trim())
        return "quarantined";
    if (normalizedSource.includes("chatgpt-export") || normalizedSource.includes("memory-pack"))
        return "proposed";
    if (normalizedSource.includes("import-context-slice"))
        return "proposed";
    if (normalizedSource.includes("user-direct"))
        return "accepted";
    if (normalizedSource.includes("codex-resumable-session"))
        return "accepted";
    if (normalizedSource.includes("codex-history-export"))
        return "accepted";
    if (normalizedSource.includes("repo-markdown"))
        return "accepted";
    return "proposed";
}
function normalizeStatus(value, source, content) {
    const raw = String(value ?? "").trim().toLowerCase();
    if (raw === "accepted" || raw === "quarantined" || raw === "archived" || raw === "proposed") {
        return raw;
    }
    return classifyStatus(source, content);
}
function normalizeMemoryType(value) {
    const raw = String(value ?? "").trim().toLowerCase();
    if (raw === "working" || raw === "semantic" || raw === "procedural" || raw === "episodic") {
        return raw;
    }
    return "episodic";
}
function inferImportance(tags, metadata) {
    const normalizedTags = tags.map((tag) => normalizeSource(tag));
    if (normalizedTags.some((tag) => tag.includes("critical") || tag.includes("decision") || tag.includes("blocker"))) {
        return 0.9;
    }
    if (typeof metadata.importance === "number") {
        return clamp01(metadata.importance);
    }
    return 0.5;
}
function shouldDefaultAcceptedEpisodic(input) {
    if (input.statusProvided)
        return false;
    if (isPseudoDecisionTrace({ source: input.source, content: input.content, metadata: input.metadata }))
        return false;
    const hints = [
        normalizeSource(input.source),
        ...input.tags.map((tag) => normalizeSource(tag)),
        normalizeSource(String(input.metadata.kind ?? "")),
        normalizeSource(String(input.metadata.type ?? "")),
        normalizeSource(String(input.metadata.memoryKind ?? "")),
        normalizeSource(String(input.metadata.rememberKind ?? "")),
        normalizeSource(String(input.metadata.codexTraceKind ?? "")),
    ].filter(Boolean);
    if (hints.some((value) => [
        "decision",
        "checkpoint",
        "handoff",
        "blocker",
        "progress",
        "thought",
        "finding",
        "action",
        "open_loop",
        "open-loop",
        "codex-trace",
    ].some((hint) => value.includes(hint)))) {
        return true;
    }
    return /\b(decision|checkpoint|handoff|blocker|resolved blocker|progress update|next action|open loop|open-loop|finding)\b/i.test(input.content);
}
function buildContextualizedContent(payload) {
    const metadata = normalizeMetadata(payload.metadata);
    const threadKey = threadKeyFromMetadata(metadata);
    const subject = normalizeText(metadata.subject);
    const from = normalizeText(metadata.from);
    const participantKey = normalizeText(metadata.participantKey);
    const loopClusterKey = loopClusterKeyFromMetadata(metadata);
    const loopState = normalizeText(metadata.loopState);
    const contextSignals = normalizeMetadata(metadata.contextSignals);
    const signalKeys = Object.entries(contextSignals)
        .filter(([, value]) => value === true)
        .map(([key]) => key)
        .slice(0, 8);
    const parts = [
        `source=${payload.source}`,
        `agent=${payload.agentId}`,
        `run=${payload.runId}`,
        threadKey ? `thread=${threadKey}` : "",
        subject ? `subject=${subject}` : "",
        from ? `from=${from}` : "",
        participantKey ? `participants=${participantKey}` : "",
        loopClusterKey ? `loop=${loopClusterKey}` : "",
        loopState ? `loopState=${loopState}` : "",
        signalKeys.length > 0 ? `signals=${signalKeys.join(",")}` : "",
        payload.tags.length ? `tags=${payload.tags.join(",")}` : "",
        payload.content.trim(),
    ].filter(Boolean);
    return parts.join("\n").slice(0, 20_000);
}
function buildFingerprint(payload) {
    return (0, node_crypto_1.createHash)("sha256")
        .update(`${payload.tenantId ?? "none"}|${payload.source}|${payload.tags.join(",")}|${payload.content}`)
        .digest("hex")
        .slice(0, 48);
}
function summarizeContextItems(items, maxChars = 480) {
    if (!items.length)
        return "";
    const lines = [];
    for (const [index, row] of items.entries()) {
        const metadata = normalizeMetadata(row.metadata);
        const hints = readStringValues(metadata.patternHints, 24).map((entry) => String(entry).toLowerCase());
        const flags = [];
        if (hints.some((entry) => entry.includes("state:open-loop")))
            flags.push("OPEN");
        if (hints.some((entry) => entry.includes("state:resolved")))
            flags.push("RESOLVED");
        if (hints.some((entry) => entry.includes("state:reopened")))
            flags.push("REOPENED");
        if (hints.some((entry) => entry.includes("state:superseded")))
            flags.push("SUPERSEDED");
        if (hints.some((entry) => entry.includes("priority:urgent")) || metadataFlag(metadata, "urgentLike"))
            flags.push("URGENT");
        const snippet = row.content.replace(/\s+/g, " ").trim().slice(0, 120);
        const prefix = flags.length > 0 ? `[${flags.join("|")}] ` : "";
        const line = `${index + 1}. ${prefix}[${row.source}] ${snippet}`;
        lines.push(line);
        const joined = lines.join("\n");
        if (joined.length >= maxChars) {
            return joined.slice(0, maxChars);
        }
    }
    return lines.join("\n");
}
function parseQuerySignals(query) {
    const text = query.toLowerCase();
    return {
        decision: /\b(decision|decide|approved|approval|final|confirmed|go\/no-go|go-no-go)\b/.test(text),
        action: /\b(action|todo|next step|follow up|follow-up|owner|task|assign)\b/.test(text),
        blocker: /\b(blocker|blocked|incident|outage|failure|bug|error|risk|escalat)\b/.test(text),
        deadline: /\b(deadline|due|eta|today|tomorrow|eod|eow|this week|date)\b/.test(text),
        relationship: /\b(thread|reply|conversation|context|history|chain)\b/.test(text),
        openLoop: /\b(open loop|open-loop|pending|unresolved|outstanding|still open|not done)\b/.test(text),
        resolved: /\b(resolved|closed|completed|fixed|done|shipped|landed)\b/.test(text),
        urgent: /\b(urgent|asap|priority|p0|p1|sev1|sev2|critical|incident)\b/.test(text),
        reopened: /\b(reopen|re-open|opened again|back again|regression|recurred)\b/.test(text),
        superseded: /\b(supersede|superseded|supersedes|correction|ignore previous|latest update)\b/.test(text),
        latest: /\b(latest|most recent|current status|what changed|latest update|right now|as of now)\b/.test(text),
        stuck: /\b(stuck|stalled|aging|old open|long[- ]running|lingering|still blocked)\b/.test(text),
        volatile: /\b(churn|flap|flapping|thrash|volatile|changing quickly|keeps changing|unstable)\b/.test(text),
        spread: /\b(spread|blast radius|cross[- ]team|many teams|org[- ]wide|systemic|everyone)\b/.test(text),
    };
}
function inferProjectLaneFromQuery(query) {
    const text = query.toLowerCase();
    if (/\bstudio brain\b|\bstudio-brain\b|\bopen memory\b|\bmemory service\b/.test(text))
        return "studio-brain";
    if (/\bcloud functions\b|\bfirestore\b|\bfunctions?\b/.test(text))
        return "functions";
    if (/\bwebsite\b|\bseo\b|\bga\b|\bmonsoonfire\.com\b/.test(text))
        return "website";
    if (/\bportal\b|\bmonsoonfire\b|\breservations\b|\bkiln\b|\bmaterials\b/.test(text))
        return "monsoonfire-portal";
    if (/\breal estate\b|\bzillow\b|\bphoenix\b|\bwest valley\b/.test(text))
        return "real-estate";
    return "";
}
function readProjectLaneFromMetadata(row) {
    const metadata = normalizeMetadata(row.metadata);
    const sourceMetadata = normalizeMetadata(metadata.sourceMetadata);
    return normalizeText(sourceMetadata.projectLane || metadata.projectLane || metadata.lane || metadata.signalLane || "");
}
function queryLooksProjectScoped(query) {
    const text = query.toLowerCase();
    return (Boolean(inferProjectLaneFromQuery(query)) ||
        /\b(codex|repo|repository|markdown|sqlite|corpus|memory|session|ticket|issue|pr|deploy|firebase|runbook)\b/.test(text));
}
function computeProjectLaneBoost(row, query) {
    const metadata = normalizeMetadata(row.metadata);
    const queryLane = inferProjectLaneFromQuery(query);
    const queryScoped = queryLooksProjectScoped(query);
    if (!queryLane && !queryScoped)
        return 0;
    const rowLane = readProjectLaneFromMetadata(row);
    const source = normalizeSource(row.source);
    const isMail = source.startsWith("mail:");
    const hasCorpusPointer = Boolean(normalizeText(metadata.corpusRecordId) ||
        normalizeText(metadata.corpusSourceUnitId) ||
        normalizeText(metadata.corpusManifestPath));
    const recency = recencyScore(row.occurredAt, row.createdAt, row.memoryType);
    let boost = 0;
    if (queryLane && rowLane) {
        if (rowLane === queryLane)
            boost += 0.14;
        else
            boost -= 0.08;
    }
    if (queryScoped && hasCorpusPointer)
        boost += 0.06;
    if (queryScoped && row.status === "accepted")
        boost += 0.03;
    if (queryScoped && source.includes("codex") && recency >= 0.55)
        boost += 0.04;
    if (queryScoped && isMail)
        boost -= 0.08;
    if (queryScoped && isMail && (!rowLane || rowLane === "unknown" || rowLane === "personal"))
        boost -= 0.08;
    return Math.min(0.24, Math.max(-0.18, boost));
}
function metadataFlag(metadata, key) {
    const contextSignals = normalizeMetadata(metadata.contextSignals);
    if (contextSignals[key] === true)
        return true;
    if (metadata[key] === true)
        return true;
    return false;
}
function computeSignalBoost(row, query) {
    const querySignals = parseQuerySignals(query);
    const metadata = normalizeMetadata(row.metadata);
    const statePatternHints = readStringValues(metadata.patternHints, 24).map((entry) => String(entry).toLowerCase());
    const isOpenLoop = statePatternHints.some((entry) => entry.includes("state:open-loop")) ||
        statePatternHints.some((entry) => entry.includes("state:reopened")) ||
        (metadataFlag(metadata, "actionLike") && !metadataFlag(metadata, "decisionLike")) ||
        (metadataFlag(metadata, "blockerLike") && !metadataFlag(metadata, "decisionLike"));
    const isReopened = statePatternHints.some((entry) => entry.includes("state:reopened")) || metadataFlag(metadata, "reopenedLike");
    const isResolved = statePatternHints.some((entry) => entry.includes("state:resolved")) ||
        statePatternHints.some((entry) => entry.includes("intent:decision")) ||
        (metadataFlag(metadata, "decisionLike") && !metadataFlag(metadata, "blockerLike"));
    const isSuperseded = statePatternHints.some((entry) => entry.includes("state:superseded")) || metadataFlag(metadata, "correctionLike");
    const threadDepthEstimate = Math.max(0, Number(metadata.threadDepthEstimate ?? 0));
    const referenceDepth = readStringValues(metadata.referenceMessageIds, 48).length +
        (normalizeText(metadata.inReplyToNormalized || metadata.inReplyTo) ? 1 : 0);
    const participantDomains = readStringValues(metadata.participantDomains, 24);
    const participantCount = Math.max(readStringValues(metadata.participants, 48).length, readStringTokens(metadata.participantKey, 24).length);
    const emailSummary = normalizeMetadata(metadata.emailSignalSummary);
    const emailThreadDepth = Math.max(threadDepthEstimate, Number.isFinite(Number(emailSummary.threadDepthEstimate ?? 0)) ? Number(emailSummary.threadDepthEstimate ?? 0) : 0);
    let boost = 0;
    if (querySignals.decision && metadataFlag(metadata, "decisionLike"))
        boost += 0.08;
    if (querySignals.action && metadataFlag(metadata, "actionLike"))
        boost += 0.06;
    if (querySignals.blocker && metadataFlag(metadata, "blockerLike"))
        boost += 0.08;
    if (querySignals.deadline && metadataFlag(metadata, "deadlineLike"))
        boost += 0.05;
    if (querySignals.urgent && (metadataFlag(metadata, "urgentLike") || statePatternHints.some((entry) => entry.includes("priority:urgent")))) {
        boost += 0.09;
    }
    if (querySignals.openLoop) {
        if (isOpenLoop)
            boost += 0.1;
        if (isResolved)
            boost -= 0.04;
        if (isSuperseded)
            boost += 0.03;
        const recency = recencyScore(row.occurredAt, row.createdAt, row.memoryType);
        if (isResolved && recency < 0.35)
            boost -= 0.03;
    }
    if (querySignals.stuck) {
        if (isOpenLoop)
            boost += 0.1;
        if (isReopened)
            boost += 0.04;
        if (isResolved)
            boost -= 0.04;
    }
    if (querySignals.volatile) {
        if (isReopened || isSuperseded)
            boost += 0.08;
        if (isResolved && !isReopened)
            boost -= 0.01;
    }
    if (querySignals.spread) {
        const participantKey = normalizeText(metadata.participantKey);
        const hasManyParticipants = readStringValues(metadata.participants, 24).length >= 3 ||
            participantKey.includes(",") ||
            participantKey.includes("|");
        if (hasManyParticipants)
            boost += 0.07;
        if (threadKeyFromMetadata(metadata))
            boost += 0.04;
        if (participantDomains.length >= 2)
            boost += Math.min(0.06, participantDomains.length * 0.018);
        if (participantCount >= 5)
            boost += Math.min(0.06, participantCount * 0.01);
    }
    if (querySignals.resolved) {
        if (isResolved)
            boost += 0.08;
        if (isOpenLoop)
            boost -= 0.03;
        if (isSuperseded)
            boost -= 0.02;
        const recency = recencyScore(row.occurredAt, row.createdAt, row.memoryType);
        if (isResolved && recency >= 0.65)
            boost += 0.02;
    }
    if (querySignals.reopened) {
        if (isReopened)
            boost += 0.11;
        if (isResolved)
            boost -= 0.03;
    }
    if (querySignals.superseded) {
        if (isSuperseded)
            boost += 0.1;
        if (isResolved && !isSuperseded)
            boost -= 0.02;
    }
    if (querySignals.latest) {
        const recency = recencyScore(row.occurredAt, row.createdAt, row.memoryType);
        boost += 0.05 * recency;
        if (isSuperseded)
            boost += 0.06;
        if (isResolved)
            boost += 0.04;
        if (isOpenLoop && recency < 0.2)
            boost -= 0.03;
        if (emailThreadDepth >= 3)
            boost += Math.min(0.04, emailThreadDepth * 0.007);
    }
    if (querySignals.relationship) {
        const hasThread = threadKeyFromMetadata(metadata) ||
            normalizeText(metadata.conversationId) ||
            normalizeText(metadata.inReplyTo) ||
            normalizeText(metadata.references);
        if (hasThread)
            boost += 0.05;
        if (referenceDepth > 0)
            boost += Math.min(0.06, referenceDepth * 0.012);
        if (emailThreadDepth >= 2)
            boost += Math.min(0.05, emailThreadDepth * 0.01);
    }
    if (querySignals.openLoop && metadataFlag(metadata, "reopenedLike")) {
        boost += 0.05;
    }
    return Math.min(0.28, Math.max(-0.08, boost));
}
function applySignalBoost(rows, query) {
    return rows
        .map((row) => {
        const signalBoost = computeSignalBoost(row, query);
        const projectLaneBoost = computeProjectLaneBoost(row, query);
        const totalBoost = signalBoost + projectLaneBoost;
        if (totalBoost === 0)
            return row;
        const matchedBy = new Set(row.matchedBy);
        if (signalBoost > 0)
            matchedBy.add("signal");
        if (projectLaneBoost > 0)
            matchedBy.add("pattern");
        return {
            ...row,
            score: row.score + totalBoost,
            matchedBy: Array.from(matchedBy),
            scoreBreakdown: {
                ...row.scoreBreakdown,
                signal: (row.scoreBreakdown.signal ?? 0) + signalBoost,
                pattern: (row.scoreBreakdown.pattern ?? 0) + projectLaneBoost,
            },
        };
    })
        .sort((left, right) => right.score - left.score || right.createdAt.localeCompare(left.createdAt));
}
function applyRelatedBoost(row, hit) {
    const { graphBoost, entityBoost, patternBoost } = normalizeRelatedResultWeight(hit);
    if (graphBoost <= 0 && entityBoost <= 0 && patternBoost <= 0)
        return row;
    const matchedBy = new Set(row.matchedBy);
    if (graphBoost > 0)
        matchedBy.add("graph");
    if (entityBoost > 0)
        matchedBy.add("entity");
    if (patternBoost > 0)
        matchedBy.add("pattern");
    return {
        ...row,
        score: row.score + graphBoost + entityBoost + patternBoost,
        matchedBy: Array.from(matchedBy),
        scoreBreakdown: {
            ...row.scoreBreakdown,
            graph: (row.scoreBreakdown.graph ?? 0) + graphBoost,
            entity: (row.scoreBreakdown.entity ?? 0) + entityBoost,
            pattern: (row.scoreBreakdown.pattern ?? 0) + patternBoost,
        },
    };
}
function loopKeyFromRow(row) {
    const metadata = normalizeMetadata(row.metadata);
    return loopClusterKeyFromMetadata(metadata);
}
function applyLoopStateBoost(row, loopState, query) {
    if (!loopState)
        return row;
    const signals = parseQuerySignals(query);
    const state = String(loopState.currentState || "").toLowerCase();
    let boost = 0;
    const updatedMs = Date.parse(loopState.updatedAt || "");
    const ageDays = Number.isFinite(updatedMs) ? Math.max(0, Date.now() - updatedMs) / 86_400_000 : 0;
    const recentTransitions = Math.max(0, Number(loopState.recentTransitions7d ?? 0));
    const recentReopened = Math.max(0, Number(loopState.recentReopened7d ?? 0));
    const recentResolved = Math.max(0, Number(loopState.recentResolved7d ?? 0));
    const churnRatio = recentTransitions > 0 ? recentReopened / recentTransitions : 0;
    if (signals.openLoop && (state === "open-loop" || state === "reopened")) {
        boost += 0.1 * clamp01(loopState.confidence, 0.6);
        if (ageDays >= 7)
            boost += 0.03;
        if (ageDays >= 21)
            boost += 0.04;
    }
    if (signals.resolved && state === "resolved") {
        boost += 0.08 * clamp01(loopState.confidence, 0.6);
        if (recentResolved > 0)
            boost += Math.min(0.03, recentResolved * 0.008);
    }
    if (signals.reopened && state === "reopened") {
        boost += 0.1 * clamp01(loopState.confidence, 0.6);
        if (recentReopened > 0)
            boost += Math.min(0.04, recentReopened * 0.01);
    }
    if (signals.superseded && state === "superseded") {
        boost += 0.09 * clamp01(loopState.confidence, 0.6);
    }
    if (signals.latest) {
        const freshness = ageDays <= 1 ? 1 : ageDays <= 3 ? 0.8 : ageDays <= 7 ? 0.6 : ageDays <= 14 ? 0.4 : 0.2;
        boost += 0.05 * freshness;
        if (ageDays > 21)
            boost -= 0.02;
    }
    if (signals.urgent && (state === "open-loop" || state === "reopened")) {
        if (churnRatio >= 0.4)
            boost += 0.03;
        if (ageDays >= 5)
            boost += 0.02;
    }
    if (signals.openLoop && state === "resolved") {
        boost -= 0.03;
    }
    if (signals.resolved && (state === "open-loop" || state === "reopened")) {
        boost -= 0.02;
    }
    if (boost === 0)
        return row;
    const matchedBy = row.matchedBy.includes("pattern") ? row.matchedBy : [...row.matchedBy, "pattern"];
    return {
        ...row,
        score: row.score + boost,
        matchedBy,
        scoreBreakdown: {
            ...row.scoreBreakdown,
            pattern: (row.scoreBreakdown.pattern ?? 0) + boost,
        },
    };
}
function preferredLoopStatesForQuery(query) {
    const signals = parseQuerySignals(query);
    const preferred = [];
    const push = (state) => {
        if (!preferred.includes(state))
            preferred.push(state);
    };
    if (signals.openLoop) {
        push("open-loop");
        push("reopened");
    }
    if (signals.stuck) {
        push("open-loop");
        push("reopened");
    }
    if (signals.resolved) {
        push("resolved");
        push("superseded");
    }
    if (signals.volatile) {
        push("reopened");
        push("open-loop");
        push("superseded");
    }
    if (signals.spread) {
        push("reopened");
        push("open-loop");
    }
    if (signals.reopened) {
        push("reopened");
        push("open-loop");
    }
    if (signals.superseded) {
        push("superseded");
        push("resolved");
    }
    if (signals.latest) {
        push("superseded");
        push("resolved");
        push("reopened");
        push("open-loop");
    }
    return preferred;
}
function pointerMemoryIdForLoopState(loopState) {
    const state = String(loopState.currentState || "").toLowerCase();
    if (state === "open-loop" || state === "reopened") {
        return loopState.lastOpenMemoryId || loopState.lastMemoryId || null;
    }
    if (state === "resolved") {
        return loopState.lastResolvedMemoryId || loopState.lastMemoryId || null;
    }
    if (state === "superseded") {
        return loopState.lastMemoryId || loopState.lastResolvedMemoryId || null;
    }
    return loopState.lastMemoryId || null;
}
function classifyLoopAttentionLane(score, state, volatility, stagnationDays) {
    const isOpenLike = state === "open-loop" || state === "reopened";
    if ((isOpenLike && stagnationDays >= 9) || score >= 1.1 || volatility >= 0.72)
        return "critical";
    if (score >= 0.84 || (isOpenLike && (volatility >= 0.5 || stagnationDays >= 5)))
        return "high";
    if (score >= 0.54 || volatility >= 0.28)
        return "watch";
    return "stable";
}
function computeLoopAttention(loopState, query) {
    const reasons = [];
    const signals = parseQuerySignals(query);
    const state = String(loopState.currentState || "").toLowerCase();
    const confidence = clamp01(loopState.confidence, 0.6);
    const updatedMs = Date.parse(loopState.updatedAt || "");
    const ageDays = Number.isFinite(updatedMs) ? Math.max(0, Date.now() - updatedMs) / 86_400_000 : 0;
    const stagnationDays = state === "open-loop" || state === "reopened" ? ageDays : Math.max(0, ageDays * 0.35);
    const recentTransitions = Math.max(0, Number(loopState.recentTransitions7d ?? 0));
    const recentReopened = Math.max(0, Number(loopState.recentReopened7d ?? 0));
    const recentResolved = Math.max(0, Number(loopState.recentResolved7d ?? 0));
    const churnRatio = recentTransitions > 0 ? recentReopened / recentTransitions : 0;
    const volatility = Math.max(0, Math.min(1, recentTransitions * 0.08 +
        recentReopened * 0.12 +
        churnRatio * 0.46 +
        (state === "reopened" ? 0.16 : 0) +
        (state === "superseded" ? 0.08 : 0)));
    let score = 0.08;
    if (state === "open-loop") {
        score += 0.52 * confidence;
        reasons.push("state:open-loop");
        if (stagnationDays >= 3) {
            score += Math.min(0.22, 0.018 * stagnationDays);
            reasons.push("stale-open");
        }
    }
    if (state === "reopened") {
        score += 0.62 * confidence;
        reasons.push("state:reopened");
        if (recentReopened > 0) {
            score += Math.min(0.2, recentReopened * 0.03);
            reasons.push("recent-reopened");
        }
    }
    if (state === "superseded") {
        score += 0.42 * confidence;
        reasons.push("state:superseded");
    }
    if (state === "resolved") {
        score += 0.22 * confidence;
        reasons.push("state:resolved");
        if (recentResolved > 0 && ageDays <= 3) {
            score += Math.min(0.08, recentResolved * 0.02);
            reasons.push("fresh-resolution");
        }
    }
    if (recentTransitions > 0) {
        score += Math.min(0.16, recentTransitions * 0.012);
        reasons.push("recent-transitions");
    }
    if (volatility >= 0.28) {
        score += Math.min(0.2, volatility * 0.2);
        reasons.push("volatile-loop");
    }
    if (churnRatio >= 0.35) {
        score += Math.min(0.12, churnRatio * 0.2);
        reasons.push("high-churn");
    }
    if (signals.openLoop && (state === "open-loop" || state === "reopened")) {
        score += 0.12;
        reasons.push("query-open-loop");
    }
    if (signals.resolved && state === "resolved") {
        score += 0.08;
        reasons.push("query-resolved");
    }
    if (signals.reopened && state === "reopened") {
        score += 0.1;
        reasons.push("query-reopened");
    }
    if (signals.superseded && state === "superseded") {
        score += 0.09;
        reasons.push("query-superseded");
    }
    if (signals.latest) {
        const freshness = ageDays <= 1 ? 0.1 : ageDays <= 3 ? 0.08 : ageDays <= 7 ? 0.05 : 0.02;
        score += freshness;
        reasons.push("query-latest");
    }
    if (signals.stuck && (state === "open-loop" || state === "reopened")) {
        score += Math.min(0.18, 0.016 * Math.max(2, stagnationDays));
        reasons.push("query-stuck");
    }
    if (signals.volatile) {
        score += Math.min(0.16, volatility * 0.22);
        reasons.push("query-volatile");
    }
    if (signals.urgent && (state === "open-loop" || state === "reopened")) {
        score += 0.08;
        reasons.push("query-urgent-open");
    }
    const boundedScore = Math.max(0, Math.min(2, score));
    const lane = classifyLoopAttentionLane(boundedScore, state, volatility, stagnationDays);
    reasons.push(`lane:${lane}`);
    return {
        score: boundedScore,
        reasons: Array.from(new Set(reasons)).slice(0, 8),
        lane,
        volatility: Number(volatility.toFixed(3)),
        stagnationDays: Number(stagnationDays.toFixed(1)),
    };
}
function quantile(values, q) {
    if (values.length === 0)
        return 0;
    const boundedQ = Math.max(0, Math.min(1, q));
    const sorted = [...values].sort((left, right) => left - right);
    const position = (sorted.length - 1) * boundedQ;
    const low = Math.floor(position);
    const high = Math.ceil(position);
    if (low === high)
        return sorted[low] ?? 0;
    const lowValue = sorted[low] ?? 0;
    const highValue = sorted[high] ?? 0;
    const weight = position - low;
    return lowValue + (highValue - lowValue) * weight;
}
function calibrateLoopAttentionThresholds(rows) {
    const sampleSize = rows.length;
    if (sampleSize === 0) {
        return {
            sampleSize: 0,
            openPressure: 0,
            criticalMinAttention: 1.02,
            highMinAttention: 0.82,
            watchMinAttention: 0.56,
            highVolatility: 0.48,
            criticalVolatility: 0.72,
            highAnomaly: 0.44,
            criticalAnomaly: 0.68,
            highEscalation: 0.92,
            criticalEscalation: 1.22,
            highBlastRadius: 0.42,
            criticalBlastRadius: 0.66,
        };
    }
    const openLikeCount = rows.filter((row) => row.currentState === "open-loop" || row.currentState === "reopened").length;
    const openPressure = openLikeCount / Math.max(1, sampleSize);
    const attentionValues = rows.map((row) => row.attentionScore);
    const volatilityValues = rows.map((row) => row.volatilityScore);
    const anomalyValues = rows.map((row) => row.anomalyScore);
    const escalationValues = rows.map((row) => row.escalationScore);
    const blastRadiusValues = rows.map((row) => row.blastRadiusScore);
    const q35Attention = quantile(attentionValues, 0.35);
    const q62Attention = quantile(attentionValues, 0.62);
    const q85Attention = quantile(attentionValues, 0.85);
    const q70Volatility = quantile(volatilityValues, 0.7);
    const q90Volatility = quantile(volatilityValues, 0.9);
    const q70Anomaly = quantile(anomalyValues, 0.7);
    const q90Anomaly = quantile(anomalyValues, 0.9);
    const q70Escalation = quantile(escalationValues, 0.7);
    const q90Escalation = quantile(escalationValues, 0.9);
    const q70BlastRadius = quantile(blastRadiusValues, 0.7);
    const q90BlastRadius = quantile(blastRadiusValues, 0.9);
    const criticalMinAttention = Math.max(0.8, Math.min(1.46, q85Attention + 0.08 + openPressure * 0.08 + q90Anomaly * 0.14 + q90BlastRadius * 0.08));
    const highMinAttention = Math.max(0.62, Math.min(criticalMinAttention - 0.08, q62Attention + 0.04 + openPressure * 0.06 + q70Anomaly * 0.1));
    const watchMinAttention = Math.max(0.4, Math.min(highMinAttention - 0.08, q35Attention + 0.02 + openPressure * 0.03));
    const highVolatility = Math.max(0.3, Math.min(0.76, q70Volatility + 0.06 + openPressure * 0.07));
    const criticalVolatility = Math.max(highVolatility + 0.08, Math.min(0.95, q90Volatility + 0.1 + openPressure * 0.06));
    const highAnomaly = Math.max(0.32, Math.min(0.82, q70Anomaly + 0.08));
    const criticalAnomaly = Math.max(highAnomaly + 0.1, Math.min(0.96, q90Anomaly + 0.1));
    const highEscalation = Math.max(0.66, Math.min(1.32, q70Escalation + 0.08 + q70Anomaly * 0.08));
    const criticalEscalation = Math.max(highEscalation + 0.1, Math.min(1.7, q90Escalation + 0.12 + q90Anomaly * 0.1));
    const highBlastRadius = Math.max(0.26, Math.min(0.76, q70BlastRadius + 0.08 + openPressure * 0.04));
    const criticalBlastRadius = Math.max(highBlastRadius + 0.1, Math.min(0.96, q90BlastRadius + 0.1 + q90Anomaly * 0.06));
    return {
        sampleSize,
        openPressure: Number(openPressure.toFixed(3)),
        criticalMinAttention: Number(criticalMinAttention.toFixed(3)),
        highMinAttention: Number(highMinAttention.toFixed(3)),
        watchMinAttention: Number(watchMinAttention.toFixed(3)),
        highVolatility: Number(highVolatility.toFixed(3)),
        criticalVolatility: Number(criticalVolatility.toFixed(3)),
        highAnomaly: Number(highAnomaly.toFixed(3)),
        criticalAnomaly: Number(criticalAnomaly.toFixed(3)),
        highEscalation: Number(highEscalation.toFixed(3)),
        criticalEscalation: Number(criticalEscalation.toFixed(3)),
        highBlastRadius: Number(highBlastRadius.toFixed(3)),
        criticalBlastRadius: Number(criticalBlastRadius.toFixed(3)),
    };
}
function detectLoopBurstAnomaly(loopState, query) {
    const signals = parseQuerySignals(query);
    const reasons = [];
    const recentTransitions = Math.max(0, Number(loopState.recentTransitions7d ?? 0));
    const recentReopened = Math.max(0, Number(loopState.recentReopened7d ?? 0));
    const recentResolved = Math.max(0, Number(loopState.recentResolved7d ?? 0));
    const historicalTransitions = Math.max(1, Number(loopState.openEvents ?? 0) +
        Number(loopState.resolvedEvents ?? 0) +
        Number(loopState.reopenedEvents ?? 0) +
        Number(loopState.supersededEvents ?? 0));
    const historicalReopened = Math.max(0, Number(loopState.reopenedEvents ?? 0));
    const historicalReopenRate = historicalReopened / historicalTransitions;
    const recentReopenRate = recentReopened / Math.max(1, recentTransitions);
    const reopenDelta = Math.max(0, recentReopenRate - historicalReopenRate);
    const expectedRecentTransitions = Math.max(1, historicalTransitions / 8);
    const transitionBurst = Math.max(0, recentTransitions / expectedRecentTransitions - 1);
    const unresolvedBurst = Math.max(0, recentReopened - recentResolved);
    const unresolvedPressure = Math.min(1, unresolvedBurst / Math.max(1, recentTransitions));
    let score = 0;
    if (reopenDelta >= 0.2) {
        score += Math.min(0.5, reopenDelta * 1.25);
        reasons.push("reopen-spike");
    }
    if (transitionBurst >= 0.25) {
        score += Math.min(0.42, transitionBurst * 0.32);
        reasons.push("transition-burst");
    }
    if (unresolvedPressure >= 0.2) {
        score += Math.min(0.28, unresolvedPressure * 0.5);
        reasons.push("unresolved-burst");
    }
    if (signals.volatile) {
        score += Math.min(0.16, (reopenDelta + transitionBurst) * 0.14);
        reasons.push("query-volatile-anomaly");
    }
    if (signals.stuck && unresolvedPressure > 0) {
        score += Math.min(0.12, unresolvedPressure * 0.28);
        reasons.push("query-stuck-anomaly");
    }
    return {
        score: Number(Math.max(0, Math.min(1, score)).toFixed(3)),
        reasons: Array.from(new Set(reasons)).slice(0, 5),
    };
}
function assignCalibratedAttentionLane(row, thresholds) {
    const isOpenLike = row.currentState === "open-loop" || row.currentState === "reopened";
    if (row.attentionScore >= thresholds.criticalMinAttention ||
        row.volatilityScore >= thresholds.criticalVolatility ||
        row.anomalyScore >= thresholds.criticalAnomaly ||
        row.escalationScore >= thresholds.criticalEscalation ||
        row.blastRadiusScore >= thresholds.criticalBlastRadius ||
        (isOpenLike && row.stagnationDays >= 8 && row.anomalyScore >= thresholds.highAnomaly)) {
        return "critical";
    }
    if (row.attentionScore >= thresholds.highMinAttention ||
        row.volatilityScore >= thresholds.highVolatility ||
        row.anomalyScore >= thresholds.highAnomaly ||
        row.escalationScore >= thresholds.highEscalation ||
        row.blastRadiusScore >= thresholds.highBlastRadius ||
        (isOpenLike && row.stagnationDays >= 4)) {
        return "high";
    }
    if (row.attentionScore >= thresholds.watchMinAttention ||
        row.volatilityScore >= 0.24 ||
        row.anomalyScore >= 0.16 ||
        row.blastRadiusScore >= 0.18) {
        return "watch";
    }
    return "stable";
}
function readArrayCount(value) {
    return Array.isArray(value) ? value.length : 0;
}
function readStringTokens(value, limit = 24) {
    if (Array.isArray(value)) {
        return value
            .flatMap((entry) => readStringTokens(entry, limit))
            .filter(Boolean)
            .slice(0, limit);
    }
    const text = String(value ?? "").trim().toLowerCase();
    if (!text)
        return [];
    return text
        .split(/[,\n;|]+/g)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
        .slice(0, limit);
}
function recommendedLoopAction(row) {
    if (row.lane === "critical" && (row.state === "reopened" || row.anomalyScore >= 0.52)) {
        return "Escalate now: assign owner, stop churn, and set a same-day resolution checkpoint.";
    }
    if (row.lane === "critical" && row.blastRadiusScore >= 0.5) {
        return "Escalate cross-team: publish a single source of truth and coordinate impacted actors.";
    }
    if (row.state === "open-loop" && row.stagnationDays >= 7) {
        return "Break stagnation: force next action with owner and explicit due date.";
    }
    if (row.state === "superseded") {
        return "Close the old lane: confirm replacement decision and notify downstream consumers.";
    }
    if (row.state === "resolved" && row.anomalyScore >= 0.3) {
        return "Verify stability: monitor for regression and keep rollback context handy.";
    }
    if (row.escalationScore >= 0.95) {
        return "Prioritize this loop in the next triage pass and verify owner acknowledgment.";
    }
    return "Monitor and keep context fresh; no immediate escalation required.";
}
function slaTargetHoursForLane(lane) {
    if (lane === "critical")
        return 24;
    if (lane === "high")
        return 72;
    if (lane === "watch")
        return 168;
    return 336;
}
function computeIncidentSlaWindow(input) {
    const updatedMs = Date.parse(input.updatedAt);
    const hoursSinceUpdate = Number.isFinite(updatedMs) ? Math.max(0, Date.now() - updatedMs) / 3_600_000 : 0;
    const baseline = slaTargetHoursForLane(input.lane);
    const urgencyMultiplier = 1 + Math.max(0, input.escalationScore - 0.8) * 0.22 + input.anomalyScore * 0.34 + input.blastRadiusScore * 0.26;
    const effectiveElapsed = hoursSinceUpdate * urgencyMultiplier;
    const hoursUntilBreach = Number((baseline - effectiveElapsed).toFixed(1));
    const slaStatus = hoursUntilBreach <= 0 ? "breached" : hoursUntilBreach <= Math.max(4, baseline * 0.2) ? "at-risk" : "healthy";
    return {
        slaTargetHours: baseline,
        hoursSinceUpdate: Number(hoursSinceUpdate.toFixed(1)),
        hoursUntilBreach,
        slaStatus,
    };
}
function summarizeActionReason(input) {
    if (input.action === "escalate") {
        return `Escalate due to ${input.lane}/${input.currentState} risk with SLA ${input.slaStatus} (${input.hoursUntilBreach.toFixed(1)}h).`;
    }
    if (input.action === "assign") {
        return `Assign owner to prevent SLA breach (${input.slaStatus}, ${input.hoursUntilBreach.toFixed(1)}h).`;
    }
    if (input.action === "resolve") {
        return `Resolve candidate: state=${input.currentState}, anomaly=${input.anomalyScore.toFixed(2)}.`;
    }
    if (input.action === "snooze") {
        return `Snooze candidate: healthy SLA with lower near-term escalation pressure.`;
    }
    if (input.action === "ack") {
        return `Acknowledge and monitor: signal present but immediate intervention not required.`;
    }
    return `Mark as false-positive candidate due to weak/contradictory risk profile.`;
}
function inferLoopStateFromIncidentAction(action) {
    if (action === "resolve")
        return "resolved";
    if (action === "false-positive")
        return "superseded";
    if (action === "escalate")
        return "reopened";
    if (action === "ack" || action === "assign")
        return "open-loop";
    return null;
}
function computeLoopFeedbackAdjustment(feedback, query) {
    if (!feedback || feedback.totalCount <= 0) {
        return {
            feedbackScore: 0,
            attentionDelta: 0,
            escalationDelta: 0,
            reasons: [],
        };
    }
    const signals = parseQuerySignals(query);
    const positiveSupport = feedback.resolveCount * 1.2 +
        feedback.escalateCount * 1.1 +
        feedback.ackCount * 0.45 +
        feedback.assignCount * 0.3;
    const noisePenalty = feedback.falsePositiveCount * 1.35 + feedback.snoozeCount * 0.25;
    const calibratedPrecision = (positiveSupport + 1) / (positiveSupport + noisePenalty + 2);
    const lastActionMs = Date.parse(String(feedback.lastActionAt ?? ""));
    const ageDays = Number.isFinite(lastActionMs) ? Math.max(0, Date.now() - lastActionMs) / 86_400_000 : 365;
    const freshness = ageDays <= 7 ? 1 : ageDays <= 21 ? 0.72 : ageDays <= 60 ? 0.45 : 0.24;
    let feedbackScore = (calibratedPrecision - 0.5) * 0.52 * freshness;
    feedbackScore += Math.min(0.08, Math.log1p(positiveSupport) * 0.02);
    feedbackScore -= Math.min(0.2, feedback.falsePositiveCount * 0.045);
    if (signals.urgent && feedback.escalateCount > 0)
        feedbackScore += 0.04;
    if (signals.openLoop && feedback.resolveCount > 0)
        feedbackScore -= 0.02;
    if (signals.resolved && feedback.resolveCount > 0)
        feedbackScore += 0.03;
    if (signals.volatile && feedback.falsePositiveCount > feedback.escalateCount)
        feedbackScore -= 0.03;
    feedbackScore = Math.max(-0.26, Math.min(0.34, feedbackScore));
    const reasons = [];
    if (feedback.falsePositiveCount >= Math.max(2, feedback.resolveCount + feedback.escalateCount)) {
        reasons.push("feedback:false-positive-heavy");
    }
    if (feedback.resolveCount + feedback.escalateCount >= 3) {
        reasons.push("feedback:confirmed-signal");
    }
    if (freshness >= 0.7 && feedback.totalCount > 0) {
        reasons.push("feedback:fresh-operator-input");
    }
    return {
        feedbackScore: Number(feedbackScore.toFixed(3)),
        attentionDelta: Number((feedbackScore * 0.36).toFixed(3)),
        escalationDelta: Number((feedbackScore * 0.64).toFixed(3)),
        reasons,
    };
}
function diversityGroupForRow(row) {
    const metadata = normalizeMetadata(row.metadata);
    const threadKey = threadKeyFromMetadata(metadata);
    if (threadKey)
        return `thread:${threadKey}`;
    const subjectKey = normalizeText(metadata.subjectKey);
    if (subjectKey)
        return `subject:${subjectKey}`;
    const participantKey = normalizeText(metadata.participantKey);
    if (participantKey)
        return `participants:${participantKey}`;
    const normalizedMessageId = normalizeText(metadata.normalizedMessageId || metadata.messageId || metadata.rawMessageId);
    if (normalizedMessageId)
        return `message:${normalizedMessageId}`;
    return `source:${normalizeSource(row.source)}`;
}
function diversifyRankedRows(rows, limit) {
    if (rows.length <= 1)
        return rows.slice(0, limit);
    const candidates = [...rows];
    const selected = [];
    const groupCounts = new Map();
    const boundedLimit = Math.max(1, Math.min(limit, rows.length));
    while (selected.length < boundedLimit && candidates.length > 0) {
        let bestIndex = -1;
        let bestAdjustedScore = -Infinity;
        for (let index = 0; index < candidates.length; index += 1) {
            const row = candidates[index];
            const groupKey = diversityGroupForRow(row);
            const seenCount = groupCounts.get(groupKey) ?? 0;
            const duplicatePenalty = seenCount * 0.09;
            const adjustedScore = row.score - duplicatePenalty;
            if (adjustedScore > bestAdjustedScore) {
                bestAdjustedScore = adjustedScore;
                bestIndex = index;
            }
        }
        if (bestIndex < 0)
            break;
        const picked = candidates.splice(bestIndex, 1)[0];
        const pickedGroup = diversityGroupForRow(picked);
        groupCounts.set(pickedGroup, (groupCounts.get(pickedGroup) ?? 0) + 1);
        selected.push(picked);
    }
    return selected.sort((left, right) => right.score - left.score || right.createdAt.localeCompare(left.createdAt));
}
function toSearchResultFromRecord(row, overrides, anchorMs = Date.now()) {
    const recency = recencyScore(row.occurredAt, row.createdAt, row.memoryType, anchorMs);
    const base = {
        ...row,
        score: 0.2 + 0.2 * recency + 0.2 * row.sourceConfidence + 0.2 * row.importance,
        matchedBy: ["recent"],
        scoreBreakdown: {
            rrf: 0.2,
            sourceTrust: row.sourceConfidence,
            recency,
            importance: row.importance,
            session: 0,
            lexical: 0,
            semantic: 0,
            sessionLane: 0,
        },
    };
    return {
        ...base,
        ...overrides,
        scoreBreakdown: {
            ...base.scoreBreakdown,
            ...(overrides?.scoreBreakdown ?? {}),
        },
        matchedBy: overrides?.matchedBy ?? base.matchedBy,
    };
}
function createMemoryService(options) {
    const embeddingAdapter = options.embeddingAdapter ?? new embedding_1.NullEmbeddingAdapter();
    const associationScoutAvailability = options.associationScout === undefined
        ? (0, associationScout_1.describeAssociationScoutEnv)()
        : {
            enabled: Boolean(options.associationScout),
            available: Boolean(options.associationScout),
            model: options.associationScout ? "custom" : "disabled",
            provider: options.associationScout ? "codex-cli" : "auto",
            resolvedProvider: options.associationScout ? "codex-cli" : null,
            apiKeySource: null,
            codexExecutable: null,
            reasoningEffort: "low",
            executionRoot: null,
            reason: options.associationScout ? null : "disabled",
        };
    const associationScout = options.associationScout === undefined ? (0, associationScout_1.createAssociationScoutFromEnv)() : options.associationScout;
    const defaultTenantId = options.defaultTenantId ?? null;
    const defaultAgentId = options.defaultAgentId ?? "memory-api";
    const defaultRunId = options.defaultRunId ?? "open-memory-v1";
    const expectedEmbeddingDimensions = Number.isFinite(options.expectedEmbeddingDimensions) && Number(options.expectedEmbeddingDimensions) > 0
        ? Number(options.expectedEmbeddingDimensions)
        : null;
    const nanny = (0, nanny_1.createMemoryNanny)({
        defaultTenantId,
        allowedTenantIds: options.allowedTenantIds,
        defaultAgentId,
        defaultRunId,
        duplicateWindowMs: options.nannyDuplicateWindowMs,
        runWriteWindowMs: options.nannyRunWriteWindowMs,
        maxWritesPerRunWindow: options.nannyMaxWritesPerRunWindow,
    });
    const normalizeTenant = (tenantId) => nanny.resolveTenant(tenantId).tenantId;
    const normalizeEmbedding = (vector) => {
        if (!vector || vector.length === 0)
            return null;
        if (expectedEmbeddingDimensions !== null && vector.length !== expectedEmbeddingDimensions) {
            return null;
        }
        return vector;
    };
    const searchFallbackCache = new Map();
    const SEARCH_FALLBACK_CACHE_MAX_ENTRIES = 240;
    const SEARCH_FALLBACK_CACHE_TTL_MS = 5 * 60_000;
    const cloneSearchResultRow = (row) => ({
        ...row,
        tags: [...row.tags],
        metadata: normalizeMetadata(row.metadata),
        scoreBreakdown: {
            ...row.scoreBreakdown,
        },
        matchedBy: [...row.matchedBy],
    });
    const buildSearchFallbackCacheKey = (params) => stableStringify({
        tenantId: params.tenantId,
        agentId: params.agentId ?? null,
        runId: params.runId ?? null,
        query: normalizeText(params.query).toLowerCase(),
        retrievalMode: params.retrievalMode,
        sourceAllowlist: [...params.allowSources].sort((left, right) => left.localeCompare(right)),
        sourceDenylist: [...params.denySources].sort((left, right) => left.localeCompare(right)),
        layerAllowlist: [...params.allowLayers].sort((left, right) => left.localeCompare(right)),
        layerDenylist: [...params.denyLayers].sort((left, right) => left.localeCompare(right)),
        limit: Math.max(1, params.limit),
    });
    const writeSearchFallbackCache = (cacheKey, rows) => {
        if (!cacheKey || rows.length === 0)
            return;
        searchFallbackCache.set(cacheKey, {
            storedAtMs: Date.now(),
            rows: rows.slice(0, 160).map((row) => cloneSearchResultRow(row)),
        });
        if (searchFallbackCache.size <= SEARCH_FALLBACK_CACHE_MAX_ENTRIES)
            return;
        const ordered = Array.from(searchFallbackCache.entries()).sort((left, right) => left[1].storedAtMs - right[1].storedAtMs);
        const pruneCount = Math.max(1, ordered.length - SEARCH_FALLBACK_CACHE_MAX_ENTRIES);
        for (const [key] of ordered.slice(0, pruneCount)) {
            searchFallbackCache.delete(key);
        }
    };
    const readSearchFallbackCache = (cacheKey) => {
        if (!cacheKey)
            return null;
        const entry = searchFallbackCache.get(cacheKey);
        if (!entry)
            return null;
        if (Date.now() - entry.storedAtMs > SEARCH_FALLBACK_CACHE_TTL_MS) {
            searchFallbackCache.delete(cacheKey);
            return null;
        }
        return entry.rows.map((row) => cloneSearchResultRow(row)).filter((row) => !isExpiredSearchResult(row));
    };
    const contextFallbackCache = new Map();
    const CONTEXT_FALLBACK_CACHE_MAX_ENTRIES = 240;
    const CONTEXT_FALLBACK_CACHE_TTL_MS = 5 * 60_000;
    const buildContextFallbackCacheKey = (params) => stableStringify({
        tenantId: params.tenantId,
        agentId: params.agentId ?? null,
        runId: params.runId ?? null,
        query: normalizeText(params.query).toLowerCase(),
        retrievalMode: params.retrievalMode,
        sourceAllowlist: [...params.sourceAllowlist].sort((left, right) => left.localeCompare(right)),
        sourceDenylist: [...params.sourceDenylist].sort((left, right) => left.localeCompare(right)),
        layerAllowlist: [...params.layerAllowlist].sort((left, right) => left.localeCompare(right)),
        layerDenylist: [...params.layerDenylist].sort((left, right) => left.localeCompare(right)),
        maxItems: Math.max(1, params.maxItems),
        scanLimit: Math.max(1, params.scanLimit),
    });
    const writeContextFallbackCache = (cacheKey, rows, retrievalModeUsed) => {
        if (!cacheKey || rows.length === 0)
            return;
        contextFallbackCache.set(cacheKey, {
            storedAtMs: Date.now(),
            rows: rows.slice(0, 220).map((row) => cloneSearchResultRow(row)),
            retrievalModeUsed,
        });
        if (contextFallbackCache.size <= CONTEXT_FALLBACK_CACHE_MAX_ENTRIES)
            return;
        const ordered = Array.from(contextFallbackCache.entries()).sort((left, right) => left[1].storedAtMs - right[1].storedAtMs);
        const pruneCount = Math.max(1, ordered.length - CONTEXT_FALLBACK_CACHE_MAX_ENTRIES);
        for (const [key] of ordered.slice(0, pruneCount)) {
            contextFallbackCache.delete(key);
        }
    };
    const readContextFallbackCache = (cacheKey) => {
        if (!cacheKey)
            return null;
        const entry = contextFallbackCache.get(cacheKey);
        if (!entry)
            return null;
        if (Date.now() - entry.storedAtMs > CONTEXT_FALLBACK_CACHE_TTL_MS) {
            contextFallbackCache.delete(cacheKey);
            return null;
        }
        return {
            rows: entry.rows
                .map((row) => row.matchedBy.includes("context-stale-cache-fallback")
                ? cloneSearchResultRow(row)
                : {
                    ...cloneSearchResultRow(row),
                    matchedBy: [...row.matchedBy, "context-stale-cache-fallback"],
                })
                .filter((row) => !isExpiredSearchResult(row)),
            retrievalModeUsed: entry.retrievalModeUsed,
        };
    };
    const loadConsolidationCandidates = async (input) => {
        const uniqueRows = new Map();
        const suppressedPseudoDecisionIds = new Set();
        const suppressedPseudoDecisionExamples = [];
        const notePseudoDecisionSuppression = (row) => {
            if (!isPseudoDecisionTrace({ source: row.source, content: row.content, metadata: normalizeMetadata(row.metadata) })) {
                return false;
            }
            suppressedPseudoDecisionIds.add(row.id);
            if (suppressedPseudoDecisionExamples.length < 8) {
                suppressedPseudoDecisionExamples.push(row.content.replace(/\s+/g, " ").trim().slice(0, 140));
            }
            return true;
        };
        const addRows = (rows) => {
            for (const row of rows) {
                if (!row)
                    continue;
                if (row.memoryLayer === "core")
                    continue;
                if (row.status === "archived" || row.status === "quarantined")
                    continue;
                if (isExpiredRecord(row))
                    continue;
                if (isDreamGeneratedRow(row))
                    continue;
                if (notePseudoDecisionSuppression(row))
                    continue;
                uniqueRows.set(row.id, row);
            }
        };
        const recentCreatedRows = filterExpiredMemoryRecords(await (options.store.recentCreated
            ? options.store.recentCreated({
                tenantId: input.tenantId,
                layerDenylist: ["core"],
                excludeStatuses: ["archived", "quarantined"],
                limit: input.maxCandidates,
            })
            : options.store.recent({
                tenantId: input.tenantId,
                layerDenylist: ["core"],
                excludeStatuses: ["archived", "quarantined"],
                limit: input.maxCandidates,
            }))).filter((row) => row.memoryLayer !== "core" && !isDreamGeneratedRow(row));
        addRows(recentCreatedRows);
        const recentOccurredRows = filterExpiredMemoryRecords(await options.store.recent({
            tenantId: input.tenantId,
            layerDenylist: ["core"],
            excludeStatuses: ["archived", "quarantined"],
            limit: Math.max(input.maxCandidates, Math.min(400, input.maxCandidates * 2)),
        })).filter((row) => row.memoryLayer !== "core" && !isDreamGeneratedRow(row));
        addRows(recentOccurredRows);
        const brief = readMemoryBriefArtifact();
        const querySeeds = [];
        const querySeen = new Set();
        for (const focusArea of input.focusAreas)
            appendDreamQuerySeed(querySeeds, querySeen, focusArea);
        for (const focusArea of brief?.consolidation?.focusAreas ?? [])
            appendDreamQuerySeed(querySeeds, querySeen, focusArea);
        for (const focusArea of brief?.layers?.episodicMemory ?? [])
            appendDreamQuerySeed(querySeeds, querySeen, focusArea);
        for (const row of Array.from(uniqueRows.values()).sort((left, right) => consolidationPrecedenceScore(right) - consolidationPrecedenceScore(left)).slice(0, 10)) {
            const metadata = normalizeMetadata(row.metadata);
            appendDreamQuerySeed(querySeeds, querySeen, normalizeSubjectKey(metadata.subjectKey || metadata.subject));
            appendDreamQuerySeed(querySeeds, querySeen, threadKeyFromMetadata(metadata));
            appendDreamQuerySeed(querySeeds, querySeen, loopClusterKeyFromMetadata(metadata));
            appendDreamQuerySeed(querySeeds, querySeen, row.content.replace(/\s+/g, " ").trim().slice(0, 120));
            if (querySeeds.length >= MEMORY_CONSOLIDATION_WIDE_QUERY_LIMIT)
                break;
        }
        const boundedQuerySeeds = querySeeds.slice(0, MEMORY_CONSOLIDATION_WIDE_QUERY_LIMIT);
        let queryExpansionCount = 0;
        if (MEMORY_CONSOLIDATION_WIDE_SEARCH_ENABLED && boundedQuerySeeds.length > 0) {
            for (const query of boundedQuerySeeds) {
                const hits = filterExpiredSearchResults(await options.store.search({
                    query,
                    tenantId: input.tenantId,
                    retrievalMode: "lexical",
                    layerDenylist: ["core"],
                    sourceDenylist: [MEMORY_CONSOLIDATION_CONNECTION_SOURCE, MEMORY_CONSOLIDATION_PROMOTION_CANDIDATE_SOURCE],
                    limit: MEMORY_CONSOLIDATION_WIDE_SEARCH_RESULT_LIMIT,
                }));
                const beforeCount = uniqueRows.size;
                addRows(hits);
                queryExpansionCount += Math.max(0, uniqueRows.size - beforeCount);
            }
        }
        let relatedExpansionCount = 0;
        if (MEMORY_CONSOLIDATION_WIDE_SEARCH_ENABLED && options.store.related) {
            const candidateRows = Array.from(uniqueRows.values())
                .sort((left, right) => consolidationPrecedenceScore(right) - consolidationPrecedenceScore(left))
                .slice(0, 12);
            const seedIds = candidateRows.map((row) => row.id);
            const entityHintMap = new Map();
            const patternHintMap = new Map();
            for (const query of boundedQuerySeeds) {
                for (const hint of extractQueryEntityHints(query)) {
                    entityHintMap.set(`${hint.entityType}|${hint.entityKey}`, hint);
                }
                for (const hint of extractQueryPatternHints(query)) {
                    patternHintMap.set(`${hint.patternType}|${hint.patternKey}`, hint);
                }
            }
            for (const row of candidateRows) {
                const metadata = normalizeMetadata(row.metadata);
                const subjectKey = normalizeSubjectKey(metadata.subjectKey || metadata.subject);
                const threadKey = threadKeyFromMetadata(metadata);
                const loopKey = loopClusterKeyFromMetadata(metadata);
                if (subjectKey) {
                    patternHintMap.set(`topic|${normalizePatternKey(subjectKey)}`, {
                        patternType: "topic",
                        patternKey: normalizePatternKey(subjectKey),
                        weight: 0.82,
                    });
                }
                if (threadKey) {
                    patternHintMap.set(`thread|${normalizePatternKey(threadKey)}`, {
                        patternType: "thread",
                        patternKey: normalizePatternKey(threadKey),
                        weight: 0.88,
                    });
                }
                if (loopKey) {
                    patternHintMap.set(`loop-cluster|${normalizePatternKey(loopKey)}`, {
                        patternType: "loop-cluster",
                        patternKey: normalizePatternKey(loopKey),
                        weight: 0.9,
                    });
                }
                for (const token of readStringValues(metadata.entityHints, 16).slice(0, 8)) {
                    const [rawType, rawKey] = String(token).split(":");
                    const entityType = normalizeEntityType(rawType);
                    const entityKey = normalizeEntityKey(rawKey);
                    if (!entityType || !entityKey)
                        continue;
                    entityHintMap.set(`${entityType}|${entityKey}`, { entityType, entityKey, weight: 0.7 });
                }
            }
            if (seedIds.length > 0 || entityHintMap.size > 0 || patternHintMap.size > 0) {
                const related = await options.store.related({
                    tenantId: input.tenantId,
                    seedIds,
                    entityHints: Array.from(entityHintMap.values()).slice(0, 24),
                    patternHints: Array.from(patternHintMap.values()).slice(0, 24),
                    limit: MEMORY_CONSOLIDATION_WIDE_RELATED_LIMIT,
                    maxHops: 2,
                    includeSeed: false,
                });
                const relatedIds = related
                    .map((row) => row.id)
                    .filter((id) => !uniqueRows.has(id))
                    .slice(0, MEMORY_CONSOLIDATION_WIDE_RELATED_LIMIT);
                if (relatedIds.length > 0) {
                    const relatedRows = await options.store.getByIds({
                        tenantId: input.tenantId,
                        ids: relatedIds,
                    });
                    const beforeCount = uniqueRows.size;
                    addRows(relatedRows);
                    relatedExpansionCount = Math.max(0, uniqueRows.size - beforeCount);
                }
            }
        }
        const candidateCap = Math.min(2_000, Math.max(input.maxCandidates, input.maxCandidates + boundedQuerySeeds.length * MEMORY_CONSOLIDATION_WIDE_SEARCH_RESULT_LIMIT + MEMORY_CONSOLIDATION_WIDE_RELATED_LIMIT));
        const finalRows = Array.from(uniqueRows.values())
            .sort((left, right) => {
            const precedenceDelta = consolidationPrecedenceScore(right) - consolidationPrecedenceScore(left);
            if (precedenceDelta !== 0)
                return precedenceDelta;
            return (right.occurredAt || right.createdAt).localeCompare(left.occurredAt || left.createdAt);
        })
            .slice(0, candidateCap);
        const preBalanceCandidateCount = finalRows.length;
        const selectionLimit = Math.min(finalRows.length, Math.max(input.maxCandidates, Math.min(800, Math.max(input.maxCandidates * 2, 24))));
        const balancedSelection = selectDreamCandidates(finalRows, selectionLimit);
        const balancedRows = balancedSelection.rows;
        return {
            rows: balancedRows,
            details: {
                recentCreatedCount: recentCreatedRows.length,
                recentOccurredCount: recentOccurredRows.length,
                queryExpansionCount,
                relatedExpansionCount,
                uniqueCandidateCount: balancedRows.length,
                preBalanceCandidateCount,
                postBalanceCandidateCount: balancedRows.length,
                querySeeds: boundedQuerySeeds,
                seedIds: balancedRows.slice(0, 12).map((row) => row.id),
                byLayer: countByLayer(balancedRows),
                bySource: countClusterSources(balancedRows, 10),
                byFamily: countByDreamFamily(balancedRows, 10),
                familyQuotaPlan: balancedSelection.familyQuotaPlan,
                familyQuotaActual: balancedSelection.familyQuotaActual,
                dominanceWarnings: balancedSelection.dominanceWarnings,
                mixQuality: balancedSelection.mixQuality,
                suppressedPseudoDecisionCount: suppressedPseudoDecisionIds.size,
                suppressedPseudoDecisionExamples,
            },
        };
    };
    const capture = async (raw, captureOptions) => {
        let parsed;
        try {
            parsed = contracts_1.memoryCaptureRequestSchema.parse(raw);
        }
        catch (error) {
            throw normalizeError(error);
        }
        const routing = nanny.routeCapture(parsed, {
            bypassRunWriteBurstLimit: captureOptions?.bypassRunWriteBurstLimit,
        });
        if (routing.blockedReason) {
            throw new MemoryValidationError(`Memory nanny blocked capture due to ${routing.blockedReason}. Reduce burst writes or ensure unique captures.`);
        }
        const normalizedSource = normalizeSource(parsed.source);
        const id = routing.memoryIdOverride ??
            parsed.id ??
            deriveMemoryId({
                content: parsed.content,
                tenantId: routing.tenantId,
                source: normalizedSource,
                clientRequestId: parsed.clientRequestId,
            });
        const requestedMetadata = {
            ...parsed.metadata,
            source: normalizedSource,
            _memoryNanny: routing.metadata,
        };
        const derivedLayer = deriveCaptureLayer({
            memoryLayer: parsed.memoryLayer,
            memoryType: parsed.memoryType,
            source: normalizedSource,
            tags: parsed.tags,
            content: parsed.content,
            metadata: requestedMetadata,
        });
        if (derivedLayer === "core") {
            throw new MemoryValidationError("Core memory blocks are synthesized from startup continuity and role packs, not captured through the general memory API.");
        }
        const enrichedMetadata = enrichCaptureMetadata({
            source: normalizedSource,
            content: parsed.content,
            tags: parsed.tags,
            metadata: requestedMetadata,
        });
        const metadataWithLayer = {
            ...enrichedMetadata,
            memoryLayer: derivedLayer,
        };
        const ttlAwareMetadata = derivedLayer === "working"
            ? applyDefaultWorkingTtl(metadataWithLayer, parsed.occurredAt ?? null)
            : metadataWithLayer;
        const lineageAwareMetadata = derivedLayer === "canonical"
            ? withCanonicalLineage(ttlAwareMetadata, {
                id,
                source: normalizedSource,
                clientRequestId: parsed.clientRequestId ?? null,
            })
            : ttlAwareMetadata;
        const metadata = redactSensitiveMetadata(lineageAwareMetadata);
        let status = normalizeStatus(parsed.status, normalizedSource, parsed.content);
        if (derivedLayer === "episodic" &&
            shouldDefaultAcceptedEpisodic({
                statusProvided: typeof parsed.status === "string",
                source: normalizedSource,
                tags: parsed.tags,
                content: parsed.content,
                metadata,
            })) {
            status = "accepted";
        }
        const memoryType = (0, layers_1.defaultMemoryTypeForLayer)(derivedLayer, normalizeMemoryType(parsed.memoryType));
        const sourceConfidence = clamp01(parsed.sourceConfidence, sourceConfidenceForSource(normalizedSource));
        const importance = clamp01(parsed.importance, inferImportance(parsed.tags, metadata));
        const contextualizedContent = buildContextualizedContent({
            source: normalizedSource,
            agentId: routing.agentId,
            runId: routing.runId,
            tags: parsed.tags,
            content: parsed.content,
            metadata,
        });
        const fingerprint = buildFingerprint({
            tenantId: routing.tenantId,
            source: normalizedSource,
            content: parsed.content,
            tags: parsed.tags,
        });
        const embedding = normalizeEmbedding(parsed.embedding ?? (await embeddingAdapter.embed(contextualizedContent)));
        const stored = await options.store.upsert({
            id,
            tenantId: routing.tenantId,
            agentId: routing.agentId,
            runId: routing.runId,
            content: parsed.content,
            source: normalizedSource,
            tags: parsed.tags,
            metadata: {
                ...metadata,
                status,
                memoryType,
                memoryLayer: derivedLayer,
                sourceConfidence,
                importance,
            },
            embedding,
            occurredAt: parsed.occurredAt ?? null,
            clientRequestId: parsed.clientRequestId ?? null,
            status,
            memoryType,
            memoryLayer: derivedLayer,
            sourceConfidence,
            importance,
            contextualizedContent,
            fingerprint,
            embeddingModel: metadata.embeddingModel ? String(metadata.embeddingModel) : null,
            embeddingVersion: 1,
        });
        if (options.store.indexSignals && captureOptions?.skipSignalIndexing !== true) {
            const indexInput = deriveSignalIndex({
                memoryId: stored.id,
                tenantId: stored.tenantId,
                content: stored.content,
                metadata: metadata,
                source: normalizedSource,
                tags: stored.tags,
            });
            if (options.store.related) {
                const metadataForThreading = normalizeMetadata(metadata);
                const normalizedMessageId = normalizeMessageReferenceList(metadataForThreading.normalizedMessageId, 1)[0] ?? "";
                const inReplyToNormalized = normalizeMessageReferenceList([metadataForThreading.inReplyToNormalized, metadataForThreading.inReplyTo], 1)[0] ?? "";
                const referenceMessageIds = mergeUniqueStrings(normalizeMessageReferenceList(metadataForThreading.referenceMessageIds, 24), normalizeMessageReferenceList([inReplyToNormalized, metadataForThreading.inReplyTo, metadataForThreading.replyTo, metadataForThreading.references], 24), 24)
                    .map((value) => String(value).toLowerCase())
                    .filter(Boolean);
                const threadKey = normalizeText(metadataForThreading.threadKey);
                if (referenceMessageIds.length > 0) {
                    try {
                        const related = await options.store.related({
                            tenantId: stored.tenantId,
                            seedIds: [],
                            entityHints: referenceMessageIds.map((messageId) => ({
                                entityType: "message-id",
                                entityKey: messageId,
                                weight: 1,
                            })),
                            patternHints: threadKey ? [{ patternType: "thread", patternKey: threadKey, weight: 0.72 }] : [],
                            limit: 20,
                            maxHops: 1,
                            includeSeed: false,
                        });
                        const edgeSeen = new Set(indexInput.edges.map((edge) => `${edge.targetId}|${normalizeEntityType(edge.relationType) || "related"}`));
                        for (const hit of related.slice(0, 12)) {
                            if (!hit?.id || hit.id === stored.id)
                                continue;
                            const relationType = hit.matchedBy.includes("entity") && hit.matchedBy.includes("pattern")
                                ? "reply-thread"
                                : "reply-to";
                            const weight = clamp01(0.68 + hit.entityScore * 0.2 + hit.patternScore * 0.14 + hit.graphScore * 0.1, 0.72);
                            appendEdge(indexInput.edges, edgeSeen, stored.id, hit.id, relationType, weight, {
                                via: "message-id-reference",
                                matchedBy: hit.matchedBy,
                            });
                        }
                    }
                    catch {
                        // best-effort reply-thread inference
                    }
                }
                if (normalizedMessageId) {
                    try {
                        const descendants = await options.store.related({
                            tenantId: stored.tenantId,
                            seedIds: [],
                            entityHints: [{ entityType: "message-ref", entityKey: normalizedMessageId.toLowerCase(), weight: 1 }],
                            patternHints: threadKey ? [{ patternType: "thread", patternKey: threadKey, weight: 0.7 }] : [],
                            limit: 16,
                            maxHops: 1,
                            includeSeed: false,
                        });
                        if (descendants.length > 0) {
                            const edgeSeen = new Set(indexInput.edges.map((edge) => `${edge.targetId}|${normalizeEntityType(edge.relationType) || "related"}`));
                            for (const hit of descendants.slice(0, 10)) {
                                if (!hit?.id || hit.id === stored.id)
                                    continue;
                                const weight = clamp01(0.62 + hit.entityScore * 0.22 + hit.patternScore * 0.12, 0.66);
                                appendEdge(indexInput.edges, edgeSeen, stored.id, hit.id, "thread-follow-up", weight, {
                                    via: "message-id-backlink",
                                    matchedBy: hit.matchedBy,
                                });
                            }
                        }
                    }
                    catch {
                        // best-effort descendant threading
                    }
                }
            }
            if (options.store.related && (indexInput.entities.length > 0 || indexInput.patterns.length > 0)) {
                const hasResolvedState = indexInput.patterns.some((pattern) => pattern.patternType === "state" && pattern.patternKey === "resolved");
                const hasOpenLoopState = indexInput.patterns.some((pattern) => pattern.patternType === "state" && pattern.patternKey === "open-loop");
                const hasReopenedState = indexInput.patterns.some((pattern) => pattern.patternType === "state" && pattern.patternKey === "reopened");
                const hasSupersededState = indexInput.patterns.some((pattern) => pattern.patternType === "state" && pattern.patternKey === "superseded");
                if (hasResolvedState || hasOpenLoopState || hasReopenedState || hasSupersededState) {
                    try {
                        const baseEntityHints = buildRelatedEntityHints(indexInput.entities);
                        const basePatternHints = buildRelatedPatternHints(indexInput.patterns);
                        if (hasResolvedState) {
                            basePatternHints.push({ patternType: "state", patternKey: "open-loop", weight: 1 });
                        }
                        if (hasOpenLoopState) {
                            basePatternHints.push({ patternType: "state", patternKey: "resolved", weight: 0.82 });
                        }
                        if (hasReopenedState) {
                            basePatternHints.push({ patternType: "state", patternKey: "resolved", weight: 0.9 });
                        }
                        if (hasSupersededState) {
                            basePatternHints.push({ patternType: "state", patternKey: "resolved", weight: 0.84 });
                            basePatternHints.push({ patternType: "state", patternKey: "open-loop", weight: 0.86 });
                        }
                        const dedupedPatternHints = Array.from(new Map(basePatternHints.map((hint) => [
                            `${normalizePatternType(hint.patternType)}|${normalizePatternKey(hint.patternKey)}`,
                            hint,
                        ])).values()).slice(0, 32);
                        const inferred = await options.store.related({
                            tenantId: stored.tenantId,
                            seedIds: [],
                            entityHints: baseEntityHints,
                            patternHints: dedupedPatternHints,
                            limit: 24,
                            maxHops: 1,
                            includeSeed: false,
                        });
                        if (inferred.length > 0) {
                            const edgeSeen = new Set(indexInput.edges.map((edge) => `${edge.targetId}|${normalizeEntityType(edge.relationType) || "related"}`));
                            for (const hit of inferred.slice(0, 16)) {
                                if (!hit?.id || hit.id === stored.id)
                                    continue;
                                if (hasResolvedState && (hit.patternScore > 0.04 || hit.entityScore > 0.04)) {
                                    const inferredWeight = clamp01(0.72 + hit.patternScore * 0.18 + hit.entityScore * 0.14, 0.74);
                                    appendEdge(indexInput.edges, edgeSeen, stored.id, hit.id, "resolves", inferredWeight, {
                                        via: "state-inference",
                                        matchedBy: hit.matchedBy,
                                    });
                                    continue;
                                }
                                if (hasOpenLoopState && hit.patternScore > 0.08 && hit.matchedBy.includes("pattern")) {
                                    const inferredWeight = clamp01(0.6 + hit.patternScore * 0.22 + hit.entityScore * 0.12, 0.62);
                                    appendEdge(indexInput.edges, edgeSeen, stored.id, hit.id, "reopens", inferredWeight, {
                                        via: "state-inference",
                                        matchedBy: hit.matchedBy,
                                    });
                                    continue;
                                }
                                if (hasReopenedState && (hit.patternScore > 0.06 || hit.graphScore > 0.05)) {
                                    const inferredWeight = clamp01(0.64 + hit.patternScore * 0.2 + hit.graphScore * 0.14, 0.66);
                                    appendEdge(indexInput.edges, edgeSeen, stored.id, hit.id, "reopens", inferredWeight, {
                                        via: "state-inference",
                                        matchedBy: hit.matchedBy,
                                    });
                                    continue;
                                }
                                if (hasSupersededState && (hit.patternScore > 0.05 || hit.entityScore > 0.05)) {
                                    const inferredWeight = clamp01(0.66 + hit.patternScore * 0.18 + hit.entityScore * 0.18, 0.68);
                                    appendEdge(indexInput.edges, edgeSeen, stored.id, hit.id, "supersedes", inferredWeight, {
                                        via: "state-inference",
                                        matchedBy: hit.matchedBy,
                                    });
                                }
                            }
                        }
                    }
                    catch {
                        // best-effort inferred state links
                    }
                }
            }
            if (options.store.related && (indexInput.entities.length > 0 || indexInput.patterns.length > 0)) {
                try {
                    const entityHints = buildRelatedEntityHints(indexInput.entities).slice(0, 24);
                    const patternHints = buildRelatedPatternHints(indexInput.patterns).slice(0, 24);
                    if (entityHints.length > 0 || patternHints.length > 0) {
                        const related = await options.store.related({
                            tenantId: stored.tenantId,
                            seedIds: [stored.id],
                            includeSeed: false,
                            maxHops: 1,
                            limit: 28,
                            entityHints,
                            patternHints,
                        });
                        if (related.length > 0) {
                            const edgeSeen = new Set(indexInput.edges.map((edge) => `${edge.targetId}|${normalizeEntityType(edge.relationType) || "related"}`));
                            let added = 0;
                            for (const hit of related.slice(0, 20)) {
                                if (!hit?.id || hit.id === stored.id)
                                    continue;
                                const entityScore = Math.max(0, Number(hit.entityScore ?? 0));
                                const patternScore = Math.max(0, Number(hit.patternScore ?? 0));
                                const graphScore = Math.max(0, Number(hit.graphScore ?? 0));
                                const combinedScore = entityScore * 0.56 + patternScore * 0.34 + graphScore * 0.2;
                                if (combinedScore < 0.12)
                                    continue;
                                const hasEntityMatch = hit.matchedBy.includes("entity") || entityScore >= 0.04;
                                const hasPatternMatch = hit.matchedBy.includes("pattern") || patternScore >= 0.04;
                                const relationType = hasEntityMatch && hasPatternMatch
                                    ? "context-overlap"
                                    : hasEntityMatch
                                        ? "entity-overlap"
                                        : hasPatternMatch
                                            ? "pattern-overlap"
                                            : "graph-overlap";
                                const inferredWeight = clamp01(0.58 + entityScore * 0.18 + patternScore * 0.16 + graphScore * 0.12, 0.62);
                                const beforeEdgeCount = indexInput.edges.length;
                                appendEdge(indexInput.edges, edgeSeen, stored.id, hit.id, relationType, inferredWeight, {
                                    via: "capture-context-overlap",
                                    combinedScore,
                                    matchedBy: hit.matchedBy,
                                    graphScore,
                                    entityScore,
                                    patternScore,
                                });
                                if (indexInput.edges.length > beforeEdgeCount) {
                                    added += 1;
                                    if (added >= 12)
                                        break;
                                }
                            }
                        }
                    }
                }
                catch {
                    // best-effort context-overlap inference
                }
            }
            if (options.store.updateLoopState) {
                const loopClusterKeys = Array.from(new Set(indexInput.patterns
                    .filter((pattern) => pattern.patternType === "loop-cluster")
                    .map((pattern) => normalizePatternKey(pattern.patternKey))
                    .filter(Boolean)));
                const loopStatePattern = indexInput.patterns.find((pattern) => pattern.patternType === "state" &&
                    (pattern.patternKey === "open-loop" ||
                        pattern.patternKey === "resolved" ||
                        pattern.patternKey === "reopened" ||
                        pattern.patternKey === "superseded"));
                if (loopClusterKeys.length > 0 && loopStatePattern) {
                    for (const loopKey of loopClusterKeys.slice(0, 12)) {
                        try {
                            await options.store.updateLoopState({
                                tenantId: stored.tenantId,
                                loopKey,
                                memoryId: stored.id,
                                state: loopStatePattern.patternKey,
                                confidence: loopStatePattern.confidence,
                                occurredAt: stored.occurredAt,
                                metadata: {
                                    source: stored.source,
                                    runId: stored.runId,
                                    tags: stored.tags,
                                },
                            });
                        }
                        catch {
                            // best-effort loop-state updates
                        }
                    }
                }
            }
            if (indexInput.edges.length > 0 || indexInput.entities.length > 0 || indexInput.patterns.length > 0) {
                try {
                    await options.store.indexSignals(indexInput);
                }
                catch {
                    // best-effort indexing; capture must stay available
                }
            }
        }
        return stored;
    };
    const search = async (raw) => {
        let parsed;
        try {
            parsed = contracts_1.memorySearchRequestSchema.parse(raw);
        }
        catch (error) {
            throw normalizeError(error);
        }
        const tenantId = normalizeTenant(parsed.tenantId);
        const stageTimeoutMs = MEMORY_QUERY_STAGE_TIMEOUT_MS;
        const fallbackStageTimeoutMs = MEMORY_QUERY_FALLBACK_STAGE_TIMEOUT_MS;
        let embedding = null;
        if (parsed.retrievalMode !== "lexical") {
            if (parsed.embedding) {
                embedding = normalizeEmbedding(parsed.embedding);
            }
            else {
                try {
                    embedding = normalizeEmbedding(await withTimeout(embeddingAdapter.embed(parsed.query), MEMORY_QUERY_EMBED_TIMEOUT_MS, "memory search embedding stage"));
                }
                catch (error) {
                    if (!isTransientStoreTimeoutError(error)) {
                        throw error;
                    }
                    embedding = null;
                }
            }
        }
        const effectiveRetrievalMode = parsed.retrievalMode === "lexical" ? "lexical" : embedding ? parsed.retrievalMode : "lexical";
        const allowSources = sanitizeStringList(parsed.sourceAllowlist);
        const denySources = applyDreamDefaultSourceDenylist(allowSources, sanitizeStringList(parsed.sourceDenylist));
        const allowLayers = (0, layers_1.normalizeMemoryLayerList)(parsed.layerAllowlist);
        const denyLayers = (0, layers_1.normalizeMemoryLayerList)(parsed.layerDenylist);
        const cacheKey = buildSearchFallbackCacheKey({
            tenantId,
            agentId: parsed.agentId,
            runId: parsed.runId,
            query: parsed.query,
            retrievalMode: effectiveRetrievalMode,
            allowSources,
            denySources,
            allowLayers,
            denyLayers,
            limit: parsed.limit,
        });
        let rows = [];
        let primarySearchError = null;
        let usedStaleCacheFallback = false;
        const baseSearchInput = {
            query: parsed.query,
            tenantId,
            agentId: parsed.agentId,
            runId: parsed.runId,
            sourceAllowlist: allowSources,
            sourceDenylist: denySources,
            layerAllowlist: allowLayers,
            layerDenylist: denyLayers,
            minScore: parsed.minScore,
            explain: parsed.explain,
            embedding: embedding ?? undefined,
            limit: parsed.limit,
        };
        try {
            rows = filterExpiredSearchResults(await withTimeout(options.store.search({
                ...baseSearchInput,
                retrievalMode: effectiveRetrievalMode,
            }), stageTimeoutMs, "memory search primary stage"));
        }
        catch (error) {
            primarySearchError = error;
            if (MEMORY_QUERY_ENABLE_SEMANTIC_TIMEOUT_FALLBACK &&
                embedding &&
                effectiveRetrievalMode !== "semantic" &&
                isTransientStoreTimeoutError(error)) {
                try {
                    rows = filterExpiredSearchResults(await withTimeout(options.store.search({
                        ...baseSearchInput,
                        retrievalMode: "semantic",
                    }), stageTimeoutMs, "memory search semantic fallback stage"));
                    rows = rows.map((row) => ({
                        ...row,
                        matchedBy: row.matchedBy.includes("semantic-fallback")
                            ? row.matchedBy
                            : [...row.matchedBy, "semantic-fallback"],
                    }));
                    primarySearchError = null;
                }
                catch (fallbackError) {
                    primarySearchError = fallbackError;
                }
            }
            if (primarySearchError &&
                MEMORY_QUERY_ENABLE_LEXICAL_TIMEOUT_FALLBACK &&
                isTransientStoreTimeoutError(primarySearchError) &&
                effectiveRetrievalMode !== "lexical") {
                try {
                    rows = filterExpiredSearchResults(await withTimeout(options.store.search({
                        ...baseSearchInput,
                        retrievalMode: "lexical",
                        embedding: undefined,
                        limit: Math.max(parsed.limit * 3, 24),
                    }), fallbackStageTimeoutMs, "memory search lexical timeout fallback stage"));
                    rows = rows.map((row) => ({
                        ...row,
                        matchedBy: row.matchedBy.includes("lexical-timeout-fallback")
                            ? row.matchedBy
                            : [...row.matchedBy, "lexical-timeout-fallback"],
                    }));
                    primarySearchError = null;
                }
                catch (lexicalFallbackError) {
                    primarySearchError = lexicalFallbackError;
                }
            }
            if (primarySearchError && isTransientStoreTimeoutError(primarySearchError)) {
                const fallbackRows = filterExpiredMemoryRecords(await withTimeout(options.store.recent({
                    tenantId,
                    agentId: parsed.agentId,
                    runId: parsed.runId,
                    sourceAllowlist: allowSources,
                    sourceDenylist: denySources,
                    layerAllowlist: allowLayers,
                    layerDenylist: denyLayers,
                    excludeStatuses: ["quarantined"],
                    limit: Math.max(parsed.limit * 6, 120),
                }), fallbackStageTimeoutMs, "memory search recent fallback stage"));
                const queryTokens = String(parsed.query)
                    .toLowerCase()
                    .split(/\s+/)
                    .map((entry) => entry.replace(/[^a-z0-9._:@/-]+/g, "").trim())
                    .filter((entry) => entry.length >= 3)
                    .slice(0, 20);
                const fallbackScored = fallbackRows
                    .map((row) => {
                    const metadata = normalizeMetadata(row.metadata);
                    const subject = normalizeText(metadata.subjectKey || metadata.subject).toLowerCase();
                    const haystack = `${row.content}\n${subject}`.toLowerCase();
                    const tokenHits = queryTokens.length === 0 ? 0 : queryTokens.reduce((acc, token) => acc + (haystack.includes(token) ? 1 : 0), 0);
                    const lexicalBoost = queryTokens.length === 0 ? 0 : Math.min(0.32, (tokenHits / queryTokens.length) * 0.32);
                    return toSearchResultFromRecord(row, {
                        score: 0.34 + lexicalBoost + row.sourceConfidence * 0.14 + row.importance * 0.14,
                        matchedBy: ["recent-fallback", "lexical-timeout"],
                        scoreBreakdown: {
                            rrf: 0.2 + lexicalBoost,
                            sourceTrust: row.sourceConfidence,
                            recency: recencyScore(row.occurredAt, row.createdAt, row.memoryType),
                            importance: row.importance,
                            session: 0,
                            lexical: lexicalBoost,
                            semantic: 0,
                            sessionLane: 0,
                        },
                    }, Date.now());
                })
                    .sort((left, right) => right.score - left.score || right.createdAt.localeCompare(left.createdAt))
                    .slice(0, Math.max(parsed.limit * 3, parsed.limit));
                rows = fallbackScored;
                if (rows.length === 0) {
                    const cachedRows = readSearchFallbackCache(cacheKey);
                    if (cachedRows && cachedRows.length > 0) {
                        rows = cachedRows.map((row) => ({
                            ...row,
                            matchedBy: row.matchedBy.includes("stale-cache-fallback")
                                ? row.matchedBy
                                : [...row.matchedBy, "stale-cache-fallback"],
                        }));
                    }
                }
                primarySearchError = null;
            }
            if (primarySearchError) {
                const cachedRows = readSearchFallbackCache(cacheKey);
                if (cachedRows && cachedRows.length > 0) {
                    rows = cachedRows.map((row) => ({
                        ...row,
                        matchedBy: row.matchedBy.includes("stale-cache-fallback")
                            ? row.matchedBy
                            : [...row.matchedBy, "stale-cache-fallback"],
                    }));
                    primarySearchError = null;
                    usedStaleCacheFallback = true;
                }
            }
            if (primarySearchError) {
                throw primarySearchError;
            }
        }
        rows = rows.filter((row) => (0, layers_1.isAllowedMemoryLayer)(row.memoryLayer, allowLayers, denyLayers));
        if (!usedStaleCacheFallback && rows.length > 0) {
            writeSearchFallbackCache(cacheKey, rows);
        }
        const boosted = applySignalBoost(rows, parsed.query);
        const applyLoopStateOnRows = async (rowsInput) => {
            if (!options.store.searchLoopState || rowsInput.length === 0)
                return rowsInput;
            const loopKeys = Array.from(new Set(rowsInput.map((row) => loopKeyFromRow(row)).filter(Boolean))).slice(0, 120);
            if (loopKeys.length === 0)
                return rowsInput;
            try {
                const states = await options.store.searchLoopState({
                    tenantId,
                    loopKeys,
                    limit: Math.max(loopKeys.length, 40),
                });
                if (states.length === 0)
                    return rowsInput;
                const stateByKey = new Map(states.map((row) => [normalizePatternKey(row.loopKey), row]));
                return rowsInput.map((row) => {
                    const loopKey = normalizePatternKey(loopKeyFromRow(row));
                    if (!loopKey)
                        return row;
                    return applyLoopStateBoost(row, stateByKey.get(loopKey), parsed.query);
                });
            }
            catch {
                return rowsInput;
            }
        };
        const mergeLoopStatePointerRows = async (rowsInput) => {
            if (!options.store.searchLoopState || rowsInput.length === 0)
                return rowsInput;
            const preferredStates = preferredLoopStatesForQuery(parsed.query);
            if (preferredStates.length === 0)
                return rowsInput;
            const loopKeys = Array.from(new Set(rowsInput.map((row) => loopKeyFromRow(row)).filter(Boolean))).slice(0, 160);
            if (loopKeys.length === 0)
                return rowsInput;
            let states = [];
            try {
                states = await options.store.searchLoopState({
                    tenantId,
                    loopKeys,
                    states: preferredStates,
                    limit: Math.max(loopKeys.length * 2, 64),
                });
            }
            catch {
                return rowsInput;
            }
            if (states.length === 0)
                return rowsInput;
            const existingIds = new Set(rowsInput.map((row) => row.id));
            const pointerById = new Map();
            const pointerIdOrder = [];
            const pushPointer = (id, state) => {
                const normalized = String(id ?? "").trim();
                if (!normalized)
                    return;
                if (existingIds.has(normalized))
                    return;
                if (pointerById.has(normalized))
                    return;
                pointerById.set(normalized, state);
                pointerIdOrder.push(normalized);
            };
            for (const state of states) {
                const current = String(state.currentState ?? "").toLowerCase();
                if (current === "open-loop") {
                    pushPointer(state.lastOpenMemoryId || state.lastMemoryId, state);
                    continue;
                }
                if (current === "reopened") {
                    pushPointer(state.lastOpenMemoryId || state.lastMemoryId, state);
                    continue;
                }
                if (current === "resolved") {
                    pushPointer(state.lastResolvedMemoryId || state.lastMemoryId, state);
                    continue;
                }
                if (current === "superseded") {
                    pushPointer(state.lastMemoryId || state.lastResolvedMemoryId, state);
                    continue;
                }
                pushPointer(state.lastMemoryId, state);
            }
            if (pointerIdOrder.length === 0)
                return rowsInput;
            const fetched = await options.store.getByIds({
                ids: pointerIdOrder.slice(0, 120),
                tenantId,
            });
            const additions = [];
            for (const row of fetched) {
                if (row.status === "quarantined")
                    continue;
                if (!sourceAllowed(row.source, allowSources, denySources))
                    continue;
                const loopState = pointerById.get(row.id);
                const base = toSearchResultFromRecord(row, {
                    matchedBy: ["pattern"],
                    scoreBreakdown: {
                        rrf: 0.14,
                        sourceTrust: row.sourceConfidence,
                        recency: recencyScore(row.occurredAt, row.createdAt, row.memoryType),
                        importance: row.importance,
                        session: 0,
                        lexical: 0,
                        semantic: 0,
                        sessionLane: 0,
                    },
                }, Date.now());
                const withLoop = applyLoopStateBoost(base, loopState, parsed.query);
                const pointerBoost = 0.05 + 0.09 * clamp01(loopState?.confidence, 0.58);
                additions.push({
                    ...withLoop,
                    score: withLoop.score + pointerBoost,
                    scoreBreakdown: {
                        ...withLoop.scoreBreakdown,
                        pattern: (withLoop.scoreBreakdown.pattern ?? 0) + pointerBoost,
                    },
                    matchedBy: withLoop.matchedBy.includes("pattern") ? withLoop.matchedBy : [...withLoop.matchedBy, "pattern"],
                });
            }
            if (additions.length === 0)
                return rowsInput;
            const merged = [...rowsInput];
            for (const row of additions) {
                if (existingIds.has(row.id))
                    continue;
                existingIds.add(row.id);
                merged.push(row);
            }
            return merged;
        };
        const applyRequestedScope = (rowsInput) => {
            const requestedAgentId = String(parsed.agentId ?? "").trim();
            const requestedRunId = String(parsed.runId ?? "").trim();
            if (!requestedAgentId && !requestedRunId && allowLayers.length === 0 && denyLayers.length === 0)
                return rowsInput;
            return rowsInput.filter((row) => {
                if (requestedAgentId && row.agentId !== requestedAgentId)
                    return false;
                if (requestedRunId && row.runId !== requestedRunId)
                    return false;
                if (!(0, layers_1.isAllowedMemoryLayer)(row.memoryLayer, allowLayers, denyLayers))
                    return false;
                return true;
            });
        };
        if (!options.store.related) {
            const withLoopState = await applyLoopStateOnRows(boosted);
            const withLoopPointers = await mergeLoopStatePointerRows(withLoopState);
            return diversifyRankedRows(filterExpiredSearchResults(applyRequestedScope(withLoopPointers)).sort((left, right) => right.score - left.score || right.createdAt.localeCompare(left.createdAt)), parsed.limit);
        }
        const entityHints = extractQueryEntityHints(parsed.query);
        const patternHints = extractQueryPatternHints(parsed.query);
        const seedIds = boosted.slice(0, Math.max(4, Math.min(12, parsed.limit))).map((row) => row.id);
        if (seedIds.length === 0 && entityHints.length === 0 && patternHints.length === 0) {
            const withLoopState = await applyLoopStateOnRows(boosted);
            const withLoopPointers = await mergeLoopStatePointerRows(withLoopState);
            return diversifyRankedRows(filterExpiredSearchResults(applyRequestedScope(withLoopPointers)).sort((left, right) => right.score - left.score || right.createdAt.localeCompare(left.createdAt)), parsed.limit);
        }
        let related = [];
        try {
            related = await options.store.related({
                tenantId,
                seedIds,
                entityHints,
                patternHints,
                limit: Math.max(parsed.limit * 4, 32),
                maxHops: 2,
                includeSeed: false,
            });
        }
        catch {
            const withLoopState = await applyLoopStateOnRows(boosted);
            const withLoopPointers = await mergeLoopStatePointerRows(withLoopState);
            return diversifyRankedRows(filterExpiredSearchResults(applyRequestedScope(withLoopPointers)).sort((left, right) => right.score - left.score || right.createdAt.localeCompare(left.createdAt)), parsed.limit);
        }
        if (related.length === 0) {
            const withLoopState = await applyLoopStateOnRows(boosted);
            const withLoopPointers = await mergeLoopStatePointerRows(withLoopState);
            return diversifyRankedRows(filterExpiredSearchResults(applyRequestedScope(withLoopPointers)).sort((left, right) => right.score - left.score || right.createdAt.localeCompare(left.createdAt)), parsed.limit);
        }
        const relatedById = new Map(related.map((row) => [row.id, row]));
        const seeded = boosted.map((row) => applyRelatedBoost(row, relatedById.get(row.id)));
        const seededById = new Map(seeded.map((row) => [row.id, row]));
        const missingIds = related.map((row) => row.id).filter((id) => !seededById.has(id));
        if (missingIds.length > 0) {
            const fetched = await options.store.getByIds({
                ids: missingIds,
                tenantId,
            });
            for (const row of fetched) {
                if (row.status === "quarantined")
                    continue;
                if (isExpiredRecord(row))
                    continue;
                if (!sourceAllowed(row.source, allowSources, denySources)) {
                    continue;
                }
                const base = toSearchResultFromRecord(row, {
                    matchedBy: ["relationship"],
                    scoreBreakdown: {
                        rrf: 0.16,
                        sourceTrust: row.sourceConfidence,
                        recency: recencyScore(row.occurredAt, row.createdAt, row.memoryType),
                        importance: row.importance,
                        session: 0,
                        lexical: 0,
                        semantic: 0,
                        sessionLane: 0,
                    },
                }, Date.now());
                seededById.set(base.id, applyRelatedBoost(base, relatedById.get(base.id)));
            }
        }
        let reranked = Array.from(seededById.values())
            .sort((left, right) => right.score - left.score || right.createdAt.localeCompare(left.createdAt))
            .slice(0, Math.max(parsed.limit * 4, parsed.limit));
        reranked = await applyLoopStateOnRows(reranked);
        reranked = await mergeLoopStatePointerRows(reranked);
        return diversifyRankedRows(filterExpiredSearchResults(applyRequestedScope(reranked)), parsed.limit);
    };
    const recent = async (raw) => {
        let parsed;
        try {
            parsed = contracts_1.memoryRecentRequestSchema.parse(raw);
        }
        catch (error) {
            throw normalizeError(error);
        }
        const tenantId = normalizeTenant(parsed.tenantId);
        return filterExpiredMemoryRecords(await options.store.recent({
            tenantId,
            layerAllowlist: (0, layers_1.normalizeMemoryLayerList)(parsed.layerAllowlist),
            layerDenylist: (0, layers_1.normalizeMemoryLayerList)(parsed.layerDenylist),
            limit: parsed.limit,
        }));
    };
    const getByIds = async (raw) => {
        let parsed;
        try {
            parsed = zod_1.z
                .object({
                tenantId: zod_1.z.string().trim().min(1).max(128).optional(),
                ids: zod_1.z.array(zod_1.z.string().trim().min(1).max(128)).min(1).max(500),
                includeArchived: zod_1.z.boolean().default(false),
            })
                .parse(raw);
        }
        catch (error) {
            throw normalizeError(error);
        }
        const tenantId = normalizeTenant(parsed.tenantId);
        const uniqueIds = Array.from(new Set(parsed.ids.map((id) => String(id ?? "").trim()).filter(Boolean)));
        if (uniqueIds.length === 0)
            return [];
        const rows = await options.store.getByIds({
            tenantId,
            ids: uniqueIds,
        });
        const filtered = parsed.includeArchived ? rows : filterExpiredMemoryRecords(rows);
        const byId = new Map(filtered.map((row) => [row.id, row]));
        return uniqueIds
            .map((id) => byId.get(id))
            .filter((row) => Boolean(row));
    };
    const stats = async (raw) => {
        let parsed;
        try {
            parsed = contracts_1.memoryStatsRequestSchema.parse(raw);
        }
        catch (error) {
            throw normalizeError(error);
        }
        const tenantId = normalizeTenant(parsed.tenantId);
        const base = await options.store.stats({
            tenantId,
            layerAllowlist: (0, layers_1.normalizeMemoryLayerList)(parsed.layerAllowlist),
            layerDenylist: (0, layers_1.normalizeMemoryLayerList)(parsed.layerDenylist),
        });
        const brief = readMemoryBriefArtifact();
        const consolidation = readMemoryConsolidationArtifact();
        const fallbackCounts = new Map();
        for (const source of brief?.fallbackSources ?? []) {
            const normalized = normalizeSource(source);
            if (!normalized)
                continue;
            fallbackCounts.set(normalized, (fallbackCounts.get(normalized) ?? 0) + 1);
        }
        const lastRunAt = normalizeText(consolidation?.finishedAt || consolidation?.lastSuccessAt || brief?.consolidation?.lastRunAt);
        const nextRunAt = normalizeText(consolidation?.nextRunAt || brief?.consolidation?.nextRunAt);
        const lastRunMs = Number.isFinite(Date.parse(lastRunAt)) ? Date.parse(lastRunAt) : null;
        const staleWarning = lastRunMs === null
            ? true
            : Date.now() - lastRunMs > MEMORY_CONSOLIDATION_STALE_WARNING_HOURS * 60 * 60 * 1000;
        return {
            ...base,
            byLayer: base.byLayer.length > 0 ? base.byLayer : countByLayer([]),
            byStatus: base.byStatus ?? [],
            continuity: {
                state: brief?.continuityState === "ready" || brief?.continuityState === "continuity_degraded" || brief?.continuityState === "missing"
                    ? brief.continuityState
                    : "unknown",
                fallbackSources: Array.from(fallbackCounts.entries())
                    .map(([source, count]) => ({ source, count }))
                    .sort((left, right) => right.count - left.count || left.source.localeCompare(right.source)),
                continuityHitRate: brief?.continuityState === "ready" ? 1 : 0,
                degradedStartupRate: brief?.continuityState === "continuity_degraded" ? 1 : 0,
            },
            consolidation: {
                status: consolidation?.status === "running"
                    ? "running"
                    : consolidation?.status === "failed"
                        ? "failed"
                        : staleWarning
                            ? "stale"
                            : lastRunAt
                                ? "success"
                                : brief?.consolidation?.mode === "unavailable"
                                    ? "unavailable"
                                    : "idle",
                mode: normalizeText(consolidation?.mode || brief?.consolidation?.mode) || null,
                lastRunAt: lastRunAt || null,
                nextRunAt: nextRunAt || null,
                successCount: lastRunAt ? 1 : 0,
                failureCount: consolidation?.status === "failed" ? 1 : 0,
                promotionCount: Math.max(0, Number(consolidation?.promotionCount ?? 0)),
                quarantineCount: Math.max(0, Number(consolidation?.quarantineCount ?? 0)),
                archiveCount: Math.max(0, Number(consolidation?.archiveCount ?? 0)),
                repairedEdgeCount: Math.max(0, Number(consolidation?.repairedEdgeCount ?? 0)),
                staleWarning,
                lastError: normalizeText(consolidation?.lastError) || null,
                influence: Array.isArray(consolidation?.focusAreas)
                    ? consolidation.focusAreas.map((entry) => normalizeText(entry)).filter(Boolean).slice(0, 6)
                    : Array.isArray(brief?.consolidation?.focusAreas)
                        ? brief.consolidation.focusAreas.map((entry) => normalizeText(entry)).filter(Boolean).slice(0, 6)
                        : [],
            },
        };
    };
    const loops = async (raw) => {
        let parsed;
        try {
            parsed = contracts_1.memoryLoopsRequestSchema.parse(raw);
        }
        catch (error) {
            throw normalizeError(error);
        }
        const tenantId = normalizeTenant(parsed.tenantId);
        const query = parsed.query?.trim() ?? "";
        const requestedStates = parsed.states.length > 0 ? parsed.states : preferredLoopStatesForQuery(query);
        if (!options.store.searchLoopState) {
            return {
                rows: [],
                incidents: [],
                summary: {
                    total: 0,
                    incidentCount: 0,
                    byState: [],
                    byLane: [],
                    highestAttentionScore: 0,
                    highestVolatilityScore: 0,
                    highestAnomalyScore: 0,
                    highestCentralityScore: 0,
                    highestFeedbackScore: 0,
                    highestEscalationScore: 0,
                    highestBlastRadiusScore: 0,
                    feedbackCoverage: 0,
                    ownerQueues: [],
                    sla: {
                        healthy: 0,
                        atRisk: 0,
                        breached: 0,
                        soonestBreachHours: null,
                    },
                    hotspots: {
                        threads: [],
                        actors: [],
                    },
                    calibration: calibrateLoopAttentionThresholds([]),
                },
            };
        }
        const loopKeys = Array.from(new Set(parsed.loopKeys.map((value) => normalizePatternKey(value)).filter(Boolean)));
        let loopRows = await options.store.searchLoopState({
            tenantId,
            loopKeys: loopKeys.length > 0 ? loopKeys : undefined,
            states: requestedStates.length > 0 ? requestedStates : undefined,
            limit: Math.max(parsed.limit * 4, parsed.limit),
        });
        if (query) {
            const queryLower = query.toLowerCase();
            const signals = parseQuerySignals(query);
            loopRows = loopRows.filter((row) => {
                const loopKey = row.loopKey.toLowerCase();
                const state = String(row.currentState ?? "").toLowerCase();
                if (loopKey.includes(queryLower) || state.includes(queryLower))
                    return true;
                if (signals.openLoop && (state === "open-loop" || state === "reopened"))
                    return true;
                if (signals.resolved && state === "resolved")
                    return true;
                if (signals.reopened && state === "reopened")
                    return true;
                if (signals.superseded && state === "superseded")
                    return true;
                if (signals.latest)
                    return true;
                return false;
            });
        }
        const feedbackByLoop = new Map();
        if (options.store.searchLoopFeedbackStats && loopRows.length > 0) {
            try {
                const feedbackRows = await options.store.searchLoopFeedbackStats({
                    tenantId,
                    loopKeys: loopRows.map((row) => row.loopKey),
                    limit: Math.max(loopRows.length * 2, 120),
                    windowDays: 180,
                });
                for (const row of feedbackRows) {
                    const key = normalizePatternKey(row.loopKey);
                    if (!key)
                        continue;
                    feedbackByLoop.set(key, {
                        ackCount: Number(row.ackCount ?? 0),
                        assignCount: Number(row.assignCount ?? 0),
                        snoozeCount: Number(row.snoozeCount ?? 0),
                        resolveCount: Number(row.resolveCount ?? 0),
                        falsePositiveCount: Number(row.falsePositiveCount ?? 0),
                        escalateCount: Number(row.escalateCount ?? 0),
                        totalCount: Number(row.totalCount ?? 0),
                        lastActionAt: row.lastActionAt ?? null,
                    });
                }
            }
            catch {
                // best-effort outcome tuning
            }
        }
        const pointerIdsForScoring = Array.from(new Set(loopRows
            .map((row) => pointerMemoryIdForLoopState(row))
            .map((value) => String(value ?? "").trim())
            .filter((value) => value.length > 0))).slice(0, Math.max(parsed.limit * 8, 160));
        const pointerRowsById = new Map();
        if (pointerIdsForScoring.length > 0) {
            try {
                const pointerRows = await options.store.getByIds({
                    ids: pointerIdsForScoring,
                    tenantId,
                });
                for (const row of pointerRows) {
                    if (row.status === "quarantined")
                        continue;
                    pointerRowsById.set(row.id, row);
                }
            }
            catch {
                // best-effort scoring fallback without pointer rows
            }
        }
        const activeThreadCounts = new Map();
        const activeParticipantCounts = new Map();
        const activeActorCounts = new Map();
        const loopThreadSignalsByKey = new Map();
        const authoredMessageToLoopKeys = new Map();
        const referenceMessageToLoopKeys = new Map();
        const addLoopLookup = (map, key, loopKey) => {
            const bucket = map.get(key) ?? new Set();
            bucket.add(loopKey);
            map.set(key, bucket);
        };
        for (const stateRow of loopRows) {
            const current = String(stateRow.currentState ?? "").toLowerCase();
            const pointerId = String(pointerMemoryIdForLoopState(stateRow) ?? "").trim();
            if (!pointerId)
                continue;
            const pointer = pointerRowsById.get(pointerId);
            if (!pointer)
                continue;
            const metadata = normalizeMetadata(pointer.metadata);
            const threadKey = threadKeyFromMetadata(metadata);
            const participantKey = normalizeText(metadata.participantKey);
            const actorTokens = Array.from(new Set([
                ...readStringTokens(metadata.participantKey, 12),
                ...readStringTokens(metadata.participants, 16),
                ...readStringTokens(metadata.from, 6),
                ...readStringTokens(metadata.to, 12),
                ...readStringTokens(metadata.cc, 12),
            ].filter(Boolean))).slice(0, 16);
            const normalizedLoopKey = normalizePatternKey(stateRow.loopKey);
            if (normalizedLoopKey) {
                const authoredMessageIds = normalizeMessageReferenceList([metadata.normalizedMessageId, metadata.messageId, metadata.rawMessageId], 12);
                const referenceMessageIds = normalizeMessageReferenceList([metadata.referenceMessageIds, metadata.inReplyToNormalized, metadata.inReplyTo, metadata.replyTo, metadata.references], 64);
                const signal = loopThreadSignalsByKey.get(normalizedLoopKey) ??
                    {
                        authoredMessageIds: new Set(),
                        referenceMessageIds: new Set(),
                        participantTokens: new Set(),
                    };
                for (const messageId of authoredMessageIds) {
                    if (!messageId)
                        continue;
                    signal.authoredMessageIds.add(messageId);
                    addLoopLookup(authoredMessageToLoopKeys, messageId, normalizedLoopKey);
                }
                for (const messageId of referenceMessageIds) {
                    if (!messageId)
                        continue;
                    signal.referenceMessageIds.add(messageId);
                    addLoopLookup(referenceMessageToLoopKeys, messageId, normalizedLoopKey);
                }
                for (const actor of actorTokens) {
                    if (!actor)
                        continue;
                    signal.participantTokens.add(String(actor).toLowerCase());
                }
                loopThreadSignalsByKey.set(normalizedLoopKey, signal);
            }
            if (current !== "open-loop" && current !== "reopened")
                continue;
            if (threadKey)
                activeThreadCounts.set(threadKey, (activeThreadCounts.get(threadKey) ?? 0) + 1);
            if (participantKey)
                activeParticipantCounts.set(participantKey, (activeParticipantCounts.get(participantKey) ?? 0) + 1);
            for (const actor of actorTokens) {
                activeActorCounts.set(actor, (activeActorCounts.get(actor) ?? 0) + 1);
            }
        }
        const querySignalsForLoops = parseQuerySignals(query);
        let scored = loopRows.map((row) => {
            const attention = computeLoopAttention(row, query);
            const anomaly = detectLoopBurstAnomaly(row, query);
            const pointerMemoryId = pointerMemoryIdForLoopState(row);
            const pointerRow = pointerMemoryId ? pointerRowsById.get(pointerMemoryId) : undefined;
            const metadata = normalizeMetadata(pointerRow?.metadata);
            const threadKey = threadKeyFromMetadata(metadata);
            const participantKey = normalizeText(metadata.participantKey);
            const actorTokens = Array.from(new Set([
                ...readStringTokens(metadata.participantKey, 12),
                ...readStringTokens(metadata.participants, 16),
                ...readStringTokens(metadata.from, 6),
                ...readStringTokens(metadata.to, 12),
                ...readStringTokens(metadata.cc, 12),
            ].filter(Boolean))).slice(0, 16);
            const normalizedLoopKey = normalizePatternKey(row.loopKey);
            const loopThreadSignals = normalizedLoopKey ? loopThreadSignalsByKey.get(normalizedLoopKey) : undefined;
            const deterministicAuthoredMessageIds = loopThreadSignals
                ? Array.from(loopThreadSignals.authoredMessageIds)
                : normalizeMessageReferenceList([metadata.normalizedMessageId, metadata.messageId, metadata.rawMessageId], 12);
            const deterministicReferenceMessageIds = loopThreadSignals
                ? Array.from(loopThreadSignals.referenceMessageIds)
                : normalizeMessageReferenceList([metadata.referenceMessageIds, metadata.inReplyToNormalized, metadata.inReplyTo, metadata.replyTo, metadata.references], 64);
            const parentLinkedLoops = new Set();
            if (normalizedLoopKey) {
                for (const referenceId of deterministicReferenceMessageIds) {
                    const linked = authoredMessageToLoopKeys.get(referenceId);
                    if (!linked)
                        continue;
                    for (const linkedLoopKey of linked) {
                        if (linkedLoopKey && linkedLoopKey !== normalizedLoopKey)
                            parentLinkedLoops.add(linkedLoopKey);
                    }
                }
            }
            const childLinkedLoops = new Set();
            if (normalizedLoopKey) {
                for (const messageId of deterministicAuthoredMessageIds) {
                    const linked = referenceMessageToLoopKeys.get(messageId);
                    if (!linked)
                        continue;
                    for (const linkedLoopKey of linked) {
                        if (linkedLoopKey && linkedLoopKey !== normalizedLoopKey)
                            childLinkedLoops.add(linkedLoopKey);
                    }
                }
            }
            const linkedLoopKeys = new Set([...parentLinkedLoops, ...childLinkedLoops]);
            const participantSignalTokens = loopThreadSignals?.participantTokens ?? new Set(actorTokens.map((token) => token.toLowerCase()));
            let strongestParticipantOverlap = 0;
            for (const linkedLoopKey of linkedLoopKeys) {
                const linkedSignals = loopThreadSignalsByKey.get(linkedLoopKey);
                if (!linkedSignals)
                    continue;
                strongestParticipantOverlap = Math.max(strongestParticipantOverlap, tokenSetOverlapScore(participantSignalTokens, linkedSignals.participantTokens));
            }
            const threadReconstructionScore = Number(clamp01((deterministicAuthoredMessageIds.length > 0 ? 0.18 : 0) +
                Math.min(0.26, deterministicReferenceMessageIds.length * 0.055) +
                Math.min(0.24, parentLinkedLoops.size * 0.11) +
                Math.min(0.18, childLinkedLoops.size * 0.085) +
                Math.min(0.24, strongestParticipantOverlap * 0.34) +
                (threadKey ? 0.08 : 0), 0).toFixed(3));
            const entityCount = Math.max(readArrayCount(metadata.entityHints), readArrayCount(metadata.entities));
            const patternCount = Math.max(readArrayCount(metadata.patternHints), readArrayCount(metadata.patterns));
            const emailThreadDepth = Math.max(0, Number(metadata.threadDepthEstimate ?? 0));
            const emailReferenceDepth = deterministicReferenceMessageIds.length;
            const emailParticipantCount = Math.max(readStringValues(metadata.participants, 48).length, actorTokens.length);
            const emailDomainCount = readStringValues(metadata.participantDomains, 24).length;
            const emailIntensity = clamp01(emailThreadDepth * 0.07 +
                emailReferenceDepth * 0.05 +
                emailParticipantCount * 0.025 +
                emailDomainCount * 0.045 +
                (String(pointerRow?.source ?? "").toLowerCase().startsWith("mail:") ? 0.12 : 0), 0);
            const centralityBase = (threadKey ? 0.12 : 0) +
                Math.min(0.22, entityCount * 0.03) +
                Math.min(0.18, patternCount * 0.024) +
                (participantKey ? 0.09 : 0) +
                Math.min(0.2, emailIntensity * 0.24) +
                Math.min(0.24, threadReconstructionScore * 0.3);
            const activeThreadBoost = threadKey ? Math.min(0.28, Math.max(0, (activeThreadCounts.get(threadKey) ?? 1) - 1) * 0.1) : 0;
            const activeParticipantBoost = participantKey
                ? Math.min(0.2, Math.max(0, (activeParticipantCounts.get(participantKey) ?? 1) - 1) * 0.07)
                : 0;
            const actorHubBoost = actorTokens.length > 0
                ? Math.min(0.26, Math.max(0, actorTokens.reduce((best, actor) => Math.max(best, (activeActorCounts.get(actor) ?? 1) - 1), 0)) * 0.06)
                : 0;
            const centralityScore = Number(clamp01(centralityBase + activeThreadBoost + activeParticipantBoost + actorHubBoost, 0).toFixed(3));
            const isOpenLike = String(row.currentState ?? "").toLowerCase() === "open-loop" || String(row.currentState ?? "").toLowerCase() === "reopened";
            const blastRadiusScore = Number(clamp01(activeThreadBoost * 1.25 +
                activeParticipantBoost * 1.15 +
                actorHubBoost * 1.2 +
                emailIntensity * 0.46 +
                threadReconstructionScore * 0.33 +
                Math.min(0.1, parentLinkedLoops.size * 0.03) +
                Math.min(0.08, childLinkedLoops.size * 0.025) +
                Math.min(0.09, strongestParticipantOverlap * 0.18) +
                Math.min(0.14, emailDomainCount * 0.03) +
                Math.min(0.12, emailParticipantCount * 0.015) +
                Math.min(0.22, entityCount * 0.022) +
                Math.min(0.16, patternCount * 0.018) +
                (isOpenLike ? 0.08 : 0) +
                (querySignalsForLoops.spread ? 0.06 : 0), 0).toFixed(3));
            const totalTransitions = Math.max(0, Number(row.openEvents ?? 0)) +
                Math.max(0, Number(row.reopenedEvents ?? 0)) +
                Math.max(0, Number(row.resolvedEvents ?? 0)) +
                Math.max(0, Number(row.supersededEvents ?? 0));
            const unresolvedBalance = Math.max(0, Math.max(0, Number(row.openEvents ?? 0)) +
                Math.max(0, Number(row.reopenedEvents ?? 0)) -
                Math.max(0, Number(row.resolvedEvents ?? 0)) -
                Math.max(0, Number(row.supersededEvents ?? 0)));
            const unresolvedPressure = clamp01(totalTransitions > 0 ? unresolvedBalance / totalTransitions : 0, 0);
            const feedback = feedbackByLoop.get(normalizePatternKey(row.loopKey));
            const feedbackAdjustment = computeLoopFeedbackAdjustment(feedback, query);
            const escalationScore = Number(Math.max(0, Math.min(2, attention.score * 0.58 +
                attention.volatility * 0.36 +
                anomaly.score * 0.45 +
                centralityScore * 0.28 +
                blastRadiusScore * 0.38 +
                emailIntensity * 0.2 +
                threadReconstructionScore * 0.21 +
                Math.min(0.32, attention.stagnationDays * 0.018) +
                unresolvedPressure * 0.24 +
                (String(row.currentState ?? "").toLowerCase() === "reopened" ? 0.12 : 0) +
                (querySignalsForLoops.urgent ? 0.08 : 0) +
                feedbackAdjustment.escalationDelta)).toFixed(3));
            const attentionScore = Number(Math.max(0, Math.min(2, attention.score +
                anomaly.score * 0.18 +
                centralityScore * 0.16 +
                blastRadiusScore * 0.11 +
                emailIntensity * 0.08 +
                feedbackAdjustment.attentionDelta)).toFixed(3));
            const attentionReasons = Array.from(new Set([
                ...attention.reasons,
                ...anomaly.reasons,
                ...feedbackAdjustment.reasons,
                ...(centralityScore >= 0.35 ? ["graph-centrality"] : []),
                ...(activeThreadBoost >= 0.12 ? ["thread-hub"] : []),
                ...(activeParticipantBoost >= 0.1 ? ["participant-hub"] : []),
                ...(actorHubBoost >= 0.09 ? ["actor-hub"] : []),
                ...(threadReconstructionScore >= 0.32 ? ["thread-reconstruction"] : []),
                ...(parentLinkedLoops.size >= 1 ? ["thread-parent-link"] : []),
                ...(childLinkedLoops.size >= 1 ? ["thread-child-link"] : []),
                ...(strongestParticipantOverlap >= 0.3 ? ["thread-participant-overlap"] : []),
                ...(emailThreadDepth >= 3 ? ["email-thread-depth"] : []),
                ...(emailReferenceDepth >= 2 ? ["email-reference-chain"] : []),
                ...(emailParticipantCount >= 5 ? ["email-participant-fanout"] : []),
                ...(emailDomainCount >= 2 ? ["email-domain-fanout"] : []),
                ...(blastRadiusScore >= 0.4 ? ["blast-radius"] : []),
                ...(escalationScore >= 1 ? ["escalation-risk"] : []),
            ])).slice(0, 10);
            return {
                loop: row,
                attentionScore,
                attentionReasons,
                attentionLane: attention.lane,
                volatilityScore: attention.volatility,
                stagnationDays: attention.stagnationDays,
                anomalyScore: anomaly.score,
                anomalyReasons: anomaly.reasons,
                centralityScore,
                feedbackScore: feedbackAdjustment.feedbackScore,
                lastFeedbackAt: feedback?.lastActionAt ?? null,
                feedbackCounts: {
                    ackCount: feedback?.ackCount ?? 0,
                    assignCount: feedback?.assignCount ?? 0,
                    snoozeCount: feedback?.snoozeCount ?? 0,
                    resolveCount: feedback?.resolveCount ?? 0,
                    falsePositiveCount: feedback?.falsePositiveCount ?? 0,
                    escalateCount: feedback?.escalateCount ?? 0,
                },
                escalationScore,
                blastRadiusScore,
                recommendedAction: recommendedLoopAction({
                    state: String(row.currentState ?? "").toLowerCase(),
                    lane: attention.lane,
                    escalationScore,
                    anomalyScore: anomaly.score,
                    blastRadiusScore,
                    stagnationDays: attention.stagnationDays,
                }),
                pointerMemoryId,
            };
        });
        const calibration = calibrateLoopAttentionThresholds(scored.map((entry) => ({
            attentionScore: entry.attentionScore,
            volatilityScore: entry.volatilityScore,
            anomalyScore: entry.anomalyScore,
            centralityScore: entry.centralityScore,
            escalationScore: entry.escalationScore,
            blastRadiusScore: entry.blastRadiusScore,
            stagnationDays: entry.stagnationDays,
            currentState: String(entry.loop.currentState ?? ""),
        })));
        scored = scored.map((entry) => {
            const lane = assignCalibratedAttentionLane({
                attentionScore: entry.attentionScore,
                volatilityScore: entry.volatilityScore,
                anomalyScore: entry.anomalyScore,
                centralityScore: entry.centralityScore,
                escalationScore: entry.escalationScore,
                blastRadiusScore: entry.blastRadiusScore,
                stagnationDays: entry.stagnationDays,
                currentState: String(entry.loop.currentState ?? ""),
            }, calibration);
            const reasons = entry.attentionReasons.filter((reason) => !reason.startsWith("lane:"));
            reasons.push(`lane:${lane}`);
            return {
                ...entry,
                attentionLane: lane,
                attentionReasons: Array.from(new Set(reasons)).slice(0, 10),
                recommendedAction: recommendedLoopAction({
                    state: String(entry.loop.currentState ?? "").toLowerCase(),
                    lane,
                    escalationScore: entry.escalationScore,
                    anomalyScore: entry.anomalyScore,
                    blastRadiusScore: entry.blastRadiusScore,
                    stagnationDays: entry.stagnationDays,
                }),
            };
        });
        const minAttention = parsed.minAttention;
        const minVolatility = parsed.minVolatility;
        const minAnomaly = parsed.minAnomaly;
        const minCentrality = parsed.minCentrality;
        const minEscalation = parsed.minEscalation;
        const minBlastRadius = parsed.minBlastRadius;
        const laneFilter = parsed.lanes.length > 0 ? new Set(parsed.lanes) : null;
        if (typeof minAttention === "number" && Number.isFinite(minAttention)) {
            scored = scored.filter((row) => row.attentionScore >= minAttention);
        }
        if (typeof minVolatility === "number" && Number.isFinite(minVolatility)) {
            scored = scored.filter((row) => row.volatilityScore >= minVolatility);
        }
        if (typeof minAnomaly === "number" && Number.isFinite(minAnomaly)) {
            scored = scored.filter((row) => row.anomalyScore >= minAnomaly);
        }
        if (typeof minCentrality === "number" && Number.isFinite(minCentrality)) {
            scored = scored.filter((row) => row.centralityScore >= minCentrality);
        }
        if (typeof minEscalation === "number" && Number.isFinite(minEscalation)) {
            scored = scored.filter((row) => row.escalationScore >= minEscalation);
        }
        if (typeof minBlastRadius === "number" && Number.isFinite(minBlastRadius)) {
            scored = scored.filter((row) => row.blastRadiusScore >= minBlastRadius);
        }
        if (laneFilter) {
            scored = scored.filter((row) => laneFilter.has(row.attentionLane));
        }
        scored.sort((left, right) => {
            if (parsed.sortBy === "updatedAt") {
                return right.loop.updatedAt.localeCompare(left.loop.updatedAt) || right.attentionScore - left.attentionScore;
            }
            if (parsed.sortBy === "confidence") {
                return right.loop.confidence - left.loop.confidence || right.attentionScore - left.attentionScore;
            }
            if (parsed.sortBy === "anomaly") {
                return right.anomalyScore - left.anomalyScore || right.attentionScore - left.attentionScore;
            }
            if (parsed.sortBy === "centrality") {
                return right.centralityScore - left.centralityScore || right.attentionScore - left.attentionScore;
            }
            if (parsed.sortBy === "escalation") {
                return right.escalationScore - left.escalationScore || right.attentionScore - left.attentionScore;
            }
            if (parsed.sortBy === "blastRadius") {
                return right.blastRadiusScore - left.blastRadiusScore || right.attentionScore - left.attentionScore;
            }
            if (parsed.sortBy === "volatility") {
                return right.volatilityScore - left.volatilityScore || right.attentionScore - left.attentionScore;
            }
            return (right.escalationScore - left.escalationScore ||
                right.attentionScore - left.attentionScore ||
                right.anomalyScore - left.anomalyScore ||
                right.blastRadiusScore - left.blastRadiusScore ||
                right.centralityScore - left.centralityScore ||
                right.volatilityScore - left.volatilityScore ||
                right.loop.updatedAt.localeCompare(left.loop.updatedAt));
        });
        const selected = scored.slice(0, parsed.limit);
        const pointerMap = new Map();
        if (selected.length > 0) {
            const pointerIds = Array.from(new Set(selected
                .map((row) => String(row.pointerMemoryId ?? "").trim())
                .filter((value) => value.length > 0)));
            const missingPointerIds = pointerIds.filter((id) => !pointerRowsById.has(id));
            if (missingPointerIds.length > 0) {
                try {
                    const fetched = await options.store.getByIds({ ids: missingPointerIds.slice(0, 180), tenantId });
                    for (const row of fetched) {
                        if (row.status === "quarantined")
                            continue;
                        pointerRowsById.set(row.id, row);
                    }
                }
                catch {
                    // best-effort hydration
                }
            }
            if (parsed.includeMemory) {
                for (const entry of selected) {
                    const pointerId = String(entry.pointerMemoryId ?? "").trim();
                    if (!pointerId)
                        continue;
                    const row = pointerRowsById.get(pointerId);
                    if (!row)
                        continue;
                    if (row.status === "quarantined")
                        continue;
                    const base = toSearchResultFromRecord(row, {
                        matchedBy: ["pattern"],
                        scoreBreakdown: {
                            rrf: 0.14,
                            sourceTrust: row.sourceConfidence,
                            recency: recencyScore(row.occurredAt, row.createdAt, row.memoryType),
                            importance: row.importance,
                            session: 0,
                            lexical: 0,
                            semantic: 0,
                            sessionLane: 0,
                        },
                    }, Date.now());
                    pointerMap.set(row.id, applyLoopStateBoost(base, entry.loop, query));
                }
            }
        }
        const rows = selected.map((entry) => ({
            loopKey: entry.loop.loopKey,
            currentState: entry.loop.currentState,
            confidence: entry.loop.confidence,
            attentionScore: entry.attentionScore,
            attentionLane: entry.attentionLane,
            attentionReasons: entry.attentionReasons,
            volatilityScore: entry.volatilityScore,
            stagnationDays: entry.stagnationDays,
            anomalyScore: entry.anomalyScore,
            anomalyReasons: entry.anomalyReasons,
            centralityScore: entry.centralityScore,
            feedbackScore: entry.feedbackScore,
            lastFeedbackAt: entry.lastFeedbackAt,
            feedbackCounts: entry.feedbackCounts,
            escalationScore: entry.escalationScore,
            blastRadiusScore: entry.blastRadiusScore,
            recommendedAction: entry.recommendedAction,
            updatedAt: entry.loop.updatedAt,
            lastTransitionAt: entry.loop.lastTransitionAt ?? null,
            recentTransitions7d: Number(entry.loop.recentTransitions7d ?? 0),
            recentReopened7d: Number(entry.loop.recentReopened7d ?? 0),
            recentResolved7d: Number(entry.loop.recentResolved7d ?? 0),
            pointerMemoryId: entry.pointerMemoryId,
            pointerMemory: entry.pointerMemoryId ? pointerMap.get(entry.pointerMemoryId) ?? null : null,
            stats: {
                openEvents: entry.loop.openEvents,
                resolvedEvents: entry.loop.resolvedEvents,
                reopenedEvents: entry.loop.reopenedEvents,
                supersededEvents: entry.loop.supersededEvents,
            },
        }));
        let incidents = [];
        if (parsed.includeIncidents !== false) {
            const incidentMinEscalation = typeof parsed.incidentMinEscalation === "number" && Number.isFinite(parsed.incidentMinEscalation)
                ? parsed.incidentMinEscalation
                : Math.max(0.88, calibration.highEscalation);
            const incidentMinBlastRadius = typeof parsed.incidentMinBlastRadius === "number" && Number.isFinite(parsed.incidentMinBlastRadius)
                ? parsed.incidentMinBlastRadius
                : Math.max(0.22, calibration.highBlastRadius - 0.04);
            const incidentCandidates = scored
                .filter((entry) => entry.attentionLane === "critical" ||
                entry.escalationScore >= incidentMinEscalation ||
                entry.blastRadiusScore >= incidentMinBlastRadius)
                .sort((left, right) => right.escalationScore - left.escalationScore ||
                right.blastRadiusScore - left.blastRadiusScore ||
                right.anomalyScore - left.anomalyScore ||
                right.attentionScore - left.attentionScore)
                .slice(0, Math.max(1, Math.min(50, parsed.incidentLimit)));
            incidents = incidentCandidates.map((entry, index) => {
                const pointerId = String(entry.pointerMemoryId ?? "").trim();
                const pointer = pointerId ? pointerRowsById.get(pointerId) : undefined;
                const metadata = normalizeMetadata(pointer?.metadata);
                const threadKey = threadKeyFromMetadata(metadata);
                const actorTokens = Array.from(new Set([
                    ...readStringTokens(metadata.participantKey, 12),
                    ...readStringTokens(metadata.participants, 16),
                    ...readStringTokens(metadata.from, 6),
                    ...readStringTokens(metadata.to, 12),
                    ...readStringTokens(metadata.cc, 12),
                ].filter(Boolean))).slice(0, 12);
                const preferredOwner = normalizeText(metadata.owner) ||
                    normalizeText(metadata.assignee) ||
                    normalizeText(metadata.responsible) ||
                    normalizeText(metadata.from) ||
                    (actorTokens.length > 0
                        ? [...actorTokens]
                            .sort((left, right) => (activeActorCounts.get(right) ?? 0) - (activeActorCounts.get(left) ?? 0) || left.localeCompare(right))[0] ?? ""
                        : "");
                const suggestedOwner = preferredOwner || null;
                const affectedActors = actorTokens
                    .sort((left, right) => (activeActorCounts.get(right) ?? 0) - (activeActorCounts.get(left) ?? 0) || left.localeCompare(right))
                    .slice(0, 6);
                const affectedThreads = [
                    threadKey,
                    ...Array.from(activeThreadCounts.entries())
                        .filter(([, count]) => count > 1)
                        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
                        .map(([key]) => key),
                ]
                    .filter(Boolean)
                    .slice(0, 4);
                const timelineMemoryIds = Array.from(new Set([
                    String(entry.loop.lastMemoryId ?? "").trim(),
                    String(entry.loop.lastOpenMemoryId ?? "").trim(),
                    String(entry.loop.lastResolvedMemoryId ?? "").trim(),
                    pointerId,
                ].filter(Boolean))).slice(0, 8);
                const narrative = [
                    `Loop ${entry.loop.loopKey} is ${entry.attentionLane} risk (${entry.loop.currentState}).`,
                    `Escalation ${entry.escalationScore.toFixed(2)}, blast radius ${entry.blastRadiusScore.toFixed(2)}, anomaly ${entry.anomalyScore.toFixed(2)}.`,
                    `Operator feedback score ${entry.feedbackScore.toFixed(2)} (resolve:${entry.feedbackCounts.resolveCount}, escalate:${entry.feedbackCounts.escalateCount}, false-positive:${entry.feedbackCounts.falsePositiveCount}).`,
                    suggestedOwner ? `Suggested owner: ${suggestedOwner}.` : "Suggested owner: unassigned.",
                    affectedActors.length > 0 ? `Likely impacted actors: ${affectedActors.join(", ")}.` : "Impacted actors need confirmation.",
                    entry.recommendedAction,
                ].join(" ");
                const sla = computeIncidentSlaWindow({
                    lane: entry.attentionLane,
                    updatedAt: entry.loop.updatedAt,
                    escalationScore: entry.escalationScore,
                    anomalyScore: entry.anomalyScore,
                    blastRadiusScore: entry.blastRadiusScore,
                });
                return {
                    id: `incident_${entry.loop.loopKey}_${index + 1}`,
                    loopKey: entry.loop.loopKey,
                    lane: entry.attentionLane,
                    escalationScore: entry.escalationScore,
                    blastRadiusScore: entry.blastRadiusScore,
                    anomalyScore: entry.anomalyScore,
                    confidence: entry.loop.confidence,
                    currentState: entry.loop.currentState,
                    suggestedOwner,
                    affectedActors,
                    affectedThreads,
                    timelineMemoryIds,
                    pointerMemoryId: pointerId || null,
                    recommendedAction: entry.recommendedAction,
                    slaTargetHours: sla.slaTargetHours,
                    hoursSinceUpdate: sla.hoursSinceUpdate,
                    hoursUntilBreach: sla.hoursUntilBreach,
                    slaStatus: sla.slaStatus,
                    narrative,
                    updatedAt: entry.loop.updatedAt,
                };
            });
        }
        const byStateMap = new Map();
        const byLaneMap = new Map();
        for (const row of rows) {
            byStateMap.set(row.currentState, (byStateMap.get(row.currentState) ?? 0) + 1);
            byLaneMap.set(row.attentionLane, (byLaneMap.get(row.attentionLane) ?? 0) + 1);
        }
        const hotspotThreads = Array.from(activeThreadCounts.entries())
            .filter(([, count]) => count > 1)
            .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
            .slice(0, 8)
            .map(([key, count]) => ({ key, count }));
        const hotspotActors = Array.from(activeActorCounts.entries())
            .filter(([, count]) => count > 1)
            .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
            .slice(0, 8)
            .map(([key, count]) => ({ key, count }));
        const ownerQueueMap = new Map();
        const slaSummary = {
            healthy: 0,
            atRisk: 0,
            breached: 0,
            soonestBreachHours: null,
        };
        for (const incident of incidents) {
            const owner = incident.suggestedOwner ?? "unassigned";
            const row = ownerQueueMap.get(owner) ?? {
                owner,
                total: 0,
                critical: 0,
                high: 0,
                atRisk: 0,
                breached: 0,
                topIncidentId: null,
                topEscalationScore: -1,
                escalationSum: 0,
                incidentIds: [],
            };
            row.total += 1;
            if (incident.lane === "critical")
                row.critical += 1;
            if (incident.lane === "high")
                row.high += 1;
            if (incident.slaStatus === "at-risk")
                row.atRisk += 1;
            if (incident.slaStatus === "breached")
                row.breached += 1;
            if (incident.escalationScore > row.topEscalationScore) {
                row.topEscalationScore = incident.escalationScore;
                row.topIncidentId = incident.id;
            }
            row.escalationSum += incident.escalationScore;
            row.incidentIds.push(incident.id);
            ownerQueueMap.set(owner, row);
            if (incident.slaStatus === "healthy")
                slaSummary.healthy += 1;
            if (incident.slaStatus === "at-risk")
                slaSummary.atRisk += 1;
            if (incident.slaStatus === "breached")
                slaSummary.breached += 1;
            if (slaSummary.soonestBreachHours === null || incident.hoursUntilBreach < slaSummary.soonestBreachHours) {
                slaSummary.soonestBreachHours = incident.hoursUntilBreach;
            }
        }
        const ownerQueues = Array.from(ownerQueueMap.values())
            .map((row) => ({
            owner: row.owner,
            total: row.total,
            critical: row.critical,
            high: row.high,
            atRisk: row.atRisk,
            breached: row.breached,
            topIncidentId: row.topIncidentId,
            avgEscalationScore: Number((row.escalationSum / Math.max(1, row.total)).toFixed(3)),
            incidentIds: row.incidentIds.slice(0, 24),
        }))
            .sort((left, right) => right.critical - left.critical ||
            right.breached - left.breached ||
            right.total - left.total ||
            right.avgEscalationScore - left.avgEscalationScore ||
            left.owner.localeCompare(right.owner));
        return {
            rows,
            incidents,
            summary: {
                total: rows.length,
                incidentCount: incidents.length,
                byState: Array.from(byStateMap.entries())
                    .map(([state, count]) => ({ state, count }))
                    .sort((left, right) => right.count - left.count || left.state.localeCompare(right.state)),
                byLane: Array.from(byLaneMap.entries())
                    .map(([lane, count]) => ({ lane, count }))
                    .sort((left, right) => right.count - left.count || left.lane.localeCompare(right.lane)),
                highestAttentionScore: rows.length > 0 ? Math.max(...rows.map((row) => row.attentionScore)) : 0,
                highestVolatilityScore: rows.length > 0 ? Math.max(...rows.map((row) => row.volatilityScore)) : 0,
                highestAnomalyScore: rows.length > 0 ? Math.max(...rows.map((row) => row.anomalyScore)) : 0,
                highestCentralityScore: rows.length > 0 ? Math.max(...rows.map((row) => row.centralityScore)) : 0,
                highestFeedbackScore: rows.length > 0 ? Math.max(...rows.map((row) => row.feedbackScore)) : 0,
                highestEscalationScore: rows.length > 0 ? Math.max(...rows.map((row) => row.escalationScore)) : 0,
                highestBlastRadiusScore: rows.length > 0 ? Math.max(...rows.map((row) => row.blastRadiusScore)) : 0,
                feedbackCoverage: rows.length > 0
                    ? Number((rows.filter((row) => row.lastFeedbackAt !== null).length / Math.max(1, rows.length)).toFixed(3))
                    : 0,
                ownerQueues: ownerQueues.map((row) => ({
                    owner: row.owner,
                    total: row.total,
                    critical: row.critical,
                    high: row.high,
                    atRisk: row.atRisk,
                    breached: row.breached,
                    topIncidentId: row.topIncidentId,
                    avgEscalationScore: row.avgEscalationScore,
                })),
                sla: {
                    healthy: slaSummary.healthy,
                    atRisk: slaSummary.atRisk,
                    breached: slaSummary.breached,
                    soonestBreachHours: slaSummary.soonestBreachHours,
                },
                hotspots: {
                    threads: hotspotThreads,
                    actors: hotspotActors,
                },
                calibration,
            },
        };
    };
    const incidentAction = async (raw) => {
        let parsed;
        try {
            parsed = contracts_1.memoryLoopIncidentActionRequestSchema.parse(raw);
        }
        catch (error) {
            throw normalizeError(error);
        }
        const tenantId = normalizeTenant(parsed.tenantId);
        const loopKey = normalizePatternKey(parsed.loopKey);
        if (!loopKey) {
            throw new MemoryValidationError("loopKey is required.");
        }
        const action = parsed.action;
        const incidentId = parsed.incidentId?.trim() || null;
        const memoryId = parsed.memoryId?.trim() || null;
        const idempotencyKey = parsed.idempotencyKey?.trim() || null;
        const actorId = parsed.actorId?.trim() || null;
        const note = parsed.note?.trim() || null;
        const occurredAtInput = parsed.occurredAt ?? null;
        const occurredAt = occurredAtInput ?? new Date().toISOString();
        const requestHash = (0, node_crypto_1.createHash)("sha256")
            .update(JSON.stringify({
            tenantId,
            loopKey,
            incidentId,
            memoryId,
            action,
            actorId,
            note,
            occurredAt: occurredAtInput,
        }))
            .digest("hex")
            .slice(0, 40);
        let idempotencyClaimed = false;
        if (idempotencyKey) {
            if (options.store.claimLoopActionIdempotency) {
                const claim = await options.store.claimLoopActionIdempotency({
                    tenantId,
                    idempotencyKey,
                    requestHash,
                    pendingResponseJson: {
                        _pending: true,
                        operation: "incident-action",
                        startedAt: occurredAt,
                    },
                });
                if (claim.status === "conflict") {
                    throw new MemoryValidationError(`Idempotency key conflict for ${idempotencyKey}: payload does not match original request.`);
                }
                if (claim.status === "in-flight") {
                    throw new MemoryValidationError(`Idempotency key ${idempotencyKey} is already in-flight. Retry with the same key after the current attempt completes.`);
                }
                if (claim.status === "existing" && claim.entry?.responseJson && typeof claim.entry.responseJson === "object") {
                    const replay = claim.entry.responseJson;
                    if (replay && replay.ok === true) {
                        return {
                            ...replay,
                            idempotency: {
                                key: idempotencyKey,
                                replayed: true,
                            },
                        };
                    }
                    throw new MemoryValidationError(`Idempotency key ${idempotencyKey} already completed with a non-replayable response. Use a new idempotency key.`);
                }
                if (claim.status === "claimed") {
                    idempotencyClaimed = true;
                }
            }
            else if (options.store.lookupLoopActionIdempotency) {
                const existing = await options.store.lookupLoopActionIdempotency({
                    tenantId,
                    idempotencyKey,
                });
                if (existing) {
                    if (existing.requestHash !== requestHash) {
                        throw new MemoryValidationError(`Idempotency key conflict for ${idempotencyKey}: payload does not match original request.`);
                    }
                    if (existing.responseJson && typeof existing.responseJson === "object") {
                        const replay = existing.responseJson;
                        if (replay && replay.ok === true) {
                            return {
                                ...replay,
                                idempotency: {
                                    key: idempotencyKey,
                                    replayed: true,
                                },
                            };
                        }
                    }
                }
            }
        }
        try {
            const metadata = {
                ...(parsed.metadata ?? {}),
                source: "incident-action",
                action,
                incidentId,
                actorId,
            };
            if (options.store.recordLoopFeedback) {
                await options.store.recordLoopFeedback({
                    tenantId,
                    loopKey,
                    action,
                    incidentId,
                    memoryId,
                    actorId,
                    note,
                    metadata,
                    occurredAt,
                });
            }
            const inferredState = inferLoopStateFromIncidentAction(action);
            let stateUpdate = {
                applied: false,
                state: null,
                confidence: null,
            };
            if (inferredState && options.store.updateLoopState && memoryId) {
                const confidence = inferredState === "resolved"
                    ? 0.88
                    : inferredState === "superseded"
                        ? 0.76
                        : inferredState === "reopened"
                            ? 0.84
                            : 0.68;
                try {
                    await options.store.updateLoopState({
                        tenantId,
                        loopKey,
                        memoryId,
                        state: inferredState,
                        confidence,
                        occurredAt,
                        metadata: {
                            source: "incident-action",
                            action,
                            incidentId,
                            actorId,
                            note,
                        },
                    });
                    stateUpdate = {
                        applied: true,
                        state: inferredState,
                        confidence,
                    };
                }
                catch {
                    stateUpdate = {
                        applied: false,
                        state: inferredState,
                        confidence,
                    };
                }
            }
            let feedback = null;
            if (options.store.searchLoopFeedbackStats) {
                try {
                    const rows = await options.store.searchLoopFeedbackStats({
                        tenantId,
                        loopKeys: [loopKey],
                        limit: 1,
                        windowDays: 365,
                    });
                    const row = rows[0];
                    if (row) {
                        const adjustment = computeLoopFeedbackAdjustment({
                            ackCount: row.ackCount,
                            assignCount: row.assignCount,
                            snoozeCount: row.snoozeCount,
                            resolveCount: row.resolveCount,
                            falsePositiveCount: row.falsePositiveCount,
                            escalateCount: row.escalateCount,
                            totalCount: row.totalCount,
                            lastActionAt: row.lastActionAt,
                        }, action);
                        feedback = {
                            feedbackScore: adjustment.feedbackScore,
                            lastFeedbackAt: row.lastActionAt ?? null,
                            counts: {
                                ackCount: row.ackCount,
                                assignCount: row.assignCount,
                                snoozeCount: row.snoozeCount,
                                resolveCount: row.resolveCount,
                                falsePositiveCount: row.falsePositiveCount,
                                escalateCount: row.escalateCount,
                            },
                        };
                    }
                }
                catch {
                    // best-effort feedback envelope
                }
            }
            const result = {
                ok: true,
                tenantId,
                loopKey,
                incidentId,
                memoryId,
                action,
                actorId,
                note,
                recordedAt: occurredAt,
                stateUpdate,
                idempotency: {
                    key: idempotencyKey,
                    replayed: false,
                },
                feedback,
            };
            if (idempotencyKey && options.store.storeLoopActionIdempotency) {
                await options.store.storeLoopActionIdempotency({
                    tenantId,
                    idempotencyKey,
                    requestHash,
                    responseJson: result,
                });
            }
            return result;
        }
        catch (error) {
            if (idempotencyClaimed && idempotencyKey && options.store.storeLoopActionIdempotency) {
                try {
                    await options.store.storeLoopActionIdempotency({
                        tenantId,
                        idempotencyKey,
                        requestHash,
                        responseJson: {
                            ok: false,
                            _pending: false,
                            operation: "incident-action",
                            failedAt: new Date().toISOString(),
                            error: error instanceof Error ? error.message : String(error),
                        },
                    });
                }
                catch {
                    // best-effort failure envelope
                }
            }
            throw error;
        }
    };
    const incidentActionBatch = async (raw) => {
        let parsed;
        try {
            parsed = contracts_1.memoryLoopIncidentActionBatchRequestSchema.parse(raw);
        }
        catch (error) {
            throw normalizeError(error);
        }
        const batchTenantId = normalizeTenant(parsed.tenantId);
        const batchActorId = parsed.actorId?.trim() || null;
        const results = [];
        let processed = 0;
        let failed = 0;
        for (const [index, item] of parsed.actions.entries()) {
            try {
                const derivedIdempotencyKey = item.idempotencyKey?.trim()
                    ? item.idempotencyKey.trim()
                    : parsed.idempotencyPrefix
                        ? `${parsed.idempotencyPrefix.trim()}-${index + 1}`
                        : undefined;
                const result = await incidentAction({
                    tenantId: item.tenantId !== undefined
                        ? item.tenantId
                        : batchTenantId === null
                            ? undefined
                            : batchTenantId,
                    loopKey: item.loopKey,
                    incidentId: item.incidentId,
                    memoryId: item.memoryId,
                    idempotencyKey: derivedIdempotencyKey,
                    action: item.action,
                    actorId: item.actorId ?? (batchActorId ?? undefined),
                    note: item.note,
                    metadata: item.metadata,
                    occurredAt: item.occurredAt,
                });
                processed += 1;
                results.push({ index, ok: true, result });
            }
            catch (error) {
                failed += 1;
                results.push({ index, ok: false, error: error instanceof Error ? error.message : String(error) });
                if (!parsed.continueOnError)
                    break;
            }
        }
        return {
            total: parsed.actions.length,
            processed,
            failed,
            results,
        };
    };
    const loopFeedbackStats = async (raw) => {
        let parsed;
        try {
            parsed = contracts_1.memoryLoopFeedbackStatsRequestSchema.parse(raw);
        }
        catch (error) {
            throw normalizeError(error);
        }
        const tenantId = normalizeTenant(parsed.tenantId);
        if (!options.store.searchLoopFeedbackStats) {
            return {
                rows: [],
                summary: {
                    totalLoops: 0,
                    highConfidenceLoops: 0,
                    falsePositiveHeavyLoops: 0,
                    coveredLoops: 0,
                    windowDays: parsed.windowDays,
                },
            };
        }
        const loopKeys = Array.from(new Set(parsed.loopKeys.map((value) => normalizePatternKey(value)).filter(Boolean)));
        const rows = await options.store.searchLoopFeedbackStats({
            tenantId,
            loopKeys: loopKeys.length > 0 ? loopKeys : undefined,
            limit: parsed.limit,
            windowDays: parsed.windowDays,
        });
        const scored = rows
            .map((row) => {
            const adjustment = computeLoopFeedbackAdjustment({
                ackCount: row.ackCount,
                assignCount: row.assignCount,
                snoozeCount: row.snoozeCount,
                resolveCount: row.resolveCount,
                falsePositiveCount: row.falsePositiveCount,
                escalateCount: row.escalateCount,
                totalCount: row.totalCount,
                lastActionAt: row.lastActionAt,
            }, "feedback calibration");
            return {
                loopKey: row.loopKey,
                feedbackScore: adjustment.feedbackScore,
                ackCount: row.ackCount,
                assignCount: row.assignCount,
                snoozeCount: row.snoozeCount,
                resolveCount: row.resolveCount,
                falsePositiveCount: row.falsePositiveCount,
                escalateCount: row.escalateCount,
                totalCount: row.totalCount,
                lastActionAt: row.lastActionAt,
            };
        })
            .sort((left, right) => right.feedbackScore - left.feedbackScore ||
            right.escalateCount + right.resolveCount - (left.escalateCount + left.resolveCount) ||
            left.falsePositiveCount - right.falsePositiveCount ||
            String(right.lastActionAt ?? "").localeCompare(String(left.lastActionAt ?? "")));
        return {
            rows: scored,
            summary: {
                totalLoops: scored.length,
                highConfidenceLoops: scored.filter((row) => row.feedbackScore >= 0.08).length,
                falsePositiveHeavyLoops: scored.filter((row) => row.falsePositiveCount >= Math.max(2, row.resolveCount + row.escalateCount)).length,
                coveredLoops: scored.filter((row) => row.totalCount > 0).length,
                windowDays: parsed.windowDays,
            },
        };
    };
    const ownerQueues = async (raw) => {
        let parsed;
        try {
            parsed = contracts_1.memoryLoopOwnerQueuesRequestSchema.parse(raw);
        }
        catch (error) {
            throw normalizeError(error);
        }
        const loopsResult = await loops({
            tenantId: parsed.tenantId,
            query: parsed.query,
            states: parsed.states,
            lanes: parsed.lanes,
            loopKeys: parsed.loopKeys,
            includeMemory: true,
            includeIncidents: true,
            sortBy: "escalation",
            limit: parsed.limit,
            incidentLimit: parsed.incidentLimit,
            incidentMinEscalation: parsed.incidentMinEscalation,
            incidentMinBlastRadius: parsed.incidentMinBlastRadius,
        });
        const byOwner = new Map();
        for (const incident of loopsResult.incidents) {
            const owner = incident.suggestedOwner ?? "unassigned";
            const row = byOwner.get(owner) ?? {
                owner,
                total: 0,
                critical: 0,
                high: 0,
                atRisk: 0,
                breached: 0,
                topIncidentId: null,
                topEscalation: -1,
                escalationSum: 0,
                incidentIds: [],
            };
            row.total += 1;
            if (incident.lane === "critical")
                row.critical += 1;
            if (incident.lane === "high")
                row.high += 1;
            if (incident.slaStatus === "at-risk")
                row.atRisk += 1;
            if (incident.slaStatus === "breached")
                row.breached += 1;
            if (incident.escalationScore > row.topEscalation) {
                row.topEscalation = incident.escalationScore;
                row.topIncidentId = incident.id;
            }
            row.escalationSum += incident.escalationScore;
            row.incidentIds.push(incident.id);
            byOwner.set(owner, row);
        }
        const queues = Array.from(byOwner.values())
            .map((row) => ({
            owner: row.owner,
            total: row.total,
            critical: row.critical,
            high: row.high,
            atRisk: row.atRisk,
            breached: row.breached,
            topIncidentId: row.topIncidentId,
            avgEscalationScore: Number((row.escalationSum / Math.max(1, row.total)).toFixed(3)),
            incidentIds: row.incidentIds.slice(0, 30),
        }))
            .sort((left, right) => right.critical - left.critical ||
            right.breached - left.breached ||
            right.total - left.total ||
            right.avgEscalationScore - left.avgEscalationScore ||
            left.owner.localeCompare(right.owner));
        return {
            generatedAt: new Date().toISOString(),
            query: parsed.query?.trim() || null,
            queues,
            sla: loopsResult.summary.sla,
            incidents: loopsResult.incidents,
            summary: loopsResult.summary,
        };
    };
    const actionPlan = async (raw) => {
        let parsed;
        try {
            parsed = contracts_1.memoryLoopActionPlanRequestSchema.parse(raw);
        }
        catch (error) {
            throw normalizeError(error);
        }
        const queues = await ownerQueues({
            tenantId: parsed.tenantId,
            query: parsed.query,
            states: parsed.states,
            lanes: parsed.lanes,
            loopKeys: parsed.loopKeys,
            limit: parsed.limit,
            incidentLimit: parsed.incidentLimit,
            incidentMinEscalation: parsed.incidentMinEscalation,
            incidentMinBlastRadius: parsed.incidentMinBlastRadius,
        });
        const planned = [];
        const actionCounts = new Map();
        const priorityCounts = new Map();
        for (const incident of queues.incidents) {
            if (planned.length >= parsed.maxActions)
                break;
            let action = "ack";
            let priority = "p3";
            if (incident.slaStatus === "breached" && incident.lane === "critical") {
                action = "escalate";
                priority = "p0";
            }
            else if (incident.slaStatus === "breached" || incident.hoursUntilBreach <= 2) {
                action = incident.suggestedOwner ? "assign" : "escalate";
                priority = "p0";
            }
            else if (incident.slaStatus === "at-risk" && incident.lane === "critical") {
                action = incident.suggestedOwner ? "assign" : "escalate";
                priority = "p1";
            }
            else if (incident.lane === "critical" && incident.currentState === "reopened") {
                action = "escalate";
                priority = "p1";
            }
            else if (incident.lane === "high" && !incident.suggestedOwner) {
                action = "assign";
                priority = "p2";
            }
            else if (incident.currentState === "resolved" && incident.anomalyScore < 0.16) {
                action = "ack";
                priority = "p3";
            }
            else if (incident.slaStatus === "healthy" && incident.escalationScore < 0.7) {
                action = "snooze";
                priority = "p3";
            }
            else if (incident.escalationScore >= 1.2 || incident.blastRadiusScore >= 0.55) {
                action = "escalate";
                priority = "p1";
            }
            else {
                action = "ack";
                priority = "p2";
            }
            const confidence = Number(Math.max(0.42, Math.min(0.99, 0.54 +
                incident.escalationScore * 0.2 +
                incident.blastRadiusScore * 0.14 +
                incident.anomalyScore * 0.12 +
                (incident.slaStatus === "breached" ? 0.1 : incident.slaStatus === "at-risk" ? 0.05 : 0))).toFixed(3));
            const idempotencyKeySuggestion = (0, node_crypto_1.createHash)("sha256")
                .update(`${incident.id}|${action}|${incident.updatedAt}|plan-v1`)
                .digest("hex")
                .slice(0, 30);
            planned.push({
                priority,
                confidence,
                reason: summarizeActionReason({
                    action,
                    lane: incident.lane,
                    currentState: incident.currentState,
                    slaStatus: incident.slaStatus,
                    hoursUntilBreach: incident.hoursUntilBreach,
                    escalationScore: incident.escalationScore,
                    blastRadiusScore: incident.blastRadiusScore,
                    anomalyScore: incident.anomalyScore,
                }),
                idempotencyKeySuggestion,
                incidentId: incident.id,
                loopKey: incident.loopKey,
                currentState: incident.currentState,
                lane: incident.lane,
                action,
                suggestedOwner: incident.suggestedOwner,
                hoursUntilBreach: incident.hoursUntilBreach,
                slaStatus: incident.slaStatus,
                escalationScore: incident.escalationScore,
                blastRadiusScore: incident.blastRadiusScore,
                anomalyScore: incident.anomalyScore,
            });
            actionCounts.set(action, (actionCounts.get(action) ?? 0) + 1);
            priorityCounts.set(priority, (priorityCounts.get(priority) ?? 0) + 1);
        }
        const batchPayload = parsed.includeBatchPayload
            ? {
                continueOnError: true,
                actions: planned.map((row) => ({
                    loopKey: row.loopKey,
                    incidentId: row.incidentId,
                    action: row.action,
                    ...(row.suggestedOwner ? { actorId: row.suggestedOwner } : {}),
                    note: row.reason,
                    idempotencyKey: row.idempotencyKeySuggestion,
                })),
            }
            : null;
        return {
            generatedAt: new Date().toISOString(),
            query: parsed.query?.trim() || null,
            actions: planned,
            summary: {
                totalIncidentsConsidered: queues.incidents.length,
                totalPlannedActions: planned.length,
                byAction: Array.from(actionCounts.entries())
                    .map(([action, count]) => ({ action, count }))
                    .sort((left, right) => right.count - left.count || left.action.localeCompare(right.action)),
                byPriority: Array.from(priorityCounts.entries())
                    .map(([priority, count]) => ({ priority, count }))
                    .sort((left, right) => right.count - left.count || left.priority.localeCompare(right.priority)),
            },
            batchPayload,
            ownerQueues: queues.queues,
            sla: queues.sla,
        };
    };
    const automationTick = async (raw) => {
        let parsed;
        try {
            parsed = contracts_1.memoryLoopAutomationTickRequestSchema.parse(raw);
        }
        catch (error) {
            throw normalizeError(error);
        }
        const tenantId = normalizeTenant(parsed.tenantId);
        const idempotencyKey = parsed.idempotencyKey?.trim() || null;
        const requestHash = (0, node_crypto_1.createHash)("sha256")
            .update(JSON.stringify({
            tenantId,
            query: parsed.query ?? null,
            states: parsed.states,
            lanes: parsed.lanes,
            loopKeys: parsed.loopKeys,
            limit: parsed.limit,
            incidentLimit: parsed.incidentLimit,
            incidentMinEscalation: parsed.incidentMinEscalation ?? null,
            incidentMinBlastRadius: parsed.incidentMinBlastRadius ?? null,
            maxActions: parsed.maxActions,
            applyActions: parsed.applyActions,
            applyPriorities: parsed.applyPriorities,
            allowedActions: parsed.allowedActions,
            actorId: parsed.actorId ?? null,
            includeBatchPayload: parsed.includeBatchPayload,
        }))
            .digest("hex")
            .slice(0, 40);
        let idempotencyClaimed = false;
        if (idempotencyKey) {
            if (options.store.claimLoopActionIdempotency) {
                const claim = await options.store.claimLoopActionIdempotency({
                    tenantId,
                    idempotencyKey,
                    requestHash,
                    pendingResponseJson: {
                        _pending: true,
                        operation: "automation-tick",
                        startedAt: new Date().toISOString(),
                    },
                });
                if (claim.status === "conflict") {
                    throw new MemoryValidationError(`Idempotency key conflict for ${idempotencyKey}: payload does not match original request.`);
                }
                if (claim.status === "in-flight") {
                    throw new MemoryValidationError(`Idempotency key ${idempotencyKey} is already in-flight. Retry with the same key after the current attempt completes.`);
                }
                if (claim.status === "existing" && claim.entry?.responseJson && typeof claim.entry.responseJson === "object") {
                    const replay = claim.entry.responseJson;
                    if (replay && replay.plan && replay.applied) {
                        return {
                            ...replay,
                            idempotency: {
                                key: idempotencyKey,
                                replayed: true,
                            },
                        };
                    }
                    throw new MemoryValidationError(`Idempotency key ${idempotencyKey} already completed with a non-replayable response. Use a new idempotency key.`);
                }
                if (claim.status === "claimed") {
                    idempotencyClaimed = true;
                }
            }
            else if (options.store.lookupLoopActionIdempotency) {
                const existing = await options.store.lookupLoopActionIdempotency({
                    tenantId,
                    idempotencyKey,
                });
                if (existing) {
                    if (existing.requestHash !== requestHash) {
                        throw new MemoryValidationError(`Idempotency key conflict for ${idempotencyKey}: payload does not match original request.`);
                    }
                    if (existing.responseJson && typeof existing.responseJson === "object") {
                        const replay = existing.responseJson;
                        if (replay && replay.plan && replay.applied) {
                            return {
                                ...replay,
                                idempotency: {
                                    key: idempotencyKey,
                                    replayed: true,
                                },
                            };
                        }
                    }
                }
            }
        }
        try {
            const plan = await actionPlan({
                tenantId,
                query: parsed.query,
                states: parsed.states,
                lanes: parsed.lanes,
                loopKeys: parsed.loopKeys,
                limit: parsed.limit,
                incidentLimit: parsed.incidentLimit,
                incidentMinEscalation: parsed.incidentMinEscalation,
                incidentMinBlastRadius: parsed.incidentMinBlastRadius,
                maxActions: parsed.maxActions,
                includeBatchPayload: parsed.includeBatchPayload,
            });
            const allowedPrioritySet = new Set(parsed.applyPriorities);
            const allowedActionSet = new Set(parsed.allowedActions);
            const selected = plan.actions
                .filter((row) => allowedPrioritySet.has(row.priority) && allowedActionSet.has(row.action))
                .slice(0, parsed.maxActions);
            let batchResult = null;
            if (parsed.applyActions && selected.length > 0) {
                const actions = selected.map((row, index) => ({
                    loopKey: row.loopKey,
                    incidentId: row.incidentId,
                    action: row.action,
                    actorId: parsed.actorId ?? row.suggestedOwner ?? undefined,
                    note: `[automation-tick] ${row.reason}`,
                    idempotencyKey: idempotencyKey
                        ? `${idempotencyKey}-${index + 1}`
                        : row.idempotencyKeySuggestion,
                }));
                batchResult = await incidentActionBatch({
                    tenantId,
                    actorId: parsed.actorId,
                    continueOnError: true,
                    actions,
                });
            }
            const result = {
                generatedAt: new Date().toISOString(),
                idempotency: {
                    key: idempotencyKey,
                    replayed: false,
                },
                plan,
                applied: {
                    requested: parsed.applyActions,
                    selectedActions: selected.length,
                    result: batchResult,
                },
            };
            if (idempotencyKey && options.store.storeLoopActionIdempotency) {
                await options.store.storeLoopActionIdempotency({
                    tenantId,
                    idempotencyKey,
                    requestHash,
                    responseJson: result,
                });
            }
            return result;
        }
        catch (error) {
            if (idempotencyClaimed && idempotencyKey && options.store.storeLoopActionIdempotency) {
                try {
                    await options.store.storeLoopActionIdempotency({
                        tenantId,
                        idempotencyKey,
                        requestHash,
                        responseJson: {
                            ok: false,
                            _pending: false,
                            operation: "automation-tick",
                            failedAt: new Date().toISOString(),
                            error: error instanceof Error ? error.message : String(error),
                        },
                    });
                }
                catch {
                    // best-effort failure envelope
                }
            }
            throw error;
        }
    };
    const context = async (raw) => {
        let parsed;
        try {
            parsed = contracts_1.memoryContextRequestSchema.parse(raw);
        }
        catch (error) {
            throw normalizeError(error);
        }
        const tenantResolution = nanny.resolveTenant(parsed.tenantId);
        const agentId = parsed.agentId?.trim() || null;
        const runId = parsed.runId?.trim() || null;
        const query = parsed.query?.trim() || null;
        const retrievalMode = parsed.retrievalMode;
        let retrievalModeUsed = retrievalMode;
        const stageTimeoutMs = MEMORY_QUERY_STAGE_TIMEOUT_MS;
        const fallbackStageTimeoutMs = MEMORY_QUERY_FALLBACK_STAGE_TIMEOUT_MS;
        const sourceAllowlist = sanitizeStringList(parsed.sourceAllowlist);
        const sourceDenylist = applyDreamDefaultSourceDenylist(sourceAllowlist, sanitizeStringList(parsed.sourceDenylist));
        const layerAllowlist = (0, layers_1.normalizeMemoryLayerList)(parsed.layerAllowlist);
        const layerDenylist = (0, layers_1.normalizeMemoryLayerList)(parsed.layerDenylist);
        const queryEntityHints = query ? extractQueryEntityHints(query) : [];
        const queryPatternHints = query ? extractQueryPatternHints(query) : [];
        const briefArtifact = readMemoryBriefArtifact();
        const consolidationArtifact = readMemoryConsolidationArtifact();
        const contextFallbackCacheKey = query
            ? buildContextFallbackCacheKey({
                tenantId: tenantResolution.tenantId,
                agentId,
                runId,
                query,
                retrievalMode,
                sourceAllowlist,
                sourceDenylist,
                layerAllowlist,
                layerDenylist,
                maxItems: parsed.maxItems,
                scanLimit: parsed.scanLimit,
            })
            : "";
        const applyLoopStateOnRows = async (rowsInput) => {
            if (!options.store.searchLoopState || rowsInput.length === 0)
                return rowsInput;
            const loopKeys = Array.from(new Set(rowsInput.map((row) => loopKeyFromRow(row)).filter(Boolean))).slice(0, 120);
            if (loopKeys.length === 0)
                return rowsInput;
            try {
                const states = await options.store.searchLoopState({
                    tenantId: tenantResolution.tenantId,
                    loopKeys,
                    limit: Math.max(loopKeys.length, 40),
                });
                if (states.length === 0)
                    return rowsInput;
                const stateByKey = new Map(states.map((row) => [normalizePatternKey(row.loopKey), row]));
                return rowsInput.map((row) => {
                    const loopKey = normalizePatternKey(loopKeyFromRow(row));
                    if (!loopKey)
                        return row;
                    return applyLoopStateBoost(row, stateByKey.get(loopKey), query ?? "");
                });
            }
            catch {
                return rowsInput;
            }
        };
        const mergeLoopStatePointerRows = async (rowsInput) => {
            if (!options.store.searchLoopState || rowsInput.length === 0 || !query)
                return rowsInput;
            const preferredStates = preferredLoopStatesForQuery(query);
            if (preferredStates.length === 0)
                return rowsInput;
            const loopKeys = Array.from(new Set(rowsInput.map((row) => loopKeyFromRow(row)).filter(Boolean))).slice(0, 160);
            if (loopKeys.length === 0)
                return rowsInput;
            let states = [];
            try {
                states = await options.store.searchLoopState({
                    tenantId: tenantResolution.tenantId,
                    loopKeys,
                    states: preferredStates,
                    limit: Math.max(loopKeys.length * 2, 64),
                });
            }
            catch {
                return rowsInput;
            }
            if (states.length === 0)
                return rowsInput;
            const existingIds = new Set(rowsInput.map((row) => row.id));
            const pointerById = new Map();
            const pointerIds = [];
            const addPointer = (id, state) => {
                const normalized = String(id ?? "").trim();
                if (!normalized || existingIds.has(normalized) || pointerById.has(normalized))
                    return;
                pointerById.set(normalized, state);
                pointerIds.push(normalized);
            };
            for (const state of states) {
                const current = String(state.currentState ?? "").toLowerCase();
                if (current === "open-loop" || current === "reopened") {
                    addPointer(state.lastOpenMemoryId || state.lastMemoryId, state);
                    continue;
                }
                if (current === "resolved") {
                    addPointer(state.lastResolvedMemoryId || state.lastMemoryId, state);
                    continue;
                }
                if (current === "superseded") {
                    addPointer(state.lastMemoryId || state.lastResolvedMemoryId, state);
                    continue;
                }
                addPointer(state.lastMemoryId, state);
            }
            if (pointerIds.length === 0)
                return rowsInput;
            const fetched = await options.store.getByIds({
                ids: pointerIds.slice(0, 120),
                tenantId: tenantResolution.tenantId,
            });
            const merged = [...rowsInput];
            for (const row of fetched) {
                if (!matchesContextScope(row))
                    continue;
                if (existingIds.has(row.id))
                    continue;
                const loopState = pointerById.get(row.id);
                const base = toSearchResultFromRecord(row, {
                    matchedBy: ["pattern"],
                    scoreBreakdown: {
                        rrf: 0.14,
                        sourceTrust: row.sourceConfidence,
                        recency: recencyScore(row.occurredAt, row.createdAt, row.memoryType, temporalAnchorMs),
                        importance: row.importance,
                        session: 0,
                        lexical: 0,
                        semantic: 0,
                        sessionLane: 0,
                    },
                }, temporalAnchorMs);
                const withLoop = applyLoopStateBoost(base, loopState, query);
                const pointerBoost = 0.05 + 0.09 * clamp01(loopState?.confidence, 0.58);
                merged.push({
                    ...withLoop,
                    score: withLoop.score + pointerBoost,
                    scoreBreakdown: {
                        ...withLoop.scoreBreakdown,
                        pattern: (withLoop.scoreBreakdown.pattern ?? 0) + pointerBoost,
                    },
                });
                existingIds.add(row.id);
            }
            return merged;
        };
        const temporalAnchorMs = Number.isFinite(Date.parse(parsed.temporalAnchorAt ?? ""))
            ? Date.parse(parsed.temporalAnchorAt ?? "")
            : Date.now();
        let tenantRows = [];
        let tenantRowsTimedOut = false;
        try {
            tenantRows = await withTimeout(options.store.recent({
                tenantId: tenantResolution.tenantId,
                sourceAllowlist,
                sourceDenylist,
                layerAllowlist,
                layerDenylist,
                excludeStatuses: ["quarantined"],
                limit: parsed.scanLimit,
            }), stageTimeoutMs, "memory context tenant recent stage");
        }
        catch (error) {
            if (!isTransientStoreTimeoutError(error)) {
                throw error;
            }
            tenantRowsTimedOut = true;
            try {
                tenantRows = await withTimeout(options.store.recent({
                    tenantId: tenantResolution.tenantId,
                    sourceAllowlist,
                    sourceDenylist,
                    layerAllowlist,
                    layerDenylist,
                    excludeStatuses: ["quarantined"],
                    limit: Math.max(parsed.maxItems * 6, Math.min(parsed.scanLimit, 96)),
                }), fallbackStageTimeoutMs, "memory context tenant recent fallback stage");
            }
            catch (fallbackError) {
                if (!isTransientStoreTimeoutError(fallbackError)) {
                    throw fallbackError;
                }
                tenantRows = [];
            }
        }
        const scopedRows = filterExpiredMemoryRecords(tenantRows).filter((row) => {
            if (agentId && row.agentId !== agentId)
                return false;
            if (runId && row.runId !== runId)
                return false;
            if (!sourceAllowed(row.source, sourceAllowlist, sourceDenylist))
                return false;
            if (!(0, layers_1.isAllowedMemoryLayer)(row.memoryLayer, layerAllowlist, layerDenylist))
                return false;
            if (row.status === "quarantined")
                return false;
            return true;
        });
        const effectiveRows = scopedRows.length === 0 && parsed.includeTenantFallback && (agentId !== null || runId !== null)
            ? filterExpiredMemoryRecords(tenantRows).filter((row) => sourceAllowed(row.source, sourceAllowlist, sourceDenylist)
                && (0, layers_1.isAllowedMemoryLayer)(row.memoryLayer, layerAllowlist, layerDenylist)
                && row.status !== "quarantined")
            : scopedRows;
        const tenantFallbackUsedForEmptyScope = effectiveRows.length > 0 && scopedRows.length === 0 && (agentId !== null || runId !== null) && parsed.includeTenantFallback;
        const matchesContextScope = (row) => {
            if (!sourceAllowed(row.source, sourceAllowlist, sourceDenylist))
                return false;
            if (!(0, layers_1.isAllowedMemoryLayer)(row.memoryLayer, layerAllowlist, layerDenylist))
                return false;
            if (row.status === "quarantined")
                return false;
            if (isExpiredRecord(row))
                return false;
            if (tenantFallbackUsedForEmptyScope)
                return true;
            if (agentId && row.agentId !== agentId)
                return false;
            if (runId && row.runId !== runId)
                return false;
            return true;
        };
        const coreRows = synthesizeCoreRowsFromBrief(briefArtifact, tenantResolution.tenantId, new Date().toISOString()).filter((row) => (0, layers_1.isAllowedMemoryLayer)(row.memoryLayer, layerAllowlist, layerDenylist));
        const knownRows = new Map();
        const threadBuckets = new Map();
        for (const row of [...coreRows, ...effectiveRows]) {
            knownRows.set(row.id, row);
            const threadKey = threadKeyFromMetadata(normalizeMetadata(row.metadata));
            if (!threadKey)
                continue;
            const bucket = threadBuckets.get(threadKey) || [];
            bucket.push(row);
            threadBuckets.set(threadKey, bucket);
        }
        let searchRows = [];
        let queryFallbackActivated = false;
        if (query) {
            let queryEmbedding = null;
            if (retrievalMode !== "lexical") {
                try {
                    queryEmbedding = normalizeEmbedding(await withTimeout(embeddingAdapter.embed(query), MEMORY_QUERY_EMBED_TIMEOUT_MS, "memory context embedding stage"));
                }
                catch (error) {
                    if (!isTransientStoreTimeoutError(error)) {
                        throw error;
                    }
                    queryEmbedding = null;
                }
            }
            const effectiveRetrievalMode = retrievalMode === "lexical" ? "lexical" : queryEmbedding ? retrievalMode : "lexical";
            retrievalModeUsed = effectiveRetrievalMode;
            try {
                searchRows = applySignalBoost(filterExpiredSearchResults(await withTimeout(options.store.search({
                    query,
                    tenantId: tenantResolution.tenantId,
                    agentId: agentId ?? undefined,
                    runId: runId ?? undefined,
                    sourceAllowlist,
                    sourceDenylist,
                    layerAllowlist,
                    layerDenylist,
                    retrievalMode: effectiveRetrievalMode,
                    minScore: 0,
                    explain: parsed.explain,
                    embedding: queryEmbedding ?? undefined,
                    limit: Math.max(parsed.maxItems * 4, 24),
                }), stageTimeoutMs, "memory context search stage")), query);
            }
            catch (error) {
                queryFallbackActivated = true;
                let contextSearchError = error;
                if (MEMORY_QUERY_ENABLE_LEXICAL_TIMEOUT_FALLBACK &&
                    isTransientStoreTimeoutError(contextSearchError) &&
                    effectiveRetrievalMode !== "lexical") {
                    try {
                        searchRows = applySignalBoost(filterExpiredSearchResults(await withTimeout(options.store.search({
                            query,
                            tenantId: tenantResolution.tenantId,
                            agentId: agentId ?? undefined,
                            runId: runId ?? undefined,
                            sourceAllowlist,
                            sourceDenylist,
                            layerAllowlist,
                            layerDenylist,
                            retrievalMode: "lexical",
                            minScore: 0,
                            explain: parsed.explain,
                            limit: Math.max(parsed.maxItems * 4, 24),
                        }), fallbackStageTimeoutMs, "memory context lexical timeout fallback stage")), query).map((row) => ({
                            ...row,
                            matchedBy: row.matchedBy.includes("lexical-timeout-fallback")
                                ? row.matchedBy
                                : [...row.matchedBy, "lexical-timeout-fallback"],
                        }));
                        retrievalModeUsed = "lexical";
                        contextSearchError = null;
                    }
                    catch (lexicalFallbackError) {
                        contextSearchError = lexicalFallbackError;
                    }
                }
                if (contextSearchError && !isTransientStoreTimeoutError(contextSearchError)) {
                    throw contextSearchError;
                }
                if (contextSearchError) {
                    try {
                        const fallbackRows = filterExpiredMemoryRecords(await withTimeout(options.store.recent({
                            tenantId: tenantResolution.tenantId,
                            agentId: agentId ?? undefined,
                            runId: runId ?? undefined,
                            sourceAllowlist,
                            sourceDenylist,
                            layerAllowlist,
                            layerDenylist,
                            excludeStatuses: ["quarantined"],
                            limit: Math.max(parsed.maxItems * 8, 120),
                        }), fallbackStageTimeoutMs, "memory context recent fallback stage"));
                        const queryTokens = String(query)
                            .toLowerCase()
                            .split(/\s+/)
                            .map((entry) => entry.replace(/[^a-z0-9._:@/-]+/g, "").trim())
                            .filter((entry) => entry.length >= 3)
                            .slice(0, 24);
                        searchRows = fallbackRows
                            .map((row) => {
                            const metadata = normalizeMetadata(row.metadata);
                            const subject = normalizeText(metadata.subjectKey || metadata.subject).toLowerCase();
                            const haystack = `${row.content}\n${subject}`.toLowerCase();
                            const tokenHits = queryTokens.length === 0 ? 0 : queryTokens.reduce((acc, token) => acc + (haystack.includes(token) ? 1 : 0), 0);
                            const lexicalBoost = queryTokens.length === 0 ? 0 : Math.min(0.34, (tokenHits / queryTokens.length) * 0.34);
                            return toSearchResultFromRecord(row, {
                                score: 0.32 + lexicalBoost + row.sourceConfidence * 0.16 + row.importance * 0.14,
                                matchedBy: ["context-recent-fallback", "search-timeout"],
                                scoreBreakdown: {
                                    rrf: 0.2 + lexicalBoost,
                                    sourceTrust: row.sourceConfidence,
                                    recency: recencyScore(row.occurredAt, row.createdAt, row.memoryType),
                                    importance: row.importance,
                                    session: runId && row.runId === runId ? 1 : agentId && row.agentId === agentId ? 0.5 : 0,
                                    lexical: lexicalBoost,
                                    semantic: 0,
                                    sessionLane: runId && row.runId === runId ? 1 : agentId && row.agentId === agentId ? 0.5 : 0,
                                },
                            }, Date.now());
                        })
                            .sort((left, right) => right.score - left.score || right.createdAt.localeCompare(left.createdAt))
                            .slice(0, Math.max(parsed.maxItems * 4, 24));
                        contextSearchError = null;
                    }
                    catch (recentFallbackError) {
                        contextSearchError = recentFallbackError;
                    }
                }
                if (contextSearchError) {
                    const cached = readContextFallbackCache(contextFallbackCacheKey);
                    if (cached && cached.rows.length > 0) {
                        searchRows = cached.rows;
                        retrievalModeUsed = cached.retrievalModeUsed;
                        contextSearchError = null;
                    }
                }
                if (contextSearchError) {
                    throw contextSearchError;
                }
            }
        }
        if (query && searchRows.length === 0 && (tenantRowsTimedOut || queryFallbackActivated)) {
            const cached = readContextFallbackCache(contextFallbackCacheKey);
            if (cached && cached.rows.length > 0) {
                searchRows = cached.rows;
                retrievalModeUsed = cached.retrievalModeUsed;
            }
        }
        searchRows = searchRows.filter((row) => (0, layers_1.isAllowedMemoryLayer)(row.memoryLayer, layerAllowlist, layerDenylist));
        const degradedComputeMode = tenantRowsTimedOut || queryFallbackActivated;
        const scoredById = new Map();
        for (const row of searchRows) {
            scoredById.set(row.id, row);
        }
        for (const row of coreRows) {
            if (scoredById.has(row.id))
                continue;
            scoredById.set(row.id, toSearchResultFromRecord(row, {
                score: 0.94,
                matchedBy: ["core-block"],
                scoreBreakdown: {
                    rrf: 0.32,
                    sourceTrust: row.sourceConfidence,
                    recency: 0.88,
                    importance: row.importance,
                    session: 0,
                    lexical: 0,
                    semantic: 0,
                    sessionLane: 0,
                },
            }, temporalAnchorMs));
        }
        for (const row of [...effectiveRows].sort((left, right) => {
            const priorityDelta = (0, layers_1.memoryLayerPriority)(left.memoryLayer) - (0, layers_1.memoryLayerPriority)(right.memoryLayer);
            if (priorityDelta !== 0)
                return priorityDelta;
            const acceptedDelta = Number(right.status === "accepted") - Number(left.status === "accepted");
            if (acceptedDelta !== 0)
                return acceptedDelta;
            return right.createdAt.localeCompare(left.createdAt);
        })) {
            if (scoredById.has(row.id))
                continue;
            const session = runId && row.runId === runId ? 1 : agentId && row.agentId === agentId ? 0.5 : 0;
            const recency = recencyScore(row.occurredAt, row.createdAt, row.memoryType, temporalAnchorMs);
            const fallbackScore = 0.2 + 0.2 * row.sourceConfidence + 0.2 * recency + 0.2 * row.importance + 0.2 * session;
            scoredById.set(row.id, toSearchResultFromRecord(row, {
                score: fallbackScore,
                matchedBy: session > 0 ? ["session"] : ["recent"],
                scoreBreakdown: {
                    rrf: 0.2,
                    sourceTrust: row.sourceConfidence,
                    recency,
                    importance: row.importance,
                    session,
                    lexical: 0,
                    semantic: 0,
                    sessionLane: session,
                },
            }));
        }
        let ranked = Array.from(scoredById.values()).sort((left, right) => right.score - left.score || right.createdAt.localeCompare(left.createdAt));
        if (!degradedComputeMode && options.store.related && ranked.length > 0) {
            const seedIds = ranked.slice(0, Math.max(4, Math.min(12, parsed.maxItems * 2))).map((row) => row.id);
            if (seedIds.length > 0 || queryEntityHints.length > 0) {
                try {
                    const related = await options.store.related({
                        tenantId: tenantResolution.tenantId,
                        seedIds,
                        entityHints: queryEntityHints,
                        patternHints: queryPatternHints,
                        limit: Math.max(parsed.maxItems * 6, 32),
                        maxHops: Math.max(1, Math.min(parsed.maxHops, 2)),
                        includeSeed: false,
                    });
                    const relatedById = new Map(related.map((row) => [row.id, row]));
                    const boostedRanked = ranked.map((row) => applyRelatedBoost(row, relatedById.get(row.id)));
                    const boostedById = new Map(boostedRanked.map((row) => [row.id, row]));
                    const missingIds = related.map((row) => row.id).filter((id) => !boostedById.has(id));
                    if (missingIds.length > 0) {
                        const fetched = await options.store.getByIds({
                            ids: missingIds,
                            tenantId: tenantResolution.tenantId,
                        });
                        for (const row of fetched) {
                            if (!matchesContextScope(row))
                                continue;
                            const asSearch = toSearchResultFromRecord(row, {
                                matchedBy: ["relationship"],
                                scoreBreakdown: {
                                    rrf: 0.15,
                                    sourceTrust: row.sourceConfidence,
                                    recency: recencyScore(row.occurredAt, row.createdAt, row.memoryType, temporalAnchorMs),
                                    importance: row.importance,
                                    session: 0,
                                    sessionLane: 0,
                                },
                            }, temporalAnchorMs);
                            boostedById.set(asSearch.id, applyRelatedBoost(asSearch, relatedById.get(asSearch.id)));
                        }
                    }
                    ranked = Array.from(boostedById.values()).sort((left, right) => right.score - left.score || right.createdAt.localeCompare(left.createdAt));
                    ranked = diversifyRankedRows(ranked, Math.max(parsed.maxItems * 3, parsed.maxItems));
                }
                catch {
                    // optional graph/entity ranking
                }
            }
        }
        if (!degradedComputeMode) {
            ranked = await applyLoopStateOnRows(ranked);
            ranked = await mergeLoopStatePointerRows(ranked);
        }
        ranked = ranked.sort((left, right) => right.score - left.score || right.createdAt.localeCompare(left.createdAt));
        const layerOrderedRanked = [...ranked].sort((left, right) => {
            const layerDelta = (0, layers_1.memoryLayerPriority)(left.memoryLayer) - (0, layers_1.memoryLayerPriority)(right.memoryLayer);
            if (layerDelta !== 0)
                return layerDelta;
            const acceptedDelta = Number(right.status === "accepted") - Number(left.status === "accepted");
            if (acceptedDelta !== 0)
                return acceptedDelta;
            return right.score - left.score || right.createdAt.localeCompare(left.createdAt);
        });
        const selected = [];
        let usedChars = 0;
        let droppedByBudget = 0;
        const selectedIds = new Set();
        const addWithBudget = (row) => {
            if (selected.length >= parsed.maxItems)
                return false;
            if (selectedIds.has(row.id))
                return false;
            const nextChars = row.content.length;
            if (usedChars + nextChars > parsed.maxChars) {
                droppedByBudget += 1;
                return false;
            }
            selected.push(row);
            selectedIds.add(row.id);
            usedChars += nextChars;
            return true;
        };
        const relationshipStats = {
            hopsUsed: 0,
            addedFromRelationships: 0,
            attempted: false,
            frontierSeedCount: 0,
        };
        const seedMemoryId = parsed.seedMemoryId?.trim() || null;
        if (seedMemoryId) {
            relationshipStats.attempted = true;
            const fromRanked = ranked.find((row) => row.id === seedMemoryId);
            if (fromRanked) {
                addWithBudget(fromRanked);
            }
            else {
                const fetched = await options.store.getByIds({
                    ids: [seedMemoryId],
                    tenantId: tenantResolution.tenantId,
                });
                const row = fetched[0];
                if (row && !isExpiredRecord(row) && sourceAllowed(row.source, sourceAllowlist, sourceDenylist) && row.status !== "quarantined") {
                    knownRows.set(row.id, row);
                    addWithBudget(toSearchResultFromRecord(row, undefined, temporalAnchorMs));
                }
            }
        }
        const primarySelectionLimit = parsed.expandRelationships
            ? query
                ? 1
                : parsed.maxItems > 1
                    ? parsed.maxItems - 1
                    : parsed.maxItems
            : parsed.maxItems;
        for (const candidate of layerOrderedRanked) {
            if (selected.length >= primarySelectionLimit)
                break;
            addWithBudget(candidate);
        }
        if (!degradedComputeMode && parsed.expandRelationships && parsed.maxHops >= 1 && selected.length < parsed.maxItems) {
            relationshipStats.attempted = true;
            let frontier = selected.map((row) => row.id);
            relationshipStats.frontierSeedCount = frontier.length;
            const visited = new Set(selectedIds);
            const relationshipHintById = new Map();
            for (let hop = 1; hop <= parsed.maxHops && frontier.length > 0; hop += 1) {
                const discovered = new Set();
                const frontierSet = new Set(frontier);
                for (const id of frontier) {
                    const row = knownRows.get(id);
                    if (!row)
                        continue;
                    const metadata = normalizeMetadata(row.metadata);
                    for (const relatedId of extractRelationIds(metadata)) {
                        if (!visited.has(relatedId))
                            discovered.add(relatedId);
                    }
                    const threadKey = threadKeyFromMetadata(metadata);
                    if (threadKey) {
                        const siblings = threadBuckets.get(threadKey) || [];
                        for (const sibling of siblings) {
                            if (!visited.has(sibling.id))
                                discovered.add(sibling.id);
                        }
                    }
                }
                if (options.store.related && frontier.length > 0) {
                    try {
                        const related = await options.store.related({
                            tenantId: tenantResolution.tenantId,
                            seedIds: frontier,
                            entityHints: hop === 1 ? queryEntityHints : [],
                            patternHints: hop === 1 ? queryPatternHints : [],
                            limit: Math.max(parsed.maxItems * 8, 32),
                            maxHops: 1,
                            includeSeed: false,
                        });
                        for (const hit of related) {
                            if (!hit.id || frontierSet.has(hit.id))
                                continue;
                            relationshipHintById.set(hit.id, hit);
                            if (!visited.has(hit.id))
                                discovered.add(hit.id);
                        }
                    }
                    catch {
                        // optional graph/entity expansion
                    }
                }
                if (!discovered.size) {
                    relationshipStats.hopsUsed = hop - 1;
                    break;
                }
                const toFetch = [...discovered].filter((id) => !knownRows.has(id));
                if (toFetch.length > 0) {
                    const fetched = await options.store.getByIds({
                        ids: toFetch,
                        tenantId: tenantResolution.tenantId,
                    });
                    for (const row of fetched) {
                        if (!visited.has(row.id) && matchesContextScope(row)) {
                            knownRows.set(row.id, row);
                        }
                    }
                }
                const expanded = [...discovered]
                    .map((id) => knownRows.get(id))
                    .filter((row) => Boolean(row))
                    .filter((row) => !visited.has(row.id))
                    .sort((left, right) => {
                    const leftHint = relationshipHintById.get(left.id);
                    const rightHint = relationshipHintById.get(right.id);
                    if (leftHint || rightHint) {
                        return (rightHint?.score ?? 0) - (leftHint?.score ?? 0) || right.createdAt.localeCompare(left.createdAt);
                    }
                    return right.createdAt.localeCompare(left.createdAt);
                });
                if (expanded.length === 0 && discovered.size > 0) {
                    relationshipStats.addedFromRelationships += 1;
                    relationshipStats.hopsUsed = hop;
                    break;
                }
                const nextFrontier = [];
                for (const row of expanded) {
                    if (selected.length >= parsed.maxItems)
                        break;
                    const hint = relationshipHintById.get(row.id);
                    const asSearchBase = toSearchResultFromRecord(row, {
                        matchedBy: ["relationship"],
                        scoreBreakdown: {
                            rrf: 0.15,
                            sourceTrust: row.sourceConfidence,
                            recency: recencyScore(row.occurredAt, row.createdAt, row.memoryType, temporalAnchorMs),
                            importance: row.importance,
                            session: 0,
                            sessionLane: 0,
                        },
                    }, temporalAnchorMs);
                    const asSearch = applyRelatedBoost(asSearchBase, hint);
                    if (addWithBudget(asSearch)) {
                        visited.add(row.id);
                        nextFrontier.push(row.id);
                        relationshipStats.addedFromRelationships += 1;
                    }
                }
                relationshipStats.hopsUsed = hop;
                frontier = nextFrontier;
            }
        }
        if (query && selected.length > 0) {
            writeContextFallbackCache(contextFallbackCacheKey, selected.slice(0, Math.max(parsed.maxItems * 3, parsed.maxItems)), retrievalModeUsed);
        }
        return {
            summary: summarizeContextItems(selected, 480),
            items: selected,
            budget: {
                maxItems: parsed.maxItems,
                maxChars: parsed.maxChars,
                usedChars,
                scanLimit: parsed.scanLimit,
                scanned: tenantRows.length,
                droppedByBudget,
            },
            selection: {
                tenantId: tenantResolution.tenantId,
                requestedTenantId: tenantResolution.requestedTenantId,
                tenantFallbackApplied: tenantResolution.fallbackApplied,
                agentId,
                runId,
                query,
                seedMemoryId,
                retrievalMode: retrievalModeUsed,
                sourceAllowlist,
                sourceDenylist,
                layerAllowlist,
                layerDenylist,
                temporalAnchorAt: parsed.temporalAnchorAt ?? null,
                includeExplain: parsed.explain,
                tenantFallbackUsedForEmptyScope,
                expandRelationships: parsed.expandRelationships,
                requestedMaxHops: parsed.maxHops,
                relationshipExpansion: {
                    hopsUsed: relationshipStats.hopsUsed,
                    addedFromRelationships: relationshipStats.addedFromRelationships,
                    attempted: relationshipStats.attempted,
                    frontierSeedCount: relationshipStats.frontierSeedCount,
                },
            },
            diagnostics: {
                candidateCounts: {
                    tenantRows: tenantRows.length,
                    scopedRows: scopedRows.length,
                    searchRows: searchRows.length,
                    mergedRows: ranked.length,
                    byLayer: countByLayer([...coreRows, ...effectiveRows]),
                    selectedByLayer: countByLayerFromSearchRows(selected),
                    fallbackByLayer: countByLayerFromSearchRows(ranked.filter((row) => row.matchedBy.includes("recent") || row.matchedBy.includes("context-recent-fallback"))),
                },
                retrievalModeUsed,
                includeTenantFallback: parsed.includeTenantFallback,
                consolidationInfluence: {
                    status: consolidationArtifact?.status === "running"
                        ? "running"
                        : consolidationArtifact?.status === "failed"
                            ? "failed"
                            : normalizeText(consolidationArtifact?.finishedAt || consolidationArtifact?.lastSuccessAt)
                                ? "success"
                                : briefArtifact?.consolidation?.mode === "unavailable"
                                    ? "unavailable"
                                    : "idle",
                    mode: normalizeText(consolidationArtifact?.mode || briefArtifact?.consolidation?.mode) || null,
                    lastRunAt: normalizeText(consolidationArtifact?.finishedAt || consolidationArtifact?.lastSuccessAt || briefArtifact?.consolidation?.lastRunAt)
                        || null,
                    nextRunAt: normalizeText(consolidationArtifact?.nextRunAt || briefArtifact?.consolidation?.nextRunAt) || null,
                    focusAreas: Array.isArray(consolidationArtifact?.focusAreas)
                        ? consolidationArtifact.focusAreas.map((entry) => normalizeText(entry)).filter(Boolean).slice(0, 6)
                        : Array.isArray(briefArtifact?.consolidation?.focusAreas)
                            ? briefArtifact.consolidation.focusAreas.map((entry) => normalizeText(entry)).filter(Boolean).slice(0, 6)
                            : [],
                },
                tenantRowsTimedOut,
                degradedComputeMode,
            },
        };
    };
    const backfillEmailThreading = async (raw) => {
        let parsed;
        try {
            parsed = contracts_1.memoryEmailThreadBackfillRequestSchema.parse(raw ?? {});
        }
        catch (error) {
            throw normalizeError(error);
        }
        const startedAt = new Date().toISOString();
        const tenantId = normalizeTenant(parsed.tenantId);
        const sourcePrefixes = sanitizeStringList(parsed.sourcePrefixes).slice(0, 12);
        const rows = await options.store.recent({
            tenantId,
            limit: parsed.limit,
        });
        let scanned = 0;
        let eligible = 0;
        let updated = 0;
        let skipped = 0;
        let failed = 0;
        let writesAttempted = 0;
        let timeoutErrors = 0;
        let consecutiveTimeoutErrors = 0;
        let stopReason = null;
        const maxWrites = Math.max(1, Math.min(parsed.maxWrites, parsed.limit));
        const writeDelayMs = Math.max(0, parsed.writeDelayMs);
        const stopAfterTimeoutErrors = Math.max(1, parsed.stopAfterTimeoutErrors);
        const sample = [];
        const errors = [];
        const pushSample = (entry) => {
            if (sample.length >= 40)
                return;
            sample.push(entry);
        };
        const sleep = async (ms) => new Promise((resolve) => {
            setTimeout(resolve, Math.max(0, ms));
        });
        const canonicalThreadSignals = (metadata) => {
            const signals = normalizeMetadata(metadata.threadReconstructionSignals);
            return {
                deterministicSignature: normalizeText(signals.deterministicSignature) || null,
                messageIdCount: Math.max(0, Number(signals.messageIdCount ?? 0) || 0),
                replyReferenceCount: Math.max(0, Number(signals.replyReferenceCount ?? 0) || 0),
                participantCount: Math.max(0, Number(signals.participantCount ?? 0) || 0),
                hasLinkableMessagePath: signals.hasLinkableMessagePath === true,
            };
        };
        for (const row of rows) {
            if (!parsed.dryRun && writesAttempted >= maxWrites) {
                stopReason = "max-writes-reached";
                break;
            }
            scanned += 1;
            const metadataBefore = normalizeMetadata(row.metadata);
            const normalizedSource = normalizeSource(row.source);
            const looksEmailSource = normalizedSource.startsWith("mail:") ||
                normalizedSource.includes("email") ||
                sourcePrefixes.some((prefix) => normalizedSource.startsWith(prefix));
            const beforeNormalizedMessageId = normalizeText(metadataBefore.normalizedMessageId) || null;
            const beforeInReply = normalizeText(metadataBefore.inReplyToNormalized || metadataBefore.inReplyTo);
            const beforeRefs = readStringValues(metadataBefore.referenceMessageIds, 48).map((value) => String(value).toLowerCase());
            const beforeThreadSignature = normalizeText(metadataBefore.threadDeterministicSignature) || null;
            const beforeThreadSignals = canonicalThreadSignals(metadataBefore);
            const hasMessageLikeFields = Boolean(beforeNormalizedMessageId ||
                beforeInReply ||
                beforeRefs.length > 0 ||
                normalizeText(metadataBefore.messageId || metadataBefore.rawMessageId || metadataBefore.references));
            if (!looksEmailSource && (!parsed.includeNonMailLikeWithMessageSignals || !hasMessageLikeFields)) {
                skipped += 1;
                continue;
            }
            const enriched = redactSensitiveMetadata(enrichCaptureMetadata({
                source: normalizedSource,
                content: row.content,
                tags: row.tags,
                metadata: metadataBefore,
            }));
            const metadataAfter = normalizeMetadata(enriched);
            const afterNormalizedMessageId = normalizeText(metadataAfter.normalizedMessageId) || null;
            const afterInReply = normalizeText(metadataAfter.inReplyToNormalized || metadataAfter.inReplyTo);
            const afterRefs = readStringValues(metadataAfter.referenceMessageIds, 48).map((value) => String(value).toLowerCase());
            const afterThreadSignature = normalizeText(metadataAfter.threadDeterministicSignature) || null;
            const afterThreadSignals = canonicalThreadSignals(metadataAfter);
            const beforeCanonical = {
                messageId: normalizeMessageReferenceList([metadataBefore.normalizedMessageId, metadataBefore.messageId, metadataBefore.rawMessageId, metadataBefore["message-id"]], 1)[0] ?? null,
                inReplyTo: normalizeMessageReferenceList([metadataBefore.inReplyToNormalized, metadataBefore.inReplyTo, metadataBefore.replyTo, metadataBefore["in-reply-to"]], 1)[0] ?? null,
                refs: normalizeMessageReferenceList([metadataBefore.referenceMessageIds, metadataBefore.references, metadataBefore.inReplyToNormalized, metadataBefore.inReplyTo], 64),
                threadSignature: beforeThreadSignature,
                threadSignals: beforeThreadSignals,
            };
            const afterCanonical = {
                messageId: normalizeMessageReferenceList([metadataAfter.normalizedMessageId, metadataAfter.messageId, metadataAfter.rawMessageId, metadataAfter["message-id"]], 1)[0] ?? null,
                inReplyTo: normalizeMessageReferenceList([metadataAfter.inReplyToNormalized, metadataAfter.inReplyTo, metadataAfter.replyTo, metadataAfter["in-reply-to"]], 1)[0] ?? null,
                refs: normalizeMessageReferenceList([metadataAfter.referenceMessageIds, metadataAfter.references, metadataAfter.inReplyToNormalized, metadataAfter.inReplyTo], 64),
                threadSignature: afterThreadSignature,
                threadSignals: afterThreadSignals,
            };
            const beforeMessageTokenized = beforeCanonical.messageId ? /^msg_[a-f0-9]{16,64}$/i.test(beforeCanonical.messageId) : true;
            const beforeReplyTokenized = beforeCanonical.inReplyTo ? /^msg_[a-f0-9]{16,64}$/i.test(beforeCanonical.inReplyTo) : true;
            const beforeRefsTokenized = beforeCanonical.refs.every((value) => /^msg_[a-f0-9]{16,64}$/i.test(String(value).trim()));
            const nonTokenizedMessageRefs = !beforeMessageTokenized || !beforeReplyTokenized || !beforeRefsTokenized;
            const hadLegacyMask = beforeNormalizedMessageId === "[redacted]" ||
                beforeInReply === "[redacted]" ||
                beforeRefs.some((value) => value === "[redacted]");
            const changed = stableStringify(beforeCanonical) !== stableStringify(afterCanonical);
            if (!changed) {
                skipped += 1;
                continue;
            }
            eligible += 1;
            const reasons = [];
            if (hadLegacyMask)
                reasons.push("legacy-redaction");
            if (nonTokenizedMessageRefs)
                reasons.push("non-tokenized-message-refs");
            if (!beforeThreadSignature && afterThreadSignature)
                reasons.push("missing-thread-signature");
            if (stableStringify(beforeThreadSignals) !== stableStringify(afterThreadSignals)) {
                reasons.push("missing-thread-signals");
            }
            const reason = reasons.length > 0 ? reasons.join(",") : "metadata-normalization";
            if (parsed.dryRun) {
                pushSample({
                    id: row.id,
                    source: row.source,
                    reason,
                    beforeNormalizedMessageId,
                    afterNormalizedMessageId,
                    beforeThreadSignature,
                    afterThreadSignature,
                });
                continue;
            }
            try {
                writesAttempted += 1;
                await capture({
                    id: row.id,
                    tenantId: row.tenantId ?? undefined,
                    agentId: row.agentId,
                    runId: row.runId,
                    content: row.content,
                    source: row.source,
                    tags: row.tags,
                    metadata: metadataBefore,
                    clientRequestId: `email-backfill:${row.id}`.slice(0, 120),
                    occurredAt: row.occurredAt ?? undefined,
                    status: row.status,
                    memoryType: row.memoryType,
                    sourceConfidence: row.sourceConfidence,
                    importance: row.importance,
                }, {
                    bypassRunWriteBurstLimit: true,
                    skipSignalIndexing: true,
                });
                updated += 1;
                consecutiveTimeoutErrors = 0;
                pushSample({
                    id: row.id,
                    source: row.source,
                    reason,
                    beforeNormalizedMessageId,
                    afterNormalizedMessageId,
                    beforeThreadSignature,
                    afterThreadSignature,
                });
            }
            catch (error) {
                failed += 1;
                if (isTransientStoreTimeoutError(error)) {
                    timeoutErrors += 1;
                    consecutiveTimeoutErrors += 1;
                }
                else {
                    consecutiveTimeoutErrors = 0;
                }
                errors.push({
                    id: row.id,
                    message: error instanceof Error ? error.message : String(error),
                });
                if (consecutiveTimeoutErrors >= stopAfterTimeoutErrors) {
                    stopReason = "timeout-error-threshold";
                    break;
                }
            }
            if (!parsed.dryRun && writeDelayMs > 0) {
                await sleep(writeDelayMs);
            }
        }
        return {
            tenantId,
            dryRun: parsed.dryRun,
            startedAt,
            finishedAt: new Date().toISOString(),
            scanned,
            eligible,
            updated,
            skipped,
            failed,
            writesAttempted,
            maxWrites,
            stoppedEarly: stopReason !== null,
            stopReason,
            timeoutErrors,
            convergence: {
                windowScanned: scanned,
                windowEligible: eligible,
                windowUpdated: updated,
                windowRemainingEligible: Math.max(0, eligible - updated),
                windowRemainingRatio: scanned > 0 ? Math.max(0, eligible - updated) / scanned : 0,
                writeUtilization: maxWrites > 0 ? Math.min(1, writesAttempted / maxWrites) : 0,
                timeoutRate: writesAttempted > 0 ? timeoutErrors / writesAttempted : 0,
                exhaustedWithinWindow: Math.max(0, eligible - updated) === 0,
            },
            sample,
            errors,
        };
    };
    const backfillSignalIndexing = async (raw) => {
        let parsed;
        try {
            parsed = contracts_1.memorySignalIndexBackfillRequestSchema.parse(raw ?? {});
        }
        catch (error) {
            throw normalizeError(error);
        }
        const startedAt = new Date().toISOString();
        const tenantId = normalizeTenant(parsed.tenantId);
        let scanned = 0;
        let eligible = 0;
        let updated = 0;
        let skipped = 0;
        let failed = 0;
        let writesAttempted = 0;
        let timeoutErrors = 0;
        let alreadyIndexedSkipped = 0;
        let loopStateUpdates = 0;
        let consecutiveTimeoutErrors = 0;
        let stopReason = null;
        const maxWrites = Math.max(1, Math.min(parsed.maxWrites, parsed.limit));
        const writeDelayMs = Math.max(0, parsed.writeDelayMs);
        const stopAfterTimeoutErrors = Math.max(1, parsed.stopAfterTimeoutErrors);
        const minSignals = Math.max(1, Math.min(parsed.minSignals, 512));
        const skipAlreadyIndexed = parsed.skipAlreadyIndexed !== false;
        const inferRelationships = parsed.inferRelationships !== false;
        const relationshipProbeLimit = Math.max(2, Math.min(parsed.relationshipProbeLimit, 128));
        const maxInferredEdgesPerMemory = Math.max(0, Math.min(parsed.maxInferredEdgesPerMemory, 128));
        const minRelatedSignalScore = Math.max(0, Math.min(parsed.minRelatedSignalScore, 2));
        const sourcePrefixes = sanitizeStringList(parsed.sourcePrefixes).slice(0, 12);
        let relationshipProbes = 0;
        let relationshipMemoriesConsidered = 0;
        let relationshipMemoriesAugmented = 0;
        let inferredEdgesAdded = 0;
        let messageReferenceEdgesAdded = 0;
        let stateInferenceEdgesAdded = 0;
        let contextOverlapEdgesAdded = 0;
        let relationshipSkippedDueToBudget = 0;
        const sample = [];
        const errors = [];
        const pushSample = (entry) => {
            if (sample.length >= 40)
                return;
            sample.push(entry);
        };
        const sleep = async (ms) => new Promise((resolve) => {
            setTimeout(resolve, Math.max(0, ms));
        });
        const isStatePattern = (pattern) => pattern.patternType === "state" &&
            (pattern.patternKey === "open-loop" ||
                pattern.patternKey === "resolved" ||
                pattern.patternKey === "reopened" ||
                pattern.patternKey === "superseded");
        const buildPresenceKeys = (memoryId, indexInput) => {
            const edgeKeyMap = new Map();
            for (const edge of indexInput.edges ?? []) {
                const targetId = String(edge?.targetId ?? "").trim();
                const relationType = normalizeEntityType(edge?.relationType) || "related";
                if (!targetId || targetId === memoryId || !relationType)
                    continue;
                const dedupe = `${targetId}|${relationType}`;
                if (edgeKeyMap.has(dedupe))
                    continue;
                edgeKeyMap.set(dedupe, { targetId, relationType });
                if (edgeKeyMap.size >= 128)
                    break;
            }
            const entityKeyMap = new Map();
            for (const entity of indexInput.entities ?? []) {
                const entityType = normalizeEntityType(entity?.entityType);
                const entityKey = normalizeEntityKey(entity?.entityKey);
                if (!entityType || !entityKey)
                    continue;
                const dedupe = `${entityType}|${entityKey}`;
                if (entityKeyMap.has(dedupe))
                    continue;
                entityKeyMap.set(dedupe, { entityType, entityKey });
                if (entityKeyMap.size >= 160)
                    break;
            }
            const patternKeyMap = new Map();
            for (const pattern of indexInput.patterns ?? []) {
                const patternType = normalizePatternType(pattern?.patternType);
                const patternKey = normalizePatternKey(pattern?.patternKey);
                if (!patternType || !patternKey)
                    continue;
                const dedupe = `${patternType}|${patternKey}`;
                if (patternKeyMap.has(dedupe))
                    continue;
                patternKeyMap.set(dedupe, { patternType, patternKey });
                if (patternKeyMap.size >= 192)
                    break;
            }
            return {
                edgeKeys: Array.from(edgeKeyMap.values()),
                entityKeys: Array.from(entityKeyMap.values()),
                patternKeys: Array.from(patternKeyMap.values()),
            };
        };
        const probeSignalIndexed = async (row, indexInput) => {
            const keys = buildPresenceKeys(row.id, indexInput);
            const hasKeys = keys.edgeKeys.length > 0 || keys.entityKeys.length > 0 || keys.patternKeys.length > 0;
            if (!hasKeys)
                return false;
            let indexed = false;
            if (options.store.hasSignalIndex) {
                try {
                    const probe = await withTimeout(options.store.hasSignalIndex({
                        tenantId: row.tenantId,
                        memoryId: row.id,
                        edgeKeys: keys.edgeKeys,
                        entityKeys: keys.entityKeys,
                        patternKeys: keys.patternKeys,
                    }), 4_000, "memory signal-index key-presence probe stage");
                    indexed = probe.indexed === true;
                }
                catch {
                    // best-effort key-presence probe
                }
            }
            if (!indexed && options.store.related) {
                const entityHints = buildRelatedEntityHints(indexInput.entities).slice(0, 16);
                const patternHints = buildRelatedPatternHints(indexInput.patterns).slice(0, 16);
                if (entityHints.length > 0 || patternHints.length > 0) {
                    try {
                        const probe = await withTimeout(options.store.related({
                            tenantId: row.tenantId,
                            seedIds: [row.id],
                            includeSeed: true,
                            maxHops: 1,
                            limit: 6,
                            entityHints,
                            patternHints,
                        }), 4_000, "memory signal-index probe stage");
                        indexed = probe.some((hit) => hit.id === row.id &&
                            (Number(hit.entityScore ?? 0) > 0 || Number(hit.patternScore ?? 0) > 0 || Number(hit.graphScore ?? 0) > 0));
                    }
                    catch {
                        // best-effort index-presence probe
                    }
                }
            }
            return indexed;
        };
        const inferRelationshipEdges = async (params) => {
            if (!inferRelationships || !options.store.related || maxInferredEdgesPerMemory <= 0) {
                return {
                    probes: 0,
                    added: 0,
                    messageReferenceAdded: 0,
                    stateInferenceAdded: 0,
                    contextOverlapAdded: 0,
                    budgetExhausted: false,
                };
            }
            let probes = 0;
            let added = 0;
            let messageReferenceAdded = 0;
            let stateInferenceAdded = 0;
            let contextOverlapAdded = 0;
            let remaining = Math.min(maxInferredEdgesPerMemory, Math.max(0, GRAPH_RELATION_LIMIT - params.indexInput.edges.length));
            const edgeSeen = new Set(params.indexInput.edges.map((edge) => `${edge.targetId}|${normalizeEntityType(edge.relationType) || "related"}`));
            const tryAppendEdge = (input) => {
                if (remaining <= 0)
                    return false;
                const beforeCount = params.indexInput.edges.length;
                appendEdge(params.indexInput.edges, edgeSeen, params.row.id, input.targetId, input.relationType, input.weight, input.evidence);
                const appended = params.indexInput.edges.length > beforeCount;
                if (appended) {
                    added += 1;
                    remaining -= 1;
                }
                return appended;
            };
            const metadataForThreading = normalizeMetadata(params.metadata);
            const normalizedMessageId = normalizeMessageReferenceList(metadataForThreading.normalizedMessageId, 1)[0] ?? "";
            const inReplyToNormalized = normalizeMessageReferenceList([metadataForThreading.inReplyToNormalized, metadataForThreading.inReplyTo], 1)[0] ?? "";
            const referenceMessageIds = mergeUniqueStrings(normalizeMessageReferenceList(metadataForThreading.referenceMessageIds, 24), normalizeMessageReferenceList([inReplyToNormalized, metadataForThreading.inReplyTo, metadataForThreading.replyTo, metadataForThreading.references], 24), 24)
                .map((value) => String(value).toLowerCase())
                .filter(Boolean);
            const threadKey = normalizeText(metadataForThreading.threadKey);
            if (remaining > 0 && referenceMessageIds.length > 0) {
                try {
                    probes += 1;
                    const related = await withTimeout(options.store.related({
                        tenantId: params.row.tenantId,
                        seedIds: [],
                        entityHints: referenceMessageIds.map((messageId) => ({
                            entityType: "message-id",
                            entityKey: messageId,
                            weight: 1,
                        })),
                        patternHints: threadKey ? [{ patternType: "thread", patternKey: threadKey, weight: 0.72 }] : [],
                        limit: Math.max(12, relationshipProbeLimit),
                        maxHops: 1,
                        includeSeed: false,
                    }), 4_500, "memory backfill relationship message-reference inference stage");
                    for (const hit of related.slice(0, relationshipProbeLimit)) {
                        if (!hit?.id || hit.id === params.row.id)
                            continue;
                        const relationType = hit.matchedBy.includes("entity") && hit.matchedBy.includes("pattern") ? "reply-thread" : "reply-to";
                        const weight = clamp01(0.68 + hit.entityScore * 0.2 + hit.patternScore * 0.14 + hit.graphScore * 0.1, 0.72);
                        const appended = tryAppendEdge({
                            targetId: hit.id,
                            relationType,
                            weight,
                            evidence: {
                                via: "backfill-message-id-reference",
                                matchedBy: hit.matchedBy,
                                graphScore: hit.graphScore,
                                entityScore: hit.entityScore,
                                patternScore: hit.patternScore,
                            },
                        });
                        if (appended)
                            messageReferenceAdded += 1;
                        if (remaining <= 0)
                            break;
                    }
                }
                catch {
                    // best-effort reply-thread inference
                }
            }
            if (remaining > 0 && normalizedMessageId) {
                try {
                    probes += 1;
                    const descendants = await withTimeout(options.store.related({
                        tenantId: params.row.tenantId,
                        seedIds: [],
                        entityHints: [{ entityType: "message-ref", entityKey: normalizedMessageId.toLowerCase(), weight: 1 }],
                        patternHints: threadKey ? [{ patternType: "thread", patternKey: threadKey, weight: 0.7 }] : [],
                        limit: Math.max(10, relationshipProbeLimit),
                        maxHops: 1,
                        includeSeed: false,
                    }), 4_500, "memory backfill relationship message-backlink inference stage");
                    for (const hit of descendants.slice(0, relationshipProbeLimit)) {
                        if (!hit?.id || hit.id === params.row.id)
                            continue;
                        const weight = clamp01(0.62 + hit.entityScore * 0.22 + hit.patternScore * 0.12, 0.66);
                        const appended = tryAppendEdge({
                            targetId: hit.id,
                            relationType: "thread-follow-up",
                            weight,
                            evidence: {
                                via: "backfill-message-id-backlink",
                                matchedBy: hit.matchedBy,
                                graphScore: hit.graphScore,
                                entityScore: hit.entityScore,
                                patternScore: hit.patternScore,
                            },
                        });
                        if (appended)
                            messageReferenceAdded += 1;
                        if (remaining <= 0)
                            break;
                    }
                }
                catch {
                    // best-effort descendant threading
                }
            }
            const hasResolvedState = params.indexInput.patterns.some((pattern) => pattern.patternType === "state" && pattern.patternKey === "resolved");
            const hasOpenLoopState = params.indexInput.patterns.some((pattern) => pattern.patternType === "state" && pattern.patternKey === "open-loop");
            const hasReopenedState = params.indexInput.patterns.some((pattern) => pattern.patternType === "state" && pattern.patternKey === "reopened");
            const hasSupersededState = params.indexInput.patterns.some((pattern) => pattern.patternType === "state" && pattern.patternKey === "superseded");
            if (remaining > 0 && (hasResolvedState || hasOpenLoopState || hasReopenedState || hasSupersededState)) {
                try {
                    probes += 1;
                    const baseEntityHints = buildRelatedEntityHints(params.indexInput.entities);
                    const basePatternHints = buildRelatedPatternHints(params.indexInput.patterns);
                    if (hasResolvedState)
                        basePatternHints.push({ patternType: "state", patternKey: "open-loop", weight: 1 });
                    if (hasOpenLoopState)
                        basePatternHints.push({ patternType: "state", patternKey: "resolved", weight: 0.82 });
                    if (hasReopenedState)
                        basePatternHints.push({ patternType: "state", patternKey: "resolved", weight: 0.9 });
                    if (hasSupersededState) {
                        basePatternHints.push({ patternType: "state", patternKey: "resolved", weight: 0.84 });
                        basePatternHints.push({ patternType: "state", patternKey: "open-loop", weight: 0.86 });
                    }
                    const dedupedPatternHints = Array.from(new Map(basePatternHints.map((hint) => [
                        `${normalizePatternType(hint.patternType)}|${normalizePatternKey(hint.patternKey)}`,
                        hint,
                    ])).values()).slice(0, 32);
                    const inferred = await withTimeout(options.store.related({
                        tenantId: params.row.tenantId,
                        seedIds: [],
                        entityHints: baseEntityHints,
                        patternHints: dedupedPatternHints,
                        limit: Math.max(16, relationshipProbeLimit),
                        maxHops: 1,
                        includeSeed: false,
                    }), 4_500, "memory backfill relationship state inference stage");
                    for (const hit of inferred.slice(0, relationshipProbeLimit)) {
                        if (!hit?.id || hit.id === params.row.id)
                            continue;
                        if (hasResolvedState && (hit.patternScore > 0.04 || hit.entityScore > 0.04)) {
                            const inferredWeight = clamp01(0.72 + hit.patternScore * 0.18 + hit.entityScore * 0.14, 0.74);
                            const appended = tryAppendEdge({
                                targetId: hit.id,
                                relationType: "resolves",
                                weight: inferredWeight,
                                evidence: {
                                    via: "backfill-state-inference",
                                    matchedBy: hit.matchedBy,
                                    graphScore: hit.graphScore,
                                    entityScore: hit.entityScore,
                                    patternScore: hit.patternScore,
                                },
                            });
                            if (appended)
                                stateInferenceAdded += 1;
                            if (remaining <= 0)
                                break;
                            continue;
                        }
                        if (hasOpenLoopState && hit.patternScore > 0.08 && hit.matchedBy.includes("pattern")) {
                            const inferredWeight = clamp01(0.6 + hit.patternScore * 0.22 + hit.entityScore * 0.12, 0.62);
                            const appended = tryAppendEdge({
                                targetId: hit.id,
                                relationType: "reopens",
                                weight: inferredWeight,
                                evidence: {
                                    via: "backfill-state-inference",
                                    matchedBy: hit.matchedBy,
                                    graphScore: hit.graphScore,
                                    entityScore: hit.entityScore,
                                    patternScore: hit.patternScore,
                                },
                            });
                            if (appended)
                                stateInferenceAdded += 1;
                            if (remaining <= 0)
                                break;
                            continue;
                        }
                        if (hasReopenedState && (hit.patternScore > 0.06 || hit.graphScore > 0.05)) {
                            const inferredWeight = clamp01(0.64 + hit.patternScore * 0.2 + hit.graphScore * 0.14, 0.66);
                            const appended = tryAppendEdge({
                                targetId: hit.id,
                                relationType: "reopens",
                                weight: inferredWeight,
                                evidence: {
                                    via: "backfill-state-inference",
                                    matchedBy: hit.matchedBy,
                                    graphScore: hit.graphScore,
                                    entityScore: hit.entityScore,
                                    patternScore: hit.patternScore,
                                },
                            });
                            if (appended)
                                stateInferenceAdded += 1;
                            if (remaining <= 0)
                                break;
                            continue;
                        }
                        if (hasSupersededState && (hit.patternScore > 0.05 || hit.entityScore > 0.05)) {
                            const inferredWeight = clamp01(0.66 + hit.patternScore * 0.18 + hit.entityScore * 0.18, 0.68);
                            const appended = tryAppendEdge({
                                targetId: hit.id,
                                relationType: "supersedes",
                                weight: inferredWeight,
                                evidence: {
                                    via: "backfill-state-inference",
                                    matchedBy: hit.matchedBy,
                                    graphScore: hit.graphScore,
                                    entityScore: hit.entityScore,
                                    patternScore: hit.patternScore,
                                },
                            });
                            if (appended)
                                stateInferenceAdded += 1;
                            if (remaining <= 0)
                                break;
                        }
                    }
                }
                catch {
                    // best-effort state link inference
                }
            }
            if (remaining > 0) {
                const entityHints = buildRelatedEntityHints(params.indexInput.entities).slice(0, 24);
                const patternHints = buildRelatedPatternHints(params.indexInput.patterns).slice(0, 24);
                if (entityHints.length > 0 || patternHints.length > 0) {
                    try {
                        probes += 1;
                        const candidates = await withTimeout(options.store.related({
                            tenantId: params.row.tenantId,
                            seedIds: [params.row.id],
                            includeSeed: false,
                            maxHops: 1,
                            limit: Math.max(24, relationshipProbeLimit),
                            entityHints,
                            patternHints,
                        }), 4_500, "memory backfill relationship context-overlap inference stage");
                        for (const hit of candidates.slice(0, relationshipProbeLimit)) {
                            if (!hit?.id || hit.id === params.row.id)
                                continue;
                            const entityScore = Math.max(0, Number(hit.entityScore ?? 0));
                            const patternScore = Math.max(0, Number(hit.patternScore ?? 0));
                            const graphScore = Math.max(0, Number(hit.graphScore ?? 0));
                            const combinedScore = entityScore * 0.56 + patternScore * 0.34 + graphScore * 0.2;
                            if (combinedScore < minRelatedSignalScore)
                                continue;
                            const hasEntityMatch = hit.matchedBy.includes("entity") || entityScore >= 0.04;
                            const hasPatternMatch = hit.matchedBy.includes("pattern") || patternScore >= 0.04;
                            const relationType = hasEntityMatch && hasPatternMatch
                                ? "context-overlap"
                                : hasEntityMatch
                                    ? "entity-overlap"
                                    : hasPatternMatch
                                        ? "pattern-overlap"
                                        : "graph-overlap";
                            const weight = clamp01(0.58 + entityScore * 0.18 + patternScore * 0.16 + graphScore * 0.12, 0.62);
                            const appended = tryAppendEdge({
                                targetId: hit.id,
                                relationType,
                                weight,
                                evidence: {
                                    via: "backfill-context-overlap",
                                    combinedScore,
                                    matchedBy: hit.matchedBy,
                                    graphScore,
                                    entityScore,
                                    patternScore,
                                },
                            });
                            if (appended)
                                contextOverlapAdded += 1;
                            if (remaining <= 0)
                                break;
                        }
                    }
                    catch {
                        // best-effort context overlap inference
                    }
                }
            }
            return {
                probes,
                added,
                messageReferenceAdded,
                stateInferenceAdded,
                contextOverlapAdded,
                budgetExhausted: remaining <= 0,
            };
        };
        if (!options.store.indexSignals) {
            return {
                tenantId,
                dryRun: parsed.dryRun,
                startedAt,
                finishedAt: new Date().toISOString(),
                scanned: 0,
                eligible: 0,
                updated: 0,
                skipped: 0,
                failed: 0,
                writesAttempted: 0,
                maxWrites,
                stoppedEarly: true,
                stopReason: "index-signals-unavailable",
                timeoutErrors: 0,
                loopStateUpdates: 0,
                relationshipInference: {
                    enabled: inferRelationships,
                    probes: 0,
                    memoriesConsidered: 0,
                    memoriesAugmented: 0,
                    inferredEdgesAdded: 0,
                    messageReferenceEdgesAdded: 0,
                    stateInferenceEdgesAdded: 0,
                    contextOverlapEdgesAdded: 0,
                    skippedDueToBudget: 0,
                },
                convergence: {
                    windowScanned: 0,
                    windowEligible: 0,
                    windowUpdated: 0,
                    windowRemainingEligible: 0,
                    windowRemainingRatio: 0,
                    writeUtilization: 0,
                    timeoutRate: 0,
                    exhaustedWithinWindow: true,
                    indexedSkipRatio: 0,
                },
                sample,
                errors,
            };
        }
        const rows = await options.store.recent({
            tenantId,
            limit: parsed.limit,
        });
        for (const row of rows) {
            if (!parsed.dryRun && writesAttempted >= maxWrites) {
                stopReason = "max-writes-reached";
                break;
            }
            scanned += 1;
            const normalizedSource = normalizeSource(row.source);
            const looksMailLike = normalizedSource.startsWith("mail:") ||
                normalizedSource.includes("email") ||
                sourcePrefixes.some((prefix) => normalizedSource.startsWith(prefix));
            if (!looksMailLike && !parsed.includeNonMailLike) {
                skipped += 1;
                continue;
            }
            const metadata = normalizeMetadata(row.metadata);
            const indexInput = deriveSignalIndex({
                memoryId: row.id,
                tenantId: row.tenantId,
                content: row.content,
                metadata,
                source: normalizedSource,
                tags: row.tags,
            });
            const edgeCount = indexInput.edges.length;
            const entityCount = indexInput.entities.length;
            const patternCount = indexInput.patterns.length;
            const signalCount = edgeCount + entityCount + patternCount;
            if (signalCount < minSignals) {
                skipped += 1;
                continue;
            }
            let baseIndexed = false;
            if (skipAlreadyIndexed && (edgeCount > 0 || entityCount > 0 || patternCount > 0)) {
                baseIndexed = await probeSignalIndexed(row, indexInput);
            }
            let inferredEdgeCount = 0;
            if (inferRelationships && options.store.related && maxInferredEdgesPerMemory > 0) {
                relationshipMemoriesConsidered += 1;
                const inference = await inferRelationshipEdges({ row, metadata, indexInput });
                relationshipProbes += inference.probes;
                if (inference.budgetExhausted)
                    relationshipSkippedDueToBudget += 1;
                if (inference.added > 0) {
                    relationshipMemoriesAugmented += 1;
                    inferredEdgesAdded += inference.added;
                    messageReferenceEdgesAdded += inference.messageReferenceAdded;
                    stateInferenceEdgesAdded += inference.stateInferenceAdded;
                    contextOverlapEdgesAdded += inference.contextOverlapAdded;
                    inferredEdgeCount = inference.added;
                }
            }
            if (skipAlreadyIndexed && (edgeCount > 0 || entityCount > 0 || patternCount > 0 || inferredEdgeCount > 0)) {
                if (baseIndexed) {
                    skipped += 1;
                    alreadyIndexedSkipped += 1;
                    continue;
                }
            }
            const indexedEdgeCount = indexInput.edges.length;
            const indexedEntityCount = indexInput.entities.length;
            const indexedPatternCount = indexInput.patterns.length;
            const indexedSignalCount = indexedEdgeCount + indexedEntityCount + indexedPatternCount;
            const loopClusterKeys = Array.from(new Set(indexInput.patterns
                .filter((pattern) => pattern.patternType === "loop-cluster")
                .map((pattern) => normalizePatternKey(pattern.patternKey))
                .filter(Boolean))).slice(0, 12);
            const loopStatePattern = indexInput.patterns.find((pattern) => isStatePattern({ patternType: normalizePatternType(pattern.patternType), patternKey: normalizePatternKey(pattern.patternKey) }));
            eligible += 1;
            const reasonParts = [];
            if (indexedEdgeCount > 0)
                reasonParts.push(`edges:${indexedEdgeCount}`);
            if (indexedEntityCount > 0)
                reasonParts.push(`entities:${indexedEntityCount}`);
            if (indexedPatternCount > 0)
                reasonParts.push(`patterns:${indexedPatternCount}`);
            if (inferredEdgeCount > 0)
                reasonParts.push(`inferred-edges:${inferredEdgeCount}`);
            if (loopStatePattern && loopClusterKeys.length > 0) {
                reasonParts.push(`loop-state:${normalizePatternKey(loopStatePattern.patternKey)}`);
            }
            if (looksMailLike)
                reasonParts.push("source-family:mail");
            const reason = reasonParts.join(",") || "signal-index-refresh";
            if (parsed.dryRun) {
                pushSample({
                    id: row.id,
                    source: row.source,
                    reason,
                    edgeCount: indexedEdgeCount,
                    entityCount: indexedEntityCount,
                    patternCount: indexedPatternCount,
                    signalCount: indexedSignalCount,
                    loopKeys: loopClusterKeys,
                });
                continue;
            }
            try {
                writesAttempted += 1;
                await options.store.indexSignals(indexInput);
                if (parsed.includeLoopStateUpdates && options.store.updateLoopState && loopStatePattern && loopClusterKeys.length > 0) {
                    for (const loopKey of loopClusterKeys) {
                        try {
                            await options.store.updateLoopState({
                                tenantId: row.tenantId,
                                loopKey,
                                memoryId: row.id,
                                state: normalizePatternKey(loopStatePattern.patternKey),
                                confidence: clamp01(loopStatePattern.confidence, 0.65),
                                occurredAt: row.occurredAt,
                                metadata: {
                                    source: row.source,
                                    runId: row.runId,
                                    tags: row.tags,
                                },
                            });
                            loopStateUpdates += 1;
                        }
                        catch {
                            // best-effort loop-state updates
                        }
                    }
                }
                updated += 1;
                consecutiveTimeoutErrors = 0;
                pushSample({
                    id: row.id,
                    source: row.source,
                    reason,
                    edgeCount: indexedEdgeCount,
                    entityCount: indexedEntityCount,
                    patternCount: indexedPatternCount,
                    signalCount: indexedSignalCount,
                    loopKeys: loopClusterKeys,
                });
            }
            catch (error) {
                failed += 1;
                if (isTransientStoreTimeoutError(error)) {
                    timeoutErrors += 1;
                    consecutiveTimeoutErrors += 1;
                }
                else {
                    consecutiveTimeoutErrors = 0;
                }
                errors.push({
                    id: row.id,
                    message: error instanceof Error ? error.message : String(error),
                });
                if (consecutiveTimeoutErrors >= stopAfterTimeoutErrors) {
                    stopReason = "timeout-error-threshold";
                    break;
                }
            }
            if (!parsed.dryRun && writeDelayMs > 0) {
                await sleep(writeDelayMs);
            }
        }
        return {
            tenantId,
            dryRun: parsed.dryRun,
            startedAt,
            finishedAt: new Date().toISOString(),
            scanned,
            eligible,
            updated,
            skipped,
            failed,
            writesAttempted,
            maxWrites,
            stoppedEarly: stopReason !== null,
            stopReason,
            timeoutErrors,
            alreadyIndexedSkipped,
            loopStateUpdates,
            relationshipInference: {
                enabled: inferRelationships,
                probes: relationshipProbes,
                memoriesConsidered: relationshipMemoriesConsidered,
                memoriesAugmented: relationshipMemoriesAugmented,
                inferredEdgesAdded,
                messageReferenceEdgesAdded,
                stateInferenceEdgesAdded,
                contextOverlapEdgesAdded,
                skippedDueToBudget: relationshipSkippedDueToBudget,
            },
            convergence: {
                windowScanned: scanned,
                windowEligible: eligible,
                windowUpdated: updated,
                windowRemainingEligible: Math.max(0, eligible - updated),
                windowRemainingRatio: scanned > 0 ? Math.max(0, eligible - updated) / scanned : 0,
                writeUtilization: maxWrites > 0 ? Math.min(1, writesAttempted / maxWrites) : 0,
                timeoutRate: writesAttempted > 0 ? timeoutErrors / writesAttempted : 0,
                exhaustedWithinWindow: Math.max(0, eligible - updated) === 0,
                indexedSkipRatio: scanned > 0 ? alreadyIndexedSkipped / scanned : 0,
            },
            sample,
            errors,
        };
    };
    const scrubSyntheticThreadMetadata = async (raw) => {
        let parsed;
        try {
            parsed = contracts_1.memoryThreadMetadataScrubRequestSchema.parse(raw ?? {});
        }
        catch (error) {
            throw normalizeError(error);
        }
        const startedAt = new Date().toISOString();
        const tenantId = normalizeTenant(parsed.tenantId);
        const sourcePrefixes = sanitizeStringList(parsed.sourcePrefixes).slice(0, 24);
        const rows = await (options.store.recentCreated
            ? options.store.recentCreated({
                tenantId,
                limit: parsed.limit,
            })
            : options.store.recent({
                tenantId,
                limit: parsed.limit,
            }));
        let scanned = 0;
        let eligible = 0;
        let updated = 0;
        let skipped = 0;
        let failed = 0;
        let writesAttempted = 0;
        let timeoutErrors = 0;
        let consecutiveTimeoutErrors = 0;
        let stopReason = null;
        const maxWrites = Math.max(1, Math.min(parsed.maxWrites, parsed.limit));
        const writeDelayMs = Math.max(0, parsed.writeDelayMs);
        const stopAfterTimeoutErrors = Math.max(1, parsed.stopAfterTimeoutErrors);
        const sample = [];
        const errors = [];
        const pushSample = (entry) => {
            if (sample.length >= 40)
                return;
            sample.push(entry);
        };
        const sleep = async (ms) => new Promise((resolve) => {
            setTimeout(resolve, Math.max(0, ms));
        });
        for (const row of rows) {
            if (!parsed.dryRun && writesAttempted >= maxWrites) {
                stopReason = "max-writes-reached";
                break;
            }
            scanned += 1;
            const metadataBefore = normalizeMetadata(row.metadata);
            const normalizedSource = normalizeSource(row.source);
            if (sourcePrefixes.length > 0 && !sourcePrefixes.some((prefix) => normalizedSource.startsWith(prefix))) {
                skipped += 1;
                continue;
            }
            if (!parsed.includeMailLike && isMailLikeThreadSource(normalizedSource, metadataBefore)) {
                skipped += 1;
                continue;
            }
            const scrubbed = scrubThreadMetadata(metadataBefore);
            if (!scrubbed.changed) {
                skipped += 1;
                continue;
            }
            eligible += 1;
            if (parsed.dryRun) {
                pushSample({
                    id: row.id,
                    source: row.source,
                    reason: scrubbed.reason,
                    beforeThreadKey: scrubbed.beforeThreadKey,
                    afterThreadKey: scrubbed.afterThreadKey,
                    beforeLoopClusterKey: scrubbed.beforeLoopClusterKey,
                    afterLoopClusterKey: scrubbed.afterLoopClusterKey,
                    beforeThreadEvidence: scrubbed.beforeThreadEvidence,
                    afterThreadEvidence: scrubbed.afterThreadEvidence,
                });
                continue;
            }
            try {
                writesAttempted += 1;
                await capture({
                    id: row.id,
                    tenantId: row.tenantId ?? undefined,
                    agentId: row.agentId,
                    runId: row.runId,
                    content: row.content,
                    source: row.source,
                    tags: row.tags,
                    metadata: scrubbed.metadata,
                    clientRequestId: `thread-scrub:${row.id}`.slice(0, 120),
                    occurredAt: row.occurredAt ?? undefined,
                    status: row.status,
                    memoryType: row.memoryType,
                    sourceConfidence: row.sourceConfidence,
                    importance: row.importance,
                }, {
                    bypassRunWriteBurstLimit: true,
                });
                updated += 1;
                consecutiveTimeoutErrors = 0;
                pushSample({
                    id: row.id,
                    source: row.source,
                    reason: scrubbed.reason,
                    beforeThreadKey: scrubbed.beforeThreadKey,
                    afterThreadKey: scrubbed.afterThreadKey,
                    beforeLoopClusterKey: scrubbed.beforeLoopClusterKey,
                    afterLoopClusterKey: scrubbed.afterLoopClusterKey,
                    beforeThreadEvidence: scrubbed.beforeThreadEvidence,
                    afterThreadEvidence: scrubbed.afterThreadEvidence,
                });
            }
            catch (error) {
                failed += 1;
                if (isTransientStoreTimeoutError(error)) {
                    timeoutErrors += 1;
                    consecutiveTimeoutErrors += 1;
                }
                else {
                    consecutiveTimeoutErrors = 0;
                }
                errors.push({
                    id: row.id,
                    message: error instanceof Error ? error.message : String(error),
                });
                if (consecutiveTimeoutErrors >= stopAfterTimeoutErrors) {
                    stopReason = "timeout-error-threshold";
                    break;
                }
            }
            if (!parsed.dryRun && writeDelayMs > 0) {
                await sleep(writeDelayMs);
            }
        }
        return {
            tenantId,
            dryRun: parsed.dryRun,
            startedAt,
            finishedAt: new Date().toISOString(),
            scanned,
            eligible,
            updated,
            skipped,
            failed,
            writesAttempted,
            maxWrites,
            stoppedEarly: stopReason !== null,
            stopReason,
            timeoutErrors,
            convergence: {
                windowScanned: scanned,
                windowEligible: eligible,
                windowUpdated: updated,
                windowRemainingEligible: Math.max(0, eligible - updated),
                windowRemainingRatio: scanned > 0 ? Math.max(0, eligible - updated) / scanned : 0,
                writeUtilization: maxWrites > 0 ? Math.min(1, writesAttempted / maxWrites) : 0,
                timeoutRate: writesAttempted > 0 ? timeoutErrors / writesAttempted : 0,
                exhaustedWithinWindow: Math.max(0, eligible - updated) === 0,
            },
            sample,
            errors,
        };
    };
    const importBatch = async (raw) => {
        let parsed;
        try {
            parsed = zod_1.z
                .object({
                sourceOverride: zod_1.z.string().trim().min(1).max(128).optional(),
                continueOnError: zod_1.z.boolean().default(true),
                disableRunWriteBurstLimit: zod_1.z.boolean().default(false),
                generateBriefing: zod_1.z.boolean().default(false),
                briefingQuery: zod_1.z.string().trim().min(1).max(4096).optional(),
                briefingLimit: zod_1.z.number().int().min(1).max(50).default(12),
                briefingStates: zod_1.z.array(zod_1.z.string().trim().min(1).max(32)).max(8).default([]),
                briefingLanes: zod_1.z.array(zod_1.z.string().trim().min(1).max(32)).max(8).default([]),
                briefingIncidentMinEscalation: zod_1.z.number().min(0).max(2).optional(),
                briefingIncidentMinBlastRadius: zod_1.z.number().min(0).max(1).optional(),
                items: zod_1.z.array(zod_1.z.unknown()).min(1).max(contracts_1.MAX_MEMORY_IMPORT_ITEMS),
            })
                .parse(raw);
        }
        catch (error) {
            throw normalizeError(error);
        }
        const results = [];
        let imported = 0;
        let failed = 0;
        const sourceCounts = new Map();
        const topicCounts = new Map();
        const explicitSourceOverride = parsed.sourceOverride ? normalizeSource(parsed.sourceOverride) : null;
        for (const [index, item] of parsed.items.entries()) {
            try {
                const normalized = item && typeof item === "object"
                    ? { ...item }
                    : { content: String(item ?? "") };
                const sourceHint = normalizeSource(String(explicitSourceOverride ?? normalized.source ?? "import"));
                if (sourceHint) {
                    sourceCounts.set(sourceHint, (sourceCounts.get(sourceHint) ?? 0) + 1);
                }
                const normalizedMetadata = normalizeMetadata(normalized.metadata);
                const subjectHint = normalizeSubjectKey(normalizedMetadata.subject || normalized.subject);
                for (const token of subjectHint.split(/[^a-z0-9]+/g).filter((token) => token.length >= 4).slice(0, 8)) {
                    topicCounts.set(token, (topicCounts.get(token) ?? 0) + 1);
                }
                const next = explicitSourceOverride ? { ...normalized, source: explicitSourceOverride } : normalized;
                const row = await capture(next, {
                    bypassRunWriteBurstLimit: parsed.disableRunWriteBurstLimit,
                });
                imported += 1;
                results.push({ index, ok: true, id: row.id });
            }
            catch (error) {
                failed += 1;
                const message = error instanceof Error ? error.message : String(error);
                results.push({ index, ok: false, error: message });
                if (!parsed.continueOnError) {
                    break;
                }
            }
        }
        const sourceFamilies = Array.from(sourceCounts.entries())
            .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
            .map(([source]) => source)
            .slice(0, 12);
        const containsMailSource = sourceFamilies.some((source) => source.startsWith("mail:") || source.includes("email"));
        const autoBriefingEnabled = String(process.env.STUDIO_BRAIN_IMPORT_AUTO_BRIEFING || "").trim().toLowerCase() === "true";
        const shouldGenerateBriefing = parsed.generateBriefing || (containsMailSource && autoBriefingEnabled);
        let briefing = null;
        const briefingStates = parsed.briefingStates
            .map((value) => String(value).trim().toLowerCase())
            .filter((value) => value === "open-loop" || value === "resolved" || value === "reopened" || value === "superseded");
        const briefingLanes = parsed.briefingLanes
            .map((value) => String(value).trim().toLowerCase())
            .filter((value) => value === "critical" || value === "high" || value === "watch" || value === "stable");
        const topSeedTopics = Array.from(topicCounts.entries())
            .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
            .slice(0, 12);
        if (shouldGenerateBriefing && imported > 0) {
            const briefingQuery = parsed.briefingQuery?.trim() ||
                (containsMailSource
                    ? "email thread open-loop reopened unresolved ownership escalation"
                    : undefined);
            const loopsSnapshot = await loops({
                query: briefingQuery,
                states: briefingStates,
                lanes: briefingLanes,
                limit: Math.min(200, Math.max(36, parsed.briefingLimit * 3)),
                incidentLimit: parsed.briefingLimit,
                includeMemory: true,
                includeIncidents: true,
                sortBy: "escalation",
                incidentMinEscalation: parsed.briefingIncidentMinEscalation,
                incidentMinBlastRadius: parsed.briefingIncidentMinBlastRadius,
            });
            const plan = await actionPlan({
                query: briefingQuery,
                states: briefingStates,
                lanes: briefingLanes,
                limit: Math.min(120, Math.max(36, parsed.briefingLimit * 3)),
                incidentLimit: Math.min(80, Math.max(parsed.briefingLimit, 20)),
                maxActions: Math.min(80, Math.max(parsed.briefingLimit * 2, 20)),
                includeBatchPayload: true,
                incidentMinEscalation: parsed.briefingIncidentMinEscalation,
                incidentMinBlastRadius: parsed.briefingIncidentMinBlastRadius,
            });
            const topTopicsMap = new Map();
            for (const [topic, count] of topSeedTopics) {
                topTopicsMap.set(topic, (topTopicsMap.get(topic) ?? 0) + count);
            }
            for (const row of loopsSnapshot.summary.hotspots.threads.slice(0, 16)) {
                const threadTopic = normalizePatternKey(row.key);
                if (!threadTopic)
                    continue;
                topTopicsMap.set(threadTopic, (topTopicsMap.get(threadTopic) ?? 0) + Number(row.count ?? 0));
            }
            const topTopics = Array.from(topTopicsMap.entries())
                .map(([key, count]) => ({ key, count }))
                .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key))
                .slice(0, 12);
            const topOwners = loopsSnapshot.summary.ownerQueues.slice(0, 12).map((row) => ({
                owner: row.owner,
                total: row.total,
                critical: row.critical,
                atRisk: row.atRisk,
                breached: row.breached,
            }));
            briefing = {
                generatedAt: new Date().toISOString(),
                query: briefingQuery ?? null,
                importedCount: imported,
                sourceFamilies,
                topTopics,
                topOwners,
                incidents: loopsSnapshot.incidents,
                summary: loopsSnapshot.summary,
                actionPlan: plan,
            };
        }
        return {
            total: parsed.items.length,
            imported,
            failed,
            results,
            briefing,
        };
    };
    const consolidate = async (raw = {}) => {
        let parsed;
        try {
            parsed = zod_1.z.object({
                tenantId: zod_1.z.string().trim().min(1).max(128).optional(),
                mode: zod_1.z.enum(["idle", "overnight"]).default("idle"),
                runId: zod_1.z.string().trim().min(1).max(160).default(`memory-consolidation-${new Date().toISOString().replace(/[:.]/g, "-")}`),
                maxCandidates: zod_1.z.number().int().min(1).max(5_000).default(100),
                maxWrites: zod_1.z.number().int().min(1).max(1_000).default(25),
                timeBudgetMs: zod_1.z.number().int().min(5_000).max(30 * 60_000).default(120_000),
                focusAreas: zod_1.z.array(zod_1.z.string().trim().min(1).max(160)).max(12).default([]),
            }).parse(raw ?? {});
        }
        catch (error) {
            throw normalizeError(error);
        }
        const tenantId = normalizeTenant(parsed.tenantId);
        const startedAtMs = Date.now();
        const startedAt = new Date(startedAtMs).toISOString();
        const phaseTimingsMs = {
            candidateSelection: 0,
            duplicateClustering: 0,
            associationScout: 0,
            relationshipRepair: 0,
            promotionEvaluation: 0,
            artifactPublish: 0,
        };
        const candidateSelectionStartedAtMs = Date.now();
        const candidateSelection = await loadConsolidationCandidates({
            tenantId,
            maxCandidates: parsed.maxCandidates,
            focusAreas: parsed.focusAreas,
        });
        const recentRows = candidateSelection.rows;
        phaseTimingsMs.candidateSelection = Date.now() - candidateSelectionStartedAtMs;
        const duplicateClusteringStartedAtMs = Date.now();
        const clusterBuild = buildConsolidationClusters(recentRows, MEMORY_CONSOLIDATION_DEDUPE_SIMILARITY_THRESHOLD);
        const clusters = clusterBuild.clusters;
        phaseTimingsMs.duplicateClustering = Date.now() - duplicateClusteringStartedAtMs;
        let writes = 0;
        let promotionCount = 0;
        let archiveCount = 0;
        let quarantineCount = 0;
        let repairedEdgeCount = 0;
        let connectionNoteCount = 0;
        let associationIntentCount = 0;
        let associationBundleCount = 0;
        let associationConnectionNoteCount = 0;
        let themeClusterCount = 0;
        const focusAreas = [...parsed.focusAreas];
        const artifactOutputs = [MEMORY_CONSOLIDATION_RELATIVE_PATH.join("/")];
        const promotionIds = [];
        const archiveIds = [];
        const quarantineIds = [];
        const repairedClusterIds = [];
        const connectionNoteIds = [];
        const repairDetails = [];
        const clusterInspectionDetails = [];
        const connectionNoteDetails = [];
        const promotionDetails = [];
        const archiveDetails = [];
        const quarantineDetails = [];
        const associationDetails = [];
        const associationErrors = [];
        const promotionCandidateDetails = [];
        const queryReplayDetails = [];
        const bundleOrigins = [];
        const writeAudit = [];
        const phaseAudit = [];
        const decisionAudit = [];
        const promotionCandidatesByFingerprint = new Map();
        const existingConnectionNotesById = new Map();
        const initialAssociationOutcomes = [];
        let synthesisBundleCount = 0;
        let promotionCandidateCount = 0;
        let promotionCandidateConfirmedCount = 0;
        let stalledCandidateCount = 0;
        let secondPassQueriesUsed = 0;
        let actionableInsightCount = 0;
        let suppressedConnectionNoteCount = 0;
        let suppressedPseudoDecisionCount = Number(candidateSelection.details.suppressedPseudoDecisionCount ?? 0);
        const topActions = [];
        const topActionSeen = new Set();
        let writeAuditDroppedCount = 0;
        let phaseAuditDroppedCount = 0;
        let decisionAuditDroppedCount = 0;
        let writeAuditSequence = 0;
        let phaseAuditSequence = 0;
        let decisionAuditSequence = 0;
        function recordWriteAudit(entry) {
            const nextEntry = {
                sequence: writeAuditSequence += 1,
                at: new Date().toISOString(),
                elapsedMs: Math.max(0, Date.now() - startedAtMs),
                ...entry,
            };
            if (writeAudit.length >= 256) {
                writeAuditDroppedCount += 1;
                return;
            }
            writeAudit.push(nextEntry);
        }
        function recordPhaseAudit(entry) {
            const nextEntry = {
                sequence: phaseAuditSequence += 1,
                at: new Date().toISOString(),
                elapsedMs: Math.max(0, Date.now() - startedAtMs),
                ...entry,
            };
            if (phaseAudit.length >= 256) {
                phaseAuditDroppedCount += 1;
                return;
            }
            phaseAudit.push(nextEntry);
        }
        function recordDecisionAudit(entry) {
            const nextEntry = {
                sequence: decisionAuditSequence += 1,
                at: new Date().toISOString(),
                elapsedMs: Math.max(0, Date.now() - startedAtMs),
                ...entry,
            };
            if (decisionAudit.length >= 256) {
                decisionAuditDroppedCount += 1;
                return;
            }
            decisionAudit.push(nextEntry);
        }
        recordPhaseAudit({
            phase: "candidateSelection",
            event: "complete",
            durationMs: phaseTimingsMs.candidateSelection,
            count: recentRows.length,
            summary: `Loaded ${recentRows.length} candidates for consolidation.`,
        });
        recordPhaseAudit({
            phase: "duplicateClustering",
            event: "complete",
            durationMs: phaseTimingsMs.duplicateClustering,
            count: clusters.length,
            summary: `Built ${clusters.length} hard clusters and ${clusterBuild.softClusterCount} soft clusters.`,
        });
        if (suppressedPseudoDecisionCount > 0) {
            recordDecisionAudit({
                phase: "candidateSelection",
                decision: "pseudo-decision-suppression",
                status: "skipped",
                reasons: ["pseudo-decision-filter", `count:${suppressedPseudoDecisionCount}`],
                detail: (candidateSelection.details.suppressedPseudoDecisionExamples ?? []).slice(0, 2).join(" | "),
            });
        }
        const addTopAction = (text, priority = 0.5) => {
            const normalized = normalizeText(text).replace(/\s+/g, " ").trim();
            if (!normalized || looksLikePseudoDecisionTraceText(normalized) || looksLikeStartupPlaceholderText(normalized))
                return;
            const dedupe = normalized.toLowerCase();
            if (topActionSeen.has(dedupe))
                return;
            topActionSeen.add(dedupe);
            topActions.push({ text: normalized.slice(0, 180), priority });
        };
        const associationScoutStatus = {
            enabled: associationScoutAvailability.enabled,
            available: associationScoutAvailability.available,
            provider: associationScoutAvailability.provider,
            resolvedProvider: associationScoutAvailability.resolvedProvider,
            model: associationScoutAvailability.model,
            apiKeySource: associationScoutAvailability.apiKeySource,
            codexExecutable: associationScoutAvailability.codexExecutable,
            reasoningEffort: associationScoutAvailability.reasoningEffort,
            executionRoot: associationScoutAvailability.executionRoot,
            reason: associationScoutAvailability.reason,
        };
        const loadExistingPromotionCandidates = async () => {
            const existing = filterExpiredMemoryRecords(await options.store.recent({
                tenantId,
                sourceAllowlist: [MEMORY_CONSOLIDATION_PROMOTION_CANDIDATE_SOURCE],
                excludeStatuses: ["archived"],
                limit: 256,
            }));
            for (const row of existing) {
                const fingerprint = normalizeText(normalizeMetadata(row.metadata).thesisFingerprint);
                if (!fingerprint)
                    continue;
                promotionCandidatesByFingerprint.set(fingerprint, row);
            }
        };
        const loadExistingConnectionNotes = async () => {
            const existing = filterExpiredMemoryRecords(await options.store.recent({
                tenantId,
                sourceAllowlist: [MEMORY_CONSOLIDATION_CONNECTION_SOURCE],
                excludeStatuses: ["archived", "quarantined"],
                limit: 256,
            }));
            for (const row of existing) {
                existingConnectionNotesById.set(row.id, row);
            }
        };
        await loadExistingPromotionCandidates();
        await loadExistingConnectionNotes();
        const applyConsolidationRepairSignals = async (input) => {
            if (!options.store.indexSignals || input.relations.length === 0)
                return 0;
            const indexInput = deriveSignalIndex({
                memoryId: input.row.id,
                tenantId: input.row.tenantId,
                content: input.row.content,
                metadata: normalizeMetadata(input.row.metadata),
                source: normalizeSource(input.row.source),
                tags: input.row.tags,
            });
            const edgeSeen = new Set(indexInput.edges.map((edge) => `${edge.targetId}|${normalizeEntityType(edge.relationType) || "related"}`));
            const entitySeen = new Set(indexInput.entities.map((entity) => `${normalizeEntityType(entity.entityType)}|${normalizeEntityKey(entity.entityKey)}`));
            const patternSeen = new Set(indexInput.patterns.map((pattern) => `${normalizePatternType(pattern.patternType)}|${normalizePatternKey(pattern.patternKey)}`));
            let appended = 0;
            for (const relation of input.relations) {
                const beforeCount = indexInput.edges.length;
                appendEdge(indexInput.edges, edgeSeen, input.row.id, relation.targetId, relation.relationType, relation.weight, relation.evidence);
                if (indexInput.edges.length > beforeCount)
                    appended += 1;
            }
            appendEntity(indexInput.entities, entitySeen, "cluster", input.clusterKey, input.clusterKey, 0.92);
            appendPattern(indexInput.patterns, patternSeen, "consolidation-cluster", input.clusterKey, input.clusterKey, 0.92);
            appendPattern(indexInput.patterns, patternSeen, "consolidation-mode", input.mode, input.mode, 0.72);
            await options.store.indexSignals(indexInput);
            return appended;
        };
        const scoutAssociationBundle = async (bundle) => {
            if (!associationScout)
                return null;
            if (associationBundleCount >= MEMORY_CONSOLIDATION_ASSOCIATION_SCOUT_MAX_BUNDLES)
                return null;
            const startedAtMs = Date.now();
            recordPhaseAudit({
                phase: "associationScout",
                event: "start",
                bundleId: bundle.bundleId,
                clusterKey: bundle.primary.id,
                count: bundle.rows.length,
                summary: `Evaluating association bundle ${bundle.bundleId}.`,
            });
            try {
                const proposal = await associationScout.scout(buildAssociationScoutBundle({
                    runId: parsed.runId,
                    mode: parsed.mode,
                    bundleId: bundle.bundleId,
                    bundleType: bundle.bundleType,
                    themeType: bundle.themeType,
                    themeKey: bundle.themeKey,
                    recallPass: bundle.recallPass,
                    originatingBundleId: bundle.originatingBundleId,
                    replayQueries: bundle.replayQueries,
                    focusAreas,
                    rows: bundle.rows,
                }));
                associationBundleCount += 1;
                phaseTimingsMs.associationScout += Date.now() - startedAtMs;
                recordPhaseAudit({
                    phase: "associationScout",
                    event: "complete",
                    bundleId: bundle.bundleId,
                    clusterKey: bundle.primary.id,
                    durationMs: Date.now() - startedAtMs,
                    count: proposal?.intents?.length ?? 0,
                    summary: `Association bundle ${bundle.bundleId} produced ${proposal?.intents?.length ?? 0} intents.`,
                });
                return proposal;
            }
            catch (error) {
                associationBundleCount += 1;
                phaseTimingsMs.associationScout += Date.now() - startedAtMs;
                recordPhaseAudit({
                    phase: "associationScout",
                    event: "failed",
                    bundleId: bundle.bundleId,
                    clusterKey: bundle.primary.id,
                    durationMs: Date.now() - startedAtMs,
                    reason: error instanceof Error ? error.message : String(error),
                    summary: `Association bundle ${bundle.bundleId} failed.`,
                });
                if (associationErrors.length < 12) {
                    associationErrors.push({
                        bundleId: bundle.bundleId,
                        bundleType: bundle.bundleType,
                        themeType: bundle.themeType,
                        themeKey: bundle.themeKey,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
                return null;
            }
        };
        const executeAssociationProposal = async (input) => {
            const validIds = new Set(input.bundle.rows.map((row) => row.id));
            const rowsById = new Map(input.bundle.rows.map((row) => [row.id, row]));
            const intents = input.proposal.intents
                .filter((intent) => intent.confidence >= MEMORY_CONSOLIDATION_ASSOCIATION_SCOUT_INTENT_MIN_CONFIDENCE)
                .map((intent) => ({
                ...intent,
                memoryIds: intent.memoryIds.filter((id) => validIds.has(id)).slice(0, 12),
                targetIds: intent.targetIds.filter((id) => validIds.has(id)).slice(0, 12),
            }))
                .filter((intent) => intent.memoryIds.length > 0);
            associationIntentCount += intents.length;
            const followUpQueries = Array.from(new Set([
                ...input.proposal.followUpQueries,
                ...intents
                    .filter((intent) => intent.type === "follow_up_query")
                    .map((intent) => normalizeDreamQuerySeed(intent.query || intent.title)),
            ]
                .map((entry) => normalizeDreamQuerySeed(entry))
                .filter(Boolean))).slice(0, 6);
            for (const query of followUpQueries) {
                appendDreamQuerySeed(focusAreas, new Set(focusAreas.map((value) => value.toLowerCase())), query);
            }
            const bundleAccepted = input.proposal.confidence >= MEMORY_CONSOLIDATION_ASSOCIATION_SCOUT_INTENT_MIN_CONFIDENCE || intents.length > 0;
            recordDecisionAudit({
                phase: "associationScout",
                decision: "bundle-evaluated",
                status: bundleAccepted ? "accepted" : "skipped",
                clusterKey: input.bundle.bundleId,
                bundleId: input.bundle.bundleId,
                reasons: input.bundle.reasons.slice(0, 8),
                confidence: Number(input.proposal.confidence.toFixed(3)),
                contradictionCount: input.proposal.contradictions.length,
                intentCount: intents.length,
                followUpQueryCount: followUpQueries.length,
                detail: input.proposal.theme,
            });
            let wroteNote = false;
            let createdCandidateId = null;
            let confirmedPromotionId = null;
            const connectionIntent = intents.find((intent) => intent.type === "connection_note");
            if (connectionIntent
                && MEMORY_CONSOLIDATION_CONNECTION_NOTES_ENABLED
                && connectionNoteCount < MEMORY_CONSOLIDATION_MAX_CONNECTION_NOTES
                && writes < parsed.maxWrites) {
                const noteDraft = buildAssociationIntentConnectionNote({
                    tenantId,
                    runId: parsed.runId,
                    mode: parsed.mode,
                    bundle: input.bundle,
                    proposal: input.proposal,
                    intent: connectionIntent,
                    rowsById,
                    focusAreas,
                });
                const existingNote = existingConnectionNotesById.get(noteDraft.id) ?? null;
                const existingSignature = readConnectionNoteMaterialSignature(existingNote);
                if (!noteDraft.actionable) {
                    suppressedConnectionNoteCount += 1;
                    recordDecisionAudit({
                        phase: "associationScout",
                        decision: "connection-note",
                        status: "skipped",
                        clusterKey: input.bundle.bundleId,
                        bundleId: input.bundle.bundleId,
                        memoryId: existingNote?.id || noteDraft.id,
                        reasons: ["not-actionable", ...noteDraft.actionabilityReasons].slice(0, 8),
                        confidence: Number(connectionIntent.confidence.toFixed(3)),
                        contradictionCount: input.proposal.contradictions.length,
                        detail: connectionIntent.title,
                    });
                }
                else if (existingSignature && existingSignature === noteDraft.materialSignature) {
                    suppressedConnectionNoteCount += 1;
                    recordDecisionAudit({
                        phase: "associationScout",
                        decision: "connection-note",
                        status: "skipped",
                        clusterKey: input.bundle.bundleId,
                        bundleId: input.bundle.bundleId,
                        memoryId: existingNote?.id || noteDraft.id,
                        reasons: ["unchanged-connection-note", ...noteDraft.actionabilityReasons].slice(0, 8),
                        confidence: Number(connectionIntent.confidence.toFixed(3)),
                        contradictionCount: input.proposal.contradictions.length,
                        detail: connectionIntent.title,
                    });
                }
                else {
                    const storedNote = await capture({
                        id: noteDraft.id,
                        tenantId,
                        agentId: options.defaultAgentId,
                        runId: parsed.runId,
                        content: noteDraft.content,
                        source: MEMORY_CONSOLIDATION_CONNECTION_SOURCE,
                        tags: noteDraft.tags,
                        metadata: noteDraft.metadata,
                        status: noteDraft.status,
                        memoryType: "episodic",
                        memoryLayer: "episodic",
                        sourceConfidence: noteDraft.sourceConfidence,
                        importance: noteDraft.importance,
                    }, { bypassRunWriteBurstLimit: true });
                    existingConnectionNotesById.set(storedNote.id, storedNote);
                    writes += 1;
                    connectionNoteCount += 1;
                    associationConnectionNoteCount += 1;
                    connectionNoteIds.push(storedNote.id);
                    if (storedNote.status === "accepted") {
                        actionableInsightCount += 1;
                    }
                    addTopAction(noteDraft.recommendation, storedNote.status === "accepted" ? 0.84 : 0.62);
                    const relatedIds = filterAssociationScoutIntentIds(connectionIntent, validIds);
                    const noteRepairEdges = await applyConsolidationRepairSignals({
                        row: storedNote,
                        clusterKey: input.bundle.bundleId,
                        mode: parsed.mode,
                        relations: relatedIds.map((targetId) => ({
                            targetId,
                            relationType: targetId === input.bundle.primary.id
                                ? "thread-root"
                                : normalizeEntityType(connectionIntent.relationType || "associates-with") || "associates-with",
                            weight: Math.max(MEMORY_CONSOLIDATION_REPAIR_THRESHOLD, Number(Math.max(connectionIntent.confidence, input.proposal.confidence).toFixed(3))),
                            evidence: {
                                via: "memory-consolidation-association-intent",
                                runId: parsed.runId,
                                bundleId: input.bundle.bundleId,
                                theme: input.proposal.theme,
                            },
                        })),
                    });
                    repairedEdgeCount += noteRepairEdges;
                    if (noteRepairEdges > 0) {
                        recordWriteAudit({
                            phase: "associationScout",
                            action: "repair-signals",
                            writeKind: "signal-index",
                            memoryId: storedNote.id,
                            clusterKey: input.bundle.bundleId,
                            bundleId: input.bundle.bundleId,
                            targetIds: relatedIds,
                            edgeCount: noteRepairEdges,
                            detail: "Indexed connection-note relationships from association intent.",
                            proposalTheme: input.proposal.theme,
                            intentTitle: connectionIntent.title,
                            reasons: input.bundle.reasons.slice(0, 8),
                        });
                    }
                    if (connectionNoteDetails.length < 12) {
                        connectionNoteDetails.push({
                            clusterKey: input.bundle.bundleId,
                            memoryId: storedNote.id,
                            primaryId: input.bundle.primary.id,
                            promotedId: input.promotedId || null,
                            status: noteDraft.status,
                            topic: noteDraft.topicLabel,
                            recommendation: noteDraft.recommendation,
                            repairedEdges: noteRepairEdges,
                            reasons: input.bundle.reasons,
                            strongestSimilarity: Number(input.bundle.strongestSimilarity.toFixed(3)),
                            meanSimilarity: Number(input.bundle.meanSimilarity.toFixed(3)),
                            sourceSummary: noteDraft.sourceSummary,
                            associationTheme: input.proposal.theme,
                            associationModel: input.proposal.model,
                        });
                    }
                    recordWriteAudit({
                        phase: "associationScout",
                        action: "connection-note",
                        writeKind: "memory-record",
                        memoryId: storedNote.id,
                        source: storedNote.source,
                        status: storedNote.status,
                        statusBefore: null,
                        statusAfter: storedNote.status,
                        memoryLayer: storedNote.memoryLayer,
                        memoryType: storedNote.memoryType,
                        clusterKey: input.bundle.bundleId,
                        bundleId: input.bundle.bundleId,
                        targetIds: relatedIds,
                        detail: connectionIntent.title,
                        proposalTheme: input.proposal.theme,
                        intentTitle: connectionIntent.title,
                        reasons: input.bundle.reasons.slice(0, 8),
                    });
                    recordDecisionAudit({
                        phase: "associationScout",
                        decision: "connection-note",
                        status: storedNote.status === "accepted" ? "accepted" : "proposed",
                        clusterKey: input.bundle.bundleId,
                        bundleId: input.bundle.bundleId,
                        memoryId: storedNote.id,
                        reasons: input.bundle.reasons.slice(0, 8),
                        confidence: Number(connectionIntent.confidence.toFixed(3)),
                        contradictionCount: input.proposal.contradictions.length,
                        intentCount: intents.length,
                        followUpQueryCount: input.proposal.followUpQueries.length,
                        detail: connectionIntent.title,
                    });
                    wroteNote = true;
                }
            }
            const repairIntents = intents.filter((intent) => intent.type === "repair_edges");
            for (const intent of repairIntents) {
                if (writes >= parsed.maxWrites || input.bundle.conflictingLoopState)
                    break;
                const sourceRow = rowsById.get(intent.memoryIds[0]);
                if (!sourceRow)
                    continue;
                const targets = Array.from(new Set([...intent.memoryIds.slice(1), ...intent.targetIds]))
                    .filter((id) => id !== sourceRow.id && validIds.has(id))
                    .slice(0, 8);
                if (targets.length === 0)
                    continue;
                const repaired = await applyConsolidationRepairSignals({
                    row: sourceRow,
                    clusterKey: input.bundle.bundleId,
                    mode: parsed.mode,
                    relations: targets.map((targetId) => ({
                        targetId,
                        relationType: normalizeEntityType(intent.relationType || "associates-with") || "associates-with",
                        weight: Math.max(MEMORY_CONSOLIDATION_REPAIR_THRESHOLD, Number(intent.confidence.toFixed(3))),
                        evidence: {
                            via: "memory-consolidation-association-intent",
                            runId: parsed.runId,
                            bundleId: input.bundle.bundleId,
                            explanation: intent.explanation,
                        },
                    })),
                });
                repairedEdgeCount += repaired;
                if (repaired > 0) {
                    recordWriteAudit({
                        phase: "associationScout",
                        action: "repair-signals",
                        writeKind: "signal-index",
                        memoryId: sourceRow.id,
                        clusterKey: input.bundle.bundleId,
                        bundleId: input.bundle.bundleId,
                        targetIds: targets,
                        edgeCount: repaired,
                        detail: intent.title,
                        proposalTheme: input.proposal.theme,
                        intentTitle: intent.title,
                        reasons: input.bundle.reasons.slice(0, 8),
                    });
                    repairedClusterIds.push(input.bundle.bundleId);
                }
            }
            const promotionIntent = intents.find((intent) => intent.type === "promotion_candidate");
            const quarantineIntent = intents.find((intent) => intent.type === "quarantine_candidate");
            const candidateIntent = promotionIntent ?? quarantineIntent ?? null;
            if (candidateIntent) {
                const supportingRows = selectBundleSupportRows(input.bundle, candidateIntent, rowsById);
                const sourceFamilyMix = countByDreamFamily(supportingRows, DREAM_CANDIDATE_FAMILY_ORDER.length);
                const sourceFamilies = sourceFamilyMix.map((entry) => entry.family);
                const acceptedOrLineageRow = supportingRows.some((row) => row.status === "accepted" || hasCanonicalLineage(normalizeMetadata(row.metadata)));
                const contradictionCount = input.proposal.contradictions.length;
                const thesisFingerprint = buildPromotionCandidateFingerprint(input.bundle, input.proposal, candidateIntent);
                const existingCandidate = promotionCandidatesByFingerprint.get(thesisFingerprint) ?? null;
                const promotionIntentConfidence = promotionIntent?.confidence ?? 0;
                const candidateConfidence = Math.max(candidateIntent.confidence, input.proposal.confidence);
                const candidateImportance = supportingRows.reduce((sum, row) => sum + row.importance, 0) / Math.max(1, supportingRows.length);
                const candidateReasons = [
                    candidateIntent.type,
                    input.bundle.conflictingLoopState ? "conflicting-loop-state" : "",
                    candidateIntent.confidence < MEMORY_CONSOLIDATION_THEME_PROMOTION_CANDIDATE_MIN_CONFIDENCE
                        ? "candidate-confidence-below-threshold"
                        : "",
                    input.proposal.confidence < 0.75 ? "bundle-confidence-below-threshold" : "",
                    contradictionCount > 1 ? "contradiction-threshold-exceeded" : "",
                    supportingRows.length < 3 ? "insufficient-supporting-rows" : "",
                    countNonCompactionFamilies(supportingRows) < 2 ? "insufficient-source-families" : "",
                    !acceptedOrLineageRow ? "missing-accepted-or-lineage-support" : "",
                ].filter(Boolean);
                const candidateEligible = Boolean(promotionIntent)
                    && MEMORY_CONSOLIDATION_THEME_PROMOTION_CANDIDATE_ENABLED
                    && !input.bundle.conflictingLoopState
                    && promotionIntentConfidence >= MEMORY_CONSOLIDATION_THEME_PROMOTION_CANDIDATE_MIN_CONFIDENCE
                    && input.proposal.confidence >= 0.75
                    && contradictionCount <= 1
                    && supportingRows.length >= 3
                    && countNonCompactionFamilies(supportingRows) >= 2
                    && acceptedOrLineageRow;
                const confirmGateA = supportingRows.some((row) => row.memoryLayer === "canonical" || hasCanonicalLineage(normalizeMetadata(row.metadata)))
                    && supportingRows.filter((row) => row.status === "accepted" && ["episodic-accepted", "channel-manual"].includes(dreamSourceFamilyKey(row))).length >= 2;
                const confirmGateB = countAcceptedNonRawSupport(supportingRows) >= 3
                    && countNonCompactionFamilies(supportingRows) >= MEMORY_CONSOLIDATION_THEME_PROMOTION_CONFIRM_MIN_FAMILIES;
                const shouldQuarantineCandidate = input.bundle.conflictingLoopState
                    || contradictionCount >= 2
                    || Boolean(quarantineIntent && quarantineIntent.confidence >= 0.7);
                const candidateActionable = shouldQuarantineCandidate
                    ? (input.bundle.conflictingLoopState
                        || contradictionCount >= 2
                        || (countAcceptedNonRawSupport(supportingRows) >= 2 && countNonCompactionFamilies(supportingRows) >= 2))
                    : (countAcceptedNonRawSupport(supportingRows) >= 2
                        && countNonCompactionFamilies(supportingRows) >= 2
                        && acceptedOrLineageRow);
                if (!candidateActionable)
                    candidateReasons.push("not-actionable");
                if (shouldQuarantineCandidate && writes < parsed.maxWrites) {
                    if (!candidateActionable) {
                        recordDecisionAudit({
                            phase: "associationScout",
                            decision: "quarantine",
                            status: "skipped",
                            clusterKey: input.bundle.bundleId,
                            bundleId: input.bundle.bundleId,
                            reasons: candidateReasons.slice(0, 8),
                            confidence: Number(candidateIntent.confidence.toFixed(3)),
                            contradictionCount,
                            detail: candidateIntent.title,
                        });
                    }
                    else {
                        const candidateId = existingCandidate?.id || `dream-promotion-candidate:${thesisFingerprint}`;
                        const baseMetadata = normalizeMetadata(existingCandidate?.metadata);
                        const quarantinedCandidate = await capture({
                            id: candidateId,
                            tenantId,
                            agentId: options.defaultAgentId,
                            runId: parsed.runId,
                            content: existingCandidate?.content
                                || `Dream promotion candidate quarantined: ${input.proposal.theme}\n\n${input.proposal.summary}`,
                            source: MEMORY_CONSOLIDATION_PROMOTION_CANDIDATE_SOURCE,
                            tags: Array.from(new Set([...(existingCandidate?.tags ?? []), "dream-cycle", "promotion-candidate", "quarantined"])),
                            metadata: {
                                ...baseMetadata,
                                candidateForLayer: "canonical",
                                thesisFingerprint,
                                supportingIds: supportingRows.map((row) => row.id),
                                sourceFamilyMix,
                                scoutConfidence: Number(candidateIntent.confidence.toFixed(3)),
                                bundleConfidence: Number(input.proposal.confidence.toFixed(3)),
                                contradictionCount,
                                verifierReasons: candidateReasons,
                                originatingBundleIds: Array.from(new Set([input.bundle.bundleId, input.bundle.originatingBundleId].filter(Boolean))),
                                replayLineage: input.bundle.recallPass === "second-pass"
                                    ? {
                                        originatingBundleId: input.bundle.originatingBundleId,
                                        replayQueries: input.bundle.replayQueries,
                                        addedRowIds: input.bundle.addedRowIds,
                                    }
                                    : null,
                                quarantinedByConsolidation: {
                                    runId: parsed.runId,
                                    contradictionCount,
                                    reasons: candidateReasons,
                                },
                            },
                            status: "quarantined",
                            memoryType: "episodic",
                            memoryLayer: "episodic",
                            sourceConfidence: Number(candidateConfidence.toFixed(3)),
                            importance: Number(candidateImportance.toFixed(3)),
                        }, { bypassRunWriteBurstLimit: true });
                        writes += 1;
                        quarantineCount += 1;
                        quarantineIds.push(quarantinedCandidate.id);
                        promotionCandidatesByFingerprint.set(thesisFingerprint, quarantinedCandidate);
                        actionableInsightCount += 1;
                        addTopAction(`Keep "${input.proposal.theme}" quarantined until the contradiction is resolved.`, 0.96);
                        addTopAction(`Review and split the supporting memories for "${input.proposal.theme}" before the next dream pass.`, 0.88);
                        recordWriteAudit({
                            phase: "associationScout",
                            action: "quarantine",
                            writeKind: "memory-record",
                            memoryId: quarantinedCandidate.id,
                            source: quarantinedCandidate.source,
                            status: "quarantined",
                            statusBefore: existingCandidate?.status ?? null,
                            statusAfter: "quarantined",
                            memoryLayer: quarantinedCandidate.memoryLayer,
                            memoryType: quarantinedCandidate.memoryType,
                            clusterKey: input.bundle.bundleId,
                            bundleId: input.bundle.bundleId,
                            targetIds: supportingRows.map((row) => row.id),
                            detail: candidateIntent.title,
                            proposalTheme: input.proposal.theme,
                            intentTitle: candidateIntent.title,
                            reasons: candidateReasons.slice(0, 8),
                        });
                        recordDecisionAudit({
                            phase: "associationScout",
                            decision: "quarantine",
                            status: "quarantined",
                            clusterKey: input.bundle.bundleId,
                            bundleId: input.bundle.bundleId,
                            memoryId: quarantinedCandidate.id,
                            reasons: candidateReasons.slice(0, 8),
                            confidence: Number(candidateIntent.confidence.toFixed(3)),
                            contradictionCount,
                            detail: candidateIntent.title,
                        });
                        if (promotionCandidateDetails.length < 16) {
                            promotionCandidateDetails.push({
                                thesisFingerprint,
                                bundleId: input.bundle.bundleId,
                                recallPass: input.bundle.recallPass,
                                status: "quarantined",
                                sourceFamilyMix,
                                supportingIds: supportingRows.map((row) => row.id),
                                contradictionCount,
                                verifierReasons: candidateReasons,
                            });
                        }
                    }
                }
                else if (candidateEligible && candidateActionable) {
                    const confirmationAllowed = Boolean(existingCandidate)
                        && (input.bundle.recallPass === "second-pass" || (existingCandidate?.runId ?? null) !== parsed.runId)
                        && (confirmGateA || confirmGateB);
                    if (confirmationAllowed && writes < parsed.maxWrites) {
                        const promoted = await capture({
                            id: `dream-promotion:${thesisFingerprint}`,
                            tenantId,
                            agentId: options.defaultAgentId,
                            runId: parsed.runId,
                            content: `Dream promotion: ${input.proposal.theme}\n\n${input.proposal.summary}`,
                            source: MEMORY_CONSOLIDATION_PROMOTED_SOURCE,
                            tags: ["dream-cycle", "promoted", "canonical-memory"],
                            metadata: {
                                thesisFingerprint,
                                candidateForLayer: "canonical",
                                derivedFromIds: supportingRows.map((row) => row.id),
                                sourceFamilyMix,
                                supportingIds: supportingRows.map((row) => row.id),
                                confirmedFromCandidateId: existingCandidate?.id || null,
                                sourceArtifactPath: `memory://${MEMORY_CONSOLIDATION_PROMOTED_SOURCE}/${thesisFingerprint}`,
                                associationScout: {
                                    provider: input.proposal.provider,
                                    model: input.proposal.model,
                                    theme: input.proposal.theme,
                                },
                            },
                            status: "accepted",
                            memoryType: (0, layers_1.defaultMemoryTypeForLayer)("canonical"),
                            memoryLayer: "canonical",
                            sourceConfidence: Number(candidateConfidence.toFixed(3)),
                            importance: Number(candidateImportance.toFixed(3)),
                        }, { bypassRunWriteBurstLimit: true });
                        writes += 1;
                        promotionCount += 1;
                        promotionCandidateConfirmedCount += 1;
                        confirmedPromotionId = promoted.id;
                        promotionIds.push(promoted.id);
                        actionableInsightCount += 1;
                        addTopAction(`Reuse the promoted "${input.proposal.theme}" memory as the canonical thread for future startup context.`, 0.98);
                        addTopAction(`Review downstream memories that still overlap "${input.proposal.theme}" and archive or relabel stragglers.`, 0.86);
                        const promotedRepairEdges = await applyConsolidationRepairSignals({
                            row: promoted,
                            clusterKey: input.bundle.bundleId,
                            mode: parsed.mode,
                            relations: supportingRows.map((row) => ({
                                targetId: row.id,
                                relationType: "derived-from",
                                weight: Math.max(MEMORY_CONSOLIDATION_REPAIR_THRESHOLD, Number(candidateIntent.confidence.toFixed(3))),
                                evidence: {
                                    via: "memory-consolidation-promotion-confirmation",
                                    runId: parsed.runId,
                                    thesisFingerprint,
                                    bundleId: input.bundle.bundleId,
                                },
                            })),
                        });
                        repairedEdgeCount += promotedRepairEdges;
                        recordWriteAudit({
                            phase: "associationScout",
                            action: "promotion",
                            writeKind: "memory-record",
                            memoryId: promoted.id,
                            source: promoted.source,
                            status: promoted.status,
                            statusBefore: null,
                            statusAfter: promoted.status,
                            memoryLayer: promoted.memoryLayer,
                            memoryType: promoted.memoryType,
                            clusterKey: input.bundle.bundleId,
                            bundleId: input.bundle.bundleId,
                            targetIds: supportingRows.map((row) => row.id),
                            detail: candidateIntent.title,
                            proposalTheme: input.proposal.theme,
                            intentTitle: candidateIntent.title,
                            reasons: candidateReasons.slice(0, 8),
                        });
                        recordDecisionAudit({
                            phase: "associationScout",
                            decision: "promotion",
                            status: "promoted",
                            clusterKey: input.bundle.bundleId,
                            bundleId: input.bundle.bundleId,
                            memoryId: promoted.id,
                            reasons: candidateReasons.slice(0, 8),
                            confidence: Number(candidateIntent.confidence.toFixed(3)),
                            importance: Number(candidateImportance.toFixed(3)),
                            contradictionCount,
                            detail: candidateIntent.title,
                        });
                        if (promotionDetails.length < 12) {
                            promotionDetails.push({
                                clusterKey: input.bundle.bundleId,
                                primaryId: input.bundle.primary.id,
                                status: "promoted",
                                thesisFingerprint,
                                sourceFamilyMix,
                                supportingIds: supportingRows.map((row) => row.id),
                            });
                        }
                        if (promotionCandidateDetails.length < 16) {
                            promotionCandidateDetails.push({
                                thesisFingerprint,
                                bundleId: input.bundle.bundleId,
                                recallPass: input.bundle.recallPass,
                                status: "confirmed",
                                promotedId: promoted.id,
                                sourceFamilyMix,
                                supportingIds: supportingRows.map((row) => row.id),
                                verifierReasons: candidateReasons,
                            });
                        }
                    }
                    else if (!existingCandidate && writes < parsed.maxWrites) {
                        const candidate = await capture({
                            id: `dream-promotion-candidate:${thesisFingerprint}`,
                            tenantId,
                            agentId: options.defaultAgentId,
                            runId: parsed.runId,
                            content: `Dream promotion candidate: ${input.proposal.theme}\n\n${input.proposal.summary}`,
                            source: MEMORY_CONSOLIDATION_PROMOTION_CANDIDATE_SOURCE,
                            tags: ["dream-cycle", "promotion-candidate"],
                            metadata: {
                                candidateForLayer: "canonical",
                                thesisFingerprint,
                                supportingIds: supportingRows.map((row) => row.id),
                                sourceFamilyMix,
                                sourceFamilies,
                                scoutConfidence: Number(candidateIntent.confidence.toFixed(3)),
                                bundleConfidence: Number(input.proposal.confidence.toFixed(3)),
                                contradictionCount,
                                verifierReasons: candidateReasons,
                                originatingBundleIds: Array.from(new Set([input.bundle.bundleId, input.bundle.originatingBundleId].filter(Boolean))),
                                replayLineage: input.bundle.recallPass === "second-pass"
                                    ? {
                                        originatingBundleId: input.bundle.originatingBundleId,
                                        replayQueries: input.bundle.replayQueries,
                                        addedRowIds: input.bundle.addedRowIds,
                                    }
                                    : null,
                            },
                            status: "proposed",
                            memoryType: "episodic",
                            memoryLayer: "episodic",
                            sourceConfidence: Number(candidateConfidence.toFixed(3)),
                            importance: Number(candidateImportance.toFixed(3)),
                        }, { bypassRunWriteBurstLimit: true });
                        writes += 1;
                        promotionCandidateCount += 1;
                        createdCandidateId = candidate.id;
                        promotionCandidatesByFingerprint.set(thesisFingerprint, candidate);
                        recordWriteAudit({
                            phase: "associationScout",
                            action: "promotion-candidate",
                            writeKind: "memory-record",
                            memoryId: candidate.id,
                            source: candidate.source,
                            status: candidate.status,
                            statusBefore: null,
                            statusAfter: candidate.status,
                            memoryLayer: candidate.memoryLayer,
                            memoryType: candidate.memoryType,
                            clusterKey: input.bundle.bundleId,
                            bundleId: input.bundle.bundleId,
                            targetIds: supportingRows.map((row) => row.id),
                            detail: candidateIntent.title,
                            proposalTheme: input.proposal.theme,
                            intentTitle: candidateIntent.title,
                            reasons: candidateReasons.slice(0, 8),
                        });
                        recordDecisionAudit({
                            phase: "associationScout",
                            decision: "promotion-candidate",
                            status: "proposed",
                            clusterKey: input.bundle.bundleId,
                            bundleId: input.bundle.bundleId,
                            memoryId: candidate.id,
                            reasons: candidateReasons.slice(0, 8),
                            confidence: Number(candidateIntent.confidence.toFixed(3)),
                            importance: Number(candidateImportance.toFixed(3)),
                            contradictionCount,
                            detail: candidateIntent.title,
                        });
                        if (promotionCandidateDetails.length < 16) {
                            promotionCandidateDetails.push({
                                thesisFingerprint,
                                bundleId: input.bundle.bundleId,
                                recallPass: input.bundle.recallPass,
                                status: "proposed",
                                candidateId: candidate.id,
                                sourceFamilyMix,
                                supportingIds: supportingRows.map((row) => row.id),
                                verifierReasons: candidateReasons,
                            });
                        }
                    }
                    else if (existingCandidate && input.bundle.recallPass === "second-pass") {
                        stalledCandidateCount += 1;
                        if (promotionCandidateDetails.length < 16) {
                            promotionCandidateDetails.push({
                                thesisFingerprint,
                                bundleId: input.bundle.bundleId,
                                recallPass: input.bundle.recallPass,
                                status: "stalled",
                                candidateId: existingCandidate.id,
                                sourceFamilyMix,
                                supportingIds: supportingRows.map((row) => row.id),
                                verifierReasons: candidateReasons,
                            });
                        }
                    }
                }
                else if (!candidateActionable && candidateIntent) {
                    recordDecisionAudit({
                        phase: "associationScout",
                        decision: promotionIntent ? "promotion-candidate" : "quarantine",
                        status: "skipped",
                        clusterKey: input.bundle.bundleId,
                        bundleId: input.bundle.bundleId,
                        reasons: candidateReasons.slice(0, 8),
                        confidence: Number(candidateIntent.confidence.toFixed(3)),
                        contradictionCount,
                        detail: candidateIntent.title,
                    });
                }
            }
            if (associationDetails.length < 16) {
                associationDetails.push({
                    bundleId: input.bundle.bundleId,
                    bundleType: input.bundle.bundleType,
                    themeType: input.bundle.themeType,
                    themeKey: input.bundle.themeKey,
                    theme: input.proposal.theme,
                    confidence: Number(input.proposal.confidence.toFixed(3)),
                    model: input.proposal.model,
                    provider: input.proposal.provider,
                    contradictionCount: input.proposal.contradictions.length,
                    recallPass: input.bundle.recallPass,
                    originatingBundleId: input.bundle.originatingBundleId,
                    followUpQueries: followUpQueries.slice(0, 4),
                    wroteNote,
                    createdCandidateId,
                    confirmedPromotionId,
                    intents: intents.map((intent) => ({
                        type: intent.type,
                        confidence: Number(intent.confidence.toFixed(3)),
                        title: intent.title,
                        memoryIds: intent.memoryIds,
                        targetIds: intent.targetIds,
                    })),
                });
            }
            return {
                wroteNote,
                bundleAccepted,
                followUpQueries,
                createdCandidateId,
                confirmedPromotionId,
            };
        };
        try {
            for (const cluster of clusters) {
                if (Date.now() - startedAtMs > parsed.timeBudgetMs)
                    break;
                if (writes >= parsed.maxWrites)
                    break;
                recordPhaseAudit({
                    phase: "promotionEvaluation",
                    event: "start",
                    clusterKey: cluster.key,
                    count: cluster.rows.length,
                    summary: `Evaluating hard cluster ${cluster.key}.`,
                });
                const primary = cluster.rows[0];
                const duplicates = cluster.rows.slice(1);
                const pairAssessments = duplicates.map((row) => ({
                    row,
                    metrics: calculateConsolidationSimilarity(primary, row),
                }));
                const strongestSimilarity = pairAssessments.reduce((max, entry) => Math.max(max, entry.metrics.score), 0);
                const meanSimilarity = pairAssessments.reduce((sum, entry) => sum + entry.metrics.score, 0) / Math.max(1, pairAssessments.length);
                const loopStates = Array.from(new Set(cluster.rows.map((row) => extractLoopStateHint(row)).filter(Boolean)));
                const conflictingLoopState = loopStates.length > 1;
                const corroboratingAcceptedEpisodic = cluster.rows.filter((row) => row.memoryLayer === "episodic" && row.status === "accepted" && !isDreamGeneratedRow(row)).length;
                const provenanceBacked = cluster.rows.some((row) => hasCanonicalLineage(normalizeMetadata(row.metadata)));
                const nonRawSupport = cluster.rows.some((row) => !normalizeSource(row.source).includes("raw"));
                const meanConfidence = cluster.rows.reduce((sum, row) => sum + row.sourceConfidence, 0) / Math.max(1, cluster.rows.length);
                const meanImportance = cluster.rows.reduce((sum, row) => sum + row.importance, 0) / Math.max(1, cluster.rows.length);
                const promotionConfidence = Math.max(primary.sourceConfidence, meanConfidence);
                const promotionImportance = Math.max(primary.importance, meanImportance);
                const clusterReasons = Array.from(new Set(pairAssessments.flatMap((entry) => summarizeConsolidationReasons(entry.metrics))));
                const acceptedOrLineageSupport = cluster.rows.some((row) => row.status === "accepted" || hasCanonicalLineage(normalizeMetadata(row.metadata)));
                const bundleContext = buildAssociationBundleContext({
                    bundleId: cluster.key,
                    bundleType: "hard-cluster",
                    themeType: "duplicate-cluster",
                    themeKey: cluster.key,
                    rows: cluster.rows,
                    strongestSimilarity,
                    meanSimilarity,
                    reasons: clusterReasons,
                });
                if (clusterInspectionDetails.length < 16) {
                    clusterInspectionDetails.push(buildClusterInspectionDetail({
                        clusterKey: cluster.key,
                        primary,
                        rows: cluster.rows,
                        pairAssessments,
                        clusterReasons,
                        strongestSimilarity,
                        meanSimilarity,
                        promotionConfidence,
                        promotionImportance,
                        corroboratingAcceptedEpisodic,
                        provenanceBacked,
                        nonRawSupport,
                        acceptedOrLineageSupport,
                        conflictingLoopState,
                        loopStates,
                    }));
                }
                const shouldCreateConnectionNote = MEMORY_CONSOLIDATION_CONNECTION_NOTES_ENABLED
                    && connectionNoteCount < MEMORY_CONSOLIDATION_MAX_CONNECTION_NOTES
                    && pairAssessments.length > 0
                    && (strongestSimilarity >= MEMORY_CONSOLIDATION_CONNECTION_NOTE_MIN_SCORE || clusterReasons.length > 0);
                const writeConnectionNote = async (promotedId) => {
                    if (!shouldCreateConnectionNote || writes >= parsed.maxWrites)
                        return;
                    const proposal = await scoutAssociationBundle(bundleContext);
                    if (proposal) {
                        const scoutOutcome = await executeAssociationProposal({
                            bundle: bundleContext,
                            proposal,
                            promotedId,
                        });
                        if (scoutOutcome.wroteNote
                            || proposal.intents.some((intent) => intent.type === "connection_note"
                                && intent.confidence >= MEMORY_CONSOLIDATION_ASSOCIATION_SCOUT_INTENT_MIN_CONFIDENCE)) {
                            return;
                        }
                    }
                    const noteDraft = buildConsolidationConnectionNote({
                        tenantId,
                        runId: parsed.runId,
                        mode: parsed.mode,
                        clusterKey: cluster.key,
                        primary,
                        rows: cluster.rows,
                        pairAssessments,
                        clusterReasons,
                        strongestSimilarity,
                        meanSimilarity,
                        acceptedOrLineageSupport,
                        conflictingLoopState,
                        corroboratingAcceptedEpisodic,
                        provenanceBacked,
                        nonRawSupport,
                        focusAreas,
                        promotedId,
                    });
                    const existingNote = existingConnectionNotesById.get(noteDraft.id) ?? null;
                    const existingSignature = readConnectionNoteMaterialSignature(existingNote);
                    if (!noteDraft.actionable) {
                        suppressedConnectionNoteCount += 1;
                        recordDecisionAudit({
                            phase: "promotionEvaluation",
                            decision: "connection-note",
                            status: "skipped",
                            clusterKey: cluster.key,
                            memoryId: existingNote?.id || noteDraft.id,
                            reasons: ["not-actionable", ...noteDraft.actionabilityReasons].slice(0, 8),
                            confidence: Number(noteDraft.sourceConfidence.toFixed(3)),
                            importance: Number(noteDraft.importance.toFixed(3)),
                            detail: noteDraft.topicLabel,
                        });
                        return;
                    }
                    if (existingSignature && existingSignature === noteDraft.materialSignature) {
                        suppressedConnectionNoteCount += 1;
                        recordDecisionAudit({
                            phase: "promotionEvaluation",
                            decision: "connection-note",
                            status: "skipped",
                            clusterKey: cluster.key,
                            memoryId: existingNote?.id || noteDraft.id,
                            reasons: ["unchanged-connection-note", ...noteDraft.actionabilityReasons].slice(0, 8),
                            confidence: Number(noteDraft.sourceConfidence.toFixed(3)),
                            importance: Number(noteDraft.importance.toFixed(3)),
                            detail: noteDraft.topicLabel,
                        });
                        return;
                    }
                    const storedNote = await capture({
                        id: noteDraft.id,
                        tenantId,
                        agentId: options.defaultAgentId,
                        runId: parsed.runId,
                        content: noteDraft.content,
                        source: MEMORY_CONSOLIDATION_CONNECTION_SOURCE,
                        tags: noteDraft.tags,
                        metadata: noteDraft.metadata,
                        status: noteDraft.status,
                        memoryType: "episodic",
                        memoryLayer: "episodic",
                        sourceConfidence: noteDraft.sourceConfidence,
                        importance: noteDraft.importance,
                    }, { bypassRunWriteBurstLimit: true });
                    existingConnectionNotesById.set(storedNote.id, storedNote);
                    writes += 1;
                    connectionNoteCount += 1;
                    connectionNoteIds.push(storedNote.id);
                    if (storedNote.status === "accepted") {
                        actionableInsightCount += 1;
                    }
                    addTopAction(noteDraft.recommendation, storedNote.status === "accepted" ? 0.78 : 0.56);
                    const noteRepairEdges = await applyConsolidationRepairSignals({
                        row: storedNote,
                        clusterKey: cluster.key,
                        mode: parsed.mode,
                        relations: cluster.rows.map((row) => ({
                            targetId: row.id,
                            relationType: row.id === primary.id ? "thread-root" : relationTypeForConsolidation(calculateConsolidationSimilarity(primary, row)),
                            weight: row.id === primary.id
                                ? 0.92
                                : Math.max(MEMORY_CONSOLIDATION_REPAIR_THRESHOLD, calculateConsolidationSimilarity(primary, row).score),
                            evidence: {
                                via: "memory-consolidation-connection-note",
                                runId: parsed.runId,
                                clusterKey: cluster.key,
                            },
                        })),
                    });
                    repairedEdgeCount += noteRepairEdges;
                    if (noteRepairEdges > 0) {
                        recordWriteAudit({
                            phase: "promotionEvaluation",
                            action: "repair-signals",
                            writeKind: "signal-index",
                            memoryId: storedNote.id,
                            clusterKey: cluster.key,
                            targetIds: cluster.rows.map((row) => row.id),
                            edgeCount: noteRepairEdges,
                            detail: "Indexed fallback connection-note relationships for hard cluster.",
                            reasons: clusterReasons.slice(0, 8),
                        });
                    }
                    if (connectionNoteDetails.length < 12) {
                        connectionNoteDetails.push({
                            clusterKey: cluster.key,
                            memoryId: storedNote.id,
                            primaryId: primary.id,
                            promotedId: promotedId || null,
                            status: noteDraft.status,
                            topic: noteDraft.topicLabel,
                            recommendation: noteDraft.recommendation,
                            repairedEdges: noteRepairEdges,
                            reasons: clusterReasons,
                            strongestSimilarity: Number(strongestSimilarity.toFixed(3)),
                            meanSimilarity: Number(meanSimilarity.toFixed(3)),
                            sourceSummary: noteDraft.sourceSummary,
                        });
                    }
                    recordWriteAudit({
                        phase: "promotionEvaluation",
                        action: "connection-note",
                        writeKind: "memory-record",
                        memoryId: storedNote.id,
                        source: storedNote.source,
                        status: storedNote.status,
                        statusBefore: null,
                        statusAfter: storedNote.status,
                        memoryLayer: storedNote.memoryLayer,
                        memoryType: storedNote.memoryType,
                        clusterKey: cluster.key,
                        targetIds: cluster.rows.map((row) => row.id),
                        detail: noteDraft.topicLabel,
                        reasons: clusterReasons.slice(0, 8),
                    });
                    recordDecisionAudit({
                        phase: "promotionEvaluation",
                        decision: "connection-note",
                        status: storedNote.status === "accepted" ? "accepted" : "proposed",
                        clusterKey: cluster.key,
                        memoryId: storedNote.id,
                        reasons: clusterReasons.slice(0, 8),
                        confidence: Number(noteDraft.sourceConfidence.toFixed(3)),
                        importance: Number(noteDraft.importance.toFixed(3)),
                        detail: noteDraft.topicLabel,
                    });
                };
                if (conflictingLoopState && writes < parsed.maxWrites) {
                    recordDecisionAudit({
                        phase: "promotionEvaluation",
                        decision: "quarantine",
                        status: "quarantined",
                        clusterKey: cluster.key,
                        reasons: ["conflicting-loop-state", ...clusterReasons].slice(0, 8),
                        confidence: Number(promotionConfidence.toFixed(3)),
                        importance: Number(promotionImportance.toFixed(3)),
                        detail: `Cluster ${cluster.key} has conflicting loop states: ${loopStates.join(", ")}`,
                    });
                    actionableInsightCount += 1;
                    addTopAction(`Keep cluster ${cluster.key} quarantined until the conflicting loop states are reconciled.`, 0.94);
                    addTopAction(`Review the conflicting memories in cluster ${cluster.key} and relabel or split them before the next overnight run.`, 0.86);
                    for (const assessment of pairAssessments.filter((entry) => entry.row.status !== "quarantined")) {
                        if (writes >= parsed.maxWrites)
                            break;
                        const row = assessment.row;
                        await capture({
                            id: row.id,
                            tenantId: row.tenantId,
                            agentId: row.agentId,
                            runId: row.runId,
                            content: row.content,
                            source: row.source,
                            tags: row.tags,
                            metadata: {
                                ...normalizeMetadata(row.metadata),
                                quarantinedByConsolidation: {
                                    runId: parsed.runId,
                                    reason: "conflicting-loop-state",
                                    primaryId: primary.id,
                                    clusterKey: cluster.key,
                                    similarityScore: assessment.metrics.score,
                                    reasons: summarizeConsolidationReasons(assessment.metrics),
                                },
                            },
                            occurredAt: row.occurredAt ?? undefined,
                            status: "quarantined",
                            memoryType: row.memoryType,
                            memoryLayer: row.memoryLayer,
                            sourceConfidence: row.sourceConfidence,
                            importance: row.importance,
                        }, { bypassRunWriteBurstLimit: true, skipSignalIndexing: true });
                        writes += 1;
                        quarantineCount += 1;
                        quarantineIds.push(row.id);
                        recordWriteAudit({
                            phase: "promotionEvaluation",
                            action: "quarantine",
                            writeKind: "memory-record",
                            memoryId: row.id,
                            source: row.source,
                            status: "quarantined",
                            statusBefore: row.status,
                            statusAfter: "quarantined",
                            memoryLayer: row.memoryLayer,
                            memoryType: row.memoryType,
                            clusterKey: cluster.key,
                            targetIds: [primary.id],
                            detail: "Conflicting loop state within consolidation cluster.",
                            reasons: summarizeConsolidationReasons(assessment.metrics),
                        });
                        if (quarantineDetails.length < 12) {
                            quarantineDetails.push({
                                clusterKey: cluster.key,
                                memoryId: row.id,
                                primaryId: primary.id,
                                similarityScore: assessment.metrics.score,
                                reasons: summarizeConsolidationReasons(assessment.metrics),
                                reason: "conflicting-loop-state",
                            });
                        }
                    }
                    if (promotionDetails.length < 12) {
                        promotionDetails.push({
                            clusterKey: cluster.key,
                            primaryId: primary.id,
                            status: "quarantined",
                            reasons: ["conflicting-loop-state"],
                            meanConfidence: Number(promotionConfidence.toFixed(3)),
                            meanImportance: Number(promotionImportance.toFixed(3)),
                            corroboratingAcceptedEpisodic,
                        });
                    }
                    await writeConnectionNote(null);
                    recordPhaseAudit({
                        phase: "promotionEvaluation",
                        event: "complete",
                        clusterKey: cluster.key,
                        count: cluster.rows.length,
                        summary: `Cluster ${cluster.key} quarantined due to conflicting loop state.`,
                    });
                    continue;
                }
                const shouldPromote = primary.status === "accepted"
                    && provenanceBacked
                    && promotionConfidence >= MEMORY_CONSOLIDATION_PROMOTION_CONFIDENCE_THRESHOLD
                    && promotionImportance >= MEMORY_CONSOLIDATION_PROMOTION_IMPORTANCE_THRESHOLD
                    && (corroboratingAcceptedEpisodic >= 2 || (provenanceBacked && nonRawSupport));
                const promotionDecisionReasons = shouldPromote
                    ? ["accepted", "provenance-backed", "promotion-threshold-met", ...clusterReasons].slice(0, 8)
                    : [
                        primary.status !== "accepted" ? "primary-not-accepted" : "",
                        !provenanceBacked ? "missing-provenance" : "",
                        promotionConfidence < MEMORY_CONSOLIDATION_PROMOTION_CONFIDENCE_THRESHOLD ? "confidence-below-threshold" : "",
                        promotionImportance < MEMORY_CONSOLIDATION_PROMOTION_IMPORTANCE_THRESHOLD ? "importance-below-threshold" : "",
                        corroboratingAcceptedEpisodic < 2 && !(provenanceBacked && nonRawSupport) ? "insufficient-corroboration" : "",
                    ].filter(Boolean);
                recordDecisionAudit({
                    phase: "promotionEvaluation",
                    decision: "promotion",
                    status: shouldPromote ? "promoted" : "skipped",
                    clusterKey: cluster.key,
                    reasons: promotionDecisionReasons,
                    confidence: Number(promotionConfidence.toFixed(3)),
                    importance: Number(promotionImportance.toFixed(3)),
                    detail: primary.id,
                });
                const relationshipRepairStartedAtMs = Date.now();
                const repairCandidates = pairAssessments.filter((entry) => acceptedOrLineageSupport
                    && entry.metrics.score >= MEMORY_CONSOLIDATION_REPAIR_THRESHOLD
                    && !conflictingLoopState);
                if (repairCandidates.length > 0) {
                    const repairedForPrimary = await applyConsolidationRepairSignals({
                        row: primary,
                        clusterKey: cluster.key,
                        mode: parsed.mode,
                        relations: repairCandidates.map((entry) => ({
                            targetId: entry.row.id,
                            relationType: relationTypeForConsolidation(entry.metrics),
                            weight: Math.max(MEMORY_CONSOLIDATION_REPAIR_THRESHOLD, entry.metrics.score),
                            evidence: {
                                via: "memory-consolidation",
                                runId: parsed.runId,
                                clusterKey: cluster.key,
                                reasons: summarizeConsolidationReasons(entry.metrics),
                                similarity: entry.metrics,
                            },
                        })),
                    });
                    repairedEdgeCount += repairedForPrimary;
                    if (repairedForPrimary > 0) {
                        recordWriteAudit({
                            phase: "relationshipRepair",
                            action: "repair-signals",
                            writeKind: "signal-index",
                            memoryId: primary.id,
                            clusterKey: cluster.key,
                            targetIds: repairCandidates.map((entry) => entry.row.id),
                            edgeCount: repairedForPrimary,
                            detail: "Indexed hard-cluster relationship repairs.",
                            reasons: clusterReasons.slice(0, 8),
                        });
                        repairedClusterIds.push(cluster.key);
                    }
                    if (repairDetails.length < 12) {
                        repairDetails.push({
                            clusterKey: cluster.key,
                            primaryId: primary.id,
                            duplicateIds: repairCandidates.map((entry) => entry.row.id),
                            repairedEdges: repairedForPrimary,
                            strongestSimilarity: Number(strongestSimilarity.toFixed(3)),
                            meanSimilarity: Number(meanSimilarity.toFixed(3)),
                            reasons: clusterReasons,
                            relationTypes: Array.from(new Set(repairCandidates.map((entry) => relationTypeForConsolidation(entry.metrics)))),
                        });
                    }
                }
                phaseTimingsMs.relationshipRepair += Date.now() - relationshipRepairStartedAtMs;
                const promotionEvaluationStartedAtMs = Date.now();
                let promotedId = null;
                if (shouldPromote && writes < parsed.maxWrites) {
                    const promoted = await capture({
                        tenantId,
                        agentId: options.defaultAgentId,
                        runId: parsed.runId,
                        content: primary.content,
                        source: MEMORY_CONSOLIDATION_PROMOTED_SOURCE,
                        tags: Array.from(new Set([...primary.tags, "memory-consolidation", "promoted"])).slice(0, 32),
                        metadata: {
                            derivedFromIds: cluster.rows.map((row) => row.id),
                            sourceArtifactPath: MEMORY_CONSOLIDATION_RELATIVE_PATH.join("/"),
                            focusAreas: focusAreas.slice(0, 6),
                            consolidation: {
                                runId: parsed.runId,
                                mode: parsed.mode,
                                clusterKey: cluster.key,
                                corroboratingAcceptedEpisodic,
                                strongestSimilarity: Number(strongestSimilarity.toFixed(3)),
                                meanSimilarity: Number(meanSimilarity.toFixed(3)),
                                reasons: clusterReasons,
                            },
                        },
                        status: "accepted",
                        memoryType: "semantic",
                        memoryLayer: "canonical",
                        sourceConfidence: Math.min(0.98, promotionConfidence),
                        importance: Math.min(0.98, promotionImportance),
                    }, { bypassRunWriteBurstLimit: true });
                    writes += 1;
                    promotionCount += 1;
                    promotionIds.push(promoted.id);
                    promotedId = promoted.id;
                    actionableInsightCount += 1;
                    addTopAction(`Reuse the promoted cluster ${cluster.key} as the canonical memory thread for future startup context.`, 0.97);
                    addTopAction(`Archive or relabel remaining duplicates linked to cluster ${cluster.key}.`, 0.84);
                    recordWriteAudit({
                        phase: "promotionEvaluation",
                        action: "promotion",
                        writeKind: "memory-record",
                        memoryId: promoted.id,
                        source: promoted.source,
                        status: promoted.status,
                        statusBefore: null,
                        statusAfter: promoted.status,
                        memoryLayer: promoted.memoryLayer,
                        memoryType: promoted.memoryType,
                        clusterKey: cluster.key,
                        targetIds: cluster.rows.map((row) => row.id),
                        detail: "Promoted stable cluster into canonical memory.",
                        reasons: promotionDecisionReasons,
                    });
                    const promotedRepairEdges = await applyConsolidationRepairSignals({
                        row: promoted,
                        clusterKey: cluster.key,
                        mode: parsed.mode,
                        relations: cluster.rows.map((row) => ({
                            targetId: row.id,
                            relationType: row.id === primary.id ? "derived-from" : relationTypeForConsolidation(calculateConsolidationSimilarity(primary, row)),
                            weight: row.id === primary.id ? 0.92 : Math.max(MEMORY_CONSOLIDATION_REPAIR_THRESHOLD, calculateConsolidationSimilarity(primary, row).score),
                            evidence: {
                                via: "memory-consolidation-promotion",
                                runId: parsed.runId,
                                clusterKey: cluster.key,
                            },
                        })),
                    });
                    repairedEdgeCount += promotedRepairEdges;
                    if (promotedRepairEdges > 0) {
                        recordWriteAudit({
                            phase: "promotionEvaluation",
                            action: "repair-signals",
                            writeKind: "signal-index",
                            memoryId: promoted.id,
                            clusterKey: cluster.key,
                            targetIds: cluster.rows.map((row) => row.id),
                            edgeCount: promotedRepairEdges,
                            detail: "Indexed promoted canonical memory relationships.",
                            reasons: clusterReasons.slice(0, 8),
                        });
                    }
                    if (focusAreas.length < 6) {
                        focusAreas.push(primary.content.replace(/\s+/g, " ").trim().slice(0, 120));
                    }
                }
                if (promotionDetails.length < 12) {
                    promotionDetails.push({
                        clusterKey: cluster.key,
                        primaryId: primary.id,
                        promotedId,
                        status: shouldPromote ? "promoted" : "skipped",
                        reasons: shouldPromote
                            ? promotionDecisionReasons
                            : promotionDecisionReasons,
                        strongestSimilarity: Number(strongestSimilarity.toFixed(3)),
                        meanSimilarity: Number(meanSimilarity.toFixed(3)),
                        meanConfidence: Number(promotionConfidence.toFixed(3)),
                        meanImportance: Number(promotionImportance.toFixed(3)),
                        corroboratingAcceptedEpisodic,
                    });
                }
                phaseTimingsMs.promotionEvaluation += Date.now() - promotionEvaluationStartedAtMs;
                await writeConnectionNote(promotedId);
                for (const assessment of pairAssessments) {
                    if (writes >= parsed.maxWrites)
                        break;
                    const row = assessment.row;
                    if (row.status === "archived")
                        continue;
                    await capture({
                        id: row.id,
                        tenantId: row.tenantId,
                        agentId: row.agentId,
                        runId: row.runId,
                        content: row.content,
                        source: row.source,
                        tags: row.tags,
                        metadata: {
                            ...normalizeMetadata(row.metadata),
                            archivedByConsolidation: {
                                runId: parsed.runId,
                                primaryId: primary.id,
                                mode: parsed.mode,
                                clusterKey: cluster.key,
                                similarityScore: assessment.metrics.score,
                                reasons: summarizeConsolidationReasons(assessment.metrics),
                            },
                        },
                        occurredAt: row.occurredAt ?? undefined,
                        status: "archived",
                        memoryType: row.memoryType,
                        memoryLayer: row.memoryLayer,
                        sourceConfidence: row.sourceConfidence,
                        importance: row.importance,
                    }, { bypassRunWriteBurstLimit: true, skipSignalIndexing: true });
                    writes += 1;
                    archiveCount += 1;
                    archiveIds.push(row.id);
                    recordWriteAudit({
                        phase: "promotionEvaluation",
                        action: "archive",
                        writeKind: "memory-record",
                        memoryId: row.id,
                        source: row.source,
                        status: "archived",
                        statusBefore: row.status,
                        statusAfter: "archived",
                        memoryLayer: row.memoryLayer,
                        memoryType: row.memoryType,
                        clusterKey: cluster.key,
                        targetIds: [primary.id],
                        detail: "Archived lower-precedence duplicate after consolidation.",
                        reasons: summarizeConsolidationReasons(assessment.metrics),
                    });
                    if (archiveDetails.length < 12) {
                        archiveDetails.push({
                            clusterKey: cluster.key,
                            memoryId: row.id,
                            primaryId: primary.id,
                            similarityScore: assessment.metrics.score,
                            reasons: summarizeConsolidationReasons(assessment.metrics),
                        });
                    }
                }
                recordPhaseAudit({
                    phase: "promotionEvaluation",
                    event: "complete",
                    clusterKey: cluster.key,
                    count: cluster.rows.length,
                    summary: `Cluster ${cluster.key} complete: promoted=${shouldPromote} archived=${Math.max(0, pairAssessments.length)}.`,
                });
            }
            const hardClusterRowIds = new Set(clusters.flatMap((cluster) => cluster.rows.map((row) => row.id)));
            const themeClusters = buildConsolidationThemeClusters(recentRows, hardClusterRowIds);
            themeClusterCount = themeClusters.length;
            if (!associationScoutStatus.available && themeClusterCount > 0 && associationErrors.length < 12) {
                associationErrors.push({
                    bundleId: null,
                    bundleType: "theme-cluster",
                    themeType: "association-scout",
                    themeKey: associationScoutStatus.reason || "unavailable",
                    error: `association scout unavailable (${associationScoutStatus.reason || "unavailable"})`,
                    model: associationScoutStatus.model,
                    apiKeySource: associationScoutStatus.apiKeySource,
                });
            }
            const maxInitialAssociationBundles = parsed.mode === "overnight" && MEMORY_CONSOLIDATION_SECOND_PASS_ENABLED
                ? Math.max(1, MEMORY_CONSOLIDATION_ASSOCIATION_SCOUT_MAX_BUNDLES - 1)
                : MEMORY_CONSOLIDATION_ASSOCIATION_SCOUT_MAX_BUNDLES;
            for (const themeCluster of themeClusters) {
                if (Date.now() - startedAtMs > parsed.timeBudgetMs)
                    break;
                if (writes >= parsed.maxWrites)
                    break;
                if (associationBundleCount >= maxInitialAssociationBundles)
                    break;
                const bundleContext = buildAssociationBundleContext({
                    bundleId: themeCluster.key,
                    bundleType: "theme-cluster",
                    themeType: themeCluster.themeType,
                    themeKey: themeCluster.themeKey,
                    rows: themeCluster.rows,
                    strongestSimilarity: themeCluster.strongestSimilarity,
                    meanSimilarity: themeCluster.meanSimilarity,
                    reasons: themeCluster.reasons,
                });
                const proposal = await scoutAssociationBundle(bundleContext);
                if (proposal) {
                    const outcome = await executeAssociationProposal({
                        bundle: bundleContext,
                        proposal,
                    });
                    initialAssociationOutcomes.push({
                        bundle: bundleContext,
                        proposal,
                        bundleAccepted: outcome.bundleAccepted,
                        followUpQueries: outcome.followUpQueries,
                        createdCandidateId: outcome.createdCandidateId,
                        confirmedPromotionId: outcome.confirmedPromotionId,
                    });
                    if (bundleOrigins.length < 24) {
                        bundleOrigins.push({
                            bundleId: bundleContext.bundleId,
                            recallPass: "initial",
                            bundleType: bundleContext.bundleType,
                            themeType: bundleContext.themeType,
                            themeKey: bundleContext.themeKey,
                            sourceFamilyMix: bundleContext.sourceFamilyMix,
                            replayQueries: [],
                            addedRowIds: [],
                        });
                    }
                }
            }
            if (parsed.mode === "overnight"
                && MEMORY_CONSOLIDATION_SECOND_PASS_ENABLED
                && MEMORY_CONSOLIDATION_SECOND_PASS_MAX_QUERIES > 0
                && associationScoutStatus.available) {
                let remainingReplayQueries = MEMORY_CONSOLIDATION_SECOND_PASS_MAX_QUERIES;
                const replayCandidates = initialAssociationOutcomes
                    .filter((entry) => entry.bundleAccepted && entry.followUpQueries.length > 0)
                    .sort((left, right) => right.proposal.confidence - left.proposal.confidence)
                    .slice(0, 3);
                for (const replayCandidate of replayCandidates) {
                    if (remainingReplayQueries <= 0)
                        break;
                    if (Date.now() - startedAtMs > parsed.timeBudgetMs)
                        break;
                    if (writes >= parsed.maxWrites)
                        break;
                    if (associationBundleCount >= MEMORY_CONSOLIDATION_ASSOCIATION_SCOUT_MAX_BUNDLES)
                        break;
                    const replayQueries = replayCandidate.followUpQueries.slice(0, Math.min(2, remainingReplayQueries));
                    if (replayQueries.length === 0)
                        continue;
                    remainingReplayQueries -= replayQueries.length;
                    secondPassQueriesUsed += replayQueries.length;
                    const seenIds = new Set(replayCandidate.bundle.rows.map((row) => row.id));
                    const addedRows = [];
                    const addReplayRow = (row) => {
                        if (!row)
                            return;
                        if (seenIds.has(row.id))
                            return;
                        if (row.status === "archived" || row.status === "quarantined")
                            return;
                        if (isExpiredRecord(row))
                            return;
                        if (isDreamGeneratedRow(row))
                            return;
                        seenIds.add(row.id);
                        if (addedRows.length < 12) {
                            addedRows.push(row);
                        }
                    };
                    for (const query of replayQueries) {
                        if (addedRows.length >= 12)
                            break;
                        const lexicalHits = filterExpiredSearchResults(await options.store.search({
                            query,
                            tenantId,
                            retrievalMode: "lexical",
                            layerDenylist: ["core"],
                            sourceDenylist: [MEMORY_CONSOLIDATION_CONNECTION_SOURCE, MEMORY_CONSOLIDATION_PROMOTION_CANDIDATE_SOURCE],
                            limit: MEMORY_CONSOLIDATION_SECOND_PASS_SEARCH_LIMIT,
                        }));
                        for (const hit of lexicalHits) {
                            const fetched = await options.store.getByIds({ tenantId, ids: [hit.id] });
                            addReplayRow(fetched[0]);
                            if (addedRows.length >= 12)
                                break;
                        }
                        if (addedRows.length >= 12 || !options.store.related || MEMORY_CONSOLIDATION_SECOND_PASS_RELATED_LIMIT <= 0) {
                            continue;
                        }
                        const entityHints = extractQueryEntityHints(query);
                        const patternHints = extractQueryPatternHints(query);
                        const related = await options.store.related({
                            tenantId,
                            seedIds: replayCandidate.bundle.rows.slice(0, 4).map((row) => row.id),
                            entityHints: entityHints.slice(0, 8),
                            patternHints: patternHints.slice(0, 8),
                            limit: MEMORY_CONSOLIDATION_SECOND_PASS_RELATED_LIMIT,
                            maxHops: 1,
                            includeSeed: false,
                        });
                        const relatedIds = related
                            .map((entry) => entry.id)
                            .filter((id) => !seenIds.has(id))
                            .slice(0, MEMORY_CONSOLIDATION_SECOND_PASS_RELATED_LIMIT);
                        if (relatedIds.length > 0) {
                            const relatedRows = await options.store.getByIds({ tenantId, ids: relatedIds });
                            for (const row of relatedRows) {
                                addReplayRow(row);
                                if (addedRows.length >= 12)
                                    break;
                            }
                        }
                    }
                    const familyMixBefore = countByDreamFamily(replayCandidate.bundle.rows, DREAM_CANDIDATE_FAMILY_ORDER.length);
                    const combinedRows = Array.from(new Map([...replayCandidate.bundle.rows, ...addedRows].map((row) => [row.id, row])).values())
                        .sort((left, right) => dreamCandidatePriorityScore(right) - dreamCandidatePriorityScore(left))
                        .slice(0, MEMORY_CONSOLIDATION_ASSOCIATION_SCOUT_MAX_MEMORIES_PER_BUNDLE);
                    const familyMixAfter = countByDreamFamily(combinedRows, DREAM_CANDIDATE_FAMILY_ORDER.length);
                    const nonEmptyFamiliesAfter = familyMixAfter.filter((entry) => entry.count > 0).length;
                    const nonCompactionFamiliesAfter = countNonCompactionFamilies(combinedRows);
                    const synthesisBundleId = `synthesis:${replayCandidate.bundle.bundleId}`;
                    let replayDropped = false;
                    let replayDropReason = null;
                    if (addedRows.length === 0) {
                        replayDropped = true;
                        replayDropReason = "no-new-rows";
                    }
                    else if (nonEmptyFamiliesAfter < 2) {
                        replayDropped = true;
                        replayDropReason = "single-source-family";
                    }
                    else if (nonCompactionFamiliesAfter < 1) {
                        replayDropped = true;
                        replayDropReason = "missing-non-compaction-family";
                    }
                    queryReplayDetails.push({
                        originBundleId: replayCandidate.bundle.bundleId,
                        synthesisBundleId: replayDropped ? null : synthesisBundleId,
                        queries: replayQueries,
                        addedMemoryIds: addedRows.map((row) => row.id),
                        familyMixBefore,
                        familyMixAfter,
                        dropped: replayDropped,
                        reason: replayDropReason,
                    });
                    if (replayDropped)
                        continue;
                    const synthesisBundle = buildAssociationBundleContext({
                        bundleId: synthesisBundleId,
                        bundleType: "synthesis-bundle",
                        themeType: replayCandidate.bundle.themeType,
                        themeKey: replayCandidate.bundle.themeKey,
                        rows: combinedRows,
                        strongestSimilarity: replayCandidate.bundle.strongestSimilarity,
                        meanSimilarity: replayCandidate.bundle.meanSimilarity,
                        reasons: Array.from(new Set([...replayCandidate.bundle.reasons, "second-pass-recall"])).slice(0, 8),
                        recallPass: "second-pass",
                        originatingBundleId: replayCandidate.bundle.bundleId,
                        replayQueries,
                        addedRowIds: addedRows.map((row) => row.id),
                    });
                    synthesisBundleCount += 1;
                    if (bundleOrigins.length < 24) {
                        bundleOrigins.push({
                            bundleId: synthesisBundle.bundleId,
                            recallPass: "second-pass",
                            bundleType: synthesisBundle.bundleType,
                            themeType: synthesisBundle.themeType,
                            themeKey: synthesisBundle.themeKey,
                            originatingBundleId: replayCandidate.bundle.bundleId,
                            replayQueries,
                            addedRowIds: addedRows.map((row) => row.id),
                            sourceFamilyMix: synthesisBundle.sourceFamilyMix,
                        });
                    }
                    const synthesisProposal = await scoutAssociationBundle(synthesisBundle);
                    if (synthesisProposal) {
                        await executeAssociationProposal({
                            bundle: synthesisBundle,
                            proposal: synthesisProposal,
                        });
                    }
                }
            }
            const finishedAt = new Date().toISOString();
            const recallPasses = [
                {
                    pass: "initial",
                    attemptedBundles: themeClusterCount,
                    evaluatedBundles: initialAssociationOutcomes.length,
                    acceptedBundles: initialAssociationOutcomes.filter((entry) => entry.bundleAccepted).length,
                },
                {
                    pass: "second-pass",
                    attemptedBundles: synthesisBundleCount,
                    queriesUsed: secondPassQueriesUsed,
                    droppedBundles: queryReplayDetails.filter((entry) => entry.dropped).length,
                },
            ];
            const resolvedTopActions = topActions
                .sort((left, right) => right.priority - left.priority || left.text.localeCompare(right.text))
                .map((entry) => entry.text)
                .slice(0, 6);
            const actionabilityPassed = promotionCount + quarantineCount > 0
                && resolvedTopActions.length >= 2
                && !candidateSelection.details.querySeeds.some((value) => looksLikeStartupPlaceholderText(value) || looksLikePseudoDecisionTraceText(value));
            const actionabilityStatus = actionabilityPassed
                ? "passed"
                : parsed.mode === "overnight"
                    ? "rathole"
                    : "repair";
            const summary = `Processed ${recentRows.length} candidates across ${clusters.length} clusters`
                + `${clusterBuild.softClusterCount > 0 ? ` (${clusterBuild.softClusterCount} soft clusters)` : ""}; `
                + `promoted ${promotionCount}, archived ${archiveCount}, quarantined ${quarantineCount}, repaired ${repairedEdgeCount} links, `
                + `wrote ${connectionNoteCount} connection notes, suppressed ${suppressedConnectionNoteCount} unchanged or non-actionable notes, executed ${associationIntentCount} association intents across ${associationBundleCount} bundles, `
                + `created ${promotionCandidateCount} promotion candidates, confirmed ${promotionCandidateConfirmedCount}, and used ${secondPassQueriesUsed} second-pass queries`
                + `${associationScoutStatus.available ? "" : ` (association scout unavailable: ${associationScoutStatus.reason || "unavailable"})`}.`;
            const artifactPublishStartedAtMs = Date.now();
            recordPhaseAudit({
                phase: "artifactPublish",
                event: "start",
                summary: "Persisting memory consolidation artifact.",
            });
            phaseTimingsMs.artifactPublish = Date.now() - artifactPublishStartedAtMs;
            recordPhaseAudit({
                phase: "artifactPublish",
                event: "complete",
                durationMs: phaseTimingsMs.artifactPublish,
                summary: "Memory consolidation artifact persisted.",
            });
            const artifact = {
                schema: "studio-brain.memory-consolidation.v1",
                runId: parsed.runId,
                mode: parsed.mode,
                status: "success",
                actionabilityStatus,
                actionableInsightCount,
                suppressedConnectionNoteCount,
                suppressedPseudoDecisionCount,
                topActions: resolvedTopActions,
                summary,
                startedAt,
                finishedAt,
                durationMs: Date.now() - startedAtMs,
                candidateCount: recentRows.length,
                clusterCount: clusters.length,
                softClusterCount: clusterBuild.softClusterCount,
                themeClusterCount,
                comparedPairCount: clusterBuild.comparedPairCount,
                promotionCount,
                archiveCount,
                quarantineCount,
                repairedEdgeCount,
                connectionNoteCount,
                associationScoutStatus,
                associationBundleCount,
                associationIntentCount,
                associationConnectionNoteCount,
                focusAreas: focusAreas.slice(0, 8),
                lastError: null,
                lastSuccessAt: finishedAt,
                nextRunAt: new Date(Date.now() + (parsed.mode === "overnight" ? 24 : 4) * 60 * 60 * 1000).toISOString(),
                outputs: artifactOutputs,
                candidateSelectionDetails: candidateSelection.details,
                familyQuotaPlan: candidateSelection.details.familyQuotaPlan,
                familyQuotaActual: candidateSelection.details.familyQuotaActual,
                dominanceWarnings: candidateSelection.details.dominanceWarnings,
                recallPasses,
                queryReplayDetails,
                synthesisBundleCount,
                secondPassQueriesUsed,
                promotionCandidateCount: Array.from(promotionCandidatesByFingerprint.values()).filter((row) => row.status === "proposed").length,
                promotionCandidateConfirmedCount,
                stalledCandidateCount,
                promotionCandidateDetails,
                bundleOrigins,
                phaseCounts: {
                    candidateSelection: recentRows.length,
                    duplicateClustering: clusters.length,
                    associationScout: associationBundleCount,
                    relationshipRepair: repairedEdgeCount,
                    promotionEvaluation: promotionCount + quarantineCount,
                    artifactPublish: 1,
                },
                phaseTimingsMs,
                writes,
                promotionIds,
                archiveIds,
                quarantineIds,
                repairedClusterIds,
                repairDetails,
                clusterInspectionDetails,
                connectionNoteIds,
                connectionNoteDetails,
                associationDetails,
                associationErrors,
                promotionDetails,
                archiveDetails,
                quarantineDetails,
                writeAudit,
                writeAuditDroppedCount,
                phaseAudit,
                phaseAuditDroppedCount,
                decisionAudit,
                decisionAuditDroppedCount,
            };
            writeMemoryConsolidationArtifact(artifact);
            return artifact;
        }
        catch (error) {
            const finishedAt = new Date().toISOString();
            const recallPasses = [
                {
                    pass: "initial",
                    attemptedBundles: themeClusterCount,
                    evaluatedBundles: initialAssociationOutcomes.length,
                    acceptedBundles: initialAssociationOutcomes.filter((entry) => entry.bundleAccepted).length,
                },
                {
                    pass: "second-pass",
                    attemptedBundles: synthesisBundleCount,
                    queriesUsed: secondPassQueriesUsed,
                    droppedBundles: queryReplayDetails.filter((entry) => entry.dropped).length,
                },
            ];
            const summary = `Processed ${recentRows.length} candidates across ${clusters.length} clusters before failing; `
                + `promoted ${promotionCount}, archived ${archiveCount}, quarantined ${quarantineCount}, repaired ${repairedEdgeCount} links, `
                + `wrote ${connectionNoteCount} connection notes, suppressed ${suppressedConnectionNoteCount} unchanged or non-actionable notes, executed ${associationIntentCount} association intents across ${associationBundleCount} bundles, `
                + `created ${promotionCandidateCount} promotion candidates, confirmed ${promotionCandidateConfirmedCount}, and used ${secondPassQueriesUsed} second-pass queries`
                + `${associationScoutStatus.available ? "" : ` (association scout unavailable: ${associationScoutStatus.reason || "unavailable"})`}.`;
            const artifactPublishStartedAtMs = Date.now();
            recordPhaseAudit({
                phase: "artifactPublish",
                event: "start",
                summary: "Persisting failed memory consolidation artifact.",
            });
            phaseTimingsMs.artifactPublish = Date.now() - artifactPublishStartedAtMs;
            recordPhaseAudit({
                phase: "artifactPublish",
                event: "failed",
                durationMs: phaseTimingsMs.artifactPublish,
                reason: error instanceof Error ? error.message : String(error),
                summary: "Failed memory consolidation artifact persisted.",
            });
            const artifact = {
                schema: "studio-brain.memory-consolidation.v1",
                runId: parsed.runId,
                mode: parsed.mode,
                status: "failed",
                actionabilityStatus: parsed.mode === "overnight" ? "rathole" : "repair",
                actionableInsightCount,
                suppressedConnectionNoteCount,
                suppressedPseudoDecisionCount,
                topActions: topActions
                    .sort((left, right) => right.priority - left.priority || left.text.localeCompare(right.text))
                    .map((entry) => entry.text)
                    .slice(0, 6),
                summary,
                startedAt,
                finishedAt,
                durationMs: Date.now() - startedAtMs,
                candidateCount: recentRows.length,
                clusterCount: clusters.length,
                softClusterCount: clusterBuild.softClusterCount,
                themeClusterCount,
                comparedPairCount: clusterBuild.comparedPairCount,
                promotionCount,
                archiveCount,
                quarantineCount,
                repairedEdgeCount,
                connectionNoteCount,
                associationScoutStatus,
                associationBundleCount,
                associationIntentCount,
                associationConnectionNoteCount,
                focusAreas: focusAreas.slice(0, 8),
                lastError: error instanceof Error ? error.message : String(error),
                lastSuccessAt: null,
                nextRunAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
                outputs: artifactOutputs,
                candidateSelectionDetails: candidateSelection.details,
                familyQuotaPlan: candidateSelection.details.familyQuotaPlan,
                familyQuotaActual: candidateSelection.details.familyQuotaActual,
                dominanceWarnings: candidateSelection.details.dominanceWarnings,
                recallPasses,
                queryReplayDetails,
                synthesisBundleCount,
                secondPassQueriesUsed,
                promotionCandidateCount: Array.from(promotionCandidatesByFingerprint.values()).filter((row) => row.status === "proposed").length,
                promotionCandidateConfirmedCount,
                stalledCandidateCount,
                promotionCandidateDetails,
                bundleOrigins,
                phaseCounts: {
                    candidateSelection: recentRows.length,
                    duplicateClustering: clusters.length,
                    associationScout: associationBundleCount,
                    relationshipRepair: repairedEdgeCount,
                    promotionEvaluation: promotionCount + quarantineCount,
                    artifactPublish: 1,
                },
                phaseTimingsMs,
                writes,
                promotionIds,
                archiveIds,
                quarantineIds,
                repairedClusterIds,
                repairDetails,
                clusterInspectionDetails,
                connectionNoteIds,
                connectionNoteDetails,
                associationDetails,
                associationErrors,
                promotionDetails,
                archiveDetails,
                quarantineDetails,
                writeAudit,
                writeAuditDroppedCount,
                phaseAudit,
                phaseAuditDroppedCount,
                decisionAudit,
                decisionAuditDroppedCount,
            };
            writeMemoryConsolidationArtifact(artifact);
            throw error;
        }
    };
    return {
        capture,
        search,
        recent,
        getByIds,
        stats,
        loops,
        incidentAction,
        incidentActionBatch,
        loopFeedbackStats,
        ownerQueues,
        actionPlan,
        automationTick,
        context,
        backfillEmailThreading,
        backfillSignalIndexing,
        scrubSyntheticThreadMetadata,
        importBatch,
        consolidate,
    };
}
