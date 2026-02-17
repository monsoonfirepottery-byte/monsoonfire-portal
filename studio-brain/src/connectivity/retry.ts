import type { Logger } from "../config/logger";

export type RetryOptions = {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterMs?: number;
};

export type RetryPolicy = {
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterMs: number;
};

export function normalizeRetryOptions(input: RetryOptions | undefined): RetryPolicy {
  return {
    attempts: Math.max(1, Math.min(input?.attempts ?? 6, 25)),
    baseDelayMs: Math.max(20, input?.baseDelayMs ?? 100),
    maxDelayMs: Math.max(100, input?.maxDelayMs ?? 1_500),
    jitterMs: Math.max(0, input?.jitterMs ?? 80),
  };
}

export async function withRetry<T>(
  operationName: string,
  operation: () => Promise<T>,
  logger: Logger,
  options: RetryOptions = {}
): Promise<T> {
  const policy = normalizeRetryOptions(options);
  let lastError: unknown;

  for (let attempt = 1; attempt <= policy.attempts; attempt += 1) {
    try {
      if (attempt > 1) {
        logger.debug("dependency_retry_attempt", {
          operation: operationName,
          attempt,
        });
      }
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= policy.attempts) break;
      const exponential = Math.min(policy.baseDelayMs * 2 ** (attempt - 1), policy.maxDelayMs);
      const jitter = Math.floor(Math.random() * (policy.jitterMs + 1));
      const delayMs = exponential + jitter;
      logger.warn("dependency_retry_delay", {
        operation: operationName,
        attempt,
        delayMs,
        message: error instanceof Error ? error.message : String(error),
      });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`operation ${operationName} failed`);
}

