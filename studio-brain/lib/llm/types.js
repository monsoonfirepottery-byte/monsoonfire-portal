"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StudioBrainLlmError = void 0;
exports.cleanText = cleanText;
exports.clipText = clipText;
exports.hashForLlmAudit = hashForLlmAudit;
exports.messagesFromRequest = messagesFromRequest;
exports.promptHashInput = promptHashInput;
exports.buildAuditMetadata = buildAuditMetadata;
const node_crypto_1 = __importDefault(require("node:crypto"));
class StudioBrainLlmError extends Error {
    reason;
    status;
    constructor(message, reason, status = null) {
        super(message);
        this.name = "StudioBrainLlmError";
        this.reason = reason;
        this.status = status;
    }
}
exports.StudioBrainLlmError = StudioBrainLlmError;
function cleanText(value) {
    return String(value ?? "").trim();
}
function clipText(value, max = 2_000) {
    const normalized = cleanText(value);
    if (normalized.length <= max)
        return normalized;
    return `${normalized.slice(0, Math.max(1, max - 1)).trimEnd()}...`;
}
function hashForLlmAudit(value) {
    const serialized = typeof value === "string" ? value : JSON.stringify(value ?? null);
    return node_crypto_1.default.createHash("sha256").update(serialized).digest("hex");
}
function messagesFromRequest(request) {
    if (request.messages && request.messages.length > 0) {
        return request.messages.map((message) => ({
            role: message.role,
            content: cleanText(message.content),
        }));
    }
    if (typeof request.input === "string") {
        return [{ role: "user", content: request.input }];
    }
    if (request.input !== undefined) {
        return [{ role: "user", content: JSON.stringify(request.input) }];
    }
    return [{ role: "user", content: "" }];
}
function promptHashInput(request) {
    return {
        purpose: request.purpose,
        input: request.input ?? null,
        messages: request.messages ?? null,
        responseFormat: request.responseFormat ? { name: request.responseFormat.name, schema: request.responseFormat.schema } : null,
        capabilities: request.capabilities ?? [],
        allowTools: request.allowTools === true,
        allowExternalWrites: request.allowExternalWrites === true,
        allowPublish: request.allowPublish === true,
    };
}
function buildAuditMetadata(input) {
    return {
        provider: input.provider,
        model: input.model,
        purpose: input.request.purpose,
        latencyMs: input.latencyMs,
        fallbackReason: input.fallbackReason ?? null,
        promptHash: hashForLlmAudit(promptHashInput(input.request)),
        outputHash: hashForLlmAudit(input.text),
        redactionStatus: "raw-not-persisted",
        capabilities: [...(input.request.capabilities ?? [])],
        allowTools: input.request.allowTools === true,
        allowExternalWrites: input.request.allowExternalWrites === true,
        allowPublish: input.request.allowPublish === true,
    };
}
