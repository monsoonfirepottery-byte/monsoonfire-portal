import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  recordWikiOutcome,
  summarizeWikiOutcomes,
} from "./wiki-outcome-record.mjs";

function tempRoot(name) {
  return mkdtempSync(join(tmpdir(), name));
}

function readJsonl(path) {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test("wiki outcome recorder appends first-class harness outcome records", () => {
  const root = tempRoot("wiki-outcome-record-");
  const outcomesPath = join(root, "outcomes.jsonl");
  try {
    const report = recordWikiOutcome({
      outcomesPath,
      artifactPath: join(root, "report.json"),
      packetId: "wiki-context-pack-startup-use",
      title: "Wiki context pack shortened startup triage",
      outcome: "helpful",
      minutesSaved: 12,
      usedBy: "unit-test",
      notes: "Wiki context pack pointed directly at the verified membership decommission truth.",
    }, {
      now: () => "2026-05-04T12:00:00.000Z",
    });

    assert.equal(report.schema, "wiki-outcome-record-report.v1");
    assert.equal(report.status, "pass");
    assert.equal(report.summary.total, 1);
    assert.equal(report.summary.verdict, "insufficient_real_usage");
    const rows = readJsonl(outcomesPath);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].schema, "studiobrain-agent-harness-outcome.v1");
    assert.equal(rows[0].title, "Wiki context pack shortened startup triage");
    assert.equal(rows[0].source, "wiki-outcome-recorder");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("wiki outcome recorder rejects non-wiki usage records", () => {
  const root = tempRoot("wiki-outcome-reject-");
  const outcomesPath = join(root, "outcomes.jsonl");
  try {
    assert.throws(() => recordWikiOutcome({
      outcomesPath,
      artifactPath: "",
      packetId: "generic-harness-result",
      title: "Generic harness result",
      outcome: "helpful",
      notes: "Saved time during an unrelated task.",
    }), /must mention wiki, context pack, contradiction, or source drift/);
    assert.equal(existsSync(outcomesPath), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("wiki outcome summary turns useful after three helpful wiki outcomes", () => {
  const root = tempRoot("wiki-outcome-useful-");
  const outcomesPath = join(root, "outcomes.jsonl");
  try {
    for (const [index, title] of [
      "Wiki context pack found verified decommission truth",
      "Wiki contradiction queue prevented stale customer policy edit",
      "Source drift warning routed a stale membership claim",
    ].entries()) {
      recordWikiOutcome({
        outcomesPath,
        artifactPath: "",
        packetId: `wiki-outcome-unit-${index}`,
        title,
        outcome: "helpful",
        minutesSaved: 5,
        notes: "Wiki evidence was used by the unit test ledger.",
      }, {
        now: () => `2026-05-04T12:0${index}:00.000Z`,
      });
    }

    const report = summarizeWikiOutcomes({
      outcomesPath,
      artifactPath: join(root, "summary.json"),
    });

    assert.equal(report.summary.total, 3);
    assert.equal(report.summary.helpful, 3);
    assert.equal(report.summary.totalMinutesSaved, 15);
    assert.equal(report.summary.verdict, "useful");
    assert.equal(report.status, "pass");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
