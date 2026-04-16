import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

import { parseArgs, runConsolidation } from "./open-memory-consolidate.mjs";

const ARTIFACT_PATH = resolve("D:/monsoonfire-portal/output/studio-brain/memory-consolidation/latest.json");

test("parseArgs accepts HTTP timeout and repeated focus areas", () => {
  const options = parseArgs([
    "--mode",
    "overnight",
    "--focus-area",
    "memory drift",
    "--focus-area",
    "goal lock",
    "--timeout-ms",
    "90000",
    "--json",
  ]);

  assert.equal(options.mode, "overnight");
  assert.deepEqual(options.focusAreas, ["memory drift", "goal lock"]);
  assert.equal(options.timeoutMs, 90000);
  assert.equal(options.asJson, true);
});

test("runConsolidation calls the Studio Brain HTTP endpoint and writes the artifact", async () => {
  rmSync(ARTIFACT_PATH, { force: true });

  const requests = [];
  const server = createServer(async (req, res) => {
    if ((req.url || "") === "/api/memory/consolidate" && req.method === "POST") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      requests.push({
        authorization: req.headers.authorization || "",
        adminToken: req.headers["x-studio-brain-admin-token"] || "",
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          result: {
            status: "success",
            summary: "Host-side consolidation finished cleanly.",
            actionabilityStatus: "passed",
          },
        }),
      );
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, message: "Not found" }));
  });

  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  try {
    const result = await runConsolidation(
      {
        mode: "overnight",
        runId: "memory-run-123",
        tenantId: "monsoonfire-main",
        maxCandidates: 40,
        maxWrites: 10,
        timeBudgetMs: 60000,
        timeoutMs: 5000,
        focusAreas: ["memory drift"],
        asJson: true,
      },
      {
        env: {
          ...process.env,
          STUDIO_BRAIN_BASE_URL: `http://127.0.0.1:${port}`,
          STUDIO_BRAIN_MCP_BASE_URL: `http://127.0.0.1:${port}`,
          STUDIO_BRAIN_MCP_ADMIN_TOKEN: "test-admin-token",
        },
      },
    );

    assert.equal(result.transport, "http");
    assert.equal(result.status, "success");
    assert.equal(result.actionabilityStatus, "passed");
    assert.equal(requests.length, 1);
    assert.match(String(requests[0]?.authorization || ""), /^Bearer\s+\S+/);
    assert.equal(requests[0]?.adminToken, "test-admin-token");
    assert.equal(requests[0]?.body?.requestOrigin, "scripts/open-memory-consolidate.mjs");
    assert.equal(requests[0]?.body?.mode, "overnight");
    assert.equal(existsSync(ARTIFACT_PATH), true);
    const artifact = JSON.parse(readFileSync(ARTIFACT_PATH, "utf8"));
    assert.equal(artifact.transport, "http");
    assert.equal(artifact.summary, "Host-side consolidation finished cleanly.");
  } finally {
    await new Promise((resolvePromise, reject) => {
      server.close((error) => (error ? reject(error) : resolvePromise()));
    });
    rmSync(ARTIFACT_PATH, { force: true });
  }
});
