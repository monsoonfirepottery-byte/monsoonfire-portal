"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const runtime_1 = require("../capabilities/runtime");
const policyMetadata_1 = require("../capabilities/policyMetadata");
const policyLint_1 = require("../observability/policyLint");
function groupByTarget() {
    const grouped = {};
    for (const capability of runtime_1.defaultCapabilities) {
        grouped[capability.target] = (grouped[capability.target] ?? 0) + 1;
    }
    return grouped;
}
function main() {
    const issues = (0, policyLint_1.lintCapabilityPolicy)(runtime_1.defaultCapabilities, policyMetadata_1.capabilityPolicyMetadata);
    const payload = {
        ok: issues.length === 0,
        checkedAt: new Date().toISOString(),
        capabilitiesChecked: runtime_1.defaultCapabilities.length,
        byTarget: groupByTarget(),
        violations: issues,
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    if (issues.length > 0) {
        process.exitCode = 1;
    }
}
main();
