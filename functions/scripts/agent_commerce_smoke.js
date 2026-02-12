/* eslint-disable no-console */

/**
 * Agent commerce smoke test for apiV1 + PAT/delegated auth.
 *
 * Usage:
 *   node functions/scripts/agent_commerce_smoke.js --token "<token>" --baseUrl "http://127.0.0.1:5001/monsoonfire-portal/us-central1"
 *
 * Notes:
 * - Token must include: catalog:read, quote:write, reserve:write, pay:write, status:read
 * - This script is intentionally tolerant: it logs failures per step and continues.
 */

const DEFAULT_BASE_URL = "http://127.0.0.1:5001/monsoonfire-portal/us-central1";

function readArg(name) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}

function redactToken(token) {
  if (!token) return "";
  if (token.length < 20) return token;
  return `${token.slice(0, 12)}...${token.slice(-8)}`;
}

async function postJson(baseApiUrl, token, route, payload) {
  const url = `${baseApiUrl}${route}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "x-request-id": `agent_commerce_smoke_${Date.now()}`,
    },
    body: JSON.stringify(payload ?? {}),
  });
  const ct = resp.headers.get("content-type") || "";
  const body = ct.includes("application/json")
    ? await resp.json().catch(() => null)
    : await resp.text().catch(() => null);
  return { status: resp.status, body };
}

function logStep(label, result) {
  console.log(`\n${label} => ${result.status}`);
  console.log(JSON.stringify(result.body, null, 2));
}

async function main() {
  const baseUrl = (readArg("baseUrl") || process.env.MF_FUNCTIONS_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const token = readArg("token") || process.env.MF_AGENT_TOKEN || process.env.MF_PAT || process.env.PAT || "";
  if (!token) {
    console.error("Missing token. Provide --token or set MF_AGENT_TOKEN/MF_PAT.");
    process.exit(2);
  }

  const apiBase = `${baseUrl}/apiV1`;
  console.log("Base URL:", baseUrl);
  console.log("Token:", redactToken(token));

  const catalog = await postJson(apiBase, token, "/v1/agent.catalog", {});
  logStep("/v1/agent.catalog", catalog);
  const services = catalog.body?.data?.services;
  const serviceId = Array.isArray(services) && services[0]?.id ? services[0].id : null;
  if (!serviceId) {
    console.error("No enabled service returned from catalog. Cannot continue.");
    process.exit(1);
  }

  const quote = await postJson(apiBase, token, "/v1/agent.quote", { serviceId, quantity: 1 });
  logStep("/v1/agent.quote", quote);
  const quoteId = quote.body?.data?.quoteId;
  if (!quoteId) {
    console.error("Quote step failed; stopping.");
    process.exit(1);
  }

  const reserve = await postJson(apiBase, token, "/v1/agent.reserve", { quoteId });
  logStep("/v1/agent.reserve", reserve);
  const reservationId = reserve.body?.data?.reservationId;
  if (!reservationId) {
    console.error("Reserve step failed; stopping.");
    process.exit(1);
  }

  const pay = await postJson(apiBase, token, "/v1/agent.pay", { reservationId });
  logStep("/v1/agent.pay", pay);
  const orderId = pay.body?.data?.orderId;
  if (!orderId) {
    console.error("Pay step did not return orderId; stopping.");
    process.exit(1);
  }

  const order = await postJson(apiBase, token, "/v1/agent.order.get", { orderId });
  logStep("/v1/agent.order.get", order);

  const status = await postJson(apiBase, token, "/v1/agent.status", { orderId });
  logStep("/v1/agent.status", status);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

