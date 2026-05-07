import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildHostDriftManifest, classifyPath, parsePorcelainLine, renderMarkdown } from "./host_drift_manifest.mjs";
import { validateJsonSchema } from "./validate_ops_artifacts.mjs";

const allowlist = {
  status: "present",
  path: "studio-brain/host-drift-allowlist.json",
  generatedAt: "2026-05-07T00:00:00.000Z",
  entries: [
    {
      path: "src/autonomic",
      owner: "platform-primary",
      reason: "temporary host-only runtime",
      expiresAt: "2026-06-30T00:00:00.000Z",
      expired: false,
    },
    {
      path: "lib/expired",
      owner: "platform-primary",
      reason: "old host-only runtime",
      expiresAt: "2026-01-01T00:00:00.000Z",
      expired: true,
    },
  ],
  errors: [],
};

test("parsePorcelainLine keeps status and redacted path metadata only", () => {
  assert.deepEqual(parsePorcelainLine(" M scripts/ops/example.sh"), {
    status: "M",
    path: "scripts/ops/example.sh",
    rawStatus: " M",
  });
  assert.deepEqual(parsePorcelainLine("R  old/path.js -> src/new/path.js"), {
    status: "R",
    path: "src/new/path.js",
    rawStatus: "R ",
  });
});

test("classifyPath separates generated, source, sensitive, and unknown path names", () => {
  assert.equal(classifyPath("output/ops/report.json"), "generated_or_artifact");
  assert.equal(classifyPath("scripts/ops/example.sh"), "source_or_config");
  assert.equal(classifyPath(".env.production"), "sensitive_path_name");
  assert.equal(classifyPath("manual-drops/blob"), "unknown");
});

test("buildHostDriftManifest classifies paths against active and expired allowlist entries", () => {
  const report = buildHostDriftManifest({
    allowlist,
    statusRead: { source: "fixtures/status.txt", readStatus: "present", error: "" },
    gitMetadata: { branch: "codex/live-drift", head: "abc1234", upstream: "origin/gone", upstreamStatus: "gone_or_not_fetched" },
    statusLines: [
      "?? src/autonomic/loop.ts",
      " M lib/expired/driver.js",
      "?? output/ops/report.json",
      "?? .env.local",
      "?? manual-drops/blob",
    ],
  }, {
    generatedAt: "2026-05-07T12:00:00.000Z",
    runId: "host-drift-test",
    repo: "/home/wuff/monsoonfire-portal",
    maxEntries: 10,
  });

  assert.equal(report.status, "warn");
  assert.equal(report.readOnly, true);
  assert.equal(report.safety.readsFileContents, false);
  assert.equal(report.safety.sensitivePathNamesRedacted, true);
  assert.equal(report.summary.dirtyPaths, 5);
  assert.equal(report.summary.allowlistCounts.active, 1);
  assert.equal(report.summary.allowlistCounts.expired, 1);
  assert.equal(report.summary.classificationCounts.sensitive_path_name, 1);
  assert.equal(report.summary.approvalCounts.safe_with_backup, 1);
  assert.equal(report.entries[0].allowlist.status, "active");
  assert.equal(report.entries[1].allowlist.status, "expired");
  assert.deepEqual(
    report.entries.find((entry) => entry.pathClass === "sensitive_path_name"),
    {
      status: "??",
      pathClass: "sensitive_path_name",
      approval: "do_not_touch_security_review",
      path: "[redacted-sensitive-path-name]",
      pathRedacted: true,
      allowlist: { status: "unmatched", path: "", owner: "", reason: "", expiresAt: "", expired: false },
    },
  );

  const markdown = renderMarkdown(report);
  assert.match(markdown, /Host Drift Manifest/);
  assert.match(markdown, /allowlisted_review_before_cleanup/);
  assert.match(markdown, /do_not_touch_security_review/);
});

test("buildHostDriftManifest can reveal sensitive-looking path names only when explicitly requested", () => {
  const report = buildHostDriftManifest({
    allowlist,
    statusRead: { source: "fixtures/status.txt", readStatus: "present", error: "" },
    statusLines: ["?? .env.local"],
  }, {
    generatedAt: "2026-05-07T12:00:00.000Z",
    runId: "host-drift-sensitive-visible",
    showSensitivePaths: true,
  });

  assert.equal(report.safety.sensitivePathNamesRedacted, false);
  assert.equal(report.entries[0].path, ".env.local");
  assert.equal(report.entries[0].pathRedacted, false);
});

test("buildHostDriftManifest truncates path rows without losing total counts", () => {
  const report = buildHostDriftManifest({
    allowlist,
    statusRead: { source: "fixtures/status.txt", readStatus: "present", error: "" },
    statusLines: ["?? a.js", "?? b.js", "?? c.js"],
  }, {
    generatedAt: "2026-05-07T12:00:00.000Z",
    runId: "host-drift-truncated",
    maxEntries: 2,
  });

  assert.equal(report.summary.dirtyPaths, 3);
  assert.equal(report.summary.entriesKept, 2);
  assert.equal(report.summary.truncated, true);
});

test("buildHostDriftManifest stays compatible with its JSON schema", () => {
  const report = buildHostDriftManifest({
    allowlist,
    statusRead: { source: "fixtures/status.txt", readStatus: "present", error: "" },
    statusLines: ["?? src/autonomic/loop.ts"],
  }, {
    generatedAt: "2026-05-07T12:00:00.000Z",
    runId: "host-drift-schema",
    repo: "/home/wuff/monsoonfire-portal",
  });
  const schema = JSON.parse(readFileSync("schemas/ops/host-drift-manifest.v1.schema.json", "utf8"));

  assert.deepEqual(validateJsonSchema(report, schema), []);
});
