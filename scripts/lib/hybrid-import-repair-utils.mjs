import { createHash } from "node:crypto";

function normalizeSource(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export function deriveImportedMemoryId({ tenantId, source, clientRequestId, content }) {
  const digest = createHash("sha256")
    .update(`${tenantId ?? "none"}|${normalizeSource(source)}|${clientRequestId ?? "none"}|${String(content ?? "")}`)
    .digest("hex")
    .slice(0, 24);
  return clientRequestId ? `mem_req_${digest}` : `mem_${digest}`;
}

function normalizeMetadata(metadata) {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {};
}

function normalizeRow(row, defaultTenantId) {
  const content = String(row?.content ?? row?.statement ?? row?.text ?? "").trim();
  if (!content) return null;
  const source = normalizeSource(row?.source ?? "import") || "import";
  const tenantId = typeof row?.tenantId === "string" && row.tenantId.trim() ? row.tenantId.trim() : defaultTenantId;
  const id = typeof row?.id === "string" && row.id.trim() ? row.id.trim() : undefined;
  return {
    ...row,
    id,
    content,
    source,
    tenantId,
    tags: Array.isArray(row?.tags) ? row.tags.map((tag) => String(tag)) : [],
    metadata: normalizeMetadata(row?.metadata),
    agentId: typeof row?.agentId === "string" ? row.agentId : undefined,
    runId: typeof row?.runId === "string" ? row.runId : undefined,
    clientRequestId: typeof row?.clientRequestId === "string" ? row.clientRequestId : undefined,
    occurredAt: typeof row?.occurredAt === "string" ? row.occurredAt : undefined,
    status: typeof row?.status === "string" ? row.status : undefined,
    memoryType: typeof row?.memoryType === "string" ? row.memoryType : undefined,
    sourceConfidence: typeof row?.sourceConfidence === "number" ? row.sourceConfidence : undefined,
    importance: typeof row?.importance === "number" ? row.importance : undefined,
  };
}

export function buildSourceCollapseRepairPlan({
  rows,
  tenantId,
  repairRunId,
  repairedAt,
}) {
  const archiveRows = [];
  const replayRows = [];
  const mappings = [];
  const skipped = [];
  let sameIdCount = 0;

  for (let index = 0; index < rows.length; index += 1) {
    const normalized = normalizeRow(rows[index], tenantId);
    if (!normalized) {
      skipped.push({ index, reason: "missing-content" });
      continue;
    }
    const currentImportedId =
      normalized.id ??
      deriveImportedMemoryId({
        tenantId: normalized.tenantId,
        source: "import",
        clientRequestId: normalized.clientRequestId,
        content: normalized.content,
      });
    const repairedId =
      normalized.id ??
      deriveImportedMemoryId({
        tenantId: normalized.tenantId,
        source: normalized.source,
        clientRequestId: normalized.clientRequestId,
        content: normalized.content,
      });
    if (currentImportedId === repairedId) sameIdCount += 1;

    const repairMetadata = {
      ...normalized.metadata,
      repair: {
        mode: "source-collapse-replay",
        repairRunId,
        repairedAt,
        currentImportedId,
        repairedId,
        originalSource: normalized.source,
      },
    };

    archiveRows.push({
      id: currentImportedId,
      tenantId: normalized.tenantId,
      content: normalized.content,
      source: "import",
      tags: normalized.tags,
      metadata: repairMetadata,
      agentId: normalized.agentId,
      runId: normalized.runId,
      clientRequestId: normalized.clientRequestId,
      occurredAt: normalized.occurredAt,
      status: "archived",
      memoryType: normalized.memoryType,
      sourceConfidence: normalized.sourceConfidence,
      importance: normalized.importance,
    });

    replayRows.push({
      ...(normalized.id ? { id: normalized.id } : {}),
      tenantId: normalized.tenantId,
      content: normalized.content,
      source: normalized.source,
      tags: normalized.tags,
      metadata: repairMetadata,
      agentId: normalized.agentId,
      runId: normalized.runId,
      clientRequestId: normalized.clientRequestId,
      occurredAt: normalized.occurredAt,
      status: normalized.status,
      memoryType: normalized.memoryType,
      sourceConfidence: normalized.sourceConfidence,
      importance: normalized.importance,
    });

    mappings.push({
      index,
      currentImportedId,
      repairedId,
      tenantId: normalized.tenantId,
      source: normalized.source,
      clientRequestId: normalized.clientRequestId ?? null,
      projectLane: typeof normalized.metadata.projectLane === "string" ? normalized.metadata.projectLane : null,
      corpusRecordId: typeof normalized.metadata.corpusRecordId === "string" ? normalized.metadata.corpusRecordId : null,
      corpusManifestPath:
        typeof normalized.metadata.corpusManifestPath === "string" ? normalized.metadata.corpusManifestPath : null,
      contentPreview:
        normalized.content.length <= 160
          ? normalized.content
          : `${normalized.content.slice(0, 159).trimEnd()}…`,
    });
  }

  return {
    tenantId,
    repairRunId,
    repairedAt,
    totalRows: rows.length,
    repairableRows: mappings.length,
    skipped,
    sameIdCount,
    archiveRows,
    replayRows,
    mappings,
  };
}

export function selectVerificationMappings(mappings, sampleSize) {
  const limit = Math.max(1, Math.trunc(sampleSize));
  if (mappings.length <= limit) return [...mappings];
  const out = [];
  const seen = new Set();
  for (let index = 0; index < limit; index += 1) {
    const candidate = Math.min(
      mappings.length - 1,
      Math.floor((index * mappings.length) / limit)
    );
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    out.push(mappings[candidate]);
  }
  return out;
}
