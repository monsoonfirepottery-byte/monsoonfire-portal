import { describe, expect, it, vi } from "vitest";
import { makeRequestId } from "./requestId";

describe("makeRequestId", () => {
  it("uses crypto.randomUUID when available", () => {
    const originalCrypto = globalThis.crypto;
    const customCrypto = {
      randomUUID: vi.fn().mockReturnValue("uuid-1234"),
      getRandomValues: vi.fn(),
    };

    Object.defineProperty(globalThis, "crypto", {
      value: customCrypto,
      configurable: true,
    });

    try {
      expect(makeRequestId("req")).toBe("req_uuid-1234");
      expect(customCrypto.randomUUID).toHaveBeenCalled();
    } finally {
      Object.defineProperty(globalThis, "crypto", {
        value: originalCrypto,
        configurable: true,
      });
    }
  });

  it("falls back to secure getRandomValues when randomUUID is unavailable", () => {
    const originalCrypto = globalThis.crypto;
    const expectedBytes = Uint8Array.from([0xde, 0xad, 0xbe, 0xef, 0xca, 0xfe, 0xba, 0xbe, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77]);
    const customCrypto = {
      // @ts-expect-error intentional undefined randomUUID fallback coverage
      randomUUID: undefined,
      getRandomValues: vi.fn((bytes: Uint8Array) => {
        bytes.set(expectedBytes.subarray(0, bytes.length));
      }),
    };

    Object.defineProperty(globalThis, "crypto", {
      value: customCrypto,
      configurable: true,
    });

    try {
      const requestId = makeRequestId("req");
      expect(requestId).toMatch(/^req_[0-9a-f]{32}$/);
      expect(customCrypto.getRandomValues).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(globalThis, "crypto", {
        value: originalCrypto,
        configurable: true,
      });
    }
  });

  it("uses deterministic fallback when crypto is unavailable", () => {
    const originalCrypto = globalThis.crypto;

    Object.defineProperty(globalThis, "crypto", {
      value: undefined,
      configurable: true,
    });

    try {
      const first = makeRequestId("req");
      const second = makeRequestId("req");
      expect(first.startsWith("req_")).toBe(true);
      expect(first).not.toBe(second);
      expect(first).toMatch(/^req_[0-9a-f]+_[0-9a-f]+_[0-9a-f]{4}$/);
    } finally {
      Object.defineProperty(globalThis, "crypto", {
        value: originalCrypto,
        configurable: true,
      });
    }
  });
});
