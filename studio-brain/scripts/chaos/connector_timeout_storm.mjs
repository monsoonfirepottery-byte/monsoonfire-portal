import { resolveStudioBrainBaseUrlFromEnv } from "../../scripts/studio-brain-url-resolution.mjs";

const baseUrl = resolveStudioBrainBaseUrlFromEnv({ env: process.env });
const adminToken = process.env.STUDIO_BRAIN_ADMIN_TOKEN || "";
const iterations = Number(process.env.CHAOS_STORM_COUNT || "20");
const timeoutMs = Number(process.env.CHAOS_TIMEOUT_MS || "250");

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

async function probe(idx) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${baseUrl}/api/connectors/health`, {
      method: "GET",
      headers: {
        authorization: `Bearer ${process.env.STUDIO_BRAIN_ID_TOKEN || "dev"}`,
        "x-studio-brain-admin-token": adminToken.trim(),
      },
      signal: controller.signal,
    });
    const payload = await resp.json();
    console.log(`[${idx}] status=${resp.status} connectors=${Array.isArray(payload.connectors) ? payload.connectors.length : 0}`);
  } catch (err) {
    console.log(`[${idx}] timeout_or_error=${err?.name || "error"}`);
  } finally {
    clearTimeout(timeout);
  }
}

guard();

for (let i = 0; i < iterations; i += 1) {
  await probe(i + 1);
}
