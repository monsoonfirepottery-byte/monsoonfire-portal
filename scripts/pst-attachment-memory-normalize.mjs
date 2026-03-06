#!/usr/bin/env node

import { createReadStream, createWriteStream } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import {
  clipText,
  ensureParentDir,
  isoNow,
  parseCliArgs,
  readBoolFlag,
  readNumberFlag,
  readStringFlag,
  stableHash,
} from "./lib/pst-memory-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

function usage() {
  process.stdout.write(
    [
      "PST attachment -> memory normalizer",
      "",
      "Usage:",
      "  node ./scripts/pst-attachment-memory-normalize.mjs \\",
      "    --input ./imports/pst/runs/<run-id>/mailbox-attachments.jsonl \\",
      "    --output ./imports/pst/runs/<run-id>/mailbox-attachments-memory.jsonl",
      "",
      "Options:",
      "  --input <path>                  Source attachment JSONL",
      "  --output <path>                 Output memory JSONL",
      "  --source <value>                Memory source tag (default: pst:attachment-memory)",
      "  --aggregate true|false          Aggregate repeated attachments (default: true)",
      "  --sample-limit <n>              Sample contexts per aggregate bucket (default: 3)",
      "  --max-text-chars <n>            Clip extracted text in content/metadata (default: 1800)",
      "  --skip-empty-content true|false Skip rows with no useful fields (default: true)",
      "  --max-rows <n>                  Optional cap while normalizing (default: unlimited)",
      "  --json true|false               Print summary JSON",
    ].join("\n")
  );
}

function normalizeInt(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.trunc(parsed);
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseJsonLine(line) {
  try {
    const parsed = JSON.parse(line);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function buildAttachmentSummary(record, maxTextChars) {
  const attachmentName = normalizeText(record.attachmentName || "unnamed");
  const mimeType = normalizeText(record.mimeType || "unknown");
  const size = normalizeInt(record.size, 0);
  const subject = normalizeText(record.subject || "(no subject)");
  const from = normalizeText(record.from || "unknown sender");
  const to = normalizeText(record.to || "unknown recipient");
  const messageDate = normalizeText(record.messageDate || "");
  const extractionStatus = normalizeText(record.extractionStatus || "unknown");
  const extractionReason = normalizeText(record.extractionReason || "");
  const text = clipText(normalizeText(record.text || ""), maxTextChars);

  const parts = [
    `PST attachment ${attachmentName} (${mimeType}, ${size} bytes).`,
    `Message: "${subject}" from ${from} to ${to}${messageDate ? ` at ${messageDate}` : ""}.`,
    `Extraction: ${extractionStatus}${extractionReason ? ` (${extractionReason})` : ""}.`,
  ];
  if (text) {
    parts.push(`Extracted text: ${text}`);
  }
  return parts.join(" ");
}

function attachmentKey(record) {
  const sha = normalizeText(record.sha256 || "");
  const mime = normalizeText(record.mimeType || "");
  const name = normalizeText(record.attachmentName || "");
  const size = normalizeInt(record.size, 0);
  const status = normalizeText(record.extractionStatus || "");
  const reason = normalizeText(record.extractionReason || "");
  const textHash = stableHash(normalizeText(record.text || ""), 16);
  return `${sha}|${mime}|${name}|${size}|${status}|${reason}|${textHash}`;
}

function ensureBucket(map, key, record, sampleLimit, maxTextChars) {
  if (map.has(key)) return map.get(key);
  const bucket = {
    key,
    count: 0,
    base: {
      attachmentName: normalizeText(record.attachmentName || ""),
      mimeType: normalizeText(record.mimeType || ""),
      size: normalizeInt(record.size, 0),
      sha256: normalizeText(record.sha256 || ""),
      extractionStatus: normalizeText(record.extractionStatus || ""),
      extractionReason: normalizeText(record.extractionReason || ""),
      text: clipText(normalizeText(record.text || ""), maxTextChars),
      mailboxName: normalizeText(record.mailboxName || ""),
      mailboxPath: normalizeText(record.mailboxPath || ""),
    },
    sampleMessages: [],
    sampleSet: new Set(),
    sampleLimit: Math.max(1, sampleLimit),
    firstMessageDate: "",
    lastMessageDate: "",
    messageIdMin: Number.POSITIVE_INFINITY,
    messageIdMax: Number.NEGATIVE_INFINITY,
  };
  map.set(key, bucket);
  return bucket;
}

function maybeAddSample(bucket, record) {
  if (bucket.sampleMessages.length >= bucket.sampleLimit) return;
  const messageId = normalizeInt(record.messageId, 0);
  const subject = normalizeText(record.subject || "(no subject)");
  const from = normalizeText(record.from || "unknown sender");
  const to = normalizeText(record.to || "unknown recipient");
  const messageDate = normalizeText(record.messageDate || "");
  const sampleKey = `${messageId}|${subject}|${from}|${to}|${messageDate}`;
  if (bucket.sampleSet.has(sampleKey)) return;
  bucket.sampleSet.add(sampleKey);
  bucket.sampleMessages.push({
    messageId,
    subject,
    from,
    to,
    messageDate,
  });
}

function updateBucket(bucket, record) {
  bucket.count += 1;
  const messageId = normalizeInt(record.messageId, 0);
  const messageDate = normalizeText(record.messageDate || "");
  if (messageDate && (!bucket.firstMessageDate || messageDate < bucket.firstMessageDate)) {
    bucket.firstMessageDate = messageDate;
  }
  if (messageDate && (!bucket.lastMessageDate || messageDate > bucket.lastMessageDate)) {
    bucket.lastMessageDate = messageDate;
  }
  if (Number.isFinite(messageId)) {
    bucket.messageIdMin = Math.min(bucket.messageIdMin, messageId);
    bucket.messageIdMax = Math.max(bucket.messageIdMax, messageId);
  }
}

function rowFromBucket(bucket, source, maxTextChars) {
  const attachmentName = bucket.base.attachmentName || "unnamed";
  const mimeType = bucket.base.mimeType || "unknown";
  const size = bucket.base.size;
  const status = bucket.base.extractionStatus || "unknown";
  const reason = bucket.base.extractionReason;
  const textSnippet = clipText(bucket.base.text || "", maxTextChars);
  const sampleSummary = bucket.sampleMessages
    .map((sample) => `${sample.messageDate || "unknown date"}: "${sample.subject}"`)
    .join(" | ");
  const content = [
    `PST attachment cluster "${attachmentName}" (${mimeType}, ${size} bytes) seen ${bucket.count} times.`,
    `Extraction: ${status}${reason ? ` (${reason})` : ""}.`,
    bucket.firstMessageDate || bucket.lastMessageDate
      ? `Message date span: ${bucket.firstMessageDate || "?"} -> ${bucket.lastMessageDate || "?"}.`
      : "",
    sampleSummary ? `Sample messages: ${sampleSummary}` : "",
    textSnippet ? `Extracted text sample: ${textSnippet}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    content,
    source,
    tags: ["pst", "attachment", "mail", status || "unknown"].filter(Boolean),
    clientRequestId: `pst-attachment-cluster-${stableHash(`${bucket.key}|${bucket.count}`, 20)}`,
    metadata: {
      type: "pst_attachment_cluster",
      count: bucket.count,
      attachmentName,
      mimeType,
      size,
      sha256: bucket.base.sha256 || null,
      extractionStatus: status || null,
      extractionReason: reason || null,
      mailboxName: bucket.base.mailboxName || null,
      mailboxPath: bucket.base.mailboxPath || null,
      firstMessageDate: bucket.firstMessageDate || null,
      lastMessageDate: bucket.lastMessageDate || null,
      messageIdMin: Number.isFinite(bucket.messageIdMin) ? bucket.messageIdMin : null,
      messageIdMax: Number.isFinite(bucket.messageIdMax) ? bucket.messageIdMax : null,
      sampleMessages: bucket.sampleMessages,
      extractedTextSample: textSnippet || null,
    },
  };
}

function rowFromRecord(record, source, maxTextChars) {
  const content = buildAttachmentSummary(record, maxTextChars);
  const attachmentId = normalizeInt(record.attachmentId, 0);
  const messageId = normalizeInt(record.messageId, 0);
  const extractionStatus = normalizeText(record.extractionStatus || "unknown");
  const extractionReason = normalizeText(record.extractionReason || "");
  const key = `${attachmentId}|${messageId}|${record.clientRequestId || ""}|${record.attachmentName || ""}`;
  return {
    content,
    source,
    tags: ["pst", "attachment", "mail", extractionStatus || "unknown"].filter(Boolean),
    clientRequestId: `pst-attachment-${stableHash(key, 20)}`,
    metadata: {
      type: "pst_attachment",
      attachmentId: attachmentId || null,
      messageId: messageId || null,
      attachmentName: normalizeText(record.attachmentName || "") || null,
      mimeType: normalizeText(record.mimeType || "") || null,
      size: normalizeInt(record.size, 0),
      sha256: normalizeText(record.sha256 || "") || null,
      mailboxPath: normalizeText(record.mailboxPath || "") || null,
      mailboxName: normalizeText(record.mailboxName || "") || null,
      messageDate: normalizeText(record.messageDate || "") || null,
      subject: normalizeText(record.subject || "") || null,
      from: normalizeText(record.from || "") || null,
      to: normalizeText(record.to || "") || null,
      extractionStatus: extractionStatus || null,
      extractionReason: extractionReason || null,
      extractedText: clipText(normalizeText(record.text || ""), maxTextChars) || null,
      sourceRecordClientRequestId: normalizeText(record.clientRequestId || "") || null,
    },
  };
}

async function main() {
  const { flags } = parseCliArgs(process.argv.slice(2));
  if (readBoolFlag(flags, "help", false) || readBoolFlag(flags, "h", false)) {
    usage();
    return;
  }

  const inputPath = resolve(
    REPO_ROOT,
    readStringFlag(
      flags,
      "input",
      "./imports/pst/runs/pst-run-2026-03-03-conflicted-210gb/mailbox-attachments.jsonl"
    )
  );
  const outputPath = resolve(
    REPO_ROOT,
    readStringFlag(
      flags,
      "output",
      "./imports/pst/runs/pst-run-2026-03-03-conflicted-210gb/mailbox-attachments-memory.jsonl"
    )
  );
  const source = readStringFlag(flags, "source", "pst:attachment-memory");
  const aggregate = readBoolFlag(flags, "aggregate", true);
  const sampleLimit = readNumberFlag(flags, "sample-limit", 3, { min: 1, max: 20 });
  const maxTextChars = readNumberFlag(flags, "max-text-chars", 1800, { min: 200, max: 200000 });
  const skipEmptyContent = readBoolFlag(flags, "skip-empty-content", true);
  const maxRows = readNumberFlag(flags, "max-rows", 0, { min: 0 });
  const printJson = readBoolFlag(flags, "json", false);

  ensureParentDir(outputPath);
  const rl = readline.createInterface({
    input: createReadStream(inputPath, { encoding: "utf8" }),
    crlfDelay: Number.POSITIVE_INFINITY,
  });
  const out = createWriteStream(outputPath, { encoding: "utf8", flags: "w" });

  let seen = 0;
  let malformed = 0;
  let written = 0;
  let droppedEmpty = 0;
  const buckets = new Map();

  for await (const rawLine of rl) {
    const line = String(rawLine || "").trim();
    if (!line) continue;
    if (maxRows > 0 && seen >= maxRows) break;
    seen += 1;
    const record = parseJsonLine(line);
    if (!record) {
      malformed += 1;
      continue;
    }

    if (aggregate) {
      const key = attachmentKey(record);
      const bucket = ensureBucket(buckets, key, record, sampleLimit, maxTextChars);
      updateBucket(bucket, record);
      maybeAddSample(bucket, record);
      continue;
    }

    const row = rowFromRecord(record, source, maxTextChars);
    if (skipEmptyContent && !normalizeText(row.content)) {
      droppedEmpty += 1;
      continue;
    }
    out.write(`${JSON.stringify(row)}\n`);
    written += 1;
  }

  if (aggregate) {
    for (const bucket of buckets.values()) {
      const row = rowFromBucket(bucket, source, maxTextChars);
      if (skipEmptyContent && !normalizeText(row.content)) {
        droppedEmpty += 1;
        continue;
      }
      out.write(`${JSON.stringify(row)}\n`);
      written += 1;
    }
  }

  out.end();
  await new Promise((resolvePromise) => out.on("finish", resolvePromise));

  const summary = {
    schema: "pst-attachment-memory-normalize-report.v1",
    generatedAt: isoNow(),
    inputPath,
    outputPath,
    source,
    options: {
      aggregate,
      sampleLimit,
      maxTextChars,
      skipEmptyContent,
      maxRows: maxRows || null,
    },
    totals: {
      seen,
      malformed,
      written,
      droppedEmpty,
      aggregateBuckets: aggregate ? buckets.size : null,
    },
  };

  if (printJson) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  process.stdout.write("pst-attachment-memory-normalize complete\n");
  process.stdout.write(`input: ${inputPath}\n`);
  process.stdout.write(`output: ${outputPath}\n`);
  process.stdout.write(`seen: ${seen}\n`);
  process.stdout.write(`written: ${written}\n`);
  process.stdout.write(`malformed: ${malformed}\n`);
  if (aggregate) {
    process.stdout.write(`aggregate buckets: ${buckets.size}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(
    `pst-attachment-memory-normalize failed: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
});
