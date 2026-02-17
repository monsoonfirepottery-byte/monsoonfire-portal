export type CircuitState = {
  failureCount: number;
  lastFailureAt: string | null;
  nextRetryAt: string | null;
};

export class ConnectorCircuitBreaker {
  private failureCount = 0;
  private lastFailureAtMs: number | null = null;
  private nextRetryAtMs: number | null = null;

  constructor(
    private readonly maxFailures = 3,
    private readonly baseBackoffMs = 1_000,
    private readonly maxBackoffMs = 30_000
  ) {}

  canAttempt(now = Date.now()): boolean {
    return this.nextRetryAtMs === null || now >= this.nextRetryAtMs;
  }

  recordSuccess(): void {
    this.failureCount = 0;
    this.lastFailureAtMs = null;
    this.nextRetryAtMs = null;
  }

  recordFailure(now = Date.now()): void {
    this.failureCount += 1;
    this.lastFailureAtMs = now;
    if (this.failureCount < this.maxFailures) {
      this.nextRetryAtMs = null;
      return;
    }
    const exponent = Math.max(0, this.failureCount - this.maxFailures);
    const wait = Math.min(this.maxBackoffMs, this.baseBackoffMs * 2 ** exponent);
    this.nextRetryAtMs = now + wait;
  }

  state(): CircuitState {
    return {
      failureCount: this.failureCount,
      lastFailureAt: this.lastFailureAtMs ? new Date(this.lastFailureAtMs).toISOString() : null,
      nextRetryAt: this.nextRetryAtMs ? new Date(this.nextRetryAtMs).toISOString() : null,
    };
  }
}
