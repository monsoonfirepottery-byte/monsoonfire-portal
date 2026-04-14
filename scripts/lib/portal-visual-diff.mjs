import { readFileSync } from "node:fs";
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..", "..");
const DEFAULT_FIXTURE_ROOT = resolve(repoRoot, "scripts", "fixtures", "portal-visual-diff");
const DEFAULT_PLAN_PATH = resolve(DEFAULT_FIXTURE_ROOT, "plan.json");
const DEFAULT_BASELINE_ROOT = resolve(DEFAULT_FIXTURE_ROOT, "baselines");
const DEFAULT_OUTPUT_ROOT = resolve(repoRoot, "output", "qa", "portal-visual-diff");
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export function normalizeVisualDiffId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function relativePath(fromPath, toPath) {
  return relative(fromPath, toPath).split(sep).join("/");
}

export function loadPortalVisualDiffPlan(planPath = DEFAULT_PLAN_PATH) {
  const resolved = resolve(planPath);
  const raw = readFileSync(resolved, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || !parsed.scripts || typeof parsed.scripts !== "object") {
    throw new Error(`Visual diff plan at ${resolved} is missing a scripts map.`);
  }
  return { ...parsed, planPath: resolved };
}

export function getPortalVisualDiffScriptPlan(scriptKey, plan = loadPortalVisualDiffPlan()) {
  const scriptPlan = plan.scripts?.[scriptKey];
  if (!scriptPlan || typeof scriptPlan !== "object") {
    throw new Error(`Visual diff plan has no entry for ${scriptKey}.`);
  }
  const frames = Array.isArray(scriptPlan.frames)
    ? scriptPlan.frames.map((frame, index) => normalizeFrame(frame, index))
    : [];
  return {
    ...scriptPlan,
    scriptKey,
    frames,
  };
}

export function resolvePortalVisualDiffPaths({
  scriptKey,
  mode,
  baselineRoot = DEFAULT_BASELINE_ROOT,
  outputRoot = DEFAULT_OUTPUT_ROOT,
  runId = `run-${new Date().toISOString().replace(/[:.]/g, "-")}`,
}) {
  const safeScriptKey = normalizeVisualDiffId(scriptKey);
  const safeRunId = normalizeVisualDiffId(runId) || `run-${Date.now()}`;
  return {
    scriptKey: safeScriptKey,
    mode: String(mode || "off").trim().toLowerCase(),
    baselineDir: resolve(baselineRoot, safeScriptKey),
    outputDir: resolve(outputRoot, "runs", safeRunId, safeScriptKey),
    runId: safeRunId,
  };
}

export async function applyPortalVisualDiff({
  scriptKey,
  summary,
  mode = "off",
  baselineRoot = DEFAULT_BASELINE_ROOT,
  outputRoot = DEFAULT_OUTPUT_ROOT,
  planPath = DEFAULT_PLAN_PATH,
  runId = summary?.startedAtIso || summary?.startedAt || new Date().toISOString(),
} = {}) {
  const normalizedMode = String(mode || "off").trim().toLowerCase();
  if (!["capture", "compare", "refresh", "off", ""].includes(normalizedMode)) {
    return {
      status: "failed",
      mode: normalizedMode,
      scriptKey,
      error: `Unknown visual diff mode: ${normalizedMode}`,
      frames: [],
      totals: { frames: 0, passed: 0, failed: 0, captured: 0, missing: 0, diffPixels: 0, totalPixels: 0 },
    };
  }

  if (normalizedMode === "off" || !scriptKey || !summary) {
    return null;
  }

  try {
    const plan = getPortalVisualDiffScriptPlan(scriptKey, loadPortalVisualDiffPlan(planPath));
    const paths = resolvePortalVisualDiffPaths({ scriptKey, mode: normalizedMode, baselineRoot, outputRoot, runId });
    const screenshotEntries = collectScreenshotEntries(summary);
    const runDir = paths.outputDir;
    const baselineDir = paths.baselineDir;

    await mkdir(runDir, { recursive: true });
    await mkdir(baselineDir, { recursive: true });

    const frames = [];
    const totals = {
      frames: 0,
      passed: 0,
      failed: 0,
      captured: 0,
      missing: 0,
      diffPixels: 0,
      totalPixels: 0,
    };

    for (const frame of plan.frames) {
      totals.frames += 1;
      const screenshotEntry = screenshotEntries.get(frame.screenshot);
      const frameDir = resolve(runDir, frame.key);
      await mkdir(frameDir, { recursive: true });

      const result = {
        ...frame,
        status: "pending",
        baselinePath: resolve(baselineDir, frame.screenshot),
        actualPath: screenshotEntry?.path ? resolve(frameDir, basename(screenshotEntry.path)) : "",
        diffPath: resolve(frameDir, "comparison.png"),
        reportDir: frameDir,
        route: frame.route || "",
        theme: frame.theme || "",
        dock: frame.dock || "",
        error: "",
        diffPixels: 0,
        totalPixels: 0,
        diffRatio: 0,
      };

      if (!screenshotEntry?.path) {
        result.status = "missing";
        result.error = `Missing screenshot capture for ${frame.screenshot}.`;
        totals.failed += 1;
        totals.missing += 1;
        frames.push(result);
        continue;
      }

      await copyFile(screenshotEntry.path, result.actualPath);

      if (normalizedMode === "capture" || normalizedMode === "refresh") {
        await copyFile(screenshotEntry.path, result.baselinePath);
        result.status = "captured";
        result.baselineCopied = true;
        result.diffPath = "";
        totals.captured += 1;
        frames.push(result);
        continue;
      }

      const comparison = await comparePngFiles(result.baselinePath, result.actualPath);
      result.status = comparison.same ? "passed" : "failed";
      result.diffPixels = comparison.diffPixels;
      result.totalPixels = comparison.totalPixels;
      result.diffRatio = comparison.diffRatio;
      result.width = comparison.width;
      result.height = comparison.height;
      result.sizeMismatch = comparison.sizeMismatch;
      result.baselineExists = comparison.baselineExists;
      result.actualExists = comparison.actualExists;
      result.comparisonPath = result.diffPath;
      totals.diffPixels += comparison.diffPixels;
      totals.totalPixels += comparison.totalPixels;

      if (!comparison.baselineExists) {
        result.status = "failed";
        result.error = `Missing baseline at ${result.baselinePath}. Run capture mode to approve a baseline.`;
        totals.failed += 1;
        frames.push(result);
        continue;
      }

      await writeComparisonSheet(result.diffPath, comparison);
      if (comparison.same) {
        totals.passed += 1;
      } else {
        totals.failed += 1;
      }
      frames.push(result);
    }

    const failedFrames = frames.filter((frame) => frame.status === "failed" || frame.status === "missing");
    const status = failedFrames.length > 0 ? "failed" : "passed";
    const generatedAtIso = new Date().toISOString();
    const manifest = {
      status,
      mode: normalizedMode,
      scriptKey,
      scriptTitle: plan.title || scriptKey,
      description: plan.description || "",
      generatedAtIso,
      runId: paths.runId,
      baselineDir,
      outputDir: runDir,
      planPath: plan.planPath,
      totals,
      frames,
    };

    const manifestPath = resolve(runDir, "visual-diff-manifest.json");
    const markdownPath = resolve(runDir, "visual-diff-triage.md");
    manifest.manifestPath = manifestPath;
    manifest.markdownPath = markdownPath;

    await writeJson(manifestPath, manifest);
    await writeFile(markdownPath, `${renderVisualDiffMarkdown(manifest, { baselineDir })}\n`, "utf8");

    if (normalizedMode === "capture" || normalizedMode === "refresh") {
      await writeJson(resolve(baselineDir, "manifest.json"), manifest);
    }

    return manifest;
  } catch (error) {
    return {
      status: "failed",
      mode: normalizedMode,
      scriptKey,
      error: error instanceof Error ? error.message : String(error),
      frames: [],
      totals: { frames: 0, passed: 0, failed: 0, captured: 0, missing: 0, diffPixels: 0, totalPixels: 0 },
    };
  }
}

export function renderVisualDiffMarkdown(manifest, { baselineDir = DEFAULT_BASELINE_ROOT } = {}) {
  const lines = [];
  const status = String(manifest?.status || "unknown");
  const mode = String(manifest?.mode || "off");
  const scriptTitle = String(manifest?.scriptTitle || manifest?.scriptKey || "visual diff");
  lines.push(`# ${scriptTitle} visual diff`);
  lines.push("");
  lines.push(`- Status: \`${status}\``);
  lines.push(`- Mode: \`${mode}\``);
  lines.push(`- Run: \`${manifest?.runId || ""}\``);
  lines.push(`- Baselines: \`${relativePath(dirname(manifest.markdownPath || baselineDir), baselineDir)}\``);
  lines.push("");
  lines.push("| Surface | Route | Theme | Status | Diff | Artifacts |");
  lines.push("| --- | --- | --- | --- | --- | --- |");

  for (const frame of manifest?.frames || []) {
    const actualLink = frame.actualPath ? linkFor(manifest.markdownPath, frame.actualPath) : "";
    const baselineLink = frame.baselinePath ? linkFor(manifest.markdownPath, frame.baselinePath) : "";
    const diffLink = frame.diffPath ? linkFor(manifest.markdownPath, frame.diffPath) : "";
    const diffText = frame.status === "captured" ? "captured" : `${((Number(frame.diffRatio || 0)) * 100).toFixed(2)}%`;
    lines.push(
      `| ${escapeTableCell(frame.label || frame.key || frame.screenshot)} | ${escapeTableCell(frame.route || "n/a")} | ${escapeTableCell(frame.theme || frame.dock || "n/a")} | ${escapeTableCell(frame.status || "unknown")} | ${escapeTableCell(diffText)} | ${[
        baselineLink ? `[baseline](${baselineLink})` : "",
        actualLink ? `[actual](${actualLink})` : "",
        diffLink ? `[diff](${diffLink})` : "",
      ]
        .filter(Boolean)
        .join(" · ")} |`
    );
  }

  const failedFrames = (manifest?.frames || []).filter((frame) => frame.status === "failed" || frame.status === "missing");
  if (failedFrames.length > 0) {
    lines.push("");
    lines.push("## Triage");
    for (const frame of failedFrames.slice(0, 8)) {
      lines.push(`- ${frame.label || frame.key}: ${frame.error || "visual diff failed"} (${frame.screenshot})`);
    }
  }

  return lines.join("\n");
}

export function buildVisualDiffAggregateMarkdown(reports, fromPath = "") {
  const lines = [];
  const filtered = (Array.isArray(reports) ? reports : []).filter(Boolean);
  const total = filtered.reduce(
    (acc, report) => {
      acc.frames += Number(report?.totals?.frames || 0);
      acc.passed += Number(report?.totals?.passed || 0);
      acc.failed += Number(report?.totals?.failed || 0);
      acc.captured += Number(report?.totals?.captured || 0);
      acc.missing += Number(report?.totals?.missing || 0);
      return acc;
    },
    { frames: 0, passed: 0, failed: 0, captured: 0, missing: 0 }
  );

  lines.push("# Portal visual diff triage");
  lines.push("");
  lines.push(`- Runs: \`${filtered.length}\``);
  lines.push(`- Frames: \`${total.frames}\``);
  lines.push(`- Passed: \`${total.passed}\``);
  lines.push(`- Failed: \`${total.failed}\``);
  lines.push(`- Captured: \`${total.captured}\``);
  lines.push(`- Missing: \`${total.missing}\``);
  lines.push("");
  lines.push("| Script | Status | Mode | Frames | Failed | Markdown |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const report of filtered) {
    const markdownLink = report?.markdownPath ? `[triage](${relativePath(dirname(fromPath || report.markdownPath), report.markdownPath)})` : "";
    lines.push(
      `| ${escapeTableCell(report.scriptTitle || report.scriptKey || "visual diff")} | ${escapeTableCell(report.status || "unknown")} | ${escapeTableCell(report.mode || "off")} | ${escapeTableCell(String(report?.totals?.frames || 0))} | ${escapeTableCell(String(report?.totals?.failed || 0))} | ${markdownLink} |`
    );
  }
  return lines.join("\n");
}

export function buildVisualDiffAggregateJson(reports) {
  const filtered = (Array.isArray(reports) ? reports : []).filter(Boolean);
  return {
    generatedAtIso: new Date().toISOString(),
    reports: filtered,
    totals: filtered.reduce(
      (acc, report) => {
        acc.frames += Number(report?.totals?.frames || 0);
        acc.passed += Number(report?.totals?.passed || 0);
        acc.failed += Number(report?.totals?.failed || 0);
        acc.captured += Number(report?.totals?.captured || 0);
        acc.missing += Number(report?.totals?.missing || 0);
        return acc;
      },
      { frames: 0, passed: 0, failed: 0, captured: 0, missing: 0 }
    ),
  };
}

export async function writeJson(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizeFrame(frame, index) {
  const normalized = frame && typeof frame === "object" ? frame : {};
  const screenshot = String(normalized.screenshot || "").trim();
  if (!screenshot) {
    throw new Error(`Visual diff frame ${index + 1} is missing a screenshot name.`);
  }
  const key = normalizeVisualDiffId(normalized.key || basename(screenshot, ".png")) || `frame-${index + 1}`;
  return {
    key,
    screenshot,
    label: String(normalized.label || key).trim(),
    surface: String(normalized.surface || "").trim(),
    route: String(normalized.route || "").trim(),
    theme: String(normalized.theme || "").trim(),
    dock: String(normalized.dock || "").trim(),
    priority: String(normalized.priority || "medium").trim(),
  };
}

function collectScreenshotEntries(summary) {
  const entries = new Map();
  const candidates = [
    ...(Array.isArray(summary?.screenshots) ? summary.screenshots : []),
    ...(Array.isArray(summary?.artifacts) ? summary.artifacts : []),
  ];
  for (const entry of candidates) {
    if (!entry || typeof entry !== "object") continue;
    const path = String(entry.path || "").trim();
    if (!path) continue;
    entries.set(basename(path), { ...entry, path });
  }
  return entries;
}

export async function comparePngFiles(baselinePath, actualPath) {
  const baselineExists = await exists(baselinePath);
  const actualExists = await exists(actualPath);
  if (!actualExists) {
    throw new Error(`Actual screenshot not found at ${actualPath}.`);
  }
  if (!baselineExists) {
    const actual = decodePng(await readFile(actualPath));
    const placeholderBaseline = {
      width: actual.width,
      height: actual.height,
      data: Buffer.alloc(actual.width * actual.height * 4, 245),
    };
    return {
      ...compareDecodedImages(placeholderBaseline, actual),
      baselineExists,
      actualExists,
      baseline: placeholderBaseline,
      actual,
    };
  }
  const baseline = decodePng(await readFile(baselinePath));
  const actual = decodePng(await readFile(actualPath));
  const comparison = compareDecodedImages(baseline, actual);
  return {
    ...comparison,
    baselineExists,
    actualExists,
    baseline,
    actual,
  };
}

function compareDecodedImages(baseline, actual) {
  const width = Math.max(baseline.width, actual.width);
  const height = Math.max(baseline.height, actual.height);
  const panelGap = 12;
  const sheetWidth = width * 3 + panelGap * 2;
  const sheet = Buffer.alloc(sheetWidth * height * 4, 255);
  const comparison = {
    width,
    height,
    same: true,
    diffPixels: 0,
    totalPixels: width * height,
    diffRatio: 0,
    sizeMismatch: baseline.width !== actual.width || baseline.height !== actual.height,
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const base = samplePixel(baseline, x, y);
      const live = samplePixel(actual, x, y);
      const same = pixelsEqual(base, live);
      if (!same) {
        comparison.same = false;
        comparison.diffPixels += 1;
      }
      writePixel(sheet, sheetWidth, x, y, base || [245, 245, 245, 255]);
      writePixel(sheet, sheetWidth, x + width + panelGap, y, live || [245, 245, 245, 255]);
      writePixel(sheet, sheetWidth, x + (width + panelGap) * 2, y, same ? (live || base || [220, 220, 220, 255]) : (base && live ? [255, 92, 92, 255] : [255, 196, 0, 255]));
    }
  }

  comparison.diffRatio = comparison.totalPixels > 0 ? comparison.diffPixels / comparison.totalPixels : 0;
  comparison.comparisonSheet = {
    width: sheetWidth,
    height,
    data: sheet,
  };
  return comparison;
}

async function writeComparisonSheet(diffPath, comparison) {
  if (!comparison?.comparisonSheet) return;
  await writeFile(diffPath, encodePng(comparison.comparisonSheet));
}

function decodePng(buffer) {
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (source.length < PNG_SIGNATURE.length || !source.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("File is not a PNG image.");
  }
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks = [];
  let offset = 8;
  while (offset + 12 <= source.length) {
    const length = source.readUInt32BE(offset);
    offset += 4;
    const type = source.toString("ascii", offset, offset + 4);
    offset += 4;
    const data = source.subarray(offset, offset + length);
    offset += length;
    offset += 4;

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data.readUInt8(8);
      colorType = data.readUInt8(9);
      if (data.readUInt8(10) !== 0 || data.readUInt8(11) !== 0 || data.readUInt8(12) !== 0) {
        throw new Error("Unsupported PNG compression, filter, or interlace mode.");
      }
    } else if (type === "IDAT") {
      idatChunks.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
  }

  if (!width || !height) {
    throw new Error("PNG image is missing IHDR metadata.");
  }
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`Unsupported PNG format (bitDepth=${bitDepth}, colorType=${colorType}).`);
  }

  const raw = inflateSync(Buffer.concat(idatChunks));
  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const rowBytes = width * bytesPerPixel;
  const rgba = Buffer.alloc(width * height * 4);
  const current = Buffer.alloc(rowBytes);
  let rawOffset = 0;
  let prevRow = Buffer.alloc(rowBytes, 0);

  for (let y = 0; y < height; y += 1) {
    const filter = raw.readUInt8(rawOffset);
    rawOffset += 1;
    raw.copy(current, 0, rawOffset, rawOffset + rowBytes);
    rawOffset += rowBytes;
    unfilterRow(filter, current, prevRow, bytesPerPixel);
    for (let x = 0; x < width; x += 1) {
      const sourceOffset = x * bytesPerPixel;
      const targetOffset = (y * width + x) * 4;
      rgba[targetOffset] = current[sourceOffset];
      rgba[targetOffset + 1] = current[sourceOffset + 1];
      rgba[targetOffset + 2] = current[sourceOffset + 2];
      rgba[targetOffset + 3] = bytesPerPixel === 4 ? current[sourceOffset + 3] : 255;
    }
    prevRow = Buffer.from(current);
  }

  return { width, height, data: rgba };
}

export function encodePng(image) {
  const { width, height, data } = image;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("PNG encoder requires positive integer dimensions.");
  }
  const rgba = Buffer.from(data);
  if (rgba.length !== width * height * 4) {
    throw new Error("PNG encoder received mismatched pixel data length.");
  }

  const raw = Buffer.alloc((width * 4 + 1) * height);
  let rawOffset = 0;
  for (let y = 0; y < height; y += 1) {
    raw[rawOffset] = 0;
    rawOffset += 1;
    rgba.copy(raw, rawOffset, y * width * 4, (y + 1) * width * 4);
    rawOffset += width * 4;
  }

  const chunks = [];
  chunks.push(PNG_SIGNATURE);
  chunks.push(makeChunk("IHDR", buildIhdr(width, height)));
  chunks.push(makeChunk("IDAT", deflateSync(raw)));
  chunks.push(makeChunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(chunks);
}

function buildIhdr(width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(6, 9);
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(0, 12);
  return ihdr;
}

function makeChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (~crc) >>> 0;
}

function unfilterRow(filter, current, prevRow, bytesPerPixel) {
  switch (filter) {
    case 0:
      return;
    case 1:
      for (let index = 0; index < current.length; index += 1) {
        const left = index >= bytesPerPixel ? current[index - bytesPerPixel] : 0;
        current[index] = (current[index] + left) & 0xff;
      }
      return;
    case 2:
      for (let index = 0; index < current.length; index += 1) {
        current[index] = (current[index] + prevRow[index]) & 0xff;
      }
      return;
    case 3:
      for (let index = 0; index < current.length; index += 1) {
        const left = index >= bytesPerPixel ? current[index - bytesPerPixel] : 0;
        const up = prevRow[index];
        current[index] = (current[index] + Math.floor((left + up) / 2)) & 0xff;
      }
      return;
    case 4:
      for (let index = 0; index < current.length; index += 1) {
        const left = index >= bytesPerPixel ? current[index - bytesPerPixel] : 0;
        const up = prevRow[index];
        const upLeft = index >= bytesPerPixel ? prevRow[index - bytesPerPixel] : 0;
        current[index] = (current[index] + paethPredictor(left, up, upLeft)) & 0xff;
      }
      return;
    default:
      throw new Error(`Unsupported PNG filter ${filter}.`);
  }
}

function paethPredictor(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  if (upDistance <= upLeftDistance) return up;
  return upLeft;
}

function samplePixel(image, x, y) {
  if (!image || x < 0 || y < 0 || x >= image.width || y >= image.height) return null;
  const index = (y * image.width + x) * 4;
  return [image.data[index], image.data[index + 1], image.data[index + 2], image.data[index + 3]];
}

function pixelsEqual(left, right) {
  if (!left || !right) return false;
  return left[0] === right[0] && left[1] === right[1] && left[2] === right[2] && left[3] === right[3];
}

function writePixel(buffer, stride, x, y, rgba) {
  if (x < 0 || y < 0) return;
  const index = (y * stride + x) * 4;
  if (index < 0 || index + 3 >= buffer.length) return;
  buffer[index] = rgba[0];
  buffer[index + 1] = rgba[1];
  buffer[index + 2] = rgba[2];
  buffer[index + 3] = rgba[3];
}

function linkFor(fromPath, toPath) {
  if (!fromPath || !toPath) return "";
  return relativePath(dirname(fromPath), toPath);
}

function escapeTableCell(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
