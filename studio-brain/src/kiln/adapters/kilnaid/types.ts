export type KilnObservationProviderSupport = {
  providerId: string;
  mode: "read_only";
  supportsStatus: boolean;
  supportsDiagnostics: boolean;
  supportsHistory: boolean;
  supportedWriteActions: string[];
  configured: boolean;
  notes: string[];
};

export type KilnObservationProviderHealth = {
  ok: boolean;
  availability: "healthy" | "degraded" | "down";
  latencyMs: number;
  message: string;
};

export type KilnStatusSnapshot = {
  kilnId: string;
  observedAt: string;
  temperature: number | null;
  setPoint: number | null;
  segment: number | null;
  programName: string | null;
  status: string | null;
  rawPayload: Record<string, unknown>;
};

export type KilnDiagnosticsSnapshot = {
  kilnId: string;
  observedAt: string;
  diagnostics: Record<string, unknown>;
  rawPayload: Record<string, unknown>;
};

export interface KilnObservationProvider {
  readonly id: string;
  readonly mode: "read_only";
  describeSupport(): KilnObservationProviderSupport;
  health(): Promise<KilnObservationProviderHealth>;
  readStatus(kilnId: string): Promise<KilnStatusSnapshot>;
  readDiagnostics(kilnId: string): Promise<KilnDiagnosticsSnapshot>;
  readHistory?(kilnId: string): Promise<Array<Record<string, unknown>>>;
}
