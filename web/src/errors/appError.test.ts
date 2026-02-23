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

  it("marks network failures as retryable", () => {
    const err = toAppError(new Error("Failed to fetch"), {
      requestId: "req_net_1",
    });

    expect(err.kind).toBe("network");
    expect(err.retryable).toBe(true);
    expect(err.userMessage.toLowerCase()).toContain("offline");
  });
});

