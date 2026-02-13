"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startHttpServer = startHttpServer;
const node_http_1 = __importDefault(require("node:http"));
const node_url_1 = require("node:url");
const node_crypto_1 = __importDefault(require("node:crypto"));
const auth_1 = require("firebase-admin/auth");
const app_1 = require("firebase-admin/app");
const dashboard_1 = require("./dashboard");
const postgres_1 = require("../db/postgres");
const actorResolution_1 = require("../capabilities/actorResolution");
const draftPipeline_1 = require("../swarm/marketing/draftPipeline");
const intakeControls_1 = require("../swarm/trustSafety/intakeControls");
const triageAssistant_1 = require("../swarm/trustSafety/triageAssistant");
const policy_1 = require("../capabilities/policy");
const scorecard_1 = require("../observability/scorecard");
const auditExport_1 = require("../observability/auditExport");
const policyLint_1 = require("../observability/policyLint");
const policyMetadata_1 = require("../capabilities/policyMetadata");
function withSecurityHeaders(headers) {
    return {
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
        "cache-control": "no-store",
        ...headers,
    };
}
function parseIsoToMillis(value) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
}
async function readJsonBody(req) {
    const chunks = [];
    for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    if (!chunks.length)
        return {};
    const raw = Buffer.concat(chunks).toString("utf8");
    return JSON.parse(raw);
}
function parseActor(payload) {
    const ownerUid = String(payload.ownerUid ?? "unknown");
    const tenantIdRaw = typeof payload.tenantId === "string" ? payload.tenantId.trim() : "";
    return {
        actorType: String(payload.actorType ?? "staff"),
        actorId: String(payload.actorId ?? "unknown"),
        ownerUid,
        tenantId: tenantIdRaw || ownerUid,
        effectiveScopes: Array.isArray(payload.effectiveScopes)
            ? payload.effectiveScopes.map((scope) => String(scope))
            : [],
    };
}
function parseDelegation(payload) {
    if (!payload.delegation || typeof payload.delegation !== "object")
        return undefined;
    const row = payload.delegation;
    return {
        delegationId: typeof row.delegationId === "string" ? row.delegationId : undefined,
        agentUid: typeof row.agentUid === "string" ? row.agentUid : undefined,
        ownerUid: typeof row.ownerUid === "string" ? row.ownerUid : undefined,
        scopes: Array.isArray(row.scopes) ? row.scopes.map((scope) => String(scope)) : undefined,
        issuedAt: typeof row.issuedAt === "string" ? row.issuedAt : undefined,
        expiresAt: typeof row.expiresAt === "string" ? row.expiresAt : undefined,
        revokedAt: typeof row.revokedAt === "string" ? row.revokedAt : undefined,
    };
}
function firstHeader(value) {
    if (typeof value === "string")
        return value;
    if (Array.isArray(value) && value[0])
        return value[0];
    return undefined;
}
function ensureFirebaseAdminForAuth() {
    if ((0, app_1.getApps)().length > 0)
        return;
    (0, app_1.initializeApp)();
}
async function verifyFirebaseAuthHeader(authorizationHeader) {
    if (!authorizationHeader) {
        throw new Error("Missing Authorization header.");
    }
    const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
    if (!match || !match[1]) {
        throw new Error("Invalid Authorization header format.");
    }
    ensureFirebaseAdminForAuth();
    const decoded = await (0, auth_1.getAuth)().verifyIdToken(match[1]);
    const roles = Array.isArray(decoded.roles) ? decoded.roles.map((value) => String(value)) : [];
    const isStaff = decoded.staff === true || decoded.admin === true || roles.includes("staff") || roles.includes("admin");
    return {
        uid: decoded.uid,
        isStaff,
        roles,
    };
}
function startHttpServer(params) {
    const { host, port, logger, stateStore, eventStore, requireFreshSnapshotForReady = false, readyMaxSnapshotAgeMinutes = 240, pgCheck = postgres_1.checkPgConnection, getRuntimeStatus, getRuntimeMetrics, capabilityRuntime, allowedOrigins = [], adminToken, verifyFirebaseAuth = verifyFirebaseAuthHeader, endpointRateLimits, abuseQuotaStore = new policy_1.InMemoryQuotaStore(), pilotWriteExecutor = null, } = params;
    const rateLimits = {
        createProposalPerMinute: Math.max(1, endpointRateLimits?.createProposalPerMinute ?? 20),
        executeProposalPerMinute: Math.max(1, endpointRateLimits?.executeProposalPerMinute ?? 20),
        intakeOverridePerMinute: Math.max(1, endpointRateLimits?.intakeOverridePerMinute ?? 10),
        marketingReviewPerMinute: Math.max(1, endpointRateLimits?.marketingReviewPerMinute ?? 20),
    };
    const isOriginAllowed = (origin) => {
        if (!origin)
            return true;
        return allowedOrigins.includes(origin);
    };
    const corsHeadersFor = (origin) => {
        if (!origin || !isOriginAllowed(origin))
            return {};
        return {
            "access-control-allow-origin": origin,
            "access-control-allow-headers": "content-type, authorization, x-studio-brain-admin-token",
            "access-control-allow-methods": "GET,POST,OPTIONS",
            "access-control-max-age": "600",
            vary: "Origin",
        };
    };
    const assertCapabilityAuth = async (req) => {
        try {
            const authorizationHeader = Array.isArray(req.headers.authorization)
                ? req.headers.authorization[0]
                : req.headers.authorization;
            const principal = await verifyFirebaseAuth(authorizationHeader);
            if (!principal.isStaff) {
                return { ok: false, message: "Staff claim required for studio-brain capability endpoints." };
            }
            if (!adminToken || adminToken.trim().length === 0) {
                return { ok: true, principal };
            }
            const provided = req.headers["x-studio-brain-admin-token"];
            const token = Array.isArray(provided) ? provided[0] : provided;
            if (!token || token !== adminToken) {
                return { ok: false, message: "Missing or invalid studio-brain admin token." };
            }
            return { ok: true, principal };
        }
        catch (error) {
            return { ok: false, message: error instanceof Error ? error.message : String(error) };
        }
    };
    const server = node_http_1.default.createServer(async (req, res) => {
        const requestId = node_crypto_1.default.randomUUID();
        const startedAt = Date.now();
        const method = req.method ?? "GET";
        const url = new node_url_1.URL(req.url ?? "/", `http://${host}:${port}`);
        const originHeader = req.headers.origin ?? null;
        const corsHeaders = corsHeadersFor(originHeader);
        let statusCode = 500;
        try {
            const enforceRateLimit = async (bucket, limit, windowSeconds, actorId, capabilityId = null) => {
                const decision = await abuseQuotaStore.consume(bucket, limit, windowSeconds, Date.now());
                if (decision.allowed)
                    return { allowed: true, retryAfterSeconds: 0 };
                await eventStore.append({
                    actorType: "system",
                    actorId: "studio-brain",
                    action: "rate_limit_triggered",
                    rationale: "Endpoint abuse control triggered.",
                    target: "local",
                    approvalState: "required",
                    inputHash: bucket,
                    outputHash: null,
                    metadata: {
                        bucket,
                        actorId,
                        capabilityId,
                        limit,
                        windowSeconds,
                        retryAfterSeconds: decision.retryAfterSeconds,
                        method,
                        path: url.pathname,
                    },
                });
                return { allowed: false, retryAfterSeconds: decision.retryAfterSeconds };
            };
            if (method === "OPTIONS") {
                statusCode = isOriginAllowed(originHeader) ? 204 : 403;
                res.writeHead(statusCode, withSecurityHeaders({ ...corsHeaders, "x-request-id": requestId }));
                res.end();
                return;
            }
            if (method === "GET" && url.pathname === "/healthz") {
                statusCode = 200;
                res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                res.end(JSON.stringify({ ok: true, service: "studio-brain", at: new Date().toISOString() }));
                return;
            }
            if (method === "GET" && url.pathname === "/readyz") {
                const [pg, snapshot] = await Promise.all([pgCheck(), stateStore.getLatestStudioState()]);
                const generatedMillis = snapshot ? parseIsoToMillis(snapshot.generatedAt) : null;
                const snapshotAgeMinutes = generatedMillis === null ? null : Math.floor((Date.now() - generatedMillis) / 60_000);
                const hasFreshSnapshot = snapshotAgeMinutes !== null ? snapshotAgeMinutes <= readyMaxSnapshotAgeMinutes : false;
                const freshSnapshotSatisfied = requireFreshSnapshotForReady ? hasFreshSnapshot : true;
                const ok = pg.ok && freshSnapshotSatisfied;
                statusCode = ok ? 200 : 503;
                res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                res.end(JSON.stringify({
                    ok,
                    checks: {
                        postgres: pg,
                        snapshot: {
                            exists: Boolean(snapshot),
                            generatedAt: snapshot?.generatedAt ?? null,
                            ageMinutes: snapshotAgeMinutes,
                            maxAgeMinutes: readyMaxSnapshotAgeMinutes,
                            requireFresh: requireFreshSnapshotForReady,
                            fresh: hasFreshSnapshot,
                        },
                    },
                    at: new Date().toISOString(),
                }));
                return;
            }
            if (method === "GET" && url.pathname === "/api/studio-state/latest") {
                const snapshot = await stateStore.getLatestStudioState();
                statusCode = 200;
                res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                res.end(JSON.stringify({ ok: true, snapshot }));
                return;
            }
            if (capabilityRuntime && method === "GET" && url.pathname === "/api/capabilities") {
                const auth = await assertCapabilityAuth(req);
                if (!auth.ok) {
                    statusCode = 401;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: auth.message }));
                    return;
                }
                statusCode = 200;
                res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                res.end(JSON.stringify({
                    ok: true,
                    capabilities: capabilityRuntime.listCapabilities(),
                    proposals: await capabilityRuntime.listProposals(25),
                    policy: await capabilityRuntime.getPolicyState(),
                    connectors: await capabilityRuntime.listConnectorHealth(),
                }));
                return;
            }
            if (capabilityRuntime && method === "GET" && url.pathname === "/api/connectors/health") {
                const auth = await assertCapabilityAuth(req);
                if (!auth.ok) {
                    statusCode = 401;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: auth.message }));
                    return;
                }
                statusCode = 200;
                res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                res.end(JSON.stringify({ ok: true, connectors: await capabilityRuntime.listConnectorHealth() }));
                return;
            }
            if (capabilityRuntime && method === "GET" && url.pathname === "/api/capabilities/policy") {
                const auth = await assertCapabilityAuth(req);
                if (!auth.ok) {
                    statusCode = 401;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: auth.message }));
                    return;
                }
                statusCode = 200;
                res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                res.end(JSON.stringify({ ok: true, policy: await capabilityRuntime.getPolicyState() }));
                return;
            }
            if (capabilityRuntime && method === "GET" && url.pathname === "/api/capabilities/policy-lint") {
                const auth = await assertCapabilityAuth(req);
                if (!auth.ok) {
                    statusCode = 401;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: auth.message }));
                    return;
                }
                const capabilities = capabilityRuntime.listCapabilities();
                const violations = (0, policyLint_1.lintCapabilityPolicy)(capabilities, policyMetadata_1.capabilityPolicyMetadata);
                statusCode = 200;
                res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                res.end(JSON.stringify({
                    ok: true,
                    checkedAt: new Date().toISOString(),
                    capabilitiesChecked: capabilities.length,
                    violations,
                }));
                return;
            }
            if (capabilityRuntime && method === "GET" && url.pathname === "/api/capabilities/quotas") {
                const auth = await assertCapabilityAuth(req);
                if (!auth.ok) {
                    statusCode = 401;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: auth.message }));
                    return;
                }
                const limitRaw = Number(url.searchParams.get("limit") ?? "50");
                const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(Math.floor(limitRaw), 500)) : 50;
                statusCode = 200;
                res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                res.end(JSON.stringify({ ok: true, buckets: await capabilityRuntime.listQuotaBuckets(limit) }));
                return;
            }
            if (capabilityRuntime && method === "GET" && url.pathname === "/api/capabilities/audit") {
                const auth = await assertCapabilityAuth(req);
                if (!auth.ok) {
                    statusCode = 401;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: auth.message }));
                    return;
                }
                const limitRaw = Number(url.searchParams.get("limit") ?? "100");
                const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(Math.floor(limitRaw), 500)) : 100;
                const actionPrefix = String(url.searchParams.get("actionPrefix") ?? "").trim();
                const actorIdFilter = String(url.searchParams.get("actorId") ?? "").trim();
                const approvalFilter = String(url.searchParams.get("approvalState") ?? "").trim();
                const rows = await eventStore.listRecent(Math.max(limit * 4, 100));
                const capabilityRows = rows
                    .filter((row) => row.action.startsWith("capability."))
                    .filter((row) => (actionPrefix ? row.action.startsWith(actionPrefix) : true))
                    .filter((row) => (actorIdFilter ? row.actorId === actorIdFilter : true))
                    .filter((row) => (approvalFilter ? row.approvalState === approvalFilter : true))
                    .slice(0, limit);
                statusCode = 200;
                res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                res.end(JSON.stringify({ ok: true, rows: capabilityRows }));
                return;
            }
            if (capabilityRuntime && method === "GET" && url.pathname === "/api/capabilities/audit/export") {
                const auth = await assertCapabilityAuth(req);
                if (!auth.ok) {
                    statusCode = 401;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: auth.message }));
                    return;
                }
                const limitRaw = Number(url.searchParams.get("limit") ?? "1000");
                const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(Math.floor(limitRaw), 10_000)) : 1000;
                const rows = (await eventStore.listRecent(limit)).filter((row) => row.action.startsWith("capability."));
                const signingKey = process.env.STUDIO_BRAIN_EXPORT_SIGNING_KEY;
                const bundle = (0, auditExport_1.buildAuditExportBundle)(rows, { signingKey });
                await eventStore.append({
                    actorType: "staff",
                    actorId: auth.principal?.uid ?? "staff:unknown",
                    action: "studio_ops.audit_export_generated",
                    rationale: "Generated signed audit export bundle for staff review.",
                    target: "local",
                    approvalState: "approved",
                    inputHash: `${limit}`,
                    outputHash: bundle.manifest.payloadHash,
                    metadata: {
                        rowCount: bundle.manifest.rowCount,
                        payloadHash: bundle.manifest.payloadHash,
                        signatureAlgorithm: bundle.manifest.signatureAlgorithm,
                    },
                });
                statusCode = 200;
                res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                res.end(JSON.stringify({ ok: true, bundle }));
                return;
            }
            if (capabilityRuntime && method === "GET" && url.pathname === "/api/capabilities/delegation/traces") {
                const auth = await assertCapabilityAuth(req);
                if (!auth.ok) {
                    statusCode = 401;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: auth.message }));
                    return;
                }
                const limitRaw = Number(url.searchParams.get("limit") ?? "100");
                const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(Math.floor(limitRaw), 500)) : 100;
                const rows = await eventStore.listRecent(Math.max(limit * 4, 100));
                const traces = rows.filter((row) => row.action.startsWith("capability.delegation.")).slice(0, limit);
                statusCode = 200;
                res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                res.end(JSON.stringify({ ok: true, rows: traces }));
                return;
            }
            if (method === "GET" && url.pathname === "/api/capabilities/rate-limits/events") {
                const auth = await assertCapabilityAuth(req);
                if (!auth.ok) {
                    statusCode = 401;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: auth.message }));
                    return;
                }
                const limitRaw = Number(url.searchParams.get("limit") ?? "100");
                const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(Math.floor(limitRaw), 500)) : 100;
                const rows = await eventStore.listRecent(Math.max(limit * 6, 100));
                const matches = rows.filter((row) => row.action === "rate_limit_triggered").slice(0, limit);
                statusCode = 200;
                res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                res.end(JSON.stringify({ ok: true, rows: matches }));
                return;
            }
            if (capabilityRuntime && method === "GET" && url.pathname === "/api/ops/scorecard") {
                const auth = await assertCapabilityAuth(req);
                if (!auth.ok) {
                    statusCode = 401;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: auth.message }));
                    return;
                }
                const [snapshot, proposals, connectors, rows] = await Promise.all([
                    stateStore.getLatestStudioState(),
                    capabilityRuntime.listProposals(200),
                    capabilityRuntime.listConnectorHealth(),
                    eventStore.listRecent(1_000),
                ]);
                const previousScorecard = rows.find((row) => row.action === "studio_ops.scorecard_computed");
                const lastBreach = rows.find((row) => row.action === "studio_ops.scorecard_breach");
                const scorecard = (0, scorecard_1.computeScorecard)({
                    now: new Date(),
                    snapshotGeneratedAt: snapshot?.generatedAt ?? null,
                    proposals,
                    connectors,
                    auditRows: rows.filter((row) => row.action.startsWith("capability.")),
                    lastBreachAt: lastBreach?.at ?? null,
                });
                await eventStore.append({
                    actorType: "staff",
                    actorId: auth.principal?.uid ?? "staff:unknown",
                    action: "studio_ops.scorecard_computed",
                    rationale: "Computed v3 scorecard from snapshot + capability telemetry.",
                    target: "local",
                    approvalState: "approved",
                    inputHash: "scorecard:v3",
                    outputHash: null,
                    metadata: {
                        overallStatus: scorecard.overallStatus,
                        metricStates: scorecard.metrics.map((metric) => ({ key: metric.key, status: metric.status })),
                    },
                });
                const previousStatus = (previousScorecard?.metadata?.overallStatus ?? null);
                if (previousStatus && previousStatus === "ok" && scorecard.overallStatus !== "ok") {
                    await eventStore.append({
                        actorType: "staff",
                        actorId: auth.principal?.uid ?? "staff:unknown",
                        action: "studio_ops.scorecard_breach",
                        rationale: `Scorecard breached: ${scorecard.overallStatus}`,
                        target: "local",
                        approvalState: "approved",
                        inputHash: "scorecard:v3",
                        outputHash: null,
                        metadata: {
                            previousStatus,
                            currentStatus: scorecard.overallStatus,
                            reasonCode: "SLO_STATUS_DEGRADED",
                        },
                    });
                    scorecard.lastBreachAt = new Date().toISOString();
                }
                else if (previousStatus && previousStatus !== "ok" && scorecard.overallStatus === "ok") {
                    await eventStore.append({
                        actorType: "staff",
                        actorId: auth.principal?.uid ?? "staff:unknown",
                        action: "studio_ops.scorecard_recovered",
                        rationale: "Scorecard recovered to ok.",
                        target: "local",
                        approvalState: "approved",
                        inputHash: "scorecard:v3",
                        outputHash: null,
                        metadata: {
                            previousStatus,
                            currentStatus: scorecard.overallStatus,
                            reasonCode: "SLO_STATUS_RECOVERED",
                        },
                    });
                }
                statusCode = 200;
                res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                res.end(JSON.stringify({ ok: true, scorecard }));
                return;
            }
            if (method === "GET" && url.pathname === "/api/ops/recommendations/drafts") {
                const auth = await assertCapabilityAuth(req);
                if (!auth.ok) {
                    statusCode = 401;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: auth.message }));
                    return;
                }
                const limitRaw = Number(url.searchParams.get("limit") ?? "50");
                const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(Math.floor(limitRaw), 200)) : 50;
                const rows = await eventStore.listRecent(Math.max(limit * 5, 100));
                const drafts = rows
                    .filter((row) => row.action === "studio_ops.recommendation_draft_created")
                    .slice(0, limit)
                    .map((row) => ({
                    id: row.id,
                    at: row.at,
                    rationale: row.rationale,
                    ...(row.metadata ?? {}),
                }));
                statusCode = 200;
                res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                res.end(JSON.stringify({ ok: true, rows: drafts }));
                return;
            }
            if (method === "POST" && url.pathname === "/api/ops/drills") {
                const auth = await assertCapabilityAuth(req);
                if (!auth.ok) {
                    statusCode = 401;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: auth.message }));
                    return;
                }
                const body = await readJsonBody(req);
                const scenarioId = typeof body.scenarioId === "string" ? body.scenarioId.trim() : "";
                const status = typeof body.status === "string" ? body.status.trim() : "";
                if (!scenarioId || !status) {
                    statusCode = 400;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: "scenarioId and status are required." }));
                    return;
                }
                await eventStore.append({
                    actorType: "staff",
                    actorId: auth.principal?.uid ?? "staff:unknown",
                    action: "studio_ops.drill_event",
                    rationale: `Drill ${scenarioId} status=${status}.`,
                    target: "local",
                    approvalState: "approved",
                    inputHash: scenarioId,
                    outputHash: null,
                    metadata: {
                        scenarioId,
                        status,
                        outcome: typeof body.outcome === "string" ? body.outcome : null,
                        notes: typeof body.notes === "string" ? body.notes : null,
                        mttrMinutes: typeof body.mttrMinutes === "number" ? body.mttrMinutes : null,
                        unresolvedRisks: Array.isArray(body.unresolvedRisks) ? body.unresolvedRisks : [],
                    },
                });
                statusCode = 200;
                res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                res.end(JSON.stringify({ ok: true }));
                return;
            }
            if (method === "POST" && url.pathname === "/api/ops/degraded") {
                const auth = await assertCapabilityAuth(req);
                if (!auth.ok) {
                    statusCode = 401;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: auth.message }));
                    return;
                }
                const body = await readJsonBody(req);
                const status = typeof body.status === "string" ? body.status.trim() : "";
                const mode = typeof body.mode === "string" ? body.mode.trim() : "degraded";
                if (!status || (status !== "entered" && status !== "exited")) {
                    statusCode = 400;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: "status must be entered or exited." }));
                    return;
                }
                const action = status === "entered" ? "studio_ops.degraded_mode_entered" : "studio_ops.degraded_mode_exited";
                await eventStore.append({
                    actorType: "staff",
                    actorId: auth.principal?.uid ?? "staff:unknown",
                    action,
                    rationale: typeof body.rationale === "string" ? body.rationale : "Staff console reported degraded mode change.",
                    target: "local",
                    approvalState: "approved",
                    inputHash: `${status}:${mode}`,
                    outputHash: null,
                    metadata: {
                        status,
                        mode,
                        reason: typeof body.reason === "string" ? body.reason : null,
                        details: typeof body.details === "string" ? body.details : null,
                    },
                });
                statusCode = 200;
                res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                res.end(JSON.stringify({ ok: true }));
                return;
            }
            if (method === "GET" && url.pathname === "/api/ops/audit") {
                const auth = await assertCapabilityAuth(req);
                if (!auth.ok) {
                    statusCode = 401;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: auth.message }));
                    return;
                }
                const limitRaw = Number(url.searchParams.get("limit") ?? "50");
                const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(Math.floor(limitRaw), 200)) : 50;
                const actionPrefix = String(url.searchParams.get("actionPrefix") ?? "studio_ops.").trim();
                const rows = await eventStore.listRecent(Math.max(limit * 4, 100));
                const opsRows = rows
                    .filter((row) => row.action.startsWith(actionPrefix))
                    .slice(0, limit);
                statusCode = 200;
                res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                res.end(JSON.stringify({ ok: true, rows: opsRows }));
                return;
            }
            if (method === "GET" && url.pathname === "/api/ops/drills") {
                const auth = await assertCapabilityAuth(req);
                if (!auth.ok) {
                    statusCode = 401;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: auth.message }));
                    return;
                }
                const limitRaw = Number(url.searchParams.get("limit") ?? "50");
                const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(Math.floor(limitRaw), 200)) : 50;
                const rows = await eventStore.listRecent(Math.max(limit * 4, 100));
                const drills = rows
                    .filter((row) => row.action === "studio_ops.drill_event")
                    .slice(0, limit)
                    .map((row) => ({
                    id: row.id,
                    at: row.at,
                    scenarioId: row.metadata?.scenarioId ?? null,
                    status: row.metadata?.status ?? null,
                    outcome: row.metadata?.outcome ?? null,
                    notes: row.metadata?.notes ?? null,
                    mttrMinutes: row.metadata?.mttrMinutes ?? null,
                    unresolvedRisks: row.metadata?.unresolvedRisks ?? [],
                }));
                statusCode = 200;
                res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                res.end(JSON.stringify({ ok: true, rows: drills }));
                return;
            }
            if (method === "GET" && url.pathname === "/api/finance/reconciliation/drafts") {
                const auth = await assertCapabilityAuth(req);
                if (!auth.ok) {
                    statusCode = 401;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: auth.message }));
                    return;
                }
                const limitRaw = Number(url.searchParams.get("limit") ?? "50");
                const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(Math.floor(limitRaw), 200)) : 50;
                const rows = await eventStore.listRecent(Math.max(limit * 5, 100));
                const drafts = rows
                    .filter((row) => row.action === "studio_finance.reconciliation_draft_created")
                    .slice(0, limit)
                    .map((row) => {
                    const metadata = (row.metadata ?? {});
                    const { id: _ignored, ...rest } = metadata;
                    return {
                        id: row.id,
                        at: row.at,
                        ...rest,
                    };
                });
                statusCode = 200;
                res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                res.end(JSON.stringify({ ok: true, rows: drafts }));
                return;
            }
            if (method === "GET" && url.pathname === "/api/marketing/drafts") {
                const auth = await assertCapabilityAuth(req);
                if (!auth.ok) {
                    statusCode = 401;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: auth.message }));
                    return;
                }
                const limitRaw = Number(url.searchParams.get("limit") ?? "50");
                const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(Math.floor(limitRaw), 200)) : 50;
                const rows = await eventStore.listRecent(Math.max(limit * 6, 100));
                const created = rows.filter((row) => row.action === "studio_marketing.draft_created");
                const statusEvents = rows.filter((row) => row.action === "studio_marketing.draft_status_changed");
                const latestStatusByDraft = new Map();
                for (const row of statusEvents) {
                    const draftId = typeof row.metadata?.draftId === "string" ? row.metadata.draftId : "";
                    const toStatus = typeof row.metadata?.toStatus === "string" ? row.metadata.toStatus : null;
                    if (!draftId || !toStatus || latestStatusByDraft.has(draftId))
                        continue;
                    latestStatusByDraft.set(draftId, toStatus);
                }
                const drafts = created
                    .slice(0, limit)
                    .map((row) => {
                    const metadata = (row.metadata ?? {});
                    const draftId = typeof metadata.draftId === "string" ? metadata.draftId : row.id;
                    return {
                        id: row.id,
                        at: row.at,
                        ...metadata,
                        draftId,
                        status: latestStatusByDraft.get(draftId) ?? metadata.status ?? "draft",
                    };
                });
                statusCode = 200;
                res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                res.end(JSON.stringify({ ok: true, rows: drafts }));
                return;
            }
            if (method === "GET" && url.pathname === "/api/intake/review-queue") {
                const auth = await assertCapabilityAuth(req);
                if (!auth.ok) {
                    statusCode = 401;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: auth.message }));
                    return;
                }
                const limitRaw = Number(url.searchParams.get("limit") ?? "50");
                const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(Math.floor(limitRaw), 200)) : 50;
                const rows = await eventStore.listRecent(Math.max(limit * 8, 200));
                statusCode = 200;
                res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                res.end(JSON.stringify({ ok: true, rows: (0, intakeControls_1.buildIntakeQueue)(rows, limit) }));
                return;
            }
            if (method === "POST" && url.pathname === "/api/trust-safety/triage/suggest") {
                const auth = await assertCapabilityAuth(req);
                if (!auth.ok) {
                    statusCode = 401;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: auth.message }));
                    return;
                }
                const body = await readJsonBody(req);
                const reportId = typeof body.reportId === "string" ? body.reportId.trim() : "";
                const note = typeof body.note === "string" ? body.note : "";
                const targetTitle = typeof body.targetTitle === "string" ? body.targetTitle : "";
                const targetType = typeof body.targetType === "string" ? body.targetType : "";
                const suggestion = (0, triageAssistant_1.buildTriageSuggestion)({ note, targetTitle, targetType });
                await eventStore.append({
                    actorType: "staff",
                    actorId: auth.principal?.uid ?? "staff:unknown",
                    action: "trust_safety.triage_suggestion_generated",
                    rationale: `Generated suggestion for report ${reportId || "unknown"}.`,
                    target: "local",
                    approvalState: "approved",
                    inputHash: reportId || "unknown",
                    outputHash: suggestion.reasonCode,
                    metadata: {
                        reportId: reportId || null,
                        suggestion,
                    },
                });
                statusCode = 200;
                res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                res.end(JSON.stringify({ ok: true, suggestion }));
                return;
            }
            if (method === "POST" && url.pathname === "/api/trust-safety/triage/feedback") {
                const auth = await assertCapabilityAuth(req);
                if (!auth.ok) {
                    statusCode = 401;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: auth.message }));
                    return;
                }
                const body = await readJsonBody(req);
                const reportId = typeof body.reportId === "string" ? body.reportId.trim() : "";
                const decision = typeof body.decision === "string" ? body.decision.trim() : "";
                if (decision !== "accepted" && decision !== "rejected") {
                    statusCode = 400;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: "decision must be accepted or rejected." }));
                    return;
                }
                const mismatch = body.mismatch === true;
                await eventStore.append({
                    actorType: "staff",
                    actorId: auth.principal?.uid ?? "staff:unknown",
                    action: "trust_safety.triage_suggestion_feedback",
                    rationale: `Staff ${decision} triage suggestion.`,
                    target: "local",
                    approvalState: "approved",
                    inputHash: reportId || "unknown",
                    outputHash: null,
                    metadata: {
                        reportId: reportId || null,
                        decision,
                        mismatch,
                        suggestedSeverity: typeof body.suggestedSeverity === "string" ? body.suggestedSeverity : null,
                        suggestedCategory: typeof body.suggestedCategory === "string" ? body.suggestedCategory : null,
                        suggestedReasonCode: typeof body.suggestedReasonCode === "string" ? body.suggestedReasonCode : null,
                        finalSeverity: typeof body.finalSeverity === "string" ? body.finalSeverity : null,
                        finalCategory: typeof body.finalCategory === "string" ? body.finalCategory : null,
                        finalReasonCode: typeof body.finalReasonCode === "string" ? body.finalReasonCode : null,
                    },
                });
                statusCode = 200;
                res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                res.end(JSON.stringify({ ok: true }));
                return;
            }
            if (method === "GET" && url.pathname === "/api/trust-safety/triage/stats") {
                const auth = await assertCapabilityAuth(req);
                if (!auth.ok) {
                    statusCode = 401;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: auth.message }));
                    return;
                }
                const limitRaw = Number(url.searchParams.get("limit") ?? "500");
                const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(Math.floor(limitRaw), 5000)) : 500;
                const rows = await eventStore.listRecent(limit);
                const stats = (0, triageAssistant_1.computeSuggestionFeedbackStats)(rows);
                statusCode = 200;
                res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                res.end(JSON.stringify({ ok: true, stats }));
                return;
            }
            const intakeOverrideMatch = url.pathname.match(/^\/api\/intake\/review-queue\/([^/]+)\/override$/);
            if (method === "POST" && intakeOverrideMatch) {
                const auth = await assertCapabilityAuth(req);
                if (!auth.ok) {
                    statusCode = 401;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: auth.message }));
                    return;
                }
                const body = await readJsonBody(req);
                const intakeThrottle = await enforceRateLimit(`rate:${auth.principal?.uid ?? "staff:unknown"}:intake_override`, rateLimits.intakeOverridePerMinute, 60, auth.principal?.uid ?? "staff:unknown");
                if (!intakeThrottle.allowed) {
                    statusCode = 429;
                    res.writeHead(statusCode, withSecurityHeaders({
                        "content-type": "application/json",
                        "retry-after": String(intakeThrottle.retryAfterSeconds),
                        ...corsHeaders,
                        "x-request-id": requestId,
                    }));
                    res.end(JSON.stringify({ ok: false, reasonCode: "RATE_LIMITED", retryAfterSeconds: intakeThrottle.retryAfterSeconds }));
                    return;
                }
                const decision = typeof body.decision === "string" ? body.decision : null;
                const reasonCode = typeof body.reasonCode === "string" ? body.reasonCode.trim() : "";
                const rationale = typeof body.rationale === "string" ? body.rationale.trim() : "";
                if (!decision || !["override_granted", "override_denied"].includes(decision)) {
                    statusCode = 400;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: "Valid decision is required." }));
                    return;
                }
                if (rationale.length < 10 || !(0, intakeControls_1.isValidOverrideTransition)(decision, reasonCode)) {
                    statusCode = 400;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: "Valid reasonCode and rationale are required." }));
                    return;
                }
                const intakeId = decodeURIComponent(intakeOverrideMatch[1]);
                await eventStore.append({
                    actorType: "staff",
                    actorId: auth.principal?.uid ?? "staff:unknown",
                    action: decision === "override_granted" ? "intake.override_granted" : "intake.override_denied",
                    rationale,
                    target: "local",
                    approvalState: decision === "override_granted" ? "approved" : "rejected",
                    inputHash: intakeId,
                    outputHash: reasonCode,
                    metadata: {
                        intakeId,
                        reasonCode,
                    },
                });
                statusCode = 200;
                res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                res.end(JSON.stringify({ ok: true, intakeId, decision, reasonCode }));
                return;
            }
            const marketingReviewMatch = url.pathname.match(/^\/api\/marketing\/drafts\/([^/]+)\/review$/);
            if (method === "POST" && marketingReviewMatch) {
                const auth = await assertCapabilityAuth(req);
                if (!auth.ok) {
                    statusCode = 401;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: auth.message }));
                    return;
                }
                const body = await readJsonBody(req);
                const marketingThrottle = await enforceRateLimit(`rate:${auth.principal?.uid ?? "staff:unknown"}:marketing_review`, rateLimits.marketingReviewPerMinute, 60, auth.principal?.uid ?? "staff:unknown");
                if (!marketingThrottle.allowed) {
                    statusCode = 429;
                    res.writeHead(statusCode, withSecurityHeaders({
                        "content-type": "application/json",
                        "retry-after": String(marketingThrottle.retryAfterSeconds),
                        ...corsHeaders,
                        "x-request-id": requestId,
                    }));
                    res.end(JSON.stringify({ ok: false, reasonCode: "RATE_LIMITED", retryAfterSeconds: marketingThrottle.retryAfterSeconds }));
                    return;
                }
                const toStatus = typeof body.toStatus === "string" ? body.toStatus : null;
                const rationale = typeof body.rationale === "string" ? body.rationale.trim() : "";
                if (!toStatus || !["draft", "needs_review", "approved_for_publish"].includes(toStatus)) {
                    statusCode = 400;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: "Valid toStatus is required." }));
                    return;
                }
                if (rationale.length < 10) {
                    statusCode = 400;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: "Review rationale must be at least 10 characters." }));
                    return;
                }
                const draftId = decodeURIComponent(marketingReviewMatch[1]);
                const rows = await eventStore.listRecent(500);
                const existing = rows.find((row) => row.action === "studio_marketing.draft_created" && row.metadata?.draftId === draftId);
                if (!existing) {
                    statusCode = 404;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: "Draft not found." }));
                    return;
                }
                const latestStatusEvent = rows.find((row) => row.action === "studio_marketing.draft_status_changed" && row.metadata?.draftId === draftId);
                const fromStatus = latestStatusEvent?.metadata?.toStatus ?? "draft";
                if (!(0, draftPipeline_1.canTransitionDraftStatus)(fromStatus, toStatus)) {
                    statusCode = 409;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: `Invalid status transition ${fromStatus} -> ${toStatus}.` }));
                    return;
                }
                await eventStore.append({
                    actorType: "staff",
                    actorId: auth.principal?.uid ?? "staff:unknown",
                    action: "studio_marketing.draft_status_changed",
                    rationale,
                    target: "local",
                    approvalState: "approved",
                    inputHash: draftId,
                    outputHash: toStatus,
                    metadata: {
                        draftId,
                        fromStatus,
                        toStatus,
                    },
                });
                statusCode = 200;
                res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                res.end(JSON.stringify({ ok: true, draftId, fromStatus, toStatus }));
                return;
            }
            if (capabilityRuntime && method === "POST" && url.pathname === "/api/capabilities/proposals") {
                const auth = await assertCapabilityAuth(req);
                if (!auth.ok) {
                    statusCode = 401;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: auth.message }));
                    return;
                }
                const body = await readJsonBody(req);
                const actorFromBody = parseActor(body);
                const principalUid = auth.principal?.uid ?? actorFromBody.actorId;
                const capabilityId = String(body.capabilityId ?? "");
                const actorDecision = (0, actorResolution_1.resolveCapabilityActor)({
                    actorType: String(body.actorType ?? "staff"),
                    actorUid: String(body.actorId ?? principalUid),
                    ownerUid: String(body.ownerUid ?? principalUid),
                    tenantId: String(body.tenantId ?? body.ownerUid ?? principalUid),
                    capabilityId,
                    principalUid,
                    delegation: parseDelegation(body),
                });
                if (!actorDecision.allowed || !actorDecision.actor) {
                    await eventStore.append({
                        actorType: "staff",
                        actorId: principalUid,
                        action: "capability.delegation.denied",
                        rationale: `proposal_create:${actorDecision.reasonCode}`,
                        target: "local",
                        approvalState: "required",
                        inputHash: actorDecision.reasonCode,
                        outputHash: null,
                        metadata: actorDecision.trace,
                    });
                    statusCode = 403;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: "Delegation denied.", reasonCode: actorDecision.reasonCode, trace: actorDecision.trace }));
                    return;
                }
                const actor = actorDecision.actor;
                const createThrottle = await enforceRateLimit(`rate:${principalUid}:capability_create:${capabilityId}`, rateLimits.createProposalPerMinute, 60, actor.actorId, capabilityId);
                if (!createThrottle.allowed) {
                    statusCode = 429;
                    res.writeHead(statusCode, withSecurityHeaders({
                        "content-type": "application/json",
                        "retry-after": String(createThrottle.retryAfterSeconds),
                        ...corsHeaders,
                        "x-request-id": requestId,
                    }));
                    res.end(JSON.stringify({ ok: false, reasonCode: "RATE_LIMITED", retryAfterSeconds: createThrottle.retryAfterSeconds }));
                    return;
                }
                if (actor.actorType === "agent") {
                    const intake = (0, intakeControls_1.classifyIntakeRisk)({
                        actorId: actor.actorId,
                        ownerUid: actor.ownerUid,
                        capabilityId,
                        rationale: String(body.rationale ?? ""),
                        previewSummary: String(body.previewSummary ?? ""),
                        requestInput: (body.requestInput ?? {}),
                    });
                    await eventStore.append({
                        actorType: "system",
                        actorId: "studio-brain",
                        action: "intake.classified",
                        rationale: `Agent intake classified as ${intake.category}.`,
                        target: "local",
                        approvalState: intake.blocked ? "required" : "exempt",
                        inputHash: intake.intakeId,
                        outputHash: intake.reasonCode,
                        metadata: {
                            ...intake,
                            capabilityId,
                            actorId: actor.actorId,
                            ownerUid: actor.ownerUid,
                        },
                    });
                    if (intake.blocked) {
                        const recentEvents = await eventStore.listRecent(300);
                        if (!(0, intakeControls_1.hasOverrideGrant)(recentEvents, intake.intakeId)) {
                            await eventStore.append({
                                actorType: "system",
                                actorId: "studio-brain",
                                action: "intake.routed_to_review",
                                rationale: `Blocked high-risk intake (${intake.category}) for manual review.`,
                                target: "local",
                                approvalState: "required",
                                inputHash: intake.intakeId,
                                outputHash: intake.reasonCode,
                                metadata: {
                                    intakeId: intake.intakeId,
                                    category: intake.category,
                                    reasonCode: intake.reasonCode,
                                    capabilityId,
                                    actorId: actor.actorId,
                                    ownerUid: actor.ownerUid,
                                    summary: intake.summary,
                                },
                            });
                            statusCode = 403;
                            res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                            res.end(JSON.stringify({
                                ok: false,
                                message: "Blocked by intake policy pending manual review.",
                                reasonCode: "BLOCKED_BY_INTAKE_POLICY",
                                intakeId: intake.intakeId,
                                category: intake.category,
                            }));
                            return;
                        }
                    }
                }
                const result = await capabilityRuntime.create(actor, {
                    capabilityId,
                    rationale: String(body.rationale ?? ""),
                    previewSummary: String(body.previewSummary ?? ""),
                    requestInput: body.requestInput ?? {},
                    expectedEffects: Array.isArray(body.expectedEffects) ? body.expectedEffects.map((x) => String(x)) : [],
                    requestedBy: principalUid,
                });
                statusCode = result.proposal ? 201 : 400;
                res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                res.end(JSON.stringify({ ok: Boolean(result.proposal), ...result }));
                return;
            }
            const approveMatch = url.pathname.match(/^\/api\/capabilities\/proposals\/([^/]+)\/approve$/);
            if (capabilityRuntime && method === "POST" && approveMatch) {
                const auth = await assertCapabilityAuth(req);
                if (!auth.ok) {
                    statusCode = 401;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: auth.message }));
                    return;
                }
                const body = await readJsonBody(req);
                const rationale = typeof body.rationale === "string" ? body.rationale.trim() : "";
                if (rationale.length < 10) {
                    statusCode = 400;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: "Approval rationale must be at least 10 characters." }));
                    return;
                }
                const proposal = await capabilityRuntime.approve(approveMatch[1], auth.principal?.uid ?? String(body.approvedBy ?? "staff:unknown"), rationale);
                statusCode = proposal ? 200 : 404;
                res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                res.end(JSON.stringify({ ok: Boolean(proposal), proposal }));
                return;
            }
            const rejectMatch = url.pathname.match(/^\/api\/capabilities\/proposals\/([^/]+)\/reject$/);
            if (capabilityRuntime && method === "POST" && rejectMatch) {
                const auth = await assertCapabilityAuth(req);
                if (!auth.ok) {
                    statusCode = 401;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: auth.message }));
                    return;
                }
                const body = await readJsonBody(req);
                const reason = typeof body.reason === "string" ? body.reason : null;
                if (!reason || reason.trim().length < 10) {
                    statusCode = 400;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: "Rejection reason must be at least 10 characters." }));
                    return;
                }
                const proposal = await capabilityRuntime.reject(rejectMatch[1], auth.principal?.uid ?? "staff:unknown", reason);
                statusCode = proposal ? 200 : 404;
                res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                res.end(JSON.stringify({ ok: Boolean(proposal), proposal }));
                return;
            }
            const reopenMatch = url.pathname.match(/^\/api\/capabilities\/proposals\/([^/]+)\/reopen$/);
            if (capabilityRuntime && method === "POST" && reopenMatch) {
                const auth = await assertCapabilityAuth(req);
                if (!auth.ok) {
                    statusCode = 401;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: auth.message }));
                    return;
                }
                const isAdmin = (auth.principal?.roles ?? []).includes("admin");
                if (!isAdmin) {
                    statusCode = 403;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: "Admin role required to reopen rejected proposals." }));
                    return;
                }
                const body = await readJsonBody(req);
                const reason = typeof body.reason === "string" ? body.reason.trim() : "";
                if (reason.length < 10) {
                    statusCode = 400;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: "Reopen reason must be at least 10 characters." }));
                    return;
                }
                const proposal = await capabilityRuntime.reopen(reopenMatch[1], auth.principal?.uid ?? "staff:unknown", reason);
                statusCode = proposal ? 200 : 404;
                res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                res.end(JSON.stringify({ ok: Boolean(proposal), proposal }));
                return;
            }
            const dryRunMatch = url.pathname.match(/^\/api\/capabilities\/proposals\/([^/]+)\/dry-run$/);
            if (capabilityRuntime && method === "GET" && dryRunMatch) {
                const auth = await assertCapabilityAuth(req);
                if (!auth.ok) {
                    statusCode = 401;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: auth.message }));
                    return;
                }
                const proposal = await capabilityRuntime.getProposal(dryRunMatch[1]);
                if (!proposal) {
                    statusCode = 404;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: "Proposal not found." }));
                    return;
                }
                if (proposal.capabilityId !== "firestore.ops_note.append") {
                    statusCode = 400;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: "Dry-run is only supported for pilot write capability." }));
                    return;
                }
                if (!pilotWriteExecutor) {
                    statusCode = 503;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: "Pilot write executor unavailable." }));
                    return;
                }
                const dryRun = pilotWriteExecutor.dryRun(proposal.preview.input);
                await eventStore.append({
                    actorType: "staff",
                    actorId: auth.principal?.uid ?? "staff:unknown",
                    action: "studio_ops.pilot_dry_run_generated",
                    rationale: `Dry-run generated for proposal ${proposal.id}.`,
                    target: "local",
                    approvalState: "required",
                    inputHash: proposal.inputHash,
                    outputHash: node_crypto_1.default.createHash("sha256").update(JSON.stringify(dryRun)).digest("hex"),
                    metadata: {
                        proposalId: proposal.id,
                        capabilityId: proposal.capabilityId,
                        tenantId: proposal.tenantId,
                        dryRun,
                    },
                });
                statusCode = 200;
                res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                res.end(JSON.stringify({ ok: true, proposalId: proposal.id, dryRun }));
                return;
            }
            const rollbackMatch = url.pathname.match(/^\/api\/capabilities\/proposals\/([^/]+)\/rollback$/);
            if (capabilityRuntime && method === "POST" && rollbackMatch) {
                const auth = await assertCapabilityAuth(req);
                if (!auth.ok) {
                    statusCode = 401;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: auth.message }));
                    return;
                }
                const proposal = await capabilityRuntime.getProposal(rollbackMatch[1]);
                if (!proposal) {
                    statusCode = 404;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: "Proposal not found." }));
                    return;
                }
                if (proposal.capabilityId !== "firestore.ops_note.append") {
                    statusCode = 400;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: "Rollback is only supported for pilot write capability." }));
                    return;
                }
                if (!pilotWriteExecutor) {
                    statusCode = 503;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: "Pilot write executor unavailable." }));
                    return;
                }
                const body = await readJsonBody(req);
                const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
                const reason = typeof body.reason === "string" ? body.reason.trim() : "";
                if (idempotencyKey.length < 8 || reason.length < 10) {
                    statusCode = 400;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: "idempotencyKey and reason are required." }));
                    return;
                }
                const rollback = await pilotWriteExecutor.rollback({
                    proposalId: proposal.id,
                    idempotencyKey,
                    reason,
                    actorUid: auth.principal?.uid ?? "staff:unknown",
                    authorizationHeader: firstHeader(req.headers.authorization),
                    adminToken: firstHeader(req.headers["x-studio-brain-admin-token"]),
                });
                await eventStore.append({
                    actorType: "staff",
                    actorId: auth.principal?.uid ?? "staff:unknown",
                    action: "studio_ops.pilot_rollback_invoked",
                    rationale: reason,
                    target: "local",
                    approvalState: "approved",
                    inputHash: idempotencyKey,
                    outputHash: null,
                    metadata: {
                        proposalId: proposal.id,
                        tenantId: proposal.tenantId,
                        idempotencyKey,
                        replayed: rollback.replayed,
                    },
                });
                statusCode = 200;
                res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                res.end(JSON.stringify({ ok: true, replayed: rollback.replayed }));
                return;
            }
            const executeMatch = url.pathname.match(/^\/api\/capabilities\/proposals\/([^/]+)\/execute$/);
            if (capabilityRuntime && method === "POST" && executeMatch) {
                const auth = await assertCapabilityAuth(req);
                if (!auth.ok) {
                    statusCode = 401;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: auth.message }));
                    return;
                }
                const body = await readJsonBody(req);
                const actorFromBody = parseActor(body);
                const principalUid = auth.principal?.uid ?? actorFromBody.actorId;
                const proposal = await capabilityRuntime.getProposal(executeMatch[1]);
                if (!proposal) {
                    statusCode = 404;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: "Proposal not found." }));
                    return;
                }
                const actorDecision = (0, actorResolution_1.resolveCapabilityActor)({
                    actorType: String(body.actorType ?? "staff"),
                    actorUid: String(body.actorId ?? principalUid),
                    ownerUid: String(body.ownerUid ?? principalUid),
                    tenantId: String(body.tenantId ?? body.ownerUid ?? principalUid),
                    capabilityId: proposal.capabilityId,
                    principalUid,
                    delegation: parseDelegation(body),
                });
                if (!actorDecision.allowed || !actorDecision.actor) {
                    await eventStore.append({
                        actorType: "staff",
                        actorId: principalUid,
                        action: "capability.delegation.denied",
                        rationale: `proposal_execute:${actorDecision.reasonCode}`,
                        target: "local",
                        approvalState: "required",
                        inputHash: actorDecision.reasonCode,
                        outputHash: null,
                        metadata: {
                            proposalId: executeMatch[1],
                            ...actorDecision.trace,
                        },
                    });
                    statusCode = 403;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: "Delegation denied.", reasonCode: actorDecision.reasonCode, trace: actorDecision.trace }));
                    return;
                }
                const actor = actorDecision.actor;
                const executeThrottle = await enforceRateLimit(`rate:${principalUid}:capability_execute:${proposal.capabilityId}`, rateLimits.executeProposalPerMinute, 60, actor.actorId, proposal.capabilityId);
                if (!executeThrottle.allowed) {
                    statusCode = 429;
                    res.writeHead(statusCode, withSecurityHeaders({
                        "content-type": "application/json",
                        "retry-after": String(executeThrottle.retryAfterSeconds),
                        ...corsHeaders,
                        "x-request-id": requestId,
                    }));
                    res.end(JSON.stringify({ ok: false, reasonCode: "RATE_LIMITED", retryAfterSeconds: executeThrottle.retryAfterSeconds }));
                    return;
                }
                if (actor.actorType === "agent") {
                    const intake = (0, intakeControls_1.classifyIntakeRisk)({
                        actorId: actor.actorId,
                        ownerUid: actor.ownerUid,
                        capabilityId: proposal.capabilityId,
                        rationale: proposal.rationale,
                        previewSummary: proposal.preview.summary,
                        requestInput: proposal.preview.input,
                    });
                    const recentEvents = await eventStore.listRecent(300);
                    if (intake.blocked && !(0, intakeControls_1.hasOverrideGrant)(recentEvents, intake.intakeId)) {
                        await eventStore.append({
                            actorType: "system",
                            actorId: "studio-brain",
                            action: "intake.routed_to_review",
                            rationale: `Blocked execute for high-risk intake (${intake.category}) without override.`,
                            target: "local",
                            approvalState: "required",
                            inputHash: intake.intakeId,
                            outputHash: intake.reasonCode,
                            metadata: {
                                intakeId: intake.intakeId,
                                category: intake.category,
                                reasonCode: intake.reasonCode,
                                capabilityId: proposal.capabilityId,
                                actorId: actor.actorId,
                                ownerUid: actor.ownerUid,
                                summary: intake.summary,
                            },
                        });
                        statusCode = 403;
                        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                        res.end(JSON.stringify({
                            ok: false,
                            message: "Blocked by intake policy pending manual review.",
                            reasonCode: "BLOCKED_BY_INTAKE_POLICY",
                            intakeId: intake.intakeId,
                            category: intake.category,
                        }));
                        return;
                    }
                }
                const output = body.output ?? {};
                if (proposal.capabilityId === "firestore.ops_note.append") {
                    if (!pilotWriteExecutor) {
                        statusCode = 503;
                        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                        res.end(JSON.stringify({ ok: false, message: "Pilot write executor unavailable." }));
                        return;
                    }
                    const idempotencyKeyRaw = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
                    const idempotencyKey = idempotencyKeyRaw || `pilot-${requestId}`;
                    const pilotDryRun = pilotWriteExecutor.dryRun(proposal.preview.input);
                    if (proposal.status !== "approved") {
                        statusCode = 409;
                        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                        res.end(JSON.stringify({ ok: false, message: "Pilot write requires approved proposal before execution." }));
                        return;
                    }
                    await eventStore.append({
                        actorType: "staff",
                        actorId: auth.principal?.uid ?? "staff:unknown",
                        action: "studio_ops.pilot_execution_requested",
                        rationale: `Pilot write execution requested for proposal ${proposal.id}.`,
                        target: "local",
                        approvalState: "approved",
                        inputHash: idempotencyKey,
                        outputHash: null,
                        metadata: {
                            proposalId: proposal.id,
                            tenantId: proposal.tenantId,
                            approvalId: proposal.approvedAt ?? null,
                            idempotencyKey,
                            resourcePointer: {
                                collection: pilotDryRun.resourceCollection,
                                docId: pilotDryRun.resourceId,
                            },
                        },
                    });
                    try {
                        const pilotExecution = await pilotWriteExecutor.execute({
                            proposalId: proposal.id,
                            approvedBy: proposal.approvedBy ?? null,
                            approvedAt: proposal.approvedAt ?? null,
                            idempotencyKey,
                            actorUid: auth.principal?.uid ?? "staff:unknown",
                            pilotInput: proposal.preview.input,
                            authorizationHeader: firstHeader(req.headers.authorization),
                            adminToken: firstHeader(req.headers["x-studio-brain-admin-token"]),
                        });
                        output.externalWrite = pilotExecution;
                        output.idempotencyKey = idempotencyKey;
                        await eventStore.append({
                            actorType: "staff",
                            actorId: auth.principal?.uid ?? "staff:unknown",
                            action: "studio_ops.pilot_execution_succeeded",
                            rationale: `Pilot write execution succeeded for proposal ${proposal.id}.`,
                            target: "local",
                            approvalState: "approved",
                            inputHash: idempotencyKey,
                            outputHash: pilotExecution.resourcePointer.docId,
                            metadata: {
                                proposalId: proposal.id,
                                tenantId: proposal.tenantId,
                                approvalId: proposal.approvedAt ?? null,
                                idempotencyKey,
                                resourcePointer: pilotExecution.resourcePointer,
                                replayed: pilotExecution.replayed,
                            },
                        });
                    }
                    catch (error) {
                        await eventStore.append({
                            actorType: "staff",
                            actorId: auth.principal?.uid ?? "staff:unknown",
                            action: "studio_ops.pilot_execution_failed",
                            rationale: `Pilot write execution failed for proposal ${proposal.id}.`,
                            target: "local",
                            approvalState: "required",
                            inputHash: idempotencyKey,
                            outputHash: null,
                            metadata: {
                                proposalId: proposal.id,
                                tenantId: proposal.tenantId,
                                approvalId: proposal.approvedAt ?? null,
                                idempotencyKey,
                                error: error instanceof Error ? error.message : String(error),
                            },
                        });
                        statusCode = 502;
                        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                        res.end(JSON.stringify({ ok: false, message: error instanceof Error ? error.message : String(error) }));
                        return;
                    }
                }
                const result = await capabilityRuntime.execute(executeMatch[1], actor, output);
                if (!result.decision.allowed && result.decision.reasonCode === "TENANT_MISMATCH" && result.proposal) {
                    await eventStore.append({
                        actorType: "staff",
                        actorId: auth.principal?.uid ?? "staff:unknown",
                        action: "studio_ops.cross_tenant_denied",
                        rationale: "Cross-tenant capability execution denied by policy.",
                        target: "local",
                        approvalState: "required",
                        inputHash: result.proposal.id,
                        outputHash: null,
                        metadata: {
                            proposalId: result.proposal.id,
                            capabilityId: result.proposal.capabilityId,
                            proposalTenantId: result.proposal.tenantId,
                            actorTenantId: actor.tenantId ?? actor.ownerUid,
                        },
                    });
                }
                statusCode = result.proposal ? (result.decision.allowed ? 200 : 409) : 404;
                res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                res.end(JSON.stringify({ ok: result.decision.allowed, ...result }));
                return;
            }
            if (capabilityRuntime && method === "POST" && url.pathname === "/api/capabilities/policy/kill-switch") {
                const auth = await assertCapabilityAuth(req);
                if (!auth.ok) {
                    statusCode = 401;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: auth.message }));
                    return;
                }
                const body = await readJsonBody(req);
                const enabled = body.enabled === true;
                const rationale = typeof body.rationale === "string" ? body.rationale.trim() : "";
                if (rationale.length < 10) {
                    statusCode = 400;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: "Kill switch rationale must be at least 10 characters." }));
                    return;
                }
                const killSwitch = await capabilityRuntime.setKillSwitch(enabled, auth.principal?.uid ?? "staff:unknown", rationale);
                statusCode = 200;
                res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                res.end(JSON.stringify({ ok: true, killSwitch }));
                return;
            }
            if (capabilityRuntime && method === "POST" && url.pathname === "/api/capabilities/policy/exemptions") {
                const auth = await assertCapabilityAuth(req);
                if (!auth.ok) {
                    statusCode = 401;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: auth.message }));
                    return;
                }
                const body = await readJsonBody(req);
                const capabilityId = typeof body.capabilityId === "string" ? body.capabilityId.trim() : "";
                const ownerUidRaw = typeof body.ownerUid === "string" ? body.ownerUid.trim() : "";
                const justification = typeof body.justification === "string" ? body.justification.trim() : "";
                const expiresAt = typeof body.expiresAt === "string" && body.expiresAt.trim() ? body.expiresAt.trim() : undefined;
                if (!capabilityId || justification.length < 10) {
                    statusCode = 400;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: "capabilityId and justification (>=10 chars) are required." }));
                    return;
                }
                const exemption = await capabilityRuntime.createExemption({
                    capabilityId,
                    ownerUid: ownerUidRaw || undefined,
                    justification,
                    approvedBy: auth.principal?.uid ?? "staff:unknown",
                    expiresAt,
                });
                statusCode = 201;
                res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                res.end(JSON.stringify({ ok: true, exemption }));
                return;
            }
            const revokeExemptionMatch = url.pathname.match(/^\/api\/capabilities\/policy\/exemptions\/([^/]+)\/revoke$/);
            if (capabilityRuntime && method === "POST" && revokeExemptionMatch) {
                const auth = await assertCapabilityAuth(req);
                if (!auth.ok) {
                    statusCode = 401;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: auth.message }));
                    return;
                }
                const body = await readJsonBody(req);
                const reason = typeof body.reason === "string" ? body.reason.trim() : "";
                if (reason.length < 10) {
                    statusCode = 400;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: "Revocation reason must be at least 10 characters." }));
                    return;
                }
                const exemption = await capabilityRuntime.revokeExemption(decodeURIComponent(revokeExemptionMatch[1]), auth.principal?.uid ?? "staff:unknown", reason);
                statusCode = exemption ? 200 : 404;
                res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                res.end(JSON.stringify({ ok: Boolean(exemption), exemption }));
                return;
            }
            const resetQuotaMatch = url.pathname.match(/^\/api\/capabilities\/quotas\/([^/]+)\/reset$/);
            if (capabilityRuntime && method === "POST" && resetQuotaMatch) {
                const auth = await assertCapabilityAuth(req);
                if (!auth.ok) {
                    statusCode = 401;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: auth.message }));
                    return;
                }
                const body = await readJsonBody(req);
                const reason = typeof body.reason === "string" ? body.reason.trim() : "";
                if (!reason) {
                    statusCode = 400;
                    res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                    res.end(JSON.stringify({ ok: false, message: "Reset reason is required." }));
                    return;
                }
                const bucket = decodeURIComponent(resetQuotaMatch[1]);
                const reset = await capabilityRuntime.resetQuotaBucket(bucket);
                if (reset) {
                    await eventStore.append({
                        actorType: "staff",
                        actorId: auth.principal?.uid ?? "staff:unknown",
                        action: "capability.quota.reset",
                        rationale: reason,
                        target: "local",
                        approvalState: "exempt",
                        inputHash: bucket,
                        outputHash: null,
                        metadata: {
                            bucket,
                            reason,
                        },
                    });
                }
                statusCode = reset ? 200 : 404;
                res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                res.end(JSON.stringify({ ok: reset, bucket }));
                return;
            }
            if (method === "GET" && url.pathname === "/api/status") {
                const [snapshot, jobRuns, runtime] = await Promise.all([
                    stateStore.getLatestStudioState(),
                    stateStore.listRecentJobRuns(10),
                    getRuntimeStatus ? getRuntimeStatus() : Promise.resolve({}),
                ]);
                statusCode = 200;
                res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                res.end(JSON.stringify({
                    ok: true,
                    at: new Date().toISOString(),
                    snapshot: snapshot
                        ? {
                            snapshotDate: snapshot.snapshotDate,
                            generatedAt: snapshot.generatedAt,
                            completeness: snapshot.diagnostics?.completeness ?? "full",
                            warningCount: snapshot.diagnostics?.warnings.length ?? 0,
                        }
                        : null,
                    jobRuns,
                    runtime,
                }));
                return;
            }
            if (method === "GET" && url.pathname === "/api/metrics") {
                const snapshot = await stateStore.getLatestStudioState();
                const runtime = getRuntimeMetrics ? await getRuntimeMetrics() : {};
                statusCode = 200;
                res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
                res.end(JSON.stringify({
                    ok: true,
                    at: new Date().toISOString(),
                    metrics: {
                        process: {
                            pid: process.pid,
                            uptimeSec: Math.floor(process.uptime()),
                            memory: process.memoryUsage(),
                            cpu: process.cpuUsage(),
                        },
                        snapshot: {
                            exists: Boolean(snapshot),
                            generatedAt: snapshot?.generatedAt ?? null,
                            completeness: snapshot?.diagnostics?.completeness ?? null,
                            warningCount: snapshot?.diagnostics?.warnings.length ?? 0,
                        },
                        runtime,
                    },
                }));
                return;
            }
            if (method === "GET" && url.pathname === "/dashboard") {
                const html = await (0, dashboard_1.renderDashboard)(stateStore, eventStore, {
                    staleThresholdMinutes: readyMaxSnapshotAgeMinutes,
                });
                statusCode = 200;
                res.writeHead(statusCode, withSecurityHeaders({ "content-type": "text/html; charset=utf-8", ...corsHeaders, "x-request-id": requestId }));
                res.end(html);
                return;
            }
            statusCode = 404;
            res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
            res.end(JSON.stringify({ ok: false, message: "Not found" }));
        }
        catch (error) {
            statusCode = 500;
            logger.error("studio_brain_http_handler_error", {
                requestId,
                method,
                path: url.pathname,
                message: error instanceof Error ? error.message : String(error),
            });
            res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
            res.end(JSON.stringify({ ok: false, message: "Internal server error" }));
        }
        finally {
            logger.info("studio_brain_http_request", {
                requestId,
                method,
                path: url.pathname,
                statusCode,
                durationMs: Date.now() - startedAt,
            });
        }
    });
    server.listen(port, host, () => {
        logger.info("studio_brain_http_listening", { host, port });
    });
    return server;
}
