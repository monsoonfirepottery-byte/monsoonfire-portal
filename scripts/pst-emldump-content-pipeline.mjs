#!/usr/bin/env node

import { existsSync, mkdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isoNow,
  parseCliArgs,
  readBoolFlag,
  readNumberFlag,
  readStringFlag,
  runCommand,
  writeJson,
} from "./lib/pst-memory-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

function usage() {
  process.stdout.write(
    [
      "PST emldump content pipeline",
      "",
      "Usage:",
      "  node ./scripts/pst-emldump-content-pipeline.mjs --pst ./imports/pst/Combined\\ PSTs.pst --run-id pst-emldump-run-001",
      "",
      "Options:",
      "  --pst <path>                    PST path",
      "  --run-id <id>                   Pipeline run id",
      "  --run-dir <path>                Output dir (default: imports/pst/runs/<run-id>)",
      "  --skip-emldump true|false       Reuse existing eml dir (default: false)",
      "  --max-eml <n>                   Optional eml file cap (default: 0 = unlimited)",
      "  --max-bytes <n>                 Attachment byte cap (default: 20971520)",
      "  --max-text-chars <n>            Text clip cap (default: 8000)",
      "  --include-inline true|false     Include inline parts (default: false)",
      "  --allow-mime <csv>              Optional allowlist override",
      "  --run-import true|false         Run memory import after extract (default: true)",
      "  --import-run-id <id>            Import run id (default: <run-id>-import)",
      "  --chunk-size <n>                Import chunk size (default: 50)",
      "  --base-url <url>                Studio Brain URL (default: STUDIO_BRAIN_BASE_URL)",
      "  --json                          Print final report JSON",
    ].join("\n")
  );
}

function relPath(absPath) {
  const rel = relative(REPO_ROOT, absPath);
  if (!rel || rel.startsWith("..")) return absPath;
  return rel;
}

function toWorkspacePath(absolutePath) {
  const rel = relative(REPO_ROOT, absolutePath);
  if (!rel || rel.startsWith("..")) {
    throw new Error(`Path must be inside repo root when using docker parser: ${absolutePath}`);
  }
  return `/workspace/${rel.replace(/\\\\/g, "/")}`;
}

function csvList(raw) {
  return String(raw || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function runPipeline() {
  const { flags } = parseCliArgs(process.argv.slice(2));
  if (readBoolFlag(flags, "help", false) || readBoolFlag(flags, "h", false)) {
    usage();
    return;
  }

  const runId = readStringFlag(flags, "run-id", "").trim();
  if (!runId) {
    throw new Error("--run-id is required.");
  }
  const pstPath = resolve(REPO_ROOT, readStringFlag(flags, "pst", "").trim());
  if (!pstPath || !existsSync(pstPath)) {
    throw new Error(`--pst file not found: ${pstPath || "<empty>"}`);
  }

  const runDir = resolve(REPO_ROOT, readStringFlag(flags, "run-dir", `./imports/pst/runs/${runId}`));
  const emlDir = resolve(runDir, "emldump");
  const outputPath = resolve(runDir, "emldump-attachments-memory.jsonl");
  const deadLetterPath = resolve(runDir, "emldump-attachments-dead-letter.jsonl");
  const reportPath = resolve(runDir, "emldump-attachments-report.json");
  const skipEmldump = readBoolFlag(flags, "skip-emldump", false);
  const maxEml = readNumberFlag(flags, "max-eml", 0, { min: 0, max: 100000000 });
  const maxBytes = readNumberFlag(flags, "max-bytes", 20 * 1024 * 1024, { min: 1, max: 200 * 1024 * 1024 });
  const maxTextChars = readNumberFlag(flags, "max-text-chars", 8000, { min: 200, max: 200000 });
  const includeInline = readBoolFlag(flags, "include-inline", false);
  const allowMime = csvList(flags["allow-mime"]);
  const runImport = readBoolFlag(flags, "run-import", true);
  const importRunId = readStringFlag(flags, "import-run-id", `${runId}-import`);
  const chunkSize = readNumberFlag(flags, "chunk-size", 50, { min: 1, max: 500 });
  const baseUrl = readStringFlag(flags, "base-url", process.env.STUDIO_BRAIN_BASE_URL || "").trim();
  const printJson = readBoolFlag(flags, "json", false);

  const stageStatus = {};
  const startedAt = isoNow();

  if (!skipEmldump) {
    mkdirSync(emlDir, { recursive: true });
    stageStatus.emldump = { status: "running", at: isoNow() };
    const emldump = runCommand(
      "bash",
      ["./scripts/libratom.sh", "emldump", "-o", relPath(emlDir), relPath(pstPath)],
      { cwd: REPO_ROOT, allowFailure: true, maxBuffer: 1024 * 1024 * 64 }
    );
    if (!emldump.ok) {
      const emldumpErrorDetail =
        String(emldump.stderr || emldump.stdout || "").trim()
        || `status=${String(emldump.status ?? "unknown")} signal=${String(emldump.signal || "none")} error=${String(emldump.error || "none")}`;
      stageStatus.emldump = {
        status: "failed",
        at: isoNow(),
        error: emldumpErrorDetail.slice(0, 1000),
      };
      const report = {
        schema: "pst-emldump-content-pipeline-report.v1",
        runId,
        startedAt,
        completedAt: isoNow(),
        status: "failed",
        stageStatus,
      };
      writeJson(reportPath, report);
      throw new Error(stageStatus.emldump.error);
    }
    stageStatus.emldump = { status: "completed", at: isoNow() };
  } else {
    stageStatus.emldump = { status: "skipped", at: isoNow(), reason: "skip-emldump=true" };
  }

  stageStatus.extract = { status: "running", at: isoNow() };
  const allowMimeEffective =
    allowMime.length > 0
      ? allowMime
      : [
          "text/plain",
          "text/html",
          "text/xml",
          "text/csv",
          "application/json",
          "application/xml",
          "application/ics",
          "application/rtf",
          "text/rtf",
          "application/pdf",
          "application/msword",
          "application/x-msword",
          "application/vnd.ms-excel",
          "application/x-msexcel",
          "application/vnd.ms-excel.sheet.macroenabled.12",
          "application/vnd.ms-powerpoint",
          "application/x-mspowerpoint",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          "application/octet-stream",
          "application/octetstream",
        ];

  const pythonProgram = `
import base64
import email
from email import policy
import hashlib
import html
import io
import json
import os
import re
import sys
import zipfile

eml_root = sys.argv[1]
output_path = sys.argv[2]
dead_letter_path = sys.argv[3]
max_eml = int(sys.argv[4])
max_bytes = int(sys.argv[5])
max_text_chars = int(sys.argv[6])
include_inline = sys.argv[7].strip().lower() in ("1","true","yes","on")
allow_mime = set([v.strip().lower() for v in sys.argv[8].split(",") if v.strip()])

def normalize(text):
    return re.sub(r"\\s+", " ", str(text or "")).strip()

def normalize_mime(value):
    raw = normalize(value).lower()
    if ";" in raw:
        raw = raw.split(";", 1)[0].strip()
    return raw

def clip(text, max_chars):
    text = normalize(text)
    if len(text) <= max_chars:
        return text
    return text[:max(1, max_chars-1)].rstrip() + "…"

def strip_xml(text):
    text = re.sub(r"<[^>]+>", " ", text or "")
    return normalize(html.unescape(text))

def decode_text_bytes(data):
    if data is None:
        return ""
    for enc in ("utf-8","utf-16","latin-1"):
        try:
            return normalize(data.decode(enc, errors="strict"))
        except Exception:
            continue
    return normalize(data.decode("utf-8", errors="ignore"))

def extract_printable_strings(data, min_run=4, limit=250):
    if data is None:
        return ""
    parts = []
    for chunk in re.findall(rb"[\\x20-\\x7E]{%d,}" % min_run, data):
        try:
            text = normalize(chunk.decode("latin-1", errors="ignore"))
        except Exception:
            text = ""
        if text:
            parts.append(text)
        if len(parts) >= limit:
            break
    return normalize(" ".join(parts))

def extract_openxml_text(data, name_lower):
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            paths = zf.namelist()
            if name_lower.endswith(".docx"):
                targets = [p for p in paths if p.startswith("word/") and p.endswith(".xml")]
            elif name_lower.endswith(".pptx"):
                targets = [p for p in paths if p.startswith("ppt/") and p.endswith(".xml")]
            elif name_lower.endswith(".xlsx"):
                targets = [p for p in paths if p.startswith("xl/") and p.endswith(".xml")]
            else:
                return ""
            chunks = []
            for target in targets[:200]:
                try:
                    raw = zf.read(target).decode("utf-8", errors="ignore")
                    cleaned = strip_xml(raw)
                    if cleaned:
                        chunks.append(cleaned)
                except Exception:
                    continue
            return normalize(" ".join(chunks))
    except Exception:
        return ""

def build_content(meta, text):
    bits = [
        f"PST attachment {meta.get('attachmentName') or 'unnamed'} ({meta.get('mimeType') or 'unknown'}, {meta.get('size',0)} bytes).",
        f"Message: \\"{meta.get('subject') or '(no subject)'}\\" from {meta.get('from') or 'unknown sender'} to {meta.get('to') or 'unknown recipient'}.",
        f"Date: {meta.get('messageDate') or 'unknown'}.",
        f"Extraction: {meta.get('extractionStatus') or 'unknown'} ({meta.get('extractionReason') or 'none'}).",
    ]
    if text:
        bits.append(f"Extracted text: {text}")
    return " ".join([b for b in bits if b])

text_like_mime = {
    "text/plain","text/html","text/xml","text/csv",
    "application/json","application/xml","application/ics",
    "application/rtf","text/rtf",
}
binary_fallback_mime = {
    "application/pdf",
    "application/msword","application/x-msword",
    "application/vnd.ms-excel","application/x-msexcel","application/vnd.ms-excel.sheet.macroenabled.12",
    "application/vnd.ms-powerpoint","application/x-mspowerpoint",
    "application/octet-stream","application/octetstream",
}

seen_eml = 0
attachment_seen = 0
written = 0
dead_letter = 0
status_counts = {}
mime_counts = {}

with open(output_path, "w", encoding="utf-8") as out, open(dead_letter_path, "w", encoding="utf-8") as dlq:
    for root, _dirs, files in os.walk(eml_root):
        files = sorted(files)
        for name in files:
            if max_eml > 0 and seen_eml >= max_eml:
                break
            if not name.lower().endswith(".eml"):
                continue
            seen_eml += 1
            eml_path = os.path.join(root, name)
            rel_path = os.path.relpath(eml_path, eml_root).replace("\\\\","/")
            try:
                with open(eml_path, "rb") as fh:
                    msg = email.message_from_binary_file(fh, policy=policy.default)
            except Exception:
                continue

            subject = normalize(msg.get("subject",""))
            sender = normalize(msg.get("from",""))
            recipients = normalize(msg.get("to",""))
            message_date = normalize(msg.get("date",""))
            message_id = normalize(msg.get("message-id",""))

            part_index = 0
            for part in msg.walk():
                if part.is_multipart():
                    continue
                part_index += 1
                disposition = normalize(part.get_content_disposition() or "")
                file_name = normalize(part.get_filename() or "")
                mime_type = normalize_mime(part.get_content_type() or "")
                mime_counts[mime_type or "unknown"] = mime_counts.get(mime_type or "unknown", 0) + 1
                if not file_name and disposition not in ("attachment","inline"):
                    continue
                if disposition == "inline" and not include_inline:
                    continue

                attachment_seen += 1
                payload = part.get_payload(decode=True) or b""
                size = len(payload)
                extension = ""
                if "." in file_name:
                    extension = "." + file_name.lower().rsplit(".", 1)[1]

                status = "metadata_only"
                reason = "content_extraction_disabled"
                text = ""

                if size > max_bytes:
                    status = "skipped"
                    reason = "attachment_too_large"
                elif allow_mime and mime_type not in allow_mime:
                    status = "skipped"
                    reason = "mime_not_allowlisted"
                else:
                    try:
                        if (
                            mime_type.startswith("text/")
                            or mime_type in text_like_mime
                            or extension in (".txt",".csv",".md",".json",".xml",".html",".htm",".vcf",".ics",".rtf")
                        ):
                            text = decode_text_bytes(payload)
                            if mime_type in ("text/html","application/xhtml+xml","text/xml","application/xml") or extension in (".html",".htm",".xml"):
                                text = strip_xml(text)
                            status = "extracted" if text else "skipped"
                            reason = "decoded_text" if text else "decoded_text_empty"
                        elif extension in (".docx",".pptx",".xlsx"):
                            text = extract_openxml_text(payload, file_name.lower())
                            status = "extracted" if text else "skipped"
                            reason = "openxml_parsed" if text else "openxml_no_text"
                        elif mime_type in binary_fallback_mime or extension in (".pdf",".doc",".xls",".ppt"):
                            text = extract_printable_strings(payload)
                            status = "extracted" if text else "skipped"
                            reason = "binary_strings" if text else "binary_strings_empty"
                        else:
                            status = "skipped"
                            reason = "no_extractor_for_type"
                    except Exception as exc:
                        status = "failed"
                        reason = f"extract_error:{str(exc)[:180]}"

                text = clip(text, max_text_chars) if text else ""
                sha256 = hashlib.sha256(payload).hexdigest()
                metadata = {
                    "type": "pst_emldump_attachment",
                    "attachmentName": file_name or None,
                    "mimeType": mime_type or None,
                    "size": size,
                    "sha256": sha256,
                    "emlPath": rel_path,
                    "messageId": message_id or None,
                    "messageDate": message_date or None,
                    "subject": subject or None,
                    "from": sender or None,
                    "to": recipients or None,
                    "extractionStatus": status,
                    "extractionReason": reason,
                    "extractedText": text or None,
                    "disposition": disposition or None,
                    "partIndex": part_index,
                }
                content = build_content(metadata, text)
                client_req = "pst-emldump-att-" + hashlib.sha256(f"{rel_path}|{part_index}|{sha256}".encode("utf-8")).hexdigest()[:24]
                row = {
                    "content": content,
                    "source": "pst:emldump-attachment-memory",
                    "tags": ["pst","attachment","emldump", status],
                    "clientRequestId": client_req,
                    "metadata": metadata,
                }
                out.write(json.dumps(row, ensure_ascii=False) + "\\n")
                written += 1
                status_counts[status] = status_counts.get(status, 0) + 1
                if status in ("skipped","failed"):
                    dlq.write(json.dumps(row, ensure_ascii=False) + "\\n")
                    dead_letter += 1
        if max_eml > 0 and seen_eml >= max_eml:
            break

summary = {
    "ok": True,
    "seenEml": seen_eml,
    "attachmentsSeen": attachment_seen,
    "written": written,
    "deadLetter": dead_letter,
    "statusCounts": status_counts,
    "mimeCountsTop": sorted(mime_counts.items(), key=lambda item: (-item[1], item[0]))[:25],
}
print(json.dumps(summary))
`;

  const extractResult = runCommand(
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
      String(process.env.LIBRATOM_IMAGE || "monsoonfire/libratom:0.7.1-r2"),
      "-",
      toWorkspacePath(emlDir),
      toWorkspacePath(outputPath),
      toWorkspacePath(deadLetterPath),
      String(maxEml),
      String(maxBytes),
      String(maxTextChars),
      includeInline ? "true" : "false",
      allowMimeEffective.join(","),
    ],
    {
      cwd: REPO_ROOT,
      allowFailure: true,
      input: pythonProgram,
      maxBuffer: 1024 * 1024 * 256,
    }
  );

  if (!extractResult.ok) {
    stageStatus.extract = {
      status: "failed",
      at: isoNow(),
      error: String(extractResult.stderr || extractResult.stdout || "extract failed").trim().slice(0, 1000),
    };
    const report = {
      schema: "pst-emldump-content-pipeline-report.v1",
      runId,
      startedAt,
      completedAt: isoNow(),
      status: "failed",
      stageStatus,
    };
    writeJson(reportPath, report);
    throw new Error(stageStatus.extract.error);
  }
  stageStatus.extract = { status: "completed", at: isoNow() };
  const summary = JSON.parse(String(extractResult.stdout || "{}").trim() || "{}");

  const report = {
    schema: "pst-emldump-content-pipeline-report.v1",
    runId,
    startedAt,
    completedAt: isoNow(),
    status: "running",
    pstPath,
    runDir,
    emlDir,
    outputPath,
    deadLetterPath,
    reportPath,
    options: {
      skipEmldump,
      maxEml: maxEml || null,
      maxBytes,
      maxTextChars,
      includeInline,
      allowMime: allowMimeEffective,
      runImport,
      importRunId,
      chunkSize,
      baseUrl: baseUrl || null,
    },
    stageStatus,
    summary,
  };

  if (runImport) {
    stageStatus.import = { status: "running", at: isoNow() };
    const importArgs = [
      "./scripts/pst-memory-import-resumable.mjs",
      "--input",
      relPath(outputPath),
      "--run-id",
      importRunId,
      "--source",
      "pst:emldump-attachment-memory",
      "--chunk-size",
      String(chunkSize),
      "--max-retries",
      "4",
      "--continue-on-error",
      "true",
      "--auth-auto-mint",
      "true",
      "--force-auth-refresh",
      "true",
      "--auto-replay-dead-letter",
      "true",
      "--dedupe-client-request-id",
      "true",
      "--open-memory-timeout-ms",
      "120000",
      "--open-memory-request-retries",
      "4",
      "--open-memory-request-retry-base-ms",
      "1200",
    ];
    if (baseUrl) {
      importArgs.push("--base-url", baseUrl);
    }
    const importResult = runCommand(process.execPath, importArgs, {
      cwd: REPO_ROOT,
      allowFailure: true,
      maxBuffer: 1024 * 1024 * 128,
    });
    stageStatus.import = {
      status: importResult.ok ? "completed" : "failed",
      at: isoNow(),
      error: importResult.ok
        ? null
        : String(importResult.stderr || importResult.stdout || "import failed").trim().slice(0, 1200),
    };
    report.import = {
      ok: importResult.ok,
      output: String(importResult.stdout || importResult.stderr || "").trim().slice(-1500) || null,
    };
  } else {
    stageStatus.import = { status: "skipped", at: isoNow(), reason: "run-import=false" };
  }

  report.stageStatus = stageStatus;
  report.status = stageStatus.import?.status === "failed" ? "completed_with_failures" : "completed";
  report.completedAt = isoNow();
  writeJson(reportPath, report);

  if (printJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  process.stdout.write("pst-emldump-content-pipeline complete\n");
  process.stdout.write(`run-id: ${runId}\n`);
  process.stdout.write(`report: ${reportPath}\n`);
  process.stdout.write(`output: ${outputPath}\n`);
  process.stdout.write(`attachments-seen: ${summary.attachmentsSeen || 0}\n`);
  process.stdout.write(`written: ${summary.written || 0}\n`);
}

try {
  runPipeline();
} catch (error) {
  process.stderr.write(
    `pst-emldump-content-pipeline failed: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
}
