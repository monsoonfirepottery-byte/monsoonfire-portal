/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { User } from "firebase/auth";
import StudioBrainModule from "./StudioBrainModule";

type MockResponse = {
  ok?: boolean;
  [key: string]: unknown;
};
type FetchCall = {
  input: string | URL | Request;
  init?: RequestInit;
};

function json(body: MockResponse, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createUser(): User {
  return {
    uid: "staff-uid",
    getIdToken: vi.fn(async () => "test-id-token"),
  } as unknown as User;
}

function createStudioBrainFetchMock(options?: {
  marketingDraftStatus?: "draft" | "needs_review" | "approved_for_publish";
  includeIntakeRow?: boolean;
}) {
  const proposal = {
    id: "proposal-1",
    createdAt: "2026-02-16T12:00:00.000Z",
    requestedBy: "staff-uid",
    tenantId: "monsoonfire-main",
    capabilityId: "firestore.ops_note.append",
    rationale: "Pilot append note after approved ops review.",
    preview: {
      summary: "Close batch proposal",
      expectedEffects: ["Staff-visible pilot note is written."],
    },
    status: "executed",
  };

  const calls: FetchCall[] = [];
  const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ input, init });
    const url = new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();

    if (method === "GET" && url.pathname === "/api/capabilities") {
      return json({
        ok: true,
        capabilities: [
          {
            id: "firestore.ops_note.append",
            target: "firestore",
            requiresApproval: true,
            readOnly: false,
            maxCallsPerHour: 8,
            risk: "medium",
          },
        ],
        proposals: [proposal],
        policy: {
          killSwitch: { enabled: false, updatedAt: null, updatedBy: null, rationale: null },
          exemptions: [],
        },
        connectors: [],
      });
    }
    if (method === "GET" && url.pathname === "/api/capabilities/quotas") return json({ ok: true, buckets: [] });
    if (method === "GET" && url.pathname === "/api/capabilities/audit") return json({ ok: true, rows: [] });
    if (method === "GET" && url.pathname === "/api/capabilities/delegation/traces") return json({ ok: true, rows: [] });
    if (method === "GET" && url.pathname === "/api/ops/recommendations/drafts") return json({ ok: true, rows: [] });
    if (method === "GET" && url.pathname === "/api/marketing/drafts") {
      const status = options?.marketingDraftStatus;
      const rows = status
        ? [
            {
              id: "mk-row-1",
              draftId: "mk-2026-02-16-ig",
              at: "2026-02-16T12:00:00.000Z",
              status,
              channel: "instagram",
              title: "Studio Pulse",
            },
          ]
        : [];
      return json({ ok: true, rows });
    }
    if (method === "GET" && url.pathname === "/api/finance/reconciliation/drafts") return json({ ok: true, rows: [] });
    if (method === "GET" && url.pathname === "/api/intake/review-queue") {
      const rows = options?.includeIntakeRow
        ? [
            {
              intakeId: "intake-1",
              category: "ip_infringement",
              reasonCode: "blocked",
              capabilityId: "firestore.batch.close",
              actorId: "agent-risk-1",
              at: "2026-02-16T12:00:00.000Z",
            },
          ]
        : [];
      return json({ ok: true, rows });
    }
    if (method === "GET" && url.pathname === "/api/capabilities/rate-limits/events") return json({ ok: true, rows: [] });
    if (method === "GET" && url.pathname === "/api/ops/scorecard") {
      return json({
        ok: true,
        scorecard: {
          computedAt: "2026-02-16T12:05:00.000Z",
          overallStatus: "ok",
          lastBreachAt: null,
          metrics: [],
        },
      });
    }
    if (method === "GET" && url.pathname === "/api/capabilities/policy-lint") {
      return json({
        ok: true,
        checkedAt: "2026-02-16T12:05:00.000Z",
        capabilitiesChecked: 5,
        violations: [],
      });
    }
    if (method === "GET" && url.pathname === "/api/ops/audit") return json({ ok: true, rows: [] });

    if (method === "POST" && url.pathname === "/api/capabilities/proposals/proposal-1/approve") {
      return json({ ok: true, proposal: { id: "proposal-1", status: "approved" } });
    }
    if (method === "POST" && url.pathname === "/api/capabilities/proposals/proposal-1/execute") {
      return json({ ok: true, proposal: { id: "proposal-1", status: "executed" } });
    }
    if (method === "POST" && url.pathname === "/api/capabilities/proposals/proposal-1/rollback") {
      return json({ ok: true, replayed: false });
    }
    if (method === "POST" && url.pathname === "/api/marketing/drafts/mk-2026-02-16-ig/review") {
      return json({ ok: true, draftId: "mk-2026-02-16-ig" });
    }
    if (method === "POST" && url.pathname === "/api/capabilities/policy/kill-switch") {
      const payload = JSON.parse(String(init?.body ?? "{}")) as { enabled?: boolean; rationale?: string };
      return json({
        ok: true,
        policy: {
          killSwitch: {
            enabled: Boolean(payload.enabled),
            updatedAt: "2026-02-16T12:30:00.000Z",
            updatedBy: "staff-uid",
            rationale: payload.rationale ?? null,
          },
          exemptions: [],
        },
      });
    }
    if (method === "POST" && url.pathname === "/api/intake/review-queue/intake-1/override") {
      return json({ ok: true, intakeId: "intake-1" });
    }

    return json({ ok: true });
  });

  return Object.assign(fetchFn, { requestLog: calls });
}

function getInputUrl(input: FetchCall["input"]): string {
  if (typeof input === "string" || input instanceof URL) return String(input);
  return input.url;
}

function getHeadersFromCall(init?: RequestInit): Record<string, string> {
  const rawHeaders = init?.headers;
  if (!rawHeaders) return {};
  if (rawHeaders instanceof Headers) {
    return Object.fromEntries(rawHeaders.entries());
  }
  if (typeof rawHeaders === "object") {
    return rawHeaders as Record<string, string>;
  }
  return {};
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("StudioBrainModule", () => {
  it("shows token gate and skips Studio Brain fetches when admin token is missing", async () => {
    const fetchMock = createStudioBrainFetchMock();
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    render(<StudioBrainModule user={createUser()} active={true} disabled={false} adminToken="" />);

    await screen.findByText("Set a Dev admin token in System module to access Studio Brain endpoints.");
    await waitFor(() => {
      expect(fetchMock.requestLog.length).toBe(0);
    });
  });

  it("loads bootstrap datasets with auth and admin-token headers", async () => {
    const fetchMock = createStudioBrainFetchMock();
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    render(
      <StudioBrainModule
        user={createUser()}
        active={true}
        disabled={false}
        adminToken="dev-admin-token"
      />
    );

    await waitFor(() => {
      const bootstrapCall = fetchMock.requestLog.find((entry) => getInputUrl(entry.input).includes("/api/capabilities"));
      expect(Boolean(bootstrapCall)).toBe(true);
      const headers = getHeadersFromCall(bootstrapCall?.init);
      expect(headers.authorization).toBe("Bearer test-id-token");
      expect(headers["x-studio-brain-admin-token"]).toBe("dev-admin-token");
    });
  });

  it("posts approve payload with current user and rationale", async () => {
    const fetchMock = createStudioBrainFetchMock();
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    render(
      <StudioBrainModule
        user={createUser()}
        active={true}
        disabled={false}
        adminToken="dev-admin-token"
      />
    );

    const approveButton = await screen.findByRole("button", { name: "Approve" });
    fireEvent.click(approveButton);

    await waitFor(() => {
      const approveCall = fetchMock.requestLog.find((entry) =>
        getInputUrl(entry.input).includes("/api/capabilities/proposals/proposal-1/approve")
      );
      expect(Boolean(approveCall)).toBe(true);
      const body = JSON.parse(String(approveCall?.init?.body ?? "{}")) as { approvedBy?: string; rationale?: string };
      expect(body.approvedBy).toBe("staff-uid");
      expect(String(body.rationale ?? "").length > 0).toBe(true);
    });
  });

  it("uses generated idempotency key for execute and reuses it for rollback", async () => {
    const fetchMock = createStudioBrainFetchMock();
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    vi.spyOn(Date, "now").mockReturnValue(1_760_000_000_000);

    render(
      <StudioBrainModule
        user={createUser()}
        active={true}
        disabled={false}
        adminToken="dev-admin-token"
      />
    );

    const summaryCells = await screen.findAllByText("Close batch proposal");
    const proposalSummaryCell = summaryCells.find((cell) => {
      const row = cell.closest("tr");
      return Boolean(row && within(row).queryByRole("button", { name: "Execute" }));
    });
    expect(proposalSummaryCell).toBeDefined();
    const proposalRow = proposalSummaryCell?.closest("tr");
    expect(proposalRow).toBeTruthy();
    const executeButton = within(proposalRow as HTMLTableRowElement).getByRole("button", { name: "Execute" });
    fireEvent.click(executeButton);

    await waitFor(() => {
      const executeCall = fetchMock.requestLog.find((entry) =>
        getInputUrl(entry.input).includes("/api/capabilities/proposals/proposal-1/execute")
      );
      expect(Boolean(executeCall)).toBe(true);
      const body = JSON.parse(String(executeCall?.init?.body ?? "{}")) as {
        idempotencyKey?: string;
        actorId?: string;
        ownerUid?: string;
        tenantId?: string;
      };
      expect(body.idempotencyKey).toBe("pilot-proposal-1760000000000");
      expect(body.actorId).toBe("staff-uid");
      expect(body.ownerUid).toBe("staff-uid");
      expect(body.tenantId).toBe("monsoonfire-main");
    });

    const rollbackButton = within(proposalRow as HTMLTableRowElement).getByRole("button", { name: "Rollback" });
    await waitFor(() => {
      expect((rollbackButton as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(rollbackButton);

    await waitFor(() => {
      const rollbackCall = fetchMock.requestLog.find((entry) =>
        getInputUrl(entry.input).includes("/api/capabilities/proposals/proposal-1/rollback")
      );
      expect(Boolean(rollbackCall)).toBe(true);
      const body = JSON.parse(String(rollbackCall?.init?.body ?? "{}")) as { idempotencyKey?: string; reason?: string };
      expect(body.idempotencyKey).toBe("pilot-proposal-1760000000000");
      expect(body.reason).toBe("Rollback pilot note due to incorrect context.");
    });
  });

  it("posts marketing review transition with rationale", async () => {
    const fetchMock = createStudioBrainFetchMock({ marketingDraftStatus: "draft" });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    render(
      <StudioBrainModule
        user={createUser()}
        active={true}
        disabled={false}
        adminToken="dev-admin-token"
      />
    );

    const markNeedsReviewButton = await screen.findByRole("button", { name: "Mark needs_review" });
    fireEvent.click(markNeedsReviewButton);

    await waitFor(() => {
      const reviewCall = fetchMock.requestLog.find((entry) =>
        getInputUrl(entry.input).includes("/api/marketing/drafts/mk-2026-02-16-ig/review")
      );
      expect(Boolean(reviewCall)).toBe(true);
      const body = JSON.parse(String(reviewCall?.init?.body ?? "{}")) as { toStatus?: string; rationale?: string };
      expect(body.toStatus).toBe("needs_review");
      expect(String(body.rationale ?? "").length >= 10).toBe(true);
    });
  });

  it("posts kill-switch toggle payload with target state and rationale", async () => {
    const fetchMock = createStudioBrainFetchMock();
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const ui = render(
      <StudioBrainModule
        user={createUser()}
        active={true}
        disabled={false}
        adminToken="dev-admin-token"
      />
    );

    const refreshButton = await ui.findByRole("button", { name: "Refresh" });
    await waitFor(() => {
      expect((refreshButton as HTMLButtonElement).disabled).toBe(false);
    });
    const policyControlSection = await ui.findByText("Policy controls");
    const policyCard = policyControlSection.closest("section");
    expect(policyCard).toBeTruthy();
    const rationaleInput = await within(policyCard as HTMLElement).findByRole("textbox", { name: "Kill switch rationale" });
    fireEvent.change(rationaleInput, {
      target: { value: "Emergency freeze during incident drill." },
    });
    const enableKillSwitchButton = await within(policyCard as HTMLElement).findByRole("button", {
      name: /Enable kill switch|Disable kill switch/,
    });
    await waitFor(() => {
      expect((enableKillSwitchButton as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(enableKillSwitchButton);

    await waitFor(() => {
      const killSwitchCall = fetchMock.requestLog.find((entry) =>
        getInputUrl(entry.input).includes("/api/capabilities/policy/kill-switch")
      );
      expect(Boolean(killSwitchCall)).toBe(true);
      const body = JSON.parse(String(killSwitchCall?.init?.body ?? "{}")) as { enabled?: boolean; rationale?: string };
      expect(body.enabled).toBe(true);
      expect(body.rationale).toBe("Emergency freeze during incident drill.");
    });
  });

  it("posts intake override grant with reason code and rationale", async () => {
    const fetchMock = createStudioBrainFetchMock({ includeIntakeRow: true });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    render(
      <StudioBrainModule
        user={createUser()}
        active={true}
        disabled={false}
        adminToken="dev-admin-token"
      />
    );

    const grantOverrideButton = await screen.findByRole("button", { name: "Grant override" });
    fireEvent.click(grantOverrideButton);

    await waitFor(() => {
      const overrideCall = fetchMock.requestLog.find((entry) =>
        getInputUrl(entry.input).includes("/api/intake/review-queue/intake-1/override")
      );
      expect(Boolean(overrideCall)).toBe(true);
      const body = JSON.parse(String(overrideCall?.init?.body ?? "{}")) as {
        decision?: string;
        reasonCode?: string;
        rationale?: string;
      };
      expect(body.decision).toBe("override_granted");
      expect(body.reasonCode).toBe("staff_override_context_verified");
      expect(String(body.rationale ?? "").length >= 10).toBe(true);
    });
  });

  it("posts intake override deny payload with reason code and rationale", async () => {
    const fetchMock = createStudioBrainFetchMock({ includeIntakeRow: true });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const ui = render(
      <StudioBrainModule
        user={createUser()}
        active={true}
        disabled={false}
        adminToken="dev-admin-token"
      />
    );

    const refreshButton = await ui.findByRole("button", { name: "Refresh" });
    await waitFor(() => {
      expect((refreshButton as HTMLButtonElement).disabled).toBe(false);
    });
    const [intakeCell] = await ui.findAllByText("ip_infringement");
    const intakeRow = intakeCell.closest("tr");
    expect(intakeRow).toBeTruthy();
    const scope = within(intakeRow as HTMLTableRowElement);
    const reasonCodeSelect = await ui.findByRole("combobox", { name: "Decision reason code" });
    fireEvent.change(reasonCodeSelect, { target: { value: "policy_confirmed_block" } });

    const denyOverrideButton = await scope.findByRole("button", { name: "Deny override" });
    await waitFor(() => {
      expect((denyOverrideButton as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(denyOverrideButton);

    await waitFor(() => {
      const denyCall = fetchMock.requestLog
        .filter((entry) => getInputUrl(entry.input).includes("/api/intake/review-queue/intake-1/override"))
        .find((entry) => {
          const body = JSON.parse(String(entry.init?.body ?? "{}")) as { decision?: string };
          return body.decision === "override_denied";
        });
      expect(Boolean(denyCall)).toBe(true);
      const body = JSON.parse(String(denyCall?.init?.body ?? "{}")) as {
        decision?: string;
        reasonCode?: string;
        rationale?: string;
      };
      expect(body.decision).toBe("override_denied");
      expect(body.reasonCode).toBe("policy_confirmed_block");
      expect(String(body.rationale ?? "").length >= 10).toBe(true);
    });
  });
});
