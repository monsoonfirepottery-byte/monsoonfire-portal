import test from "node:test";
import assert from "node:assert/strict";
import { inspectPortalRules } from "./firestore-rules-release.mjs";

const projectId = "example-project";
const config = { firestore: { database: "(default)", rules: "firestore.rules" } };
const rulesSource = "rules_version = '2';\n";
const rulesetName = `projects/${projectId}/rulesets/abc-123`;

test("reads only canonical portal release and compares actual deployed rules source", async () => {
  const paths = [];
  const request = async (path) => {
    paths.push(path);
    return path.endsWith("/releases/cloud.firestore")
      ? { ok: true, json: { rulesetName } }
      : { ok: true, json: { source: { files: [{ content: rulesSource.replace(/\n/g, "\r\n") }] } } };
  };
  const result = await inspectPortalRules({ projectId, config, rulesSource, request });
  assert.equal(result.status, "in_sync");
  assert.deepEqual(paths, [`projects/${projectId}/releases/cloud.firestore`, rulesetName]);
  assert.ok(paths.every((path) => !path.includes("cloud.firestore/default")));
});

test("reports source drift without treating the named default database as an alias", async () => {
  const request = async (path) => path.endsWith("/releases/cloud.firestore")
    ? { ok: true, json: { rulesetName } }
    : { ok: true, json: { source: { files: [{ content: "different" }] } } };
  const result = await inspectPortalRules({ projectId, config, rulesSource, request });
  assert.equal(result.status, "drift_detected");
  assert.notEqual(result.localSha256, result.deployedSha256);
});

test("rejects a named database target without calling the Rules API", async () => {
  let calls = 0;
  const result = await inspectPortalRules({ projectId, config: { firestore: { database: "default", rules: "firestore.rules" } }, rulesSource, request: async () => { calls++; } });
  assert.equal(result.status, "error");
  assert.equal(calls, 0);
});

test("fails closed for permission errors, missing source, and cross-project references", async () => {
  for (const response of [
    { ok: false, status: 403 },
    { ok: true, json: { rulesetName: "projects/another/rulesets/abc" } },
  ]) {
    const result = await inspectPortalRules({ projectId, config, rulesSource, request: async () => response });
    assert.notEqual(result.status, "in_sync");
  }
  const result = await inspectPortalRules({ projectId, config, rulesSource, request: async (path) => path.endsWith("cloud.firestore") ? { ok: true, json: { rulesetName } } : { ok: true, json: {} } });
  assert.equal(result.status, "error");
});
