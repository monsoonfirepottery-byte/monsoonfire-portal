import crypto from "node:crypto";

import type { SkillManifest } from "./registry";

export type SignatureVerificationResult = {
  ok: boolean;
  reason?: string;
};

export type SignatureVerifier = (input: {
  manifest: SkillManifest;
  sourcePath: string;
}) => Promise<SignatureVerificationResult> | SignatureVerificationResult;

type TrustAnchors = Record<string, string>;

const SUPPORTED_SIGNATURE_ALGORITHM = "hmac-sha256";

function normalizeObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeObject(entry));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const source = value as Record<string, unknown>;
  const target: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    target[key] = normalizeObject(source[key]);
  }
  return target;
}

function buildManifestSigningPayload(manifest: SkillManifest): string {
  const unsigned: Record<string, unknown> = {
    ...manifest,
  };
  delete unsigned.signature;
  delete unsigned.signatureAlgorithm;
  delete unsigned.signatureKeyId;
  return JSON.stringify(normalizeObject(unsigned));
}

function decodeSignature(signature: string): Buffer | null {
  const trimmed = signature.trim();
  if (!trimmed) return null;

  if (/^[a-fA-F0-9]+$/.test(trimmed) && trimmed.length % 2 === 0) {
    try {
      return Buffer.from(trimmed, "hex");
    } catch {
      return null;
    }
  }

  try {
    const normalized = trimmed.replace(/-/g, "+").replace(/_/g, "/");
    const withPadding = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    return Buffer.from(withPadding, "base64");
  } catch {
    return null;
  }
}

function parseTrustAnchorEntry(rawEntry: string): { keyId: string; key: string } | null {
  const trimmed = rawEntry.trim();
  if (!trimmed) return null;
  const separator = trimmed.indexOf("=");
  if (separator <= 0) return null;
  const keyId = trimmed.slice(0, separator).trim();
  const key = trimmed.slice(separator + 1).trim();
  if (!keyId || !key) return null;
  return { keyId, key };
}

export function parseSkillSignatureTrustAnchors(raw: string | undefined): TrustAnchors {
  if (!raw || raw.trim().length === 0) return {};

  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const out: TrustAnchors = {};
      for (const [keyId, value] of Object.entries(parsed)) {
        const secret = typeof value === "string" ? value.trim() : "";
        if (!keyId.trim() || !secret) continue;
        out[keyId.trim()] = secret;
      }
      return out;
    } catch {
      return {};
    }
  }

  const out: TrustAnchors = {};
  for (const token of trimmed.split(",")) {
    const parsed = parseTrustAnchorEntry(token);
    if (!parsed) continue;
    out[parsed.keyId] = parsed.key;
  }
  return out;
}

export function createSkillSignatureTrustAnchorVerifier(input: {
  trustAnchors: TrustAnchors;
}): SignatureVerifier {
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
    const expectedDigest = crypto.createHmac("sha256", trustAnchor).update(payload).digest();
    if (providedDigest.length !== expectedDigest.length) {
      return { ok: false, reason: "SIGNATURE_MISMATCH" };
    }
    if (!crypto.timingSafeEqual(providedDigest, expectedDigest)) {
      return { ok: false, reason: "SIGNATURE_MISMATCH" };
    }

    return { ok: true };
  };
}

export function signSkillManifestForTrustAnchor(input: {
  manifest: SkillManifest;
  trustAnchorKey: string;
}): string {
  const payload = buildManifestSigningPayload(input.manifest);
  return crypto.createHmac("sha256", input.trustAnchorKey).update(payload).digest("hex");
}
