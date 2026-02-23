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
  const entries = Object.fromEntries(new Headers(source).entries()) as Record<string, string>;
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(entries)) {
    normalized[key.toLowerCase()] = value;
  }
  return normalized;
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
    expect(headers.authorization).toBe("Bearer id-token-123");
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
    expect(headers.authorization).toBe("Bearer id-token-123");
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

    await expect(client.postJson("createBatch", { uid: "user_1" })).rejects.toThrow(/sign in/i);

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

  it("deduplicates identical in-flight requests", async () => {
    let resolveFetch: ((value: Response) => void) | null = null;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const client = createFunctionsClient({
      baseUrl: "https://example.test/functions",
      getIdToken: async () => "id-token-123",
    });

    const opA = client.postJson<{ ok: boolean; value: number }>("continueJourney", {
      uid: "user_1",
      fromBatchId: "batch_1",
    });
    const opB = client.postJson<{ ok: boolean; value: number }>("continueJourney", {
      uid: "user_1",
      fromBatchId: "batch_1",
    });

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    if (!resolveFetch) throw new Error("fetch resolver missing");
    resolveFetch(jsonResponse({ ok: true, value: 7 }));

    await expect(opA).resolves.toEqual({ ok: true, value: 7 });
    await expect(opB).resolves.toEqual({ ok: true, value: 7 });
  });

  it("suppresses repeated auth retries when the stale token has not changed", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: false, message: "Token expired" }, 401));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const client = createFunctionsClient({
      baseUrl: "https://example.test/functions",
      getIdToken: async () => "id-token-expired",
    });

    await expect(client.postJson("createBatch", { uid: "user_1" })).rejects.toThrow(/sign in/i);
    await expect(client.postJson("createBatch", { uid: "user_1" })).rejects.toThrow(/sign in/i);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("allows retries again when auth token changes", async () => {
    let currentToken = "id-token-expired";
    const fetchMock = vi.fn(async () => {
      if (currentToken === "id-token-expired") {
        return jsonResponse({ ok: false, message: "Token expired" }, 401);
      }
      return jsonResponse({ ok: true, value: 3 });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const client = createFunctionsClient({
      baseUrl: "https://example.test/functions",
      getIdToken: async () => currentToken,
    });

    await expect(client.postJson("createBatch", { uid: "user_1" })).rejects.toThrow(/sign in/i);
    currentToken = "id-token-fresh";
    await expect(client.postJson<{ ok: boolean; value: number }>("createBatch", { uid: "user_1" })).resolves.toEqual({
      ok: true,
      value: 3,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("marks request timeout as retryable network failure", async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<never>((_, reject) => {
        const signal = init?.signal;
        const rejectWithAbort = () => reject(new DOMException("Request timeout", "AbortError"));
        if (signal instanceof AbortSignal) {
          if (signal.aborted) {
            rejectWithAbort();
            return;
          }
          signal.addEventListener("abort", rejectWithAbort, { once: true });
        }
      });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const client = createFunctionsClient({
      baseUrl: "https://example.test/functions",
      getIdToken: async () => "id-token-123",
      requestTimeoutMs: 12,
    });

    const op = client.postJson("createBatch", { uid: "user_1" });
    await vi.waitFor(() => fetchMock.mock.calls.length > 0, { timeout: 200 });

    let error: unknown;
    let threw = false;
    try {
      await op;
      threw = false;
    } catch (err) {
      threw = true;
      error = err;
    }

    expect(threw).toBe(true);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("try again");
    expect(((error as Error & { debugMessage?: string }).debugMessage ?? "").toLowerCase()).toContain("timeout");
  });
});
