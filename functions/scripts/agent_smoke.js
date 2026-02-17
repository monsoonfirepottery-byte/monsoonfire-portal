/* eslint-disable no-console */

/**
 * Agent smoke test for apiV1 + PAT auth.
 *
 * Usage:
 *   node functions/scripts/agent_smoke.js --pat "mf_pat_v1...." --baseUrl "http://127.0.0.1:5001/monsoonfire-portal/us-central1"
 *
 * Notes:
 * - Requires Functions emulator or deployed functions to be reachable.
 * - PAT must already exist (create via Portal UI -> Profile -> Integrations).
 * - Honors `Retry-After` on 429s with bounded retries.
 */

const DEFAULT_BASE_URL = "http://127.0.0.1:5001/monsoonfire-portal/us-central1";

function readArg(name) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function redactToken(token) {
  if (!token) return "";
  if (token.length < 16) return token;
  return `${token.slice(0, 10)}...${token.slice(-6)}`;
}

async function postJsonWithRetry(url, pat, payload, opts = {}) {
  const maxRetries = Number.isFinite(opts.maxRetries) ? opts.maxRetries : 5;
  let attempt = 0;

  while (true) {
    attempt += 1;

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${pat}`,
        "x-request-id": `agent_smoke_${Date.now()}_${attempt}`,
      },
      body: JSON.stringify(payload ?? {}),
    });

    const ct = resp.headers.get("content-type") || "";
    const body = ct.includes("application/json") ? await resp.json().catch(() => null) : await resp.text().catch(() => null);

    if (resp.status !== 429) {
      return { resp, body };
    }

    if (attempt > maxRetries) {
      const requestId = body && typeof body === "object" ? body.requestId : null;
      throw new Error(
        `exceeded retry limit, last status: ${resp.status} ${resp.statusText}${requestId ? `, request id: ${requestId}` : ""}`
      );
    }

    const retryAfterRaw = resp.headers.get("retry-after") || "";
    const retryAfterSeconds = Math.max(1, Number(retryAfterRaw) || 1);
    const jitterMs = Math.floor(Math.random() * 250);
    await sleep(retryAfterSeconds * 1000 + jitterMs);
  }
}

async function main() {
  const baseUrl = (readArg("baseUrl") || process.env.MF_FUNCTIONS_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const pat = readArg("pat") || process.env.MF_PAT || process.env.PAT || "";

  if (!pat) {
    console.error("Missing PAT. Provide --pat or set MF_PAT.");
    process.exit(2);
  }

  const apiBase = `${baseUrl}/apiV1`;
  console.log("Base URL:", baseUrl);
  console.log("PAT:", redactToken(pat));

  const hello = await postJsonWithRetry(`${apiBase}/v1/hello`, pat, {});
  console.log("\n/v1/hello status:", hello.resp.status);
  console.log(JSON.stringify(hello.body, null, 2));

  const batches = await postJsonWithRetry(`${apiBase}/v1/batches.list`, pat, { limit: 25, includeClosed: false });
  console.log("\n/v1/batches.list status:", batches.resp.status);
  console.log(JSON.stringify(batches.body, null, 2));

  const feed = await postJsonWithRetry(`${apiBase}/v1/events.feed`, pat, { cursor: 0, limit: 50 });
  console.log("\n/v1/events.feed status:", feed.resp.status);
  console.log(JSON.stringify(feed.body, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

