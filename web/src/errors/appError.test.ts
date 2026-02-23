import { describe, expect, it } from "vitest";
import { isMissingFirestoreIndexError, toAppError } from "./appError";

describe("appError", () => {
  it("classifies auth failures and keeps request ID", () => {
    const err = toAppError(new Error("Missing or insufficient permissions"), {
      statusCode: 403,
      requestId: "req_auth_1",
    });

    expect(err.kind).toBe("auth");
    expect(err.correlationId).toBe("req_auth_1");
    expect(err.retryable).toBe(false);
    expect(err.userMessage.toLowerCase()).toContain("sign in");
  });

  it("classifies token expiry as session issue with auth reason", () => {
    const err = toAppError(new Error("Firebase ID token expired"), {
      statusCode: 401,
      requestId: "req_auth_expired_1",
    });

    expect(err.kind).toBe("auth");
    expect(err.authFailureReason).toBe("credential expired");
    expect(err.userMessage).toContain("Session issue");
    expect(err.userMessage.toLowerCase()).toContain("expired");
  });

  it("detects missing Firestore index errors", () => {
    expect(
      isMissingFirestoreIndexError(
        "FAILED_PRECONDITION: The query requires an index. You can create it here: https://..."
      )
    ).toBe(true);

    const err = toAppError(new Error("The query requires an index"), {
      kind: "firestore",
      requestId: "req_idx_1",
    });

    expect(err.kind).toBe("firestore");
    expect(err.userMessage.toLowerCase()).toContain("index");
  });

  it("adds actionable contract-mismatch guidance", () => {
    const err = toAppError(
      { message: "Invalid argument: fromBatchId is required", code: "INVALID_ARGUMENT" },
      {
        statusCode: 400,
        requestId: "req_contract_1",
      }
    );

    expect(err.kind).toBe("functions");
    expect(err.userMessage.toLowerCase()).toContain("uid");
    expect(err.userMessage.toLowerCase()).toContain("frombatchid");
  });

  it("marks network failures as retryable", () => {
    const err = toAppError(new Error("Failed to fetch"), {
      requestId: "req_net_1",
    });

    expect(err.kind).toBe("network");
    expect(err.retryable).toBe(true);
    expect(err.userMessage.toLowerCase()).toContain("offline");
  });

  it("gives recovery guidance for chunk-load runtime failures", () => {
    const err = toAppError(new Error("Loading chunk 17 failed"), {
      requestId: "req_chunk_1",
    });

    expect(err.kind).toBe("network");
    expect(err.retryable).toBe(true);
    expect(err.userMessage.toLowerCase()).toContain("module");
    expect(err.userMessage.toLowerCase()).toContain("reload");
  });
});
