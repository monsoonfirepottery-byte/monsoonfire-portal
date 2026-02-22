"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseSkillSignatureTrustAnchors = parseSkillSignatureTrustAnchors;
exports.createSkillSignatureTrustAnchorVerifier = createSkillSignatureTrustAnchorVerifier;
exports.signSkillManifestForTrustAnchor = signSkillManifestForTrustAnchor;
const node_crypto_1 = __importDefault(require("node:crypto"));
const SUPPORTED_SIGNATURE_ALGORITHM = "hmac-sha256";
function normalizeObject(value) {
    if (Array.isArray(value)) {
        return value.map((entry) => normalizeObject(entry));
    }
    if (!value || typeof value !== "object") {
        return value;
    }
    const source = value;
    const target = {};
    for (const key of Object.keys(source).sort()) {
        target[key] = normalizeObject(source[key]);
    }
    return target;
}
function buildManifestSigningPayload(manifest) {
    const unsigned = {
        ...manifest,
    };
    delete unsigned.signature;
    delete unsigned.signatureAlgorithm;
    delete unsigned.signatureKeyId;
    return JSON.stringify(normalizeObject(unsigned));
}
function decodeSignature(signature) {
    const trimmed = signature.trim();
    if (!trimmed)
        return null;
    if (/^[a-fA-F0-9]+$/.test(trimmed) && trimmed.length % 2 === 0) {
        try {
            return Buffer.from(trimmed, "hex");
        }
        catch {
            return null;
        }
    }
    try {
        const normalized = trimmed.replace(/-/g, "+").replace(/_/g, "/");
        const withPadding = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
        return Buffer.from(withPadding, "base64");
    }
    catch {
        return null;
    }
}
function parseTrustAnchorEntry(rawEntry) {
    const trimmed = rawEntry.trim();
    if (!trimmed)
        return null;
    const separator = trimmed.indexOf("=");
    if (separator <= 0)
        return null;
    const keyId = trimmed.slice(0, separator).trim();
    const key = trimmed.slice(separator + 1).trim();
    if (!keyId || !key)
        return null;
    return { keyId, key };
}
function parseSkillSignatureTrustAnchors(raw) {
    if (!raw || raw.trim().length === 0)
        return {};
    const trimmed = raw.trim();
    if (trimmed.startsWith("{")) {
        try {
            const parsed = JSON.parse(trimmed);
            const out = {};
            for (const [keyId, value] of Object.entries(parsed)) {
                const secret = typeof value === "string" ? value.trim() : "";
                if (!keyId.trim() || !secret)
                    continue;
                out[keyId.trim()] = secret;
            }
            return out;
        }
        catch {
            return {};
        }
    }
    const out = {};
    for (const token of trimmed.split(",")) {
        const parsed = parseTrustAnchorEntry(token);
        if (!parsed)
            continue;
        out[parsed.keyId] = parsed.key;
    }
    return out;
}
function createSkillSignatureTrustAnchorVerifier(input) {
    return async ({ manifest }) => {
        const algorithm = (manifest.signatureAlgorithm ?? "").trim().toLowerCase();
        const keyId = (manifest.signatureKeyId ?? "").trim();
        const signature = (manifest.signature ?? "").trim();
        if (!algorithm || !keyId || !signature) {
            return { ok: false, reason: "MISSING_SIGNATURE_METADATA" };
        }
        if (algorithm !== SUPPORTED_SIGNATURE_ALGORITHM) {
            return { ok: false, reason: `UNSUPPORTED_SIGNATURE_ALGORITHM:${algorithm}` };
        }
        const trustAnchor = input.trustAnchors[keyId];
        if (!trustAnchor) {
            return { ok: false, reason: `UNKNOWN_TRUST_ANCHOR:${keyId}` };
        }
        const providedDigest = decodeSignature(signature);
        if (!providedDigest || providedDigest.length === 0) {
            return { ok: false, reason: "INVALID_SIGNATURE_ENCODING" };
        }
        const payload = buildManifestSigningPayload(manifest);
        const expectedDigest = node_crypto_1.default.createHmac("sha256", trustAnchor).update(payload).digest();
        if (providedDigest.length !== expectedDigest.length) {
            return { ok: false, reason: "SIGNATURE_MISMATCH" };
        }
        if (!node_crypto_1.default.timingSafeEqual(providedDigest, expectedDigest)) {
            return { ok: false, reason: "SIGNATURE_MISMATCH" };
        }
        return { ok: true };
    };
}
function signSkillManifestForTrustAnchor(input) {
    const payload = buildManifestSigningPayload(input.manifest);
    return node_crypto_1.default.createHmac("sha256", input.trustAnchorKey).update(payload).digest("hex");
}
