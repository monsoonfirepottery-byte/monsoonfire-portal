"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const trustAnchor_1 = require("./trustAnchor");
function buildUnsignedManifest() {
    return {
        name: "planner",
        version: "1.0.0",
        description: "planner skill",
        entrypoint: "index.js",
        checksum: "abc123",
        permissions: {
            allowedEgressHosts: ["api.example.com"],
            commands: ["plan.create"],
        },
    };
}
(0, node_test_1.default)("parseSkillSignatureTrustAnchors supports csv and json key maps", () => {
    const csv = (0, trustAnchor_1.parseSkillSignatureTrustAnchors)("root-v1=alpha, edge-v1 = beta ");
    strict_1.default.deepEqual(csv, { "root-v1": "alpha", "edge-v1": "beta" });
    const json = (0, trustAnchor_1.parseSkillSignatureTrustAnchors)('{"root-v1":"alpha","edge-v1":"beta"}');
    strict_1.default.deepEqual(json, { "root-v1": "alpha", "edge-v1": "beta" });
});
(0, node_test_1.default)("trust anchor verifier validates signed manifest", async () => {
    const unsigned = buildUnsignedManifest();
    const signed = {
        ...unsigned,
        signatureAlgorithm: "hmac-sha256",
        signatureKeyId: "root-v1",
        signature: (0, trustAnchor_1.signSkillManifestForTrustAnchor)({
            manifest: unsigned,
            trustAnchorKey: "anchor-secret",
        }),
    };
    const verifier = (0, trustAnchor_1.createSkillSignatureTrustAnchorVerifier)({
        trustAnchors: { "root-v1": "anchor-secret" },
    });
    const result = await verifier({
        manifest: signed,
        sourcePath: "/tmp/skills/planner/1.0.0",
    });
    strict_1.default.equal(result.ok, true);
});
(0, node_test_1.default)("trust anchor verifier rejects missing trust key and bad signatures", async () => {
    const unsigned = buildUnsignedManifest();
    const signature = (0, trustAnchor_1.signSkillManifestForTrustAnchor)({
        manifest: unsigned,
        trustAnchorKey: "anchor-secret",
    });
    const signed = {
        ...unsigned,
        signatureAlgorithm: "hmac-sha256",
        signatureKeyId: "root-v1",
        signature,
    };
    const unknownAnchorVerifier = (0, trustAnchor_1.createSkillSignatureTrustAnchorVerifier)({
        trustAnchors: { "different-root": "anchor-secret" },
    });
    const unknownAnchor = await unknownAnchorVerifier({
        manifest: signed,
        sourcePath: "/tmp/skills/planner/1.0.0",
    });
    strict_1.default.equal(unknownAnchor.ok, false);
    strict_1.default.match(unknownAnchor.reason ?? "", /UNKNOWN_TRUST_ANCHOR/);
    const badSignatureVerifier = (0, trustAnchor_1.createSkillSignatureTrustAnchorVerifier)({
        trustAnchors: { "root-v1": "wrong-secret" },
    });
    const badSignature = await badSignatureVerifier({
        manifest: signed,
        sourcePath: "/tmp/skills/planner/1.0.0",
    });
    strict_1.default.equal(badSignature.ok, false);
    strict_1.default.equal(badSignature.reason, "SIGNATURE_MISMATCH");
});
