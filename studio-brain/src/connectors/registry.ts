import { stableHashDeep } from "../stores/hash";
import type { Logger } from "../config/logger";
import type { Connector, ConnectorContext } from "./types";

export class ConnectorRegistry {
  constructor(
    private readonly connectors: Connector[],
    private readonly logger: Logger
  ) {}

  list(): Connector[] {
    return [...this.connectors];
  }

  get(id: string): Connector | null {
    return this.connectors.find((connector) => connector.id === id) ?? null;
  }

  async healthAll(ctx: ConnectorContext): Promise<Array<{ id: string; ok: boolean; latencyMs: number }>> {
    const rows: Array<{ id: string; ok: boolean; latencyMs: number }> = [];
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
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn("connector_health_failed", {
          connectorId: connector.id,
          requestId: ctx.requestId,
          latencyMs: Date.now() - started,
          message,
          errorHash: stableHashDeep({ connectorId: connector.id, message }),
        });
        rows.push({ id: connector.id, ok: false, latencyMs: Date.now() - started });
      }
    }
    return rows;
  }
}
