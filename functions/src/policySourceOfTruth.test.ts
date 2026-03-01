import assert from "node:assert/strict";
import test from "node:test";
import {
  WEBSITE_POLICY_CANONICAL_VERSION,
  WEBSITE_POLICY_SOURCE_SLUG,
  WEBSITE_POLICY_SOURCE_URL,
  WEBSITE_POLICY_SOURCE_VERSION,
  websiteCommunityConductFallbackPolicy,
} from "./policySourceOfTruth";

test("website community-conduct fallback policy stays well-formed", () => {
  const policy = websiteCommunityConductFallbackPolicy();
  assert.equal(policy.sourceOfTruth, "website_policies");
  assert.equal(policy.sourceSlug, WEBSITE_POLICY_SOURCE_SLUG);
  assert.equal(policy.sourceVersion, WEBSITE_POLICY_SOURCE_VERSION);
  assert.equal(policy.sourceUrl, WEBSITE_POLICY_SOURCE_URL);
  assert.equal(policy.version, WEBSITE_POLICY_CANONICAL_VERSION);
  assert.equal(policy.status, "published");
  assert.ok(policy.rules.length >= 3);
  assert.ok(policy.rules.every((rule) => rule.id && rule.title && rule.description));
});
