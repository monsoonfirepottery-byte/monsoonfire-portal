import { stableHashDeep } from "../stores/hash";
import { ConnectorError, type Connector, type ConnectorContext, type ConnectorExecutionRequest, type ConnectorHealth, type ConnectorReadResult, type NormalizedDeviceState } from "./types";

type Transport = (path: string, input: Record<string, unknown>, timeoutMs: number) => Promise<unknown>;

type RoborockRawDevice = Record<string, unknown>;

type RoborockAlert = {
  code: string;
  severity: "info" | "warning" | "critical";
  message: string;
};

function classifyRoborockError(error: unknown): ConnectorError {
  if (error instanceof ConnectorError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout/i.test(message)) return new ConnectorError("TIMEOUT", message, true);
  if (/401|403|unauthor/i.test(message)) return new ConnectorError("AUTH", message, false);
  if (/5\d\d|unavailable|econnrefused/i.test(message)) return new ConnectorError("UNAVAILABLE", message, true);
  if (/malformed|invalid|parse/i.test(message)) return new ConnectorError("BAD_RESPONSE", message, false);
  return new ConnectorError("UNKNOWN", message, false);
}

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function collectAlerts(item: RoborockRawDevice): RoborockAlert[] {
  const alerts: RoborockAlert[] = [];
  const state = String(item.state ?? "unknown").toLowerCase();
  const errorText = String(item.error ?? item.errorCode ?? "").trim();

  if (state === "error" || errorText) {
    alerts.push({
      code: "job_error",
      severity: "critical",
      message: errorText ? `Vacuum reported an error: ${errorText}` : "Vacuum reported an error state.",
    });
  }

  if (state === "paused") {
    alerts.push({
      code: "job_stopped",
      severity: "warning",
      message: "Vacuum job is paused/stopped and may need operator attention.",
    });
  }

  const filterPct = numeric(item.filterLifePct ?? item.filter_life_remaining ?? item.filter_left ?? item.filter_life_level);
  if (filterPct !== null && filterPct <= 15) {
    alerts.push({
      code: "filter_maintenance_due",
      severity: filterPct <= 5 ? "critical" : "warning",
      message: `Filter life is low (${Math.max(0, Math.round(filterPct))}%).`,
    });
  }

  const brushPct = numeric(item.mainBrushLifePct ?? item.main_brush_left ?? item.main_brush_life_level);
  if (brushPct !== null && brushPct <= 15) {
    alerts.push({
      code: "main_brush_maintenance_due",
      severity: brushPct <= 5 ? "critical" : "warning",
      message: `Main brush life is low (${Math.max(0, Math.round(brushPct))}%).`,
    });
  }

  return alerts;
}

function normalizeDevice(row: unknown, index: number, nowMs: number, staleAfterMs: number): NormalizedDeviceState {
  const item = row && typeof row === "object" ? (row as RoborockRawDevice) : {};
  const lastSeenAt = typeof item.lastSeenAt === "string" ? item.lastSeenAt : null;
  const lastSeenMs = lastSeenAt ? Date.parse(lastSeenAt) : NaN;
  const stale = Number.isFinite(lastSeenMs) ? nowMs - lastSeenMs > staleAfterMs : false;
  const onlineValue = item.online === true && !stale;
  const state = String(item.state ?? "unknown");

  const batteryPctRaw = numeric(item.battery);
  const filterLifePct = numeric(item.filterLifePct ?? item.filter_life_remaining ?? item.filter_left ?? item.filter_life_level);
  const mainBrushLifePct = numeric(item.mainBrushLifePct ?? item.main_brush_left ?? item.main_brush_life_level);
  const sideBrushLifePct = numeric(item.sideBrushLifePct ?? item.side_brush_left ?? item.side_brush_life_level);
  const sensorLifePct = numeric(item.sensorDirtyLifePct ?? item.sensor_dirty_left ?? item.sensor_dirty_life_level);

  const alerts = collectAlerts(item);

  return {
    id: typeof item.id === "string" ? item.id : `roborock-${index + 1}`,
    label: typeof item.name === "string" ? item.name : `Roborock ${index + 1}`,
    online: onlineValue,
    batteryPct: batteryPctRaw === null ? null : Math.max(0, Math.min(100, Math.round(batteryPctRaw))),
    attributes: {
      ...item,
      stale,
      alerts,
      vitalStats: {
        state,
        batteryPct: batteryPctRaw,
        cleanAreaSqM: numeric(item.cleanAreaSqM ?? item.clean_area ?? item.last_clean_area),
        cleanDurationSec: numeric(item.cleanDurationSec ?? item.clean_duration ?? item.last_clean_duration),
        filterLifePct,
        mainBrushLifePct,
        sideBrushLifePct,
        sensorLifePct,
      },
      telemetry: {
        lastSeenAt,
        lastTelemetryAt: typeof item.lastTelemetryAt === "string" ? item.lastTelemetryAt : null,
      },
    },
  };
}

export class RoborockConnector implements Connector {
  readonly id = "roborock";
  readonly target = "roborock" as const;
  readonly version = "0.2.0";
  readonly readOnly = false;

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
      const devices = rows.map((row, index) => normalizeDevice(row, index, nowMs, this.staleAfterMs));
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
    if (request.intent === "read") {
      return this.readStatus(ctx, request.input);
    }

    if (request.action === "clean.start_full") {
      await this.transport("/commands/start_full", { ...request.input, requestId: ctx.requestId }, ctx.timeoutMs ?? 10_000);
      return this.readStatus(ctx, request.input);
    }

    if (request.action === "clean.start_rooms") {
      const roomIds = Array.isArray(request.input.roomIds) ? request.input.roomIds : [];
      if (roomIds.length === 0) {
        throw new ConnectorError("BAD_RESPONSE", "roomIds[] is required for clean.start_rooms.", false);
      }
      await this.transport("/commands/start_rooms", { ...request.input, requestId: ctx.requestId }, ctx.timeoutMs ?? 10_000);
      return this.readStatus(ctx, request.input);
    }

    throw new ConnectorError("READ_ONLY_VIOLATION", "Unsupported Roborock write action.", false, {
      action: request.action,
    });
  }
}
