#!/usr/bin/env node

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  clipText,
  isoNow,
  normalizeWhitespace,
  parseCliArgs,
  readBoolFlag,
  readJsonlWithRaw,
  readNumberFlag,
  readStringFlag,
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
      "PST memory normalize stage",
      "",
      "Usage:",
      "  node ./scripts/pst-memory-normalize.mjs \\",
      "    --messages ./imports/pst/mailbox-raw-memory.jsonl \\",
      "    --attachments ./imports/pst/mailbox-attachments.jsonl \\",
      "    --output ./imports/pst/mailbox-units.jsonl",
      "",
      "Options:",
      "  --dead-letter <path>    Malformed/invalid row sink",
      "  --report <path>         JSON summary report path",
      "  --run-id <id>           Logical run id",
      "  --max-content-chars <n> Clip canonical content length (default: 1600)",
      "  --max-attachment-text-chars <n> Clip attachment embedded text length (default: 1200)",
      "  --json                  Print report JSON",
    ].join("\n")
  );
}

function buildMessageUnit(row, maxContentChars) {
  const content = normalizeWhitespace(row?.content || "");
  if (!content) return null;
  const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const subject = normalizeWhitespace(metadata.subject || "");
  const sender = normalizeWhitespace(metadata.from || "");
  const recipients = normalizeWhitespace(metadata.to || "");
  const occurredAt = normalizeWhitespace(row?.occurredAt || metadata.messageDate || "");
  const unitId = `msg-${stableHash(`${row?.clientRequestId || ""}|${metadata.messageId || ""}|${content}`)}`;
  return {
    unitId,
    unitType: "message",
    source: String(row?.source || "pst:libratom"),
    occurredAt: occurredAt || undefined,
    content: clipText(content, maxContentChars),
    tags: Array.isArray(row?.tags) ? row.tags.map((tag) => String(tag)) : ["pst", "message"],
    clientRequestId: String(row?.clientRequestId || "").trim() || `pst-msg-${stableHash(unitId, 18)}`,
    metadata: {
      messageId: metadata.messageId ?? null,
      pffIdentifier: metadata.pffIdentifier ?? null,
      mailboxPath: metadata.mailboxPath ?? null,
      mailboxName: metadata.mailboxName ?? null,
      subject,
      from: sender,
      to: recipients,
      originalSource: row?.source ?? "pst:libratom",
    },
  };
}

function buildAttachmentUnit(row, maxContentChars, maxAttachmentTextChars) {
  if (!row || typeof row !== "object") return null;
  const name = normalizeWhitespace(row.attachmentName || "");
  const mimeType = normalizeWhitespace(row.mimeType || "");
  const text = clipText(row.text || "", maxAttachmentTextChars);
  const subject = normalizeWhitespace(row.subject || "");
  const sender = normalizeWhitespace(row.from || "");
  const recipients = normalizeWhitespace(row.to || "");
  const extractionStatus = normalizeWhitespace(row.extractionStatus || "unknown");
  const extractionReason = normalizeWhitespace(row.extractionReason || "");

  const summaryParts = [];
  if (subject) summaryParts.push(`Email subject "${subject}"`);
  if (name) summaryParts.push(`attachment "${name}"`);
  if (mimeType) summaryParts.push(`mime ${mimeType}`);
  if (sender || recipients) summaryParts.push(`from ${sender || "unknown"} to ${recipients || "unknown"}`);
  summaryParts.push(`status ${extractionStatus}`);
  if (text) summaryParts.push(`text: ${text}`);
  if (extractionReason && !text) summaryParts.push(`reason ${extractionReason}`);
  const content = clipText(summaryParts.join(". "), maxContentChars);
  if (!content) return null;

  const unitId = `att-${stableHash(`${row.clientRequestId || ""}|${row.attachmentId || ""}|${row.sha256 || ""}`)}`;
  return {
    unitId,
    unitType: "attachment",
    source: "pst:attachment-extract",
    occurredAt: normalizeWhitespace(row.messageDate || "") || undefined,
    content,
    tags: ["pst", "attachment", extractionStatus, mimeType || "mime-unknown"].filter(Boolean),
    clientRequestId:
      String(row.clientRequestId || "").trim() || `pst-att-${stableHash(`${unitId}|${row.sha256 || ""}`, 18)}`,
    metadata: {
      attachmentId: row.attachmentId ?? null,
      messageId: row.messageId ?? null,
      attachmentName: name || null,
      mimeType: mimeType || null,
      size: Number.isFinite(Number(row.size)) ? Number(row.size) : null,
      sha256: normalizeWhitespace(row.sha256 || "") || null,
      mailboxPath: normalizeWhitespace(row.mailboxPath || "") || null,
      mailboxName: normalizeWhitespace(row.mailboxName || "") || null,
      subject: subject || null,
      from: sender || null,
      to: recipients || null,
      extractionStatus,
      extractionReason: extractionReason || null,
      hasText: text.length > 0,
    },
  };
}

function run() {
  const { flags } = parseCliArgs(process.argv.slice(2));
  if (readBoolFlag(flags, "help", false) || readBoolFlag(flags, "h", false)) {
    usage();
    return;
  }

  const messagesPath = resolve(
    REPO_ROOT,
    readStringFlag(flags, "messages", "./imports/pst/mailbox-raw-memory.jsonl")
  );
  const attachmentsPath = resolve(
    REPO_ROOT,
    readStringFlag(flags, "attachments", "./imports/pst/mailbox-attachments.jsonl")
  );
  const outputPath = resolve(REPO_ROOT, readStringFlag(flags, "output", "./imports/pst/mailbox-units.jsonl"));
  const deadLetterPath = resolve(
    REPO_ROOT,
    readStringFlag(flags, "dead-letter", "./imports/pst/mailbox-units-dead-letter.jsonl")
  );
  const reportPath = resolve(
    REPO_ROOT,
    readStringFlag(flags, "report", "./output/open-memory/pst-memory-normalize-latest.json")
  );
  const runId = readStringFlag(flags, "run-id", `pst-run-${isoNow().replace(/[:.]/g, "-")}`);
  const maxContentChars = readNumberFlag(flags, "max-content-chars", 1600, { min: 200, max: 20000 });
  const maxAttachmentTextChars = readNumberFlag(flags, "max-attachment-text-chars", 1200, {
    min: 100,
    max: 50000,
  });
  const printJson = readBoolFlag(flags, "json", false);

  if (!existsSync(messagesPath)) {
    throw new Error(`Messages JSONL not found: ${messagesPath}`);
  }

  const deadLetterRows = [];
  const messageRows = readJsonlWithRaw(messagesPath);
  const attachmentRows = existsSync(attachmentsPath) ? readJsonlWithRaw(attachmentsPath) : [];

  const units = [];
  let messageCount = 0;
  let attachmentCount = 0;

  for (const row of messageRows) {
    if (!row.ok || !row.value) {
      deadLetterRows.push({
        stage: "normalize",
        unitType: "message",
        reason: "malformed_jsonl_row",
        raw: row.raw,
      });
      continue;
    }
    const unit = buildMessageUnit(row.value, maxContentChars);
    if (!unit) {
      deadLetterRows.push({
        stage: "normalize",
        unitType: "message",
        reason: "invalid_message_unit",
        raw: row.raw,
      });
      continue;
    }
    units.push(unit);
    messageCount += 1;
  }

  for (const row of attachmentRows) {
    if (!row.ok || !row.value) {
      deadLetterRows.push({
        stage: "normalize",
        unitType: "attachment",
        reason: "malformed_jsonl_row",
        raw: row.raw,
      });
      continue;
    }
    const unit = buildAttachmentUnit(row.value, maxContentChars, maxAttachmentTextChars);
    if (!unit) {
      deadLetterRows.push({
        stage: "normalize",
        unitType: "attachment",
        reason: "invalid_attachment_unit",
        raw: row.raw,
      });
      continue;
    }
    units.push(unit);
    attachmentCount += 1;
  }

  units.sort((a, b) => {
    const left = Date.parse(String(a.occurredAt || "")) || 0;
    const right = Date.parse(String(b.occurredAt || "")) || 0;
    if (left !== right) return left - right;
    return String(a.unitId).localeCompare(String(b.unitId));
  });

  writeJsonl(outputPath, units);
  writeJsonl(deadLetterPath, deadLetterRows);

  const manifestPath = resolve(dirname(outputPath), `${runId}.manifest.json`);
  const manifest = {
    schema: "pst-memory-run-manifest.v1",
    generatedAt: isoNow(),
    runId,
    inputs: {
      messagesPath,
      attachmentsPath: existsSync(attachmentsPath) ? attachmentsPath : null,
    },
    outputs: {
      unitsPath: outputPath,
      deadLetterPath,
    },
    counts: {
      units: units.length,
      messages: messageCount,
      attachments: attachmentCount,
      deadLetter: deadLetterRows.length,
    },
    options: {
      maxContentChars,
      maxAttachmentTextChars,
    },
  };
  writeJson(manifestPath, manifest);

  const report = {
    schema: "pst-memory-normalize-report.v1",
    generatedAt: isoNow(),
    runId,
    messagesPath,
    attachmentsPath: existsSync(attachmentsPath) ? attachmentsPath : null,
    outputPath,
    deadLetterPath,
    manifestPath,
    counts: manifest.counts,
  };
  writeJson(reportPath, report);

  if (printJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write("pst-memory-normalize complete\n");
    process.stdout.write(`messages: ${messagesPath}\n`);
    process.stdout.write(`attachments: ${existsSync(attachmentsPath) ? attachmentsPath : "(none)"}\n`);
    process.stdout.write(`units: ${outputPath}\n`);
    process.stdout.write(`dead-letter: ${deadLetterPath}\n`);
    process.stdout.write(`manifest: ${manifestPath}\n`);
    process.stdout.write(`report: ${reportPath}\n`);
    process.stdout.write(`units-written: ${units.length}\n`);
    process.stdout.write(`dead-letter-count: ${deadLetterRows.length}\n`);
  }
}

try {
  run();
} catch (error) {
  process.stderr.write(
    `pst-memory-normalize failed: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
}
