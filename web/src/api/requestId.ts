// Stable request id generation used by web clients.
//
// We prefer `crypto.randomUUID()` and `crypto.getRandomValues()` when available.
// In constrained environments, we fallback to a deterministic session-scope
// sequence to avoid weak `Math.random()`-based identifiers.

const fallbackState = {
  lastNowMs: 0,
  sequence: 0,
};

function fallbackRequestId(prefix: string): string {
  const nowMs = Date.now();
  const perfNow = (() => {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
      return Math.max(0, Math.floor(performance.now()));
    }
    return 0;
  })();

  if (fallbackState.lastNowMs === nowMs) {
    fallbackState.sequence += 1;
  } else {
    fallbackState.lastNowMs = nowMs;
    fallbackState.sequence = 0;
  }

  return `${prefix}_${nowMs.toString(16)}_${perfNow.toString(16)}_${fallbackState.sequence.toString(16).padStart(4, "0")}`;
}

function getRandomHex(byteCount: number): string | null {
  try {
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.getRandomValues === "function"
    ) {
      const bytes = new Uint8Array(byteCount);
      crypto.getRandomValues(bytes);
      return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    }
  } catch {
    // ignore and fall back
  }
  return null;
}

export function makeRequestId(prefix = "req"): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `${prefix}_${crypto.randomUUID()}`;
  }

  const secureRandom = getRandomHex(16);
  if (secureRandom) return `${prefix}_${secureRandom}`;

  return fallbackRequestId(prefix);
}
