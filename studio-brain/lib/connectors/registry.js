"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConnectorRegistry = void 0;
const hash_1 = require("../stores/hash");
class ConnectorRegistry {
    connectors;
    logger;
    constructor(connectors, logger) {
        this.connectors = connectors;
        this.logger = logger;
    }
    list() {
        return [...this.connectors];
    }
    get(id) {
        return this.connectors.find((connector) => connector.id === id) ?? null;
    }
    async healthAll(ctx) {
        const rows = [];
        for (const connector of this.connectors) {
            const started = Date.now();
            try {
                const health = await connector.health(ctx);
                this.logger.info("connector_health", {
                    connectorId: connector.id,
                    requestId: ctx.requestId,
                    latencyMs: health.latencyMs,
                    inputHash: health.inputHash,
                    outputHash: health.outputHash,
                    ok: health.ok,
                });
                rows.push({ id: connector.id, ok: health.ok, latencyMs: health.latencyMs });
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                this.logger.warn("connector_health_failed", {
                    connectorId: connector.id,
                    requestId: ctx.requestId,
                    latencyMs: Date.now() - started,
                    message,
                    errorHash: (0, hash_1.stableHashDeep)({ connectorId: connector.id, message }),
                });
                rows.push({ id: connector.id, ok: false, latencyMs: Date.now() - started });
            }
        }
        return rows;
    }
}
exports.ConnectorRegistry = ConnectorRegistry;
