import test from "node:test";
import assert from "node:assert/strict";

import { buildManifest, renderMarkdown } from "./ops_command_manifest.mjs";

test("buildManifest catalogs the current ops command surface", () => {
  const manifest = buildManifest();

  assert.equal(manifest.schema, "studio-brain-ops-command-manifest.v1");
  assert.equal(manifest.status, "ok");
  assert.ok(manifest.summary.makeTargets >= 50);
  assert.ok(manifest.summary.npmOpsScripts >= 15);
  assert.ok(manifest.commands.some((command) => command.name === "ops-command-manifest"));
  assert.ok(manifest.commands.some((command) => command.approvalClass === "human_approval_required"));
});

test("renderMarkdown includes safety and command catalog sections", () => {
  const markdown = renderMarkdown(buildManifest());

  assert.match(markdown, /^# Ops Command Manifest/m);
  assert.match(markdown, /## Commands/);
  assert.match(markdown, /Approval-gated commands are cataloged/);
});
