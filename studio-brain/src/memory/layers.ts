import type { MemoryLayer, MemoryType } from "./contracts";

const MEMORY_LAYER_VALUES = ["core", "working", "episodic", "canonical"] as const;

function clean(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeSourceHint(value: unknown): string {
  return clean(value)
    .replace(/_/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function containsHint(values: string[], ...hints: string[]): boolean {
  return values.some((value) => hints.some((hint) => value.includes(hint)));
}

export function normalizeMemoryLayer(value: unknown, fallback: MemoryLayer = "episodic"): MemoryLayer {
  const raw = clean(value);
  if (raw === "semantic" || raw === "procedural" || raw === "canonical" || raw === "durable") return "canonical";
  if (raw === "working" || raw === "scratch" || raw === "session") return "working";
  if (raw === "core" || raw === "core-blocks" || raw === "role") return "core";
  if (raw === "episodic" || raw === "episode") return "episodic";
  return fallback;
}

export function normalizeMemoryLayerList(values: unknown, maxItems = 4): MemoryLayer[] {
  if (!Array.isArray(values)) return [];
  const out: MemoryLayer[] = [];
  const seen = new Set<MemoryLayer>();
  for (const value of values) {
    const normalized = normalizeMemoryLayer(value, "episodic");
    if (!MEMORY_LAYER_VALUES.includes(normalized)) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= maxItems) break;
  }
  return out;
}

export function defaultMemoryTypeForLayer(layer: MemoryLayer, fallback?: MemoryType | null): MemoryType {
  if (layer === "working") return "working";
  if (layer === "canonical") {
    return fallback === "semantic" || fallback === "procedural" ? fallback : "semantic";
  }
  if (layer === "core") return "procedural";
  return "episodic";
}

export function deriveMemoryLayer(input: {
  memoryLayer?: unknown;
  memoryType?: unknown;
  source?: unknown;
  tags?: unknown;
  content?: unknown;
  metadata?: Record<string, unknown> | null | undefined;
}): MemoryLayer {
  const metadata = asRecord(input.metadata);
  const explicit = clean(input.memoryLayer);
  if (explicit) return normalizeMemoryLayer(explicit);

  const metadataLayer = clean(metadata.memoryLayer ?? metadata.layer ?? metadata.memory_layer);
  if (metadataLayer) return normalizeMemoryLayer(metadataLayer);

  const memoryType = clean(input.memoryType);
  if (memoryType === "working") return "working";
  if (memoryType === "semantic" || memoryType === "procedural") return "canonical";
  if (memoryType === "episodic") return "episodic";

  const tags = Array.isArray(input.tags)
    ? input.tags.map((value) => normalizeSourceHint(value)).filter(Boolean)
    : [];
  const source = normalizeSourceHint(input.source);
  const content = clean(input.content);
  const hints = [source, ...tags];

  if (
    containsHint(hints, "repo-markdown", "codex-compaction-promoted", "import-context-slice", "document-promoted")
    || Boolean(metadata.corpusRecordId || metadata.corpus_record_id || metadata.sourceArtifactPath || metadata.source_artifact_path)
  ) {
    return "canonical";
  }

  if (
    containsHint(hints, "scratch", "working", "thread-scratch", "channel-scratch", "live-notes")
    || Boolean(metadata.expiresAt || metadata.channelId || metadata.threadId)
  ) {
    return "working";
  }

  if (
    containsHint(hints, "decision", "checkpoint", "handoff", "blocker", "incident", "progress")
    || /\b(decision|checkpoint|handoff|blocker|incident|resolved|next action)\b/i.test(content)
  ) {
    return "episodic";
  }

  return "episodic";
}

export function isAllowedMemoryLayer(
  layer: MemoryLayer,
  allowlist: readonly MemoryLayer[] | undefined,
  denylist: readonly MemoryLayer[] | undefined,
): boolean {
  if (Array.isArray(allowlist) && allowlist.length > 0 && !allowlist.includes(layer)) return false;
  if (Array.isArray(denylist) && denylist.includes(layer)) return false;
  return true;
}

export function memoryLayerPriority(layer: MemoryLayer): number {
  if (layer === "core") return 0;
  if (layer === "episodic") return 1;
  if (layer === "working") return 2;
  return 3;
}
