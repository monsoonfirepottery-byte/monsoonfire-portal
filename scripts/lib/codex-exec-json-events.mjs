function clean(value) {
  return String(value ?? "").trim();
}

function toNonNegativeInteger(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed);
}

function firstNumberFromObject(source, keys = []) {
  if (!source || typeof source !== "object") return null;
  for (const key of keys) {
    const parsed = toNonNegativeInteger(source[key]);
    if (parsed != null) return parsed;
  }
  return null;
}

function outputDetailsReasoningTokens(source) {
  const details = source?.output_token_details || source?.outputTokenDetails || source?.completion_tokens_details;
  if (!details || typeof details !== "object") return null;
  return firstNumberFromObject(details, ["reasoning_tokens", "reasoningTokens", "reasoning_output_tokens"]);
}

export function normalizeCodexExecUsage(rawUsage, source = "") {
  if (!rawUsage || typeof rawUsage !== "object") return null;
  const inputTokens = firstNumberFromObject(rawUsage, [
    "inputTokens",
    "input_tokens",
    "promptTokens",
    "prompt_tokens",
    "tokensIn",
  ]);
  const outputTokens = firstNumberFromObject(rawUsage, [
    "outputTokens",
    "output_tokens",
    "completionTokens",
    "completion_tokens",
    "tokensOut",
  ]);
  const reasoningTokens =
    firstNumberFromObject(rawUsage, [
      "reasoningTokens",
      "reasoning_tokens",
      "reasoningOutputTokens",
      "reasoning_output_tokens",
      "tokensReasoning",
    ]) ?? outputDetailsReasoningTokens(rawUsage);
  const cacheReadTokens = firstNumberFromObject(rawUsage, [
    "cacheReadTokens",
    "cache_read_tokens",
    "cachedInputTokens",
    "cached_input_tokens",
    "cachedTokensRead",
    "cacheRead",
  ]);
  const cacheWriteTokens = firstNumberFromObject(rawUsage, [
    "cacheWriteTokens",
    "cache_write_tokens",
    "cachedTokensWrite",
    "cacheWrite",
  ]);
  const explicitTotal = firstNumberFromObject(rawUsage, ["totalTokens", "total_tokens", "tokensTotal", "total"]);
  const inferredTotal = [inputTokens, outputTokens, reasoningTokens, cacheWriteTokens]
    .filter((value) => value != null)
    .reduce((sum, value) => sum + value, 0);
  const totalTokens = explicitTotal ?? (inferredTotal > 0 ? inferredTotal : null);
  const hasAny =
    inputTokens != null ||
    outputTokens != null ||
    reasoningTokens != null ||
    cacheReadTokens != null ||
    cacheWriteTokens != null ||
    totalTokens != null;
  if (!hasAny) return null;
  return {
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
    reasoningTokens: reasoningTokens ?? 0,
    cacheReadTokens: cacheReadTokens ?? 0,
    cacheWriteTokens: cacheWriteTokens ?? 0,
    totalTokens: totalTokens ?? inferredTotal,
    estimated: false,
    source: clean(source) || "codex.exec.json",
  };
}

function pushUsageCandidate(candidates, value, source) {
  const usage = normalizeCodexExecUsage(value, source);
  if (usage) candidates.push(usage);
}

function usageCandidatesFromEvent(event) {
  const candidates = [];
  if (!event || typeof event !== "object") return candidates;
  pushUsageCandidate(candidates, event.usage, "event.usage");
  pushUsageCandidate(candidates, event.tokenUsage, "event.tokenUsage");
  pushUsageCandidate(candidates, event.context?.usage, "event.context.usage");
  pushUsageCandidate(candidates, event.context?.tokenUsage, "event.context.tokenUsage");

  const payload = event.payload && typeof event.payload === "object" ? event.payload : {};
  pushUsageCandidate(candidates, payload.usage, "payload.usage");
  pushUsageCandidate(candidates, payload.tokenUsage, "payload.tokenUsage");
  pushUsageCandidate(candidates, payload.info?.total_token_usage, "payload.info.total_token_usage");
  pushUsageCandidate(candidates, payload.info?.last_token_usage, "payload.info.last_token_usage");

  const message = event.msg && typeof event.msg === "object" ? event.msg : {};
  pushUsageCandidate(candidates, message.usage, "msg.usage");
  pushUsageCandidate(candidates, message.tokenUsage, "msg.tokenUsage");
  pushUsageCandidate(candidates, message.info?.total_token_usage, "msg.info.total_token_usage");
  pushUsageCandidate(candidates, message.info?.last_token_usage, "msg.info.last_token_usage");
  return candidates;
}

function chooseBestUsage(candidates = []) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  return [...candidates].sort((left, right) => {
    const leftTotal = Number(left?.totalTokens || 0);
    const rightTotal = Number(right?.totalTokens || 0);
    if (rightTotal !== leftTotal) return rightTotal - leftTotal;
    const leftReasoning = Number(left?.reasoningTokens || 0);
    const rightReasoning = Number(right?.reasoningTokens || 0);
    if (rightReasoning !== leftReasoning) return rightReasoning - leftReasoning;
    return clean(left?.source).localeCompare(clean(right?.source));
  })[0];
}

export function parseCodexExecJsonEvents(stdout) {
  const lines = String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const events = [];
  const invalidLines = [];
  lines.forEach((line, index) => {
    try {
      const event = JSON.parse(line);
      if (event && typeof event === "object") events.push(event);
    } catch {
      invalidLines.push({ lineNumber: index + 1, sample: line.slice(0, 240) });
    }
  });
  return { events, invalidLines, lineCount: lines.length };
}

export function collectCodexExecJsonTelemetry(stdout) {
  const parsed = parseCodexExecJsonEvents(stdout);
  const eventTypes = new Map();
  const usageCandidates = [];
  for (const event of parsed.events) {
    const type = clean(event.type || event.payload?.type || event.msg?.type || "unknown");
    eventTypes.set(type, (eventTypes.get(type) || 0) + 1);
    usageCandidates.push(...usageCandidatesFromEvent(event));
  }
  const usage = chooseBestUsage(usageCandidates);
  return {
    schema: "codex-exec-json-telemetry.v1",
    eventCount: parsed.events.length,
    lineCount: parsed.lineCount,
    invalidLineCount: parsed.invalidLines.length,
    invalidLines: parsed.invalidLines.slice(0, 5),
    eventTypes: Object.fromEntries([...eventTypes.entries()].sort((left, right) => left[0].localeCompare(right[0]))),
    usage,
    usageCandidateCount: usageCandidates.length,
  };
}
