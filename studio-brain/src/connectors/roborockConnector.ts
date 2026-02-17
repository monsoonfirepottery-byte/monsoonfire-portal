import { stableHashDeep } from "../stores/hash";
import { ConnectorError, type Connector, type ConnectorContext, type ConnectorExecutionRequest, type ConnectorHealth, type ConnectorReadResult } from "./types";

type Transport = (path: string, input: Record<string, unknown>, timeoutMs: number) => Promise<unknown>;

function classifyRoborockError(error: unknown): ConnectorError {
  if (error instanceof ConnectorError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout/i.test(message)) return new ConnectorError("TIMEOUT", message, true);
  if (/401|403|unauthor/i.test(message)) return new ConnectorError("AUTH", message, false);
  if (/5\d\d|unavailable|econnrefused/i.test(message)) return new ConnectorError("UNAVAILABLE", message, true);
  if (/malformed|invalid|parse/i.test(message)) return new ConnectorError("BAD_RESPONSE", message, false);
  return new ConnectorError("UNKNOWN", message, false);
}

export class RoborockConnector implements Connector {
  readonly id = "roborock";
  readonly target = "roborock" as const;
  readonly version = "0.1.0";
  readonly readOnly = true;

  constructor(
    private readonly transport: Transport,
    private readonly staleAfterMs = 30 * 60 * 1000
  ) {}

  async health(ctx: ConnectorContext): Promise<ConnectorHealth> {
    const inputHash = stableHashDeep({ requestId: ctx.requestId, path: "/health" });
    try {
      const payload = await this.transport("/health", { requestId: ctx.requestId }, ctx.timeoutMs ?? 10_000);
      return {
        ok: true,
        latencyMs: 1,
        availability: "healthy",
        requestId: ctx.requestId,
        inputHash,
        outputHash: stableHashDeep(payload),
      };
    } catch (error) {
      throw classifyRoborockError(error);
    }
  }

  async readStatus(ctx: ConnectorContext, input: Record<string, unknown>): Promise<ConnectorReadResult> {
    const nowMs = Date.now();
    const request = { ...input, requestId: ctx.requestId };
    try {
      const payload = await this.transport("/devices", request, ctx.timeoutMs ?? 10_000);
      const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
      if (root.devices !== undefined && !Array.isArray(root.devices)) {
        throw new ConnectorError("BAD_RESPONSE", "Malformed Roborock payload: devices must be an array.", false);
      }
      const rows = Array.isArray(root.devices) ? root.devices : [];
      const devices = rows.map((row, index) => {
        const item = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
        const lastSeenAt = typeof item.lastSeenAt === "string" ? item.lastSeenAt : null;
        const lastSeenMs = lastSeenAt ? Date.parse(lastSeenAt) : NaN;
        const stale = Number.isFinite(lastSeenMs) ? nowMs - lastSeenMs > this.staleAfterMs : false;
        const onlineValue = item.online === true && !stale;
        return {
          id: typeof item.id === "string" ? item.id : `roborock-${index + 1}`,
          label: typeof item.name === "string" ? item.name : `Roborock ${index + 1}`,
          online: onlineValue,
          batteryPct: typeof item.battery === "number" ? Math.max(0, Math.min(100, Math.round(item.battery))) : null,
          attributes: {
            ...item,
            stale,
          },
        };
      });
      return {
        requestId: ctx.requestId,
        inputHash: stableHashDeep(request),
        outputHash: stableHashDeep(devices),
        devices,
        rawCount: rows.length,
      };
    } catch (error) {
      throw classifyRoborockError(error);
    }
  }

  async execute(ctx: ConnectorContext, request: ConnectorExecutionRequest): Promise<ConnectorReadResult> {
    if (request.intent === "write") {
      throw new ConnectorError("READ_ONLY_VIOLATION", "Roborock connector is read-only.", false, {
        action: request.action,
      });
    }
    return this.readStatus(ctx, request.input);
  }
}
