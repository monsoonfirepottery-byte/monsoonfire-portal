import assert from "node:assert/strict";
import test from "node:test";

import { collectCodexExecJsonTelemetry, normalizeCodexExecUsage } from "./codex-exec-json-events.mjs";

test("normalizeCodexExecUsage accepts turn.completed usage with reasoning tokens", () => {
  const usage = normalizeCodexExecUsage(
    {
      input_tokens: 100,
      cached_input_tokens: 40,
      output_tokens: 25,
      reasoning_output_tokens: 7,
      total_tokens: 132,
    },
    "event.usage",
  );

  assert.deepEqual(usage, {
    inputTokens: 100,
    outputTokens: 25,
    reasoningTokens: 7,
    cacheReadTokens: 40,
    cacheWriteTokens: 0,
    totalTokens: 132,
    estimated: false,
    source: "event.usage",
  });
});

test("collectCodexExecJsonTelemetry extracts nested token_count usage", () => {
  const stdout = [
    JSON.stringify({ type: "turn.started" }),
    JSON.stringify({
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 26549,
            cached_input_tokens: 22272,
            output_tokens: 1590,
            reasoning_output_tokens: 1152,
            total_tokens: 28139,
          },
        },
      },
    }),
  ].join("\n");

  const telemetry = collectCodexExecJsonTelemetry(stdout);
  assert.equal(telemetry.eventCount, 2);
  assert.equal(telemetry.invalidLineCount, 0);
  assert.equal(telemetry.eventTypes.event_msg, 1);
  assert.equal(telemetry.usage.totalTokens, 28139);
  assert.equal(telemetry.usage.reasoningTokens, 1152);
  assert.equal(telemetry.usage.source, "payload.info.total_token_usage");
});

test("collectCodexExecJsonTelemetry tolerates non-json stdout noise", () => {
  const telemetry = collectCodexExecJsonTelemetry(
    [
      "not json",
      JSON.stringify({ type: "turn.completed", usage: { input_tokens: 10, output_tokens: 4 } }),
    ].join("\n"),
  );

  assert.equal(telemetry.eventCount, 1);
  assert.equal(telemetry.invalidLineCount, 1);
  assert.equal(telemetry.usage.totalTokens, 14);
});
