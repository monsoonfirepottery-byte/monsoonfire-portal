"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const renderOpsPortalPage_1 = require("./renderOpsPortalPage");
const generatedAt = "2026-04-17T20:30:00.000Z";
(0, node_test_1.default)("ops portal renderer exposes the autonomous studio OS surfaces and truth posture", () => {
    const model = {
        snapshot: {
            generatedAt,
            session: null,
            twin: {
                generatedAt,
                headline: "Autonomous Studio OS",
                narrative: "A standalone local /ops renderer that keeps owner, manager, hands, and internet work on one operating page.",
                currentRisk: "Support queue proof is stale.",
                commitmentsDueSoon: 1,
                arrivalsExpectedSoon: 2,
                zones: [
                    {
                        id: "zone-support",
                        label: "Support",
                        status: "warning",
                        summary: "The support lane needs fresh proof before outbound work moves beyond draft posture.",
                        nextAction: "Refresh the support queue and attach one proof artifact.",
                        evidence: {
                            summary: "Current queue proof is older than the owner brief.",
                            sources: [],
                            freshestAt: generatedAt,
                            confidence: 0.74,
                            degradeReason: "Fresh queue proof is stale.",
                            verificationClass: "observed",
                        },
                    },
                ],
                nextActions: ["Refresh support queue truth.", "Keep outbound support in draft posture."],
            },
            truth: {
                generatedAt,
                readiness: "degraded",
                summary: "Truth, readiness, freshness, and degrade reasons are visible on-screen.",
                degradeModes: ["draft_only"],
                sources: [
                    {
                        source: "control-tower",
                        label: "Control tower",
                        freshnessSeconds: 120,
                        budgetSeconds: 600,
                        status: "healthy",
                        freshestAt: generatedAt,
                        reason: null,
                    },
                ],
                watchdogs: [
                    {
                        id: "watch-support",
                        label: "Support queue proof",
                        status: "warning",
                        summary: "Support proof needs a refresh.",
                        recommendation: "Refresh the queue before any send action.",
                    },
                ],
                metrics: {},
            },
            tasks: [],
            cases: [],
            approvals: [],
            ceo: [],
            forge: [],
            conversations: [],
            members: [],
            reservations: [],
            events: [],
            reports: [],
            lending: null,
            taskEscapes: [],
            overrides: [],
        },
        displayState: null,
        surface: "manager",
        stationId: null,
    };
    const html = (0, renderOpsPortalPage_1.renderOpsPortalPage)(model);
    strict_1.default.match(html, /Studio Brain Autonomous Studio OS/i);
    strict_1.default.match(html, /Owner/i);
    strict_1.default.match(html, /Manager/i);
    strict_1.default.match(html, /Hands/i);
    strict_1.default.match(html, /Internet/i);
    strict_1.default.match(html, /CEO/i);
    strict_1.default.match(html, /Forge/i);
    strict_1.default.match(html, /Freshness/i);
    strict_1.default.match(html, /Confidence/i);
    strict_1.default.match(html, /Provenance/i);
    strict_1.default.match(html, /Degrade/i);
    strict_1.default.match(html, /data-surface-tab="manager"/i);
    strict_1.default.match(html, /data-surface-chat="manager"/i);
    strict_1.default.match(html, /\/api\/ops\/chat\/"\s*\+\s*encodeURIComponent\(surface\)\s*\+\s*"\/send/i);
    strict_1.default.match(html, /Support queue proof is stale/i);
});
