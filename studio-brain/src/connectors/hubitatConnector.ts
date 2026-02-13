import { stableHashDeep } from "../stores/hash";
import { ConnectorCircuitBreaker } from "./circuitBreaker";
import { ConnectorError, type Connector, type ConnectorContext, type ConnectorExecutionRequest, type ConnectorHealth, type ConnectorReadResult, type NormalizedDeviceState } from "./types";

type Transport = (path: string, input: Record<string, unknown>, timeoutMs: number) => Promise<unknown>;

function normalizeDevice(raw: unknown): NormalizedDeviceState {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const id = typeof row.id === "string" ? row.id : String(row.deviceId ?? "unknown-device");
  const label = typeof row.label === "string" ? row.label : String(row.name ?? id);
  const switchValue = typeof row.switch === "string" ? row.switch.toLowerCase() : "";
  const online = switchValue === "on" || row.online === true || row.presence === "present";
  const batteryRaw = row.battery;
  const batteryPct = typeof batteryRaw === "number" ? Math.max(0, Math.min(100, Math.round(batteryRaw))) : null;

  return {
    id,
    label,
    online,
    batteryPct,
    attributes: row,
  };
}

export function classifyConnectorError(error: unknown): ConnectorError {
  if (error instanceof ConnectorError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout/i.test(message)) return new ConnectorError("TIMEOUT", message, true);
  if (/401|403|unauthor/i.test(message)) return new ConnectorError("AUTH", message, false);
  if (/5\d\d|unavailable|econnrefused/i.test(message)) return new ConnectorError("UNAVAILABLE", message, true);
  if (/malformed|invalid|parse/i.test(message)) return new ConnectorError("BAD_RESPONSE", message, false);
  return new ConnectorError("UNKNOWN", message, false);
}

export class HubitatConnector implements Connector {
  readonly id = "hubitat";
  readonly target = "hubitat" as const;
  readonly version = "0.1.0";
  readonly readOnly = true;

  constructor(
    private readonly transport: Transport,
    private readonly circuitBreaker = new ConnectorCircuitBreaker()
  ) {}

  async health(ctx: ConnectorContext): Promise<ConnectorHealth> {
    const started = Date.now();
    const input = { path: "/health", requestId: ctx.requestId };
    const inputHash = stableHashDeep(input);
    try {
      if (!this.circuitBreaker.canAttempt(started)) {
        return {
          ok: false,
          latencyMs: 0,
          availability: "degraded",
          requestId: ctx.requestId,
          inputHash,
          outputHash: null,
        };
      }
      const payload = await this.transport("/health", input, ctx.timeoutMs ?? 10_000);
      this.circuitBreaker.recordSuccess();
      return {
        ok: true,
        latencyMs: Date.now() - started,
        availability: "healthy",
        requestId: ctx.requestId,
        inputHash,
        outputHash: stableHashDeep(payload),
      };
    } catch (error) {
      this.circuitBreaker.recordFailure(started);
      throw classifyConnectorError(error);
    }
  }

  async readStatus(ctx: ConnectorContext, input: Record<string, unknown>): Promise<ConnectorReadResult> {
    const started = Date.now();
    if (!this.circuitBreaker.canAttempt(started)) {
      throw new ConnectorError("UNAVAILABLE", "Connector is in backoff window.", true, {
        circuit: this.circuitBreaker.state(),
      });
    }

    const request = { ...input, requestId: ctx.requestId };
    const inputHash = stableHashDeep(request);
    try {
      const payload = await this.transport("/devices", request, ctx.timeoutMs ?? 10_000);
      const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
      if (root.devices !== undefined && !Array.isArray(root.devices)) {
        throw new ConnectorError("BAD_RESPONSE", "Malformed Hubitat payload: devices must be an array.", false);
      }
      const rawDevices = Array.isArray(root.devices) ? root.devices : [];
      const devices = rawDevices.map((row) => normalizeDevice(row));
      this.circuitBreaker.recordSuccess();
      return {
        requestId: ctx.requestId,
        inputHash,
        outputHash: stableHashDeep(devices),
        devices,
        rawCount: rawDevices.length,
      };
    } catch (error) {
      this.circuitBreaker.recordFailure(started);
      throw classifyConnectorError(error);
    }
  }

  async execute(ctx: ConnectorContext, request: ConnectorExecutionRequest): Promise<ConnectorReadResult> {
    if (request.intent === "write") {
      throw new ConnectorError("READ_ONLY_VIOLATION", "Hubitat connector is read-only.", false, {
        action: request.action,
      });
    }
    return this.readStatus(ctx, request.input);
  }
}
