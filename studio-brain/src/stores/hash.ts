import crypto from "node:crypto";

export function stableHash(value: unknown): string {
  const serialized = JSON.stringify(value, Object.keys((value ?? {}) as Record<string, unknown>).sort());
  return crypto.createHash("sha256").update(serialized).digest("hex");
}

export function stableHashDeep(value: unknown): string {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}
