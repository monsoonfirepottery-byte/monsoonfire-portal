import type { GenesisDetectedSchema } from "./types";

export function detectGenesisLogSchema(raw: string): GenesisDetectedSchema {
  const trimmed = raw.trim();
  if (!trimmed) return "unknown";
  if (trimmed.includes("SYNTHETIC-GENESIS-LOG")) return "synthetic-genesis-v1";
  if (trimmed.includes("GENESIS_SYNTHETIC_VARIANT")) return "synthetic-genesis-variant";
  if (/\b(META|RUN|EVENT|TELEMETRY)\s*[:|]/.test(trimmed)) return "generic-kv";
  return "unknown";
}
