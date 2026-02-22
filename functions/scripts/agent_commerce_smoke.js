/* eslint-disable no-console */

/**
 * Agent commerce smoke test for apiV1 + PAT/delegated auth.
 *
 * Usage:
 *   node functions/scripts/agent_commerce_smoke.js --token "<token>" --baseUrl "http://127.0.0.1:5001/monsoonfire-portal/us-central1"
 *   node functions/scripts/agent_commerce_smoke.js --token "<agent_token>" --staffToken "<staff_firebase_id_token>"
 *   node functions/scripts/agent_commerce_smoke.js --strict --fixture "functions/scripts/fixtures/agent-commerce-smoke.base.json"
 *
 * Notes:
 * - Token should include: catalog:read, quote:write, reserve:write, pay:write, status:read
 * - `--strict` upgrades this from exploratory smoke to a deterministic regression guard.
 */

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_BASE_URL = "http://127.0.0.1:5001/monsoonfire-portal/us-central1";
const DEFAULT_TRANSITIONS = ["scheduled", "loaded", "firing", "cooling", "ready"];

function readArg(name) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return null;
  const value = process.argv[idx + 1];
  if (!value || value.startsWith("--")) return null;
  return value;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function readBooleanArg(name, envValue = "") {
  if (hasFlag(name)) return true;
  const raw = readArg(name);
  if (raw) return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
  return ["1", "true", "yes", "on"].includes(String(envValue).trim().toLowerCase());
}

function readFixture() {
  const fixturePath = readArg("fixture") || process.env.MF_AGENT_SMOKE_FIXTURE || "";
  if (!fixturePath) return {};
  const resolved = path.resolve(process.cwd(), fixturePath);
  const raw = fs.readFileSync(resolved, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Fixture must be an object: ${resolved}`);
  }
  return parsed;
}

function redactToken(token) {
  if (!token) return "";
  if (token.length < 20) return token;
  return `${token.slice(0, 12)}...${token.slice(-8)}`;
}

function summarizeBody(body) {
  if (body == null) return null;
  if (typeof body !== "object") return body;
  const row = body;
  return {
    ok: row.ok === true,
    code: typeof row.code === "string" ? row.code : null,
    message: typeof row.message === "string" ? row.message : null,
    dataKeys: row.data && typeof row.data === "object" ? Object.keys(row.data).slice(0, 12) : [],
  };
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

async function postFunction(baseUrl, token, fnName, payload) {
  const url = `${baseUrl}/${fnName}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "x-request-id": `agent_commerce_smoke_fn_${Date.now()}`,
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

function expectOrThrow(condition, message, strict, warnings) {
  if (condition) return;
  if (strict) {
    throw new Error(message);
  }
  warnings.push(message);
  console.warn(`WARN: ${message}`);
}

function toObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

async function main() {
  const fixture = readFixture();
  const strict = readBooleanArg("strict", process.env.MF_SMOKE_STRICT);
  const jsonOutput = hasFlag("json");
  const baseUrl = (readArg("baseUrl") || process.env.MF_FUNCTIONS_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const token = readArg("token") || process.env.MF_AGENT_TOKEN || process.env.MF_PAT || process.env.PAT || "";
  const staffToken = readArg("staffToken") || process.env.MF_STAFF_ID_TOKEN || "";
  if (!token) {
    console.error("Missing token. Provide --token or set MF_AGENT_TOKEN/MF_PAT.");
    process.exit(2);
  }

  const apiBase = `${baseUrl}/apiV1`;
  const warnings = [];
  const summary = {
    strict,
    baseUrl,
    tokenPresent: Boolean(token),
    staffTokenPresent: Boolean(staffToken),
    warnings,
    steps: [],
  };

  console.log("Base URL:", baseUrl);
  console.log("Strict mode:", strict ? "enabled" : "disabled");
  console.log("Token:", redactToken(token));
  if (staffToken) {
    console.log("Staff Token:", redactToken(staffToken));
  }

  const catalogPayload = toObject(fixture.catalogPayload);
  const catalog = await postJson(apiBase, token, "/v1/agent.catalog", catalogPayload);
  logStep("/v1/agent.catalog", catalog);
  summary.steps.push({ step: "/v1/agent.catalog", status: catalog.status, summary: summarizeBody(catalog.body) });
  expectOrThrow(catalog.status < 400, "Catalog request failed.", strict, warnings);
  const services = catalog.body?.data?.services;
  const fixtureServiceId = typeof fixture.serviceId === "string" ? fixture.serviceId : null;
  const serviceId = fixtureServiceId || (Array.isArray(services) && services[0]?.id ? services[0].id : null);
  expectOrThrow(Boolean(serviceId), "No enabled service returned from catalog.", true, warnings);

  const quotePayload = {
    serviceId,
    quantity: 1,
    ...toObject(fixture.quotePayload),
  };
  const quote = await postJson(apiBase, token, "/v1/agent.quote", quotePayload);
  logStep("/v1/agent.quote", quote);
  summary.steps.push({ step: "/v1/agent.quote", status: quote.status, summary: summarizeBody(quote.body) });
  expectOrThrow(quote.status < 400, "Quote request failed.", strict, warnings);
  const quoteId = quote.body?.data?.quoteId;
  expectOrThrow(Boolean(quoteId), "Quote step did not return quoteId.", true, warnings);

  const reservePayload = {
    quoteId,
    ...toObject(fixture.reservePayload),
  };
  const reserve = await postJson(apiBase, token, "/v1/agent.reserve", reservePayload);
  logStep("/v1/agent.reserve", reserve);
  summary.steps.push({ step: "/v1/agent.reserve", status: reserve.status, summary: summarizeBody(reserve.body) });
  expectOrThrow(reserve.status < 400, "Reserve request failed.", strict, warnings);
  const reservationId = reserve.body?.data?.reservationId;
  expectOrThrow(Boolean(reservationId), "Reserve step did not return reservationId.", true, warnings);

  if (reserve.body?.data?.reservation?.requiresManualReview === true) {
    if (!staffToken) {
      expectOrThrow(
        false,
        "Reservation requires manual review. Provide --staffToken to auto-approve in strict mode.",
        strict,
        warnings
      );
    } else {
      const reviewPayload = {
        reservationId,
        decision: "approve",
        reason: "Automated smoke test approval",
        ...toObject(fixture.reviewPayload),
      };
      const review = await postFunction(baseUrl, staffToken, "staffReviewAgentReservation", reviewPayload);
      logStep("/staffReviewAgentReservation", review);
      summary.steps.push({ step: "/staffReviewAgentReservation", status: review.status, summary: summarizeBody(review.body) });
      expectOrThrow(review.status < 400, "Manual review approval failed.", strict, warnings);
    }
  }

  const payPayload = {
    reservationId,
    ...toObject(fixture.payPayload),
  };
  const pay = await postJson(apiBase, token, "/v1/agent.pay", payPayload);
  logStep("/v1/agent.pay", pay);
  summary.steps.push({ step: "/v1/agent.pay", status: pay.status, summary: summarizeBody(pay.body) });
  expectOrThrow(pay.status < 400, "Pay request failed.", strict, warnings);
  const orderId = pay.body?.data?.orderId;
  expectOrThrow(Boolean(orderId), "Pay step did not return orderId.", true, warnings);

  const orderPayload = {
    orderId,
    ...toObject(fixture.orderGetPayload),
  };
  const order = await postJson(apiBase, token, "/v1/agent.order.get", orderPayload);
  logStep("/v1/agent.order.get", order);
  summary.steps.push({ step: "/v1/agent.order.get", status: order.status, summary: summarizeBody(order.body) });
  expectOrThrow(order.status < 400, "Order lookup failed.", strict, warnings);

  const statusPayload = {
    orderId,
    ...toObject(fixture.statusPayload),
  };
  const status = await postJson(apiBase, token, "/v1/agent.status", statusPayload);
  logStep("/v1/agent.status", status);
  summary.steps.push({ step: "/v1/agent.status", status: status.status, summary: summarizeBody(status.body) });
  expectOrThrow(status.status < 400, "Status request failed.", strict, warnings);

  if (staffToken) {
    const transitions = Array.isArray(fixture.staffTransitions) && fixture.staffTransitions.length
      ? fixture.staffTransitions.map((entry) => String(entry))
      : DEFAULT_TRANSITIONS;
    for (const next of transitions) {
      const movePayload = {
        orderId,
        toStatus: next,
        reason: "Automated smoke transition",
        ...toObject(fixture.staffTransitionPayload),
      };
      const move = await postFunction(baseUrl, staffToken, "staffUpdateAgentOrderFulfillment", movePayload);
      logStep(`/staffUpdateAgentOrderFulfillment -> ${next}`, move);
      summary.steps.push({
        step: `/staffUpdateAgentOrderFulfillment:${next}`,
        status: move.status,
        summary: summarizeBody(move.body),
      });
      if (move.status >= 400) {
        expectOrThrow(false, `Staff fulfillment transition failed at "${next}".`, strict, warnings);
        break;
      }
    }
  }

  if (jsonOutput) {
    console.log(JSON.stringify(summary, null, 2));
  }
  if (strict && warnings.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
