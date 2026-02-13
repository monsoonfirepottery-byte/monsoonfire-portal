import { defaultCapabilities } from "../capabilities/runtime";
import { capabilityPolicyMetadata } from "../capabilities/policyMetadata";
import { lintCapabilityPolicy } from "../observability/policyLint";

function groupByTarget() {
  const grouped: Record<string, number> = {};
  for (const capability of defaultCapabilities) {
    grouped[capability.target] = (grouped[capability.target] ?? 0) + 1;
  }
  return grouped;
}

function main(): void {
  const issues = lintCapabilityPolicy(defaultCapabilities, capabilityPolicyMetadata);
  const payload = {
    ok: issues.length === 0,
    checkedAt: new Date().toISOString(),
    capabilitiesChecked: defaultCapabilities.length,
    byTarget: groupByTarget(),
    violations: issues,
  };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  if (issues.length > 0) {
    process.exitCode = 1;
  }
}

main();
