"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConnectorCircuitBreaker = void 0;
class ConnectorCircuitBreaker {
    maxFailures;
    baseBackoffMs;
    maxBackoffMs;
    failureCount = 0;
    lastFailureAtMs = null;
    nextRetryAtMs = null;
    constructor(maxFailures = 3, baseBackoffMs = 1_000, maxBackoffMs = 30_000) {
        this.maxFailures = maxFailures;
        this.baseBackoffMs = baseBackoffMs;
        this.maxBackoffMs = maxBackoffMs;
    }
    canAttempt(now = Date.now()) {
        return this.nextRetryAtMs === null || now >= this.nextRetryAtMs;
    }
    recordSuccess() {
        this.failureCount = 0;
        this.lastFailureAtMs = null;
        this.nextRetryAtMs = null;
    }
    recordFailure(now = Date.now()) {
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
    state() {
        return {
            failureCount: this.failureCount,
            lastFailureAt: this.lastFailureAtMs ? new Date(this.lastFailureAtMs).toISOString() : null,
            nextRetryAt: this.nextRetryAtMs ? new Date(this.nextRetryAtMs).toISOString() : null,
        };
    }
}
exports.ConnectorCircuitBreaker = ConnectorCircuitBreaker;
