import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";

export function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && line[i + 1] === '"') {
      current += '"';
      i += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return values.map((entry) => entry.trim());
}

export function parseImportItems(inputPath, sourceOverride) {
  const absolute = resolve(process.cwd(), inputPath);
  const raw = readFileSync(absolute, "utf8");
  const extension = extname(absolute).toLowerCase();

  if (extension === ".jsonl" || extension === ".ndjson") {
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          const parsed = JSON.parse(line);
          if (parsed && typeof parsed === "object") {
            return {
              id: typeof parsed.id === "string" ? parsed.id : undefined,
              content: String(parsed.content ?? parsed.statement ?? parsed.text ?? ""),
              source: String(parsed.source ?? sourceOverride ?? "import"),
              tags: Array.isArray(parsed.tags) ? parsed.tags.map((tag) => String(tag)) : [],
              metadata: parsed.metadata && typeof parsed.metadata === "object" ? parsed.metadata : {},
              tenantId: typeof parsed.tenantId === "string" ? parsed.tenantId : undefined,
              agentId: typeof parsed.agentId === "string" ? parsed.agentId : undefined,
              runId: typeof parsed.runId === "string" ? parsed.runId : undefined,
              clientRequestId: typeof parsed.clientRequestId === "string" ? parsed.clientRequestId : undefined,
              occurredAt: typeof parsed.occurredAt === "string" ? parsed.occurredAt : undefined,
              status: typeof parsed.status === "string" ? parsed.status : undefined,
              memoryType: typeof parsed.memoryType === "string" ? parsed.memoryType : undefined,
              sourceConfidence: typeof parsed.sourceConfidence === "number" ? parsed.sourceConfidence : undefined,
              importance: typeof parsed.importance === "number" ? parsed.importance : undefined,
            };
          }
        } catch {
          // plain text line fallback below
        }
        return { content: line, source: sourceOverride ?? "import", tags: [], metadata: {} };
      })
      .filter((item) => item.content.trim().length > 0);
  }

  if (extension === ".json") {
    const parsed = JSON.parse(raw);
    const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : [];
    return rows
      .map((row) => ({
        id: typeof row?.id === "string" ? row.id : undefined,
        content: String(row?.content ?? row?.statement ?? row?.text ?? ""),
        source: String(row?.source ?? sourceOverride ?? "import"),
        tags: Array.isArray(row?.tags) ? row.tags.map((tag) => String(tag)) : [],
        metadata: row?.metadata && typeof row.metadata === "object" ? row.metadata : {},
        tenantId: typeof row?.tenantId === "string" ? row.tenantId : undefined,
        agentId: typeof row?.agentId === "string" ? row.agentId : undefined,
        runId: typeof row?.runId === "string" ? row.runId : undefined,
        clientRequestId: typeof row?.clientRequestId === "string" ? row.clientRequestId : undefined,
        occurredAt: typeof row?.occurredAt === "string" ? row.occurredAt : undefined,
        status: typeof row?.status === "string" ? row.status : undefined,
        memoryType: typeof row?.memoryType === "string" ? row.memoryType : undefined,
        sourceConfidence: typeof row?.sourceConfidence === "number" ? row.sourceConfidence : undefined,
        importance: typeof row?.importance === "number" ? row.importance : undefined,
      }))
      .filter((item) => item.content.trim().length > 0);
  }

  if (extension === ".csv") {
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length <= 1) return [];
    const header = parseCsvLine(lines[0] ?? "");
    const lower = header.map((value) => value.toLowerCase());
    const contentIndex = Math.max(
      lower.indexOf("content"),
      lower.indexOf("text"),
      lower.indexOf("statement"),
      lower.indexOf("note")
    );
    const tenantIndex = lower.indexOf("tenantid");
    const sourceIndex = lower.indexOf("source");
    return lines.slice(1).map((line) => {
      const cols = parseCsvLine(line);
      return {
        content: String(contentIndex >= 0 ? cols[contentIndex] ?? "" : cols[0] ?? ""),
        source: String(sourceIndex >= 0 ? cols[sourceIndex] ?? sourceOverride ?? "import" : sourceOverride ?? "import"),
        tags: [],
        metadata: {
          csvRow: line,
        },
        tenantId: tenantIndex >= 0 ? String(cols[tenantIndex] ?? "").trim() || undefined : undefined,
      };
    });
  }

  return raw
    .split(/\r?\n\r?\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((content) => ({
      content,
      source: sourceOverride ?? "import",
      tags: [],
      metadata: {},
    }));
}

export function resolveImportSourceOverride(flags) {
  if (!Object.prototype.hasOwnProperty.call(flags, "source")) return undefined;
  const value = String(flags.source ?? "").trim();
  return value || undefined;
}

export function buildImportCommandPayload({ inputPath, flags, intFlag, parseCsv }) {
  const sourceOverride = resolveImportSourceOverride(flags);
  const items = parseImportItems(inputPath, sourceOverride);
  const payload = {
    continueOnError: String(flags["continue-on-error"] ?? "true").toLowerCase() !== "false",
    disableRunWriteBurstLimit:
      String(flags["disable-run-burst-limit"] ?? "false").toLowerCase() === "true",
    generateBriefing:
      String(flags["post-import-briefing"] ?? flags["generate-briefing"] ?? "").toLowerCase() === "true",
    briefingQuery: flags["briefing-query"] ? String(flags["briefing-query"]).trim() : undefined,
    briefingLimit: intFlag(flags["briefing-limit"], 12),
    briefingStates: flags["briefing-states"] ? parseCsv(flags["briefing-states"]) : [],
    briefingLanes: flags["briefing-lanes"] ? parseCsv(flags["briefing-lanes"]) : [],
    briefingIncidentMinEscalation: flags["briefing-incident-min-escalation"]
      ? Number(String(flags["briefing-incident-min-escalation"]).trim())
      : undefined,
    briefingIncidentMinBlastRadius: flags["briefing-incident-min-blast-radius"]
      ? Number(String(flags["briefing-incident-min-blast-radius"]).trim())
      : undefined,
    dispatch: String(flags.dispatch ?? "").trim().toLowerCase() === "true",
    webhookUrl: flags["webhook-url"] ? String(flags["webhook-url"]).trim() : undefined,
    items,
  };
  if (sourceOverride) {
    payload.sourceOverride = sourceOverride;
  }
  return payload;
}
