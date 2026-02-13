"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildAuditExportBundle = buildAuditExportBundle;
exports.verifyAuditExportBundle = verifyAuditExportBundle;
const node_crypto_1 = __importDefault(require("node:crypto"));
function hashJson(value) {
    return node_crypto_1.default.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function buildAuditExportBundle(rows, options) {
    const generatedAt = options?.generatedAt ?? new Date().toISOString();
    const rowHashes = rows.map((row) => hashJson(row));
    const payloadHash = hashJson(rows);
    const firstAt = rows.length ? rows[rows.length - 1]?.at ?? null : null;
    const lastAt = rows.length ? rows[0]?.at ?? null : null;
    const signatureAlgorithm = options?.signingKey ? "hmac-sha256" : null;
    const signature = options?.signingKey
        ? node_crypto_1.default
            .createHmac("sha256", options.signingKey)
            .update(hashJson({ generatedAt, payloadHash, rowCount: rows.length, firstAt, lastAt }))
            .digest("hex")
        : null;
    return {
        generatedAt,
        manifest: {
            rowCount: rows.length,
            payloadHash,
            rowHashes,
            firstAt,
            lastAt,
            signature,
            signatureAlgorithm,
        },
        rows,
    };
}
function verifyAuditExportBundle(bundle, signingKey) {
    const payloadHash = hashJson(bundle.rows);
    if (payloadHash !== bundle.manifest.payloadHash) {
        return { ok: false, reason: "PAYLOAD_HASH_MISMATCH" };
    }
    const rowHashes = bundle.rows.map((row) => hashJson(row));
    if (JSON.stringify(rowHashes) !== JSON.stringify(bundle.manifest.rowHashes)) {
        return { ok: false, reason: "ROW_HASH_MISMATCH" };
    }
    if (bundle.manifest.signatureAlgorithm === "hmac-sha256") {
        if (!signingKey || !bundle.manifest.signature) {
            return { ok: false, reason: "SIGNATURE_KEY_REQUIRED" };
        }
        const expected = node_crypto_1.default
            .createHmac("sha256", signingKey)
            .update(hashJson({
            generatedAt: bundle.generatedAt,
            payloadHash: bundle.manifest.payloadHash,
            rowCount: bundle.manifest.rowCount,
            firstAt: bundle.manifest.firstAt,
            lastAt: bundle.manifest.lastAt,
        }))
            .digest("hex");
        if (expected !== bundle.manifest.signature) {
            return { ok: false, reason: "SIGNATURE_MISMATCH" };
        }
    }
    return { ok: true, reason: null };
}
