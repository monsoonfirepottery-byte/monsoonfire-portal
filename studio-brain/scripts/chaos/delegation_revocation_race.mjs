import { resolveStudioBrainBaseUrlFromEnv } from "../../scripts/studio-brain-url-resolution.mjs";

const baseUrl = resolveStudioBrainBaseUrlFromEnv({ env: process.env });
const adminToken = process.env.STUDIO_BRAIN_ADMIN_TOKEN || "";

function guard() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run in production.");
  }
  if (process.env.CHAOS_MODE !== "true") {
    throw new Error("Set CHAOS_MODE=true to run chaos scripts.");
  }
  if (!adminToken.trim()) {
    throw new Error("Missing STUDIO_BRAIN_ADMIN_TOKEN.");
  }
}

async function attempt(idx, delegation) {
  const resp = await fetch(`${baseUrl}/api/capabilities/proposals`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.STUDIO_BRAIN_ID_TOKEN || "dev"}`,
      "x-studio-brain-admin-token": adminToken.trim(),
    },
    body: JSON.stringify({
      actorType: "agent",
      actorId: "agent-chaos",
      ownerUid: "owner-chaos",
      capabilityId: "firestore.batch.close",
      rationale: "Chaos drill: delegation revocation race.",
      previewSummary: "Chaos draft proposal",
      requestInput: { batchId: "mfb-chaos" },
      expectedEffects: ["No execution; denial expected."],
      delegation,
    }),
  });
  const payload = await resp.json();
  console.log(`[${idx}] status=${resp.status} ok=${payload.ok} reason=${payload.reasonCode || payload.message || ""}`);
}

guard();

const delegations = [
  { delegationId: "missing-fields" },
  { delegationId: "revoked", revokedAt: new Date(Date.now() - 1000).toISOString() },
  { delegationId: "expired", expiresAt: new Date(Date.now() - 1000).toISOString() },
];

let idx = 1;
for (const delegation of delegations) {
  // Simulate race by firing two attempts with same payload.
  await Promise.all([attempt(idx, delegation), attempt(idx + 1, delegation)]);
  idx += 2;
}
