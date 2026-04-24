"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasOpsPiiProtection = hasOpsPiiProtection;
exports.encryptOpsPiiJson = encryptOpsPiiJson;
exports.decryptOpsPiiJson = decryptOpsPiiJson;
exports.maskEmail = maskEmail;
exports.maskPhone = maskPhone;
exports.maskOpaqueId = maskOpaqueId;
exports.summarizeSensitiveText = summarizeSensitiveText;
exports.redactMemberAuditPayload = redactMemberAuditPayload;
const node_crypto_1 = __importDefault(require("node:crypto"));
function deriveKeyMaterial() {
    const dedicated = String(process.env.STUDIO_BRAIN_OPS_PII_ENCRYPTION_KEY ?? "").trim();
    const fallback = String(process.env.STUDIO_BRAIN_ADMIN_TOKEN ?? "").trim();
    const raw = dedicated || fallback;
    if (!raw)
        return null;
    let key;
    try {
        const maybeBase64 = Buffer.from(raw, "base64");
        key = maybeBase64.length === 32 ? maybeBase64 : node_crypto_1.default.createHash("sha256").update(raw).digest();
    }
    catch {
        key = node_crypto_1.default.createHash("sha256").update(raw).digest();
    }
    return {
        key,
        keySource: dedicated ? "ops_pii" : "admin_token_fallback",
    };
}
function hasOpsPiiProtection() {
    return deriveKeyMaterial() !== null;
}
function encryptOpsPiiJson(value) {
    const material = deriveKeyMaterial();
    if (!material)
        return null;
    const iv = node_crypto_1.default.randomBytes(12);
    const cipher = node_crypto_1.default.createCipheriv("aes-256-gcm", material.key, iv);
    const plaintext = Buffer.from(JSON.stringify(value), "utf8");
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
        version: 1,
        alg: "aes-256-gcm",
        keySource: material.keySource,
        iv: iv.toString("base64"),
        tag: tag.toString("base64"),
        ciphertext: ciphertext.toString("base64"),
    };
}
function decryptOpsPiiJson(value) {
    const material = deriveKeyMaterial();
    if (!material || !value || typeof value !== "object")
        return null;
    const envelope = value;
    if (envelope.version !== 1 || envelope.alg !== "aes-256-gcm" || !envelope.iv || !envelope.tag || !envelope.ciphertext) {
        return null;
    }
    try {
        const decipher = node_crypto_1.default.createDecipheriv("aes-256-gcm", material.key, Buffer.from(envelope.iv, "base64"));
        decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
        const plaintext = Buffer.concat([
            decipher.update(Buffer.from(envelope.ciphertext, "base64")),
            decipher.final(),
        ]);
        return JSON.parse(plaintext.toString("utf8"));
    }
    catch {
        return null;
    }
}
function maskEmail(value) {
    const email = String(value ?? "").trim();
    if (!email)
        return null;
    const [local, domain] = email.split("@");
    if (!domain)
        return "***";
    const localVisible = local.length <= 2 ? local[0] ?? "*" : `${local[0]}***${local.slice(-1)}`;
    return `${localVisible}@${domain}`;
}
function maskPhone(value) {
    const raw = String(value ?? "").trim();
    if (!raw)
        return null;
    const digits = raw.replace(/\D+/g, "");
    if (!digits)
        return "***";
    const visible = digits.slice(-4);
    return `***-***-${visible.padStart(4, "*")}`;
}
function maskOpaqueId(value) {
    const raw = String(value ?? "").trim();
    if (!raw)
        return null;
    if (raw.length <= 8)
        return `${raw.slice(0, 2)}***`;
    return `${raw.slice(0, 4)}...${raw.slice(-4)}`;
}
function summarizeSensitiveText(value) {
    const normalized = String(value ?? "").trim();
    if (!normalized)
        return null;
    return `stored securely (${normalized.length} chars)`;
}
function redactMemberAuditPayload(record) {
    const payload = record.payload ?? {};
    const safeReason = summarizeSensitiveText(record.reason);
    if (record.kind === "create") {
        return {
            ...record,
            reason: safeReason,
            payload: {
                uid: typeof payload.uid === "string" ? payload.uid : record.uid,
                emailMasked: typeof payload.emailMasked === "string"
                    ? payload.emailMasked
                    : maskEmail(typeof payload.email === "string" ? payload.email : null),
                displayName: typeof payload.displayName === "string" ? payload.displayName : null,
                membershipTier: typeof payload.membershipTier === "string" ? payload.membershipTier : null,
                portalRole: typeof payload.portalRole === "string" ? payload.portalRole : null,
                opsRoles: Array.isArray(payload.opsRoles) ? payload.opsRoles : [],
            },
        };
    }
    if (record.kind === "profile") {
        const patch = payload.patch && typeof payload.patch === "object" && !Array.isArray(payload.patch)
            ? payload.patch
            : payload;
        return {
            ...record,
            reason: safeReason,
            payload: {
                changedFields: Object.keys(patch),
                displayName: typeof patch.displayName === "string" ? patch.displayName : null,
                kilnPreferences: typeof patch.kilnPreferences === "string" ? patch.kilnPreferences : null,
                staffNotes: summarizeSensitiveText(typeof patch.staffNotes === "string" ? patch.staffNotes : null),
            },
        };
    }
    if (record.kind === "billing") {
        const billingPayload = payload.billingProfile && typeof payload.billingProfile === "object" && !Array.isArray(payload.billingProfile)
            ? payload.billingProfile
            : payload;
        return {
            ...record,
            reason: safeReason,
            payload: {
                stripeCustomerId: maskOpaqueId(typeof billingPayload.stripeCustomerId === "string" ? billingPayload.stripeCustomerId : null),
                defaultPaymentMethodId: maskOpaqueId(typeof billingPayload.defaultPaymentMethodId === "string" ? billingPayload.defaultPaymentMethodId : null),
                cardBrand: typeof billingPayload.cardBrand === "string" ? billingPayload.cardBrand : null,
                cardLast4: typeof billingPayload.cardLast4 === "string" ? billingPayload.cardLast4 : null,
                expMonth: typeof billingPayload.expMonth === "string" ? billingPayload.expMonth : null,
                expYear: typeof billingPayload.expYear === "string" ? billingPayload.expYear : null,
                billingContactName: summarizeSensitiveText(typeof billingPayload.billingContactName === "string" ? billingPayload.billingContactName : null),
                billingContactEmail: maskEmail(typeof billingPayload.billingContactEmail === "string" ? billingPayload.billingContactEmail : null),
                billingContactPhone: maskPhone(typeof billingPayload.billingContactPhone === "string" ? billingPayload.billingContactPhone : null),
                storageMode: typeof billingPayload.storageMode === "string" ? billingPayload.storageMode : null,
            },
        };
    }
    return {
        ...record,
        reason: safeReason,
    };
}
