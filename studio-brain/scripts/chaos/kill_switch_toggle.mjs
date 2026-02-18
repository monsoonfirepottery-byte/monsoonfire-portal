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

async function request(path, body) {
  const resp = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.STUDIO_BRAIN_ID_TOKEN || "dev"}`,
      "x-studio-brain-admin-token": adminToken.trim(),
    },
    body: JSON.stringify(body),
  });
  const payload = await resp.json();
  return { status: resp.status, payload };
}

guard();

const on = await request("/api/capabilities/policy/kill-switch", {
  enabled: true,
  rationale: "Chaos drill: verify kill-switch blocks execution safely.",
});
console.log("kill-switch on:", on.status, on.payload?.ok);

const off = await request("/api/capabilities/policy/kill-switch", {
  enabled: false,
  rationale: "Chaos drill: restore normal operations.",
});
console.log("kill-switch off:", off.status, off.payload?.ok);
