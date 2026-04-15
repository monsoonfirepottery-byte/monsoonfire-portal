const MY_PIECES_LOADING_EMPTY_STATE_PATTERN = /^Loading\b.*\.\.\.$/i;
const MY_PIECES_RECOGNIZED_EMPTY_GUIDANCE_PATTERN =
  /(No pieces yet|Nothing currently in flight|Nothing is currently in progress|Everything currently loaded already has feedback|Your first completed pieces will land here|first firing journey starts|No pieces in this view|No pieces found|No results)/i;

export function normalizeCanaryText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function classifyMyPiecesEmptyStates(emptyStates = [], extraEmptyStatePatterns = []) {
  const normalizedStates = Array.isArray(emptyStates)
    ? emptyStates.map((text) => normalizeCanaryText(text)).filter(Boolean)
    : [];
  const customPatterns = Array.isArray(extraEmptyStatePatterns)
    ? extraEmptyStatePatterns
        .map((pattern) => String(pattern || "").trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 20)
    : [];

  const loadingEmptyStates = normalizedStates.filter((text) =>
    MY_PIECES_LOADING_EMPTY_STATE_PATTERN.test(text)
  );
  const nonLoadingEmptyStates = normalizedStates.filter(
    (text) => !MY_PIECES_LOADING_EMPTY_STATE_PATTERN.test(text)
  );
  const hasRecognizedEmptyGuidance = nonLoadingEmptyStates.some((text) =>
    MY_PIECES_RECOGNIZED_EMPTY_GUIDANCE_PATTERN.test(text)
  );
  const hasCustomEmptyStateGuidance = nonLoadingEmptyStates.some((text) => {
    const lower = text.toLowerCase();
    return customPatterns.some((pattern) => lower.includes(pattern));
  });

  return {
    loadingVisible: loadingEmptyStates.length > 0,
    nonLoadingEmptyStateCount: nonLoadingEmptyStates.length,
    nonLoadingEmptyStates,
    hasRecognizedEmptyGuidance:
      hasRecognizedEmptyGuidance || hasCustomEmptyStateGuidance,
  };
}
