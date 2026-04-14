import { existsSync } from "node:fs";
import type {
  KilnDiagnosticsSnapshot,
  KilnObservationProvider,
  KilnObservationProviderHealth,
  KilnObservationProviderSupport,
  KilnStatusSnapshot,
} from "./types";

export class KilnAidReadOnlyProvider implements KilnObservationProvider {
  readonly id = "kilnaid";
  readonly mode = "read_only" as const;

  constructor(private readonly sessionPath: string | null = null) {}

  describeSupport(): KilnObservationProviderSupport {
    const configured = Boolean(this.sessionPath && existsSync(this.sessionPath));
    return {
      providerId: this.id,
      mode: this.mode,
      supportsStatus: configured,
      supportsDiagnostics: false,
      supportsHistory: false,
      supportedWriteActions: [],
      configured,
      notes: configured
        ? ["Session material detected. Read-only snapshot integration can be added later."]
        : ["No KilnAid session material configured. Provider remains a placeholder in MVP."],
    };
  }

  async health(): Promise<KilnObservationProviderHealth> {
    const support = this.describeSupport();
    return {
      ok: support.configured,
      availability: support.configured ? "degraded" : "down",
      latencyMs: 0,
      message: support.notes[0] ?? "KilnAid read-only provider is unavailable.",
    };
  }

  async readStatus(_kilnId: string): Promise<KilnStatusSnapshot> {
    throw new Error("KilnAid status observation is not configured in MVP.");
  }

  async readDiagnostics(_kilnId: string): Promise<KilnDiagnosticsSnapshot> {
    throw new Error("KilnAid diagnostics observation is not configured in MVP.");
  }
}

export function createKilnAidReadOnlyProvider(sessionPath: string | null = null): KilnObservationProvider {
  return new KilnAidReadOnlyProvider(sessionPath);
}
