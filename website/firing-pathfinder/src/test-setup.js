import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: globalThis.jsdom.window.localStorage,
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete document.execCommand;
});

Object.defineProperty(globalThis.navigator, "clipboard", {
  configurable: true,
  value: {
    writeText: async () => undefined,
  },
});

Object.defineProperty(globalThis, "scrollTo", {
  configurable: true,
  value: vi.fn(),
});
