import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..", "..");
const STUDIO_BRAIN_ROOT = resolve(REPO_ROOT, "studio-brain");
export const WIKI_ROOT = resolve(REPO_ROOT, "wiki");

export const STATUS_VALUES = new Set([
  "RAW_CAPTURED",
  "EXTRACTED",
  "SYNTHESIZED",
  "VERIFIED",
  "OPERATIONAL_TRUTH",
  "STALE",
  "DEPRECATED",
  "CONTRADICTORY",
  "NEEDS_HUMAN_REVIEW",
]);

const TEXT_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsonl",
  ".md",
  ".mjs",
  ".py",
  ".rules",
  ".service",
  ".sh",
  ".timer",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

const ROOT_SOURCE_FILES = [
  "AGENTS.md",
  "package.json",
  "firebase.json",
  "firestore.rules",
  "firestore.indexes.json",
  "storage.rules",
  "PROJECT_SNAPSHOT.md",
  "WORKLOG.md",
];

const APPROVED_SOURCE_ROOTS = [
  ".governance",
  "config/studiobrain",
  "docs",
  "functions/src",
  "memory/accepted",
  "scripts",
  "studio-brain/docs",
  "studio-brain/src",
  "tickets",
  "web/public",
  "web/src/api",
  "web/src/views",
  "website",
  "wiki/40_decisions",
];

const DENY_PREFIXES = [
  ".git/",
  ".firebase/",
  ".tmp/",
  ".codex/",
  "artifacts/",
  "design/",
  "exports/",
  "functions/lib/",
  "imports/",
  "node_modules/",
  "output/",
  "secrets/",
  "studio-brain/lib/",
  "test-results/",
  "tmp/",
  "web/dist/",
];

const DENY_PARTS = [
  "/.env",
  "/node_modules/",
  "/secrets/",
  "/.git/",
  "/dist/",
];

const GENERATED_BUT_ALLOWED = [
  "web/public/agent-docs/",
  "web/public/contracts/",
  "website/agent-docs/",
  "website/ncsitebuilder/agent-docs/",
];

const CONTENT_SECRET_PATTERNS = [
  { code: "private-key", regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { code: "openai-key", regex: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { code: "oauth-refresh-token", regex: /"refresh_token"\s*:\s*"[^"]{20,}"/i },
  { code: "bearer-token", regex: /\bBearer\s+[A-Za-z0-9._~+/-]{30,}/ },
  { code: "firebase-service-account", regex: /"private_key_id"\s*:\s*"[a-f0-9]{20,}"/i },
];

const HUMAN_APPROVAL_PATTERNS = /\b(pricing|price|legal|tax|medical|refund|payment|membership|access|customer-facing|policy)\b/i;

const CONTRADICTION_SCAN_EXCLUDED_PATHS = new Set([
  "scripts/lib/wiki-postgres-utils.mjs",
  "scripts/wiki-postgres.test.mjs",
]);

const SERVICE_PRICING_POLICY_PATH = "docs/policies/service-pricing-and-membership-decommission.md";

const VOLUME_PRICING_PATTERN = /\b(by volume|per cubic inch|volume pricing|useVolumePricing|volumeIn3)\b/i;

const NO_VOLUME_PRICING_PATTERN = /\b(do not bill by kiln volume|do not measure kiln volume for billing|not based on kiln volume|no-volume billing|no volume pricing|does not use volume pricing|no cubic-inch pricing)\b/i;

const GUARDRAIL_VOLUME_CONTEXT_PATTERN = /\b(assertNoMatches|repo grep|returns no|forbidden|deny|not allowed|should not|must not|without volume pricing|no billing-path matches)\b/i;

const MEMBERSHIP_ACTIVE_MODEL_PATTERN = /\b(member-only|active studio members|membership tiers include|memberships are tiered|membership(s)?\b.{0,80}\brequired\b|membership plan|current tier|current plan|firing credits|storage discounts|storage and discounts)\b/i;

const MEMBERSHIP_DECOMMISSION_PATTERN = /\bmembership(s)?\b.{0,140}\b(decommission|phase(d)? out|phasing out|being phased out|remove|removed|sunset|straight pricing for services only)\b/i;

const STALE_MEMBERSHIP_CONTEXT_PATTERN = /\b(stale|decommission|decommissioned|paused|redesign|do not infer|do not edit|no longer presents)\b/i;

export function repoRelative(path) {
  return relative(REPO_ROOT, path).replace(/\\/g, "/");
}

export function stableHash(value, length = 16) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, length);
}

export function fullHash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

export function normalizeKey(value, maxLength = 160) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9:_./-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength) || "unknown";
}

export function parseArgs(argv) {
  const args = {
    command: "",
    tenantScope: process.env.STUDIO_BRAIN_DEFAULT_TENANT_ID || "monsoonfire-main",
    json: false,
    applyDb: false,
    writeMarkdown: false,
    freshExtract: false,
    limit: 0,
    artifact: "",
    root: REPO_ROOT,
    strict: false,
    maxFileBytes: 512 * 1024,
  };

  const tokens = [...argv];
  if (tokens[0] && !tokens[0].startsWith("--")) {
    args.command = tokens.shift();
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const token = String(tokens[index] || "");
    if (!token.startsWith("--")) continue;
    const next = tokens[index + 1];
    if (token === "--json") {
      args.json = true;
      continue;
    }
    if (token === "--apply-db") {
      args.applyDb = true;
      continue;
    }
    if (token === "--write-markdown") {
      args.writeMarkdown = true;
      continue;
    }
    if (token === "--fresh-extract") {
      args.freshExtract = true;
      continue;
    }
    if (token === "--strict") {
      args.strict = true;
      continue;
    }
    if (token === "--tenant-scope" && next) {
      args.tenantScope = String(next);
      index += 1;
      continue;
    }
    if (token === "--limit" && next) {
      args.limit = Math.max(0, Number.parseInt(String(next), 10) || 0);
      index += 1;
      continue;
    }
    if (token === "--artifact" && next) {
      args.artifact = resolve(REPO_ROOT, String(next));
      index += 1;
      continue;
    }
    if (token === "--root" && next) {
      args.root = resolve(String(next));
      index += 1;
      continue;
    }
    if (token === "--max-file-bytes" && next) {
      args.maxFileBytes = Math.max(4096, Number.parseInt(String(next), 10) || args.maxFileBytes);
      index += 1;
    }
  }

  args.command ||= "validate";
  return args;
}

function isUnderApprovedRoot(relativePath) {
  if (ROOT_SOURCE_FILES.includes(relativePath)) return true;
  return APPROVED_SOURCE_ROOTS.some((root) => relativePath === root || relativePath.startsWith(`${root}/`));
}

function denyReasonForPath(relativePath) {
  const normalized = relativePath.replace(/\\/g, "/");
  const lowered = normalized.toLowerCase();
  if (!isUnderApprovedRoot(normalized)) return "not-approved-source-root";
  for (const prefix of DENY_PREFIXES) {
    if (lowered === prefix.slice(0, -1) || lowered.startsWith(prefix)) return `deny-prefix:${prefix}`;
  }
  const wrapped = `/${lowered}`;
  for (const part of DENY_PARTS) {
    if (wrapped.includes(part) && !GENERATED_BUT_ALLOWED.some((allowed) => lowered.startsWith(allowed))) {
      return `deny-path-part:${part}`;
    }
  }
  if (normalized.includes("\\") || normalized.includes("\0")) return "invalid-path";
  return "";
}

export function sourceDenyReason(relativePath) {
  return denyReasonForPath(relativePath);
}

function secretReasonForContent(content) {
  for (const pattern of CONTENT_SECRET_PATTERNS) {
    if (pattern.regex.test(content)) return `secret-pattern:${pattern.code}`;
  }
  return "";
}

export function contentDenyReason(content) {
  return secretReasonForContent(content);
}

function shouldReadTextFile(relativePath, maxFileBytes) {
  const ext = extname(relativePath).toLowerCase();
  if (relativePath.endsWith(".rules")) return true;
  if (!TEXT_EXTENSIONS.has(ext)) return false;
  try {
    const stats = statSync(resolve(REPO_ROOT, relativePath));
    return stats.size <= maxFileBytes;
  } catch {
    return false;
  }
}

function walkFiles(rootPath, maxFileBytes, files = []) {
  const absoluteRoot = resolve(REPO_ROOT, rootPath);
  if (!existsSync(absoluteRoot)) return files;
  const stats = statSync(absoluteRoot);
  if (stats.isFile()) {
    const rel = repoRelative(absoluteRoot);
    if (shouldReadTextFile(rel, maxFileBytes)) files.push(rel);
    return files;
  }
  for (const entry of readdirSync(absoluteRoot, { withFileTypes: true })) {
    const child = join(absoluteRoot, entry.name);
    const rel = repoRelative(child);
    const lowered = rel.toLowerCase();
    if (entry.isDirectory()) {
      if (DENY_PREFIXES.some((prefix) => lowered === prefix.slice(0, -1) || lowered.startsWith(prefix))) continue;
      walkFiles(rel, maxFileBytes, files);
      continue;
    }
    if (entry.isFile() && shouldReadTextFile(rel, maxFileBytes)) files.push(rel);
  }
  return files;
}

export function discoverSourceFiles(options = {}) {
  const maxFileBytes = options.maxFileBytes || 512 * 1024;
  const files = new Set();
  for (const file of ROOT_SOURCE_FILES) {
    if (existsSync(resolve(REPO_ROOT, file)) && shouldReadTextFile(file, maxFileBytes)) files.add(file);
  }
  for (const root of APPROVED_SOURCE_ROOTS) {
    for (const file of walkFiles(root, maxFileBytes)) files.add(file);
  }
  return [...files].sort((a, b) => a.localeCompare(b));
}

export function chunkText(content, relativePath, maxLines = 80) {
  const lines = String(content || "").split(/\r?\n/);
  const ext = extname(relativePath).toLowerCase();
  const chunks = [];
  let start = 1;
  let buffer = [];
  let headingPath = [];
  let currentHeadingPath = [];

  function pushChunk(endLine) {
    const text = buffer.join("\n").trim();
    if (!text) {
      buffer = [];
      start = endLine + 1;
      return;
    }
    chunks.push({
      chunkIndex: chunks.length,
      lineStart: start,
      lineEnd: endLine,
      headingPath: currentHeadingPath,
      content: text,
      contentHash: fullHash(text),
    });
    buffer = [];
    start = endLine + 1;
  }

  for (let index = 0; index < lines.length; index += 1) {
    const lineNo = index + 1;
    const line = lines[index];
    if (ext === ".md") {
      const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (heading && buffer.length > 0) pushChunk(lineNo - 1);
      if (heading) {
        const level = heading[1].length;
        headingPath = headingPath.slice(0, level - 1);
        headingPath[level - 1] = heading[2].trim();
        currentHeadingPath = headingPath.filter(Boolean);
        start = lineNo;
      }
    }
    if (buffer.length === 0) start = lineNo;
    buffer.push(line);
    if (buffer.length >= maxLines) pushChunk(lineNo);
  }
  if (buffer.length > 0) pushChunk(lines.length);
  return chunks;
}

export function buildSourceIndex(options = {}) {
  const generatedAt = new Date().toISOString();
  const tenantScope = options.tenantScope || "monsoonfire-main";
  const limit = Number(options.limit || 0);
  const files = discoverSourceFiles(options);
  const selected = limit > 0 ? files.slice(0, limit) : files;
  const sources = [];
  const chunks = [];
  const denied = [];

  for (const relativePath of selected) {
    const absolutePath = resolve(REPO_ROOT, relativePath);
    const pathDeny = denyReasonForPath(relativePath);
    if (pathDeny) {
      denied.push({ sourcePath: relativePath, reason: pathDeny });
      continue;
    }
    let content = "";
    try {
      content = readFileSync(absolutePath, "utf8");
    } catch (error) {
      denied.push({ sourcePath: relativePath, reason: `read-error:${error instanceof Error ? error.message : String(error)}` });
      continue;
    }
    const secretReason = secretReasonForContent(content);
    if (secretReason) {
      denied.push({ sourcePath: relativePath, reason: secretReason });
      continue;
    }

    const contentHash = fullHash(content);
    const sourceId = `src_${stableHash(`${tenantScope}:${relativePath}`, 20)}`;
    const sourceChunks = chunkText(content, relativePath).map((chunk) => ({
      ...chunk,
      sourceId,
      chunkId: `chk_${stableHash(`${sourceId}:${chunk.chunkIndex}:${chunk.contentHash}`, 20)}`,
      tenantScope,
      sourcePath: relativePath,
    }));
    sources.push({
      sourceId,
      tenantScope,
      sourceKind: "repo-file",
      sourcePath: relativePath,
      sourceUri: null,
      title: relativePath,
      authorityClass: authorityForPath(relativePath),
      contentHash,
      gitSha: null,
      freshnessStatus: "fresh",
      ingestStatus: "indexed",
      denyReason: null,
      chunkCount: sourceChunks.length,
      metadata: {
        extension: extname(relativePath).toLowerCase(),
        bytes: Buffer.byteLength(content, "utf8"),
      },
    });
    chunks.push(...sourceChunks);
  }

  const snapshotHash = fullHash(JSON.stringify({
    tenantScope,
    sources: sources.map((source) => ({
      sourceId: source.sourceId,
      sourcePath: source.sourcePath,
      sourceUri: source.sourceUri,
      authorityClass: source.authorityClass,
      contentHash: source.contentHash,
      chunkCount: source.chunkCount,
    })),
    chunks: chunks.map((chunk) => ({
      chunkId: chunk.chunkId,
      sourceId: chunk.sourceId,
      lineStart: chunk.lineStart,
      lineEnd: chunk.lineEnd,
      contentHash: chunk.contentHash,
    })),
    denied,
  }));

  return {
    schema: "wiki-source-index.v1",
    generatedAt,
    snapshotHash,
    tenantScope,
    sources,
    chunks,
    denied,
    summary: {
      discovered: files.length,
      selected: selected.length,
      indexed: sources.length,
      denied: denied.length,
      chunks: chunks.length,
    },
  };
}

function authorityForPath(relativePath) {
  if (relativePath === "AGENTS.md" || relativePath.startsWith("docs/policies/")) return "policy";
  if (relativePath.includes("SOURCE_OF_TRUTH") || relativePath.includes("CONTRACT")) return "policy";
  if (relativePath.startsWith("config/studiobrain/") || relativePath.startsWith(".governance/")) return "policy";
  return "repo";
}

function findChunksForSource(index, relativePath) {
  return index.chunks.filter((chunk) => chunk.sourcePath === relativePath);
}

function makeSourceRef(source, chunk, role = "supports") {
  return {
    sourceId: source.sourceId,
    chunkId: chunk?.chunkId || null,
    sourcePath: source.sourcePath,
    refRole: role,
    lineStart: chunk?.lineStart ?? null,
    lineEnd: chunk?.lineEnd ?? null,
  };
}

function makeClaim({
  tenantScope,
  claimKind,
  subjectKey,
  predicateKey,
  objectText,
  source,
  chunk,
  confidence = 0.78,
  status = "EXTRACTED",
  truthStatus = "known_truth",
  metadata = {},
  agentAllowedUse,
  requiresHumanApproval,
  humanApprovalReason,
  owner,
}) {
  const normalizedSubject = normalizeKey(subjectKey);
  const normalizedPredicate = normalizeKey(predicateKey);
  const fingerprint = fullHash(`${tenantScope}|${claimKind}|${normalizedSubject}|${normalizedPredicate}|${normalizeKey(objectText, 240)}`);
  const approval = HUMAN_APPROVAL_PATTERNS.test(`${subjectKey} ${predicateKey} ${objectText}`);
  const needsApproval = requiresHumanApproval ?? approval;
  return {
    schema: "wiki-extracted-fact.v1",
    claimId: `claim_${stableHash(fingerprint, 20)}`,
    tenantScope,
    claimFingerprint: fingerprint,
    claimKind,
    status,
    truthStatus,
    confidence,
    subjectKey: normalizedSubject,
    predicateKey: normalizedPredicate,
    objectKey: normalizeKey(objectText, 120),
    objectText: objectText.trim(),
    qualifiers: {},
    owner: owner || (needsApproval ? "policy" : "platform"),
    authorityClass: source?.authorityClass || "repo",
    freshnessStatus: "fresh",
    operationalStatus: "active",
    agentAllowedUse: agentAllowedUse || (needsApproval ? "cite_only" : "planning_context"),
    requiresHumanApproval: needsApproval,
    humanApprovalReason: humanApprovalReason ?? (needsApproval ? "policy-or-customer-facing-claim" : null),
    sourceRefs: [makeSourceRef(source, chunk)],
    metadata,
  };
}

export function extractClaims(index, options = {}) {
  const tenantScope = options.tenantScope || index.tenantScope || "monsoonfire-main";
  const claims = [];
  const seen = new Set();

  function add(claim) {
    if (!claim || seen.has(claim.claimFingerprint)) return;
    seen.add(claim.claimFingerprint);
    claims.push(claim);
  }

  for (const source of index.sources) {
    const sourceChunks = findChunksForSource(index, source.sourcePath);

    if (source.sourcePath === "docs/SOURCE_OF_TRUTH_INDEX.md") {
      for (const chunk of sourceChunks) {
        for (const row of parseMarkdownRows(chunk.content)) {
          if (!row.Domain || !row["Authoritative Source"]) continue;
          add(makeClaim({
            tenantScope,
            claimKind: "fact",
            subjectKey: `source-of-truth:${row.Domain}`,
            predicateKey: "authoritative-source",
            objectText: `${row.Domain} is backed by ${row["Authoritative Source"]} and validated by ${row["Derived/Validated By"] || "unspecified validator"} with trust ${row.Trust || "unspecified"}.`,
            source,
            chunk,
            confidence: 0.9,
            metadata: { row },
          }));
        }
      }
      continue;
    }

    if (source.sourcePath === "AGENTS.md" || source.sourcePath.endsWith("/AGENTS.md")) {
      for (const chunk of sourceChunks) {
        const lines = chunk.content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i].trim().replace(/^[-*]\s+/, "");
          if (!/\b(must|never|prefer|required|do not|ground truth|approval required)\b/i.test(line)) continue;
          if (line.length < 18 || line.length > 260) continue;
          add(makeClaim({
            tenantScope,
            claimKind: "guardrail",
            subjectKey: `agents:${source.sourcePath}`,
            predicateKey: "instruction",
            objectText: line,
            source,
            chunk: { ...chunk, lineStart: chunk.lineStart + i, lineEnd: chunk.lineStart + i },
            confidence: 0.86,
          }));
        }
      }
      continue;
    }

    if (source.sourcePath === "package.json") {
      try {
        const pkg = JSON.parse(readFileSync(resolve(REPO_ROOT, source.sourcePath), "utf8"));
        const scripts = Object.entries(pkg.scripts || {})
          .filter(([name]) => /^(studio:ops|open-memory|wiki:|audit:|policy:|codex:)/.test(name))
          .slice(0, 160);
        const chunk = sourceChunks[0];
        for (const [name, command] of scripts) {
          add(makeClaim({
            tenantScope,
            claimKind: "procedure",
            subjectKey: `package-script:${name}`,
            predicateKey: "defines-command",
            objectText: `${name} runs ${command}`,
            source,
            chunk,
            confidence: 0.92,
          }));
        }
      } catch {
        // Ignore malformed package JSON in extraction; validation covers it elsewhere.
      }
      continue;
    }

    if (["firestore.rules", "storage.rules", "firestore.indexes.json", "firebase.json"].includes(source.sourcePath)) {
      const chunk = sourceChunks[0];
      add(makeClaim({
        tenantScope,
        claimKind: "fact",
        subjectKey: `repo-config:${source.sourcePath}`,
        predicateKey: "exists-as-source",
        objectText: `${source.sourcePath} is an indexed repository configuration source for Studio Brain wiki grounding.`,
        source,
        chunk,
        confidence: 0.88,
      }));
      continue;
    }

    if (source.sourcePath === SERVICE_PRICING_POLICY_PATH) {
      const chunk = sourceChunks[0];
      const approvalMetadata = {
        approvedBy: "human-owner",
        approvedAt: "2026-04-28",
        approvalScope: "agent operational context; website and portal edits remain paused during redesign",
      };
      add(makeClaim({
        tenantScope,
        claimKind: "policy",
        subjectKey: "monsoon-fire:membership-tiers",
        predicateKey: "operational-status",
        objectText: "Monsoon Fire has decommissioned all membership tiers and uses straight pricing for services only.",
        source,
        chunk,
        confidence: 0.96,
        status: "OPERATIONAL_TRUTH",
        truthStatus: "known_truth",
        agentAllowedUse: "operational_context",
        requiresHumanApproval: false,
        humanApprovalReason: null,
        owner: "policy",
        metadata: approvalMetadata,
      }));
      add(makeClaim({
        tenantScope,
        claimKind: "policy",
        subjectKey: "monsoon-fire:kiln-service-pricing",
        predicateKey: "billing-model",
        objectText: "Monsoon Fire kiln firing service pricing has three lanes: low fire, mid fire, and custom; each lane is priced by the half shelf. Volume pricing and cubic-inch pricing are not used.",
        source,
        chunk,
        confidence: 0.96,
        status: "OPERATIONAL_TRUTH",
        truthStatus: "known_truth",
        agentAllowedUse: "operational_context",
        requiresHumanApproval: false,
        humanApprovalReason: null,
        owner: "policy",
        metadata: approvalMetadata,
      }));
      continue;
    }

    if (source.sourcePath.startsWith("docs/policies/") && source.sourcePath.endsWith(".md")) {
      const chunk = sourceChunks[0];
      add(makeClaim({
        tenantScope,
        claimKind: "policy",
        subjectKey: `policy-doc:${source.sourcePath}`,
        predicateKey: "available",
        objectText: `${source.sourcePath} is an approved policy source and requires citation before customer-facing use.`,
        source,
        chunk,
        confidence: 0.82,
      }));
    }
  }

  claims.sort((a, b) => a.claimId.localeCompare(b.claimId));
  return {
    schema: "wiki-claim-extraction.v1",
    generatedAt: new Date().toISOString(),
    tenantScope,
    claims,
    summary: {
      claims: claims.length,
      requiresHumanApproval: claims.filter((claim) => claim.requiresHumanApproval).length,
    },
  };
}

function parseMarkdownRows(markdown) {
  const rows = [];
  const lines = String(markdown || "").split(/\r?\n/);
  let headers = [];
  for (const line of lines) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 2) continue;
    if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) continue;
    if (cells.some((cell) => /^Domain$/i.test(cell))) {
      headers = cells;
      continue;
    }
    if (headers.length && cells.length === headers.length) {
      const row = {};
      headers.forEach((header, index) => {
        row[header] = cells[index] || "";
      });
      rows.push(row);
    }
  }
  return rows;
}

export function detectContradictions(index, claims = []) {
  const corpus = index.chunks
    .filter((chunk) => !isContradictionScanExcluded(chunk.sourcePath))
    .map((chunk) => ({
      text: chunk.content,
      sourcePath: chunk.sourcePath,
      chunkId: chunk.chunkId,
      sourceId: chunk.sourceId,
      lineStart: chunk.lineStart,
      lineEnd: chunk.lineEnd,
    }));
  const findings = [];

  function find(regex) {
    return corpus.filter((entry) => regex.test(entry.text));
  }

  function addConflict(key, severity, aMatches, bMatches, action) {
    if (aMatches.length === 0 || bMatches.length === 0) return;
    const sourceRefs = [...aMatches.slice(0, 3), ...bMatches.slice(0, 3)].map((entry) => ({
      sourceId: entry.sourceId,
      chunkId: entry.chunkId,
      sourcePath: entry.sourcePath,
      lineStart: entry.lineStart,
      lineEnd: entry.lineEnd,
    }));
    const conflictFingerprint = fullHash(`${key}|${sourceRefs.map((ref) => `${ref.sourceId}:${ref.chunkId}`).join("|")}`);
    findings.push({
      schema: "wiki-contradiction.v1",
      contradictionId: `contradiction_${stableHash(conflictFingerprint, 20)}`,
      conflictFingerprint,
      conflictKey: key,
      severity,
      status: "open",
      claimAId: relatedClaimId(claims, key, aMatches),
      claimBId: relatedClaimId(claims, key, bMatches),
      sourceRefs,
      owner: severity === "hard" || severity === "critical" ? "policy" : "platform",
      recommendedAction: action,
      markdownPath: `wiki/50_contradictions/${normalizeKey(key, 80)}.md`,
      metadata: {
        aMatches: aMatches.length,
        bMatches: bMatches.length,
      },
    });
  }

  addConflict(
    "membership-required-vs-decommission",
    "hard",
    corpus.filter(isActiveMembershipModelEvidence),
    corpus.filter(isMembershipDecommissionEvidence),
    "Treat the service-pricing decommission decision as current operational truth and update or retire stale membership-tier/member-only sources before using them in customer-facing context.",
  );

  addConflict(
    "volume-pricing-vs-no-volume-billing",
    "hard",
    corpus.filter(isPositiveVolumePricingEvidence),
    corpus.filter((entry) => NO_VOLUME_PRICING_PATTERN.test(entry.text)),
    "Treat pricing/billing claims as human-gated and update the losing source after review.",
  );

  addConflict(
    "deprecated-active-context",
    "soft",
    find(/\bDEPRECATED\b|\bsuperseded\b/i).filter((entry) => entry.sourcePath.startsWith("wiki/70_agent_context_packs/")),
    find(/\bagent_allowed_use:\s*(planning_context|operational_context)\b/i),
    "Remove deprecated material from active context packs or move it to a warnings section.",
  );

  findings.sort((a, b) => a.contradictionId.localeCompare(b.contradictionId));
  return {
    schema: "wiki-contradiction-scan.v1",
    generatedAt: new Date().toISOString(),
    contradictions: findings,
    summary: {
      contradictions: findings.length,
      hard: findings.filter((entry) => entry.severity === "hard").length,
      critical: findings.filter((entry) => entry.severity === "critical").length,
    },
  };
}

function isContradictionScanExcluded(sourcePath) {
  if (CONTRADICTION_SCAN_EXCLUDED_PATHS.has(sourcePath)) return true;
  return /\.(test|spec)\.[cm]?[jt]sx?$/i.test(sourcePath) || sourcePath.includes("/__tests__/");
}

function isPositiveVolumePricingEvidence(entry) {
  if (!VOLUME_PRICING_PATTERN.test(entry.text)) return false;
  if (NO_VOLUME_PRICING_PATTERN.test(entry.text)) return false;
  if (GUARDRAIL_VOLUME_CONTEXT_PATTERN.test(entry.text)) return false;
  if (/^scripts\//.test(entry.sourcePath)) return false;
  return true;
}

function isActiveMembershipModelEvidence(entry) {
  if (!MEMBERSHIP_ACTIVE_MODEL_PATTERN.test(entry.text)) return false;
  if (entry.sourcePath === SERVICE_PRICING_POLICY_PATH) return false;
  if (entry.sourcePath.startsWith("wiki/40_decisions/")) return false;
  if (entry.sourcePath.startsWith("tickets/") && /membership-decommission/.test(entry.sourcePath)) return false;
  if (STALE_MEMBERSHIP_CONTEXT_PATTERN.test(entry.text)) return false;
  return true;
}

function isMembershipDecommissionEvidence(entry) {
  return MEMBERSHIP_DECOMMISSION_PATTERN.test(entry.text);
}

function relatedClaimId(claims, key, matches) {
  const sourcePaths = new Set(matches.map((match) => match.sourcePath));
  const tokens = key
    .split("-")
    .filter((token) => token.length > 3)
    .filter((token) => !["required", "decommission", "billing"].includes(token));
  const related = claims.filter((claim) => {
    const text = `${claim.subjectKey} ${claim.predicateKey} ${claim.objectText}`.toLowerCase();
    const sourceMatch = claim.sourceRefs?.some((ref) => sourcePaths.has(ref.sourcePath));
    return sourceMatch && tokens.some((token) => text.includes(token));
  });
  return related[0]?.claimId || null;
}

export function generateContextPack(claims, contradictions = [], options = {}) {
  const tenantScope = options.tenantScope || "monsoonfire-main";
  const verified = claims.filter((claim) =>
    (claim.status === "VERIFIED" || claim.status === "OPERATIONAL_TRUTH") &&
    (claim.agentAllowedUse === "planning_context" || claim.agentAllowedUse === "operational_context")
  );
  const warnings = [
    ...claims
      .filter((claim) => !["VERIFIED", "OPERATIONAL_TRUTH"].includes(claim.status))
      .slice(0, 10)
      .map((claim) => ({
        type: "unverified-claim-excluded",
        claimId: claim.claimId,
        status: claim.status,
        subjectKey: claim.subjectKey,
      })),
    ...contradictions
      .filter((entry) => entry.status === "open")
      .slice(0, 10)
      .map((entry) => ({
        type: "open-contradiction",
        contradictionId: entry.contradictionId,
        conflictKey: entry.conflictKey,
        severity: entry.severity,
      })),
  ];

  const snapshotHash = fullHash(JSON.stringify({
    tenantScope,
    verified: verified.map((claim) => ({
      claimId: claim.claimId,
      status: claim.status,
      subjectKey: claim.subjectKey,
      objectText: claim.objectText,
      sourceRefs: claim.sourceRefs,
    })),
    warnings,
  }));

  const lines = [];
  lines.push("# Studio Brain Wiki Context Pack");
  lines.push("");
  lines.push(`Snapshot: ${snapshotHash}`);
  lines.push("");
  lines.push("## Verified Operational Context");
  if (verified.length === 0) {
    lines.push("");
    lines.push("No VERIFIED or OPERATIONAL_TRUTH wiki claims are currently available. Agents must use repo/source reads for operational claims.");
  } else {
    for (const claim of verified.slice(0, 40)) {
      lines.push(`- ${claim.objectText} [${claim.claimId}]`);
    }
  }
  lines.push("");
  lines.push("## Warnings");
  if (warnings.length === 0) {
    lines.push("");
    lines.push("- No warnings.");
  } else {
    for (const warning of warnings) {
      lines.push(`- ${warning.type}: ${warning.conflictKey || warning.subjectKey || warning.claimId || warning.contradictionId}`);
    }
  }

  const generatedText = lines.join("\n");
  const contextPackId = `ctx_${stableHash(`${tenantScope}:studio-brain-wiki:${snapshotHash}`, 20)}`;
  return {
    schema: "wiki-context-pack.v1",
    contextPackId,
    tenantScope,
    packKey: "studio-brain-wiki",
    title: "Studio Brain Wiki",
    status: "active",
    generatedText,
    items: verified.map((claim, index) => ({
      itemId: claim.claimId,
      itemType: "claim",
      sortOrder: index,
      includedStatus: "included",
    })),
    warnings,
    snapshotHash,
    budget: {
      chars: generatedText.length,
      verifiedClaims: verified.length,
      warningCount: warnings.length,
    },
    exportHash: fullHash(generatedText),
    generatedAt: new Date().toISOString(),
  };
}

export function validateWikiScaffold() {
  const required = [
    "README.md",
    "00_source_index/source-map.md",
    "00_source_index/extracted-facts.jsonl",
    "10_operational_truth",
    "20_concepts",
    "30_workflows",
    "40_decisions",
    "50_contradictions",
    "60_deprecated",
    "70_agent_context_packs",
    "80_idle_tasks",
    "90_audits",
    "schemas/wiki-page.v1.schema.json",
    "schemas/source-index.v1.schema.json",
    "schemas/extracted-fact.v1.schema.json",
    "schemas/contradiction.v1.schema.json",
    "schemas/context-pack.v1.schema.json",
  ];
  const migrations = [
    "studio-brain/migrations/029_wiki_core.sql",
    "studio-brain/migrations/030_wiki_indexes.sql",
  ];
  const checks = [];
  for (const entry of required) {
    checks.push({
      id: `wiki:${entry}`,
      ok: existsSync(resolve(WIKI_ROOT, entry)),
      path: `wiki/${entry}`,
    });
  }
  for (const entry of migrations) {
    checks.push({
      id: `migration:${entry}`,
      ok: existsSync(resolve(REPO_ROOT, entry)),
      path: entry,
    });
  }

  for (const schema of required.filter((entry) => entry.startsWith("schemas/"))) {
    const path = resolve(WIKI_ROOT, schema);
    try {
      JSON.parse(readFileSync(path, "utf8"));
      checks.push({ id: `schema-parse:${schema}`, ok: true, path: `wiki/${schema}` });
    } catch (error) {
      checks.push({ id: `schema-parse:${schema}`, ok: false, path: `wiki/${schema}`, error: String(error) });
    }
  }

  const failed = checks.filter((check) => !check.ok);
  return {
    schema: "wiki-validation-report.v1",
    generatedAt: new Date().toISOString(),
    status: failed.length === 0 ? "pass" : "fail",
    checks,
    summary: {
      checks: checks.length,
      failed: failed.length,
    },
  };
}

export function buildDbProbeReport() {
  const queries = [
    {
      name: "context-pack-latest",
      sql: "SELECT context_pack_id, generated_text FROM wiki_context_pack WHERE tenant_scope = $1 AND pack_key = $2 AND status = 'active' ORDER BY generated_at DESC LIMIT 1",
      targetMs: 100,
    },
    {
      name: "verified-claim-search",
      sql: "SELECT claim_id, object_text FROM wiki_claim WHERE tenant_scope = $1 AND status IN ('VERIFIED','OPERATIONAL_TRUTH') AND subject_key = $2 ORDER BY updated_at DESC LIMIT 40",
      targetMs: 100,
    },
    {
      name: "open-contradictions",
      sql: "SELECT contradiction_id, conflict_key, severity FROM wiki_contradiction WHERE tenant_scope = $1 AND status IN ('open','in-review') ORDER BY severity DESC, updated_at DESC LIMIT 50",
      targetMs: 100,
    },
    {
      name: "ready-idle-tasks",
      sql: "SELECT task_id, title FROM wiki_idle_task WHERE tenant_scope = $1 AND status = 'ready' AND (next_run_at IS NULL OR next_run_at <= now()) ORDER BY priority DESC, next_run_at ASC LIMIT 20",
      targetMs: 100,
    },
    {
      name: "source-freshness",
      sql: "SELECT source_id, source_path, content_hash FROM wiki_source WHERE tenant_scope = $1 AND ingest_status IN ('indexed','unchanged') ORDER BY last_indexed_at DESC LIMIT 100",
      targetMs: 25,
    },
  ];
  return {
    schema: "wiki-db-probe.v1",
    generatedAt: new Date().toISOString(),
    status: "planned",
    queries,
    summary: {
      queryCount: queries.length,
      note: "Run with --apply-db in a configured Studio Brain environment to execute EXPLAIN probes.",
    },
  };
}

export function writeSourceMap(index, artifactPath) {
  const lines = [];
  lines.push("---");
  lines.push("schema: wiki-page.v1");
  lines.push("id: wiki:source-index:source-map");
  lines.push("title: Source Map");
  lines.push("kind: audit");
  lines.push("status: SYNTHESIZED");
  lines.push("confidence: 1");
  lines.push("owner: platform");
  lines.push("source_refs: []");
  lines.push("last_verified: null");
  lines.push("valid_until: null");
  lines.push("last_changed_by: script:wiki-postgres");
  lines.push("agent_allowed_use: planning_context");
  lines.push("supersedes: []");
  lines.push("superseded_by: []");
  lines.push("related_pages: []");
  lines.push(`export_hash: ${index.snapshotHash || fullHash(JSON.stringify(index.summary || {}))}`);
  lines.push("---");
  lines.push("");
  lines.push("# Source Map");
  lines.push("");
  lines.push(`Snapshot: ${index.snapshotHash || fullHash(JSON.stringify(index.summary || {}))}`);
  lines.push("");
  lines.push("| Source | Status | Authority | Chunks | Hash |");
  lines.push("|---|---:|---|---:|---|");
  for (const source of index.sources) {
    lines.push(`| \`${source.sourcePath}\` | ${source.ingestStatus} | ${source.authorityClass} | ${source.chunkCount} | \`${source.contentHash.slice(0, 12)}\` |`);
  }
  if (index.denied.length > 0) {
    lines.push("");
    lines.push("## Denied Sources");
    lines.push("");
    lines.push("| Source | Reason |");
    lines.push("|---|---|");
    for (const denied of index.denied) {
      lines.push(`| \`${denied.sourcePath}\` | ${denied.reason} |`);
    }
  }
  const path = artifactPath || resolve(WIKI_ROOT, "00_source_index", "source-map.md");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
  return path;
}

export function writeExtractedFacts(extraction, artifactPath) {
  const path = artifactPath || resolve(WIKI_ROOT, "00_source_index", "extracted-facts.jsonl");
  mkdirSync(dirname(path), { recursive: true });
  const body = extraction.claims.map((claim) => JSON.stringify(claim)).join("\n");
  writeFileSync(path, body ? `${body}\n` : "", "utf8");
  return path;
}

export function writeContextPack(pack, artifactPath) {
  const path = artifactPath || resolve(WIKI_ROOT, "70_agent_context_packs", "studio-brain-wiki.md");
  const frontmatter = [
    "---",
    "schema: wiki-page.v1",
    `id: wiki:context-pack:${pack.packKey}`,
    `title: ${pack.title}`,
    "kind: context_pack",
    "status: SYNTHESIZED",
    "confidence: 1",
    "owner: platform",
    "source_refs: []",
    "last_verified: null",
    "valid_until: null",
    "last_changed_by: script:wiki-postgres",
    "agent_allowed_use: planning_context",
    "supersedes: []",
    "superseded_by: []",
    "related_pages: []",
    `export_hash: ${pack.exportHash}`,
    "---",
    "",
  ].join("\n");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${frontmatter}${pack.generatedText}\n`, "utf8");
  return path;
}

export function writeContradictions(scan, artifactPath) {
  const paths = [];
  for (const contradiction of scan.contradictions) {
    const path = artifactPath && scan.contradictions.length === 1
      ? artifactPath
      : resolve(REPO_ROOT, contradiction.markdownPath || `wiki/50_contradictions/${normalizeKey(contradiction.conflictKey, 80)}.md`);
    mkdirSync(dirname(path), { recursive: true });
    const lines = [
      "---",
      "schema: wiki-page.v1",
      `id: wiki:contradiction:${contradiction.conflictKey}`,
      `title: ${contradiction.conflictKey}`,
      "kind: contradiction",
      "status: CONTRADICTORY",
      "confidence: 0.8",
      `owner: ${contradiction.owner}`,
      `source_refs: ${JSON.stringify(contradiction.sourceRefs.map((ref) => `${ref.sourcePath}#L${ref.lineStart || 1}`))}`,
      "last_verified: null",
      "valid_until: null",
      "last_changed_by: script:wiki-postgres",
      "agent_allowed_use: cite_only",
      "supersedes: []",
      "superseded_by: []",
      "related_pages: []",
      `export_hash: ${fullHash(JSON.stringify(contradiction))}`,
      "---",
      "",
      `# ${contradiction.conflictKey}`,
      "",
      `Severity: ${contradiction.severity}`,
      "",
      `Recommended action: ${contradiction.recommendedAction}`,
      "",
      "## Source References",
      "",
      ...contradiction.sourceRefs.map((ref) => `- \`${ref.sourcePath}\` lines ${ref.lineStart || "?"}-${ref.lineEnd || "?"}`),
    ];
    writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
    paths.push(path);
  }
  return paths;
}

export function readExtractedFacts(path = resolve(WIKI_ROOT, "00_source_index", "extracted-facts.jsonl")) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function makePgRequire() {
  return createRequire(resolve(STUDIO_BRAIN_ROOT, "package.json"));
}

async function createDbClient() {
  const requireFromStudioBrain = makePgRequire();
  try {
    const dotenv = requireFromStudioBrain("dotenv");
    dotenv.config({ path: resolve(STUDIO_BRAIN_ROOT, ".env.local"), quiet: true });
  } catch {
    // dotenv is best-effort for local scripts.
  }
  const { Client } = requireFromStudioBrain("pg");
  const client = new Client({
    host: process.env.PGHOST || "127.0.0.1",
    port: Number(process.env.PGPORT || 5433),
    database: process.env.PGDATABASE || "monsoonfire_studio_os",
    user: process.env.PGUSER || "postgres",
    password: process.env.PGPASSWORD || undefined,
    application_name: "wiki-postgres-script",
    statement_timeout: Number(process.env.STUDIO_BRAIN_PG_STATEMENT_TIMEOUT_MS || 18000),
    query_timeout: Number(process.env.STUDIO_BRAIN_PG_QUERY_TIMEOUT_MS || 20000),
  });
  await client.connect();
  return client;
}

export async function applySourceIndexToDb(index) {
  const client = await createDbClient();
  const result = { sourcesInserted: 0, sourcesUnchanged: 0, chunksInserted: 0, errors: [] };
  try {
    for (const source of index.sources) {
      await client.query("BEGIN");
      try {
        const existing = await client.query("SELECT content_hash FROM wiki_source WHERE source_id = $1", [source.sourceId]);
        const unchanged = existing.rows[0]?.content_hash === source.contentHash;
        await client.query(
          `
          INSERT INTO wiki_source (
            source_id, tenant_scope, source_kind, source_path, source_uri, title,
            authority_class, content_hash, git_sha, freshness_status, ingest_status,
            deny_reason, last_indexed_at, metadata, updated_at
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now(),$13::jsonb,now()
          )
          ON CONFLICT (source_id) DO UPDATE SET
            content_hash = EXCLUDED.content_hash,
            freshness_status = EXCLUDED.freshness_status,
            ingest_status = EXCLUDED.ingest_status,
            deny_reason = EXCLUDED.deny_reason,
            last_indexed_at = now(),
            metadata = EXCLUDED.metadata,
            updated_at = now()
          `,
          [
            source.sourceId,
            source.tenantScope,
            source.sourceKind,
            source.sourcePath,
            source.sourceUri,
            source.title,
            source.authorityClass,
            source.contentHash,
            source.gitSha,
            source.freshnessStatus,
            unchanged ? "unchanged" : source.ingestStatus,
            source.denyReason,
            JSON.stringify(source.metadata || {}),
          ],
        );
        if (unchanged) {
          result.sourcesUnchanged += 1;
        } else {
          result.sourcesInserted += 1;
          await client.query("DELETE FROM wiki_source_chunk WHERE source_id = $1", [source.sourceId]);
          const sourceChunks = index.chunks.filter((chunk) => chunk.sourceId === source.sourceId);
          for (const chunk of sourceChunks) {
            await client.query(
              `
              INSERT INTO wiki_source_chunk (
                chunk_id, source_id, tenant_scope, chunk_index, line_start, line_end,
                heading_path, content_hash, content, metadata, updated_at
              ) VALUES (
                $1,$2,$3,$4,$5,$6,$7::text[],$8,$9,$10::jsonb,now()
              )
              ON CONFLICT (chunk_id) DO UPDATE SET
                line_start = EXCLUDED.line_start,
                line_end = EXCLUDED.line_end,
                heading_path = EXCLUDED.heading_path,
                content_hash = EXCLUDED.content_hash,
                content = EXCLUDED.content,
                metadata = EXCLUDED.metadata,
                updated_at = now()
              )
              `,
              [
                chunk.chunkId,
                chunk.sourceId,
                chunk.tenantScope,
                chunk.chunkIndex,
                chunk.lineStart,
                chunk.lineEnd,
                chunk.headingPath,
                chunk.contentHash,
                chunk.content,
                JSON.stringify(chunk.metadata || {}),
              ],
            );
            result.chunksInserted += 1;
          }
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        result.errors.push({ sourceId: source.sourceId, error: error instanceof Error ? error.message : String(error) });
      }
    }
  } finally {
    await client.end();
  }
  return result;
}

export async function applyClaimsToDb(extraction) {
  const client = await createDbClient();
  const result = { claimsUpserted: 0, refsUpserted: 0, errors: [] };
  try {
    for (const claim of extraction.claims) {
      await client.query("BEGIN");
      try {
        const existing = await client.query("SELECT status, truth_status FROM wiki_claim WHERE claim_id = $1", [claim.claimId]);
        await client.query(
          `
          INSERT INTO wiki_claim (
            claim_id, tenant_scope, claim_fingerprint, claim_kind, status, truth_status,
            confidence, subject_key, predicate_key, object_key, object_text, qualifiers,
            owner, authority_class, freshness_status, operational_status, agent_allowed_use,
            requires_human_approval, human_approval_reason, metadata, updated_at
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,now()
          )
          ON CONFLICT (claim_id) DO UPDATE SET
            status = EXCLUDED.status,
            truth_status = EXCLUDED.truth_status,
            confidence = EXCLUDED.confidence,
            object_text = EXCLUDED.object_text,
            metadata = EXCLUDED.metadata,
            updated_at = now()
          `,
          [
            claim.claimId,
            claim.tenantScope,
            claim.claimFingerprint,
            claim.claimKind,
            claim.status,
            claim.truthStatus,
            claim.confidence,
            claim.subjectKey,
            claim.predicateKey,
            claim.objectKey,
            claim.objectText,
            JSON.stringify(claim.qualifiers || {}),
            claim.owner,
            claim.authorityClass,
            claim.freshnessStatus,
            claim.operationalStatus,
            claim.agentAllowedUse,
            claim.requiresHumanApproval,
            claim.humanApprovalReason,
            JSON.stringify(claim.metadata || {}),
          ],
        );
        if (existing.rows[0] && (existing.rows[0].status !== claim.status || existing.rows[0].truth_status !== claim.truthStatus)) {
          await client.query(
            `
            INSERT INTO wiki_claim_revision (
              revision_id, claim_id, tenant_scope, from_status, to_status,
              from_truth_status, to_truth_status, actor, reason, source_refs, metadata
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb)
            `,
            [
              `rev_${randomUUID()}`,
              claim.claimId,
              claim.tenantScope,
              existing.rows[0].status,
              claim.status,
              existing.rows[0].truth_status,
              claim.truthStatus,
              "script:wiki-postgres",
              "deterministic-extract",
              JSON.stringify(claim.sourceRefs || []),
              "{}",
            ],
          );
        }
        for (const ref of claim.sourceRefs || []) {
          const refId = `ref_${stableHash(`${claim.claimId}:${ref.sourceId}:${ref.chunkId}:${ref.refRole}`, 20)}`;
          await client.query(
            `
            INSERT INTO wiki_claim_source_ref (
              ref_id, tenant_scope, claim_id, source_id, chunk_id, ref_role, ref_label,
              line_start, line_end, metadata
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
            ON CONFLICT (claim_id, source_id, chunk_id, ref_role) DO UPDATE SET
              line_start = EXCLUDED.line_start,
              line_end = EXCLUDED.line_end,
              metadata = EXCLUDED.metadata
            `,
            [
              refId,
              claim.tenantScope,
              claim.claimId,
              ref.sourceId,
              ref.chunkId,
              ref.refRole || "supports",
              ref.sourcePath,
              ref.lineStart,
              ref.lineEnd,
              JSON.stringify(ref),
            ],
          );
          result.refsUpserted += 1;
        }
        await client.query("COMMIT");
        result.claimsUpserted += 1;
      } catch (error) {
        await client.query("ROLLBACK");
        result.errors.push({ claimId: claim.claimId, error: error instanceof Error ? error.message : String(error) });
      }
    }
  } finally {
    await client.end();
  }
  return result;
}

export async function applyContradictionsToDb(scan, tenantScope = "monsoonfire-main") {
  const client = await createDbClient();
  const result = { contradictionsUpserted: 0, errors: [] };
  try {
    for (const contradiction of scan.contradictions) {
      try {
        await client.query(
          `
          INSERT INTO wiki_contradiction (
            contradiction_id, tenant_scope, conflict_fingerprint, conflict_key, severity, status,
            claim_a_id, claim_b_id, source_refs, owner, recommended_action, markdown_path,
            metadata, updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13::jsonb,now())
          ON CONFLICT (contradiction_id) DO UPDATE SET
            severity = EXCLUDED.severity,
            status = EXCLUDED.status,
            source_refs = EXCLUDED.source_refs,
            recommended_action = EXCLUDED.recommended_action,
            metadata = EXCLUDED.metadata,
            updated_at = now()
          `,
          [
            contradiction.contradictionId,
            tenantScope,
            contradiction.conflictFingerprint,
            contradiction.conflictKey,
            contradiction.severity,
            contradiction.status,
            contradiction.claimAId,
            contradiction.claimBId,
            JSON.stringify(contradiction.sourceRefs || []),
            contradiction.owner,
            contradiction.recommendedAction,
            contradiction.markdownPath,
            JSON.stringify(contradiction.metadata || {}),
          ],
        );
        result.contradictionsUpserted += 1;
      } catch (error) {
        result.errors.push({ contradictionId: contradiction.contradictionId, error: error instanceof Error ? error.message : String(error) });
      }
    }
  } finally {
    await client.end();
  }
  return result;
}

export async function applyContextPackToDb(pack) {
  const client = await createDbClient();
  const result = { contextPacksUpserted: 0, itemsUpserted: 0 };
  try {
    await client.query("BEGIN");
    await client.query(
      `
      INSERT INTO wiki_context_pack (
        context_pack_id, tenant_scope, pack_key, title, status, generated_text,
        budget, warnings, export_hash, generated_at, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10::timestamptz,$11::jsonb)
      ON CONFLICT (context_pack_id) DO UPDATE SET
        status = EXCLUDED.status,
        generated_text = EXCLUDED.generated_text,
        budget = EXCLUDED.budget,
        warnings = EXCLUDED.warnings,
        export_hash = EXCLUDED.export_hash,
        metadata = EXCLUDED.metadata
      `,
      [
        pack.contextPackId,
        pack.tenantScope,
        pack.packKey,
        pack.title,
        pack.status,
        pack.generatedText,
        JSON.stringify(pack.budget || {}),
        JSON.stringify(pack.warnings || []),
        pack.exportHash,
        pack.generatedAt,
        "{}",
      ],
    );
    for (const item of pack.items || []) {
      await client.query(
        `
        INSERT INTO wiki_context_pack_item (
          context_pack_id, tenant_scope, item_id, item_type, sort_order, included_status, metadata
        ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
        ON CONFLICT (context_pack_id, item_id, item_type) DO UPDATE SET
          sort_order = EXCLUDED.sort_order,
          included_status = EXCLUDED.included_status,
          metadata = EXCLUDED.metadata
        `,
        [
          pack.contextPackId,
          pack.tenantScope,
          item.itemId,
          item.itemType,
          item.sortOrder,
          item.includedStatus,
          JSON.stringify(item.metadata || {}),
        ],
      );
      result.itemsUpserted += 1;
    }
    await client.query("COMMIT");
    result.contextPacksUpserted = 1;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
  return result;
}

export async function runDbExplainProbe(report, tenantScope = "monsoonfire-main") {
  const client = await createDbClient();
  const results = [];
  try {
    for (const query of report.queries) {
      const values =
        query.name === "context-pack-latest" ? [tenantScope, "studio-brain-wiki"]
        : query.name === "verified-claim-search" ? [tenantScope, "source-of-truth"]
        : [tenantScope];
      const started = Date.now();
      try {
        const explain = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query.sql}`, values);
        const payload = explain.rows[0]?.["QUERY PLAN"]?.[0] || explain.rows[0]?.["QUERY PLAN"] || null;
        const executionTimeMs = Number(payload?.["Execution Time"] || 0);
        results.push({
          name: query.name,
          ok: true,
          executionTimeMs,
          elapsedMs: Date.now() - started,
          targetMs: query.targetMs,
          status: executionTimeMs <= query.targetMs ? "pass" : "warn",
        });
      } catch (error) {
        results.push({
          name: query.name,
          ok: false,
          elapsedMs: Date.now() - started,
          targetMs: query.targetMs,
          error: error instanceof Error ? error.message : String(error),
          status: "failed",
        });
      }
    }
  } finally {
    await client.end();
  }
  return {
    ...report,
    status: results.some((row) => row.status === "failed") ? "fail" : results.some((row) => row.status === "warn") ? "warn" : "pass",
    results,
    summary: {
      ...report.summary,
      executed: results.length,
      failed: results.filter((row) => row.status === "failed").length,
      warnings: results.filter((row) => row.status === "warn").length,
    },
  };
}

export function writeJsonArtifact(report, artifactPath) {
  if (!artifactPath) return "";
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return artifactPath;
}
