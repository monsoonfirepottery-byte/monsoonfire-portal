import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseFrontmatter,
  readPolicyFiles,
  validatePolicyFrontmatter,
} from "../website/scripts/policy-docs.mjs";
import { buildCustomerServicePolicyArtifacts } from "../website/scripts/policy-governance.mjs";
import {
  loadCustomerServiceResolutionContract,
  resolveCustomerServiceIntent,
} from "./lib/customer-service-policy-resolver.mjs";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..");
const docsPoliciesPath = resolve(repoRoot, "docs", "policies");
const policyIndexPath = resolve(repoRoot, "docs", "policies", "policies-index.json");
const policyProgramPath = resolve(
  repoRoot,
  ".governance",
  "customer-service-policies",
  "policy-program.json"
);
const expectedReviewOrder = [
  "payments-refunds",
  "firing-scheduling",
  "storage-abandoned-work",
  "studio-access",
  "damage-responsibility",
  "clay-materials",
  "safety-kiln-rules",
  "community-conduct",
  "accessibility",
  "media-accessibility",
];

async function loadPolicies() {
  const policyFiles = await readPolicyFiles(docsPoliciesPath, await import("node:fs/promises"));
  const policies = [];
  for (const filePath of policyFiles) {
    const raw = await readFile(filePath, "utf8");
    const policy = parseFrontmatter(raw);
    const errors = validatePolicyFrontmatter(policy);
    assert.equal(errors.length, 0, `frontmatter validation failed for ${filePath}: ${errors.join(", ")}`);
    policies.push({
      slug: policy.slug,
      title: policy.title,
      summary: policy.summary,
      status: policy.status,
      tags: policy.tags,
      effectiveDate: policy.effectiveDate,
      reviewDate: policy.reviewDate,
      owner: policy.owner,
      sourceUrl: policy.sourceUrl,
      version: policy.version,
      agent: policy.agent,
    });
  }
  return policies;
}

test("customer-service policy generation stays deterministic and complete", async () => {
  const policies = await loadPolicies();
  const artifacts = await buildCustomerServicePolicyArtifacts({
    repoRoot,
    policies,
    generatedAt: "2026-04-02T00:00:00.000Z",
  });

  assert.deepEqual(artifacts.programPayload.reviewOrder, expectedReviewOrder);
  assert.equal(artifacts.programPayload.policies.length, 10);
  assert.equal(artifacts.inventoryPayload.summary.policyCount, 10);
  assert.equal(artifacts.inventoryPayload.summary.byKind.canonical, 10);
  assert.equal(artifacts.inventoryPayload.summary.byKind["practice-evidence"], 4);
  assert.equal(artifacts.inventoryPayload.summary.discrepancyCount, 0);

  const paymentsPolicy = artifacts.programPayload.policies.find((entry) => entry.slug === "payments-refunds");
  assert.ok(paymentsPolicy);
  assert.equal(paymentsPolicy.discrepancyStatus, "clear");
  assert.ok(paymentsPolicy.routingTerms.includes("refund"));

  const storagePolicy = artifacts.programPayload.policies.find(
    (entry) => entry.slug === "storage-abandoned-work"
  );
  assert.ok(storagePolicy);
  assert.ok(storagePolicy.routingTerms.includes("storage"));

  const damagePolicy = artifacts.programPayload.policies.find(
    (entry) => entry.slug === "damage-responsibility"
  );
  assert.ok(damagePolicy);
  assert.equal(damagePolicy.discrepancyStatus, "clear");
});

test("generated governance bundle stays aligned with the docs policy index", async () => {
  const policyIndex = JSON.parse(await readFile(policyIndexPath, "utf8"));
  const program = JSON.parse(await readFile(policyProgramPath, "utf8"));

  const docsPolicies = Array.isArray(policyIndex?.policies) ? policyIndex.policies : [];
  const programPolicies = Array.isArray(program?.policies) ? program.policies : [];
  assert.equal(programPolicies.length, docsPolicies.length);

  for (const policy of docsPolicies) {
    const programPolicy = programPolicies.find((entry) => entry.slug === policy.slug);
    assert.ok(programPolicy, `missing governance policy ${String(policy.slug)}`);
    assert.equal(programPolicy.version, policy.version, `version drift for ${String(policy.slug)}`);
    assert.equal(
      programPolicy.effectiveDate,
      policy.effectiveDate,
      `effectiveDate drift for ${String(policy.slug)}`
    );
  }
});

test("customer-service resolver routes policy questions and blocks human-only actions", async () => {
  const contract = await loadCustomerServiceResolutionContract();

  const billing = resolveCustomerServiceIntent(contract, {
    text: "I was charged twice for my membership and need a refund.",
    requestedAction: "refunds",
  });
  assert.equal(billing.topMatch?.policySlugs[0], "payments-refunds");
  assert.equal(billing.topMatch?.requiresEscalation, true);

  const firing = resolveCustomerServiceIntent(contract, {
    text: "The kiln seems delayed. When will my pieces be ready for pickup?",
  });
  assert.equal(firing.topMatch?.policySlugs[0], "firing-scheduling");

  const storage = resolveCustomerServiceIntent(contract, {
    text: "How long can you hold my finished work before reclamation starts?",
  });
  assert.equal(storage.topMatch?.policySlugs[0], "storage-abandoned-work");

  const damage = resolveCustomerServiceIntent(contract, {
    text: "My bowl cracked during firing. How do I file a damage claim?",
  });
  assert.equal(damage.topMatch?.policySlugs[0], "damage-responsibility");

  const access = resolveCustomerServiceIntent(contract, {
    text: "Can I just walk in today or do I still need an appointment?",
  });
  assert.equal(access.topMatch?.policySlugs[0], "studio-access");

  const materials = resolveCustomerServiceIntent(contract, {
    text: "Can I bring a new glaze I bought online for this firing?",
  });
  assert.equal(materials.topMatch?.policySlugs[0], "clay-materials");

  const conduct = resolveCustomerServiceIntent(contract, {
    text: "I need to report harassment in the shared studio space.",
  });
  assert.equal(conduct.topMatch?.policySlugs[0], "community-conduct");

  const accessibility = resolveCustomerServiceIntent(contract, {
    text: "I need captions and a transcript for a public studio video.",
  });
  assert.equal(accessibility.topMatch?.policySlugs[0], "media-accessibility");
});
