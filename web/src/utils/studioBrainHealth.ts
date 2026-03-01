export type StudioBrainMode = "healthy" | "degraded" | "offline" | "disabled" | "unknown";

export type StudioBrainUnavailableResolution = {
  mode: "disabled" | "unknown";
  reasonCode: "INTEGRATION_DISABLED" | "STUDIO_BRAIN_BASE_URL_UNAVAILABLE";
  reason: string;
  signalAgeMinutes: number | null;
};

export type StudioBrainFetchFailureResolution = {
  mode: "offline" | "unknown";
  reasonCode:
    | "OFFLINE_CONFIRMED_BY_SIGNAL_GAP"
    | "SIGNAL_DELAY_UNCONFIRMED_OFFLINE"
    | "SIGNAL_STALE_PENDING_OFFLINE_CONFIRMATION"
    | "SIGNAL_UNAVAILABLE_NO_BASELINE";
  reason: string;
  signalAgeMinutes: number | null;
};

export function isStudioBrainDegradedMode(mode?: StudioBrainMode | null): boolean {
  return mode === "degraded" || mode === "offline";
}

export function minutesSinceIso(iso: string | null, nowMs = Date.now()): number | null {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.round((nowMs - parsed) / 60000));
}

export function formatMinutesAgo(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) return "n/a";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours < 24) return `${hours}h ${remainder}m`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return `${days}d ${remHours}h`;
}

export function resolveUnavailableStudioBrainStatus(params: {
  enabled: boolean;
  reason: string;
  lastKnownGoodAt: string | null;
  nowMs?: number;
}): StudioBrainUnavailableResolution {
  const signalAgeMinutes = minutesSinceIso(params.lastKnownGoodAt, params.nowMs);
  if (!params.enabled) {
    return {
      mode: "disabled",
      reasonCode: "INTEGRATION_DISABLED",
      reason: params.reason,
      signalAgeMinutes,
    };
  }
  return {
    mode: "unknown",
    reasonCode: "STUDIO_BRAIN_BASE_URL_UNAVAILABLE",
    reason: params.reason,
    signalAgeMinutes,
  };
}

export function resolveStudioBrainFetchFailure(params: {
  details: string;
  lastKnownGoodAt: string | null;
  signalStaleMinutes: number;
  offlineConfirmMinutes: number;
  nowMs?: number;
}): StudioBrainFetchFailureResolution {
  const nowMs = params.nowMs ?? Date.now();
  const signalAgeMinutes = minutesSinceIso(params.lastKnownGoodAt, nowMs);
  const hasRecentHealthySignal =
    signalAgeMinutes !== null && signalAgeMinutes <= params.signalStaleMinutes;
  const hasAgedHealthySignal =
    signalAgeMinutes !== null && signalAgeMinutes > params.offlineConfirmMinutes;

  if (params.lastKnownGoodAt && hasRecentHealthySignal) {
    return {
      mode: "unknown",
      reasonCode: "SIGNAL_DELAY_UNCONFIRMED_OFFLINE",
      signalAgeMinutes,
      reason:
        `Ready check unreachable, but last-known-good was ${formatMinutesAgo(signalAgeMinutes)} ago. ` +
        `Holding state as unknown (not offline) while telemetry may be delayed. ${params.details}`,
    };
  }

  if (params.lastKnownGoodAt && hasAgedHealthySignal) {
    return {
      mode: "offline",
      reasonCode: "OFFLINE_CONFIRMED_BY_SIGNAL_GAP",
      signalAgeMinutes,
      reason:
        `Ready check unreachable and last-known-good is ${formatMinutesAgo(signalAgeMinutes)} old. ` +
        `Treating as offline with context. ${params.details}`,
    };
  }

  if (params.lastKnownGoodAt) {
    return {
      mode: "unknown",
      reasonCode: "SIGNAL_STALE_PENDING_OFFLINE_CONFIRMATION",
      signalAgeMinutes,
      reason:
        `Ready check unreachable and last-known-good is ${formatMinutesAgo(signalAgeMinutes)} old. ` +
        `Offline confirmation waits until signal gap exceeds ${params.offlineConfirmMinutes} minutes. ${params.details}`,
    };
  }

  return {
    mode: "unknown",
    reasonCode: "SIGNAL_UNAVAILABLE_NO_BASELINE",
    signalAgeMinutes,
    reason: params.details || "Studio Brain ready check unreachable.",
  };
}
