#!/usr/bin/env node

import { existsSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  isoNow,
  parseCliArgs,
  readBoolFlag,
  readNumberFlag,
  readStringFlag,
  writeJson,
} from "./lib/pst-memory-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

const DEFAULT_ALLOW_MIME = [
  "text/plain",
  "text/csv",
  "application/json",
  "application/xml",
  "application/pdf",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
];

function usage() {
  process.stdout.write(
    [
      "PST attachment extraction stage",
      "",
      "Usage:",
      "  node ./scripts/pst-attachment-extract.mjs \\",
      "    --report-db ./imports/pst/mailbox-report.sqlite3 \\",
      "    --output ./imports/pst/mailbox-attachments.jsonl \\",
      "    --dead-letter ./imports/pst/mailbox-attachments-dead-letter.jsonl",
      "",
      "Options:",
      "  --max-bytes <n>         Per attachment byte cap (default: 20971520)",
      "  --max-text-chars <n>    Extracted text clip size (default: 8000)",
      "  --max-attachments <n>   Hard cap number of attachments processed (default: 0=unlimited)",
      "  --extract-content <t/f> Whether to parse attachment text (default: true)",
      "  --allow-mime <csv>      Allowlisted MIME types",
      "  --image <name>          Docker image used for python/sqlite extraction (default: LIBRATOM_IMAGE or monsoonfire/libratom:0.7.1-r2)",
      "  --report <path>         JSON summary report output",
      "  --json                  Print report JSON to stdout",
    ].join("\n")
  );
}

function csvList(raw) {
  return String(raw || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function toWorkspacePath(absolutePath) {
  const rel = relative(REPO_ROOT, absolutePath);
  if (!rel || rel.startsWith("..")) {
    throw new Error(
      `Path must be inside repo root when running docker extraction: ${absolutePath}`
    );
  }
  return `/workspace/${rel.replace(/\\\\/g, "/")}`;
}

function run() {
  const { flags } = parseCliArgs(process.argv.slice(2));
  if (readBoolFlag(flags, "help", false) || readBoolFlag(flags, "h", false)) {
    usage();
    return;
  }

  const reportDb = resolve(REPO_ROOT, readStringFlag(flags, "report-db", "./imports/pst/mailbox-report.sqlite3"));
  const outputPath = resolve(
    REPO_ROOT,
    readStringFlag(flags, "output", "./imports/pst/mailbox-attachments.jsonl")
  );
  const deadLetterPath = resolve(
    REPO_ROOT,
    readStringFlag(flags, "dead-letter", "./imports/pst/mailbox-attachments-dead-letter.jsonl")
  );
  const reportPath = resolve(
    REPO_ROOT,
    readStringFlag(flags, "report", "./output/open-memory/pst-attachment-extract-latest.json")
  );
  const maxBytes = readNumberFlag(flags, "max-bytes", 20 * 1024 * 1024, { min: 1 });
  const maxTextChars = readNumberFlag(flags, "max-text-chars", 8000, { min: 256, max: 200000 });
  const maxAttachments = readNumberFlag(flags, "max-attachments", 0, { min: 0 });
  const extractContent = readBoolFlag(flags, "extract-content", true);
  const allowMime = csvList(flags["allow-mime"]);
  const allowMimeEffective = allowMime.length > 0 ? allowMime : DEFAULT_ALLOW_MIME;
  const imageName = readStringFlag(
    flags,
    "image",
    String(process.env.LIBRATOM_IMAGE || "monsoonfire/libratom:0.7.1-r2")
  );
  const printJson = readBoolFlag(flags, "json", false);

  if (!existsSync(reportDb)) {
    throw new Error(`Report sqlite DB not found: ${reportDb}`);
  }

  const reportDbWorkspace = toWorkspacePath(reportDb);
  const outputWorkspace = toWorkspacePath(outputPath);
  const deadLetterWorkspace = toWorkspacePath(deadLetterPath);

  const pythonProgram = `
import csv
import hashlib
import html
import io
import json
import os
import re
import sqlite3
import sys
import zipfile
from email.parser import HeaderParser

db_path = sys.argv[1]
output_path = sys.argv[2]
dead_letter_path = sys.argv[3]
max_bytes = int(sys.argv[4])
max_text_chars = int(sys.argv[5])
max_attachments = int(sys.argv[6])
extract_content = sys.argv[7].strip().lower() in ("1","true","yes","on")
allow_mime_raw = sys.argv[8]
allow_mime = set([v.strip().lower() for v in allow_mime_raw.split(",") if v.strip()])

parser = HeaderParser()

def normalize_whitespace(value):
    return re.sub(r"\\s+", " ", str(value or "")).strip()

def strip_xml(text):
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    return normalize_whitespace(text)

def decode_text_bytes(data):
    if data is None:
        return ""
    if isinstance(data, memoryview):
        data = data.tobytes()
    for enc in ("utf-8", "utf-16", "latin-1"):
        try:
            return normalize_whitespace(data.decode(enc, errors="strict"))
        except Exception:
            continue
    try:
        return normalize_whitespace(data.decode("utf-8", errors="ignore"))
    except Exception:
        return ""

def extract_openxml_text(data, name_lower):
    if isinstance(data, memoryview):
        data = data.tobytes()
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        paths = zf.namelist()
        collected = []
        if name_lower.endswith(".docx"):
            targets = [p for p in paths if p.startswith("word/") and p.endswith(".xml")]
        elif name_lower.endswith(".pptx"):
            targets = [p for p in paths if p.startswith("ppt/") and p.endswith(".xml")]
        elif name_lower.endswith(".xlsx"):
            targets = [p for p in paths if p.startswith("xl/") and p.endswith(".xml")]
        else:
            targets = []
        for target in targets[:200]:
            try:
                raw = zf.read(target).decode("utf-8", errors="ignore")
                cleaned = strip_xml(raw)
                if cleaned:
                    collected.append(cleaned)
            except Exception:
                continue
    return normalize_whitespace(" ".join(collected))

def clip(value, max_chars):
    text = normalize_whitespace(value)
    if len(text) <= max_chars:
        return text
    return text[:max(1, max_chars-1)].rstrip() + "…"

def make_request_id(seed):
    digest = hashlib.sha256(seed.encode("utf-8")).hexdigest()[:24]
    return f"pst-att-{digest}"

conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

query = """
SELECT
  a.id AS attachment_id,
  a.name AS attachment_name,
  a.mime_type AS attachment_mime_type,
  a.size AS attachment_size,
  a.content AS attachment_content,
  a.message_id AS message_id,
  m.date AS message_date,
  m.headers AS message_headers,
  fr.path AS mailbox_path,
  fr.name AS mailbox_name
FROM attachment a
LEFT JOIN message m ON m.id = a.message_id
LEFT JOIN file_report fr ON fr.id = a.file_report_id
ORDER BY a.id
"""

rows = cur.execute(query)

written = 0
dead_letter = 0
seen = 0
mime_counts = {}
status_counts = {}

with open(output_path, "w", encoding="utf-8") as out, open(dead_letter_path, "w", encoding="utf-8") as dlq:
    for row in rows:
        if max_attachments > 0 and seen >= max_attachments:
            break
        seen += 1

        attachment_id = row["attachment_id"]
        name = normalize_whitespace(row["attachment_name"])
        name_lower = name.lower()
        mime_type = normalize_whitespace(row["attachment_mime_type"]).lower()
        size = int(row["attachment_size"] or 0)
        message_id = int(row["message_id"] or 0)
        message_date = normalize_whitespace(row["message_date"])
        mailbox_path = normalize_whitespace(row["mailbox_path"])
        mailbox_name = normalize_whitespace(row["mailbox_name"])
        headers_raw = row["message_headers"] or ""
        headers = parser.parsestr(headers_raw)
        subject = normalize_whitespace(headers.get("Subject") or "")
        sender = normalize_whitespace(headers.get("From") or "")
        recipients = normalize_whitespace(headers.get("To") or "")
        content = row["attachment_content"]

        mime_counts[mime_type or "unknown"] = mime_counts.get(mime_type or "unknown", 0) + 1
        status = "metadata_only"
        reason = "content_extraction_disabled"
        text = ""

        if mime_type not in allow_mime:
            status = "skipped"
            reason = "mime_not_allowlisted"
        elif size > max_bytes:
            status = "skipped"
            reason = "attachment_too_large"
        elif not extract_content:
            status = "metadata_only"
            reason = "content_extraction_disabled"
        else:
            try:
                if (mime_type.startswith("text/") or name_lower.endswith(".txt") or name_lower.endswith(".csv") or name_lower.endswith(".md") or name_lower.endswith(".json") or name_lower.endswith(".xml")) and content is not None:
                    text = decode_text_bytes(content)
                    status = "extracted"
                    reason = "decoded_text"
                elif (name_lower.endswith(".docx") or name_lower.endswith(".pptx") or name_lower.endswith(".xlsx")) and content is not None:
                    text = extract_openxml_text(content, name_lower)
                    status = "extracted" if text else "skipped"
                    reason = "openxml_parsed" if text else "openxml_no_text"
                else:
                    status = "skipped"
                    reason = "no_extractor_for_type"
            except Exception as exc:
                status = "failed"
                reason = f"extract_error:{str(exc)[:160]}"

        if text:
            text = clip(text, max_text_chars)

        if isinstance(content, memoryview):
            content_bytes = content.tobytes()
        elif isinstance(content, bytes):
            content_bytes = content
        elif content is None:
            content_bytes = b""
        else:
            content_bytes = str(content).encode("utf-8", errors="ignore")
        sha256 = hashlib.sha256(content_bytes).hexdigest()

        record = {
            "unitType": "attachment",
            "attachmentId": attachment_id,
            "messageId": message_id,
            "attachmentName": name,
            "mimeType": mime_type,
            "size": size,
            "sha256": sha256,
            "mailboxPath": mailbox_path,
            "mailboxName": mailbox_name,
            "messageDate": message_date,
            "subject": subject,
            "from": sender,
            "to": recipients,
            "extractionStatus": status,
            "extractionReason": reason,
            "text": text,
            "source": "pst:attachment-extract",
            "clientRequestId": make_request_id(f"{mailbox_path}|{attachment_id}|{sha256}"),
        }
        out.write(json.dumps(record, ensure_ascii=False) + "\\n")
        written += 1

        status_counts[status] = status_counts.get(status, 0) + 1
        if status in ("skipped", "failed"):
            dlq.write(json.dumps(record, ensure_ascii=False) + "\\n")
            dead_letter += 1

summary = {
    "ok": True,
    "seen": seen,
    "written": written,
    "deadLetter": dead_letter,
    "statusCounts": status_counts,
    "mimeCountsTop": sorted(mime_counts.items(), key=lambda item: (-item[1], item[0]))[:25],
    "output": output_path,
    "deadLetterPath": dead_letter_path,
}
print(json.dumps(summary))
`;

  const stdout = execFileSync(
    "docker",
    [
      "run",
      "--rm",
      "-i",
      "-u",
      `${process.getuid()}:${process.getgid()}`,
      "-v",
      `${REPO_ROOT}:/workspace`,
      "-w",
      "/workspace",
      "--entrypoint",
      "python",
      imageName,
      "-",
      reportDbWorkspace,
      outputWorkspace,
      deadLetterWorkspace,
      String(maxBytes),
      String(maxTextChars),
      String(maxAttachments),
      extractContent ? "true" : "false",
      allowMimeEffective.join(","),
    ],
    {
      input: pythonProgram,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 1024 * 1024 * 128,
      cwd: REPO_ROOT,
    }
  ).trim();

  const parsed = JSON.parse(stdout || "{}");
  const report = {
    schema: "pst-attachment-extract-report.v1",
    generatedAt: isoNow(),
    reportDb,
    outputPath,
    deadLetterPath,
    options: {
      maxBytes,
      maxTextChars,
      maxAttachments,
      extractContent,
      allowMime: allowMimeEffective,
      imageName,
    },
    summary: parsed,
  };

  writeJson(reportPath, report);

  if (printJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`pst-attachment-extract complete\n`);
    process.stdout.write(`report-db: ${reportDb}\n`);
    process.stdout.write(`output: ${outputPath}\n`);
    process.stdout.write(`dead-letter: ${deadLetterPath}\n`);
    process.stdout.write(`report: ${reportPath}\n`);
    process.stdout.write(`seen: ${parsed.seen ?? 0}\n`);
    process.stdout.write(`written: ${parsed.written ?? 0}\n`);
    process.stdout.write(`dead-letter-count: ${parsed.deadLetter ?? 0}\n`);
  }
}

try {
  run();
} catch (error) {
  process.stderr.write(
    `pst-attachment-extract failed: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
}
