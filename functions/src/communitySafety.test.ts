import test from "node:test";
import assert from "node:assert/strict";

import type { CommunitySafetyConfig } from "./communitySafety";
import { evaluateCommunityContentRisk } from "./communitySafety";

function makeConfig(overrides: Partial<CommunitySafetyConfig> = {}): CommunitySafetyConfig {
  return {
    enabled: true,
    publishKillSwitch: false,
    autoFlagEnabled: true,
    highSeverityThreshold: 70,
    mediumSeverityThreshold: 35,
    blockedTerms: ["counterfeit", "doxx"],
    blockedUrlHosts: ["bit.ly"],
    updatedAtMs: 0,
    updatedBy: null,
    ...overrides,
  };
}

test("evaluateCommunityContentRisk returns no findings when safety is disabled", () => {
  const result = evaluateCommunityContentRisk(
    {
      textFields: [{ field: "title", text: "counterfeit listing with https://bit.ly/demo" }],
    },
    makeConfig({ enabled: false })
  );

  assert.equal(result.score, 0);
  assert.equal(result.severity, "low");
  assert.equal(result.flagged, false);
  assert.equal(result.triggers.length, 0);
});

test("evaluateCommunityContentRisk detects blocked terms, blocked hosts, and high-risk phrases", () => {
  const result = evaluateCommunityContentRisk(
    {
      textFields: [
        {
          field: "summary",
          text: "This counterfeit batch says attack mode and links https://bit.ly/sample",
        },
      ],
    },
    makeConfig()
  );

  assert.equal(result.flagged, true);
  assert.equal(result.severity, "high");
  assert.equal(result.inspectedUrlCount, 1);
  assert.equal(result.score, 100);
  assert.ok(result.triggers.some((trigger) => trigger.type === "blocked_term" && trigger.value === "counterfeit"));
  assert.ok(result.triggers.some((trigger) => trigger.type === "high_risk_phrase" && trigger.value === "attack"));
  assert.ok(result.triggers.some((trigger) => trigger.type === "blocked_url_host" && trigger.value === "bit.ly"));
});

test("evaluateCommunityContentRisk marks medium severity at configured threshold", () => {
  const result = evaluateCommunityContentRisk(
    {
      textFields: [{ field: "description", text: "This listing is counterfeit only." }],
    },
    makeConfig({ mediumSeverityThreshold: 30, highSeverityThreshold: 90 })
  );

  assert.equal(result.score, 30);
  assert.equal(result.severity, "medium");
});

test("evaluateCommunityContentRisk adds link volume trigger for many URLs", () => {
  const explicitUrls = [
    "https://example.com/1",
    "https://example.com/2",
    "https://example.com/3",
    "https://example.com/4",
    "https://example.com/5",
    "https://example.com/6",
  ];
  const result = evaluateCommunityContentRisk(
    {
      textFields: [{ field: "location", text: "See all references." }],
      explicitUrls,
    },
    makeConfig()
  );

  assert.equal(result.inspectedUrlCount, 6);
  assert.ok(result.triggers.some((trigger) => trigger.type === "link_volume" && trigger.value === "6"));
  assert.equal(result.score, 15);
  assert.equal(result.severity, "low");
});
