/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { User } from "firebase/auth";
import type { FunctionsClient } from "../../api/functionsClient";
import ReportsModule from "./ReportsModule";

type MockQueryRef = { path: string };
type MockDoc = { id: string; data: Record<string, unknown> };
type Snapshot = { docs: Array<{ id: string; data: () => Record<string, unknown> }> };
type ClientCall = { fn: string; payload: Record<string, unknown> };
type FetchCall = { input: string | URL | Request; init?: RequestInit };

const getDocsMock = vi.fn(async (_queryRef: MockQueryRef): Promise<Snapshot> => createSnapshot([]));

vi.mock("../../firebase", () => ({
  db: { name: "mock-db" },
}));

vi.mock("firebase/firestore", () => ({
  collection: vi.fn((_: unknown, ...segments: string[]) => ({ path: segments.join("/") })),
  query: vi.fn((source: MockQueryRef, ..._constraints: unknown[]) => source),
  where: vi.fn((_field: string, _op: string, _value: unknown) => ({})),
  orderBy: vi.fn((_field: string, _direction?: string) => ({})),
  limit: vi.fn((_value: number) => ({})),
  getDocs: (...args: [MockQueryRef]) => getDocsMock(...args),
}));

function createSnapshot(rows: MockDoc[]): Snapshot {
  return {
    docs: rows.map((row) => ({
      id: row.id,
      data: () => row.data,
    })),
  };
}

function createUser(): User {
  return {
    uid: "staff-uid",
    getIdToken: vi.fn(async () => "test-id-token"),
  } as unknown as User;
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
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
  return rawHeaders as Record<string, string>;
}

function createStudioBrainFetchMock() {
  const calls: FetchCall[] = [];
  const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ input, init });
    const url = new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();

    if (method === "GET" && url.pathname === "/api/trust-safety/triage/stats") {
      return json({
        ok: true,
        stats: {
          accepted: 4,
          rejected: 1,
          mismatchRatePct: 20,
        },
      });
    }

    if (method === "POST" && url.pathname === "/api/trust-safety/triage/suggest") {
      return json({
        ok: true,
        suggestion: {
          severity: "high",
          category: "safety",
          reasonCode: "safety_escalated",
          confidence: 0.92,
          provenance: ["rule:safety", "model:triage-assist"],
          model: { provider: "openai", version: "gpt-5" },
          suggestionOnly: true,
        },
      });
    }

    if (method === "POST" && url.pathname === "/api/trust-safety/triage/feedback") {
      return json({ ok: true });
    }

    return json({ ok: true });
  });

  return Object.assign(fetchFn, { requestLog: calls });
}

function baseReport(overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    id: "report-1",
    status: "open",
    category: "safety",
    severity: "high",
    targetType: "blog_post",
    note: "Potentially unsafe instructions in article.",
    reporterUid: "reporter-1",
    assigneeUid: "",
    createdAt: Date.now() - 2 * 60 * 60 * 1000,
    updatedAt: Date.now() - 60 * 60 * 1000,
    resolvedAt: 0,
    lastPolicyVersion: "",
    lastRuleId: "",
    lastReasonCode: "",
    resolutionCode: "",
    coordinationSignal: false,
    coordinationReportCount: 0,
    coordinationUniqueReporterCount: 0,
    targetRef: { id: "post-1", url: "https://example.com/post-1" },
    targetSnapshot: { title: "Broken listing URL", url: "https://example.com/post-1" },
    ...overrides,
  };
}

function createClientMock(input?: {
  reports?: Array<Record<string, unknown>>;
  appeals?: Array<Record<string, unknown>>;
  policy?: Record<string, unknown> | null;
}) {
  let reports = (input?.reports ?? [baseReport()]).map((row) => ({ ...row }));
  const appeals = (input?.appeals ?? []).map((row) => ({ ...row }));
  const policy =
    input?.policy ??
    ({
      id: "policy-v1",
      version: "policy-v1",
      title: "Community Safety Policy",
      rules: [
        {
          id: "safety_rule",
          title: "Safety first",
          description: "Escalate unsafe or dangerous instructions.",
        },
      ],
    } as Record<string, unknown>);

  const requestLog: ClientCall[] = [];
  const postJson = vi.fn(async (fn: string, payload: Record<string, unknown>) => {
    requestLog.push({ fn, payload });

    if (fn === "listReports") {
      return { ok: true, reports };
    }
    if (fn === "listReportAppeals") {
      return { ok: true, appeals };
    }
    if (fn === "getModerationPolicyCurrent") {
      return { ok: true, policy };
    }
    if (fn === "updateReportStatus") {
      const reportId = String(payload.reportId ?? "");
      const nextStatus = String(payload.status ?? "open");
      const ruleId = String(payload.ruleId ?? "");
      const reasonCode = String(payload.reasonCode ?? "");
      const policyVersion = String(payload.policyVersion ?? "");
      const resolutionCode = typeof payload.resolutionCode === "string" ? payload.resolutionCode : "";
      reports = reports.map((row) =>
        row.id === reportId
          ? {
              ...row,
              status: nextStatus,
              lastRuleId: ruleId,
              lastReasonCode: reasonCode,
              lastPolicyVersion: policyVersion,
              resolutionCode,
            }
          : row
      );
      return { ok: true };
    }
    if (fn === "addInternalNote" || fn === "takeContentAction" || fn === "updateReportAppeal") {
      return { ok: true };
    }

    return { ok: true };
  });

  const client: FunctionsClient = {
    postJson: postJson as FunctionsClient["postJson"],
    getLastRequest: () => null,
    getLastCurl: () => "",
  };

  return Object.assign(client, {
    postJsonMock: postJson,
    requestLog,
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ReportsModule", () => {
  it("loads reports + policy and requests triage stats with Studio Brain auth headers", async () => {
    const client = createClientMock();
    const fetchMock = createStudioBrainFetchMock();
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    render(
      <ReportsModule
        client={client}
        active={true}
        disabled={false}
        user={createUser()}
        studioBrainAdminToken="dev-admin-token"
      />
    );

    await screen.findByText("Report details");

    await waitFor(() => {
      expect(client.postJsonMock).toHaveBeenCalledWith(
        "listReports",
        expect.objectContaining({ status: "open", severity: "all", category: "all", targetType: "all" })
      );
      expect(client.postJsonMock).toHaveBeenCalledWith("listReportAppeals", expect.objectContaining({ status: "all" }));
      expect(client.postJsonMock).toHaveBeenCalledWith("getModerationPolicyCurrent", {});
    });

    const statsCall = fetchMock.requestLog.find((entry: FetchCall) => {
      const url = new URL(getInputUrl(entry.input));
      return url.pathname === "/api/trust-safety/triage/stats";
    });

    expect(Boolean(statsCall)).toBe(true);
    const headers = getHeadersFromCall(statsCall?.init);
    expect(headers.authorization).toBe("Bearer test-id-token");
    expect(headers["x-studio-brain-admin-token"]).toBe("dev-admin-token");
    expect(screen.getByText(/Active policy:/)).toBeDefined();
  });

  it("saves report status with policy linkage metadata", async () => {
    const client = createClientMock();

    render(
      <ReportsModule
        client={client}
        active={true}
        disabled={false}
        user={createUser()}
        studioBrainAdminToken=""
      />
    );

    await screen.findByText("Report details");

    const statusField = screen.getByText("Set status").closest("label");
    if (!statusField) {
      throw new Error("Could not locate status update field.");
    }

    const reasonInput = within(statusField).getByPlaceholderText("Reason code (required)");
    fireEvent.change(reasonInput, { target: { value: "safety_escalated" } });

    const saveStatusButton = within(statusField).getByRole("button", { name: "Save status" });
    await waitFor(() => {
      expect(saveStatusButton.getAttribute("disabled")).toBeNull();
    });
    fireEvent.click(saveStatusButton);

    await waitFor(() => {
      const statusCall = client.requestLog.find((entry: ClientCall) => entry.fn === "updateReportStatus");
      expect(Boolean(statusCall)).toBe(true);
      expect(statusCall?.payload).toEqual(
        expect.objectContaining({
          reportId: "report-1",
          status: "triaged",
          policyVersion: "policy-v1",
          ruleId: "safety_rule",
          reasonCode: "safety_escalated",
        })
      );
    });

    expect(screen.getByText("Report status updated.")).toBeDefined();
  });

  it("applies bulk status updates to selected reports", async () => {
    const client = createClientMock({
      reports: [
        baseReport({ id: "report-1", targetSnapshot: { title: "Broken listing URL", url: "https://example.com/post-1" } }),
        baseReport({
          id: "report-2",
          targetSnapshot: { title: "Harassment report", url: "https://example.com/post-2" },
          targetRef: { id: "post-2", url: "https://example.com/post-2" },
        }),
      ],
    });

    render(
      <ReportsModule
        client={client}
        active={true}
        disabled={false}
        user={createUser()}
        studioBrainAdminToken=""
      />
    );

    await screen.findByText("Report details");
    await waitFor(() => {
      expect(screen.getAllByRole("checkbox", { name: /Select report .* for bulk actions/i }).length).toBe(2);
    });

    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    fireEvent.change(screen.getByPlaceholderText("Bulk reason code"), {
      target: { value: "coordinated_spam" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply bulk status" }));

    await waitFor(() => {
      const bulkCalls = client.requestLog.filter((entry: ClientCall) => entry.fn === "updateReportStatus");
      expect(bulkCalls).toHaveLength(2);
      const reportIds = bulkCalls.map((entry) => String(entry.payload.reportId)).sort();
      expect(reportIds).toEqual(["report-1", "report-2"]);
    });

    expect(screen.getByText("Bulk updated 2 reports to triaged.")).toBeDefined();
  });

  it("generates assistive triage suggestion with authenticated Studio Brain call", async () => {
    const client = createClientMock();
    const fetchMock = createStudioBrainFetchMock();
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    render(
      <ReportsModule
        client={client}
        active={true}
        disabled={false}
        user={createUser()}
        studioBrainAdminToken="dev-admin-token"
      />
    );

    await screen.findByText("Report details");
    fireEvent.click(screen.getByRole("button", { name: "Generate suggestion" }));

    await waitFor(() => {
      expect(screen.getByText("Assistive triage suggestion generated.")).toBeDefined();
    });

    const suggestCall = fetchMock.requestLog.find((entry: FetchCall) => {
      const url = new URL(getInputUrl(entry.input));
      return url.pathname === "/api/trust-safety/triage/suggest";
    });
    expect(Boolean(suggestCall)).toBe(true);

    const headers = getHeadersFromCall(suggestCall?.init);
    expect(headers.authorization).toBe("Bearer test-id-token");
    expect(headers["x-studio-brain-admin-token"]).toBe("dev-admin-token");

    const requestBody = JSON.parse(String(suggestCall?.init?.body ?? "{}")) as Record<string, unknown>;
    expect(requestBody).toEqual(
      expect.objectContaining({
        reportId: "report-1",
        targetType: "blog_post",
        targetTitle: "Broken listing URL",
      })
    );
  });
});
