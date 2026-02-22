import test from "node:test";
import assert from "node:assert/strict";

import type { SkillManifest } from "./registry";
import {
  createSkillSignatureTrustAnchorVerifier,
  parseSkillSignatureTrustAnchors,
  signSkillManifestForTrustAnchor,
} from "./trustAnchor";

function buildUnsignedManifest(): SkillManifest {
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

test("parseSkillSignatureTrustAnchors supports csv and json key maps", () => {
  const csv = parseSkillSignatureTrustAnchors("root-v1=alpha, edge-v1 = beta ");
  assert.deepEqual(csv, { "root-v1": "alpha", "edge-v1": "beta" });

  const json = parseSkillSignatureTrustAnchors('{"root-v1":"alpha","edge-v1":"beta"}');
  assert.deepEqual(json, { "root-v1": "alpha", "edge-v1": "beta" });
});

test("trust anchor verifier validates signed manifest", async () => {
  const unsigned = buildUnsignedManifest();
  const signed: SkillManifest = {
    ...unsigned,
    signatureAlgorithm: "hmac-sha256",
    signatureKeyId: "root-v1",
    signature: signSkillManifestForTrustAnchor({
      manifest: unsigned,
      trustAnchorKey: "anchor-secret",
    }),
  };

  const verifier = createSkillSignatureTrustAnchorVerifier({
    trustAnchors: { "root-v1": "anchor-secret" },
  });

  const result = await verifier({
    manifest: signed,
    sourcePath: "/tmp/skills/planner/1.0.0",
  });
  assert.equal(result.ok, true);
});

test("trust anchor verifier rejects missing trust key and bad signatures", async () => {
  const unsigned = buildUnsignedManifest();
  const signature = signSkillManifestForTrustAnchor({
    manifest: unsigned,
    trustAnchorKey: "anchor-secret",
  });
  const signed: SkillManifest = {
    ...unsigned,
    signatureAlgorithm: "hmac-sha256",
    signatureKeyId: "root-v1",
    signature,
  };

  const unknownAnchorVerifier = createSkillSignatureTrustAnchorVerifier({
    trustAnchors: { "different-root": "anchor-secret" },
  });
  const unknownAnchor = await unknownAnchorVerifier({
    manifest: signed,
    sourcePath: "/tmp/skills/planner/1.0.0",
  });
  assert.equal(unknownAnchor.ok, false);
  assert.match(unknownAnchor.reason ?? "", /UNKNOWN_TRUST_ANCHOR/);

  const badSignatureVerifier = createSkillSignatureTrustAnchorVerifier({
    trustAnchors: { "root-v1": "wrong-secret" },
  });
  const badSignature = await badSignatureVerifier({
    manifest: signed,
    sourcePath: "/tmp/skills/planner/1.0.0",
  });
  assert.equal(badSignature.ok, false);
  assert.equal(badSignature.reason, "SIGNATURE_MISMATCH");
});
