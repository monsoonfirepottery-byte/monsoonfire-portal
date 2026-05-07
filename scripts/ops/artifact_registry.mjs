const FRESHNESS_TIERS = {
  loop: { maxAgeHours: 6, description: "active slice-loop evidence that should be refreshed during the current work session" },
  daily: { maxAgeHours: 24, description: "daily operational evidence that can age through a normal work day" },
  weekly: { maxAgeHours: 168, description: "slower-moving evidence that is still useful across a weekly ops review" },
};

const OPS_ARTIFACT_REGISTRY = [
  {
    id: "tooling-quality-report",
    artifact: "output/ops/tooling-quality/tooling-quality-latest.json",
    schema: "schemas/ops/tooling-quality-report.v1.schema.json",
    freshnessTier: "daily",
  },
  {
    id: "tooling-findings-export",
    artifact: "output/ops/tooling-quality/tooling-findings-latest.json",
    schema: "schemas/ops/tooling-findings-export.v1.schema.json",
    freshnessTier: "daily",
  },
  {
    id: "installed-tool-inventory",
    artifact: "output/ops/effectivity/installed-tool-inventory-latest.json",
    schema: "schemas/ops/installed-tool-inventory.v1.schema.json",
    freshnessTier: "daily",
  },
  {
    id: "tool-install-recommendations",
    artifact: "output/ops/effectivity/tool-install-recommendations-latest.json",
    schema: "schemas/ops/tool-install-recommendations.v1.schema.json",
    freshnessTier: "daily",
  },
  {
    id: "admin-effectivity-audit",
    artifact: "output/ops/effectivity/admin-effectivity-audit-latest.json",
    schema: "schemas/ops/admin-effectivity-audit.v1.schema.json",
    freshnessTier: "loop",
  },
  {
    id: "slice-ledger-summary",
    artifact: "output/ops/effectivity/slice-ledger-latest.json",
    schema: "schemas/ops/slice-ledger-summary.v1.schema.json",
    freshnessTier: "loop",
  },
  {
    id: "ops-work-packet",
    artifact: "output/ops/swarm/latest-work-packet.json",
    schema: "schemas/ops/ops-work-packet.v1.schema.json",
    freshnessTier: "loop",
  },
  {
    id: "packet-outcome-report",
    artifact: "output/ops/swarm/packet-outcome-report-latest.json",
    schema: "schemas/ops/packet-outcome-report.v1.schema.json",
    freshnessTier: "loop",
  },
  {
    id: "swarm-lane-preflight",
    artifact: "output/ops/swarm-lane-preflight/swarm-lane-preflight-latest.json",
    schema: "schemas/ops/swarm-lane-preflight.v1.schema.json",
    freshnessTier: "loop",
  },
  {
    id: "ops-wave-runner",
    artifact: "output/ops/waves/ops-wave-runner-latest.json",
    schema: "schemas/ops/ops-wave-runner.v1.schema.json",
    freshnessTier: "loop",
  },
  {
    id: "pr-stack-audit",
    artifact: "output/ops/pr-stack/pr-stack-audit-latest.json",
    schema: "schemas/ops/pr-stack-audit.v1.schema.json",
    freshnessTier: "loop",
  },
  {
    id: "pr-readiness-packet",
    artifact: "output/ops/pr-readiness/pr-readiness-latest.json",
    schema: "schemas/ops/pr-readiness-packet.v1.schema.json",
    freshnessTier: "loop",
  },
  {
    id: "artifact-schema-validation",
    artifact: "output/ops/artifact-validation/artifact-schema-validation-latest.json",
    schema: "schemas/ops/artifact-schema-validation.v1.schema.json",
    freshnessTier: "loop",
  },
];

function defaultArtifactRegistry() {
  return OPS_ARTIFACT_REGISTRY.map((entry) => ({
    ...entry,
    maxAgeHours: FRESHNESS_TIERS[entry.freshnessTier]?.maxAgeHours ?? FRESHNESS_TIERS.daily.maxAgeHours,
  }));
}

export { defaultArtifactRegistry, FRESHNESS_TIERS, OPS_ARTIFACT_REGISTRY };
