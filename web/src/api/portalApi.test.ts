import { afterEach, describe, expect, it, vi } from "vitest";

type PortalModule = typeof import("./portalApi");

vi.mock("./requestId", () => ({
  makeRequestId: () => "req_test",
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function loadPortalApiModule(): Promise<PortalModule> {
  vi.resetModules();
  return await import("./portalApi");
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("portalApi transport isolation", () => {
  it("deduplicates identical in-flight requests for the same caller context", async () => {
    let resolveFetch: ((value: Response) => void) | null = null;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const { createPortalApi } = await loadPortalApiModule();
    const api = createPortalApi({ baseUrl: "https://example.test/functions" });
    const args = {
      idToken: "id-token-1",
      payload: { uid: "user_1", fromBatchId: "batch_1" },
    };

    const first = api.continueJourney(args);
    const second = api.continueJourney(args);

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    if (!resolveFetch) {
      throw new Error("fetch resolver missing");
    }
    resolveFetch(jsonResponse({ ok: true, batchId: "batch_new" }));

    await expect(first).resolves.toMatchObject({
      data: { ok: true, batchId: "batch_new" },
    });
    await expect(second).resolves.toMatchObject({
      data: { ok: true, batchId: "batch_new" },
    });
  });

  it("does not share in-flight requests across different base URLs", async () => {
    const resolvers: Array<(value: Response) => void> = [];
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolvers.push(resolve);
        })
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const { createPortalApi } = await loadPortalApiModule();
    const apiA = createPortalApi({ baseUrl: "https://api-a.test/functions" });
    const apiB = createPortalApi({ baseUrl: "https://api-b.test/functions" });
    const args = {
      idToken: "id-token-1",
      payload: { uid: "user_1", fromBatchId: "batch_1" },
    };

    const first = apiA.continueJourney(args);
    const second = apiB.continueJourney(args);

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api-a.test/functions/continueJourney");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://api-b.test/functions/continueJourney");

    resolvers[0]?.(jsonResponse({ ok: true, scope: "a" }));
    resolvers[1]?.(jsonResponse({ ok: true, scope: "b" }));

    await expect(first).resolves.toMatchObject({ data: { ok: true, scope: "a" } });
    await expect(second).resolves.toMatchObject({ data: { ok: true, scope: "b" } });
  });

  it("does not suppress auth retries across different base URLs", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: false, message: "Token expired" }, 401));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const { createPortalApi } = await loadPortalApiModule();
    const apiA = createPortalApi({ baseUrl: "https://api-a.test/functions" });
    const apiB = createPortalApi({ baseUrl: "https://api-b.test/functions" });
    const args = {
      idToken: "id-token-expired",
      payload: { uid: "user_1", fromBatchId: "batch_1" },
    };

    await expect(apiA.continueJourney(args)).rejects.toThrow(/sign in/i);
    await expect(apiB.continueJourney(args)).rejects.toThrow(/sign in/i);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
