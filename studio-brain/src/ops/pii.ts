import crypto from "node:crypto";
import type { OpsMemberAuditRecord } from "./contracts";

type EncryptedEnvelope = {
  version: 1;
  alg: "aes-256-gcm";
  keySource: "ops_pii" | "admin_token_fallback";
  iv: string;
  tag: string;
  ciphertext: string;
};

function deriveKeyMaterial(): { key: Buffer; keySource: EncryptedEnvelope["keySource"] } | null {
  const dedicated = String(process.env.STUDIO_BRAIN_OPS_PII_ENCRYPTION_KEY ?? "").trim();
  const fallback = String(process.env.STUDIO_BRAIN_ADMIN_TOKEN ?? "").trim();
  const raw = dedicated || fallback;
  if (!raw) return null;
  let key: Buffer;
  try {
    const maybeBase64 = Buffer.from(raw, "base64");
    key = maybeBase64.length === 32 ? maybeBase64 : crypto.createHash("sha256").update(raw).digest();
  } catch {
    key = crypto.createHash("sha256").update(raw).digest();
  }
  return {
    key,
    keySource: dedicated ? "ops_pii" : "admin_token_fallback",
  };
}

export function hasOpsPiiProtection(): boolean {
  return deriveKeyMaterial() !== null;
}

export function encryptOpsPiiJson(value: unknown): EncryptedEnvelope | null {
  const material = deriveKeyMaterial();
  if (!material) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", material.key, iv);
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

export function decryptOpsPiiJson<T>(value: unknown): T | null {
  const material = deriveKeyMaterial();
  if (!material || !value || typeof value !== "object") return null;
  const envelope = value as Partial<EncryptedEnvelope>;
  if (envelope.version !== 1 || envelope.alg !== "aes-256-gcm" || !envelope.iv || !envelope.tag || !envelope.ciphertext) {
    return null;
  }
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      material.key,
      Buffer.from(envelope.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString("utf8")) as T;
  } catch {
    return null;
  }
}

export function maskEmail(value: string | null | undefined): string | null {
  const email = String(value ?? "").trim();
  if (!email) return null;
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const localVisible = local.length <= 2 ? local[0] ?? "*" : `${local[0]}***${local.slice(-1)}`;
  return `${localVisible}@${domain}`;
}

export function maskPhone(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const digits = raw.replace(/\D+/g, "");
  if (!digits) return "***";
  const visible = digits.slice(-4);
  return `***-***-${visible.padStart(4, "*")}`;
}

export function maskOpaqueId(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (raw.length <= 8) return `${raw.slice(0, 2)}***`;
  return `${raw.slice(0, 4)}...${raw.slice(-4)}`;
}

export function summarizeSensitiveText(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  return `stored securely (${normalized.length} chars)`;
}

export function redactMemberAuditPayload(record: OpsMemberAuditRecord): OpsMemberAuditRecord {
  const payload = record.payload ?? {};
  const safeReason = summarizeSensitiveText(record.reason);
  if (record.kind === "create") {
    return {
      ...record,
      reason: safeReason,
      payload: {
        uid: typeof payload.uid === "string" ? payload.uid : record.uid,
        emailMasked:
          typeof payload.emailMasked === "string"
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
    const patch =
      payload.patch && typeof payload.patch === "object" && !Array.isArray(payload.patch)
        ? payload.patch as Record<string, unknown>
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
    const billingPayload =
      payload.billingProfile && typeof payload.billingProfile === "object" && !Array.isArray(payload.billingProfile)
        ? payload.billingProfile as Record<string, unknown>
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
