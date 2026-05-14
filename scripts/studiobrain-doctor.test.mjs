import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDoctorSummary,
  buildStatusArgs,
  parseDoctorArgs,
  renderMarkdown,
} from "./studiobrain-doctor.mjs";

test("buildStatusArgs uses the host-authoritative safe doctor path by default", () => {
  const args = parseDoctorArgs(["--json"]);
  assert.deepEqual(buildStatusArgs(args), [
    "./scripts/studiobrain-status.mjs",
    "--json",
    "--mode",
    "live_host_authoritative",
    "--gate",
    "--require-safe",
    "--approved-remote-runner",
    "--artifact",
    "output/studio-brain/audits/studio-status-latest.json",
  ]);
});

test("buildDoctorSummary preserves backup freshness blockers for agent consumption", () => {
  const summary = buildDoctorSummary(
    {
      status: "fail",
      environment: { mode: "live_host_authoritative" },
      posture: { safeToRunHighRisk: false },
      checks: [
        {
          name: "Gate C backup freshness",
          category: "backup",
          severity: "error",
          ok: false,
          status: "fail",
          message: "Backup freshness gate failed",
          details: {
            freshness: {
              summary: "stale verified backups",
              services: {
                postgres: {
                  status: "stale",
                  message: "10435m > 1440m",
                  ageMinutes: 10435,
                },
              },
            },
          },
        },
      ],
      endpoints: [
        {
          name: "healthz",
          category: "liveness",
          ok: true,
          status: "pass",
          latencyMs: 17,
          message: "ok",
        },
      ],
      backupFreshness: {
        status: "fail",
        message: "Backup freshness gate failed",
      },
    },
    { rawArtifact: "output/studio-brain/audits/studio-status-latest.json" },
  );

  assert.equal(summary.schema, "studio-brain-doctor.v1");
  assert.equal(summary.status, "fail");
  assert.equal(summary.posture.safeToRunHighRisk, false);
  assert.equal(summary.posture.blockers.length, 1);
  assert.equal(summary.posture.blockers[0].details.services.postgres.ageMinutes, 10435);
  assert.match(summary.recommendedNextActions[0], /backup evidence|restore-confidence/);
  assert.equal(summary.exitPolicy.expectedExitCode, 1);
});

test("buildDoctorSummary gives an explicit authority action for fallback env failures", () => {
  const summary = buildDoctorSummary({
    status: "fail",
    environment: { mode: "live_host_authoritative" },
    posture: { safeToRunHighRisk: false },
    checks: [
      {
        name: "Gate A authoritative mode",
        category: "gate-a",
        severity: "error",
        ok: false,
        status: "fail",
        message: ".env.example fallback cannot clear or fail a live deploy",
      },
    ],
    endpoints: [],
  });

  assert.match(summary.recommendedNextActions[0], /Studio Brain host|real Studio Brain env file/);
});

test("renderMarkdown gives a terse human artifact", () => {
  const markdown = renderMarkdown({
    status: "pass",
    source: { mode: "live_host_authoritative", rawArtifact: "raw.json" },
    posture: {
      safeToRunHighRisk: true,
      blockers: [],
      warnings: [],
    },
    endpoints: [{ name: "healthz", status: "pass", latencyMs: 12 }],
    recommendedNextActions: ["Doctor gate is green for normal guarded operations."],
  });

  assert.match(markdown, /# Studio Brain Doctor/);
  assert.match(markdown, /Status: pass/);
  assert.match(markdown, /Doctor gate is green/);
});
