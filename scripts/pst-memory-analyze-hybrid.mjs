#!/usr/bin/env node

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  clipText,
  isoNow,
  parseCliArgs,
  readBoolFlag,
  readJsonl,
  readNumberFlag,
  readStringFlag,
  runCommand,
  stableHash,
  writeJson,
  writeJsonl,
} from "./lib/pst-memory-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

function usage() {
  process.stdout.write(
    [
      "PST hybrid analysis stage",
      "",
      "Usage:",
      "  node ./scripts/pst-memory-analyze-hybrid.mjs \\",
      "    --input ./imports/pst/mailbox-units.jsonl \\",
      "    --output ./imports/pst/mailbox-analysis-memory.jsonl",
      "",
      "Options:",
      "  --report <path>             JSON report path",
      "  --dead-letter <path>        Analysis dead-letter JSONL path",
      "  --max-output <n>            Final analyzed rows cap (default: 250)",
      "  --max-message-output <n>    Message analysis cap before merge (default: 180)",
      "  --max-attachment-output <n> Attachment analysis cap before merge (default: 120)",
      "  --llm-enrich <t/f>          Enable optional LLM refine pass (default: false)",
      "  --llm-model <name>          LLM model for refine pass (default: gpt-4.1-mini)",
      "  --llm-top-n <n>             Max rows for LLM refine (default: 25)",
      "  --json                      Print report JSON",
    ].join("\n")
  );
}

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function topEntries(map, limit) {
  return [...map.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return String(a[0]).localeCompare(String(b[0]));
    })
    .slice(0, limit);
}

function buildAttachmentInsights(units, { maxAttachmentOutput, maxContentChars }) {
  const rows = [];
  const mimeCounts = new Map();
  const statusCounts = new Map();
  const byHash = new Map();

  for (const unit of units) {
    const metadata = unit?.metadata && typeof unit.metadata === "object" ? unit.metadata : {};
    const mime = normalizeWhitespace(metadata.mimeType || "unknown").toLowerCase() || "unknown";
    const status = normalizeWhitespace(metadata.extractionStatus || "unknown").toLowerCase() || "unknown";
    mimeCounts.set(mime, (mimeCounts.get(mime) || 0) + 1);
    statusCounts.set(status, (statusCounts.get(status) || 0) + 1);
    const hash = normalizeWhitespace(metadata.sha256 || "");
    if (hash) {
      const row = byHash.get(hash) || { count: 0, names: new Set(), mime };
      row.count += 1;
      const name = normalizeWhitespace(metadata.attachmentName || "");
      if (name) row.names.add(name);
      byHash.set(hash, row);
    }
  }

  for (const unit of units) {
    if (rows.length >= maxAttachmentOutput) break;
    const metadata = unit?.metadata && typeof unit.metadata === "object" ? unit.metadata : {};
    const status = normalizeWhitespace(metadata.extractionStatus || "").toLowerCase();
    const hasText = Boolean(metadata.hasText);
    const mime = normalizeWhitespace(metadata.mimeType || "unknown").toLowerCase();
    const attachmentName = normalizeWhitespace(metadata.attachmentName || "unnamed attachment");
    const subject = normalizeWhitespace(metadata.subject || "no subject");
    const sender = normalizeWhitespace(metadata.from || "unknown");
    const recipients = normalizeWhitespace(metadata.to || "unknown");
    const reason = normalizeWhitespace(metadata.extractionReason || "");

    let score = 0;
    if (status === "extracted") score += 4;
    if (hasText) score += 2;
    if (mime.includes("spreadsheet") || mime.includes("wordprocessingml") || mime.includes("presentationml")) score += 2;
    if (mime === "application/pdf") score += 1;
    if (reason.includes("too_large")) score += 1;
    if (status === "failed") score += 1;
    if (score <= 0) continue;

    const base = `Attachment insight: ${attachmentName} (${mime}, status ${status || "unknown"}) from email "${subject}" by ${sender} to ${recipients}.`;
    const tail = unit?.content ? ` Evidence: ${unit.content}` : reason ? ` Reason: ${reason}.` : "";
    const content = clipText(`${base}${tail}`, maxContentChars);

    rows.push({
      content,
      source: "pst:analysis-hybrid",
      tags: ["pst", "analysis", "attachment-insight", mime, status || "status-unknown"].filter(Boolean),
      clientRequestId: `pst-hybrid-att-${stableHash(`${unit.unitId || ""}|${content}`)}`,
      occurredAt: unit?.occurredAt || undefined,
      metadata: {
        analysisType: "attachment_insight",
        score,
        unitId: unit?.unitId || null,
        mimeType: mime,
        extractionStatus: status || "unknown",
        attachmentName,
      },
      _rankScore: 220 + score,
    });
  }

  const mimeTop = topEntries(mimeCounts, 5);
  if (mimeTop.length > 0) {
    rows.push({
      content: `Attachment trend summary: most frequent MIME types were ${mimeTop
        .map(([mime, count]) => `${mime} (${count})`)
        .join(", ")}.`,
      source: "pst:analysis-hybrid",
      tags: ["pst", "analysis", "attachment-trend"],
      clientRequestId: `pst-hybrid-att-trend-${stableHash(JSON.stringify(mimeTop))}`,
      metadata: {
        analysisType: "attachment_trend",
        score: 5,
        mimeTop,
        statusTop: topEntries(statusCounts, 6),
      },
      _rankScore: 160,
    });
  }

  const duplicateDocs = [...byHash.entries()]
    .filter(([, info]) => info.count >= 2)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5);
  for (const [hash, info] of duplicateDocs) {
    rows.push({
      content: `Correlation: attachment hash ${hash.slice(0, 12)} appeared ${info.count} times across messages (example names: ${[...info.names]
        .slice(0, 3)
        .join(", ") || "unnamed"}).`,
      source: "pst:analysis-hybrid",
      tags: ["pst", "analysis", "correlation", "attachment-reuse"],
      clientRequestId: `pst-hybrid-att-corr-${stableHash(hash)}`,
      metadata: {
        analysisType: "attachment_correlation",
        score: 4 + info.count,
        attachmentHash: hash,
        count: info.count,
        mimeType: info.mime,
      },
      _rankScore: 140 + info.count,
    });
  }

  return rows;
}

async function enrichWithLlm(items, { enabled, model, topN, maxContentChars }) {
  if (!enabled || items.length === 0) {
    return {
      rows: items,
      attempted: false,
      succeeded: 0,
      failed: 0,
      warnings: [],
    };
  }
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    return {
      rows: items,
      attempted: false,
      succeeded: 0,
      failed: 0,
      warnings: ["LLM enrichment requested but OPENAI_API_KEY is missing; skipped."],
    };
  }

  const warnings = [];
  let succeeded = 0;
  let failed = 0;
  const max = Math.max(0, Math.min(items.length, topN));
  const enriched = [...items];
  for (let index = 0; index < max; index += 1) {
    const item = enriched[index];
    const prompt = [
      "Rewrite this memory statement into a concise, factual human-memory style sentence.",
      "Keep meaning intact. No speculation. No markdown. Max 2 sentences.",
      `Input: ${item.content}`,
    ].join("\n");
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          input: prompt,
          max_output_tokens: 220,
        }),
      });
      if (!response.ok) {
        failed += 1;
        warnings.push(`LLM enrich failed for index ${index}: HTTP ${response.status}`);
        continue;
      }
      const payload = await response.json();
      const text =
        normalizeWhitespace(payload?.output_text || "") ||
        normalizeWhitespace(
          payload?.output?.flatMap?.((part) => part?.content || [])?.map?.((part) => part?.text || "").join(" ")
        );
      if (!text) {
        failed += 1;
        warnings.push(`LLM enrich returned empty text for index ${index}`);
        continue;
      }
      enriched[index] = {
        ...item,
        content: clipText(text, maxContentChars),
        metadata: {
          ...(item.metadata || {}),
          llmEnriched: true,
          llmModel: model,
        },
      };
      succeeded += 1;
    } catch (error) {
      failed += 1;
      warnings.push(
        `LLM enrich error for index ${index}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  return {
    rows: enriched,
    attempted: true,
    succeeded,
    failed,
    warnings,
  };
}

async function run() {
  const { flags } = parseCliArgs(process.argv.slice(2));
  if (readBoolFlag(flags, "help", false) || readBoolFlag(flags, "h", false)) {
    usage();
    return;
  }

  const inputPath = resolve(REPO_ROOT, readStringFlag(flags, "input", "./imports/pst/mailbox-units.jsonl"));
  const outputPath = resolve(
    REPO_ROOT,
    readStringFlag(flags, "output", "./imports/pst/mailbox-analysis-memory.jsonl")
  );
  const reportPath = resolve(
    REPO_ROOT,
    readStringFlag(flags, "report", "./output/open-memory/pst-analysis-hybrid-latest.json")
  );
  const deadLetterPath = resolve(
    REPO_ROOT,
    readStringFlag(flags, "dead-letter", "./imports/pst/mailbox-analysis-dead-letter.jsonl")
  );

  const maxOutput = readNumberFlag(flags, "max-output", 250, { min: 1, max: 5000 });
  const maxMessageOutput = readNumberFlag(flags, "max-message-output", 180, { min: 1, max: 5000 });
  const maxAttachmentOutput = readNumberFlag(flags, "max-attachment-output", 120, { min: 1, max: 5000 });
  const maxContentChars = readNumberFlag(flags, "max-content-chars", 1800, { min: 200, max: 20000 });
  const llmEnrich = readBoolFlag(flags, "llm-enrich", false);
  const llmModel = readStringFlag(flags, "llm-model", "gpt-4.1-mini");
  const llmTopN = readNumberFlag(flags, "llm-top-n", 25, { min: 0, max: 200 });
  const printJson = readBoolFlag(flags, "json", false);

  const units = readJsonl(inputPath);
  const messageUnits = units.filter((unit) => unit?.unitType === "message");
  const attachmentUnits = units.filter((unit) => unit?.unitType === "attachment");

  const tempDir = mkdtempSync(join(tmpdir(), "pst-hybrid-analysis-"));
  const messageInputPath = join(tempDir, "message-input.jsonl");
  const messageOutPath = join(tempDir, "message-output.jsonl");
  const messageReportPath = join(tempDir, "message-report.json");

  try {
    const rawMessageRows = messageUnits.map((unit) => ({
      content: unit.content,
      source: unit.source || "pst:libratom",
      tags: Array.isArray(unit.tags) ? unit.tags : ["pst", "message"],
      metadata: {
        subject: unit?.metadata?.subject || "",
        from: unit?.metadata?.from || "",
        to: unit?.metadata?.to || "",
        messageDate: unit?.metadata?.messageDate || unit?.occurredAt || "",
        mailboxPath: unit?.metadata?.mailboxPath || "",
        mailboxName: unit?.metadata?.mailboxName || "",
        messageId: unit?.metadata?.messageId || null,
      },
      clientRequestId: unit.clientRequestId || `pst-msg-${stableHash(unit.unitId || unit.content || "")}`,
      occurredAt: unit.occurredAt || undefined,
    }));
    writeJsonl(messageInputPath, rawMessageRows);

    const messageRun = runCommand(
      process.execPath,
      [
        "./scripts/pst-memory-analysis-gateway.mjs",
        "--input",
        messageInputPath,
        "--output",
        messageOutPath,
        "--report",
        messageReportPath,
        "--max-output",
        String(maxMessageOutput),
      ],
      { cwd: REPO_ROOT }
    );
    if (!messageRun.ok) {
      throw new Error(`Message analysis gateway failed: ${messageRun.stderr || messageRun.stdout}`);
    }

    const messageInsights = readJsonl(messageOutPath).map((row) => ({
      ...row,
      _rankScore: 200 + Number(row?.metadata?.score || 0),
    }));
    const attachmentInsights = buildAttachmentInsights(attachmentUnits, {
      maxAttachmentOutput,
      maxContentChars,
    });

    const merged = [...messageInsights, ...attachmentInsights]
      .sort((a, b) => Number(b._rankScore || 0) - Number(a._rankScore || 0))
      .slice(0, maxOutput)
      .map((row) => {
        const next = { ...row };
        delete next._rankScore;
        next.content = clipText(next.content || "", maxContentChars);
        next.metadata = {
          ...(next.metadata || {}),
          analysisStage: "hybrid",
        };
        return next;
      });

    const llm = await enrichWithLlm(merged, {
      enabled: llmEnrich,
      model: llmModel,
      topN: llmTopN,
      maxContentChars,
    });
    const finalRows = llm.rows;

    writeJsonl(outputPath, finalRows);
    writeJsonl(deadLetterPath, []);

    const report = {
      schema: "pst-analysis-hybrid-report.v1",
      generatedAt: isoNow(),
      inputPath,
      outputPath,
      deadLetterPath,
      counts: {
        unitsTotal: units.length,
        messageUnits: messageUnits.length,
        attachmentUnits: attachmentUnits.length,
        analyzedRows: finalRows.length,
      },
      options: {
        maxOutput,
        maxMessageOutput,
        maxAttachmentOutput,
        llmEnrich,
        llmModel,
        llmTopN,
      },
      llm: {
        attempted: llm.attempted,
        succeeded: llm.succeeded,
        failed: llm.failed,
      },
      warnings: llm.warnings,
    };
    writeJson(reportPath, report);

    if (printJson) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      process.stdout.write("pst-memory-analyze-hybrid complete\n");
      process.stdout.write(`input: ${inputPath}\n`);
      process.stdout.write(`output: ${outputPath}\n`);
      process.stdout.write(`report: ${reportPath}\n`);
      process.stdout.write(`analyzed-rows: ${finalRows.length}\n`);
      if (llm.warnings.length > 0) {
        process.stdout.write(`warnings: ${llm.warnings.length}\n`);
      }
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  process.stderr.write(
    `pst-memory-analyze-hybrid failed: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
});
