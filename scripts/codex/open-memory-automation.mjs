#!/usr/bin/env node

/* eslint-disable no-console */

function unavailableReason() {
  if (String(process.env.OPEN_MEMORY_DISABLED || "").trim()) {
    return "open-memory-disabled";
  }
  return "open-memory-not-configured";
}

export async function loadAutomationStartupMemoryContext(payload = {}) {
  return {
    attempted: false,
    ok: false,
    itemCount: 0,
    reason: unavailableReason(),
    error: null,
    context: [],
    tool: String(payload?.tool || ""),
    runId: String(payload?.runId || ""),
    query: String(payload?.query || ""),
  };
}

export async function captureAutomationMemory(payload = {}) {
  return {
    attempted: false,
    ok: false,
    reason: unavailableReason(),
    error: null,
    status: 0,
    tool: String(payload?.tool || ""),
    runId: String(payload?.runId || ""),
  };
}
