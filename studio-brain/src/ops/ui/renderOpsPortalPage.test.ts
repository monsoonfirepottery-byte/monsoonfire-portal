import test from "node:test";
import assert from "node:assert/strict";
import { renderOpsPortalPage } from "./renderOpsPortalPage";
import type { OpsPortalPageModel } from "./contracts";

const generatedAt = "2026-04-17T20:30:00.000Z";

test("ops portal renderer exposes the autonomous studio OS surfaces and truth posture", () => {
  const model: OpsPortalPageModel = {
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

  const html = renderOpsPortalPage(model);

  assert.match(html, /Studio Brain Autonomous Studio OS/i);
  assert.match(html, /Owner/i);
  assert.match(html, /Manager/i);
  assert.match(html, /Hands/i);
  assert.match(html, /Internet/i);
  assert.match(html, /CEO/i);
  assert.match(html, /Forge/i);
  assert.match(html, /Freshness/i);
  assert.match(html, /Confidence/i);
  assert.match(html, /Provenance/i);
  assert.match(html, /Degrade/i);
  assert.match(html, /data-surface-tab="manager"/i);
  assert.match(html, /data-surface-chat="manager"/i);
  assert.match(html, /\/api\/ops\/chat\/"\s*\+\s*encodeURIComponent\(surface\)\s*\+\s*"\/send/i);
  assert.match(html, /Support queue proof is stale/i);
});
