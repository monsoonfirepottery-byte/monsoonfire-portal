import { describe, expect, it } from "vitest";
import {
  getLatestRequestTelemetry,
  publishRequestTelemetry,
  redactTelemetryPayload,
  stringifyResponseSnippet,
  subscribeRequestTelemetry,
} from "./requestTelemetry";

describe("requestTelemetry", () => {
  it("redacts sensitive keys recursively", () => {
    const redacted = redactTelemetryPayload({
      uid: "user_123",
      nested: {
        token: "abc",
        safe: "ok",
      },
      list: [{ email: "a@b.com", keep: true }],
    }) as Record<string, unknown>;

    expect(redacted.uid).toBe("<redacted>");
    expect((redacted.nested as Record<string, unknown>).token).toBe("<redacted>");
    expect((redacted.nested as Record<string, unknown>).safe).toBe("ok");
    expect(((redacted.list as Array<Record<string, unknown>>)[0] ?? {}).email).toBe("<redacted>");
  });

  it("publishes and stores the latest telemetry entry", () => {
    let seenRequestId = "";
    const unsubscribe = subscribeRequestTelemetry((entry) => {
      seenRequestId = entry?.requestId ?? "";
    });

    publishRequestTelemetry({
      atIso: "2026-02-22T00:00:00.000Z",
      requestId: "req_telemetry_1",
      source: "functions-client",
      endpoint: "https://example.test/createBatch",
      method: "POST",
      payload: {},
      ok: true,
    });

    unsubscribe();

    expect(seenRequestId).toBe("req_telemetry_1");
    expect(getLatestRequestTelemetry()?.requestId).toBe("req_telemetry_1");
  });

  it("truncates long response snippets", () => {
    const long = "x".repeat(1000);
    const snippet = stringifyResponseSnippet(long, 24);
    expect(snippet.length).toBeLessThanOrEqual(25);
    expect(snippet.endsWith("…")).toBe(true);
  });
});

