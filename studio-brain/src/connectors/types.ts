export type ConnectorErrorCode =
  | "AUTH"
  | "TIMEOUT"
  | "UNAVAILABLE"
  | "BAD_RESPONSE"
  | "READ_ONLY_VIOLATION"
  | "UNKNOWN";

export class ConnectorError extends Error {
  constructor(
    readonly code: ConnectorErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly meta: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}

export type ConnectorHealth = {
  ok: boolean;
  latencyMs: number;
  availability: "healthy" | "degraded" | "down";
  requestId: string;
  inputHash: string;
  outputHash: string | null;
};

export type ConnectorExecutionRequest = {
  intent: "read" | "write";
  action: string;
  input: Record<string, unknown>;
};

export type NormalizedDeviceState = {
  id: string;
  label: string;
  online: boolean;
  batteryPct: number | null;
  attributes: Record<string, unknown>;
};

export type ConnectorReadResult = {
  requestId: string;
  inputHash: string;
  outputHash: string;
  devices: NormalizedDeviceState[];
  rawCount: number;
};

export type ConnectorContext = {
  requestId: string;
  timeoutMs?: number;
};

export interface Connector {
  readonly id: string;
  readonly target: "hubitat" | "roborock";
  readonly version: string;
  readonly readOnly: boolean;
  health(ctx: ConnectorContext): Promise<ConnectorHealth>;
  readStatus(ctx: ConnectorContext, input: Record<string, unknown>): Promise<ConnectorReadResult>;
  execute(ctx: ConnectorContext, request: ConnectorExecutionRequest): Promise<ConnectorReadResult>;
}
