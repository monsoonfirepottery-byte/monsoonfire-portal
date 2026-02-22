import { afterEach, describe, expect, it, vi } from "vitest";
import { createFunctionsClient } from "./functionsClient";

vi.mock("./requestId", () => ({
  makeRequestId: () => "req_test",
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function readHeaders(init?: RequestInit): Record<string, string> {
  const source = init?.headers;
  if (!source) return {};
  if (source instanceof Headers) return Object.fromEntries(source.entries());
  if (Array.isArray(source)) return Object.fromEntries(source);
  return source as Record<string, string>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("functionsClient", () => {
  it("sends authorization and trimmed admin token headers", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, value: 1 }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const client = createFunctionsClient({
      baseUrl: "https://example.test/functions/",
      getIdToken: async () => "id-token-123",
      getAdminToken: () => "  admin-token-456  ",
    });

    const result = await client.postJson<{ ok: boolean; value: number }>("continueJourney", {
      uid: "user_1",
      fromBatchId: "batch_1",
    });

    expect(result).toEqual({ ok: true, value: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://example.test/functions/continueJourney");
    const headers = readHeaders(fetchMock.mock.calls[0]?.[1]);
    expect(headers.Authorization).toBe("Bearer id-token-123");
    expect(headers["x-admin-token"]).toBe("admin-token-456");
  });

  it("omits admin header when token is blank", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const client = createFunctionsClient({
      baseUrl: "https://example.test/functions",
      getIdToken: async () => "id-token-123",
      getAdminToken: () => "   ",
    });

    await client.postJson("createBatch", { uid: "user_1" });
    const headers = readHeaders(fetchMock.mock.calls[0]?.[1]);
    expect(headers.Authorization).toBe("Bearer id-token-123");
    expect(headers["x-admin-token"]).toBeUndefined();
  });

  it("records request error details when API responds with failure", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ ok: false, message: "Missing or insufficient permissions" }, 403)
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const client = createFunctionsClient({
      baseUrl: "https://example.test/functions",
      getIdToken: async () => "id-token-123",
    });

    await expect(client.postJson("createBatch", { uid: "user_1" })).rejects.toThrow(
      "Missing or insufficient permissions"
    );

    const last = client.getLastRequest();
    expect(last?.requestId).toBe("req_test");
    expect(last?.status).toBe(403);
    expect(last?.ok).toBe(false);
    expect(last?.error).toBe("Missing or insufficient permissions");
  });

  it("returns redacted and real curl variants from last request", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const client = createFunctionsClient({
      baseUrl: "https://example.test/functions",
      getIdToken: async () => "id-token-123",
      getAdminToken: () => "admin-token-456",
    });

    await client.postJson("continueJourney", { uid: "user_1", fromBatchId: "batch_1" });

    const redacted = client.getLastCurl();
    expect(redacted).toContain("Authorization: Bearer <ID_TOKEN>");
    expect(redacted).toContain("x-admin-token: <ADMIN_TOKEN>");

    const real = client.getLastCurl({ redact: false });
    expect(real).toContain("Authorization: Bearer id-token-123");
    expect(real).toContain("x-admin-token: admin-token-456");
  });
});
