/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type EnsureModule = typeof import("./ensureUserDoc");

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function loadEnsureUserDocModule(): Promise<EnsureModule> {
  vi.resetModules();
  return await import("./ensureUserDoc");
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ensureUserDocForSession", () => {
  it("reuses the same in-flight request for the same user session", async () => {
    let resolveFetch: ((value: Response) => void) | null = null;
    const fetchMock = vi.fn(
      async () =>
        await new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const { ensureUserDocForSession } = await loadEnsureUserDocModule();
    const args = {
      uid: "user_1",
      projectId: "project_1",
      baseUrl: "https://example.test/functions",
      getIdToken: async () => "id-token-123",
    };

    const first = ensureUserDocForSession(args);
    const second = ensureUserDocForSession(args);

    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch?.(jsonResponse({ ok: true, userCreated: false, profileCreated: false }));
    const [a, b] = await Promise.all([first, second]);

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(a.skipped).toBeUndefined();
    expect(b.skipped).toBeUndefined();
  });

  it("sends auth header and empty JSON body", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ ok: true, userCreated: false, profileCreated: false })
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const { ensureUserDocForSession } = await loadEnsureUserDocModule();
    const result = await ensureUserDocForSession({
      uid: "user_1",
      projectId: "project_1",
      baseUrl: "https://example.test/functions/",
      getIdToken: async () => "id-token-123",
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://example.test/functions/ensureUserDoc");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer id-token-123");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(init.body).toBe("{}");
  });

  it("suppresses further retries after retry budget is exhausted", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ ok: false, code: "ENSURE_FAILED", message: "Ensure failed" }, 500)
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const { ensureUserDocForSession } = await loadEnsureUserDocModule();
    const args = {
      uid: "user_1",
      projectId: "project_1",
      baseUrl: "https://example.test/functions",
      getIdToken: async () => "id-token-123",
    };

    const first = await ensureUserDocForSession(args);
    const second = await ensureUserDocForSession(args);
    const third = await ensureUserDocForSession(args);

    expect(first.ok).toBe(false);
    expect(first.code).toBe("ENSURE_FAILED");
    expect(second.ok).toBe(false);
    expect(second.code).toBe("ENSURE_FAILED");
    expect(third.ok).toBe(false);
    expect(third.retrySuppressed).toBe(true);
    expect(third.code).toBe("RETRY_SUPPRESSED");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
